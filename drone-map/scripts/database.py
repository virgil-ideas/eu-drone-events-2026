"""Version 1 file-database schema, integrity checks and browser export.

Uses only the Python standard library. Validation never relies on assertions,
so it also runs when Python is invoked with optimization enabled.
"""
import hashlib
import json
import math
import re
from datetime import date
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
CATEGORIES = {'flight', 'shotdown', 'engaged', 'crash', 'explosion', 'disposal', 'recovery', 'alert'}
DESCRIPTIVE = set('dateLabel dateBasis countries location status categories vehicle attribution '
                  'route circumstances payload impact response uncertainty deduplication provenance'.split())
EVENT_REQUIRED = DESCRIPTIVE | set('id startDate title category positions stages classificationNote '
                                   'recordClass sources'.split())
EVENT_OPTIONAL = set('endDate recordType positionNote reviewedOn sourceFile importAction normalizedLocality matchKey'.split())
CONTEXT_REQUIRED = set('id dateLabel countries status vehicle attribution uncertainty deduplication sources'.split())
CONTEXT_OPTIONAL = DESCRIPTIVE | {'sourceFile', 'importAction', 'reviewedOn'}
SOURCE_REQUIRED = {'id', 'publisher', 'title', 'audit', 'url'}


class DataError(ValueError):
    """Invalid canonical data, reported with its file/record/field location."""


def require(condition, path, message):
    if not condition:
        raise DataError(f'{path}: {message}')


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, key, 'duplicate JSON key')
        result[key] = value
    return result


def reject_constant(value):
    raise DataError(f'non-finite JSON number {value}')


def read_json(path):
    try:
        return json.loads(path.read_text(encoding='utf-8'), object_pairs_hook=unique_object,
                          parse_constant=reject_constant)
    except (ValueError, OSError) as error:
        raise DataError(f'{path.name}: {error}') from error


def fields(value, required, optional, path):
    require(isinstance(value, dict), path, 'expected an object')
    require(not (required - value.keys()), path, f'missing fields: {sorted(required - value.keys())}')
    require(not (value.keys() - required - optional), path,
            f'unknown fields: {sorted(value.keys() - required - optional)}')


def string(value, path, empty=False):
    require(isinstance(value, str) and (empty or bool(value.strip())), path,
            'expected a string' if empty else 'expected a non-empty string')


def choice(value, options, path):
    string(value, path)
    require(value in options, path, f'expected one of {sorted(options)}')


def iso_date(value, path):
    string(value, path)
    require(bool(re.fullmatch(r'\d{4}-\d{2}-\d{2}', value)), path, 'expected YYYY-MM-DD')
    try:
        return date.fromisoformat(value)
    except ValueError as error:
        raise DataError(f'{path}: invalid calendar date {value}') from error


def string_list(value, path, allow_empty=False):
    require(isinstance(value, list) and (allow_empty or len(value) > 0), path,
            'expected an array' if allow_empty else 'expected a non-empty array')
    for index, item in enumerate(value):
        string(item, f'{path}[{index}]')
    require(len(value) == len(set(value)), path, 'duplicate values')


def validate_database(database, research_root=ROOT.parent):
    """Validate all files together, including references and archived research."""
    fields(database, {'dataset', 'events', 'contexts', 'sources'}, set(), 'database')
    metadata = database['dataset']
    fields(metadata, {'schemaVersion', 'cutoff', 'researchFiles'}, set(), 'dataset.json')
    require(type(metadata['schemaVersion']) is int and metadata['schemaVersion'] == 1,
            'dataset.json.schemaVersion', 'unsupported schema version (expected 1)')
    cutoff = iso_date(metadata['cutoff'], 'dataset.json.cutoff')
    research = metadata['researchFiles']
    require(isinstance(research, list) and len(research) > 0, 'dataset.json.researchFiles',
            'expected a non-empty array')
    research_names = set()
    for index, item in enumerate(research):
        path = f'dataset.json.researchFiles[{index}]'
        fields(item, {'name', 'sha256'}, set(), path)
        name = item['name']
        string(name, path + '.name')
        require(bool(re.fullmatch(r'[A-Za-z0-9_-]+\.md', name)), path + '.name',
                'expected a Markdown filename without directories')
        require(name not in research_names, path + '.name', 'duplicate research file')
        research_names.add(name)
        string(item['sha256'], path + '.sha256')
        require(bool(re.fullmatch(r'[a-f0-9]{64}', item['sha256'])), path + '.sha256',
                'expected a SHA-256 hash')
        archived = research_root / name
        require(archived.is_file(), path, f'research file missing: {name}')
        require(hashlib.sha256(archived.read_bytes()).hexdigest() == item['sha256'], path,
                f'archived research changed: {name}; preserve existing research and add a new file for revisions')

    sources = database['sources']
    require(isinstance(sources, dict) and len(sources) > 0, 'sources.json', 'expected a non-empty object')
    for source_id, source in sources.items():
        path = f'sources.json[{source_id}]'
        require(bool(re.fullmatch(r'[A-Z][A-Z0-9]*\d[A-Z0-9]*', source_id)), path, 'invalid source ID')
        fields(source, SOURCE_REQUIRED, {'dateLabel'}, path)
        for key, value in source.items():
            string(value, f'{path}.{key}', empty=(key == 'audit'))
        require(source['id'] == source_id, path + '.id', 'must match the source key')
        try:
            url = urlsplit(source['url'])
            valid_url = (url.scheme in {'https', 'http'} and bool(url.hostname)
                         and url.username is None and url.password is None)
            _ = url.port
        except ValueError:
            valid_url = False
        require(valid_url and not re.search(r'\s', source['url']), path + '.url',
                'expected an HTTP(S) URL without credentials or whitespace')

    seen_ids, match_keys = set(), set()
    for collection in ('events', 'contexts'):
        records = database[collection]
        require(isinstance(records, list), collection + '.json', 'expected an array')
        if collection == 'events':
            require(len(records) > 0, 'events.json', 'at least one mapped record is required')
        for index, record in enumerate(records):
            path = f'{collection}.json[{index}]'
            is_event = collection == 'events'
            fields(record, EVENT_REQUIRED if is_event else CONTEXT_REQUIRED,
                   EVENT_OPTIONAL if is_event else CONTEXT_OPTIONAL, path)
            string(record['id'], path + '.id')
            path = f'{collection}.json[{record["id"]}]'
            require(bool(re.fullmatch(r'[EN]\d{3}' if is_event else r'N?A\d{3}', record['id'])),
                    path + '.id', 'invalid record ID')
            require(record['id'] not in seen_ids, path + '.id', 'duplicate record ID')
            seen_ids.add(record['id'])
            for key, value in record.items():
                if key not in {'sources', 'positions', 'stages'}:
                    string(value, f'{path}.{key}', empty=key in {
                        'classificationNote', 'positionNote', 'attribution', 'uncertainty'})
            string_list(record['sources'], path + '.sources')
            require(all(ref in sources for ref in record['sources']), path + '.sources',
                    f'unknown source IDs: {sorted(set(record["sources"]) - sources.keys())}')
            if 'sourceFile' in record:
                require(record['sourceFile'] in research_names, path + '.sourceFile', 'unknown research file')
            if 'reviewedOn' in record:
                iso_date(record['reviewedOn'], path + '.reviewedOn')
            if not is_event:
                if 'importAction' in record:
                    choice(record['importAction'], {'KEEP_CONTEXT', 'UPDATE_AGGREGATE_SERIES'}, path + '.importAction')
                continue
            start = iso_date(record['startDate'], path + '.startDate')
            end = iso_date(record.get('endDate', record['startDate']), path + '.endDate')
            require(date(cutoff.year, 1, 1) <= start <= end <= cutoff, path,
                    'dates must be ordered and within January 1 through the dataset cutoff')
            choice(record['recordClass'], {'event', 'candidate'}, path + '.recordClass')
            if 'importAction' in record:
                expected = 'ADD_EVENT' if record['recordClass'] == 'event' else 'KEEP_CANDIDATE'
                require(record['importAction'] == expected, path + '.importAction',
                        'legacy import action does not match recordClass')
            choice(record['category'], CATEGORIES, path + '.category')
            string_list(record['stages'], path + '.stages')
            require(set(record['stages']) <= CATEGORIES, path + '.stages', 'unknown outcome stage')
            require(record['stages'][0] == record['category'], path + '.stages',
                    'first stage must match the primary map category')
            if 'matchKey' in record:
                require(record['matchKey'] not in match_keys, path + '.matchKey', 'duplicate research match key')
                match_keys.add(record['matchKey'])
            positions = record['positions']
            require(isinstance(positions, list) and len(positions) > 0, path + '.positions',
                    'expected at least one approximate map anchor')
            seen_positions = set()
            for index, position in enumerate(positions):
                position_path = f'{path}.positions[{index}]'
                fields(position, {'lat', 'lng', 'precision', 'label'}, set(), position_path)
                for key, limit in [('lat', 90), ('lng', 180)]:
                    value = position[key]
                    require(type(value) in {int, float} and math.isfinite(value) and -limit <= value <= limit,
                            position_path + '.' + key, f'expected a finite number between {-limit} and {limit}')
                choice(position['precision'], {'locality', 'region', 'offshore'}, position_path + '.precision')
                string(position['label'], position_path + '.label')
                anchor = (position['lat'], position['lng'])
                require(anchor not in seen_positions, position_path, 'duplicate anchor within this record')
                seen_positions.add(anchor)
    return database


def load_database(data_dir=ROOT / 'data', research_root=ROOT.parent):
    database = {name: read_json(data_dir / f'{name}.json')
                for name in ('dataset', 'events', 'contexts', 'sources')}
    return validate_database(database, research_root)


def browser_record(record):
    # Keep the existing browser contract; sources is the only editable citation list.
    output = {}
    for key, value in record.items():
        if key == 'sources':
            output['sourceReferences'] = '; '.join(f'[{ref}][{ref}]' for ref in value)
        if key != 'reviewedOn':
            output[key] = value
    return output


def browser_data(database):
    return {
        'events': [browser_record(record) for record in sorted(
            database['events'], key=lambda record: (record['startDate'], record['id']))],
        'contexts': [browser_record(record) for record in database['contexts']],
        'sources': database['sources'],
        'cutoff': database['dataset']['cutoff'],
        'sourceFiles': [item['name'] for item in database['dataset']['researchFiles']],
    }


def render_events(database):
    return 'window.DRONE_DATA = ' + json.dumps(browser_data(database), ensure_ascii=False,
                                              indent=2, allow_nan=False) + ';\n'


if __name__ == '__main__':
    try:
        database = load_database()
    except (DataError, OSError) as error:
        raise SystemExit(f'Data error: {error}')
    print(f"Valid database: {len(database['events'])} events, {len(database['contexts'])} contexts, "
          f"{len(database['sources'])} sources.")
