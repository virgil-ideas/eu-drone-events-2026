"""Export reviewed and fallback editorial summaries (headline, description, summary paragraphs)
from drone-map/data/pages.json + events.json into drone-map-revamp/pages-data.js so the
interactive map and feed can display full headlines and TL;DR summaries immediately.
"""
import json
import sys
from pathlib import Path

REVAMP_DIR = Path(__file__).resolve().parent
DRONE_MAP_DIR = REVAMP_DIR.parent / 'drone-map'
sys.path.insert(0, str(DRONE_MAP_DIR / 'scripts'))

from database import load_database  # noqa: E402
from pages import copy_for, load_pages  # noqa: E402


def main():
    data_dir = DRONE_MAP_DIR / 'data'
    database = load_database(data_dir, DRONE_MAP_DIR.parent)
    pages = load_pages(data_dir, database)
    exported = {}
    for record in database['events']:
        headline, description, summary = copy_for(record, pages, database['sources'])
        exported[record['id']] = {
            'headline': headline,
            'description': description,
            'summary': summary,
        }
    out_path = REVAMP_DIR / 'pages-data.js'
    out_path.write_text(
        'window.DRONE_PAGES = ' + json.dumps(exported, ensure_ascii=False, indent=2) + ';\n',
        encoding='utf-8',
    )
    print(f'Wrote {len(exported)} editorial summaries to {out_path}')


if __name__ == '__main__':
    main()
