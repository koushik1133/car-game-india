"""Local dev server for the game with caching turned off, so a normal reload always gets the newest files.
Run from this folder:  python3 serve.py      then open http://127.0.0.1:8093/innova-nellutla/
"""
import http.server, socketserver, sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8093


class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        self.send_header('Expires', '0')
        super().end_headers()


socketserver.ThreadingTCPServer.allow_reuse_address = True
socketserver.ThreadingTCPServer.request_queue_size = 128   # the game loads ~80 files at once; a short queue resets connections
with socketserver.ThreadingTCPServer(('', PORT), NoCache) as httpd:
    print(f'Serving on http://127.0.0.1:{PORT}/innova-nellutla/ (no cache)')
    httpd.serve_forever()
