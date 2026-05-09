#!/usr/bin/env python3
import functools
import http.server
import os
import socketserver

ROOT = "/Users/admin/Documents/MTG-Avatar-Tracker"
PORT = 8765

os.chdir(ROOT)
Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
with socketserver.TCPServer(("", PORT), Handler) as httpd:
    print(f"Serving {ROOT} at http://localhost:{PORT}")
    httpd.serve_forever()
