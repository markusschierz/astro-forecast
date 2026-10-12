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
  assert.equal(row.planetary, 30);
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
test.todo('missing/null weather values must not imply clear dry conditions (follow-up fix)');
test.todo('DST transition must preserve distinct UTC hours (follow-up fix)');
test.todo('superseded refresh responses must not overwrite a newer location (follow-up fix)');
