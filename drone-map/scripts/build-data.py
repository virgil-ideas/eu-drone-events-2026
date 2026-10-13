"""Validate the canonical JSON database and build (or check) static map data and pages."""
import argparse
from pathlib import Path

from database import DataError, load_database, render_events
from pages import automatic_ids, load_pages, page_slugs, read_media, render_site

ROOT = Path(__file__).resolve().parents[1]
# Directories whose every file is generated, so files no longer produced are removed.
GENERATED_DIRS = ('events',)


def build(data_dir=ROOT / 'data', output_dir=ROOT / 'dist', research_root=ROOT.parent,
          check=False):
    database = load_database(data_dir, research_root)
    pages = load_pages(data_dir, database)
    slugs = page_slugs(database, pages)
    # Read and validate every input before touching any published file.
    outputs = {'events.js': render_events(database, slugs).encode('utf-8')}
    outputs.update({item['name']: (research_root / item['name']).read_bytes()
                    for item in database['dataset']['researchFiles']})
    outputs.update(render_site(database, pages, slugs, read_media(output_dir / 'media.js')))
    stale = [name for name, content in outputs.items()
             if not (output_dir / name).exists() or (output_dir / name).read_bytes() != content]
    orphans = sorted(path for folder in GENERATED_DIRS if (output_dir / folder).is_dir()
                     for path in (output_dir / folder).rglob('*')
                     if path.is_file() and path.relative_to(output_dir).as_posix() not in outputs)
    if check:
        if stale or orphans:
            names = stale + [path.relative_to(output_dir).as_posix() + ' (no longer generated)' for path in orphans]
            raise DataError(f'{len(names)} generated files are stale: ' + ', '.join(names[:6])
                            + (', …' if len(names) > 6 else '')
                            + '. Run python3 drone-map/scripts/build-data.py')
    else:
        output_dir.mkdir(parents=True, exist_ok=True)
        for name in stale:
            destination = output_dir / name
            destination.parent.mkdir(parents=True, exist_ok=True)
            temporary = destination.with_name(destination.name + '.tmp')
            temporary.write_bytes(outputs[name])
            temporary.replace(destination)
        for path in orphans:
            path.unlink()
        for folder in GENERATED_DIRS:
            for directory in sorted((output_dir / folder).rglob('*'), reverse=True):
                if directory.is_dir() and not any(directory.iterdir()):
                    directory.rmdir()
    return database, automatic_ids(database, pages)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='fail on stale output without writing files')
    args = parser.parse_args()
    try:
        database, automatic = build(check=args.check)
    except (DataError, OSError) as error:
        parser.exit(1, f'Data error: {error}\n')
    print(f"{'Checked' if args.check else 'Built'} {len(database['events'])} dated records, "
          f"{len(database['contexts'])} context records, {len(database['sources'])} sources "
          f"and {len(database['events'])} event pages.")
    if automatic:
        listed = ', '.join(automatic[:8]) + (', …' if len(automatic) > 8 else '')
        print(f"{len(automatic)} event pages use automatic copy until their summary is reviewed "
              f"({listed}). List them with python3 drone-map/scripts/pages.py")


if __name__ == '__main__':
    main()
