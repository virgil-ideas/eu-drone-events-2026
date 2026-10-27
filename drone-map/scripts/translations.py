#!/usr/bin/env python3
"""Translated record copy: each record's headline, TL;DR description and summary
paragraphs in the other 23 official EU languages.

data/translations/<lang>.json maps a record ID to its translation and the basis,
a hash of the English copy it was made from. When the English copy changes the
basis no longer matches, the map falls back to English for that record, and
`todo` lists it again.

Usage:
  python3 drone-map/scripts/translations.py status
  python3 drone-map/scripts/translations.py todo LANG [--out FILE]
  python3 drone-map/scripts/translations.py merge LANG PART.json [PART.json ...]
  python3 drone-map/scripts/translations.py stamp LANG
  python3 drone-map/scripts/translations.py check
"""
import argparse
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))

from database import DataError, load_database, mapped_events  # noqa: E402
from pages import copy_for, load_pages  # noqa: E402

DATA_DIR = ROOT / 'data'
TRANSLATIONS_DIR = DATA_DIR / 'translations'
LANGUAGES = tuple('bg cs da de el es et fi fr ga hr hu it lt lv mt nl pl pt ro sk sl sv'.split())
FIELDS = ('headline', 'description', 'summary')


def english_copy(data_dir=DATA_DIR, research_root=ROOT.parent):
    """The English copy the map shows for every mapped record, by ID."""
    database = load_database(data_dir, research_root)
    pages = load_pages(data_dir, database)
    copy = {}
    for record in mapped_events(database):
        headline, description, summary = copy_for(record, pages, database['sources'])
        copy[record['id']] = {'headline': headline, 'description': description, 'summary': list(summary)}
    return copy


def basis(copy):
    text = json.dumps([copy['headline'], copy['description'], copy['summary']], ensure_ascii=False)
    return hashlib.sha256(text.encode('utf-8')).hexdigest()[:16]


def path_for(lang, directory=TRANSLATIONS_DIR):
    return directory / f'{lang}.json'


def load(lang, directory=TRANSLATIONS_DIR):
    path = path_for(lang, directory)
    if not path.is_file():
        return {}
    data = json.loads(path.read_text(encoding='utf-8'))
    if not isinstance(data, dict):
        raise DataError(f'{path.name}: expected an object keyed by record ID')
    return data


def save(lang, data, directory=TRANSLATIONS_DIR):
    directory.mkdir(parents=True, exist_ok=True)
    ordered = {key: data[key] for key in sorted(data)}
    path_for(lang, directory).write_text(json.dumps(ordered, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def problems(lang, data, english):
    """Structural problems in one language file. Stale entries are not problems."""
    found = []
    for record_id, entry in data.items():
        where = f'{lang}.json {record_id}'
        if record_id not in english:
            found.append(f'{where}: no such mapped record')
            continue
        if not isinstance(entry, dict) or set(entry) - {*FIELDS, 'basis'}:
            found.append(f'{where}: expected only {", ".join(FIELDS)} and basis')
            continue
        for field in ('headline', 'description'):
            if not isinstance(entry.get(field), str) or not entry[field].strip():
                found.append(f'{where}: {field} must be non-empty text')
        summary = entry.get('summary')
        if not isinstance(summary, list) or not all(isinstance(p, str) and p.strip() for p in summary):
            found.append(f'{where}: summary must be a list of non-empty paragraphs')
        elif len(summary) != len(english[record_id]['summary']):
            found.append(f'{where}: {len(summary)} summary paragraphs, English has {len(english[record_id]["summary"])}')
        if 'basis' in entry and (not isinstance(entry['basis'], str) or len(entry['basis']) != 16):
            found.append(f'{where}: basis must be 16 hex characters')
    return found


def fresh(lang, english, directory=TRANSLATIONS_DIR):
    """Translations whose basis matches the current English copy."""
    current = {record_id: basis(copy) for record_id, copy in english.items()}
    return {record_id: {field: entry[field] for field in FIELDS}
            for record_id, entry in sorted(load(lang, directory).items())
            if current.get(record_id) and entry.get('basis') == current[record_id]}


def render(lang, english, directory=TRANSLATIONS_DIR):
    """The browser file for one language: only translations of the current English."""
    payload = json.dumps(fresh(lang, english, directory), ensure_ascii=False, separators=(',', ':'))
    return ('window.DRONE_PAGES_I18N = window.DRONE_PAGES_I18N || {};\n'
            f'window.DRONE_PAGES_I18N[{json.dumps(lang)}] = {payload};\n')


def main(arguments=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest='command', required=True)
    commands.add_parser('status', help='Count fresh, stale and missing translations per language.')
    todo = commands.add_parser('todo', help='Write the English copy still to translate for LANG.')
    todo.add_argument('lang', choices=LANGUAGES)
    todo.add_argument('--out', type=Path, help='Write to this file instead of standard output.')
    merge = commands.add_parser('merge', help='Add translated parts to LANG and stamp them against the current English.')
    merge.add_argument('lang', choices=LANGUAGES)
    merge.add_argument('parts', nargs='+', type=Path)
    stamp = commands.add_parser('stamp', help='Mark unstamped entries in LANG as translations of the current English.')
    stamp.add_argument('lang', choices=LANGUAGES)
    commands.add_parser('check', help='Validate every translation file.')
    args = parser.parse_args(arguments)
    english = english_copy()
    current = {record_id: basis(copy) for record_id, copy in english.items()}

    if args.command == 'status':
        for lang in LANGUAGES:
            data = load(lang)
            ok = sum(1 for record_id, entry in data.items() if entry.get('basis') == current.get(record_id))
            stale = sum(1 for record_id, entry in data.items() if record_id in current and entry.get('basis') != current[record_id])
            print(f'{lang}: {ok} current, {stale} stale, {len(current) - ok - stale} missing')
        return

    if args.command == 'todo':
        data = load(args.lang)
        pending = {record_id: copy for record_id, copy in english.items()
                   if data.get(record_id, {}).get('basis') != current[record_id]}
        text = json.dumps(pending, ensure_ascii=False, indent=2) + '\n'
        if args.out:
            args.out.write_text(text, encoding='utf-8')
            print(f'{len(pending)} records to translate written to {args.out}')
        else:
            sys.stdout.write(text)
        return

    if args.command == 'merge':
        data = load(args.lang)
        incoming = {}
        for part in args.parts:
            chunk = json.loads(part.read_text(encoding='utf-8'))
            if not isinstance(chunk, dict):
                raise DataError(f'{part}: expected an object keyed by record ID')
            incoming.update({record_id: {field: entry.get(field) for field in FIELDS} if isinstance(entry, dict) else entry
                             for record_id, entry in chunk.items()})
        found = problems(args.lang, incoming, english)
        if found:
            raise DataError('\n'.join(found))
        for record_id, entry in incoming.items():
            data[record_id] = {**entry, 'basis': current[record_id]}
        save(args.lang, data)
        left = sum(1 for record_id in current if data.get(record_id, {}).get('basis') != current[record_id])
        print(f'{args.lang}: merged {len(incoming)} records; {left} still to translate')
        return

    if args.command == 'stamp':
        data = load(args.lang)
        found = problems(args.lang, data, english)
        if found:
            raise DataError('\n'.join(found))
        stamped = 0
        for record_id, entry in data.items():
            if 'basis' not in entry:
                entry['basis'] = current[record_id]
                stamped += 1
        save(args.lang, data)
        print(f'{args.lang}: stamped {stamped} entries; {len(data)} translations in total')
        return

    found = [problem for lang in LANGUAGES for problem in problems(lang, load(lang), english)]
    unstamped = [f'{lang}.json {record_id}: not stamped' for lang in LANGUAGES
                 for record_id, entry in load(lang).items() if 'basis' not in entry]
    if found or unstamped:
        raise DataError('\n'.join(found + unstamped))
    print(f'Checked translations for {len(LANGUAGES)} languages.')


if __name__ == '__main__':
    try:
        main()
    except DataError as error:
        sys.exit(f'error: {error}')
