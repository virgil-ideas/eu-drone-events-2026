import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('revamp_export', Path(__file__).parents[1] / 'build-pages-data.py')
export = importlib.util.module_from_spec(spec)
spec.loader.exec_module(export)


class ExportChecks(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.source = Path(self.temp.name) / 'source'
        self.target = Path(self.temp.name) / 'target'
        self.source.mkdir()
        self.target.mkdir()
        for name in export.SHARED_ASSETS:
            (self.source / name).write_text('current asset')
        page = self.source / 'events/incident/index.html'
        page.parent.mkdir(parents=True)
        page.write_text('current incident')
        export.sync_assets(self.source, self.target)

    def test_detects_stale_event_data_without_changing_it(self):
        (self.target / 'events.js').write_text('empty or outdated events')
        with self.assertRaises(export.DataError):
            export.sync_assets(self.source, self.target, check=True)
        self.assertEqual((self.target / 'events.js').read_text(), 'empty or outdated events')

    def test_detects_stale_missing_and_extra_pages(self):
        page = self.target / 'events/incident/index.html'
        page.write_text('old incident')
        with self.assertRaises(export.DataError):
            export.sync_assets(self.source, self.target, check=True)
        page.unlink()
        with self.assertRaises(export.DataError):
            export.sync_assets(self.source, self.target, check=True)
        export.sync_assets(self.source, self.target)
        stale = self.target / 'events/old.html'
        stale.write_text('retired stale copy')
        with self.assertRaises(export.DataError):
            export.sync_assets(self.source, self.target, check=True)
        export.sync_assets(self.source, self.target)
        self.assertFalse(stale.exists())
        export.sync_assets(self.source, self.target, check=True)

    def test_missing_canonical_asset_is_not_silently_skipped(self):
        (self.source / 'events.js').unlink()
        with self.assertRaises(FileNotFoundError):
            export.sync_assets(self.source, self.target)

    def test_checks_and_refreshes_research_downloads_and_page_styles(self):
        research_files = [{'name': 'research.md'}, {'name': 'research-update.md'}]
        for item in research_files:
            (self.source / item['name']).write_text('new research')
        export.sync_assets(self.source, self.target, research_files=research_files)
        for name in ['research.md', 'research-update.md', 'page.css', 'robots.txt']:
            with self.subTest(name=name):
                (self.source / name).write_text('updated content')
                with self.assertRaises(export.DataError):
                    export.sync_assets(self.source, self.target, check=True, research_files=research_files)
                self.assertNotEqual((self.target / name).read_text(), 'updated content')
                export.sync_assets(self.source, self.target, research_files=research_files)
                self.assertEqual((self.target / name).read_text(), 'updated content')
        export.sync_assets(self.source, self.target, check=True, research_files=research_files)


class AssetVersionChecks(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        for name in (*export.DATA_ASSETS, 'app.js', 'styles.css', 'asset-loader.js',
                     'i18n/en.js', 'i18n/ro.js', 'i18n/pages/ro.js'):
            asset = self.root / name
            asset.parent.mkdir(parents=True, exist_ok=True)
            asset.write_text(f'original {name}', encoding='utf-8')
        (self.root / 'index.html').write_text(
            '<link href="https://example.com/fonts.css?v=external" rel="stylesheet">\n'
            '<link href="styles.css?v=old" rel="stylesheet">\n'
            '<script defer src="asset-loader.js"></script>\n'
            '<script defer src="app.js?mode=map&amp;v=old#entry"></script>\n', encoding='utf-8')

    def snapshot(self):
        return {p.relative_to(self.root).as_posix(): p.read_bytes()
                for p in self.root.rglob('*') if p.is_file()}

    def versions(self):
        return json.loads((self.root / 'asset-manifest.json').read_text())['assets']

    def test_build_is_deterministic_and_check_is_read_only(self):
        export.refresh_asset_versions(self.root)
        before = self.snapshot()
        export.refresh_asset_versions(self.root)
        export.refresh_asset_versions(self.root, check=True)
        self.assertEqual(self.snapshot(), before)
        markup = (self.root / 'index.html').read_text()
        self.assertIn('https://example.com/fonts.css?v=external', markup)
        self.assertIn(f'app.js?mode=map&amp;v={self.versions()["app.js"]}#entry', markup)
        self.assertIn(f'asset-loader.js?v={self.versions()["asset-loader.js"]}', markup)

    def test_data_news_and_translation_edits_get_new_urls_without_date_bumps(self):
        export.refresh_asset_versions(self.root)
        before = self.versions()
        for name in (*export.DATA_ASSETS, 'i18n/pages/ro.js', 'i18n/ro.js'):
            with self.subTest(name=name):
                (self.root / name).write_text(f'new content {name}')
                snapshot = self.snapshot()
                with self.assertRaisesRegex(export.DataError, 'Asset versions are stale'):
                    export.refresh_asset_versions(self.root, check=True)
                self.assertEqual(self.snapshot(), snapshot, 'check must not repair files')
                export.refresh_asset_versions(self.root)
                after = self.versions()
                self.assertNotEqual(after[name], before[name])
                self.assertEqual(after['app.js'], before['app.js'])
                export.refresh_asset_versions(self.root, check=True)

    def test_interface_changes_refresh_html_references_too(self):
        export.refresh_asset_versions(self.root)
        old = self.versions()['app.js']
        (self.root / 'app.js').write_text('changed application')
        with self.assertRaisesRegex(export.DataError, 'index.html'):
            export.refresh_asset_versions(self.root, check=True)
        export.refresh_asset_versions(self.root)
        self.assertNotEqual(self.versions()['app.js'], old)
        self.assertIn(f'v={self.versions()["app.js"]}', (self.root / 'index.html').read_text())

    def test_missing_asset_fails_without_rewriting_manifest_or_html(self):
        export.refresh_asset_versions(self.root)
        (self.root / 'events.js').unlink()
        before = self.snapshot()
        with self.assertRaises(FileNotFoundError):
            export.refresh_asset_versions(self.root)
        self.assertEqual(self.snapshot(), before)
