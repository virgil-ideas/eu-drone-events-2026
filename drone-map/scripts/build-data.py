"""Validate the canonical JSON database and build (or check) static map data."""
import argparse
from pathlib import Path

from database import DataError, load_database, render_events

ROOT = Path(__file__).resolve().parents[1]


def build(data_dir=ROOT / 'data', output_dir=ROOT / 'dist', research_root=ROOT.parent,
          check=False):
    database = load_database(data_dir, research_root)
    # Read and validate every input before touching any published file.
    outputs = {'events.js': render_events(database).encode('utf-8')}
    outputs.update({item['name']: (research_root / item['name']).read_bytes()
                    for item in database['dataset']['researchFiles']})
    stale = [name for name, content in outputs.items()
             if not (output_dir / name).exists() or (output_dir / name).read_bytes() != content]
    if check:
        if stale:
            raise DataError('Generated files are stale: ' + ', '.join(stale)
                            + '. Run python3 drone-map/scripts/build-data.py')
    else:
        output_dir.mkdir(parents=True, exist_ok=True)
        for name in stale:
            destination = output_dir / name
            temporary = destination.with_name(destination.name + '.tmp')
            temporary.write_bytes(outputs[name])
            temporary.replace(destination)
    return database


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='fail on stale output without writing files')
    args = parser.parse_args()
    try:
        database = build(check=args.check)
    except (DataError, OSError) as error:
        parser.exit(1, f'Data error: {error}\n')
    print(f"{'Checked' if args.check else 'Built'} {len(database['events'])} dated records, "
          f"{len(database['contexts'])} context records and {len(database['sources'])} sources.")


if __name__ == '__main__':
    main()
