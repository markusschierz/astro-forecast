#!/usr/bin/env python3
"""Local dev server for Astro Forecast with a same-origin 7Timer proxy."""
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse, parse_qs, urlencode
from urllib.request import Request, urlopen
from pathlib import Path
import json, os, sys

ROOT = Path(__file__).resolve().parent
os.chdir(ROOT)

class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == '/api/7timer.php':
            qs = parse_qs(parsed.query)
            try:
                lat = float(qs.get('lat', [''])[0])
                lon = float(qs.get('lon', [''])[0])
                if not (-90 <= lat <= 90 and -180 <= lon <= 180):
                    raise ValueError
            except Exception:
                self.send_json(400, {'error': True, 'message': 'lat/lon ungültig'})
                return
            params = urlencode({
                'lon': f'{lon:.3f}', 'lat': f'{lat:.3f}',
                'product': 'astro', 'output': 'json'
            })
            url = 'https://www.7timer.info/bin/api.pl?' + params
            try:
                req = Request(url, headers={'User-Agent': 'AstroForecast-local/2.0', 'Accept': 'application/json'})
                with urlopen(req, timeout=12) as r:
                    body = r.read()
                json.loads(body.decode('utf-8'))
                self.send_response(200)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.send_header('Cache-Control', 'no-store')
                self.end_headers()
                self.wfile.write(body)
            except Exception as e:
                self.send_json(502, {'error': True, 'message': f'7Timer nicht erreichbar: {e}'})
            return
        super().do_GET()

    def send_json(self, status, obj):
        body = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    print(f'Astro Forecast: http://127.0.0.1:{port}')
    ThreadingHTTPServer(('127.0.0.1', port), Handler).serve_forever()
