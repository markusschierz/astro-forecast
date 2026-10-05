# Astro Forecast 2

Astrofotografie-Wettervorhersage für die Einbindung auf `test.astro-foto.ch` oder den lokalen Testbetrieb.

## Datenquellen

- **MeteoSwiss ICON-CH via Open-Meteo**: Temperatur, Feuchte, Taupunkt, Niederschlag, Wolken tief/mittel/hoch, Wind, Böen, Wolkenbasis, CAPE.
- **Open-Meteo Druckniveau-Daten**: Temperatur, Windgeschwindigkeit/-richtung, Geopotentialhöhe, Vertikalbewegung und Feuchte auf 850/700/500/300/250/200 hPa.
- **7Timer ASTRO**: explizites astronomisches Seeing und Transparenz für ungefähr 3 Tage.
- **SunCalc**: Sonne, Mond und astronomische Dunkelheit.

## Seeing-Logik

Astro Forecast erfindet aus der 7Timer-Klasse keine künstlich genaue Einzelzahl. Die Originalklassen werden als Bereiche angezeigt:

1. `<0.50″`
2. `0.50–0.75″`
3. `0.75–1.00″`
4. `1.00–1.25″`
5. `1.25–1.50″`
6. `1.50–2.00″`
7. `2.00–2.50″`
8. `>2.50″`

Zusätzlich wird ein unabhängiger **Seeing-Modellindikator 0–100** berechnet. Er berücksichtigt:

- potentielle Temperaturschichtung,
- Gradient-Richardson-Zahl,
- Windscherung zwischen Druckflächen,
- Jetstream auf 250/300 hPa,
- vertikale Luftbewegung,
- CAPE,
- Bodenwind.

Dieser Modellindikator ist absichtlich **keine Arcsec-Prognose**. Ohne ein optisches Turbulenzprofil (Cn²) wäre eine solche Zahl Scheingenauigkeit. Für 7Timer-Zeiten wird zusätzlich eine Konfidenz aus der Übereinstimmung beider Ansätze angezeigt.

## Lokal starten

Nicht mehr `python3 -m http.server` verwenden, weil dieser Server den 7Timer-Proxy nicht bereitstellt.

```bash
cd astro-forecast
python3 dev_server.py 8765
```

Dann öffnen:

```text
http://127.0.0.1:8765/
```

Der Entwicklungsserver bedient `/api/7timer.php` selbst und ruft 7Timer serverseitig auf.

## Auf test.astro-foto.ch installieren

Den kompletten Ordner `astro-forecast` in den Document Root der Subdomain kopieren, sodass folgendes existiert:

```text
https://test.astro-foto.ch/astro-forecast/
https://test.astro-foto.ch/astro-forecast/api/7timer.php?lat=47.499&lon=8.724
```

Der Webserver benötigt PHP mit entweder cURL oder aktivem `allow_url_fopen`. `api/7timer.php` validiert die Koordinaten und cached erfolgreiche Antworten 15 Minuten im System-Temp-Verzeichnis.

## WordPress-Einbindung

In einen Block **Individuelles HTML**:

```html
<div class="astro-forecast-frame">
  <iframe src="/astro-forecast/" title="Astro Forecast"></iframe>
</div>
```

CSS:

```css
.astro-forecast-frame { width: 100%; max-width: 100%; margin: 0 auto; }
.astro-forecast-frame iframe {
  display: block;
  width: 100%;
  height: 1200px;
  border: 0;
  border-radius: 1.5rem;
}
@media (max-width: 768px) {
  .astro-forecast-frame iframe { height: 1400px; border-radius: 1rem; }
}
```

## Hinweise

- 7Timer ASTRO selbst hat nur ungefähr 3 Tage Prognosehorizont. Die App zeigt danach weiterhin die vollständigen Wetter- und Atmosphärendaten, aber keine erfundene 7Timer-Arcsec-Zahl.
- Der Atmosphärenindikator bleibt für den gesamten gewählten 3/5/8-Tage-Horizont sichtbar, soweit die Druckniveau-Daten verfügbar sind.
- Die Vorhersage ist Modellrechnung, keine lokale Seeing-Messung.
