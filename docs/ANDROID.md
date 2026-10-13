# Android-DEV-Version für Sideloading

Die Android-App bündelt die bestehende Weboberfläche aus diesem Repository in einer WebView. Forecast-Berechnungen und Scores bleiben gemeinsam mit dem Webclient. Es gibt keine zweite Kopie der fachlichen Logik.

## Funktionen und Daten

- Hoch- und Querformat ohne feste Orientierung. Die WebView bleibt beim Drehen erhalten; Standort, Tabellen und laufende Abfragen werden nicht neu geladen. Androids automatische Bildschirmdrehung muss aktiviert sein.
- „GPS-Standort verwenden“ fragt den Gerätestandort nach Nutzeraktion ab. Android fragt bei Bedarf nach einer Standortberechtigung. Präziser und ungefährer Standort funktionieren; für den genauen Beobachtungsplatz präzisen Standort erlauben.
- Die manuelle Ort-/PLZ-Suche bleibt unabhängig von GPS verfügbar, auch nach Ablehnung oder Timeout. Der zuletzt gewählte Standort wird lokal gespeichert.
- Zeitzone und Geländehöhe für GPS-Koordinaten werden von Open-Meteo geladen. Ohne Zeitzone bleibt der bisherige Standort erhalten; die App erklärt den Fehler. Eine fehlende Geländehöhe bleibt unbekannt.
- Systemleisten, Kameraausschnitt und Bildschirmtastatur werden bei der Darstellung berücksichtigt.

Die APK enthält ausschließlich index.html, app.js, styles.css, Manifest und Icons. Der Build kopiert sie direkt aus dem Webclient. PHP, serverseitige Konfiguration und API-Keys werden nicht eingebettet. Die App nutzt die Produktions-Proxys unter https://astro-foto.ch/astro-forecast/api/; Wetterquellen bleiben online. SunCalc wird wie im Webclient vom CDN geladen. Ein Internetzugang ist erforderlich; es gibt keine vollständige Offline-Prognose. Der Service Worker ist in der APK deaktiviert, damit er keine andere Version über die gebündelte Oberfläche legt.

## APK bauen

Voraussetzungen: JDK 17, Android SDK mit Plattform 36, Build Tools 36.0.0 und Internetzugang für Build-Abhängigkeiten. Den Ordner android/ als Projekt in Android Studio öffnen, SDK-Pakete installieren und Gradle synchronisieren. Alternativ mit JAVA_HOME und ANDROID_HOME:

```powershell
cd android
.\gradlew.bat assembleDebug lintDebug
```

Unter Linux/macOS: bash ./gradlew assembleDebug lintDebug. Der Gradle-Wrapper lädt die festgelegte Gradle-Version. Ergebnis: android/app/build/outputs/apk/debug/app-debug.apk.

Der Workflow „Build Android APK“ prüft die gemeinsame App, baut und lintet die APK und stellt sie als Artifact astro-forecast-android-dev bereit. Er deployt keine Website und veröffentlicht keine App im Play Store. Er läuft für passende Änderungen auf develop/*, bei Pull Requests und manuell.

## Auf dem Pixel 8 Pro installieren

1. app-debug.apk auf das Pixel übertragen und im Dateimanager öffnen.
2. Falls Android danach fragt, „Unbekannte Apps installieren“ für den verwendeten Dateimanager erlauben und die Installation fortsetzen.
3. „Astro Forecast DEV“ öffnen. Manuelle Suche ausprobieren, dann GPS-Knopf drücken und Standortberechtigung erteilen.

Alternativ USB-Debugging aktivieren und mit den Android Platform Tools installieren:

```text
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

Diese APK ist mit einem Debug-Zertifikat signiert und für persönliche Entwicklung gedacht. Updates benötigen denselben Signierschlüssel. Lokal erzeugte Debug-Builds behalten üblicherweise den Schlüssel unter dem Benutzerprofil; GitHub-Runner erzeugen pro frischer Umgebung einen anderen Schlüssel. Eine APK mit anderem Schlüssel kann eine bestehende Installation nicht aktualisieren. Eine Neuinstallation nach Deinstallation verliert den gespeicherten Standort. Für dauerhaft aktualisierbare Releases später einen eigenen Signierschlüssel außerhalb von Git verwenden.

## Prüfung auf dem Gerät

- Hoch-/Querformat wechseln, inklusive offener Details und Standortsuche; Inhalte und gewählter Standort bleiben erhalten.
- GPS genau/ungefähr erlauben; GPS verweigern; Standortdienste deaktivieren; erneut versuchen. Manuelle Suche muss immer nutzbar bleiben.
- Während einer GPS-Abfrage einen anderen Ort manuell wählen; verspätetes GPS darf ihn nicht überschreiben.
- Nach GPS die App schließen und erneut öffnen; Standort bleibt gespeichert.
- Tastatur, Gestennavigation und Kameraausschnitt dürfen Bedienelemente nicht verdecken. Prognosetabellen bleiben horizontal scrollbar.
- Ohne Netzwerk müssen Fehler nachvollziehbar sein; unbekannte Wetterdaten dürfen keine guten Scores erzeugen.

Ein erfolgreicher Build und die automatisierten Tests ersetzen diese Pixel-Prüfung nicht.
