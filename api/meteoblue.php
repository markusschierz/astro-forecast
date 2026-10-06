<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: public, max-age=900, stale-while-revalidate=1800');

function fail_json(int $status, string $message, array $extra = []): never {
    http_response_code($status);
    echo json_encode(['error' => true, 'message' => $message] + $extra, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

function load_api_key(): ?string {
    $env = getenv('METEOBLUE_API_KEY');
    if (is_string($env) && trim($env) !== '') return trim($env);

    $local = __DIR__ . '/config.local.php';
    if (is_file($local)) {
        $cfg = require $local;
        if (is_array($cfg) && isset($cfg['meteoblue_api_key']) && is_string($cfg['meteoblue_api_key'])) {
            $key = trim($cfg['meteoblue_api_key']);
            if ($key !== '' && $key !== 'DEIN_METEOBLUE_API_KEY') return $key;
        }
    }
    return null;
}

function http_get_json(string $url): array {
    $body = false;
    $status = 0;
    $headers = [];

    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CONNECTTIMEOUT => 6,
            CURLOPT_TIMEOUT => 15,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_MAXREDIRS => 3,
            CURLOPT_USERAGENT => 'astro-foto.ch Astro Forecast/3.2',
            CURLOPT_HTTPHEADER => ['Accept: application/json'],
            CURLOPT_HEADERFUNCTION => static function ($ch, string $line) use (&$headers): int {
                $len = strlen($line);
                $p = strpos($line, ':');
                if ($p !== false) {
                    $name = strtolower(trim(substr($line, 0, $p)));
                    $headers[$name] = trim(substr($line, $p + 1));
                }
                return $len;
            },
        ]);
        $body = curl_exec($ch);
        $status = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $curlError = curl_error($ch);
        curl_close($ch);
        if ($body === false) return ['ok' => false, 'status' => 0, 'error' => $curlError ?: 'cURL error'];
    } elseif (ini_get('allow_url_fopen')) {
        $context = stream_context_create(['http' => [
            'timeout' => 15,
            'ignore_errors' => true,
            'header' => "User-Agent: astro-foto.ch Astro Forecast/3.2\r\nAccept: application/json\r\n",
        ]]);
        $body = @file_get_contents($url, false, $context);
        if (isset($http_response_header) && is_array($http_response_header)) {
            foreach ($http_response_header as $line) {
                if (preg_match('/^HTTP\/\S+\s+(\d{3})/', $line, $m)) $status = (int)$m[1];
                $p = strpos($line, ':');
                if ($p !== false) $headers[strtolower(trim(substr($line,0,$p)))] = trim(substr($line,$p+1));
            }
        }
        if ($body === false) return ['ok' => false, 'status' => $status, 'error' => 'HTTP request failed'];
    } else {
        return ['ok' => false, 'status' => 0, 'error' => 'Kein HTTP-Client in PHP verfügbar'];
    }

    $decoded = json_decode((string)$body, true);
    if (!is_array($decoded)) return ['ok' => false, 'status' => $status, 'error' => 'Ungültige JSON-Antwort'];
    if ($status < 200 || $status >= 300 || !empty($decoded['error'])) {
        return [
            'ok' => false,
            'status' => $status,
            'error' => (string)($decoded['error_message'] ?? $decoded['message'] ?? ('HTTP ' . $status)),
            'data' => $decoded,
        ];
    }
    return [
        'ok' => true,
        'status' => $status,
        'credits' => $headers['mb-credits-accounted'] ?? null,
        'data' => $decoded,
    ];
}

function cached_request(string $cacheKey, int $ttl, callable $loader): array {
    $file = rtrim(sys_get_temp_dir(), DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . 'astroforecast_mb_' . sha1($cacheKey) . '.json';
    if (is_file($file) && time() - (int)filemtime($file) < $ttl) {
        $raw = @file_get_contents($file);
        $cached = $raw !== false ? json_decode($raw, true) : null;
        if (is_array($cached)) { $cached['_cache'] = 'HIT'; return $cached; }
    }
    $result = $loader();
    if (!empty($result['ok']) || in_array((int)($result['status'] ?? 0), [401,403], true)) @file_put_contents($file, json_encode($result, JSON_UNESCAPED_SLASHES), LOCK_EX);
    $result['_cache'] = 'MISS';
    return $result;
}

$latRaw = $_GET['lat'] ?? null;
$lonRaw = $_GET['lon'] ?? null;
$aslRaw = $_GET['asl'] ?? null;
if ($latRaw === null || $lonRaw === null || !is_numeric($latRaw) || !is_numeric($lonRaw)) {
    fail_json(400, 'lat/lon fehlen oder sind ungültig');
}
$lat = (float)$latRaw;
$lon = (float)$lonRaw;
$asl = is_numeric($aslRaw) ? (float)$aslRaw : null;
if ($lat < -90 || $lat > 90 || $lon < -180 || $lon > 180) fail_json(400, 'Koordinaten außerhalb des gültigen Bereichs');
if ($asl !== null && ($asl < -500 || $asl > 9000)) $asl = null;

$key = load_api_key();
if ($key === null) {
    fail_json(503, 'Meteoblue API-Key ist serverseitig nicht konfiguriert', ['code' => 'NO_API_KEY']);
}

$baseParams = [
    'lat' => number_format($lat, 5, '.', ''),
    'lon' => number_format($lon, 5, '.', ''),
    'tz' => 'utc',
    'forecastDays' => 7,
    'timeformat' => 'iso8601',
    'format' => 'json',
    'apikey' => $key,
];
if ($asl !== null) $baseParams['asl'] = (string)round($asl);

$makeUrl = static function (string $packages) use ($baseParams): string {
    return 'https://my.meteoblue.com/packages/' . $packages . '?' . http_build_query($baseParams, '', '&', PHP_QUERY_RFC3986);
};

// Bevorzugt native Stundenwerte für Clouds. Air bleibt 3h, solange der Key
// dafür keinen bestätigten 1h-Zugang hat. Falls clouds-1h nicht verfügbar ist,
// fällt der Proxy automatisch auf clouds-3h zurück.
$freePackages = 'clouds-1h,air-3h';
$free = cached_request($freePackages . '|' . $baseParams['lat'] . '|' . $baseParams['lon'] . '|' . ($baseParams['asl'] ?? ''), 1800,
    static fn() => http_get_json($makeUrl($freePackages))
);

if (empty($free['ok'])) {
    $fallbackPackages = 'clouds-3h,air-3h';
    $fallback = cached_request($fallbackPackages . '|' . $baseParams['lat'] . '|' . $baseParams['lon'] . '|' . ($baseParams['asl'] ?? ''), 1800,
        static fn() => http_get_json($makeUrl($fallbackPackages))
    );
    if (!empty($fallback['ok'])) {
        $fallback['_fallback_from'] = $freePackages;
        $free = $fallback;
    }
}

// Seeing ist ein offizielles Paket, aber nicht im normalen Free-Zugang. Wir testen den Key trotzdem.
$seeingPackages = 'seeing-1h';
$seeing = cached_request($seeingPackages . '|' . $baseParams['lat'] . '|' . $baseParams['lon'] . '|' . ($baseParams['asl'] ?? ''), 1800,
    static fn() => http_get_json($makeUrl($seeingPackages))
);

$out = [
    'error' => false,
    'source' => 'meteoblue',
    'free' => $free,
    'seeing' => $seeing,
];

echo json_encode($out, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
