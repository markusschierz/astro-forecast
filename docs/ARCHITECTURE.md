# Architektur und Weiterentwicklung

## Zweck und Zielumgebungen

Astro Forecast unterstützt die Planung von Astrofotografie. Die aktuelle Webapp wird auf astro-foto.ch betrieben; test.astro-foto.ch ist die Testumgebung vor der Produktionsfreigabe. WordPress ist die Einbettung, keine Voraussetzung der fachlichen Berechnung.

Der Android-DEV-Client unter android/ bündelt dieselbe Weboberfläche in einer nativen WebView-Activity für Sideloading. GPS nutzt navigator.geolocation mit Android-Standortberechtigungen; manuelle Standortsuche bleibt verfügbar. Hoch- und Querformat sind unterstützt. Ein CLI-Client bleibt eine mögliche spätere Erweiterung.

## Heutige Implementierung

| Datei | Verantwortung |
| --- | --- |
| index.html / styles.css | Weboberfläche und bestehendes Design |
| app.js | Datenabruf, Normalisierung, Zeitzuordnung, Astronomie, Scores, Browserzustand und Darstellung |
| api/7timer.php | Serverseitiger 7Timer-Abruf und Cache |
| api/meteoblue.php | Serverseitiger meteoblue-Key, Paket-Fallbacks und Cache |
| dev_server.py | Lokale Proxy-Nachbildung für Entwicklung |
| manifest.webmanifest / sw.js | Installierbare Weboberfläche und App-Datei-Cache |
| tests/ | Deterministische Forecast- und Deployment-Prüfungen |
| scripts/ / .github/workflows/ | Automatische Branch-Deployments und Übernahme getesteter Inhalte |
| android/ / .github/workflows/android.yml | Native WebView-Hülle, gemeinsame gebündelte Webdateien und APK-Build ohne Website-Deployment |

Die fachliche Logik ist heute noch mit DOM, globalem state und Browser-APIs verbunden. Die VM-Testbasis ermöglicht Tests ohne Browser, ist aber keine fertig extrahierte gemeinsame Bibliothek.

## Richtung für weitere Clients

Bei künftigen funktionalen Änderungen schrittweise trennen:

1. Quellenadapter: Datenabruf, Schema-Normalisierung, Einheiten, Gültigkeit, Datenalter und native Auflösung.
2. Fachlicher Kern: Zeitzuordnung, Astronomie und Scores mit expliziten Eingaben und deterministischen Ausgaben.
3. Clients: Darstellung und Interaktion im Web, gegebenenfalls Android und CLI.
4. Betrieb: API-Key, Cache und Deployment bleiben ausserhalb des Clients.

Der Kern soll weder WordPress noch eine konkrete Website-Adresse oder DOM benötigen. Fehlende Werte, Quellenherkunft und Score-Gründe sollen Teil der Ergebnisse sein. Existierende Tests und Formeln sichern das Verhalten während einer späteren Trennung ab.

Android nutzt heute dieselbe app.js ohne duplizierte Berechnungen. WebViewAssetLoader stellt nur die erlaubten UI-Dateien unter dem HTTPS-Origin astro-foto.ch bereit; PHP-Anfragen gehen an die vorhandenen Produktions-Proxys. Berechtigungen gelten nur für diesen Origin. API-Key und serverseitige Konfiguration bleiben auf dem Server. Details stehen in ANDROID.md. Eine separate native Android-Oberfläche und die CLI-Integration sind noch nicht implementiert; vollständige Offline-Prognosen ebenfalls nicht.

## Verbindliche Entwicklungsregeln

- GitHub-Code ist die technische Ausgangsbasis; Funktionen und Design erhalten.
- Änderungen auf separaten Branches mit Pull Requests gegen test; Freigabe per Pull Request von test nach main; kein direkter Push auf main.
- Zusammengehörige Änderungen in einem PR bündeln.
- CI-Check baseline muss bestehen; main ist durch Ruleset geschützt.
- Änderungen an Anzeige oder Berechnung erhöhen die sichtbare App-Version und den Service-Worker-Cache-Namen.
- Dokumentation, Tests und Deployment-Infrastruktur allein erhöhen nicht die App-Version.
- Produktionsziel ist astro-foto.ch; Prüfung neuer Stände erfolgt über test.astro-foto.ch.
- Push auf test deployt automatisch auf die Testseite. Der Merge des geprüften Stands nach main ist die Produktionsfreigabe und startet das Produktionsdeployment. Produktion übernimmt nur den Dateiinhalt eines erfolgreichen Testdeployments.
- Zugangsdaten und API-Keys nie in das öffentliche Repository aufnehmen.
- Mondfunktion: Beleuchtung und Höhe über/unter dem Horizont; kein Ziel–Mond-Abstand.
- Android und CLI nicht ohne konkreten Auftrag implementieren.

## Offene technische Arbeiten

- Timeout des Frontends mit der sequenziellen meteoblue-Fallback-Kette abstimmen.
- Tatsächlichen kommenden Prognosehorizont korrekt behandeln.
- Wetter-Fallbackquelle, Datenalter und native Auflösung transparent anzeigen.
- Python- und PHP-Proxy-Verhalten angleichen.
- PWA-Cache, SunCalc-Ausfall, Touch-Layout und iframe-Höhe absichern.
- Live-API-/PHP-Integration und Browserlayout automatisiert testen.
- Fachlichen Kern bei Bedarf für weitere Clients trennen.

Diese Liste dokumentiert offene Arbeiten; sie ist keine Behauptung, dass die Änderungen bereits implementiert sind.
