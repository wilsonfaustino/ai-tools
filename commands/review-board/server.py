#!/usr/bin/env python3
"""HTTP server that hosts the review-board page and writes submission JSON."""
import argparse
import json
import os
import sys
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from io import StringIO
from pathlib import Path

import render

REQUIRED_KEYS = {"pr", "comments", "general_comments"}


def render_html(findings_payload: dict) -> str:
    saved_stdin, saved_stdout = sys.stdin, sys.stdout
    try:
        sys.stdin = StringIO(json.dumps(findings_payload))
        sys.stdout = StringIO()
        render.main()
        return sys.stdout.getvalue()
    finally:
        sys.stdin, sys.stdout = saved_stdin, saved_stdout


class Handler(BaseHTTPRequestHandler):
    server_version = "ReviewBoard/1.0"

    def log_message(self, format: str, *args) -> None:
        sys.stderr.write("[server] " + (format % args) + "\n")

    def _send(self, status: int, body: bytes, content_type: str) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        if self.path == "/":
            self._send(200, self.server.html.encode("utf-8"), "text/html; charset=utf-8")
        elif self.path == "/findings.json":
            body = json.dumps(self.server.findings).encode("utf-8")
            self._send(200, body, "application/json")
        else:
            self._send(404, b'{"error":"not found"}', "application/json")

    def do_POST(self) -> None:
        if self.path != "/submit":
            self._send(404, b'{"error":"not found"}', "application/json")
            return
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length) if length > 0 else b""
        try:
            payload = json.loads(raw.decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            self._send(400, json.dumps({"error": f"invalid JSON: {exc}"}).encode("utf-8"), "application/json")
            return
        missing = REQUIRED_KEYS - set(payload.keys())
        if missing:
            self._send(400, json.dumps({"error": f"missing keys: {sorted(missing)}"}).encode("utf-8"), "application/json")
            return
        out_path = Path(self.server.out_path)
        try:
            out_path.write_text(json.dumps(payload, indent=2))
        except OSError as exc:
            self._send(500, json.dumps({"error": f"write failed: {exc}"}).encode("utf-8"), "application/json")
            return
        self._send(200, json.dumps({"ok": True, "path": str(out_path)}).encode("utf-8"), "application/json")
        threading.Thread(target=self.server.shutdown, daemon=True).start()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=0, help="0 = OS-assigned")
    parser.add_argument("--out", required=True, help="Path to write submission JSON")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    try:
        findings = json.load(sys.stdin)
    except json.JSONDecodeError as exc:
        sys.stderr.write(f"Invalid findings JSON on stdin: {exc}\n")
        sys.exit(1)

    html = render_html(findings)

    last_exc: Exception | None = None
    for _ in range(3):
        try:
            httpd = HTTPServer(("127.0.0.1", args.port), Handler)
            break
        except OSError as exc:
            last_exc = exc
            args.port = 0
    else:
        sys.stderr.write(f"Could not bind: {last_exc}\n")
        sys.exit(1)

    httpd.html = html
    httpd.findings = findings
    httpd.out_path = args.out
    port = httpd.server_address[1]
    sys.stdout.write(f"http://127.0.0.1:{port}\n")
    sys.stdout.flush()
    try:
        httpd.serve_forever()
    finally:
        httpd.server_close()
        if Path(args.out).exists():
            sys.exit(0)
        sys.exit(2)


if __name__ == "__main__":
    main()
