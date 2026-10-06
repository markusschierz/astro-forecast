#!/usr/bin/env python3
"""Local dev server for Astro Forecast 3 with same-origin 7Timer + meteoblue proxies."""
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse, parse_qs, urlencode
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from pathlib import Path
import json, os, sys, time

ROOT = Path(__file__).resolve().parent
os.chdir(ROOT)
CACHE = {}

def fetch_json(url, timeout=15):
    req = Request(url, headers={'User-Agent': 'AstroForecast-local/3.2', 'Accept': 'application/json'})
    try:
        with urlopen(req, timeout=timeout) as r:
            body = r.read()
            status = r.status
            credits = r.headers.get('MB-Credits-Accounted')
    except HTTPError as e:
        body = e.read()
        status = e.code
        credits = e.headers.get('MB-Credits-Accounted') if e.headers else None
    try:
        data = json.loads(body.decode('utf-8'))
    except Exception:
        return {'ok': False, 'status': status, 'error': 'Ungültige JSON-Antwort'}
    if status < 200 or status >= 300 or data.get('error'):
        return {'ok': False, 'status': status, 'error': data.get('error_message') or data.get('message') or f'HTTP {status}', 'data': data}
    return {'ok': True, 'status': status, 'credits': credits, 'data': data}

def cached(key, ttl, loader):
    now = time.time()
    item = CACHE.get(key)
    if item and now - item[0] < ttl:
        out = dict(item[1]); out['_cache'] = 'HIT'; return out
    out = loader(); out['_cache'] = 'MISS'
    if out.get('ok') or out.get('status') in (401, 403):
        CACHE[key] = (now, dict(out))
    return out

class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == '/api/7timer.php':
            qs = parse_qs(parsed.query)
            try:
                lat = float(qs.get('lat', [''])[0]); lon = float(qs.get('lon', [''])[0])
                if not (-90 <= lat <= 90 and -180 <= lon <= 180): raise ValueError
            except Exception:
                return self.send_json(400, {'error': True, 'message': 'lat/lon ungültig'})
            params = urlencode({'lon': f'{lon:.3f}', 'lat': f'{lat:.3f}', 'product': 'astro', 'output': 'json'})
            url = 'https://www.7timer.info/bin/api.pl?' + params
            try:
                req = Request(url, headers={'User-Agent': 'AstroForecast-local/3.2', 'Accept': 'application/json'})
                with urlopen(req, timeout=12) as r: body = r.read()
                json.loads(body.decode('utf-8'))
                return self.send_raw_json(200, body)
            except Exception as e:
                return self.send_json(502, {'error': True, 'message': f'7Timer nicht erreichbar: {e}'})

        if parsed.path == '/api/meteoblue.php':
            key = os.environ.get('METEOBLUE_API_KEY', '').strip()
            if not key:
                return self.send_json(503, {'error': True, 'message': 'METEOBLUE_API_KEY ist lokal nicht gesetzt', 'code': 'NO_API_KEY'})
            qs = parse_qs(parsed.query)
            try:
                lat = float(qs.get('lat', [''])[0]); lon = float(qs.get('lon', [''])[0])
                if not (-90 <= lat <= 90 and -180 <= lon <= 180): raise ValueError
            except Exception:
                return self.send_json(400, {'error': True, 'message': 'lat/lon ungültig'})
            asl = qs.get('asl', [None])[0]
            params = {'lat': f'{lat:.5f}', 'lon': f'{lon:.5f}', 'tz': 'utc', 'forecastDays': '7', 'timeformat': 'iso8601', 'format': 'json', 'apikey': key}
            if asl not in (None, ''):
                try: params['asl'] = str(round(float(asl)))
                except Exception: pass
            query = urlencode(params)
            coord_key = f'{lat:.5f}|{lon:.5f}|{params.get("asl", "")}'
            free = cached('free-1h|' + coord_key, 1800, lambda: fetch_json('https://my.meteoblue.com/packages/clouds-1h,air-3h?' + query))
            if not free.get('ok'):
                fallback = cached('free-3h|' + coord_key, 1800, lambda: fetch_json('https://my.meteoblue.com/packages/clouds-3h,air-3h?' + query))
                if fallback.get('ok'):
                    fallback['_fallback_from'] = 'clouds-1h,air-3h'
                    free = fallback
            seeing = cached('seeing|' + coord_key, 1800, lambda: fetch_json('https://my.meteoblue.com/packages/seeing-1h?' + query))
            return self.send_json(200, {'error': False, 'source': 'meteoblue', 'free': free, 'seeing': seeing})

        super().do_GET()

    def send_raw_json(self, status, body):
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers(); self.wfile.write(body)

    def send_json(self, status, obj):
        body = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers(); self.wfile.write(body)

if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    print(f'Astro Forecast 3.2: http://127.0.0.1:{port}')
    print('meteoblue lokal: export METEOBLUE_API_KEY="..."')
    ThreadingHTTPServer(('127.0.0.1', port), Handler).serve_forever()
