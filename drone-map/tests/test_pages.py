"""Record pages, the record index and the sitemap (standard library)."""
import json
import copy
import shutil
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from test_database import DatabaseTests, DataError
from pages import basis, validate_pages


class PageTests(unittest.TestCase):
    setUp = DatabaseTests.setUp
    save = DatabaseTests.save
    build = DatabaseTests.build
    published = DatabaseTests.published

    def reviewed(self, **changes):
        page = {'slug': '2026-01-02-drone-crash-solca-romania', 'headline': 'Reviewed headline',
                'description': 'Reviewed description.', 'summary': ['Reviewed summary.'],
                'basis': basis(self.database['events'][0], self.database['sources'])}
        page.update(changes)
        return {'E001': page}

    def save_pages(self, pages):
        (self.data_dir / 'pages.json').write_text(json.dumps(pages), encoding='utf-8')

    def test_every_event_gets_a_page_without_reviewed_copy(self):
        self.save()
        _, automatic = self.build()
        self.assertEqual(automatic, ['E001'])
        files = self.published()
        page = files['events/2026-01-02-example-romania/index.html'].decode()
        self.assertIn('<link rel="canonical" href="https://droneincidents.eu/events/2026-01-02-example-romania/">', page)
        self.assertIn('href="../../#2026-01-02-example-romania"', page)
        self.assertIn('events/2026-01-02-example-romania/', files['sitemap.xml'].decode())
        self.assertIn('Sitemap: https://droneincidents.eu/sitemap.xml', files['robots.txt'].decode())
        self.assertIn('href="2026-01-02-example-romania/"', files['events/index.html'].decode())
        data = json.loads(files['events.js'].decode()[len('window.DRONE_DATA = '):-2])
        self.assertEqual(data['events'][0]['page'], 'events/2026-01-02-example-romania/')
        self.assertEqual(json.loads((self.data_dir / 'page-urls.json').read_text()),
                         {'E001': '2026-01-02-example-romania'})
        self.build(check=True)

    def test_reviewed_copy_is_used_until_its_facts_change(self):
        self.save()
        self.save_pages(self.reviewed())
        _, automatic = self.build()
        self.assertEqual(automatic, [])
        path = 'events/2026-01-02-drone-crash-solca-romania/index.html'
        self.assertIn('Reviewed summary.', self.published()[path].decode())
        self.database['events'][0]['attribution'] = 'Romanian authorities identified the drone'
        self.save()
        _, automatic = self.build()
        self.assertEqual(automatic, ['E001'])
        page = self.published()[path].decode()  # The URL survives the fallback.
        self.assertNotIn('Reviewed summary.', page)
        self.assertIn('Romanian authorities identified the drone', page)

    def test_record_text_is_escaped(self):
        self.database['events'][0]['title'] = '<script>alert(1)</script>'
        self.save()
        self.build()
        page = next(content.decode() for name, content in self.published().items()
                    if name.startswith('events/2026-01-02-') and name.endswith('index.html'))
        self.assertNotIn('<script>alert', page)
        self.assertIn('&lt;script&gt;alert(1)&lt;/script&gt;', page)

    def test_automatic_url_survives_corrections_and_a_clean_build(self):
        self.save()
        self.build()
        path = 'events/2026-01-02-example-romania/index.html'
        event = self.database['events'][0]
        event.update(title='Identified vessel', startDate='2026-01-03', countries='Bulgaria',
                     status='Identity confirmed', attribution='Operator identified')
        self.save()
        shutil.rmtree(self.output_dir)  # CI has no previous output to recover a URL from.
        self.build()
        page = self.published()[path].decode()
        self.assertIn('Identified vessel', page)
        self.assertIn('Identity confirmed', page)
        self.assertIn('events/2026-01-02-example-romania/', self.published()['sitemap.xml'].decode())
        self.save_pages(self.reviewed(slug='2026-01-02-example-romania'))
        self.build()
        self.assertIn('Reviewed summary.', self.published()[path].decode())
        self.build(check=True)

    def test_reviewing_copy_cannot_rename_a_published_url(self):
        self.save()
        self.build()
        before = self.published()
        registry = (self.data_dir / 'page-urls.json').read_bytes()
        self.save_pages(self.reviewed())
        with self.assertRaisesRegex(DataError, 'published URL is fixed'):
            self.build()
        self.assertEqual(before, self.published())
        self.assertEqual(registry, (self.data_dir / 'page-urls.json').read_bytes())

    def test_earlier_colliding_record_cannot_take_an_existing_url(self):
        self.save()
        self.build()
        self.database['events'].append({**self.database['events'][0], 'id': 'E000'})
        self.save()
        self.save_pages({'E000': {**self.reviewed()['E001'], 'slug': '2026-01-02-example-romania'}})
        with self.assertRaisesRegex(DataError, 'already reserved'):
            self.build()
        (self.data_dir / 'pages.json').unlink()
        self.build()
        registry = json.loads((self.data_dir / 'page-urls.json').read_text())
        self.assertEqual(registry['E001'], '2026-01-02-example-romania')
        self.assertEqual(registry['E000'], '2026-01-02-example-romania-2')

    def test_check_requires_urls_to_be_saved_without_writing(self):
        self.save()
        self.build()
        path = self.data_dir / 'page-urls.json'
        path.unlink()
        before = self.published()
        with self.assertRaisesRegex(DataError, 'unregistered URLs'):
            self.build(check=True)
        self.assertFalse(path.exists())
        self.assertEqual(before, self.published())

    def test_invalid_url_registry_does_not_touch_published_files(self):
        self.save()
        self.build()
        before = self.published()
        for registry in ([], {'E001': '../escape'}, {'typo': '2026-01-02-example'},
                         {'E001': '2026-01-02-example', 'E002': '2026-01-02-example'}):
            with self.subTest(registry=registry):
                (self.data_dir / 'page-urls.json').write_text(json.dumps(registry))
                with self.assertRaises(DataError):
                    self.build()
                self.assertEqual(before, self.published())

    def test_corrections_to_previously_omitted_facts_replace_stale_copy(self):
        original = copy.deepcopy(self.database['events'][0])
        self.save_pages(self.reviewed())
        for key, value in [('dateBasis', 'Publication date corrected to 29 January'),
                           ('title', 'Corrected vessel name'), ('reported_UAVs', 4),
                           ('classificationNote', 'Updated classification evidence')]:
            with self.subTest(field=key):
                self.database['events'][0] = {**original, key: value}
                self.save()
                _, automatic = self.build()
                self.assertEqual(automatic, ['E001'])
                page = self.published()['events/2026-01-02-drone-crash-solca-romania/index.html'].decode()
                self.assertNotIn('Reviewed summary.', page)
                self.build(check=True)

    def test_cited_source_correction_replaces_stale_copy(self):
        self.save_pages(self.reviewed())
        self.database['sources']['S01']['title'] = 'Corrected source report title'
        self.save()
        _, automatic = self.build()
        self.assertEqual(automatic, ['E001'])
        page = self.published()['events/2026-01-02-drone-crash-solca-romania/index.html'].decode()
        self.assertNotIn('Reviewed summary.', page)
        self.assertIn('Corrected source report title', page)

    def test_review_date_and_unrelated_sources_keep_reviewed_copy(self):
        self.save_pages(self.reviewed())
        self.database['events'][0]['reviewedOn'] = '2026-09-25'
        self.database['sources']['S02'] = {**self.database['sources']['S01'], 'id': 'S02',
                                           'title': 'Unrelated report'}
        self.save()
        _, automatic = self.build()
        self.assertEqual(automatic, [])
        page = self.published()['events/2026-01-02-drone-crash-solca-romania/index.html'].decode()
        self.assertIn('Reviewed summary.', page)

    def test_invalid_page_copy_fails(self):
        for pages, message in [({'E999': self.reviewed()['E001']}, 'no mapped event'),
                               (self.reviewed(slug='Solca crash'), 'slug'),
                               (self.reviewed(summary=[]), 'paragraphs'),
                               (self.reviewed(basis='x'), 'hash'),
                               ({'E001': {'slug': '2026-01-02-solca'}}, 'exactly the fields')]:
            with self.subTest(message=message):
                with self.assertRaisesRegex(DataError, message):
                    validate_pages(pages, self.database)
        self.database['events'].append({**self.database['events'][0], 'id': 'E002'})
        duplicate = {**self.reviewed(), 'E002': self.reviewed()['E001']}
        with self.assertRaisesRegex(DataError, 'duplicate slug'):
            validate_pages(duplicate, self.database)


if __name__ == '__main__':
    unittest.main()
