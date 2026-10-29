"""Export reviewed and fallback editorial summaries (headline, description, summary paragraphs)
from drone-map/data/pages.json + events.json into drone-map-revamp/pages-data.js, and sync
generated static assets from drone-map/dist/ into drone-map-revamp/.
"""
import argparse
import hashlib
import html
import json
import re
import sys
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

REVAMP_DIR = Path(__file__).resolve().parent
DRONE_MAP_DIR = REVAMP_DIR.parent / 'drone-map'
sys.path.insert(0, str(DRONE_MAP_DIR / 'scripts'))

from database import DataError, load_database, mapped_events  # noqa: E402
from pages import copy_for, load_pages  # noqa: E402
import translations  # noqa: E402

SHARED_ASSETS = ('events.js', 'sitemap.xml', 'robots.txt', 'page.css', 'media.js', 'trend-data.js', 'landmark.js')
DATA_ASSETS = ('events.js', 'pages-data.js', 'media.js')
ASSET_LINK = re.compile(r'\b(?:src|href)=(?P<quote>["\'])(?P<url>[^"\']+)(?P=quote)')
# The social preview card (og/card.html) is drawn from these files and rendered
# to the home and neutral overview PNGs when the site deploys.
OG_IMAGE = re.compile(r'(?P<url>https://droneincidents\.eu/og-(?:image|overview)\.png)(?:\?v=[0-9a-f]*)?')
OG_INPUTS = ('events.js', 'pages-data.js', 'trend-data.js', 'geo-outline.js', 'i18n/en.js',
             'og/card.html', 'og/card.js', 'og/fonts.js')


def social_image_version(directory, pending_assets=None):
    """Hash the data being published, including canonical assets not yet copied."""
    pending_assets = pending_assets or {}
    digest = hashlib.sha256()
    for name in OG_INPUTS:
        content = pending_assets.get(Path(name))
        if content is None:
            content = (directory / name).read_bytes()
        digest.update(name.encode() + b'\0' + content)
    return digest.hexdigest()[:16]


def version_social_images(markup, version):
    return OG_IMAGE.sub(lambda match: f"{match['url']}?v={version}", markup)


def refresh_asset_versions(directory, check=False):
    """Content versions for the page and lazily loaded data/languages, never dates."""
    index = directory / 'index.html'
    markup = index.read_text(encoding='utf-8')

    def local_asset(value):
        parsed = urlsplit(html.unescape(value))
        if parsed.scheme or parsed.netloc or not parsed.path.endswith(('.js', '.css')):
            return None
        return parsed

    names = set(DATA_ASSETS)
    names.update(path.relative_to(directory).as_posix() for path in (directory / 'i18n').rglob('*.js'))
    names.update(parsed.path for match in ASSET_LINK.finditer(markup)
                 if (parsed := local_asset(match['url'])))
    assets = {name: hashlib.sha256((directory / name).read_bytes()).hexdigest()[:16]
              for name in sorted(names)}

    def versioned(match):
        parsed = local_asset(match['url'])
        if not parsed:
            return match[0]
        query = [(key, value) for key, value in parse_qsl(parsed.query, keep_blank_values=True) if key != 'v']
        query.append(('v', assets[parsed.path]))
        target = html.escape(urlunsplit(parsed._replace(query=urlencode(query))), quote=True)
        return match[0].replace(match['url'], target, 1)

    page = ASSET_LINK.sub(versioned, markup)
    if OG_IMAGE.search(page):
        # Social sites cache previews by URL, so the image URL changes whenever
        # anything the card shows changes.
        page = version_social_images(page, social_image_version(directory))

    outputs = {
        'index.html': page,
        'asset-manifest.json': json.dumps({'schemaVersion': 1, 'assets': assets}, indent=2) + '\n',
    }
    stale = [name for name, text in outputs.items()
             if not (directory / name).is_file() or (directory / name).read_text(encoding='utf-8') != text]
    if check:
        if stale:
            raise DataError('Asset versions are stale: ' + ', '.join(stale)
                            + '. Run python3 drone-map/scripts/build-data.py')
        return
    for name in stale:
        (directory / name).write_text(outputs[name], encoding='utf-8')


def sync_assets(source, destination, check=False, research_files=()):
    names = (*SHARED_ASSETS, *(item['name'] for item in research_files))
    expected = {Path(name): (source / name).read_bytes() for name in names}
    event_files = list((source / 'events').rglob('*.html'))
    if not event_files:
        raise DataError('Canonical event pages are missing. Build drone-map first.')
    expected.update({path.relative_to(source): path.read_bytes() for path in event_files})
    image_pages = {path: data.decode('utf-8') for path, data in expected.items()
                   if path.suffix == '.html' and OG_IMAGE.search(data.decode('utf-8'))}
    if image_pages:
        version = social_image_version(destination, pending_assets=expected)
        expected.update({path: version_social_images(markup, version).encode('utf-8')
                         for path, markup in image_pages.items()})
    extras = {path.relative_to(destination) for path in (destination / 'events').rglob('*.html')} - expected.keys()
    if check:
        stale = [str(path) for path, data in expected.items()
                 if not (destination / path).is_file() or (destination / path).read_bytes() != data]
        if stale or extras:
            raise DataError('Revamp assets are stale: ' + ', '.join(sorted(stale + [str(path) for path in extras])))
        return
    for path in extras:
        (destination / path).unlink()
    for path, data in expected.items():
        target = destination / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)


def render_pages_data(data_dir=DRONE_MAP_DIR / 'data', research_root=DRONE_MAP_DIR.parent):
    database = load_database(data_dir, research_root)
    pages = load_pages(data_dir, database)
    exported = {}
    for record in mapped_events(database):
        headline, description, summary = copy_for(record, pages, database['sources'])
        exported[record['id']] = {
            'headline': headline,
            'description': description,
            'summary': summary,
        }
    return 'window.DRONE_PAGES = ' + json.dumps(exported, ensure_ascii=False, separators=(',', ':')) + ';\n', len(exported)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='Verify editorial summaries and every copied data asset and event page without writing.')
    args = parser.parse_args()

    content, count = render_pages_data()
    english = translations.english_copy()
    pages_dir = REVAMP_DIR / 'i18n' / 'pages'
    translated = {pages_dir / f'{code}.js': translations.render(code, english) for code in translations.LANGUAGES}
    research_files = load_database(DRONE_MAP_DIR / 'data', DRONE_MAP_DIR.parent)['dataset']['researchFiles']
    out_path = REVAMP_DIR / 'pages-data.js'

    if args.check:
        if not out_path.exists() or out_path.read_text(encoding='utf-8') != content:
            raise DataError('drone-map-revamp/pages-data.js is stale. Run python3 drone-map-revamp/build-pages-data.py')
        stale = [path.name for path, text in translated.items() if not path.is_file() or path.read_text(encoding='utf-8') != text]
        if stale:
            raise DataError('Translated record copy is stale: i18n/pages/' + ', '.join(stale) + '. Run python3 drone-map-revamp/build-pages-data.py')
        sync_assets(DRONE_MAP_DIR / 'dist', REVAMP_DIR, check=True, research_files=research_files)
        refresh_asset_versions(REVAMP_DIR, check=True)
        print(f'Verified {count} editorial summaries and all copied data assets and event pages.')
        return

    out_path.write_text(content, encoding='utf-8')
    pages_dir.mkdir(exist_ok=True)
    for path, text in translated.items():
        path.write_text(text, encoding='utf-8')
    sync_assets(DRONE_MAP_DIR / 'dist', REVAMP_DIR, research_files=research_files)
    refresh_asset_versions(REVAMP_DIR)
    print(f'Wrote {count} compact editorial summaries to {out_path} and synced dist assets.')


if __name__ == '__main__':
    main()
