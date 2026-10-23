"""Export reviewed and fallback editorial summaries (headline, description, summary paragraphs)
from drone-map/data/pages.json + events.json into drone-map-revamp/pages-data.js, and sync
generated static assets from drone-map/dist/ into drone-map-revamp/.
"""
import argparse
import json
import shutil
import sys
from pathlib import Path

REVAMP_DIR = Path(__file__).resolve().parent
DRONE_MAP_DIR = REVAMP_DIR.parent / 'drone-map'
sys.path.insert(0, str(DRONE_MAP_DIR / 'scripts'))

from database import DataError, load_database, mapped_events  # noqa: E402
from pages import copy_for, load_pages  # noqa: E402


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
    parser.add_argument('--check', action='store_true', help='Verify pages-data.js is up to date without writing.')
    args = parser.parse_args()

    content, count = render_pages_data()
    out_path = REVAMP_DIR / 'pages-data.js'

    if args.check:
        if not out_path.exists() or out_path.read_text(encoding='utf-8') != content:
            raise DataError('drone-map-revamp/pages-data.js is stale. Run python3 drone-map-revamp/build-pages-data.py')
        print(f'Verified {count} editorial summaries in {out_path}')
        return

    out_path.write_text(content, encoding='utf-8')
    dist_dir = DRONE_MAP_DIR / 'dist'
    for filename in ('events.js', 'sitemap.xml', 'media.js', 'trend-data.js', 'landmark.js'):
        src = dist_dir / filename
        if src.exists():
            shutil.copy2(src, REVAMP_DIR / filename)
    events_src = dist_dir / 'events'
    events_dst = REVAMP_DIR / 'events'
    if events_src.is_dir():
        if events_dst.exists():
            shutil.rmtree(events_dst)
        shutil.copytree(events_src, events_dst)
    print(f'Wrote {count} compact editorial summaries to {out_path} and synced dist assets.')


if __name__ == '__main__':
    main()
