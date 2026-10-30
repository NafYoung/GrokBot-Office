#!/usr/bin/env python3
"""Bot Office local server — serves static UI and proxies webhook pings.
Key never leaves this process; never served to the browser.
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PUBLIC = ROOT / "public"
WEBHOOK_URL_FILE = ROOT / "webhook.url"
WEBHOOK_KEY_FILE = ROOT / "webhook.key"
PORT = int(os.environ.get("BOT_OFFICE_PORT", "8787"))
HOST = "0.0.0.0"
TIMEOUT = 8


def load_webhook_url() -> str:
    return WEBHOOK_URL_FILE.read_text(encoding="utf-8").strip()


def load_webhook_key() -> str:
    env = os.environ.get("BOT_OFFICE_WEBHOOK_KEY", "").strip()
    if env:
        return env
    return WEBHOOK_KEY_FILE.read_text(encoding="utf-8").strip()


def post_webhook(payload: dict) -> tuple[int, str]:
    url = load_webhook_url()
    key = load_webhook_key()
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {key}",
            "X-Automation-Key": key,
            "User-Agent": "bot-office/1.0",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            text = resp.read().decode("utf-8", errors="replace")
            return resp.status, text
    except urllib.error.HTTPError as e:
        text = e.read().decode("utf-8", errors="replace") if e.fp else str(e)
        return e.code, text
    except Exception as e:
        return 0, str(e)


class Handler(BaseHTTPRequestHandler):
    server_version = "BotOffice/1.0"

    def log_message(self, fmt: str, *args) -> None:
        # Never log Authorization / keys; request line only
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def _cors(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _json(self, code: int, obj: dict) -> None:
        data = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self._cors()
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self) -> None:
        path = self.path.split("?", 1)[0]
        if path in ("/health", "/api/health"):
            self._json(200, {"ok": True, "service": "bot-office"})
            return
        if path == "/":
            path = "/index.html"
        # static from public/
        rel = path.lstrip("/")
        if ".." in rel or rel.startswith("/"):
            self.send_error(400)
            return
        file_path = (PUBLIC / rel).resolve()
        if not str(file_path).startswith(str(PUBLIC.resolve())):
            self.send_error(403)
            return
        if not file_path.is_file():
            self.send_error(404)
            return
        ctype = {
            ".html": "text/html; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".js": "application/javascript; charset=utf-8",
            ".svg": "image/svg+xml",
            ".png": "image/png",
            ".ico": "image/x-icon",
            ".json": "application/json",
            ".woff2": "font/woff2",
        }.get(file_path.suffix.lower(), "application/octet-stream")
        data = file_path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self) -> None:
        path = self.path.split("?", 1)[0]
        if path != "/api/ping":
            self.send_error(404)
            return
        length = int(self.headers.get("Content-Length", "0") or 0)
        if length > 65536:
            self._json(413, {"ok": False, "error": "body too large"})
            return
        raw = self.rfile.read(length) if length else b"{}"
        try:
            client = json.loads(raw.decode("utf-8") or "{}")
        except json.JSONDecodeError:
            self._json(400, {"ok": False, "error": "invalid json"})
            return

        action = client.get("action") or "ping"
        if action == "probe":
            payload = {"action": "probe"}
        elif action == "ping":
            bot = (client.get("bot") or "").strip()
            if not bot:
                self._json(400, {"ok": False, "error": "bot required"})
                return
            msg = (client.get("message") or "").strip()
            payload = {"action": "ping", "bot": bot}
            if msg:
                payload["message"] = msg
        else:
            self._json(400, {"ok": False, "error": "unknown action"})
            return

        status, text = post_webhook(payload)
        ok = status == 200
        self._json(
            200 if ok else 502,
            {
                "ok": ok,
                "upstream": status,
                "detail": text[:500] if not ok else "ok",
            },
        )


def main() -> None:
    # Validate secrets exist (do not print them)
    url = load_webhook_url()
    key = load_webhook_key()
    if not url or not key:
        sys.stderr.write("missing webhook.url or webhook.key / BOT_OFFICE_WEBHOOK_KEY\n")
        sys.exit(1)
    httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    sys.stderr.write("bot-office listening on http://%s:%s\n" % (HOST, PORT))
    httpd.serve_forever()


if __name__ == "__main__":
    main()
