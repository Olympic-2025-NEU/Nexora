# SPDX-License-Identifier: AGPL-3.0-only
"""Disposable gateway upstream. This is not Nexora Core Data API."""
from http.server import BaseHTTPRequestHandler, HTTPServer


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"p00-upstream")

    def do_POST(self):
        self.send_response(202)
        self.end_headers()
        self.wfile.write(b"p00-upstream")


HTTPServer(("0.0.0.0", 8000), Handler).serve_forever()
