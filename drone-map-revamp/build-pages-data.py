"""Export reviewed and fallback editorial summaries (headline, description, summary paragraphs)
from drone-map/data/pages.json + events.json into drone-map-revamp/pages-data.js, and sync
generated static assets from drone-map/dist/ into drone-map-revamp/.
"""
import argparse
import json
import sys
from pathlib import Path

REVAMP_DIR = Path(__file__).resolve().parent
DRONE_MAP_DIR = REVAMP_DIR.parent / 'drone-map'
sys.path.insert(0, str(DRONE_MAP_DIR / 'scripts'))

from database import DataError, load_database, mapped_events  # noqa: E402
from pages import copy_for, load_pages  # noqa: E402

SHARED_ASSETS = ('events.js', 'sitemap.xml', 'robots.txt', 'page.css', 'media.js', 'trend-data.js', 'landmark.js')


def sync_assets(source, destination, check=False, research_files=()):
    names = (*SHARED_ASSETS, *(item['name'] for item in research_files))
    expected = {Path(name): (source / name).read_bytes() for name in names}
    event_files = list((source / 'events').rglob('*.html'))
    if not event_files:
        raise DataError('Canonical event pages are missing. Build drone-map first.')
    expected.update({path.relative_to(source): path.read_bytes() for path in event_files})
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
    research_files = load_database(DRONE_MAP_DIR / 'data', DRONE_MAP_DIR.parent)['dataset']['researchFiles']
    out_path = REVAMP_DIR / 'pages-data.js'

    if args.check:
        if not out_path.exists() or out_path.read_text(encoding='utf-8') != content:
            raise DataError('drone-map-revamp/pages-data.js is stale. Run python3 drone-map-revamp/build-pages-data.py')
        sync_assets(DRONE_MAP_DIR / 'dist', REVAMP_DIR, check=True, research_files=research_files)
        print(f'Verified {count} editorial summaries and all copied data assets and event pages.')
        return

    out_path.write_text(content, encoding='utf-8')
    sync_assets(DRONE_MAP_DIR / 'dist', REVAMP_DIR, research_files=research_files)
    print(f'Wrote {count} compact editorial summaries to {out_path} and synced dist assets.')


if __name__ == '__main__':
    main()
