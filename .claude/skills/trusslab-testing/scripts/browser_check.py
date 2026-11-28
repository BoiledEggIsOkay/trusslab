#!/usr/bin/env python3
"""Runs the TrussLab browser smoke test in headless Google Chrome (a development aid, never needed by the app).

Usage (from anywhere):
    python3 -I .claude/skills/trusslab-testing/scripts/browser_check.py            # both smoke modes
    python3 -I .claude/skills/trusslab-testing/scripts/browser_check.py --shots DIR  # also screenshots

It opens index.html?smoke and index.html?smoke=selftest as file:// pages in a throwaway Chrome profile
(so no real browser data is read or written), waits for window.TrussLabSmokeResult, prints each verdict
and any failures, and exits with 1 unless both verdicts are PASS. With --shots it also saves screenshots
of the page at 1440 x 900, 1280 x 800, 1024 x 768 and 390 x 844 (phone, touch emulation).

It talks to Chrome through the DevTools protocol over a small stdlib-only WebSocket client: no npm, no
packages, nothing installed. Set CHROME to the browser binary if it is not in the default macOS place.
Safari and Firefox are not driven: run the smoke test there by hand (docs/development/local-testing.md).
"""
import base64, json, os, random, shutil, socket, struct, subprocess, sys, tempfile, time, urllib.request

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..', '..'))
CHROME = os.environ.get('CHROME', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')


class WebSocket:
    def __init__(self, url):
        hostport, path = url[len('ws://'):].split('/', 1)
        host, port = hostport.split(':')
        self.sock = socket.create_connection((host, int(port)), timeout=300)
        key = base64.b64encode(os.urandom(16)).decode()
        self.sock.sendall((f'GET /{path} HTTP/1.1\r\nHost: {hostport}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n'
                           f'Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n').encode())
        buf = b''
        while b'\r\n\r\n' not in buf:
            chunk = self.sock.recv(4096)
            if not chunk:
                raise RuntimeError('WebSocket handshake failed')
            buf += chunk
        head, self.pending = buf.split(b'\r\n\r\n', 1)
        if b' 101 ' not in head.split(b'\r\n')[0]:
            raise RuntimeError('WebSocket handshake refused')

    def _read(self, n):
        out, self.pending = self.pending[:n], self.pending[n:]
        while len(out) < n:
            chunk = self.sock.recv(max(65536, n - len(out)))
            if not chunk:
                raise RuntimeError('socket closed')
            out += chunk
        if len(out) > n:
            self.pending, out = out[n:] + self.pending, out[:n]
        return out

    def send(self, text):
        data, n = text.encode(), len(text.encode())
        hdr = bytearray([0x81])
        if n < 126:
            hdr.append(0x80 | n)
        elif n < 65536:
            hdr.append(0x80 | 126); hdr += struct.pack('>H', n)
        else:
            hdr.append(0x80 | 127); hdr += struct.pack('>Q', n)
        mask = os.urandom(4)
        self.sock.sendall(bytes(hdr) + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(data)))

    def recv(self):
        msg = b''
        while True:
            b0, b1 = self._read(2)
            n = b1 & 0x7F
            if n == 126:
                n = struct.unpack('>H', self._read(2))[0]
            elif n == 127:
                n = struct.unpack('>Q', self._read(8))[0]
            payload = self._read(n)
            if b1 & 0x80:
                mask = self._read(4)  # servers do not mask, but be safe
            if (b0 & 0x0F) == 9:
                continue
            msg += payload
            if b0 & 0x80:
                return msg.decode(errors='replace')


class Chrome:
    def __init__(self):
        self.profile = tempfile.mkdtemp(prefix='trusslab-check-')
        port = random.randint(20000, 40000)
        self.proc = subprocess.Popen([CHROME, '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
                                      f'--user-data-dir={self.profile}', f'--remote-debugging-port={port}', '--hide-scrollbars', 'about:blank'],
                                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        url = None
        for _ in range(100):
            try:
                pages = [t for t in json.loads(urllib.request.urlopen(f'http://127.0.0.1:{port}/json/list', timeout=2).read()) if t.get('type') == 'page']
                if pages:
                    url = pages[0]['webSocketDebuggerUrl']; break
            except Exception:
                pass
            time.sleep(0.1)
        if not url:
            self.close()
            raise RuntimeError('Chrome did not start (set CHROME to its binary)')
        self.ws, self.seq = WebSocket(url), 0
        self.call('Runtime.enable'); self.call('Page.enable')

    def call(self, method, **params):
        self.seq += 1
        mid = self.seq
        self.ws.send(json.dumps({'id': mid, 'method': method, 'params': params}))
        while True:
            m = json.loads(self.ws.recv())
            if m.get('id') == mid:
                if 'error' in m:
                    raise RuntimeError(f'{method}: {m["error"]}')
                return m.get('result', {})

    def eval(self, expr):
        r = self.call('Runtime.evaluate', expression=expr, returnByValue=True)
        if 'exceptionDetails' in r:
            raise RuntimeError(str(r['exceptionDetails'].get('text')))
        return r.get('result', {}).get('value')

    def open(self, url, width, height, mobile=False, scale=1):
        self.call('Emulation.setDeviceMetricsOverride', width=width, height=height, deviceScaleFactor=scale, mobile=mobile)
        self.call('Emulation.setTouchEmulationEnabled', enabled=mobile, maxTouchPoints=5 if mobile else 1)
        self.call('Page.navigate', url=url)
        for _ in range(300):
            try:
                if self.eval('document.readyState') == 'complete':
                    break
            except Exception:
                pass
            time.sleep(0.1)
        time.sleep(0.8)

    def shot(self, path):
        with open(path, 'wb') as f:
            f.write(base64.b64decode(self.call('Page.captureScreenshot', format='png')['data']))

    def close(self):
        try:
            self.proc.terminate(); self.proc.wait(5)
        except Exception:
            self.proc.kill()
        shutil.rmtree(self.profile, ignore_errors=True)


SUMMARY = """(() => { const r = window.TrussLabSmokeResult; if (!r) return null;
  return { mode: r.mode, verdict: r.verdict, passed: r.passed, failed: r.failed, skipped: r.skipped,
    failures: r.records.filter((x) => x.status === 'fail').map((x) => `${x.scenario} > ${x.name}${x.detail ? ` (${x.detail})` : ''}`) }; })()"""


def main():
    shots = sys.argv[sys.argv.index('--shots') + 1] if '--shots' in sys.argv else None
    page = 'file://' + os.path.join(ROOT, 'index.html')
    ok = True
    c = Chrome()
    try:
        for mode in ('smoke', 'smoke=selftest'):
            c.open(f'{page}?{mode}', 1440, 900)
            res = None
            for _ in range(1200):
                res = c.eval(SUMMARY)
                if res:
                    break
                time.sleep(0.25)
            if not res:
                print(f'{mode}: no result (timed out)'); ok = False; continue
            print(f"{res['mode']}: {res['verdict']} ({res['passed']} passed, {res['failed']} failed, {res['skipped']} skipped)")
            for f in res['failures']:
                print(f'  FAIL {f}')
            ok = ok and res['verdict'] == 'PASS'
        if shots:
            os.makedirs(shots, exist_ok=True)
            for w, h, mobile, scale in ((1440, 900, False, 1), (1280, 800, False, 1), (1024, 768, False, 1), (390, 844, True, 2)):
                c.open(page, w, h, mobile, scale)
                path = os.path.join(shots, f'trusslab-{w}x{h}.png')
                c.shot(path)
                print('screenshot', path)
    finally:
        c.close()
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
