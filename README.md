# Astro Forecast

Astro Forecast ist ein Projekt zur Planung von Astrofotografie mit Wetter-, Seeing- und Transparenzprognosen. Die aktuelle Oberfläche ist eine Webapp für **astro-foto.ch**. **test.astro-foto.ch** dient als Testumgebung vor der Veröffentlichung auf der Produktionsseite.

| Umgebung | Website | App |
| --- | --- | --- |
| Produktion | https://astro-foto.ch | https://astro-foto.ch/astro-forecast/ |
| Test | https://test.astro-foto.ch | https://test.astro-foto.ch/astro-forecast/ |

Die Webapp kann eigenständig geöffnet oder per iframe in WordPress eingebunden werden. Android-App und CLI sind mögliche spätere Clients; sie sind noch nicht implementiert. Architektur und Entwicklungsregeln stehen in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Aktueller Stand

Die sichtbare App-Version ist **3.11**. Deployment- und Dokumentationsänderungen erhalten eigene Git-Commits, ohne die App-Version zu erhöhen. Änderungen an Anzeige oder Berechnung erhalten eine neue App-Versionsnummer und einen passenden Service-Worker-Cache-Namen.

- Standortsuche mit Winterthur als Standard; gespeicherter Standort im Browser.
- Stündliches Raster mit Prognosezeiträumen von 3, 5 und 8 Tagen. Die Quellen können kürzere Horizonte liefern; 8 Tage bedeuten derzeit nicht garantiert 192 kommende Stunden.
- Nächte untereinander, einschließlich angrenzender Sonnenuntergangs-/Sonnenaufgangsstunden; Details gruppenweise aufklappbar.
- Getrennte Deep-Sky- und Planetary-Scores, Mondbeleuchtung und vorzeichenbehaftete Mondhöhe.
- Tau-Risiko als Betriebsinformation unter Mond, ohne direkten Einfluss auf den Score.
- Mehrere Wetterquellen mit Ersatzquellen und serverseitigem API-Key.

## Datenquellen und Auflösung

| Quelle | Verwendung |
| --- | --- |
| MeteoSwiss ICON-CH via Open-Meteo | Wetter, Bewölkung, Wind, Feuchte, Taupunkt, Niederschlag |
| Open-Meteo Best Match | Wetter-Fallback, falls der explizite MeteoSwiss-Abruf scheitert |
| Open-Meteo Druckniveau-Daten | Atmosphärenindikator aus 850/700/500/300/250/200 hPa |
| meteoblue Clouds/Air | Unabhängiger Wolken-/Atmosphärenvergleich |
| meteoblue seeing-1h | Direkte Seeing-Prognose, falls für den serverseitigen Key freigeschaltet |
| 7Timer ASTRO | Seeing-Klasse und Transparenz, ungefähr drei Tage Horizont |
| SunCalc 1.9.0 | Sonnenhöhe, Mondhöhe und Mondbeleuchtung |

meteoblue bevorzugt **clouds-1h + air-1h**, danach **clouds-1h + air-3h**, zuletzt **clouds-3h + air-3h**. Das Stundenraster der Anzeige bedeutet nicht, dass alle Quellen native Stundenwerte liefern: 3h-Werte werden zeitlich zugeordnet.

Seeing-Priorität: meteoblue seeing_arcsec → 7Timer-Klasse → Atmosphärenindikator. Der eigene Indikator ist eine Qualitätsskala und keine direkte Seeing-Prognose in Bogensekunden. Die Anzeige der tatsächlichen Wetter-Fallbackquelle ist noch nicht überall korrekt.

## Zeitfenster

Jede angezeigte Uhrzeit bezeichnet die beginnende Stunde: 22:00 = 22:00–22:59 ([22:00, 23:00)). Anzeige und Score verwenden dieselben normalisierten Werte. Open-Meteo-Zustandsprognosen und Astronomie beschreiben den Stundenbeginn; Niederschlagsmenge, Niederschlagswahrscheinlichkeit und maximale Böen stammen vom Zeitstempel am Stundenende, da sie laut API die vorhergehende Stunde beschreiben. Diese Zuordnung gilt für die Hauptquelle und den Best-Match-Fallback.

Wetter und Höhenprofile werden mit absoluten UTC-Unix-Zeitstempeln abgerufen. Die Standortzeitzone wird für Anzeige und Nachtgruppierung verwendet; dadurch bleiben auch wiederholte Stunden bei der Zeitumstellung getrennt. Fehlende Stundenendwerte bleiben unbekannt, ohne Ersatz aus einem anderen Zeitfenster. Quellen im 3h-Raster bleiben angenähert zugeordnet und erhalten keine erfundene Stundenauflösung.

## Score-Logik

- Deep Sky: Transparenz 55 %, Wind 15 %, Mondlicht 20 %, Dunkelheit 10 %.
- Planetary: Seeing 80 %, Wind 20 %; ohne Dunkelheitsgewichtung oder Dämmerungsabzug.
- Wolken und optionaler Nebel wirken als gemeinsames Sichtbarkeits-Gate; der schlechtere Wert wird verwendet.
- Wolken-Konsens bei zwei Quellen: 65 % des höheren und 35 % des niedrigeren Wertes; bei einer Quelle gilt deren Wert. 100 % versus 0 % ergeben somit 65 % Konsens, nicht vollständige Blockierung.
- Niederschlagswahrscheinlichkeit wirkt quadratisch; modellierte Niederschlagsmenge ab 0,05 mm/h setzt beide Scores auf 0.
- Fehlende Gesamtbewölkung aus beiden Quellen oder fehlende Niederschlagsmenge/-wahrscheinlichkeit ergeben unbekannte Scores, dargestellt als neutraler Strich. Ein bekannter Showstopper bleibt bei 0.
- Ohne Seeing-Quelle einschließlich Atmosphärenindikator bleibt Planetary unbekannt. Unbekannte Scores werden nicht als beste Stunde ausgewählt.
- Tau beeinflusst den Score nicht direkt; der Transparenz-Fallback nutzt Luftfeuchte und verfügbare Sichtweite, ohne Bewölkung erneut einzurechnen.
- Gefordert sind Mondbeleuchtung und Horizonthöhe. Ein Ziel–Mond-Abstand gehört nicht zum Funktionsumfang.

## meteoblue-Key auf dem Webserver

Der Key wird ausschließlich serverseitig verarbeitet. Bevorzugt die PHP/FPM-Umgebungsvariable **METEOBLUE_API_KEY** setzen. Alternativ api/config.example.php nach **api/config.local.php** kopieren und dort den Key hinterlegen:

```php
<?php
return [
    'meteoblue_api_key' => 'DEIN_ECHTER_KEY',
];
```

api/.htaccess sperrt diese Konfigurationsdateien für direkte HTTP-Zugriffe; config.local.php ist in .gitignore ausgeschlossen und wird vom Deployment nicht übertragen. Der API-Key gehört niemals in JavaScript, WordPress-Inhalte oder Git.

meteoblue wird zuerst auf der Testumgebung geprüft:

```text
https://test.astro-foto.ch/astro-forecast/api/meteoblue.php?lat=47.4988&lon=8.7241&asl=439
```

Die Antwort enthält free.ok für Clouds/Air und seeing.ok für das optionale Seeing-Paket. Ein nicht freigeschaltetes Seeing-Paket ist kein Ausfall der gesamten App. Beide Umgebungen benötigen ihre eigene erhaltene serverseitige Konfiguration.

Server-Caches: meteoblue 30 Minuten, 7Timer 15 Minuten. 7Timer kann bei einem Quellenfehler ältere Cache-Daten zurückgeben; deren Alter wird derzeit nicht in der Oberfläche ausgewiesen.

## Lokal starten

Voraussetzung: Python 3.

```bash
cd astro-forecast
export METEOBLUE_API_KEY='DEIN_ECHTER_KEY'
python3 dev_server.py 8765
```

Öffnen: http://127.0.0.1:8765/

Der Python-Entwicklungsserver stellt lokale Nachbildungen der PHP-Proxys bereit. Cache-, Validierungs- und Fehlerverhalten sind noch nicht vollständig identisch zum Hostingbetrieb.

## Automatisierte Prüfungen

Voraussetzung: Node.js 22 oder neuer und Python 3. Keine npm-Pakete oder API-Schlüssel nötig.

```bash
npm test
npm run check:js
python3 -m unittest discover -s tests -p 'test_*.py'
```

41 Forecast-Regressionstests führen app.js in einem isolierten Node-VM-Kontext aus. Feste Uhrzeit, Wetter-Fixtures und SunCalc-Testdouble vermeiden Netzwerkabhängigkeiten. 21 Python-Prüfungen sichern Deployment-Konfiguration, SSH-Key-Handhabung und die Auswahl getesteter Commits ab.

Ein TODO-Eintrag ist noch kein ausführbarer Test: überholte Refresh-Antworten. Live-API-Schemata, astronomische Genauigkeit, PHP-Verhalten und Browserlayout sind noch nicht automatisiert abgesichert.

GitHub Actions prüft bei Pull Requests und Pushes auf main und test zusätzlich JavaScript-, PHP- und Python-Syntax sowie die Regressionstests. Der Check **baseline** ist für main verpflichtend. Die separaten Deployment-Workflows veröffentlichen nach ihren eigenen erfolgreichen Prüfungen automatisch.

## WordPress-Einbindung

Auf der jeweiligen Website:

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

Die feste iframe-Höhe ist eine bestehende Einbindungslösung; automatische Höhenanpassung ist noch offen.

## Deployment: Test und Produktion

Pushes und Merges auf **test** starten das Testdeployment automatisch; auf **main** das Produktionsdeployment. Ein manueller Neustart bleibt über Run workflow möglich, ohne Run-ID-Eingabe. Der vorhandene Test-Workflow heißt **Deploy test**, der Produktions-Workflow **Deploy production**.

### Gemeinsame Repository-Secrets

Unter **Settings → Secrets and variables → Actions**:

| Secret | Inhalt |
| --- | --- |
| SFTP_HOST | Hostpoint-SSH-Server ohne Protokoll |
| SFTP_USER | SSH-Benutzername des Hostingkontos |
| SFTP_PRIVATE_KEY | Vollständiger privater SSH-Schlüssel einschließlich BEGIN/END-Zeilen |
| SFTP_KEY_PASSPHRASE | Optional: Passphrase bei verschlüsseltem Schlüssel |
| SFTP_KNOWN_HOSTS | Verifizierte SSH-Host-Key-Zeile im OpenSSH-known_hosts-Format |

SFTP_PASSWORD wird nicht verwendet. Den öffentlichen Schlüssel bei Hostpoint hinterlegen. Private Schlüssel und Passphrasen nicht in Repository-Dateien oder Chat eintragen.

Den Server-Key aus einer bereits verifizierten lokalen known_hosts-Datei übernehmen. Bei einem anderen Port als 22 lautet der Host-Eintrag [SERVER]:PORT. Eine neu mit ssh-keyscan gelesene Zeile erst nach unabhängiger Fingerprint-Prüfung verwenden. Unbekannte oder abweichende Keys werden abgelehnt.

### Environment-Variablen

Unter **Settings → Environments** die Environments **test** und **production** konfigurieren, Deployment branches für **test** auf den Branch **test**, für **production** auf **main** beschränken. Keine zusätzlichen Required reviewers konfigurieren; der Merge nach main ist die Freigabe.

| Variable | test | production |
| --- | --- | --- |
| SITE_URL | https://test.astro-foto.ch | https://astro-foto.ch |
| APP_PATH | /astro-forecast | /astro-forecast |
| SFTP_PORT | 22 | 22 |
| SFTP_REMOTE_DIR | Website-Verzeichnis der Testseite, z. B. /www/test.astro-foto.ch | Website-Verzeichnis der Produktion, z. B. /www/astro-foto.ch |

Die Verzeichnisse sind Beispiele und müssen zum tatsächlichen Hostpoint-Zugang passen. **SFTP_REMOTE_DIR enthält keinen App-Unterordner.** APP_PATH wird genau einmal angehängt. Die öffentliche App-URL entsteht aus SITE_URL + APP_PATH. Absolute Verzeichnisse und ~/www/... sind erlaubt; ~/ wird als Pfad relativ zum SFTP-Anmeldeverzeichnis behandelt. Kein lokales Home-Verzeichnis des GitHub-Runners wird verwendet.

App-Ordner und api-Unterordner müssen bereits existieren. config.local.php und .env bleiben auf dem Server erhalten; es werden nur zehn App-Dateien übertragen. Keine WordPress-Datei oder iframe-Einbindung wird verändert.

### Ablauf

1. Änderungen auf einem Arbeitsbranch entwickeln und als Pull Request nach **test** übernehmen.
2. **Deploy test** läuft automatisch. Erst nach erfolgreichem Lauf die Testseite prüfen.
3. Den geprüften Stand per Pull Request von **test** nach **main** übernehmen. Dies ist die Produktionsfreigabe.
4. **Deploy production** findet automatisch einen erfolgreichen Testlauf mit exakt gleichem Git-Dateibaum und deployt dessen Commit. Ein anderer Merge-Commit-Hash ist erlaubt; abweichende Inhalte sind gesperrt.

Während der Sichtprüfung und Freigabe keine weiteren Änderungen nach test übernehmen. Nach dem Produktionsmerge main zurück nach test mergen, um beide Branches auf gemeinsamem Verlauf zu halten. test bleibt dauerhaft bestehen und wird nach einer Freigabe nicht gelöscht. Weitere Details zur einmaligen Einrichtung stehen in [docs/GITHUB-SETUP.md](docs/GITHUB-SETUP.md).

Dateien werden vollständig unter temporären Namen hochgeladen und danach einzeln ersetzt; HTML und Service Worker zuletzt. Das ist kein transaktionaler Verzeichniswechsel. Bei einem Rename-Fehler kann ein Teilstand entstehen. Die HTTP-Prüfung vergleicht index.html, app.js und sw.js mit dem Commit; sie macht bei Abweichungen den Lauf rot, rollt aber keinen Upload zurück. Ein technischer Erfolg ersetzt keine Sichtprüfung.

Lokale Prüfungen ohne Zugangsdaten oder Netzwerk:

```bash
npm test
python3 -m unittest discover -s tests -p 'test_*.py'
```
