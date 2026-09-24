#!/usr/bin/env python3
"""Collect preview images and playable videos from the articles the register cites.

Reads dist/events.js, fetches every source page referenced by an event, extracts
Open Graph / Twitter / JSON-LD / embedded-player media, verifies each asset the
way the published page loads it (no Referer header) and writes dist/media.js as
window.DRONE_MEDIA. Raw per-URL results are cached in scripts/media-cache.json so
--offline can rebuild media.js without touching the network. Standard library only.

  python3 scripts/fetch-media.py                  # fetch and verify everything
  python3 scripts/fetch-media.py --only S12,N004  # refetch these sources / events' sources
  python3 scripts/fetch-media.py --offline        # rebuild media.js from the cache
"""
import argparse
import hashlib
import html
import http.client
import json
import re
import ssl
import struct
import sys
import threading
import zlib
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from html.parser import HTMLParser
from http.cookiejar import CookieJar
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote, unquote, urljoin, urlsplit, urlunsplit
from urllib.request import HTTPCookieProcessor, HTTPSHandler, Request, build_opener

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'dist' / 'events.js'
OUT = ROOT / 'dist' / 'media.js'
CACHE = ROOT / 'scripts' / 'media-cache.json'
EXTRA = ROOT / 'scripts' / 'media-extra.json'

UA = ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36')
PAGE_ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
IMAGE_ACCEPT = 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8'
TIMEOUT = 20
MAX_WORKERS = 6
PER_HOST = 2
PAGE_LIMIT = 6 * 1024 * 1024
IMAGE_LIMIT = 8 * 1024 * 1024
MIN_IMAGE_BYTES = 5 * 1024
MIN_IMAGE_WIDTH = 300

META_KEYS = {
    'og:title', 'og:image', 'og:image:url', 'og:image:secure_url', 'og:image:width',
    'og:image:height', 'og:image:alt', 'twitter:image', 'twitter:image:src',
    'twitter:image:alt', 'og:video', 'og:video:url', 'og:video:secure_url',
    'og:video:type', 'twitter:player',
}
BLOCK_STATUSES = {401, 403, 429, 451, 999}
BLOCK_MARKERS = ('captcha-delivery.com', 'cf-browser-verification', 'challenge-platform',
                 '<title>just a moment', 'attention required! | cloudflare', 'px-captcha',
                 '<title>access denied', 'please enable js and disable any ad blocker')
VIDEO_IFRAME = re.compile(r'youtube|youtu\.be|vimeo\.com|facebook\.com/plugins/video', re.I)
YOUTUBE = re.compile(r'(?:youtube(?:-nocookie)?\.com/(?:embed/|v/|shorts/|live/|watch\?(?:[^#]*&)?v=)'
                     r'|youtu\.be/)([A-Za-z0-9_-]{11})(?![A-Za-z0-9_-])')
YOUTUBE_ID = re.compile(r'^[A-Za-z0-9_-]{11}$')
VIMEO = re.compile(r'(?:player\.vimeo\.com/video/|//(?:www\.)?vimeo\.com/)(\d+)')
FACEBOOK_VIDEO = re.compile(r'^https://www\.facebook\.com/plugins/video\.php\?')
# Generic site artwork: matched against the file name (+ query) and the directory path.
GENERIC_NAME = re.compile(
    r'logo|favicon|placeholder|default|sprite|avatar|spacer|blank\.|(?:^|[-_.])1x1\.|pixel\.'
    r'|no[-_]?image|no[-_]?photo|fallback|apple-touch-icon|share[-_]?(?:image|img|card)'
    r'|social[-_]?(?:image|share|card)|^og[-_]?image|opengraph[-_]?default'
    r'|informa\w*[-_]oficial', re.I)  # MApN "Informații oficiale" press card, reused by many outlets
# Rejected after visual review of the fetched images: generic ministry artwork that a single
# outlet uses as its share image, which the same-site repeat rule cannot detect.
REVIEWED_GENERIC = (
    'financialintelligence.ro/wp-content/uploads/2020/01/mapn.jpg',  # MApN coat of arms
    'romania-actualitati.ro/uploads/modules/news/0/2026/8/14/232930/17867272696ca3cefc.jpg',  # press card
)
GENERIC_DIR = re.compile(r'/(?:logos?|favicons?|icons?|avatars?|placeholders?|sprites?)/'
                         r'|/wp-content/(?:themes|plugins)/', re.I)
# Videos embedded in the article body (not declared in page metadata) must look on-topic:
# their oEmbed title or embed text has to mention a drone in one of the register's languages.
DRONE_TERMS = re.compile(r'dron|droon|drohn|\buav|unmanned|bezpilot|дрон|бпла|безпил|безпіл|беспил'
                         r'|shahed|шахед|geran|герань|επανδρωμ|ντρόουν|lennok', re.I)
TWO_LEVEL_SUFFIXES = {'com.ua', 'co.uk', 'org.uk', 'com.gr', 'com.tr', 'com.pl'}

SSL_CONTEXT = ssl.create_default_context()
INSECURE_CONTEXT = ssl._create_unverified_context()
_host_slots = {}
_host_guard = threading.Lock()


# ---------------------------------------------------------------- HTTP

def host_slot(url):
    host = urlsplit(url).hostname or ''
    with _host_guard:
        return _host_slots.setdefault(host, threading.BoundedSemaphore(PER_HOST))


def decompress(raw, encoding):
    encoding = (encoding or '').lower()
    try:
        if 'gzip' in encoding:
            return zlib.decompressobj(16 + zlib.MAX_WBITS).decompress(raw)
        if 'deflate' in encoding:
            try:
                return zlib.decompressobj().decompress(raw)
            except zlib.error:
                return zlib.decompressobj(-zlib.MAX_WBITS).decompress(raw)
    except zlib.error:
        return b''
    return raw


def fetch(url, accept, limit, headers=None, encodings='gzip, deflate'):
    """One GET, following redirects; never raises. No Referer header is ever sent."""
    base = {'User-Agent': UA, 'Accept': accept, 'Accept-Language': 'en,ro;q=0.8',
            'Accept-Encoding': encodings}
    base.update(headers or {})
    result = {'status': None, 'finalUrl': url, 'headers': {}, 'body': b'', 'error': None}
    for context in (SSL_CONTEXT, INSECURE_CONTEXT):
        opener = build_opener(HTTPCookieProcessor(CookieJar()), HTTPSHandler(context=context))
        with host_slot(url):
            try:
                response = opener.open(Request(url, headers=base), timeout=TIMEOUT)
            except HTTPError as err:
                response = err
            except (URLError, OSError, ValueError, http.client.HTTPException) as err:
                reason = getattr(err, 'reason', err)
                if context is SSL_CONTEXT and isinstance(reason, ssl.SSLCertVerificationError):
                    result['insecureTls'] = True
                    continue
                result['error'] = f'{type(err).__name__}: {reason}'
                return result
            try:
                result['status'] = response.code
                result['finalUrl'] = response.geturl() or url
                result['headers'] = {k.lower(): v for k, v in response.headers.items()}
                try:
                    raw = response.read(limit) if response.fp else b''
                except http.client.IncompleteRead as err:
                    raw = err.partial
                except (OSError, http.client.HTTPException) as err:
                    raw = b''
                    result['error'] = f'{type(err).__name__}: {err}'
                result['body'] = decompress(raw, result['headers'].get('content-encoding'))
            finally:
                response.close()
        return result
    return result


# ---------------------------------------------------------------- page parsing

class PageParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.meta, self.image_src, self.iframes, self.video_tags = {}, [], [], []
        self.ld_json, self.amp_youtube, self.featured = [], [], []
        self.canonical = None
        self._ld, self._video_depth = None, 0

    def handle_starttag(self, tag, attrs):
        a = {k.lower(): (v or '').strip() for k, v in attrs}
        if tag == 'meta':
            key = (a.get('property') or a.get('name') or '').lower()
            if key in META_KEYS and a.get('content'):
                self.meta.setdefault(key, []).append(a['content'])
        elif tag == 'link' and a.get('href'):
            rel = a.get('rel', '').lower().split()
            if 'image_src' in rel:
                self.image_src.append(a['href'])
            elif 'canonical' in rel and not self.canonical:
                self.canonical = a['href']
        elif tag == 'img' and not self.featured and 'wp-post-image' in a.get('class', '').split():
            if a.get('src'):  # WordPress featured image: last-resort fallback for pages without og:image
                self.featured.append(a['src'])
        elif tag == 'iframe':
            src = a.get('src') or a.get('data-src') or a.get('data-lazy-src')
            if src and VIDEO_IFRAME.search(src):
                self.iframes.append(src)
        elif tag in ('amp-youtube', 'lite-youtube'):
            vid = a.get('data-videoid') or a.get('videoid')
            if vid:
                self.amp_youtube.append(vid)
        elif tag == 'video':
            self._video_depth += 1
            src = a.get('src') or a.get('data-src')
            if src:
                self.video_tags.append([src, a.get('type', '')])
        elif tag == 'source' and self._video_depth and a.get('src'):
            self.video_tags.append([a['src'], a.get('type', '')])
        elif tag == 'script' and 'ld+json' in a.get('type', '').lower():
            self._ld = []

    def handle_endtag(self, tag):
        if tag == 'video' and self._video_depth:
            self._video_depth -= 1
        elif tag == 'script' and self._ld is not None:
            self.ld_json.append(''.join(self._ld))
            self._ld = None

    def handle_data(self, data):
        if self._ld is not None:
            self._ld.append(data)


def as_list(value):
    if value is None:
        return []
    return value if isinstance(value, list) else [value]


def ld_videos(blocks):
    """VideoObject entries from JSON-LD blocks, as {embedUrl, contentUrl, thumbnailUrl, ...} lists."""
    found = []

    def walk(node):
        if isinstance(node, list):
            for item in node:
                walk(item)
        elif isinstance(node, dict):
            if 'VideoObject' in as_list(node.get('@type')):
                video = {}
                for key in ('embedUrl', 'contentUrl', 'thumbnailUrl', 'encodingFormat', 'name'):
                    values = []
                    for value in as_list(node.get(key)):
                        if isinstance(value, dict):
                            value = value.get('url') or value.get('contentUrl')
                        if isinstance(value, str) and value.strip():
                            values.append(value.strip())
                    if values:
                        video[key] = values
                if video:
                    found.append(video)
            for value in node.values():
                if isinstance(value, (dict, list)):
                    walk(value)

    for block in blocks:
        try:
            walk(json.loads(block.strip().rstrip(';'), strict=False))
        except (json.JSONDecodeError, RecursionError):
            continue
    return found


def decode_html(body, headers):
    match = re.search(r'charset=["\']?([\w-]+)', headers.get('content-type', ''), re.I)
    charset = match.group(1) if match else None
    if not charset:
        match = re.search(rb'<meta[^>]+charset=["\']?([\w-]+)', body[:4096], re.I)
        charset = match.group(1).decode('ascii') if match else 'utf-8'
    try:
        return body.decode(charset, errors='replace')
    except LookupError:
        return body.decode('utf-8', errors='replace')


def parse_page(text):
    parser = PageParser()
    error = None
    try:
        parser.feed(text)
        parser.close()
    except Exception as err:  # html.parser is lenient; keep whatever was collected
        error = f'{type(err).__name__}: {err}'
    found = {'meta': parser.meta, 'imageSrc': parser.image_src, 'iframes': parser.iframes,
             'videoTags': parser.video_tags, 'ldVideos': ld_videos(parser.ld_json),
             'ampYoutube': parser.amp_youtube, 'featuredImage': parser.featured}
    found = {k: v for k, v in found.items() if v}
    has_media = any(k in found for k in ('imageSrc', 'iframes', 'videoTags', 'ldVideos', 'featuredImage')) or any(
        k.startswith(('og:image', 'twitter:image', 'og:video', 'twitter:player')) for k in parser.meta)
    return found, has_media, parser.canonical, error


def fetch_page(url):
    res = fetch(url, PAGE_ACCEPT, PAGE_LIMIT)
    record = {'status': res['status'], 'finalUrl': res['finalUrl'],
              'fetched': datetime.now(timezone.utc).strftime('%Y-%m-%d')}
    if res.get('insecureTls'):
        record['insecureTls'] = True
    status, ctype = res['status'], res['headers'].get('content-type', '').lower()
    if status is None:
        return {**record, 'outcome': 'failed', 'error': res['error']}
    if status in BLOCK_STATUSES:
        return {**record, 'outcome': 'blocked', 'error': f'HTTP {status}'}
    if status != 200:
        return {**record, 'outcome': 'failed', 'error': f'HTTP {status}'}
    if ctype and 'html' not in ctype and 'xml' not in ctype:
        return {**record, 'outcome': 'failed', 'error': f'not HTML: {ctype}'}
    text = decode_html(res['body'], res['headers'])
    found, has_media, canonical, error = parse_page(text)
    if error:
        record['parseError'] = error
    if not has_media and any(marker in text[:20000].lower() for marker in BLOCK_MARKERS):
        return {**record, 'outcome': 'blocked', 'error': 'bot challenge page'}
    canonical = clean_url(canonical, res['finalUrl'], upgrade=False) if canonical else None
    if not has_media and canonical and not same_page(canonical, res['finalUrl']):
        # e.g. AMP pages without metadata: read the canonical article once instead.
        alt = fetch(canonical, PAGE_ACCEPT, PAGE_LIMIT)
        if alt['status'] == 200 and alt['body']:
            alt_found, alt_media, _, _ = parse_page(decode_html(alt['body'], alt['headers']))
            if alt_media:
                record['mediaPage'] = alt['finalUrl']
                found = alt_found
    return {**record, 'outcome': 'ok', 'found': found}


# ---------------------------------------------------------------- candidates

def clean_url(value, base, upgrade=True):
    """Absolute, percent-encoded https URL (http upgraded when `upgrade`), or None."""
    if not value:
        return None
    value = value.strip()
    if re.search(r'&(?:amp|quot|#\d+|#x[0-9a-f]+);', value, re.I):
        value = html.unescape(value)  # double-escaped content attributes
    if value.startswith('//'):
        value = 'https:' + value
    value = urljoin(base, value)
    parts = urlsplit(value)
    if parts.scheme not in ('http', 'https') or not parts.hostname:
        return None
    scheme = 'https' if upgrade else parts.scheme
    try:
        host = parts.hostname.encode('idna').decode('ascii')
    except UnicodeError:
        return None
    netloc = host + (f':{parts.port}' if parts.port else '')
    safe = "/:@!$&'()*+,;=%~-._"
    path = quote(parts.path or '/', safe=safe)
    query = quote(parts.query, safe=safe + '?')
    url = urlunsplit((scheme, netloc, path, query, ''))
    return url if url.startswith('https://') else None


def site_of(url):
    host = (urlsplit(url).hostname or '').lower()
    labels = host.split('.')
    keep = 3 if '.'.join(labels[-2:]) in TWO_LEVEL_SUFFIXES else 2
    return '.'.join(labels[-keep:])


def host_of(url):
    host = (urlsplit(url).hostname or '').lower()
    return host[4:] if host.startswith('www.') else host


def same_page(a, b):
    norm = lambda u: (u or '').split('#')[0].rstrip('/').replace('http://', 'https://', 1)
    return norm(a) == norm(b)


def to_int(value):
    try:
        number = int(float(value))
    except (TypeError, ValueError):
        return None
    return number if number > 0 else None


def classify_video(raw, base, type_hint, origin, page_urls):
    if not raw:
        return None
    raw = html.unescape(raw.strip())
    match = YOUTUBE.search(raw)
    if match:
        return {'kind': 'youtube', 'id': match.group(1)}
    match = VIMEO.search(raw)
    if match:
        return {'kind': 'vimeo', 'id': match.group(1)}
    url = clean_url(raw, base, upgrade=False)
    if not url or any(same_page(url, page) for page in page_urls):
        return None
    kind_hint = (type_hint or '').lower().split(';')[0].strip()
    path = urlsplit(url).path.lower()
    if kind_hint in ('video/mp4', 'video/webm') or path.endswith(('.mp4', '.webm')):
        guessed = 'video/webm' if path.endswith('.webm') else 'video/mp4'
        return {'kind': 'file', 'url': url,
                'type': kind_hint if kind_hint.startswith('video/') else guessed}
    if FACEBOOK_VIDEO.match(url):
        return {'kind': 'embed', 'url': url}
    if origin == 'twitter' or origin == 'ld-embed' or (origin == 'og' and kind_hint == 'text/html'):
        return {'kind': 'embed', 'url': url}
    return None


def video_key(video):
    return f"{video['kind']}:{video.get('id') or video.get('url')}"


def page_candidates(record):
    """Ordered, de-duplicated image and video candidates from one cached page record."""
    found = record.get('found', {})
    base = record.get('mediaPage') or record.get('finalUrl') or record['url']
    page_urls = (record['url'], record.get('finalUrl'), base)
    if urlsplit(record['url']).path in ('', '/'):
        return [], []  # a site's front page is not an article; its media are site furniture
    meta = found.get('meta', {})
    first = lambda key: (meta.get(key) or [''])[0]
    og_alt, tw_alt = first('og:image:alt'), first('twitter:image:alt')
    og_size = {'width': to_int(first('og:image:width')), 'height': to_int(first('og:image:height'))}

    raw_images = [(u, og_alt, og_size) for key in ('og:image:secure_url', 'og:image', 'og:image:url')
                  for u in meta.get(key, [])]
    raw_images += [(u, tw_alt or og_alt, {}) for key in ('twitter:image', 'twitter:image:src')
                   for u in meta.get(key, [])]
    raw_images += [(u, og_alt, {}) for u in found.get('imageSrc', [])]
    raw_images += [(u, '', {}) for video in found.get('ldVideos', []) for u in video.get('thumbnailUrl', [])]
    raw_images += [(u, '', {}) for u in found.get('featuredImage', [])]
    images, seen = [], set()
    for raw, alt, size in raw_images:
        url = clean_url(raw, base)
        if url and url not in seen:
            seen.add(url)
            images.append({'url': url, 'alt': (alt or '').strip(), **{k: v for k, v in size.items() if v}})

    og_type = first('og:video:type')
    raw_videos = [(u, og_type, 'og') for key in ('og:video:secure_url', 'og:video', 'og:video:url')
                  for u in meta.get(key, [])]
    for video in found.get('ldVideos', []):
        raw_videos += [(u, '', 'ld-embed') for u in video.get('embedUrl', [])]
        fmt = (video.get('encodingFormat') or [''])[0]
        raw_videos += [(u, fmt if '/' in fmt else '', 'ld-content') for u in video.get('contentUrl', [])]
    raw_videos += [(u, 'text/html', 'twitter') for u in meta.get('twitter:player', [])]
    raw_videos += [(f'https://www.youtube.com/embed/{vid}', '', 'amp') for vid in found.get('ampYoutube', [])]
    raw_videos += [(u, '', 'iframe') for u in found.get('iframes', [])]
    raw_videos += [(src, kind, 'video-tag') for src, kind in found.get('videoTags', [])]
    videos, seen = [], set()
    for raw, kind, origin in raw_videos:
        video = classify_video(raw, base, kind, origin, page_urls)
        if video and video_key(video) not in seen:
            seen.add(video_key(video))
            if origin in ('amp', 'iframe') and video['kind'] != 'file':
                video['inBody'] = True  # not declared in metadata: must pass the relevance check
            videos.append(video)
    return images, videos


def generic_reason(url):
    parts = urlsplit(url)
    if parts.hostname == 'i.ytimg.com':
        return None
    if any(pattern in unquote(url) for pattern in REVIEWED_GENERIC):
        return 'generic-reviewed'
    names = [parts.path.rsplit('/', 1)[-1]]
    names += re.findall(r'[\w./-]+\.(?:jpe?g|png|gif|webp|svg)', parts.query, re.I)  # e.g. ?src=logo.png
    if any(GENERIC_NAME.search(n) for n in names) or GENERIC_DIR.search(parts.path):
        return 'generic-name'
    if parts.path.lower().endswith(('.svg', '.ico')):
        return 'generic-name'
    return None


def youtube_thumb(video_id):
    return f'https://i.ytimg.com/vi/{video_id}/hqdefault.jpg'


# ---------------------------------------------------------------- verification

def image_size(data):
    try:
        if data[:8] == b'\x89PNG\r\n\x1a\n' and data[12:16] == b'IHDR':
            return struct.unpack('>II', data[16:24])
        if data[:6] in (b'GIF87a', b'GIF89a'):
            return struct.unpack('<HH', data[6:10])
        if data[:4] == b'RIFF' and data[8:12] == b'WEBP':
            chunk = data[12:16]
            if chunk == b'VP8 ':
                w, h = struct.unpack('<HH', data[26:30])
                return w & 0x3FFF, h & 0x3FFF
            if chunk == b'VP8L':
                bits = int.from_bytes(data[21:25], 'little')
                return (bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1
            if chunk == b'VP8X':
                return int.from_bytes(data[24:27], 'little') + 1, int.from_bytes(data[27:30], 'little') + 1
        if data[:2] == b'\xff\xd8':
            i = 2
            while i + 9 < len(data):
                if data[i] != 0xFF:
                    i += 1
                    continue
                marker = data[i + 1]
                if marker == 0xFF or marker == 0x01 or 0xD0 <= marker <= 0xD8:
                    i += 1 if marker == 0xFF else 2
                    continue
                if 0xC0 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC):
                    h, w = struct.unpack('>HH', data[i + 5:i + 9])
                    return w, h
                i += 2 + struct.unpack('>H', data[i + 2:i + 4])[0]
    except struct.error:
        pass
    return None


def sniff_image(data):
    if data[:2] == b'\xff\xd8':
        return 'image/jpeg'
    if data[:8] == b'\x89PNG\r\n\x1a\n':
        return 'image/png'
    if data[:4] == b'RIFF' and data[8:12] == b'WEBP':
        return 'image/webp'
    if data[:6] in (b'GIF87a', b'GIF89a'):
        return 'image/gif'
    if data[4:12] in (b'ftypavif', b'ftypavis'):
        return 'image/avif'
    return None


def verify_image(url):
    res = fetch(url, IMAGE_ACCEPT, IMAGE_LIMIT, encodings='identity')
    body, ctype = res['body'], res['headers'].get('content-type', '').lower().split(';')[0].strip()
    out = {'status': res['status'], 'contentType': ctype, 'bytes': len(body)}
    if res['finalUrl'] != url:
        out['finalUrl'] = res['finalUrl']
    if res.get('insecureTls'):
        out['insecureTls'] = True
    size = image_size(body)
    if size:
        out['width'], out['height'] = size
    if body:
        out['sha1'] = hashlib.sha1(body).hexdigest()
    sniffed = sniff_image(body)
    if res['status'] != 200:
        reason = f"HTTP {res['status']}" if res['status'] else (res['error'] or 'error')
    elif not ctype.startswith('image/'):
        reason = f'content-type {ctype or "missing"}'
    elif ctype in ('image/svg+xml', 'image/x-icon', 'image/vnd.microsoft.icon'):
        reason = f'content-type {ctype}'
    elif not sniffed:
        reason = 'not a raster image'
    elif len(body) < MIN_IMAGE_BYTES:
        reason = 'tiny (<5 KB)'
    elif size and size[0] < MIN_IMAGE_WIDTH:
        reason = f'narrow ({size[0]} px)'
    elif out.get('finalUrl') and generic_reason(out['finalUrl']):
        reason = 'redirects to generic image'
    else:
        reason = None
    out['ok'] = reason is None
    if reason:
        out['reason'] = reason
    return out


def verify_youtube(video_id):
    watch = f'https://www.youtube.com/watch?v={video_id}'
    res = fetch(f'https://www.youtube.com/oembed?url={quote(watch, safe="")}&format=json',
                'application/json', 256 * 1024)
    out = {'status': res['status'], 'ok': res['status'] == 200}
    if out['ok']:
        try:
            info = json.loads(res['body'].decode('utf-8'))
            out['title'], out['author'] = info.get('title', ''), info.get('author_name', '')
            out['relevant'] = bool(DRONE_TERMS.search(out['title']))
        except (ValueError, UnicodeDecodeError):
            out.update(ok=False, reason='bad oEmbed JSON')
    else:
        out['reason'] = f"oEmbed HTTP {res['status']}" if res['status'] else res['error']
    return out


def verify_vimeo(video_id):
    watch = f'https://vimeo.com/{video_id}'
    res = fetch(f'https://vimeo.com/api/oembed.json?url={quote(watch, safe="")}',
                'application/json', 256 * 1024)
    out = {'status': res['status'], 'ok': res['status'] == 200}
    if out['ok']:
        try:
            out['title'] = json.loads(res['body'].decode('utf-8')).get('title', '')
            out['relevant'] = bool(DRONE_TERMS.search(out['title']))
        except (ValueError, UnicodeDecodeError):
            out.update(ok=False, reason='bad oEmbed JSON')
    else:
        out['reason'] = f"oEmbed HTTP {res['status']}" if res['status'] else res['error']
    return out


def verify_file(url):
    res = fetch(url, '*/*', 4096, headers={'Range': 'bytes=0-2047'}, encodings='identity')
    ctype = res['headers'].get('content-type', '').lower().split(';')[0].strip()
    ok = res['status'] in (200, 206) and ctype.startswith('video/')
    out = {'status': res['status'], 'contentType': ctype, 'ok': ok}
    if not ok:
        out['reason'] = res['error'] or f"HTTP {res['status']} {ctype}"
    return out


def verify_embed(url):
    res = fetch(url, PAGE_ACCEPT, 512 * 1024)
    headers = res['headers']
    xfo = headers.get('x-frame-options', '').lower()
    ancestors = re.search(r'frame-ancestors([^;]*)', headers.get('content-security-policy', ''), re.I)
    out = {'status': res['status'], 'finalUrl': res['finalUrl']}
    visible = re.sub(r'<(script|style)\b.*?</\1>|<[^>]+>', ' ', decode_html(res['body'], headers), flags=re.S | re.I)
    out['relevant'] = bool(DRONE_TERMS.search(html.unescape(visible)))
    if res['status'] != 200:
        reason = f"HTTP {res['status']}" if res['status'] else res['error']
    elif not res['finalUrl'].startswith('https://'):
        reason = 'redirects off https'
    elif xfo and ('deny' in xfo or 'sameorigin' in xfo):
        reason = f'X-Frame-Options {xfo}'
    elif ancestors and '*' not in ancestors.group(1).split():
        reason = 'CSP frame-ancestors' + ancestors.group(1)
    else:
        reason = None
    out['ok'] = reason is None
    if reason:
        out['reason'] = reason
    return out


def verify(key):
    kind, _, value = key.partition(':')
    return {'image': verify_image, 'youtube': verify_youtube, 'vimeo': verify_vimeo,
            'file': verify_file, 'embed': verify_embed}[kind](value)


# ---------------------------------------------------------------- selection

def select_media(pages, assets):
    """Choose one image and one video per page. Returns (media by URL, stats)."""
    cands = {url: page_candidates(rec) for url, rec in pages.items() if rec.get('outcome') == 'ok'}
    image_pages, hash_pages, video_pages = defaultdict(set), defaultdict(set), defaultdict(set)
    for url, (images, videos) in cands.items():
        site = site_of(url)
        for image in images:
            image_pages[site, image['url']].add(url)
            digest = assets.get('image:' + image['url'], {}).get('sha1')
            if digest:
                hash_pages[site, digest].add(url)
        for video in videos:
            video_pages[site, video_key(video)].add(url)

    stats = {'rejectedUrls': defaultdict(set), 'missing': set()}
    chosen = {}
    for url, (images, videos) in sorted(cands.items()):
        site = site_of(url)
        image = video = None
        for cand in images:
            asset = assets.get('image:' + cand['url'])
            reason = generic_reason(cand['url'])
            if not reason and len(image_pages[site, cand['url']]) > 1:
                reason = 'generic-repeated'
            if not reason and asset and len(hash_pages[site, asset.get('sha1')]) > 1:
                reason = 'generic-repeated'
            if not reason and not asset:
                stats['missing'].add('image:' + cand['url'])
                continue
            if not reason and not asset['ok']:
                reason = asset['reason']
            if reason:
                stats['rejectedUrls'][reason].add(cand['url'])
            elif image is None:
                image = {'image': cand['url']}
                if cand['alt']:
                    image['alt'] = cand['alt']
                # Dimensions decoded from the image beat the page's og:image:width/height.
                source = asset if asset.get('width') else cand
                width, height = source.get('width'), source.get('height')
                if width and height:
                    image.update(width=width, height=height)
        for cand in videos:
            key = video_key(cand)
            asset = assets.get(key)
            if len(video_pages[site, key]) > 1:
                stats['rejectedUrls']['video-repeated'].add(key)
                continue
            if not asset:
                stats['missing'].add(key)
                continue
            if not asset['ok']:
                stats['rejectedUrls']['video: ' + asset['reason']].add(key)
                continue
            if cand.get('inBody') and not asset.get('relevant'):
                stats['rejectedUrls']['video-off-topic'].add(key)
                continue
            video = {k: v for k, v in cand.items() if k != 'inBody'}
            if asset.get('title'):
                video['title'] = asset['title']
            break
        if image is None and video and video['kind'] == 'youtube':
            thumb = youtube_thumb(video['id'])
            asset = assets.get('image:' + thumb)
            if asset and asset['ok']:
                image = {'image': thumb}
                if asset.get('width') and asset.get('height'):
                    image.update(width=asset['width'], height=asset['height'])
            elif not asset:
                stats['missing'].add('image:' + thumb)
        entry = {**(image or {}), **({'video': video} if video else {})}
        if entry:
            chosen[url] = entry
    return chosen, stats


def needed_assets(record):
    """Asset keys worth verifying for one page (static filters already applied)."""
    images, videos = page_candidates(record)
    keys = ['image:' + c['url'] for c in images if not generic_reason(c['url'])]
    keys += [video_key(v) for v in videos]
    keys += ['image:' + youtube_thumb(v['id']) for v in videos if v['kind'] == 'youtube']
    return keys


# ---------------------------------------------------------------- extra

def load_extra(event_ids):
    if not EXTRA.exists():
        return {}, ['media-extra.json not present; no curated additions merged']
    try:
        raw = json.loads(EXTRA.read_text(encoding='utf-8'))
    except (OSError, json.JSONDecodeError) as err:
        return {}, [f'media-extra.json unreadable ({err}); no curated additions merged']
    if not isinstance(raw, dict):
        return {}, ['media-extra.json is not an object; ignored']
    https = lambda v: isinstance(v, str) and v.startswith('https://')
    extra, notes = {}, []
    for event_id, items in raw.items():
        if event_id not in event_ids:
            notes.append(f'extra: unknown event {event_id!r} dropped')
            continue
        kept = []
        for item in as_list(items):
            video = item.get('video') if isinstance(item, dict) else None
            video = video if isinstance(video, dict) else {}
            if not isinstance(item, dict) or not https(item.get('url')):
                problem = 'url not https'
            elif item.get('image') and not https(item['image']):
                problem = 'image not https'
            elif video.get('url') and not https(video['url']):
                problem = 'video url not https'
            elif video.get('kind') == 'youtube' and not YOUTUBE_ID.match(str(video.get('id', ''))):
                problem = 'bad youtube id'
            else:
                problem = None
            if problem:
                notes.append(f'extra: {event_id} entry dropped ({problem})')
            else:
                kept.append(item)
        if kept:
            extra[event_id] = kept
    return extra, notes


# ---------------------------------------------------------------- main

def load_data():
    text = DATA.read_text(encoding='utf-8')
    prefix = 'window.DRONE_DATA = '
    if not text.startswith(prefix):
        sys.exit(f'{DATA} does not start with {prefix!r}')
    return json.loads(text[len(prefix):].rstrip().rstrip(';'))


def run_pool(func, items, workers, label):
    items = list(items)
    results = {}
    if not items:
        return results
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for done, (item, result) in enumerate(zip(items, pool.map(func, items)), 1):
            results[item] = result
            print(f'  {label} {done}/{len(items)}', end='\r', file=sys.stderr, flush=True)
    print(file=sys.stderr)
    return results


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--offline', action='store_true', help='rebuild dist/media.js from the cache only')
    ap.add_argument('--only', help='comma-separated source or event IDs to refetch (others come from the cache)')
    ap.add_argument('--workers', type=int, default=MAX_WORKERS, help=f'concurrent requests (max {MAX_WORKERS})')
    args = ap.parse_args()
    if args.offline and args.only:
        ap.error('--only refetches pages; it cannot be combined with --offline')
    workers = max(1, min(args.workers, MAX_WORKERS))

    data = load_data()
    events, sources = data['events'], data['sources']
    event_ids = {e['id'] for e in events}
    url_ids = defaultdict(list)
    for sid in sorted({sid for e in events for sid in e.get('sources', []) if sid in sources}):
        url_ids[sources[sid]['url']].append(sid)

    cache = json.loads(CACHE.read_text(encoding='utf-8')) if CACHE.exists() else {}
    pages, assets = cache.get('pages', {}), cache.get('assets', {})
    if args.offline and not pages:
        sys.exit(f'--offline needs {CACHE.relative_to(ROOT)}; run without --offline first')

    targets = set(url_ids)
    if args.only:
        targets = set()
        for token in filter(None, (t.strip() for t in args.only.split(','))):
            if token in sources:
                targets.add(sources[token]['url'])
            elif token in event_ids:
                event = next(e for e in events if e['id'] == token)
                targets.update(sources[s]['url'] for s in event.get('sources', []) if s in sources)
            else:
                ap.error(f'unknown source or event ID: {token}')
        targets &= set(url_ids)

    if not args.offline:
        print(f'Fetching {len(targets)} source pages with {workers} workers...', file=sys.stderr)
        for url, record in run_pool(fetch_page, sorted(targets), workers, 'pages').items():
            pages[url] = record
    pages = {url: {**pages[url], 'url': url, 'sources': ids} for url, ids in url_ids.items() if url in pages}

    if not args.offline:
        wanted = {}
        for url, record in pages.items():
            if record.get('outcome') == 'ok':
                for key in needed_assets(record):
                    wanted[key] = wanted.get(key, False) or url in targets
        todo = sorted(k for k, fresh in wanted.items() if fresh or k not in assets)
        print(f'Verifying {len(todo)} media assets...', file=sys.stderr)
        assets.update(run_pool(verify, todo, workers, 'assets'))

    chosen, stats = select_media(pages, assets)
    live_keys = {k for rec in pages.values() if rec.get('outcome') == 'ok' for k in needed_assets(rec)}
    assets = {k: v for k, v in assets.items() if k in live_keys}
    if not args.offline:
        CACHE.write_text(json.dumps({'pages': pages, 'assets': assets}, ensure_ascii=False,
                                    indent=2, sort_keys=True) + '\n', encoding='utf-8')

    media_sources = {sid: entry for url, entry in chosen.items() for sid in url_ids[url]}
    extra, notes = load_extra(event_ids)
    OUT.write_text('window.DRONE_MEDIA = ' + json.dumps(
        {'sources': media_sources, 'extra': extra}, ensure_ascii=False, indent=2, sort_keys=True) + ';\n',
        encoding='utf-8')

    # ------------------------------------------------------------ summary
    by_domain = defaultdict(Counter)
    for url, record in pages.items():
        by_domain[host_of(url)][record.get('outcome', 'missing')] += 1
    for url in url_ids:
        if url not in pages:
            by_domain[host_of(url)]['not cached'] += 1
    outcomes = Counter(o for counts in by_domain.values() for o in counts.elements())
    print(f"\nPages: {outcomes['ok']} ok, {outcomes['blocked']} blocked, {outcomes['failed']} failed"
          + (f", {outcomes['not cached']} not cached" if outcomes['not cached'] else '')
          + f' ({len(url_ids)} referenced source URLs)')
    print(f"  {'domain':32} {'ok':>3} {'blk':>4} {'fail':>4}")
    for host in sorted(by_domain, key=lambda h: (-sum(by_domain[h].values()), h)):
        c = by_domain[host]
        print(f"  {host:32} {c['ok']:>3} {c['blocked']:>4} {c['failed'] + c['not cached']:>4}")
    failures = [(sorted(rec['sources']), rec.get('error', '')) for rec in pages.values()
                if rec.get('outcome') != 'ok']
    for ids, error in sorted(failures):
        print(f"    {','.join(ids)}: {error}")

    images = sum('image' in e for e in media_sources.values())
    thumbs = sum(e.get('image', '').startswith('https://i.ytimg.com/') for e in media_sources.values())
    video_kinds = Counter(e['video']['kind'] for e in media_sources.values() if 'video' in e)
    print(f'\nSources with media: {len(media_sources)} (images {images}, of which YouTube thumbnails {thumbs}; '
          f'videos {sum(video_kinds.values())}: '
          + (', '.join(f'{k} {n}' for k, n in sorted(video_kinds.items())) or 'none') + ')')
    generic = {r: len(stats['rejectedUrls'][r]) for r in ('generic-name', 'generic-repeated', 'generic-reviewed')}
    print(f"Rejected as generic (unique image URLs): name/path {generic['generic-name']}, "
          f"repeated on one site {generic['generic-repeated']}, visual review {generic['generic-reviewed']}")
    other = {r: len(u) for r, u in stats['rejectedUrls'].items() if r not in generic}
    if other:
        print('Rejected at verification: ' + ', '.join(f'{r} {n}' for r, n in sorted(other.items())))
    if stats['missing']:
        print(f"Unverified candidates skipped (not in cache): {len(stats['missing'])}")

    def events_with(test):
        hit = {e['id'] for e in events if any(test(media_sources.get(s, {})) for s in e.get('sources', []))}
        hit |= {eid for eid, items in extra.items() if any(test(i) for i in items if isinstance(i, dict))}
        return hit
    with_image, with_video = events_with(lambda m: bool(m.get('image'))), events_with(lambda m: bool(m.get('video')))
    print(f'Events with >=1 image: {len(with_image)}/{len(events)}; with >=1 video: {len(with_video)}/{len(events)}')
    print(f'Curated extra: {sum(len(v) for v in extra.values())} items for {len(extra)} events')
    for note in notes:
        print('  ' + note)
    print(f'Wrote {OUT.relative_to(ROOT)}' + ('' if args.offline else f' and {CACHE.relative_to(ROOT)}'))


if __name__ == '__main__':
    main()
