"""Translation batches must retain their source revision and never overwrite silently."""
import copy
import io
import json
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import translations
from database import DataError


class TranslationTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.directory = self.root / 'translations'
        self.english = {'N112': {
            'headline': 'Vessel reported sunk',
            'description': 'Sinking reported.',
            'summary': ['The vessel reportedly sank.'],
        }}

    def run_cli(self, *arguments):
        load, save = translations.load, translations.save
        with patch.object(translations, 'english_copy', return_value=self.english), \
                patch.object(translations, 'load', side_effect=lambda lang: load(lang, self.directory)), \
                patch.object(translations, 'save', side_effect=lambda lang, data: save(lang, data, self.directory)), \
                redirect_stdout(io.StringIO()) as output:
            translations.main(list(arguments))
        return output.getvalue()

    def export(self):
        target = self.root / 'parts' / 'ro-todo.json'
        self.run_cli('todo', 'ro', '--out', str(target))
        return target, json.loads(target.read_text(encoding='utf-8'))

    def translated(self):
        _, data = self.export()
        data['N112'].update(headline='Navă raportată scufundată',
                            description='Scufundare raportată.',
                            summary=['Nava s-ar fi scufundat.'])
        return data

    def write_batch(self, name, data):
        target = self.root / 'parts' / name
        target.write_text(json.dumps(data, ensure_ascii=False), encoding='utf-8')
        return target

    def seed_existing(self):
        translations.save('ro', {'N112': {**self.english['N112'], 'basis': '0' * 16}}, self.directory)
        target = self.directory / 'ro.json'
        return target, target.read_bytes()

    def test_todo_exports_source_basis_and_only_pending_records(self):
        self.english['N113'] = copy.deepcopy(self.english['N112'])
        translations.save('ro', {'N113': {**self.english['N113'],
                                         'basis': translations.basis(self.english['N113'])}}, self.directory)
        _, pending = self.export()
        self.assertEqual(list(pending), ['N112'])
        self.assertEqual(pending['N112'], {**self.english['N112'],
                                          'basis': translations.basis(self.english['N112'])})

    def test_documented_numbered_batches_exclude_english_input_and_merge(self):
        data = self.translated()
        self.write_batch('ro-01.json', data)
        # This is the pattern documented in translations/README.md.
        batches = sorted((self.root / 'parts').glob('ro-[0-9][0-9].json'))
        self.assertEqual([item.name for item in batches], ['ro-01.json'])
        self.run_cli('merge', 'ro', *map(str, batches))
        self.assertEqual(translations.load('ro', self.directory), data)
        self.assertEqual(translations.fresh('ro', self.english, self.directory)['N112']['headline'],
                         data['N112']['headline'])

    def test_merge_rejects_translation_prepared_before_english_correction(self):
        batch = self.write_batch('ro-01.json', self.translated())
        target, before = self.seed_existing()
        self.english['N112']['headline'] = 'Vessel capsized but still afloat'
        with self.assertRaisesRegex(DataError, 'English copy changed'):
            self.run_cli('merge', 'ro', str(batch))
        self.assertEqual(target.read_bytes(), before)
        self.assertEqual(translations.fresh('ro', self.english, self.directory), {})

    def test_merge_rejects_missing_and_malformed_source_basis(self):
        data = self.translated()
        target, before = self.seed_existing()
        for invalid in (None, 'not-hex-at-all!!!', 'abc', 123):
            with self.subTest(basis=invalid):
                entry = copy.deepcopy(data)
                if invalid is None:
                    del entry['N112']['basis']
                else:
                    entry['N112']['basis'] = invalid
                batch = self.write_batch('ro-01.json', entry)
                with self.assertRaisesRegex(DataError, 'basis'):
                    self.run_cli('merge', 'ro', str(batch))
                self.assertEqual(target.read_bytes(), before)

    def test_broad_glob_with_english_todo_is_rejected_without_writing(self):
        self.write_batch('ro-01.json', self.translated())
        target, before = self.seed_existing()
        batches = sorted((self.root / 'parts').glob('ro-*.json'))
        self.assertEqual([item.name for item in batches], ['ro-01.json', 'ro-todo.json'])
        with self.assertRaisesRegex(DataError, 'N112: duplicate record'):
            self.run_cli('merge', 'ro', *map(str, batches))
        self.assertEqual(target.read_bytes(), before)

    def test_duplicate_translation_batches_are_rejected_without_writing(self):
        data = self.translated()
        first = self.write_batch('ro-01.json', data)
        second = self.write_batch('ro-02.json', data)
        with self.assertRaisesRegex(DataError, 'duplicate record'):
            self.run_cli('merge', 'ro', str(first), str(second))
        self.assertFalse((self.directory / 'ro.json').exists())

    def test_mixed_fresh_and_stale_batch_cannot_partially_update_language(self):
        self.english['N113'] = copy.deepcopy(self.english['N112'])
        data = self.translated()
        batch = self.write_batch('ro-01.json', data)
        target, before = self.seed_existing()
        self.english['N113']['description'] = 'A new attribution has been established.'
        with self.assertRaisesRegex(DataError, 'N113: English copy changed'):
            self.run_cli('merge', 'ro', str(batch))
        self.assertEqual(target.read_bytes(), before)

    def test_later_english_edit_removes_published_translation_until_retranslated(self):
        data = self.translated()
        batch = self.write_batch('ro-01.json', data)
        self.run_cli('merge', 'ro', str(batch))
        self.english['N112']['summary'] = ['The vessel remains afloat upside down.']
        self.assertEqual(translations.fresh('ro', self.english, self.directory), {})
        _, pending = self.export()
        self.assertEqual(pending['N112']['basis'], translations.basis(self.english['N112']))
        self.assertNotEqual(pending['N112']['basis'], data['N112']['basis'])


if __name__ == '__main__':
    unittest.main()
