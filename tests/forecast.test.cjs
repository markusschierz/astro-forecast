const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/app.cjs');
const { weather, timer, meteoblue } = require('./fixtures/weather.cjs');

function forecast(overrides = {}, options = {}, mb = null, astro = timer()) {
  const app = loadApp(options);
  app.state.weather = weather(overrides);
  app.state.astro = astro;
  app.state.meteoblue = mb;
  return { app, row: app.buildRows()[0] };
}

test('Best Match fills missing ICON values per UTC hour and field', () => {
  const app = loadApp();
  const primary = weather({ cloud_cover: null, precipitation: null });
  const alternative = weather({ cloud_cover: 60, precipitation: 0.01, wind_speed_10m: 25 });
  const merged = app.mergeWeather(primary, alternative);
  assert.equal(merged.hourly.cloud_cover[0], 60);
  assert.equal(merged.hourly.precipitation[1], 0.01);
  assert.equal(merged.hourly.wind_speed_10m[0], 0);
  assert.equal(merged.sources.cloud_cover[0], 'Best Match');
  assert.equal(merged.sources.wind_speed_10m[0], 'MeteoSwiss');
  app.state.weatherPrimary = primary;
  app.state.weather = merged;
  app.state.astro = timer();
  const row = app.buildRows()[0];
  assert.ok(Number.isFinite(row.deep));
  assert.ok(Number.isFinite(row.planetary));
  assert.ok(Number.isNaN(row.cloud));
  assert.equal(row.cloudConsensus, 60);
  assert.equal(row.weatherSources.precipitation, 'Best Match');
});

test('Best Match aligns different time ranges and does not reuse preceding rain', () => {
  const app = loadApp();
  const primary = weather();
  primary.hourly.precipitation = [0, null];
  const alternative = weather({ precipitation: 0.1 });
  alternative.hourly.time = ['2026-10-12T23:00','2026-10-13T00:00'];
  const merged = app.mergeWeather(primary, alternative);
  assert.equal(merged.hourly.precipitation[0], 0);
  assert.equal(merged.hourly.precipitation[1], 0.1);
  assert.equal(merged.sources.precipitation[1], 'Best Match');
  app.state.weather = merged;
  app.state.astro = timer();
  const row = app.buildRows()[0];
  assert.equal(row.precip, 0.1);
  assert.equal(row.deep, 0);
  assert.equal(row.planetary, 0);
});

test('missing precipitation in both models remains unknown', () => {
  const app = loadApp();
  const primary = weather({ precipitation: null });
  const alternate = weather({ precipitation: null });
  app.state.weather = app.mergeWeather(primary, alternate);
  app.state.astro = timer();
  assert.ok(Number.isNaN(app.buildRows()[0].deep));
});

test('clear dark sky with direct seeing and transparency is excellent', () => {
  const { row } = forecast();
  assert.equal(row.deep, 100);
  assert.equal(row.planetary, 100);
});
test('100 percent cloud cover blocks both scores', () => {
  const { row } = forecast({ cloud_cover: 100 });
  assert.equal(row.deep, 0); assert.equal(row.planetary, 0);
});
test('90 percent cloud cover caps both scores at ten', () => {
  const { row } = forecast({ cloud_cover: 90 });
  assert.ok(row.deep <= 10); assert.ok(row.planetary <= 10);
});
test('100 percent fog blocks a cloud-free forecast', () => {
  const { row } = forecast({}, {}, meteoblue({ fog: 100 }));
  assert.equal(row.deep, 0); assert.equal(row.planetary, 0);
});
test('overlapping clouds and fog are not multiplied twice', () => {
  const { row } = forecast({ cloud_cover: 50 }, {}, meteoblue({ cloud: 50, fog: 50 }));
  assert.equal(row.deep, 50); assert.equal(row.planetary, 50);
});
test('precipitation threshold and higher amounts block both scores', () => {
  for (const amount of [0.05, 0.1, 1]) {
    const { row } = forecast({ precipitation: amount });
    assert.equal(row.deep, 0); assert.equal(row.planetary, 0);
  }
});
test('precipitation probability reduces both scores monotonically', () => {
  const rows = [0, 25, 50, 75, 100].map(pop => forecast({ precipitation_probability: pop }).row);
  for (let i = 1; i < rows.length; i++) {
    assert.ok(rows[i].deep < rows[i - 1].deep);
    assert.ok(rows[i].planetary < rows[i - 1].planetary);
  }
  assert.equal(rows.at(-1).deep, 0);
});
test('dew point changes operational risk without changing scores', () => {
  const dry = forecast({ dew_point_2m: 0 }).row;
  const wet = forecast({ dew_point_2m: 10 }).row;
  assert.notEqual(dry.dewQ, wet.dewQ);
  assert.equal(dry.deep, wet.deep); assert.equal(dry.planetary, wet.planetary);
});
test('moon below horizon has no light penalty', () => {
  const app = loadApp();
  assert.equal(app.moonPenalty(-10, 1), 0);
  assert.equal(app.moonPenalty(0, 1), 0);
  assert.equal(app.moonPenalty(90, 1), 100);
});
test('moon above horizon affects Deep Sky but not Planetary', () => {
  const below = forecast({}, { moonAlt: -10, illumination: 1 }).row;
  const above = forecast({}, { moonAlt: 90, illumination: 1 }).row;
  assert.ok(above.deep < below.deep);
  assert.equal(above.planetary, below.planetary);
});
test('meteoblue direct seeing takes priority over 7Timer', () => {
  const { row } = forecast({}, {}, meteoblue({ seeing: 2.8 }), timer(1));
  assert.equal(row.planetary, 20);
});
test('7Timer supplies seeing when meteoblue is absent', () => {
  assert.ok(forecast({}, {}, null, timer(8)).row.planetary < forecast().row.planetary);
});
test('scores stay within 0..100 across representative conditions', () => {
  for (const cloud of [0, 50, 100]) for (const pop of [0, 50, 100]) {
    const { row } = forecast({ cloud_cover: cloud, precipitation_probability: pop });
    for (const score of [row.deep, row.planetary]) assert.ok(Number.isFinite(score) && score >= 0 && score <= 100);
  }
});
test('horizon starts at the current hour and respects selected length', () => {
  const app = loadApp();
  app.state.hours = 2;
  app.state.rows = [11, 12, 13, 14].map(hour => ({ dateUtc: new Date(`2026-10-12T${hour}:00:00Z`) }));
  assert.deepEqual(Array.from(app.horizonRows(), row => row.dateUtc.getUTCHours()), [12, 13]);
});
test('night filter includes adjacent sunrise and sunset hours only', () => {
  const app = loadApp({ now: '2026-10-12T00:00:00Z' });
  app.state.rows = [10, 5, -1, -10, -1, 5, 10].map((sunAlt, hour) => ({
    sunAlt, dateUtc: new Date(Date.UTC(2026, 9, 12, hour))
  }));
  assert.deepEqual(Array.from(app.visibleRows(), row => row.dateUtc.getUTCHours()), [1, 2, 3, 4, 5]);
});
test('post-midnight hours belong to the preceding night', () => {
  const app = loadApp();
  const rows = [{ localTime: '2026-10-12T22:00' }, { localTime: '2026-10-13T02:00' }, { localTime: '2026-10-13T22:00' }];
  const groups = app.groupNights(rows);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].key, '2026-10-12');
  assert.equal(groups[0].rows.length, 2);
});
test('3h source lookup uses nearest sample and bounded tolerance', () => {
  const app = loadApp();
  const map = app.meteoblueIndex({ time: ['2026-10-12T21:00:00Z', '2026-10-13T00:00:00Z'] });
  assert.equal(app.nearestIndex(map, new Date('2026-10-12T22:00:00Z'), 2), 0);
  assert.equal(app.nearestIndex(map, new Date('2026-10-12T23:00:00Z'), 2), 1);
  assert.equal(app.nearestIndex(map, new Date('2026-10-13T05:00:00Z'), 2), undefined);
});
test('night table shows illumination, signed moon altitude and dew beneath moon', () => {
  const { app, row } = forecast({}, { moonAlt: -10, illumination: 0.5 });
  const html = app.renderNightTable([row], 0);
  assert.match(html, /50% · -10°/);
  assert.ok(html.indexOf('Tau-Risiko') > html.indexOf('Mond'));
});
test('missing cloud values suppress scores instead of implying clear sky', () => {
  for (const value of [null, undefined, '', ' ', false, -9999, NaN]) {
    const { row } = forecast({ cloud_cover: value });
    assert.ok(Number.isNaN(row.cloud));
    assert.ok(Number.isNaN(row.deep)); assert.ok(Number.isNaN(row.planetary));
  }
});
test('a valid alternate cloud source remains usable', () => {
  const { row } = forecast({ cloud_cover: null }, {}, meteoblue({ cloud: 100 }));
  assert.equal(row.cloudConsensus, 100);
  assert.equal(row.deep, 0); assert.equal(row.planetary, 0);
});
test('missing precipitation amount or probability suppresses optimistic scores', () => {
  for (const key of ['precipitation', 'precipitation_probability']) {
    const { row } = forecast({ [key]: null });
    assert.ok(Number.isNaN(row.deep)); assert.ok(Number.isNaN(row.planetary));
  }
});
test('known showstoppers retain zero scores despite another missing gate input', () => {
  for (const overrides of [
    { cloud_cover: 100, precipitation: null },
    { cloud_cover: null, precipitation: 0.05 },
    { precipitation: null, precipitation_probability: 100 }
  ]) {
    const { row } = forecast(overrides);
    assert.equal(row.deep, 0); assert.equal(row.planetary, 0);
  }
});
test('null meteoblue seeing falls back to valid 7Timer seeing', () => {
  const { row } = forecast({}, {}, meteoblue({ seeing: null }), timer(8));
  assert.ok(Number.isNaN(row.mbSeeing));
  assert.equal(row.planetary, 20);
});
test('no seeing source leaves Planetary unknown instead of reweighting wind and darkness', () => {
  const { row } = forecast({}, {}, null, null);
  assert.ok(Number.isNaN(row.planetary));
  assert.ok(Number.isFinite(row.deep));
});
test('missing dew data stays unknown operational information', () => {
  const { row } = forecast({ dew_point_2m: null });
  assert.ok(Number.isNaN(row.dewQ));
  assert.equal(row.deep, 100);
});
test('numeric strings and genuine zero weather values remain usable', () => {
  const { row } = forecast({ cloud_cover: '0', precipitation: '0', precipitation_probability: '0' });
  assert.equal(row.deep, 100); assert.equal(row.planetary, 100);
});
test('unknown scores render a neutral dash and never NaN', () => {
  const { app, row } = forecast({ cloud_cover: null });
  const html = app.renderNightTable([row], 0);
  assert.doesNotMatch(html, /NaN/);
  assert.match(html, /<td class="score"[^>]*>—<\/td>/);
});
test('summary chooses finite scores and has no best hour when all are unknown', () => {
  const app = loadApp();
  const rows = [{ deep: NaN }, { deep: 80 }, { deep: 60 }];
  assert.equal(app.bestBy(rows, r => r.deep), rows[1]);
  assert.equal(app.bestBy([{ deep: NaN }], r => r.deep), null);
});
test('null pressure profiles cannot fabricate an atmosphere seeing source', () => {
  const { app } = forecast();
  const profile = {};
  for (const p of [850,700,500,300,250,200]) {
    for (const key of ['geopotential_height','temperature','wind_speed','wind_direction']) {
      profile[key + '_' + p + 'hPa'] = null;
    }
  }
  assert.ok(Number.isNaN(app.atmosphereDiagnostics(profile, {}).quality));
});
test('zero or invalid meteoblue seeing never replaces a valid 7Timer source', () => {
  for (const seeing of [0, '', false, -9999, 'invalid']) {
    const { row } = forecast({}, {}, meteoblue({ seeing }), timer(8));
    assert.ok(Number.isNaN(row.mbSeeing));
    assert.equal(row.planetary, 20);
  }
});
test('DST repeated and skipped local hours preserve absolute forecast windows', () => {
  for (const [times, labels] of [
    [['2026-10-25T00:00Z','2026-10-25T01:00Z','2026-10-25T02:00Z'], ['02:00','02:00','03:00']],
    [['2026-03-29T00:00Z','2026-03-29T01:00Z','2026-03-29T02:00Z'], ['01:00','03:00','04:00']]
  ]) {
    const app = windowApp(times, {precipitation: [0, 0.05, 0]});
    app.state.location.timezone = 'Europe/Zurich';
    const rows = app.buildRows();
    assert.deepEqual(Array.from(rows, r => r.localTime.slice(11)), labels);
    assert.equal(rows[0].precip, 0.05); assert.equal(rows[1].precip, 0);
    assert.equal(rows[1].dateUtc - rows[0].dateUtc, 3600e3);
    assert.equal(rows[0].dateEndUtc.getTime(), rows[1].dateUtc.getTime());
    assert.equal(app.groupNights(rows).length, 1);
  }
});



test('Planetary remains independent of solar altitude through twilight', () => {
  for (const sunAlt of [-20, -12, -6, -2, 5]) {
    assert.equal(forecast({}, { sunAlt }).row.planetary, 100);
  }
});
test('fallback transparency ignores cloud layers while total clouds still gate scores', () => {
  const clear = forecast({}, {}, null, timer(1, null)).row;
  const high = forecast({ cloud_cover_high: 100 }, {}, null, timer(1, null)).row;
  const cloudy = forecast({ cloud_cover: 50, cloud_cover_high: 100 }, {}, null, timer(1, null)).row;
  assert.equal(clear.transQ, high.transQ);
  assert.equal(clear.deep, high.deep);
  assert.equal(cloudy.transQ, clear.transQ);
  assert.equal(cloudy.deep, 50);
});
test('Deep Sky full overhead moon costs twenty points', () => {
  assert.equal(forecast({}, { moonAlt: 90, illumination: 1 }).row.deep, 80);
});

function windowApp(times, overrides = {}) {
  const app = loadApp();
  app.state.location.timezone = 'UTC';
  app.state.weather = weather();
  const wh = app.state.weather.hourly;
  wh.time = times.map(t => Date.parse(t) / 1000);
  for (const key of Object.keys(wh)) {
    if (key !== 'time') wh[key] = times.map(() => wh[key][0]);
  }
  Object.assign(wh, overrides);
  app.state.astro = timer();
  return app;
}

test('rain and displayed amount belong to the starting hour, not the preceding hour', () => {
  const app = windowApp(['2026-10-12T21:00Z','2026-10-12T22:00Z','2026-10-12T23:00Z'], {
    precipitation: [0, 0.05, 0], cloud_cover: [0, 30, 80], temperature_2m: [10, 11, 12]
  });
  const rows = app.buildRows();
  assert.equal(rows[0].precip, 0.05);
  assert.equal(rows[0].deep, 0); assert.equal(rows[0].planetary, 0);
  assert.equal(rows[1].precip, 0);
  assert.equal(rows[1].cloud, 30); assert.equal(rows[1].temp, 11);
  assert.equal(rows[1].deep, 70); assert.equal(rows[1].planetary, 70);
  assert.match(app.renderNightTable([rows[0]], 0), /class="c-bad"[^>]*>0\.05 mm \/ 0%/);
  assert.match(app.renderNightTable([rows[0]], 0), /title="21:00–21:59"/);
});
test('precipitation probability gates the same window shown in the table', () => {
  const app = windowApp(['2026-10-12T22:00Z','2026-10-12T23:00Z'], {
    precipitation_probability: [100, 50]
  });
  const row = app.buildRows()[0];
  assert.equal(row.pop, 50);
  assert.equal(row.deep, 25); assert.equal(row.planetary, 25);
  assert.match(app.renderNightTable([row], 0), /0\.00 mm \/ 50%/);
});
test('gust maximum affects display and scores in its own window', () => {
  const app = windowApp(['2026-10-12T22:00Z','2026-10-12T23:00Z'], {
    wind_gusts_10m: [0, 45]
  });
  const row = app.buildRows()[0];
  assert.equal(row.gust, 45);
  assert.equal(row.deep, 95); assert.equal(row.planetary, 94);
  assert.match(app.renderNightTable([row], 0), />45 km\/h</);
});
test('midnight end aggregate is assigned to the previous starting hour', () => {
  const app = windowApp(['2026-10-12T23:00Z','2026-10-13T00:00Z'], { precipitation: [0, 0.05] });
  const row = app.buildRows()[0];
  assert.equal(row.localTime, '2026-10-12T23:00');
  assert.equal(row.dateEndUtc.toISOString(), '2026-10-13T00:00:00.000Z');
  assert.equal(row.deep, 0);
  assert.equal(app.hourIntervalLabel(row), '23:00–23:59');
});
test('missing end or a two-hour gap cannot reuse a previous-hour aggregate', () => {
  for (const times of [
    ['2026-10-12T22:00Z'],
    ['2026-10-12T22:00Z','2026-10-13T00:00Z']
  ]) {
    const app = windowApp(times, { precipitation: times.map(() => 0) });
    const row = app.buildRows()[0];
    for (const key of ['precip','pop','gust','deep','planetary']) assert.ok(Number.isNaN(row[key]), key);
  }
});
test('absolute timestamps align upper-air values despite different response offsets', () => {
  const app = windowApp(['2026-10-12T22:00Z','2026-10-12T23:00Z']);
  app.state.astro = null;
  app.state.weather.hourly.relative_humidity_2m = [98, 98];
  app.state.upperAir = {utc_offset_seconds: 7200, hourly: {
    time: ['2026-10-13T00:00'], relative_humidity_700hPa: [35]
  }};
  assert.equal(app.buildRows()[0].transQ, 50);
});
test('API requests use UTC unix timestamps for both weather and upper air', () => {
  const app = loadApp();
  for (const url of [app.weatherUrl(app.state.location), app.upperAirUrl(app.state.location)]) {
    const params = new URLSearchParams(url.split('?')[1]);
    assert.equal(params.get('timezone'), 'UTC');
    assert.equal(params.get('timeformat'), 'unixtime');
  }
});
