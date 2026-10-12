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

## Automatisierte Prüfungen

Voraussetzung: Node.js 22 oder neuer. Keine npm-Pakete oder API-Schlüssel nötig.

```bash
npm test
npm run check:js
```

Die Regressionstests führen den unveränderten `app.js` in einem isolierten Node-VM-Kontext aus. Kontrollierte Wetter-Fixtures, eine feste Uhrzeit und ein SunCalc-Testdouble machen die Prüfungen unabhängig von Netzwerk und aktuellen Prognosen. Abgedeckt sind Score-Gates, Tau, Mondbeleuchtung/-höhe, Seeing-Priorität, Zeitfilter, Nachtgruppierung, 3h-Zuordnung und die kompakte Tabellenausgabe.

Zwei `test.todo`-Einträge dokumentieren Folgearbeiten: Zeitumstellung und überholte Refresh-Antworten. Sie sind noch keine ausführbaren Fehlerprüfungen und zählen nicht als bestandene Regressionstests.

Fehlende Werte (einschließlich `null`, leerer Strings und `-9999`) werden als unbekannt behandelt. Fehlen Gesamtbewölkung aus beiden Quellen, Niederschlagsmenge oder Niederschlagswahrscheinlichkeit, werden die Astro-Scores als neutraler Strich angezeigt. Ein bekannter Showstopper bleibt bei 0. Das optionale meteoblue-Nebelpaket ist keine Voraussetzung für die Bewertung. Fehlt jede Seeing-Quelle einschließlich Atmosphärenindikator, bleibt Planetary unbekannt. Unbekannte Scores werden nicht als beste Stunde ausgewählt.

GitHub Actions prüft bei Pull Requests und bei Pushes auf `main` zusätzlich die JavaScript-, PHP- und Python-Syntax. Der Workflow führt kein Deployment aus.

Nicht abgedeckt: reale API-Schemata und Erreichbarkeit, astronomische Genauigkeit von SunCalc, PHP-Proxy-Verhalten, Browserlayout, Touch-Scrollen und WordPress-Einbettung. Dafür folgen Adapter-/Integrationstests und Browserprüfungen in separaten Pull Requests.

## Deployment auf test.astro-foto.ch

Der Workflow **Deploy test.astro-foto.ch** wird ausschließlich manuell unter **Actions → Deploy test.astro-foto.ch → Run workflow → main** gestartet. Er deployt den ausgewählten Commit von main nach erfolgreichen Tests. Pushes und Pull Requests lösen kein Deployment aus.

Vor dem ersten Lauf unter **Settings → Environments** das Environment **test** anlegen. Die folgenden Environment-Secrets dort hinterlegen (alternativ Repository-Secrets unter **Settings → Secrets and variables → Actions**):

| Secret | Wert |
| --- | --- |
| SFTP_HOST | SFTP-Server aus dem Hostpoint Control Panel, ohne Protokoll |
| SFTP_USER | Bestehender SFTP-Benutzer für die Testseite |
| SFTP_PASSWORD | Passwort dieses SFTP-Benutzers |
| SFTP_REMOTE_DIR | Absoluter SFTP-Pfad des bestehenden Ordners der Testseite, mit Endung `/astro-forecast` |
| SFTP_KNOWN_HOSTS | Verifizierter SSH-Host-Key des SFTP-Servers im OpenSSH-known_hosts-Format |

Falls Port 22 nicht zutrifft, zusätzlich die Environment-Variable **SFTP_PORT** setzen. Kein Zugangspasswort in Repository-Dateien oder Chat eintragen.

Den absoluten Zielpfad aus der bestehenden SFTP-Verbindung übernehmen und prüfen, dass er zu **test.astro-foto.ch** gehört. Der Ordner und sein Unterordner `api` müssen bereits existieren. Der Workflow erstellt keine WordPress-Seite und ändert keine iframe-Einbindung.

Für **SFTP_KNOWN_HOSTS** die passende Zeile aus einer bereits verifizierten lokalen `~/.ssh/known_hosts` übernehmen. Alternativ `ssh-keyscan -p 22 SFTP_SERVER` ausführen und den Fingerprint über eine vertrauenswürdige Hostpoint-Quelle oder die bereits verifizierte Verbindung vergleichen, bevor die Zeile als Secret gespeichert wird. Bei einem anderen Port muss die Zeile den Host als `[SFTP_SERVER]:PORT` enthalten. Der Workflow akzeptiert keinen unbekannten oder abweichenden Server-Key.

Übertragen werden ausschließlich zehn App-Dateien: HTML, CSS, JavaScript, Manifest, Icons sowie die beiden PHP-Proxys und `api/.htaccess`. **config.local.php, .env, WordPress-Dateien, Tests und Entwicklungsserver werden nicht übertragen oder gelöscht.** Der serverseitige meteoblue-Key bleibt erhalten.

Alle Dateien werden zuerst unter temporären Namen hochgeladen, danach einzeln umbenannt; HTML und Service Worker folgen zuletzt. Dies ist kein transaktionaler Wechsel des gesamten Verzeichnisses. Bei einem Fehler während des Umbenennens kann ein Teilstand entstehen; nach Behebung denselben oder einen korrigierten main-Stand erneut ausführen. Anschließend vergleicht der Workflow die öffentlich erreichbaren Dateien `index.html`, `app.js` und `sw.js` mit dem Commit. Eine fehlgeschlagene HTTP-Prüfung macht den Lauf rot, rollt aber keinen bereits erfolgten Upload zurück.

Lokale Deployment-Tests ohne Zugangsdaten oder Netzwerk:

```bash
python3 -m unittest discover -s tests -p 'test_*.py'
```
