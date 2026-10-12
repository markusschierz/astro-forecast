function weather(overrides = {}) {
  const values = {
    temperature_2m: 10, dew_point_2m: 5, relative_humidity_2m: 50,
    wind_speed_10m: 0, wind_gusts_10m: 0,
    cloud_cover: 0, cloud_cover_low: 0, cloud_cover_mid: 0, cloud_cover_high: 0,
    precipitation: 0, precipitation_probability: 0, cape: 0,
    ...overrides
  };
  return {
    utc_offset_seconds: 0,
    hourly: {
      time: ['2026-10-12T22:00'],
      ...Object.fromEntries(Object.entries(values).map(([key, value]) => [key, [value]]))
    }
  };
}
function timer(seeing = 1, transparency = 1) {
  return { init: '2026101218', dataseries: [{ timepoint: 4, seeing, transparency }] };
}
function meteoblue({ cloud = 0, fog = 0, seeing = 0.5 } = {}) {
  return {
    free: { ok: true, _packages: 'clouds-1h,air-1h', data: {
      data_1h: { time: ['2026-10-12T22:00:00Z'], cloudcover: [cloud], fog_probability: [fog] }
    } },
    seeing: { ok: true, data: {
      data_1h: { time: ['2026-10-12T22:00:00Z'], seeing_arcsec: [seeing] }
    } }
  };
}
module.exports = { weather, timer, meteoblue };
