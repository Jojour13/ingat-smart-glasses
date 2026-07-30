#!/usr/bin/env python3
"""
Local server for the INGAT prototype.

Browsers refuse getUserMedia() on file:// URLs — the camera only works from a
secure context, and http://localhost counts as one. So run this, don't open the
HTML directly.

    python serve.py

Then open http://localhost:8000
"""

import http.server
import socketserver
import os
import sys
import webbrowser

ARGS = [a for a in sys.argv[1:] if not a.startswith("-")]
PORT = int(ARGS[0]) if ARGS else 8000
NO_OPEN = "--no-open" in sys.argv
ROOT = os.path.dirname(os.path.abspath(__file__))


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def end_headers(self):
        # No caching: we iterate on this during the build.
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        super().end_headers()

    def guess_type(self, path):
        # face-api ships weight shards with no extension; they must not be
        # served as text/html or the tensors fail to parse.
        if "-shard" in os.path.basename(path):
            return "application/octet-stream"
        return super().guess_type(path)

    def log_message(self, fmt, *args):
        msg = fmt % args
        if " 200 " in msg or " 304 " in msg:
            return  # keep the console readable during a demo
        sys.stderr.write("  %s\n" % msg)


def main():
    socketserver.TCPServer.allow_reuse_address = True
    try:
        with socketserver.TCPServer(("127.0.0.1", PORT), Handler) as httpd:
            url = "http://localhost:%d/" % PORT
            print()
            print("  INGAT prototype")
            print("  " + "-" * 46)
            print("  serving : %s" % ROOT)
            print("  open    : %s" % url)
            print()
            print("  1. index.html   enrol a face from the camera")
            print("  2. glasses.html the wearer's device (operator console)")
            print("  3. care.html    the caregiver dashboard")
            print()
            print("  Ctrl+C to stop.")
            print()
            if not NO_OPEN:
                try:
                    webbrowser.open(url)
                except Exception:
                    pass
            httpd.serve_forever()
    except OSError as e:
        print("Could not bind port %d: %s" % (PORT, e))
        print("Try:  python serve.py 8080")
        sys.exit(1)
    except KeyboardInterrupt:
        print("\n  stopped.\n")


if __name__ == "__main__":
    main()
