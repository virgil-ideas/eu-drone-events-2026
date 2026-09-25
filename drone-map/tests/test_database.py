"""Integrity and publishing regressions for the file database (standard library)."""
import copy
import hashlib
import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1] / 'scripts'
sys.path.insert(0, str(SCRIPTS))
from database import DataError, DESCRIPTIVE, browser_data, load_database, read_json, validate_database

spec = importlib.util.spec_from_file_location('build_data', SCRIPTS / 'build-data.py')
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


class DatabaseTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.data_dir = self.root / 'data'
        self.data_dir.mkdir()
        self.output_dir = self.root / 'dist'
        research = b'# Original research\n'
        (self.root / 'research.md').write_bytes(research)
        event = {key: 'Research note' for key in sorted(DESCRIPTIVE)}
        event.update(id='E001', startDate='2026-01-02', dateLabel='2026-01-02', title='Example',
                     countries='Romania', recordClass='event', category='crash',
                     stages=['crash', 'flight', 'recovery'], sources=['S01'],
                     classificationNote='', sourceFile='research.md',
                     positions=[{'lat': 47.7, 'lng': 25.85, 'precision': 'locality', 'label': 'Solca'}])
        self.database = {
            'dataset': {'schemaVersion': 1, 'cutoff': '2026-09-24', 'researchFiles': [
                {'name': 'research.md', 'sha256': hashlib.sha256(research).hexdigest()}]},
            'events': [event],
            'contexts': [{'id': 'A001', 'dateLabel': 'January–September', 'countries': 'Romania',
                          'status': 'Aggregate', 'vehicle': 'Several', 'attribution': '',
                          'uncertainty': '', 'deduplication': 'Do not add to event totals', 'sources': ['S01']}],
            'sources': {'S01': {'id': 'S01', 'publisher': 'Example', 'title': 'Report',
                               'audit': '', 'url': 'https://example.org/report'}},
        }

    def save(self):
        for name, value in self.database.items():
            (self.data_dir / f'{name}.json').write_text(json.dumps(value), encoding='utf-8')

    def validate(self):
        return validate_database(self.database, self.root)

    def build(self, check=False):
        return builder.build(self.data_dir, self.output_dir, self.root, check=check)

    def test_current_repository_is_valid(self):
        load_database()

    def test_additions_and_reviewed_corrections_need_no_overrides(self):
        event = self.database['events'][0]
        event['response'] = 'Reviewed correction'
        event['reviewedOn'] = '2026-09-25'  # A review may be later than the occurrence cutoff.
        added = copy.deepcopy(event)
        added.update(id='N064', startDate='2026-01-01')
        del added['sourceFile']  # Directly sourced records do not need a new research snapshot.
        self.database['events'].append(added)
        self.validate()
        exported = browser_data(self.database)
        self.assertEqual([e['id'] for e in exported['events']], ['N064', 'E001'])
        self.assertEqual(exported['events'][1]['response'], 'Reviewed correction')
        self.assertEqual(len(exported['contexts']), 1)

    def test_duplicate_record_ids_and_match_keys_fail(self):
        event = self.database['events'][0]
        self.database['events'].append(copy.deepcopy(event))
        with self.assertRaisesRegex(DataError, 'duplicate record ID'):
            self.validate()
        self.database['events'][1]['id'] = 'E002'
        for record in self.database['events']:
            record['matchKey'] = 'same-research-occurrence'
        with self.assertRaisesRegex(DataError, 'duplicate research match key'):
            self.validate()

    def test_source_references_cannot_dangle_or_repeat(self):
        for collection in ('events', 'contexts'):
            for refs, message in [([], 'non-empty array'), (['S99'], 'unknown source'),
                                  (['S01', 'S01'], 'duplicate values')]:
                with self.subTest(collection=collection, refs=refs):
                    self.database[collection][0]['sources'] = refs
                    with self.assertRaisesRegex(DataError, message):
                        self.validate()
            self.database[collection][0]['sources'] = ['S01']

    def test_source_identity_and_links_are_validated(self):
        source = self.database['sources']['S01']
        source['id'] = 'S02'
        with self.assertRaisesRegex(DataError, 'must match the source key'):
            self.validate()
        source['id'] = 'S01'
        for url in ['javascript:alert(1)', '/relative', 'https://', 'https://example.org/a b',
                    'https://user:password@example.org', 'https://example.org:bad', 'https://[broken']:
            with self.subTest(url=url):
                source['url'] = url
                with self.assertRaisesRegex(DataError, 'HTTP'):
                    self.validate()

    def test_invalid_dates_and_ranges_fail(self):
        event = self.database['events'][0]
        for value in ['2026-02-30', '2026-2-01', '2025-12-31', '2026-09-25']:
            with self.subTest(value=value):
                event['startDate'] = value
                with self.assertRaises(DataError):
                    self.validate()
        event['startDate'] = '2026-01-02'
        event['endDate'] = '2026-01-01'
        with self.assertRaisesRegex(DataError, 'dates must be ordered'):
            self.validate()
        event['endDate'] = '2026-09-25'
        with self.assertRaisesRegex(DataError, 'cutoff'):
            self.validate()

    def test_coordinate_ranges_and_types_fail(self):
        position = self.database['events'][0]['positions'][0]
        for key, values in [('lat', [91, -91, True, '47', float('nan'), float('inf')]),
                            ('lng', [181, -181])]:
            previous = position[key]
            for value in values:
                with self.subTest(key=key, value=value):
                    position[key] = value
                    with self.assertRaisesRegex(DataError, 'finite number'):
                        self.validate()
            position[key] = previous

    def test_multiple_anchors_count_as_one_record(self):
        event = self.database['events'][0]
        event['positions'].append({'lat': 48, 'lng': 26, 'precision': 'region', 'label': 'Second region'})
        self.validate()
        self.assertEqual(len(browser_data(self.database)['events']), 1)
        event['positions'].append(copy.deepcopy(event['positions'][0]))
        with self.assertRaisesRegex(DataError, 'duplicate anchor'):
            self.validate()

    def test_outcome_stages_and_record_classes_are_consistent(self):
        event = self.database['events'][0]
        for key, value in [('category', 'unknown'), ('stages', []), ('stages', ['flight']),
                           ('stages', ['crash', 'unknown']), ('stages', ['crash', 'crash']),
                           ('recordClass', 'daily'), ('positions', []), ('importAction', 'ADD_ALERT')]:
            with self.subTest(key=key, value=value):
                original = copy.deepcopy(event)
                event[key] = value
                with self.assertRaises(DataError):
                    self.validate()
                event.clear()
                event.update(original)

    def test_unknown_or_missing_fields_fail(self):
        event = self.database['events'][0]
        event['startDtae'] = '2026-01-02'
        with self.assertRaisesRegex(DataError, 'unknown fields'):
            self.validate()
        del event['startDtae']
        del event['uncertainty']
        with self.assertRaisesRegex(DataError, 'missing fields'):
            self.validate()

    def test_json_reader_rejects_duplicate_keys_and_nonfinite_numbers(self):
        path = self.data_dir / 'sources.json'
        for text in ['{"S01": {}, "S01": {}}', '{"S01": {"url": "a", "url": "b"}}',
                     '{"x": NaN}', '{"x": Infinity}', '{broken']:
            with self.subTest(text=text):
                path.write_text(text)
                with self.assertRaises(DataError):
                    read_json(path)

    def test_schema_version_and_research_reference_are_checked(self):
        self.database['dataset']['schemaVersion'] = 2
        with self.assertRaisesRegex(DataError, 'unsupported schema version'):
            self.validate()
        self.database['dataset']['schemaVersion'] = 1
        self.database['events'][0]['sourceFile'] = 'missing.md'
        with self.assertRaisesRegex(DataError, 'unknown research file'):
            self.validate()

    def test_build_is_deterministic_and_preserves_research_bytes(self):
        self.save()
        self.build()
        before = {p.name: p.read_bytes() for p in self.output_dir.iterdir()}
        self.build()
        self.build(check=True)
        self.assertEqual(before, {p.name: p.read_bytes() for p in self.output_dir.iterdir()})
        self.assertEqual(before['research.md'], (self.root / 'research.md').read_bytes())
        data = json.loads(before['events.js'].decode()[len('window.DRONE_DATA = '):-2])
        self.assertEqual(data['events'][0]['sourceReferences'], '[S01][S01]')

    def test_check_detects_stale_output_without_writing(self):
        self.save()
        with self.assertRaisesRegex(DataError, 'stale'):
            self.build(check=True)
        self.assertFalse(self.output_dir.exists())
        self.build()
        output = self.output_dir / 'events.js'
        before = output.read_bytes()
        self.database['events'][0]['impact'] = 'Reviewed impact'
        self.save()
        with self.assertRaisesRegex(DataError, 'stale'):
            self.build(check=True)
        self.assertEqual(output.read_bytes(), before)

    def test_invalid_input_never_overwrites_published_files(self):
        self.save()
        self.build()
        before = {p.name: p.read_bytes() for p in self.output_dir.iterdir()}
        self.database['events'][0]['sources'] = ['S99']
        self.save()
        with self.assertRaisesRegex(DataError, 'unknown source'):
            self.build()
        self.assertEqual(before, {p.name: p.read_bytes() for p in self.output_dir.iterdir()})

    def test_changed_or_missing_research_blocks_build(self):
        self.save()
        (self.root / 'research.md').write_text('Accidental research edit')
        with self.assertRaisesRegex(DataError, 'archived research changed'):
            self.build()
        self.assertFalse(self.output_dir.exists())
        (self.root / 'research.md').unlink()
        with self.assertRaisesRegex(DataError, 'research file missing'):
            self.build()


if __name__ == '__main__':
    unittest.main()
