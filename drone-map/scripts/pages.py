"""Crawlable static pages: one per mapped event, an index of all events, and the sitemap.

Editorial copy for each page (URL slug, headline, search description and summary)
lives in data/pages.json, keyed by event ID. Each entry stores a `basis` hash of the
record facts it was written from. When those facts change, the page keeps its URL but
falls back to copy assembled from the record itself, so a page never contradicts its
own record. After reviewing or rewriting the copy, stamp it with:

    python3 drone-map/scripts/pages.py accept E006 [E021 ...]

Run without arguments to list pages that use automatic copy.
Uses only the Python standard library.
"""
import hashlib
import html
import json
import re
import sys
import unicodedata
from datetime import date
from pathlib import Path

from database import ROOT, DataError, mapped_events, read_json

SITE = 'https://droneincidents.eu'
SITE_NAME = 'Europe Foreign Drone Events'
# Hash all facts, including future fields and cited source metadata. Merely recording
# when a record was reviewed does not change the facts its copy was written from.
BASIS_METADATA = {'reviewedOn'}
PAGE_FIELDS = {'slug', 'headline', 'description', 'summary', 'basis'}
SLUG = re.compile(r'\d{4}-\d{2}-\d{2}(-[a-z0-9]+)+')
MONTHS = ('January February March April May June July August September October '
          'November December').split()
# Labels and colours match the map (app.js and i18n/en.js).
CATEGORIES = {
    'flight': ('Flight', '#3278c5', 'Drone flight'),
    'shotdown': ('Shot down', '#7b4ab5', 'Drone shot down'),
    'engaged': ('Military engagement', '#7b4ab5', 'Military engagement with a drone'),
    'crash': ('Crash', '#f0700f', 'Drone crash'),
    'strike': ('Strike', '#d3201c', 'Reported drone strike'),
    'explosion': ('Explosion', '#d3201c', 'Drone explosion'),
    'disposal': ('Controlled disposal', '#3a6a72', 'Drone disposal'),
    'recovery': ('Recovery', '#e8c400', 'Drone recovery'),
    'alert': ('Alert / other', '#7c8697', 'Drone alert'),
}
FIELDS = [('dateLabel', 'Reported date'), ('recordType', 'Record type'),
          ('endDate', 'End date / linked stage'), ('dateBasis', 'Date basis'),
          ('location', 'Location / jurisdiction'), ('categories', 'Event categories'),
          ('circumstances', 'What was reported'), ('vehicle', 'Aircraft / vessel / quantity'),
          ('attribution', 'Origin / operator / attribution'),
          ('impact', 'Damage / casualties / disruption'), ('response', 'Response / outcome'),
          ('uncertainty', 'Investigation / uncertainty'), ('route', 'Route / entry mechanism'),
          ('payload', 'Explosive payload'), ('deduplication', 'Counting / links'),
          ('provenance', 'Research provenance')]
BRAND_ICON = ('<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="11"/>'
              '<circle cx="16" cy="16" r="5"/><path d="M16 1v8m0 14v8M1 16h8m14 0h8"/></svg>')
FAVICON = ("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E"
           "%3Crect width='32' height='32' rx='7' fill='%23152b32'/%3E%3Ccircle cx='16' cy='16' r='10' "
           "fill='none' stroke='%23a2c9c5'/%3E%3Cpath d='M16 3v26M3 16h26' stroke='%23a2c9c5'/%3E"
           "%3Ccircle cx='16' cy='16' r='4' fill='%23ed754f'/%3E%3C/svg%3E")
FONTS = ('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700'
         '&family=Manrope:wght@600;650;700&display=swap')


def basis(record, sources):
    facts = {'record': {key: value for key, value in record.items() if key not in BASIS_METADATA},
             'sources': {ref: sources[ref] for ref in record['sources']}}
    text = json.dumps(facts, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(text.encode('utf-8')).hexdigest()[:16]


def validate_pages(pages, database):
    events = {record['id'] for record in database['events']}
    if not isinstance(pages, dict):
        raise DataError('pages.json: expected an object keyed by event ID')
    slugs = set()
    for event_id, page in pages.items():
        path = f'pages.json[{event_id}]'
        if event_id not in events:
            raise DataError(f'{path}: no mapped event has this ID')
        if not isinstance(page, dict) or page.keys() != PAGE_FIELDS:
            raise DataError(f'{path}: expected exactly the fields {sorted(PAGE_FIELDS)}')
        for key in ('slug', 'headline', 'description', 'basis'):
            if not isinstance(page[key], str) or not page[key].strip():
                raise DataError(f'{path}.{key}: expected a non-empty string')
        summary = page['summary']
        if not isinstance(summary, list) or not summary or not all(
                isinstance(paragraph, str) and paragraph.strip() for paragraph in summary):
            raise DataError(f'{path}.summary: expected a non-empty array of paragraphs')
        if not SLUG.fullmatch(page['slug']) or len(page['slug']) > 100:
            raise DataError(f'{path}.slug: expected YYYY-MM-DD-lowercase-words, at most 100 characters')
        if page['slug'] in slugs:
            raise DataError(f'{path}.slug: duplicate slug {page["slug"]}')
        slugs.add(page['slug'])
        if not re.fullmatch(r'[0-9a-f]{16}', page['basis']):
            raise DataError(f'{path}.basis: expected a 16-character hash')
    return pages


def load_pages(data_dir, database):
    path = Path(data_dir) / 'pages.json'
    return validate_pages(read_json(path), database) if path.exists() else {}


def load_page_urls(data_dir):
    """Published URLs are independent of editorial copy; retain retired reservations."""
    path = Path(data_dir) / 'page-urls.json'
    urls = read_json(path) if path.exists() else {}
    if not isinstance(urls, dict):
        raise DataError('page-urls.json: expected an object keyed by event ID')
    used = set()
    for event_id, slug in urls.items():
        if not re.fullmatch(r'[EN]\d{3}', event_id):
            raise DataError(f'page-urls.json[{event_id}]: invalid event ID')
        if not isinstance(slug, str) or not SLUG.fullmatch(slug) or len(slug) > 100:
            raise DataError(f'page-urls.json[{event_id}]: invalid slug')
        if slug in used:
            raise DataError(f'page-urls.json[{event_id}]: duplicate slug {slug}')
        used.add(slug)
    return urls


def read_media(path):
    """Preview images the media fetcher saved in dist/media.js, if present."""
    path = Path(path)
    if not path.exists():
        return {'sources': {}, 'extra': {}}
    text = path.read_text(encoding='utf-8').strip()
    prefix = 'window.DRONE_MEDIA = '
    if not text.startswith(prefix):
        raise DataError(f'{path.name}: unexpected format')
    return json.loads(text[len(prefix):].rstrip(';'))


def slugify(text):
    text = text.translate(str.maketrans({'ł': 'l', 'Ł': 'L', 'ø': 'o', 'Ø': 'O', 'đ': 'd', 'Đ': 'D',
                                         'ħ': 'h', 'Ħ': 'H', 'ß': 'ss', 'æ': 'ae', 'Æ': 'AE'}))
    text = unicodedata.normalize('NFKD', text).encode('ascii', 'ignore').decode('ascii')
    return re.sub(r'[^a-z0-9]+', '-', text.lower()).strip('-')


def countries(record):
    return [re.sub(r' \(.+\)', '', name).strip() for name in record['countries'].split(';')]


def page_slugs(database, pages, published):
    """Keep published URLs; derive a readable slug only on a record's first build."""
    slugs = dict(published)
    for event_id, page in pages.items():
        if event_id in published and page['slug'] != published[event_id]:
            raise DataError(f'pages.json[{event_id}].slug: published URL is fixed at '
                            f'{published[event_id]}; keep that slug when reviewing copy')
        slugs[event_id] = page['slug']
    if len(set(slugs.values())) != len(slugs):
        raise DataError('pages.json: slug already reserved in page-urls.json')
    used = set(slugs.values())
    for record in sorted(database['events'], key=lambda item: (item['startDate'], item['id'])):
        if record['id'] in slugs:
            continue
        words = slugify(f"{record['title']} {countries(record)[0]}").split('-')
        base = '-'.join([record['startDate'], *words[:8]])[:100].rstrip('-')
        slug, number = base, 2
        while slug in used:
            suffix = f'-{number}'
            slug, number = f'{base[:100 - len(suffix)].rstrip("-")}{suffix}', number + 1
        slugs[record['id']] = slug
        used.add(slug)
    return {record['id']: slugs[record['id']] for record in database['events']}


def automatic_ids(database, pages):
    """Events whose page uses copy assembled from the record instead of reviewed copy."""
    return [record['id'] for record in database['events']
            if record['id'] not in pages or pages[record['id']]['basis'] != basis(record, database['sources'])]


def long_date(value):
    day = date.fromisoformat(value)
    return f'{day.day} {MONTHS[day.month - 1]} {day.year}'


def sentence(text):
    text = text.strip()
    return text if text.endswith(('.', '!', '?', '…')) else text + '.'


def shorten(text, limit):
    if len(text) <= limit:
        return text
    return text[:limit - 1].rsplit(' ', 1)[0].rstrip(' ,;:—–-') + '…'


def copy_for(record, pages, sources):
    """Headline, description and summary paragraphs for one event page."""
    page = pages.get(record['id'])
    if page and page['basis'] == basis(record, sources):
        return page['headline'], page['description'], page['summary']
    place = ', '.join(dict.fromkeys(countries(record)))
    phrase = {'candidate': 'Unidentified object', 'excluded': 'Excluded record'}.get(
        record['recordClass'], CATEGORIES[record['category']][2])
    headline = f"{phrase}: {record['title']}, {place}"
    description = shorten(f"{long_date(record['startDate'])}, {record['title']}, {place}. "
                          f"{sentence(record['status'])} {record['circumstances']}", 160)
    summary = [sentence(record['circumstances']), ' '.join(
        sentence(text) for text in (record['status'], record['attribution'], record['uncertainty']) if text)]
    return headline, description, summary


def esc(value):
    return html.escape(str(value), quote=True)


def json_ld(value):
    # Escaped so record text can never end or confuse the surrounding script element.
    text = json.dumps(value, ensure_ascii=False, separators=(',', ':'))
    return text.replace('<', '\\u003c').replace('>', '\\u003e').replace('&', '\\u0026')


def breadcrumbs(*items):
    return {'@context': 'https://schema.org', '@type': 'BreadcrumbList', 'itemListElement': [
        {'@type': 'ListItem', 'position': index, 'name': name, 'item': url}
        for index, (name, url) in enumerate(items, 1)]}


def document(*, title, description, canonical, root, body, structured, og_type='article'):
    return f'''<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#152b32">
  <title>{esc(title)}</title>
  <meta name="description" content="{esc(description)}">
  <link rel="canonical" href="{esc(canonical)}">
  <meta property="og:type" content="{og_type}">
  <meta property="og:site_name" content="{SITE_NAME}">
  <meta property="og:title" content="{esc(title)}">
  <meta property="og:description" content="{esc(description)}">
  <meta property="og:url" content="{esc(canonical)}">
  <meta property="og:image" content="{SITE}/og-image.png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="icon" type="image/svg+xml" href="{FAVICON}">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="{esc(FONTS)}">
  <link rel="stylesheet" href="{root}page.css">
  <script type="application/ld+json">{json_ld(structured)}</script>
  <script defer src="{root}analytics.js"></script>
</head>
<body>
  <header class="topbar"><a class="brand" href="{root}">{BRAND_ICON}<span>EUROPE <span class="brand-light">/ FOREIGN DRONE EVENTS</span></span></a><nav class="topnav" aria-label="Site"><a href="{root}events/">All records</a><a class="topnav-map" href="{root}">Interactive map</a></nav></header>
{body}
  <footer class="page-foot"><p>A research register, not a confirmed attack count. Records are not confirmed attacks or unique drones, positions are approximate, and attribution stays as strong as the cited sources.</p><p><a href="{root}">Interactive map</a> · <a href="{root}events/">All records</a> · <a href="{root}eu_foreign_drone_events_2026_consolidated.md">Original research register</a> · Map data © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a></p></footer>
</body>
</html>
'''


def media_for(record, database, media, limit=3):
    """Preview images to try in order: cited reports first, then additional coverage."""
    sources = database['sources']
    items = [{**media['sources'][ref], 'url': sources[ref]['url'], 'publisher': sources[ref]['publisher'],
              'alt': f"Image from the {sources[ref]['publisher']} report: {sources[ref]['title']}"}
             for ref in record['sources'] if ref in media.get('sources', {})]
    items += [{**item, 'extra': True} for item in media.get('extra', {}).get(record['id'], [])]
    usable = [item for item in items
              if str(item.get('image', '')).startswith('https://') and str(item.get('url', '')).startswith('https://')]
    return list({item['image']: item for item in reversed(usable)}.values())[::-1][:limit]


def media_html(items):
    # Only the first figure shows (page.css); a figure whose image fails removes itself.
    return ''.join(figure_html(item) for item in items)


def figure_html(item):
    size = (f' width="{int(item["width"])}" height="{int(item["height"])}"'
            if isinstance(item.get('width'), int) and isinstance(item.get('height'), int) else '')
    kind = 'Video' if item.get('video') else 'Image'
    extra = '<small>Additional coverage, not one of the register’s sources.</small>' if item.get('extra') else ''
    return (f'<figure class="media"><a href="{esc(item["url"])}" rel="noopener noreferrer">'
            f'<img src="{esc(item["image"])}" alt="{esc(item.get("alt", ""))}"{size} loading="lazy" '
            f'decoding="async" referrerpolicy="no-referrer" onerror="this.closest(\'figure\').remove()"></a>'
            f'<figcaption>{kind} · {esc(item["publisher"])} · <a href="{esc(item["url"])}" '
            f'rel="noopener noreferrer">Open report ↗</a>{extra}</figcaption></figure>')


def record_link(record, slugs, headline, root='../'):
    return f'<a href="{root}{slugs[record["id"]]}/">{esc(headline)}</a>'


def source_item(source):
    published = f'<small>{esc(source["dateLabel"])}</small>' if source.get('dateLabel') else ''
    return (f'<li><a href="{esc(source["url"])}" rel="noopener noreferrer"><strong>{esc(source["publisher"])} ↗</strong>'
            f'<span>{esc(source["title"])}</span></a>{published}</li>')


def event_page(record, index, ordered, database, pages, slugs, media):
    root = '../../'
    headline, description, summary = copy_for(record, pages, database['sources'])
    label, color, _ = CATEGORIES[record['category']]
    excluded = record['recordClass'] == 'excluded'
    kind = {'candidate': 'Unidentified object · ', 'excluded': 'Excluded record · '}.get(record['recordClass'], '')
    exclusion = ''
    map_action = (f'<p class="map-cta"><a class="button" href="{root}#{slugs[record["id"]]}">'
                  'Show on the interactive map →</a></p>')
    if excluded:
        color = '#7c8797'
        exclusion = (f'\n      <p class="note"><strong>Excluded from the map and totals.</strong> '
                     f'{esc(record["exclusionReason"])} This page preserves the correction and its sources.</p>')
        map_action = '<p class="map-cta"><a class="button" href="../">Browse the current register →</a></p>'
    place = ', '.join(dict.fromkeys(countries(record)))
    when = long_date(record['startDate'])
    dates = f'<time datetime="{record["startDate"]}">{when}</time>'
    if record.get('endDate', record['startDate']) != record['startDate']:
        dates += f' – <time datetime="{record["endDate"]}">{long_date(record["endDate"])}</time>'
    paragraphs = ''.join(f'<p>{esc(paragraph)}</p>' for paragraph in summary)
    stages = ''.join(f'<span style="--category:{CATEGORIES[stage][1]}"><i aria-hidden="true"></i>'
                     f'{esc(CATEGORIES[stage][0])}</span>' for stage in record['stages'])
    sources = ''.join(source_item(database['sources'][ref]) for ref in record['sources'])
    fields = ''.join(f'<dt>{esc(name)}</dt><dd>{esc(record[key])}</dd>' for key, name in FIELDS if record.get(key))
    notes = [record['classificationNote'], record.get('positionNote', ''),
             'Map positions are approximate anchors for the named place, not verified incident coordinates.']
    notes = ''.join(f'<p class="note">{esc(note)}</p>' for note in notes if note)
    reviewed = f' · reviewed {long_date(record["reviewedOn"])}' if record.get('reviewedOn') else ''
    attribution = esc(record['attribution'] or 'Not stated in the record.')
    uncertainty = esc(record['uncertainty'] or 'Not stated in the record.')
    figure = media_html(media_for(record, database, media))
    pager = ''
    neighbours = () if index is None else (
        ('prev', ordered[index - 1] if index else None),
        ('next', ordered[index + 1] if index + 1 < len(ordered) else None))
    for rel, neighbour in neighbours:
        if neighbour:
            arrow = '← Earlier' if rel == 'prev' else 'Later →'
            pager += (f'<a rel="{rel}" class="pager-{rel}" href="../{slugs[neighbour["id"]]}/"><small>{arrow} · '
                      f'{long_date(neighbour["startDate"])}</small><span>{esc(copy_for(neighbour, pages, database["sources"])[0])}</span></a>')
    country = countries(record)[0]
    distance = lambda other: abs((date.fromisoformat(other['startDate']) - date.fromisoformat(record['startDate'])).days)
    nearby = sorted((other for other in ordered if other['id'] != record['id'] and country in countries(other)),
                    key=lambda other: (distance(other), other['id']))[:6]
    related = ''.join(
        f'<li><time datetime="{other["startDate"]}">{long_date(other["startDate"])}</time>'
        f'{record_link(other, slugs, copy_for(other, pages, database["sources"])[0])}</li>'
        for other in sorted(nearby, key=lambda other: (other['startDate'], other['id']), reverse=True))
    if related:
        related = (f'<section class="related" aria-labelledby="related-title"><h2 id="related-title">'
                   f'Nearby records from {esc(country)}</h2><ul class="record-index">{related}</ul></section>')
    canonical = f'{SITE}/events/{slugs[record["id"]]}/'
    body = f"""  <main class="page">
    <nav class="crumbs" aria-label="Breadcrumb"><a href="{root}">Map</a><span aria-hidden="true">/</span><a href="../">All records</a><span aria-hidden="true">/</span><span>{when}</span></nav>
    <article class="event" style="--category:{color}">
      <header class="event-head">
        <p class="eyebrow"><i aria-hidden="true"></i>{esc(kind)}{esc(label)} · {esc(place)}</p>
        <h1>{esc(headline)}</h1>
        <p class="dateline">{dates} · {esc(record['title'])}</p>
        <p class="status">{esc(record['status'])}</p>
      </header>{exclusion}
      <div class="summary">{paragraphs}</div>
      {map_action}
{('      ' + figure) if figure else ''}
      <section class="attribution" aria-labelledby="attribution-title">
        <h2 id="attribution-title">Attribution and uncertainty</h2>
        <dl><dt>Origin / operator / attribution</dt><dd>{attribution}</dd><dt>Investigation / uncertainty</dt><dd>{uncertainty}</dd></dl>
      </section>
      <section class="sources" aria-labelledby="sources-title">
        <h2 id="sources-title">Sources · {len(record['sources'])}</h2>
        <ol>{sources}</ol>
      </section>
      <section class="record" aria-labelledby="record-title">
        <h2 id="record-title">Full record</h2>
        <div class="stages" aria-label="Reported outcome stages">{stages}</div>
        {notes}
        <dl>{fields}</dl>
        <p class="record-id">Record {record['id']}{reviewed}. Record fields keep the register’s original wording.</p>
      </section>
    </article>
    <nav class="pager" aria-label="Neighbouring records">{pager}</nav>
    {related}
  </main>"""
    structured = breadcrumbs(('Map', f'{SITE}/'), ('All records', f'{SITE}/events/'), (headline, canonical))
    return document(title=f'{headline} · {SITE_NAME}', description=description, canonical=canonical,
                    root=root, body=body, structured=structured)


def index_item(record, pages, slugs, sources):
    day = date.fromisoformat(record['startDate'])
    kind = 'Unidentified object' if record['recordClass'] == 'candidate' else CATEGORIES[record['category']][0]
    place = ', '.join(dict.fromkeys(countries(record)))
    return (f'<li style="--category:{CATEGORIES[record["category"]][1]}"><time datetime="{record["startDate"]}">'
            f'{day.day} {MONTHS[day.month - 1][:3]}</time>{record_link(record, slugs, copy_for(record, pages, sources)[0], root="")}'
            f'<span>{esc(place)} · {esc(kind)}</span></li>')


def index_page(database, pages, slugs):
    ordered = sorted(mapped_events(database), key=lambda record: (record['startDate'], record['id']), reverse=True)
    cutoff = long_date(database['dataset']['cutoff'])
    tally, months = {}, {}
    for record in ordered:
        for country in dict.fromkeys(countries(record)):
            tally[country] = tally.get(country, 0) + 1
        months.setdefault(record['startDate'][:7], []).append(record)
    sections = ''
    for month, records in months.items():
        year, number = month.split('-')
        items = ''.join(index_item(record, pages, slugs, database['sources']) for record in records)
        sections += (f'<section><h2>{MONTHS[int(number) - 1]} {year} <small>{len(records)}</small></h2>'
                     f'<ul class="record-index">{items}</ul></section>')
    country_list = ''.join(f'<li><strong>{count}</strong> {esc(name)}</li>'
                           for name, count in sorted(tally.items(), key=lambda item: (-item[1], item[0])))
    total = len(ordered)
    description = (f'All {total} records of drones that reached EU countries from abroad in 2026, newest first: '
                   f'incursions, shoot-downs, crashes, strikes and wreckage in {len(tally)} countries.')
    body = f"""  <main class="page">
    <nav class="crumbs" aria-label="Breadcrumb"><a href="../">Map</a><span aria-hidden="true">/</span><span>All records</span></nav>
    <header class="index-head">
      <p class="eyebrow">THE EVENT REGISTER · 1 JANUARY – {cutoff.upper()}</p>
      <h1>Foreign drone incidents in the EU, 2026</h1>
      <p class="lede">{total} records of drones that reached EU countries from abroad: incursions, shoot-downs, crashes, strikes and wreckage, including drones whose operator is unknown. Each record has its own page with a summary, the attribution as reported and its sources. Ordinary drone sightings, like most airport disruptions, are not included.</p>
      <p class="map-cta"><a class="button" href="../">Open the interactive map →</a></p>
      <ul class="country-tally" aria-label="Records per country">{country_list}</ul>
    </header>
    {sections}
  </main>"""
    structured = breadcrumbs(('Map', f'{SITE}/'), ('All records', f'{SITE}/events/'))
    return document(title=f'Foreign drone incidents in the EU, 2026: all {total} records · {SITE_NAME}',
                    description=description, canonical=f'{SITE}/events/', root='../', body=body,
                    structured=structured, og_type='website')


def sitemap(database, slugs):
    cutoff = database['dataset']['cutoff']
    entries = [(f'{SITE}/', cutoff), (f'{SITE}/events/', cutoff)]
    entries += [(f'{SITE}/events/{slugs[record["id"]]}/', record.get('reviewedOn'))
                for record in sorted(database['events'], key=lambda item: (item['startDate'], item['id']))]
    urls = ''.join(f'  <url><loc>{esc(url)}</loc>' + (f'<lastmod>{modified}</lastmod>' if modified else '') + '</url>\n'
                   for url, modified in entries)
    return f'<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n{urls}</urlset>\n'


def render_site(database, pages, slugs, media):
    """Every generated page, keyed by its path inside dist/."""
    ordered = sorted(mapped_events(database), key=lambda record: (record['startDate'], record['id']))
    indexes = {record['id']: index for index, record in enumerate(ordered)}
    outputs = {f'events/{slugs[record["id"]]}/index.html': event_page(
                   record, indexes.get(record['id']), ordered, database, pages, slugs, media)
               for record in database['events']}
    outputs['events/index.html'] = index_page(database, pages, slugs)
    outputs['sitemap.xml'] = sitemap(database, slugs)
    outputs['robots.txt'] = f'User-agent: *\nAllow: /\n\nSitemap: {SITE}/sitemap.xml\n'
    return {path: text.encode('utf-8') for path, text in outputs.items()}


def accept(event_ids, data_dir=ROOT / 'data'):
    """Mark reviewed copy as matching the current record facts."""
    from database import load_database
    database = load_database(data_dir)
    pages = load_pages(data_dir, database)
    records = {record['id']: record for record in database['events']}
    for event_id in event_ids:
        if event_id not in pages:
            raise DataError(f'{event_id}: no reviewed copy in pages.json to accept')
        pages[event_id]['basis'] = basis(records[event_id], database['sources'])
    path = Path(data_dir) / 'pages.json'
    path.write_text(json.dumps(pages, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def main(arguments):
    from database import load_database
    try:
        if arguments[:1] == ['accept'] and arguments[1:]:
            accept(arguments[1:])
            print(f'Accepted reviewed copy for {", ".join(arguments[1:])}. Rebuild with build-data.py.')
            return
        if arguments:
            raise SystemExit('Usage: pages.py [accept EVENT_ID ...]')
        database = load_database()
        pages = load_pages(ROOT / 'data', database)
        pending = automatic_ids(database, pages)
        records = {record['id']: record for record in database['events']}
        for event_id in pending:
            reason = 'changed since its copy was reviewed' if event_id in pages else 'no reviewed copy yet'
            print(f'{event_id}  {records[event_id]["startDate"]}  {records[event_id]["title"]}: {reason}')
        print(f'{len(pending)} of {len(records)} event pages use automatic copy.')
    except (DataError, OSError) as error:
        raise SystemExit(f'Data error: {error}')


if __name__ == '__main__':
    main(sys.argv[1:])
