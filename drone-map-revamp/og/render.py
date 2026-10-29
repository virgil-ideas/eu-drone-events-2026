#!/usr/bin/env python3
"""Render the homepage and neutral event-link cards with headless Chrome.

The deploy job runs this before publishing, so the card shared on social sites
always shows the deployed data. Chrome is found on PATH (google-chrome,
chromium) or in the usual macOS location; set CHROME to use another binary.

Usage:
  python3 drone-map-revamp/og/render.py [--out FILE]

--out names the homepage PNG. The neutral card is written beside it as
og-overview.png. Both are validated before either output is replaced.
"""
import argparse
import functools
import os
import re
import shutil
import struct
import subprocess
import sys
import tempfile
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

REVAMP_DIR = Path(__file__).resolve().parents[1]
WIDTH, HEIGHT = 1200, 630
CHROME_NAMES = ('google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser')
MAC_CHROME = Path('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
MIN_BYTES = 20_000


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def find_chrome():
    if os.environ.get('CHROME'):
        return os.environ['CHROME']
    for name in CHROME_NAMES:
        if path := shutil.which(name):
            return path
    if MAC_CHROME.exists():
        return str(MAC_CHROME)
    sys.exit('error: Chrome not found. Install Chrome or set CHROME to its path.')


def run_chrome(binary, profile, url, *extra):
    command = [binary, '--headless=new', f'--user-data-dir={profile}', '--no-first-run',
               '--no-default-browser-check', '--disable-gpu', '--hide-scrollbars',
               '--force-device-scale-factor=1', f'--window-size={WIDTH},{HEIGHT}',
               '--virtual-time-budget=20000', *extra, url]
    if sys.platform.startswith('linux'):
        # Ubuntu runners block the user namespaces Chrome's sandbox needs. The
        # page is this repository's own card, served from localhost.
        command.insert(1, '--no-sandbox')
    return subprocess.run(command, capture_output=True, text=True, timeout=180)


def png_size(path):
    data = path.read_bytes()[:24]
    if data[:8] != b'\x89PNG\r\n\x1a\n' or data[12:16] != b'IHDR':
        return None
    return struct.unpack('>II', data[16:24])


def render_card(binary, profile, url, shot):
    # Validate the DOM from the same navigation that produces the screenshot.
    result = run_chrome(binary, profile, url, '--dump-dom', f'--screenshot={shot}')
    if result.returncode:
        sys.exit(f'error: Chrome failed to render the card\n{result.stderr[-2000:]}')
    body = re.search(r'<body([^>]*)>', result.stdout)
    attributes = dict(re.findall(r'data-([\w-]+)="([^"]*)"', body[1])) if body else {}
    if attributes.get('ready') != '1':
        sys.exit('error: the card did not finish drawing')
    if 'error' in attributes:
        sys.exit(f'error: the card failed: {attributes["error"]}')
    if attributes.get('fonts') != 'ok':
        sys.exit('error: the card fonts (Manrope, DM Sans) did not load from Google Fonts')
    if not shot.is_file():
        sys.exit(f'error: Chrome wrote no screenshot\n{result.stderr[-2000:]}')
    size = png_size(shot)
    if size != (WIDTH, HEIGHT):
        sys.exit(f'error: expected a {WIDTH}×{HEIGHT} PNG, got {size}')
    if shot.stat().st_size < MIN_BYTES:
        sys.exit(f'error: the PNG is only {shot.stat().st_size} bytes; the card is probably blank')


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--out', type=Path, default=REVAMP_DIR / 'og-image.png', help='Homepage PNG; og-overview.png is written beside it.')
    args = parser.parse_args()
    overview_out = args.out.with_name('og-overview.png')
    if args.out == overview_out:
        parser.error('--out must differ from the reserved og-overview.png filename')
    binary = find_chrome()

    server = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(QuietHandler, directory=str(REVAMP_DIR)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    url = f'http://127.0.0.1:{server.server_address[1]}/og/card.html'
    try:
        with tempfile.TemporaryDirectory(prefix='og-card-') as work:
            work = Path(work)
            outputs = [(url, work / 'home.png', args.out),
                       (url + '?view=overview', work / 'overview.png', overview_out)]
            for card_url, shot, _ in outputs:
                render_card(binary, work / 'profile', card_url, shot)
            args.out.parent.mkdir(parents=True, exist_ok=True)
            for _, shot, destination in outputs:
                shutil.copyfile(shot, destination)
    finally:
        server.shutdown()
    for destination in (args.out, overview_out):
        print(f'Wrote {destination} ({destination.stat().st_size // 1024} KB)')


if __name__ == '__main__':
    main()
