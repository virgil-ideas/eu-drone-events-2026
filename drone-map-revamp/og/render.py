#!/usr/bin/env python3
"""Render the social preview card (og/card.html) to og-image.png with headless Chrome.

The deploy job runs this before publishing, so the card shared on social sites
always shows the deployed data. Chrome is found on PATH (google-chrome,
chromium) or in the usual macOS location; set CHROME to use another binary.

Usage:
  python3 drone-map-revamp/og/render.py [--out FILE]
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


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--out', type=Path, default=REVAMP_DIR / 'og-image.png', help='Where to write the PNG.')
    args = parser.parse_args()
    binary = find_chrome()

    server = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(QuietHandler, directory=str(REVAMP_DIR)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    url = f'http://127.0.0.1:{server.server_address[1]}/og/card.html'
    try:
        with tempfile.TemporaryDirectory(prefix='og-card-') as work:
            work = Path(work)
            dom = run_chrome(binary, work / 'profile', url, '--dump-dom').stdout
            body = re.search(r'<body([^>]*)>', dom)
            attributes = dict(re.findall(r'data-([\w-]+)="([^"]*)"', body[1])) if body else {}
            if attributes.get('ready') != '1':
                sys.exit('error: the card did not finish drawing')
            if 'error' in attributes:
                sys.exit(f'error: the card failed: {attributes["error"]}')
            if attributes.get('fonts') != 'ok':
                sys.exit('error: the card fonts (Manrope, DM Sans) did not load from Google Fonts')

            shot = work / 'card.png'
            result = run_chrome(binary, work / 'profile', url, f'--screenshot={shot}')
            if not shot.is_file():
                sys.exit(f'error: Chrome wrote no screenshot\n{result.stderr[-2000:]}')
            size = png_size(shot)
            if size != (WIDTH, HEIGHT):
                sys.exit(f'error: expected a {WIDTH}×{HEIGHT} PNG, got {size}')
            if shot.stat().st_size < MIN_BYTES:
                sys.exit(f'error: the PNG is only {shot.stat().st_size} bytes; the card is probably blank')
            args.out.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(shot, args.out)
    finally:
        server.shutdown()
    print(f'Wrote {args.out} ({args.out.stat().st_size // 1024} KB)')


if __name__ == '__main__':
    main()
