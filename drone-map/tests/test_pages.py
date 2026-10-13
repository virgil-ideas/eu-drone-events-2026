"""Record pages, the record index and the sitemap (standard library)."""
import json
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
                'basis': basis(self.database['events'][0])}
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

    def test_renamed_pages_are_removed_and_flagged(self):
        self.save()
        self.build()
        self.save_pages(self.reviewed())
        with self.assertRaisesRegex(DataError, 'no longer generated'):
            self.build(check=True)
        self.build()
        self.assertNotIn('events/2026-01-02-example-romania/index.html', self.published())
        self.assertFalse((self.output_dir / 'events/2026-01-02-example-romania').exists())
        self.build(check=True)

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
