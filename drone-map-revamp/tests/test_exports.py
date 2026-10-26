import importlib.util
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
