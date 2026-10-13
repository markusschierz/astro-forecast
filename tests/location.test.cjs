const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/app.cjs');
const { weather, timer } = require('./fixtures/weather.cjs');

function response(data) { return { ok: true, json: async () => data }; }
function locationApp(overrides = {}) {
  const elements = { '#status': {}, '#gpsBtn': {addEventListener() {}} };
  const app = loadApp({ elements, ...overrides });
  return { app, elements };
}

test('GPS uses exact coordinates and provider timezone/elevation, including genuine zero', () => {
  const { app } = locationApp();
  const loc = app.gpsLocation({latitude: 0, longitude: 0, altitude: 800}, {timezone: 'UTC', elevation: 0});
  assert.equal(loc.latitude, 0);
  assert.equal(loc.longitude, 0);
  assert.equal(loc.elevation, 0);
  assert.equal(loc.timezone, 'UTC');
});

test('GPS rejects invalid coordinates and unavailable or invalid timezone', () => {
  const { app } = locationApp();
  for (const coords of [{latitude: null, longitude: 8}, {latitude: 91, longitude: 8}, {latitude: 47, longitude: -181}]) {
    assert.throws(() => app.gpsLocation(coords, {timezone: 'Europe/Zurich'}), /GPS/);
  }
  assert.throws(() => app.gpsLocation({latitude: 47, longitude: 8}, {}), /zeitzone/);
  assert.throws(() => app.gpsLocation({latitude: 47, longitude: 8}, {timezone: 'invalid'}));
  assert.equal(app.gpsLocation({latitude: 47, longitude: 8}, {timezone: 'Europe/Zurich'}).elevation, undefined);
});

test('GPS denial, unavailable position and timeout preserve manual location and permit retry', async () => {
  for (const code of [1, 2, 3]) {
    const { app, elements } = locationApp({navigator: {geolocation: {getCurrentPosition(success, fail) { fail({code}); }}}});
    const previous = app.state.location;
    await app.useGpsLocation();
    assert.equal(app.state.location, previous);
    assert.match(elements['#status'].textContent, /Suche eingeben/);
    assert.equal(elements['#gpsBtn'].disabled, false);
    app.selectLocation({...previous, name: 'Manuell'});
    assert.equal(app.state.location.name, 'Manuell');
  }
});

test('GPS without geolocation keeps manual entry available', async () => {
  const { app, elements } = locationApp();
  const previous = app.state.location;
  await app.useGpsLocation();
  assert.equal(app.state.location, previous);
  assert.match(elements['#status'].textContent, /GPS ist nicht verfügbar/);
});

test('changing location removes the previous forecast until new data is available', () => {
  const elements = { '#gpsBtn': {addEventListener() {}}, '#summary': {}, '#forecastCard': {}, '#details': {} };
  const { app } = locationApp({elements});
  app.state.weather = weather();
  app.state.astro = timer();
  app.state.rows = app.buildRows();
  assert.ok(app.state.rows.length > 0);
  app.selectLocation({...app.state.location, name: 'Neu'});
  assert.equal(app.state.rows.length, 0);
  assert.equal(app.state.weather, null);
  assert.equal(app.state.astro, null);
  for (const selector of ['#summary', '#forecastCard', '#details']) assert.equal(elements[selector].hidden, true);
});

test('GPS metadata failure leaves previous location unchanged', async () => {
  const { app, elements } = locationApp({
    navigator: {geolocation: {getCurrentPosition(success) { success({coords: {latitude: 47, longitude: 8}}); }}},
    fetch: async () => { throw new Error('Netzwerkfehler'); }
  });
  const previous = app.state.location;
  await app.useGpsLocation();
  assert.equal(app.state.location, previous);
  assert.match(elements['#status'].textContent, /Netzwerkfehler/);
  assert.equal(elements['#gpsBtn'].disabled, false);
});

test('late GPS coordinates cannot overwrite a newer manual selection', async () => {
  let gpsSuccess;
  const { app } = locationApp({navigator: {geolocation: {getCurrentPosition(success) { gpsSuccess = success; }}}});
  const pending = app.useGpsLocation();
  app.selectLocation({...app.state.location, name: 'Manuell'});
  gpsSuccess({coords: {latitude: 46, longitude: 7}});
  await pending;
  assert.equal(app.state.location.name, 'Manuell');
});

test('late GPS metadata cannot overwrite a newer manual selection', async () => {
  let resolveMetadata;
  const { app } = locationApp({
    navigator: {geolocation: {getCurrentPosition(success) { success({coords: {latitude: 46, longitude: 7}}); }}},
    fetch: () => new Promise(resolve => { resolveMetadata = resolve; })
  });
  const pending = app.useGpsLocation();
  await new Promise(resolve => setImmediate(resolve));
  app.selectLocation({...app.state.location, name: 'Manuell'});
  resolveMetadata(response({timezone: 'Europe/Zurich', elevation: 500}));
  await pending;
  assert.equal(app.state.location.name, 'Manuell');
});

test('successful GPS stores location, requests high accuracy and refreshes forecast', async () => {
  let options, stored;
  const { app, elements } = locationApp({
    navigator: {geolocation: {getCurrentPosition(success, fail, requestOptions) {
      options = requestOptions;
      success({coords: {latitude: 46.5, longitude: 7.5}});
    }}},
    localStorage: {getItem: () => null, setItem(key, value) { stored = JSON.parse(value); }},
    fetch: async url => response(url.includes('timezone=auto') ? {timezone: 'Europe/Zurich', elevation: 700}
      : url.includes('7timer') ? timer() : url.includes('meteoblue') ? {} : weather())
  });
  await app.useGpsLocation();
  assert.equal(options.enableHighAccuracy, true);
  assert.equal(app.state.location.latitude, 46.5);
  assert.equal(stored.longitude, 7.5);
  assert.equal(app.state.location.timezone, 'Europe/Zurich');
  assert.ok(app.state.rows.length > 0);
  assert.equal(elements['#gpsBtn'].disabled, false);
});

test('superseded refresh responses cannot overwrite a newer location forecast', async () => {
  const pendingFetches = [];
  const { app } = locationApp({fetch: url => new Promise(resolve => pendingFetches.push({url, resolve}))});
  const first = app.refresh();
  app.selectLocation({...app.state.location, name: 'Neu'});
  const second = app.refresh();
  const data = entry => entry.url.includes('7timer') ? timer() : entry.url.includes('meteoblue') ? {} : weather();
  for (const entry of pendingFetches.slice(4)) entry.resolve(response(data(entry)));
  await second;
  const latestWeather = app.state.weather;
  const latestRows = app.state.rows;
  for (const entry of pendingFetches.slice(0, 4)) entry.resolve(response(data(entry)));
  await first;
  assert.equal(app.state.location.name, 'Neu');
  assert.equal(app.state.weather, latestWeather);
  assert.equal(app.state.rows, latestRows);
});

test('Android startup skips service worker while HTTPS browser startup registers it', async () => {
  for (const search of ['?android=1', '']) {
    const events = {};
    let registrations = 0;
    locationApp({events, location: {protocol: 'https:', search},
      navigator: {serviceWorker: {register() { registrations++; return Promise.resolve(); }}},
      fetch: async url => response(url.includes('7timer') ? timer() : url.includes('meteoblue') ? {} : weather())
    });
    events.load();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(registrations, search ? 0 : 1);
  }
});
