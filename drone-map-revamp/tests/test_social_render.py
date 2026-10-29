import importlib.util
import struct
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('social_render', Path(__file__).parents[1] / 'og/render.py')
render = importlib.util.module_from_spec(spec)
spec.loader.exec_module(render)


class RenderChecks(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.shot = self.root / 'card.png'

    def screenshot(self, dom, returncode=0):
        self.shot.write_bytes(b'\x89PNG\r\n\x1a\n' + b'\0\0\0\rIHDR'
                             + struct.pack('>II', 1200, 630) + b'\0' * render.MIN_BYTES)
        return subprocess.CompletedProcess([], returncode, dom, 'Chrome error')

    def test_checks_the_same_navigation_that_produces_the_png(self):
        with patch.object(render, 'run_chrome', return_value=self.screenshot('<body data-ready="1" data-fonts="ok">')) as chrome:
            render.render_card('chrome', self.root / 'profile', 'http://localhost/og/card.html', self.shot)
        self.assertEqual(chrome.call_count, 1)
        self.assertIn('--dump-dom', chrome.call_args.args)
        self.assertIn(f'--screenshot={self.shot}', chrome.call_args.args)

    def test_rejects_an_error_even_with_a_full_size_screenshot(self):
        with patch.object(render, 'run_chrome', return_value=self.screenshot('<body data-ready="1" data-error="Required card font did not load">')):
            with self.assertRaisesRegex(SystemExit, 'Required card font'):
                render.render_card('chrome', self.root / 'profile', 'http://localhost/', self.shot)

    def test_rejects_missing_fonts_and_failed_chrome(self):
        for dom, code, message in [('<body data-ready="1">', 0, 'fonts'),
                                   ('<body data-ready="1" data-fonts="ok">', 1, 'Chrome failed')]:
            with self.subTest(dom=dom, code=code):
                with patch.object(render, 'run_chrome', return_value=self.screenshot(dom, code)):
                    with self.assertRaisesRegex(SystemExit, message):
                        render.render_card('chrome', self.root / 'profile', 'http://localhost/', self.shot)
