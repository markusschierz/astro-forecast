<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: public, max-age=900, stale-while-revalidate=1800');

function fail_json(int $status, string $message): never {
    http_response_code($status);
    echo json_encode(['error' => true, 'message' => $message], JSON_UNESCAPED_SLASHES);
    exit;
}

$latRaw = $_GET['lat'] ?? null;
$lonRaw = $_GET['lon'] ?? null;
if ($latRaw === null || $lonRaw === null || !is_numeric($latRaw) || !is_numeric($lonRaw)) {
    fail_json(400, 'lat/lon fehlen oder sind ungültig');
}
$lat = (float)$latRaw;
$lon = (float)$lonRaw;
if ($lat < -90 || $lat > 90 || $lon < -180 || $lon > 180) {
    fail_json(400, 'Koordinaten außerhalb des gültigen Bereichs');
}

$lat3 = number_format($lat, 3, '.', '');
$lon3 = number_format($lon, 3, '.', '');
$url = 'https://www.7timer.info/bin/api.pl?lon=' . rawurlencode($lon3)
     . '&lat=' . rawurlencode($lat3)
     . '&product=astro&output=json';

$cacheFile = rtrim(sys_get_temp_dir(), DIRECTORY_SEPARATOR)
    . DIRECTORY_SEPARATOR . 'astroforecast_7timer_' . sha1($lat3 . ',' . $lon3) . '.json';
$ttl = 900;

if (is_file($cacheFile) && (time() - (int)filemtime($cacheFile) < $ttl)) {
    $cached = @file_get_contents($cacheFile);
    if ($cached !== false && $cached !== '') {
        header('X-Astro-Cache: HIT');
        echo $cached;
        exit;
    }
}

$data = false;
$httpCode = 0;

if (function_exists('curl_init')) {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 6,
        CURLOPT_TIMEOUT => 12,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_MAXREDIRS => 3,
        CURLOPT_USERAGENT => 'astro-foto.ch Astro Forecast/2.0',
        CURLOPT_HTTPHEADER => ['Accept: application/json'],
    ]);
    $data = curl_exec($ch);
    $httpCode = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    curl_close($ch);
} elseif (ini_get('allow_url_fopen')) {
    $context = stream_context_create([
        'http' => [
            'timeout' => 12,
            'ignore_errors' => true,
            'header' => "User-Agent: astro-foto.ch Astro Forecast/2.0\r\nAccept: application/json\r\n"
        ]
    ]);
    $data = @file_get_contents($url, false, $context);
    if (isset($http_response_header[0]) && preg_match('/\s(\d{3})\s/', $http_response_header[0], $m)) {
        $httpCode = (int)$m[1];
    }
}

if ($data === false || $data === '' || ($httpCode !== 0 && ($httpCode < 200 || $httpCode >= 300))) {
    if (is_file($cacheFile)) {
        $cached = @file_get_contents($cacheFile);
        if ($cached !== false && $cached !== '') {
            header('X-Astro-Cache: STALE');
            echo $cached;
            exit;
        }
    }
    fail_json(502, '7Timer ist serverseitig nicht erreichbar');
}

$decoded = json_decode($data, true);
if (!is_array($decoded) || !isset($decoded['dataseries']) || !is_array($decoded['dataseries'])) {
    fail_json(502, '7Timer lieferte keine gültige ASTRO-Antwort');
}

@file_put_contents($cacheFile, $data, LOCK_EX);
header('X-Astro-Cache: MISS');
echo $data;
