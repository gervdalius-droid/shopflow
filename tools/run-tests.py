#!/usr/bin/env python3
"""
Run the ShopFlow suite in a real browser, in REAL time.

    python3 tools/run-tests.py            # needs serve.py on :8734

Chrome's --dump-dom --virtual-time-budget trick is faster, but IndexedDB never
settles under a virtual clock, so the vault tests hang forever under it. This
drives a headless Chrome over CDP and waits for the suite's own verdict.
No dependencies — the CDP client is 60 lines at the bottom of this file.
"""
import base64, json, os, shutil, socket, struct, subprocess, sys, time, urllib.parse, urllib.request

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
URL = os.environ.get("SHOPFLOW_TEST_URL", "http://localhost:8734/test.html")
PORT = 9334
PROFILE = "/tmp/shopflow-test-profile"


class WS:
    def __init__(self, url):
        u = urllib.parse.urlparse(url)
        self.s = socket.create_connection((u.hostname, u.port), timeout=30)
        key = base64.b64encode(os.urandom(16)).decode()
        self.s.sendall((f"GET {u.path} HTTP/1.1\r\nHost: {u.hostname}:{u.port}\r\n"
                        "Upgrade: websocket\r\nConnection: Upgrade\r\n"
                        f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n").encode())
        buf = b""
        while b"\r\n\r\n" not in buf:
            buf += self.s.recv(4096)
        self.buf = buf.split(b"\r\n\r\n", 1)[1]
        self.id = 0

    def _recv(self, n):
        while len(self.buf) < n:
            d = self.s.recv(65536)
            if not d:
                raise IOError("closed")
            self.buf += d
        out, self.buf = self.buf[:n], self.buf[n:]
        return out

    def _send(self, payload):
        hdr = bytearray([0x81])
        n, mask = len(payload), os.urandom(4)
        if n < 126:
            hdr.append(0x80 | n)
        elif n < 65536:
            hdr.append(0x80 | 126); hdr += struct.pack(">H", n)
        else:
            hdr.append(0x80 | 127); hdr += struct.pack(">Q", n)
        hdr += mask
        self.s.sendall(bytes(hdr) + bytes(b ^ mask[i % 4] for i, b in enumerate(payload)))

    def _frame(self):
        while True:
            b0, b1 = self._recv(2)
            op, n = b0 & 0x0F, b1 & 0x7F
            if n == 126:
                n = struct.unpack(">H", self._recv(2))[0]
            elif n == 127:
                n = struct.unpack(">Q", self._recv(8))[0]
            data = self._recv(n)
            if op == 1:
                return data.decode("utf-8", "replace")
            if op == 8:
                raise IOError("closed by browser")

    def call(self, method, params=None, timeout=60):
        self.id += 1
        mine = self.id
        self._send(json.dumps({"id": mine, "method": method, "params": params or {}}).encode())
        t0 = time.time()
        while time.time() - t0 < timeout:
            m = json.loads(self._frame())
            if m.get("id") == mine:
                if "error" in m:
                    raise RuntimeError(m["error"])
                return m.get("result", {})
        raise TimeoutError(method)


def evaluate(ws, expr):
    r = ws.call("Runtime.evaluate", {"expression": expr, "returnByValue": True, "awaitPromise": True})
    if r.get("exceptionDetails"):
        raise RuntimeError(json.dumps(r["exceptionDetails"])[:500])
    return r["result"].get("value")


def main():
    # A service worker from an earlier run of the app itself controls this
    # origin and will happily serve last week's manager.js to the suite. Start
    # every run from a clean profile so a green bar means the code on disk.
    shutil.rmtree(PROFILE, ignore_errors=True)
    proc = subprocess.Popen(
        [CHROME, "--headless=new", "--disable-gpu", f"--remote-debugging-port={PORT}",
         f"--user-data-dir={PROFILE}", "--window-size=1000,800", "about:blank"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    ws = None
    try:
        for _ in range(80):
            try:
                tabs = json.load(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json"))
                pages = [t for t in tabs if t["type"] == "page"]
                if pages:
                    ws = WS(pages[0]["webSocketDebuggerUrl"])
                    break
            except Exception:
                time.sleep(0.3)
        if not ws:
            sys.exit("could not reach headless Chrome")

        ws.call("Page.enable"); ws.call("Runtime.enable")
        ws.call("Page.navigate", {"url": URL})
        t0, title = time.time(), ""
        while time.time() - t0 < 180:
            time.sleep(1)
            try:
                title = evaluate(ws, "document.title")
            except Exception:
                continue
            if title in ("ALL_PASS", "HAS_FAIL"):
                break
        out = evaluate(ws, "(document.querySelector('#res')||{}).textContent || ''") or ""
    finally:
        proc.terminate()

    lines = [l for l in out.split("\n") if l.strip()]
    npass = sum(1 for l in lines if l.startswith("PASS"))
    nfail = sum(1 for l in lines if l.startswith("FAIL"))
    print(f"{title or 'TIMED OUT'} — {npass} pass, {nfail} fail  ({time.time() - t0:.0f}s)")
    for l in lines:
        if l.startswith("FAIL"):
            print("  " + l[:300])
    sys.exit(0 if title == "ALL_PASS" else 1)


if __name__ == "__main__":
    main()
