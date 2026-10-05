# Astro Forecast 3

Astrofotografie-Wettervorhersage für `test.astro-foto.ch` mit MeteoSwiss/Open-Meteo, meteoblue und 7Timer.

## Neu in Version 3

- meteoblue serverseitig integriert; der API-Key steht nie in `app.js` oder im Browser.
- Free-Weather-Pakete `clouds-3h` und `air-3h` als zweite unabhängige Forecast-Quelle.
- Das offizielle meteoblue-Paket `seeing-1h` wird automatisch getestet.
- Falls `seeing-1h` für den Key freigeschaltet ist, wird `seeing_arcsec` als primäre Seeing-Prognose verwendet.
- meteoblue Seeing Index 1/2, Jetstream und Bad-Layer-Daten werden zusätzlich angezeigt.
- 7Timer bleibt als unabhängige Seeing-/Transparenzquelle.
- Wolken-Konsens aus MeteoSwiss ICON-CH und meteoblue mLM.

## API-Key auf dem Webserver

### Empfohlen: Server-Umgebungsvariable

Wenn dein Hoster Umgebungsvariablen für PHP/FPM unterstützt, setze:

```text
METEOBLUE_API_KEY=dein_echter_key
```

Dann ist keine Schlüsseldatei nötig.

### Einfach auf Shared Hosting: `config.local.php`

Im Ordner:

```text
astro-forecast/api/
```

liegt `config.example.php`. Kopiere sie zu:

```text
astro-forecast/api/config.local.php
```

Inhalt:

```php
<?php
return [
    'meteoblue_api_key' => 'DEIN_ECHTER_KEY',
];
```

Die enthaltene `.htaccess` sperrt `config.local.php` und `config.example.php` für direkte HTTP-Zugriffe. `config.local.php` wird absichtlich nicht im ZIP mit einem echten Schlüssel ausgeliefert.

Wenn Shell-Zugriff vorhanden ist:

```bash
chmod 600 astro-forecast/api/config.local.php
```

Den Key niemals in `app.js`, `index.html`, WordPress Custom HTML oder ein öffentliches Git-Repository schreiben.

## API-Test auf test.astro-foto.ch

Nach dem Upload:

```text
https://test.astro-foto.ch/astro-forecast/api/meteoblue.php?lat=47.4988&lon=8.7241&asl=439
```

Erwartete Struktur:

```json
{
  "error": false,
  "source": "meteoblue",
  "free": { "ok": true, "status": 200, "data": {} },
  "seeing": { "ok": true, "status": 200, "data": {} }
}
```

Bei einem normalen Free-Key kann `free.ok` wahr sein und `seeing.ok` falsch/403. Das ist korrekt: `seeing-1h` gehört nicht zum normalen Free-Paket. Wenn dein Key zusätzlichen Seeing-Zugriff hat, wird `seeing.ok` wahr und die App verwendet `seeing_arcsec` automatisch.

## Lokal starten

```bash
cd astro-forecast
export METEOBLUE_API_KEY='DEIN_ECHTER_KEY'
python3 dev_server.py 8765
```

Dann:

```text
http://127.0.0.1:8765/
```

Der lokale Entwicklungsserver stellt sowohl `/api/7timer.php` als auch `/api/meteoblue.php` bereit.

## Datenquellen

- **MeteoSwiss ICON-CH via Open-Meteo**: lokale Wetterdaten, Wolken tief/mittel/hoch, Wind, Feuchte, Taupunkt, Niederschlag.
- **Open-Meteo Druckniveau-Daten**: 850/700/500/300/250/200 hPa für Höhenwind und Turbulenzdiagnostik.
- **meteoblue mLM**: `clouds-3h` und `air-3h` als unabhängige Vergleichsquelle.
- **meteoblue seeing-1h**: `seeing_arcsec`, Seeing Index 1/2, Jetstream, Bad Layer, sofern für den Key freigeschaltet.
- **7Timer ASTRO**: Seeing-Klasse und Transparenz.
- **SunCalc**: Sonne, Mond, Dunkelheit.

## Seeing-Priorität

1. meteoblue `seeing_arcsec`, wenn verfügbar.
2. 7Timer Seeing-Klasse als zweite direkte Forecast-Quelle.
3. Eigener Atmosphären-/Turbulenzindikator nur als diagnostischer Fallback, niemals als erfundene Arcsec-Zahl.

## Caching

- meteoblue: 30 Minuten serverseitig, um Credits bei Reloads zu sparen.
- 7Timer: 15 Minuten serverseitig.

## WordPress-Einbindung

```html
<div class="astro-forecast-frame">
  <iframe src="/astro-forecast/" title="Astro Forecast"></iframe>
</div>
```

```css
.astro-forecast-frame { width: 100%; max-width: 100%; margin: 0 auto; }
.astro-forecast-frame iframe {
  display: block;
  width: 100%;
  height: 1450px;
  border: 0;
  border-radius: 1.5rem;
}
@media (max-width: 768px) {
  .astro-forecast-frame iframe { height: 1700px; border-radius: 1rem; }
}
```
