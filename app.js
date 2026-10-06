'use strict';

const DEFAULT_LOCATION = {
  name: 'Winterthur', latitude: 47.4988, longitude: 8.7241, elevation: 439,
  country: 'Schweiz', timezone: 'Europe/Zurich'
};

const state = {
  location: loadLocation() || DEFAULT_LOCATION,
  hours: 72,
  weather: null,
  upperAir: null,
  astro: null,
  meteoblue: null,
  rows: []
};

const $ = (sel) => document.querySelector(sel);
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const lerp = (a, b, t) => a + (b - a) * t;
const finite = (v) => Number.isFinite(Number(v));

function loadLocation() {
  try { const raw = localStorage.getItem('astroForecastLocation'); return raw ? JSON.parse(raw) : null; }
  catch { return null; }
}
function saveLocation(loc) { try { localStorage.setItem('astroForecastLocation', JSON.stringify(loc)); } catch {} }

function formatLocal(date, options = {}) {
  return new Intl.DateTimeFormat('de-CH', {
    timeZone: state.location.timezone || 'Europe/Zurich', ...options
  }).format(date);
}
function isoHourUTC(date) { return date.toISOString().slice(0, 13); }

function scoreClass(value) {
  if (value >= 85) return 'c-excellent';
  if (value >= 70) return 'c-good';
  if (value >= 50) return 'c-fair';
  if (value >= 30) return 'c-poor';
  return 'c-bad';
}
function percentQuality(v) { return clamp(100 - Number(v || 0), 0, 100); }
function scaleQuality(value, good, bad) {
  if (!Number.isFinite(value)) return 50;
  if (bad === good) return 50;
  return clamp(100 * (1 - (value - good) / (bad - good)), 0, 100);
}
function weighted(values) {
  let sum = 0, weight = 0;
  for (const [v, w] of values) if (Number.isFinite(v)) { sum += v * w; weight += w; }
  return weight ? sum / weight : 0;
}

const SEEING = {
  1: {label:'<0.50″', min:0.30, max:0.50, representative:0.42},
  2: {label:'0.50–0.75″', min:0.50, max:0.75, representative:0.625},
  3: {label:'0.75–1.00″', min:0.75, max:1.00, representative:0.875},
  4: {label:'1.00–1.25″', min:1.00, max:1.25, representative:1.125},
  5: {label:'1.25–1.50″', min:1.25, max:1.50, representative:1.375},
  6: {label:'1.50–2.00″', min:1.50, max:2.00, representative:1.75},
  7: {label:'2.00–2.50″', min:2.00, max:2.50, representative:2.25},
  8: {label:'>2.50″', min:2.50, max:3.50, representative:2.8}
};
function seeingInfo(index) { return SEEING[Number(index)] || null; }
function seeingQualityFromIndex(index) {
  const info = seeingInfo(index);
  return info ? scaleQuality(info.representative, 0.55, 2.8) : NaN;
}
function transparencyQuality(index) {
  if (!Number.isFinite(index) || index < 1 || index > 8) return NaN;
  return clamp(100 - (index - 1) * (100 / 7), 0, 100);
}
function dewQuality(temp, dew, rh) {
  const spread = temp - dew;
  let q = 100 - scaleQuality(spread, 0.5, 7.0);
  if (rh >= 95) q = Math.min(q, 15);
  else if (rh >= 90) q = Math.min(q, 35);
  else if (rh >= 85) q = Math.min(q, 55);
  return clamp(q, 0, 100);
}
function moonPenalty(moonAltDeg, illumination) {
  if (!Number.isFinite(moonAltDeg) || moonAltDeg <= 0) return 0;
  return 100 * illumination * clamp(Math.sin(moonAltDeg * Math.PI / 180), 0, 1);
}
function darknessQuality(sunAlt) {
  if (sunAlt <= -18) return 100;
  if (sunAlt <= -12) return lerp(75, 100, (-sunAlt - 12) / 6);
  if (sunAlt <= -6) return lerp(35, 75, (-sunAlt - 6) / 6);
  if (sunAlt <= 0) return lerp(0, 35, -sunAlt / 6);
  return 0;
}

function weatherUrl(loc, useMeteoswiss = true) {
  const p = new URLSearchParams({
    latitude: loc.latitude,
    longitude: loc.longitude,
    hourly: [
      'temperature_2m','relative_humidity_2m','dew_point_2m',
      'precipitation_probability','precipitation',
      'cloud_cover','cloud_cover_low','cloud_cover_mid','cloud_cover_high',
      'wind_speed_10m','wind_gusts_10m','cloud_base','cape'
    ].join(','),
    timezone: 'auto', forecast_days: '8'
  });
  if (finite(loc.elevation)) p.set('elevation', loc.elevation);
  if (useMeteoswiss) p.set('models', 'meteoswiss_icon_seamless');
  return `https://api.open-meteo.com/v1/forecast?${p}`;
}

function upperAirUrl(loc) {
  const levels = [850,700,500,300,250,200];
  const vars = [];
  for (const p of levels) {
    vars.push(`temperature_${p}hPa`,`wind_speed_${p}hPa`,`wind_direction_${p}hPa`,
              `geopotential_height_${p}hPa`,`vertical_velocity_${p}hPa`,`relative_humidity_${p}hPa`);
  }
  const q = new URLSearchParams({
    latitude: loc.latitude,
    longitude: loc.longitude,
    hourly: vars.join(','),
    timezone: 'auto', forecast_days: '8', wind_speed_unit: 'ms'
  });
  return `https://api.open-meteo.com/v1/forecast?${q}`;
}

function astroProxyUrl(loc) {
  const p = new URLSearchParams({ lon: Number(loc.longitude).toFixed(3), lat: Number(loc.latitude).toFixed(3) });
  return `api/7timer.php?${p}`;
}

function meteoblueProxyUrl(loc) {
  const params = { lon: Number(loc.longitude).toFixed(5), lat: Number(loc.latitude).toFixed(5) };
  if (finite(loc.elevation)) params.asl = Math.round(Number(loc.elevation));
  return `api/meteoblue.php?${new URLSearchParams(params)}`;
}

function normalizedKey(s) { return String(s).toLowerCase().replace(/[^a-z0-9]/g, ''); }
function pickSeries(section, candidates = [], matcher = null) {
  if (!section || typeof section !== 'object') return null;
  const entries = Object.entries(section).filter(([k,v]) => k !== 'time' && Array.isArray(v));
  const candidateKeys = candidates.map(normalizedKey);
  for (const [k,v] of entries) if (candidateKeys.includes(normalizedKey(k))) return v;
  if (matcher) {
    for (const [k,v] of entries) if (matcher(normalizedKey(k), k)) return v;
  }
  return null;
}
function seriesValue(series, i) {
  const v = series?.[i];
  return Number.isFinite(Number(v)) ? Number(v) : NaN;
}
function meteoblueIndex(section) {
  const map = new Map();
  if (!section?.time || !Array.isArray(section.time)) return map;
  for (let i=0; i<section.time.length; i++) {
    const d = new Date(section.time[i]);
    if (!Number.isNaN(d.getTime())) map.set(isoHourUTC(d), i);
  }
  return map;
}
function nearestIndex(map, dateUtc, maxHours = 0) {
  const direct = map.get(isoHourUTC(dateUtc));
  if (direct !== undefined) return direct;
  for (let h=1; h<=maxHours; h++) {
    for (const sign of [-1, 1]) {
      const idx = map.get(isoHourUTC(new Date(dateUtc.getTime() + sign*h*3600e3)));
      if (idx !== undefined) return idx;
    }
  }
  return undefined;
}
function conservativeCloud(a, b) {
  const aa = Number(a), bb = Number(b);
  if (Number.isFinite(aa) && Number.isFinite(bb)) return 0.65 * Math.max(aa, bb) + 0.35 * Math.min(aa, bb);
  if (Number.isFinite(aa)) return aa;
  if (Number.isFinite(bb)) return bb;
  return NaN;
}
function seeingAgreement(mbSeeing, timerIndex, modelQuality) {
  if (Number.isFinite(mbSeeing) && seeingInfo(timerIndex)) {
    const delta = Math.abs(mbSeeing - seeingInfo(timerIndex).representative);
    if (delta <= 0.30) return 'hoch';
    if (delta <= 0.65) return 'mittel';
    return 'niedrig';
  }
  if (Number.isFinite(mbSeeing) && Number.isFinite(modelQuality)) {
    const delta = Math.abs(scaleQuality(mbSeeing, 0.55, 2.8) - modelQuality);
    if (delta <= 14) return 'hoch';
    if (delta <= 28) return 'mittel';
    return 'niedrig';
  }
  return seeingConfidence(timerIndex, modelQuality);
}

async function fetchJson(url, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {signal: ctrl.signal, cache: 'no-store'});
    let data;
    try { data = await r.json(); } catch { throw new Error(`Ungültige JSON-Antwort (${r.status})`); }
    if (!r.ok) throw new Error(data?.message || `HTTP ${r.status}`);
    if (data?.error) throw new Error(data.message || data.reason || 'API-Fehler');
    return data;
  } finally { clearTimeout(timer); }
}

async function fetchWeather(loc) {
  try { return await fetchJson(weatherUrl(loc, true)); }
  catch (err) {
    console.warn('MeteoSwiss ICON-CH explizit fehlgeschlagen, Best Match wird verwendet.', err);
    return fetchJson(weatherUrl(loc, false));
  }
}

async function refresh() {
  setStatus('Daten werden geladen…');
  renderLocation();
  try {
    const [weatherResult, upperResult, astroResult, meteoblueResult] = await Promise.allSettled([
      fetchWeather(state.location),
      fetchJson(upperAirUrl(state.location)),
      fetchJson(astroProxyUrl(state.location), 15000),
      fetchJson(meteoblueProxyUrl(state.location), 18000)
    ]);
    if (weatherResult.status !== 'fulfilled') throw weatherResult.reason;
    state.weather = weatherResult.value;
    state.upperAir = upperResult.status === 'fulfilled' ? upperResult.value : null;
    state.astro = astroResult.status === 'fulfilled' ? astroResult.value : null;
    state.meteoblue = meteoblueResult.status === 'fulfilled' ? meteoblueResult.value : null;
    state.rows = buildRows();
    renderAll();

    const notes = ['MeteoSwiss-Wetter geladen'];
    notes.push(state.upperAir ? 'Atmosphärenprofil geladen' : 'Atmosphärenprofil nicht verfügbar');
    notes.push(state.astro ? '7Timer ASTRO geladen' : '7Timer ASTRO nicht verfügbar');
    const mbFree = state.meteoblue?.free;
    const mbSeeing = state.meteoblue?.seeing;
    if (mbFree?.ok) notes.push('meteoblue Clouds/Air geladen');
    else if (state.meteoblue) notes.push(`meteoblue Free-Pakete nicht verfügbar${mbFree?.status ? ` (HTTP ${mbFree.status})` : ''}`);
    else notes.push('meteoblue nicht konfiguriert/erreichbar');
    if (mbSeeing?.ok) notes.push('meteoblue Seeing geladen');
    else if (state.meteoblue) notes.push(mbSeeing?.status === 403 ? 'meteoblue Seeing nicht freigeschaltet' : 'meteoblue Seeing nicht verfügbar');
    if (!mbSeeing?.ok && !state.astro) notes.push('Keine direkte Seeing-Quelle; nur separater Atmosphärenindikator');
    setStatus(notes.join(' · '), state.upperAir ? 'ok' : '');
    $('#updatedAt').textContent = `Aktualisiert ${formatLocal(new Date(), {hour:'2-digit', minute:'2-digit'})}`;
  } catch (err) {
    console.error(err);
    setStatus(`Fehler beim Laden der Vorhersage: ${err.message || err}`, 'error');
  }
}

function buildAstroIndex() {
  const map = new Map();
  if (!state.astro?.init || !Array.isArray(state.astro.dataseries)) return map;
  const init = String(state.astro.init);
  const start = Date.UTC(Number(init.slice(0,4)), Number(init.slice(4,6))-1, Number(init.slice(6,8)), Number(init.slice(8,10)), 0, 0);
  for (const item of state.astro.dataseries) {
    const t = new Date(start + Number(item.timepoint) * 3600e3);
    map.set(isoHourUTC(t), item);
  }
  return map;
}
function buildHourlyIndex(data) {
  const map = new Map();
  if (!data?.hourly?.time) return map;
  const keys = Object.keys(data.hourly).filter(k => k !== 'time');
  for (let i=0; i<data.hourly.time.length; i++) {
    const row = {time:data.hourly.time[i]};
    for (const k of keys) row[k] = data.hourly[k]?.[i];
    map.set(data.hourly.time[i], row);
  }
  return map;
}
function sunMoon(dateUtc) {
  if (!window.SunCalc) return {sunAlt:NaN, moonAlt:NaN, moonIllum:NaN};
  const sun = SunCalc.getPosition(dateUtc, state.location.latitude, state.location.longitude);
  const moon = SunCalc.getMoonPosition(dateUtc, state.location.latitude, state.location.longitude);
  const illum = SunCalc.getMoonIllumination(dateUtc);
  return {sunAlt:sun.altitude*180/Math.PI, moonAlt:moon.altitude*180/Math.PI, moonIllum:illum.fraction};
}
function toUtcFromOpenMeteo(localTime, utcOffsetSeconds) {
  const pseudoUtc = new Date(localTime + 'Z');
  return new Date(pseudoUtc.getTime() - (utcOffsetSeconds || 0) * 1000);
}

function windVector(speedMs, directionDeg) {
  if (!finite(speedMs) || !finite(directionDeg)) return null;
  const a = Number(directionDeg) * Math.PI / 180;
  const s = Number(speedMs);
  return {u:-s*Math.sin(a), v:-s*Math.cos(a)};
}
function thetaK(tempC, pressureHpa) {
  if (!finite(tempC)) return NaN;
  return (Number(tempC) + 273.15) * Math.pow(1000 / pressureHpa, 0.286);
}

function atmosphereDiagnostics(u, surface) {
  const levels = [850,700,500,300,250,200];
  const pts = [];
  for (const p of levels) {
    const z = Number(u[`geopotential_height_${p}hPa`]);
    const t = Number(u[`temperature_${p}hPa`]);
    const ws = Number(u[`wind_speed_${p}hPa`]);
    const wd = Number(u[`wind_direction_${p}hPa`]);
    const vv = Math.abs(Number(u[`vertical_velocity_${p}hPa`]));
    const rh = Number(u[`relative_humidity_${p}hPa`]);
    const vec = windVector(ws, wd);
    if ([z,t,ws,wd].every(Number.isFinite) && vec) pts.push({p,z,t,ws,wd,vv,rh,theta:thetaK(t,p),...vec});
  }
  if (pts.length < 3) return {quality:NaN, minRi:NaN, badLayer:null, jet:NaN, maxShear:NaN, maxVV:NaN};
  pts.sort((a,b)=>a.z-b.z);

  let minRi = Infinity, worst = null, maxShear = 0, maxVV = 0;
  for (let i=0; i<pts.length-1; i++) {
    const a = pts[i], b = pts[i+1];
    const dz = b.z - a.z;
    if (!(dz > 50)) continue;
    const du = b.u - a.u, dv = b.v - a.v;
    const shear2 = (du*du + dv*dv) / (dz*dz);
    const shearPerKm = Math.sqrt(du*du + dv*dv) / dz * 1000;
    const dThetaDz = (b.theta - a.theta) / dz;
    const thetaMid = (a.theta + b.theta) / 2;
    const ri = (9.80665 / thetaMid) * dThetaDz / Math.max(shear2, 1e-8);
    maxShear = Math.max(maxShear, shearPerKm);
    maxVV = Math.max(maxVV, Number.isFinite(a.vv)?a.vv:0, Number.isFinite(b.vv)?b.vv:0);
    if (ri < minRi) { minRi = ri; worst = {bottom:a.z, top:b.z, ri, pBottom:a.p, pTop:b.p}; }
  }

  const p300 = pts.find(x=>x.p===300);
  const p250 = pts.find(x=>x.p===250);
  const jet = Math.max(p300?.ws ?? NaN, p250?.ws ?? NaN);
  const riQ = !Number.isFinite(minRi) ? 50 : minRi < 0 ? 5 : minRi < 0.25 ? lerp(10,45,minRi/0.25) : minRi < 1 ? lerp(45,90,(minRi-0.25)/0.75) : 95;
  const shearQ = scaleQuality(maxShear, 2.5, 18);
  const jetQ = scaleQuality(jet, 8, 40);
  const vvQ = scaleQuality(maxVV, 0.02, 0.8);
  const capeQ = scaleQuality(Number(surface.cape), 20, 800);
  const sfcWindMs = Number(surface.wind_speed_10m) / 3.6;
  const sfcQ = scaleQuality(sfcWindMs, 1, 10);
  const quality = weighted([[riQ,.34],[shearQ,.23],[jetQ,.21],[vvQ,.10],[capeQ,.07],[sfcQ,.05]]);
  return {quality:Math.round(clamp(quality,0,100)), minRi, badLayer:worst, jet, maxShear, maxVV, riQ, shearQ, jetQ};
}

function seeingConfidence(index, modelQuality) {
  if (!seeingInfo(index) || !Number.isFinite(modelQuality)) return '—';
  const q = seeingQualityFromIndex(index);
  const delta = Math.abs(q - modelQuality);
  if (delta <= 14) return 'hoch';
  if (delta <= 28) return 'mittel';
  return 'niedrig';
}
function confidenceQuality(c) { return c === 'hoch' ? 90 : c === 'mittel' ? 65 : c === 'niedrig' ? 35 : 50; }

function buildRows() {
  const wh = state.weather?.hourly;
  if (!wh?.time) return [];
  const upper = buildHourlyIndex(state.upperAir);
  const astro = buildAstroIndex();
  const mbFreeData = state.meteoblue?.free?.ok ? state.meteoblue.free.data : null;
  const mbSeeingData = state.meteoblue?.seeing?.ok ? state.meteoblue.seeing.data : null;
  const mb3 = mbFreeData?.data_3h || null;
  const mb1 = mbSeeingData?.data_1h || null;
  const mb3Index = meteoblueIndex(mb3);
  const mb1Index = meteoblueIndex(mb1);
  const mbCloudTotalSeries = pickSeries(mb3, ['cloudcover','totalcloudcover','cloudcovertotal'], k => k.includes('cloud') && !k.includes('low') && !k.includes('mid') && !k.includes('medium') && !k.includes('high'));
  const mbCloudLowSeries = pickSeries(mb3, ['lowclouds','cloudcoverlow','lowcloudcover'], k => k.includes('cloud') && k.includes('low'));
  const mbCloudMidSeries = pickSeries(mb3, ['midclouds','mediumclouds','cloudcovermid','cloudcovermedium','midcloudcover'], k => k.includes('cloud') && (k.includes('mid') || k.includes('medium')));
  const mbCloudHighSeries = pickSeries(mb3, ['highclouds','cloudcoverhigh','highcloudcover'], k => k.includes('cloud') && k.includes('high'));
  const mbCapeSeries = pickSeries(mb3, ['cape'], k => k === 'cape' || k.includes('cape'));
  const mbFogSeries = pickSeries(mb3, ['fog_probability','fogprobability'], k => k.includes('fog') && k.includes('prob'));
  const mbVisibilitySeries = pickSeries(mb3, ['visibility'], k => k === 'visibility');
  const offset = state.weather.utc_offset_seconds || 0;
  const result = [];

  for (let i=0; i<wh.time.length; i++) {
    const localTime = wh.time[i];
    if (Number(localTime.slice(11,13)) % 3 !== 0) continue;
    const u = upper.get(localTime) || {};
    const dateUtc = toUtcFromOpenMeteo(localTime, offset);
    const sm = sunMoon(dateUtc);

    let a = astro.get(isoHourUTC(dateUtc));
    if (!a) {
      for (const dh of [-1,1]) {
        const c = astro.get(isoHourUTC(new Date(dateUtc.getTime()+dh*3600e3)));
        if (c) { a=c; break; }
      }
    }
    const seeingIndex = a && Number(a.seeing) !== -9999 ? Number(a.seeing) : null;
    const transIndex = a && Number(a.transparency) !== -9999 ? Number(a.transparency) : null;

    const mb3i = nearestIndex(mb3Index, dateUtc, 2);
    const mb1i = nearestIndex(mb1Index, dateUtc, 1);
    const mbCloud = mb3i === undefined ? NaN : seriesValue(mbCloudTotalSeries, mb3i);
    const mbLow = mb3i === undefined ? NaN : seriesValue(mbCloudLowSeries, mb3i);
    const mbMid = mb3i === undefined ? NaN : seriesValue(mbCloudMidSeries, mb3i);
    const mbHigh = mb3i === undefined ? NaN : seriesValue(mbCloudHighSeries, mb3i);
    const mbCape = mb3i === undefined ? NaN : seriesValue(mbCapeSeries, mb3i);
    const mbFog = mb3i === undefined ? NaN : seriesValue(mbFogSeries, mb3i);
    const mbVisibility = mb3i === undefined ? NaN : seriesValue(mbVisibilitySeries, mb3i);
    const mbSeeing = mb1i === undefined ? NaN : seriesValue(mb1?.seeing_arcsec, mb1i);
    const mbSeeing1 = mb1i === undefined ? NaN : seriesValue(mb1?.seeing1, mb1i);
    const mbSeeing2 = mb1i === undefined ? NaN : seriesValue(mb1?.seeing2, mb1i);
    const mbJet = mb1i === undefined ? NaN : seriesValue(mb1?.jetstream, mb1i);
    const mbBadBottom = mb1i === undefined ? NaN : seriesValue(mb1?.badlayer_bottom, mb1i);
    const mbBadTop = mb1i === undefined ? NaN : seriesValue(mb1?.badlayer_top, mb1i);
    const mbBadGradient = mb1i === undefined ? NaN : seriesValue(mb1?.badlayer_gradient, mb1i);

    const surface = {
      cape:Number(wh.cape?.[i]), wind_speed_10m:Number(wh.wind_speed_10m?.[i]), wind_gusts_10m:Number(wh.wind_gusts_10m?.[i])
    };
    const atm = atmosphereDiagnostics(u, surface);
    const confidence = seeingAgreement(mbSeeing, seeingIndex, atm.quality);

    const cloud = Number(wh.cloud_cover?.[i]), low=Number(wh.cloud_cover_low?.[i]), mid=Number(wh.cloud_cover_mid?.[i]), high=Number(wh.cloud_cover_high?.[i]);
    const cloudConsensus = conservativeCloud(cloud, mbCloud);
    const lowConsensus = conservativeCloud(low, mbLow);
    const midConsensus = conservativeCloud(mid, mbMid);
    const highConsensus = conservativeCloud(high, mbHigh);
    const temp=Number(wh.temperature_2m?.[i]), dew=Number(wh.dew_point_2m?.[i]), rh=Number(wh.relative_humidity_2m?.[i]);
    const wind=Number(wh.wind_speed_10m?.[i]), gust=Number(wh.wind_gusts_10m?.[i]);
    const precip=Number(wh.precipitation?.[i]), pop=Number(wh.precipitation_probability?.[i]);

    const cloudQ = weighted([[percentQuality(cloudConsensus),.46],[percentQuality(lowConsensus),.20],[percentQuality(midConsensus),.16],[percentQuality(highConsensus),.18]]);
    const transQ = transIndex ? transparencyQuality(transIndex) : weighted([
      [percentQuality(highConsensus),.45],[scaleQuality(rh,55,98),.20],[scaleQuality(Number(u.relative_humidity_700hPa),35,95),.20],
      [Number.isFinite(mbVisibility) ? clamp((mbVisibility-5000)/(30000-5000)*100,0,100) : NaN,.15]
    ]);
    const dewQ = dewQuality(temp,dew,rh);
    const windQ = weighted([[scaleQuality(wind,3,28),.7],[scaleQuality(gust,8,45),.3]]);
    const precipQ = Math.min(scaleQuality(precip,0,1.5), scaleQuality(pop,5,80));
    const darkQ = darknessQuality(sm.sunAlt);
    const moonQ = 100 - moonPenalty(sm.moonAlt, sm.moonIllum);
    const seeingQ = Number.isFinite(mbSeeing) ? scaleQuality(mbSeeing, 0.55, 2.8) : (Number.isFinite(seeingQualityFromIndex(seeingIndex)) ? seeingQualityFromIndex(seeingIndex) : atm.quality);

    const fogQ = Number.isFinite(mbFog) ? scaleQuality(mbFog, 5, 75) : NaN;
    let deep = weighted([[cloudQ,.36],[transQ,.19],[dewQ,.10],[windQ,.08],[precipQ,.08],[moonQ,.07],[darkQ,.07],[fogQ,.05]]);
    let planetary = weighted([[seeingQ,.46],[cloudQ,.27],[windQ,.12],[precipQ,.08],[darkQ,.07]]);
    if (sm.sunAlt > -6) { deep *= darkQ/100; planetary *= Math.max(.25,darkQ/100); }

    result.push({
      localTime,dateUtc,sunAlt:sm.sunAlt,moonAlt:sm.moonAlt,moonIllum:sm.moonIllum,
      cloud,low,mid,high,mbCloud,mbLow,mbMid,mbHigh,cloudConsensus,lowConsensus,midConsensus,highConsensus,mbCape,mbFog,mbVisibility,
      temp,dew,rh,wind,gust,precip,pop,cloudBase:Number(wh.cloud_base?.[i]),cape:Number(wh.cape?.[i]),
      seeingIndex,transIndex,mbSeeing,mbSeeing1,mbSeeing2,mbJet,mbBadBottom,mbBadTop,mbBadGradient,
      atmQuality:atm.quality,seeingConfidence:confidence,minRi:atm.minRi,badLayer:atm.badLayer,
      jetMs:atm.jet,maxShear:atm.maxShear,maxVV:atm.maxVV,
      deep:Math.round(clamp(deep,0,100)),planetary:Math.round(clamp(planetary,0,100)),transQ:Math.round(transQ),dewQ:Math.round(dewQ)
    });
  }
  return result;
}

function horizonRows() { return state.rows.slice(0, Math.ceil(state.hours/3)); }
function visibleRows() {
  const base = horizonRows();
  if (!base.length) return [];

  // Nur Nachtplanung anzeigen. Die 3-h-Spalte direkt vor dem ersten
  // Sonnenstand unter 0° und direkt nach dem letzten wird mitgenommen,
  // damit der Slot mit Sonnenuntergang bzw. Sonnenaufgang sichtbar bleibt.
  const keep = new Set();
  base.forEach((r, i) => {
    if (Number.isFinite(r.sunAlt) && r.sunAlt <= 0) {
      keep.add(i);
      if (i > 0) keep.add(i - 1);
      if (i < base.length - 1) keep.add(i + 1);
    }
  });
  return base.filter((_, i) => keep.has(i));
}
function renderAll() { $('#summary').hidden=false; $('#forecastCard').hidden=false; $('#details').hidden=false; renderSummary(); renderTable(); }
function renderLocation() {
  $('#locationTitle').textContent = state.location.name;
  const parts=[state.location.admin1,state.location.country].filter(Boolean);
  const elev=finite(state.location.elevation)?`${Math.round(Number(state.location.elevation))} m`:'';
  $('#locationMeta').textContent=[...new Set(parts),elev].filter(Boolean).join(' · ');
  $('#locationInput').value=state.location.name;
}
function bestBy(rows, selector, filter=()=>true) { return rows.filter(filter).reduce((b,r)=>!b||selector(r)>selector(b)?r:b,null); }
function dateLabel(r) { return `${formatLocal(r.dateUtc,{weekday:'short'})}, ${formatLocal(r.dateUtc,{day:'2-digit',month:'2-digit'})} ${formatLocal(r.dateUtc,{hour:'2-digit',minute:'2-digit'})}`; }

function renderSummary() {
  const rows=visibleRows(), night=r=>r.sunAlt<=-12;
  const bestDeep=bestBy(rows,r=>r.deep,night)||bestBy(rows,r=>r.deep);
  const bestPlanet=bestBy(rows,r=>r.planetary,night)||bestBy(rows,r=>r.planetary);
  const mbSeeingRows=rows.filter(r=>Number.isFinite(r.mbSeeing)&&night(r)).sort((a,b)=>a.mbSeeing-b.mbSeeing);
  const seeingRows=rows.filter(r=>seeingInfo(r.seeingIndex)&&night(r)).sort((a,b)=>seeingInfo(a.seeingIndex).representative-seeingInfo(b.seeingIndex).representative);
  const modelRows=rows.filter(r=>Number.isFinite(r.atmQuality)&&night(r)).sort((a,b)=>b.atmQuality-a.atmQuality);
  const bestSeeing=mbSeeingRows[0]||seeingRows[0]||modelRows[0];
  const bestCloud=rows.filter(night).sort((a,b)=>a.cloudConsensus-b.cloudConsensus)[0];

  $('#bestDeep').textContent=bestDeep?`${bestDeep.deep}/100`:'—'; $('#bestDeepNote').textContent=bestDeep?dateLabel(bestDeep):'—';
  $('#bestPlanet').textContent=bestPlanet?`${bestPlanet.planetary}/100`:'—'; $('#bestPlanetNote').textContent=bestPlanet?dateLabel(bestPlanet):'—';
  if (bestSeeing) {
    const si=seeingInfo(bestSeeing.seeingIndex);
    $('#bestSeeing').textContent=Number.isFinite(bestSeeing.mbSeeing)?`${bestSeeing.mbSeeing.toFixed(2)}″`:si?si.label:`Modell ${bestSeeing.atmQuality}/100`;
    const src=Number.isFinite(bestSeeing.mbSeeing)?'meteoblue':si?'7Timer':'Atmosphärenmodell';
    $('#bestSeeingNote').textContent=`${dateLabel(bestSeeing)} · ${src}${bestSeeing.seeingConfidence!=='—'?` · Konsens ${bestSeeing.seeingConfidence}`:''}`;
  } else { $('#bestSeeing').textContent='—'; $('#bestSeeingNote').textContent='—'; }
  $('#bestCloud').textContent=bestCloud?`${Math.round(bestCloud.cloudConsensus)} %`:'—'; $('#bestCloudNote').textContent=bestCloud?dateLabel(bestCloud):'—';
}

function escapeHtml(s){return String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
function td(value,cls='',title=''){return `<td class="${cls}"${title?` title="${escapeHtml(title)}"`:''}>${value}</td>`;}
function row(label,cells,title=''){return `<tr><th class="row-label" scope="row"${title?` title="${escapeHtml(title)}"`:''}>${label}</th>${cells.join('')}</tr>`;}
function fmt(v,d=0,s=''){return Number.isFinite(v)?`${v.toFixed(d)}${s}`:'—';}
function cellByQuality(text,q,extra='',title=''){return td(text,`${scoreClass(Number.isFinite(q)?q:50)} ${extra}`.trim(),title);}
function cellByBadPercent(v,text=null){return cellByQuality(text??fmt(v,0,'%'),percentQuality(v));}
function nightClass(r){if(r.sunAlt<=-18)return'astronomical';if(r.sunAlt<=-6)return'night';return'daylight';}

function detailRow(group, label, cells, title='') {
  const base = row(label, cells, title);
  return base.replace('<tr>', `<tr class="detail-row detail-${group}" hidden>`);
}
function detailGroup(label, group, rows, note='') {
  return `<tr class="detail-group-row"><th colspan="${rows.length + 1}"><button type="button" class="detail-toggle" data-group="${group}" aria-expanded="false"><span class="toggle-icon">▸</span><span>${label}</span>${note ? `<small>${note}</small>` : ''}</button></th></tr>`;
}

function renderTable() {
  const rows=visibleRows(); if(!rows.length)return;
  const head=rows.map(r=>`<th class="date-cell ${nightClass(r)}"><div>${formatLocal(r.dateUtc,{weekday:'short'})} ${formatLocal(r.dateUtc,{day:'2-digit',month:'2-digit'})}</div><strong>${formatLocal(r.dateUtc,{hour:'2-digit',minute:'2-digit'})}</strong></th>`);
  const html=[]; html.push(`<thead><tr><th class="row-label">Zeit</th>${head.join('')}</tr></thead><tbody>`);

  // Kompakte Standardansicht.
  html.push(row('Deep Sky',rows.map(r=>cellByQuality(r.deep,r.deep,'score'))));
  html.push(row('Planetary',rows.map(r=>cellByQuality(r.planetary,r.planetary,'score'))));
  html.push(row('Mond',rows.map(r=>{
    const above = Number.isFinite(r.moonAlt) && r.moonAlt > 0;
    const text = `${fmt(r.moonIllum*100,0,'%')} · ${above ? fmt(r.moonAlt,0,'°') : 'unter Horizont'}`;
    return cellByQuality(text,100-moonPenalty(r.moonAlt,r.moonIllum),'','Beleuchtung · Mondhöhe. Die Farbe bewertet den Einfluss des Mondlichts.');
  }),'Mondbeleuchtung und Mondhöhe. Unter dem Horizont verursacht der Mond keinen Lichtabzug im Deep-Sky-Score.'));

  html.push(detailGroup('Wolken & Transparenz','clouds',rows,'Quellenvergleich und Schichten'));
  html.push(detailRow('clouds','Wolken-Konsens',rows.map(r=>cellByBadPercent(r.cloudConsensus)), 'Konservativer Konsens aus MeteoSwiss ICON-CH und meteoblue mLM; bei nur einer verfügbaren Quelle wird diese verwendet.'));
  html.push(detailRow('clouds','MeteoSwiss gesamt',rows.map(r=>cellByBadPercent(r.cloud))));
  html.push(detailRow('clouds','meteoblue gesamt',rows.map(r=>Number.isFinite(r.mbCloud)?cellByBadPercent(r.mbCloud):td('—'))));
  html.push(detailRow('clouds','MeteoSwiss tief',rows.map(r=>cellByBadPercent(r.low))));
  html.push(detailRow('clouds','meteoblue tief',rows.map(r=>Number.isFinite(r.mbLow)?cellByBadPercent(r.mbLow):td('—'))));
  html.push(detailRow('clouds','MeteoSwiss mittel',rows.map(r=>cellByBadPercent(r.mid))));
  html.push(detailRow('clouds','meteoblue mittel',rows.map(r=>Number.isFinite(r.mbMid)?cellByBadPercent(r.mbMid):td('—'))));
  html.push(detailRow('clouds','MeteoSwiss hoch',rows.map(r=>cellByBadPercent(r.high))));
  html.push(detailRow('clouds','meteoblue hoch',rows.map(r=>Number.isFinite(r.mbHigh)?cellByBadPercent(r.mbHigh):td('—'))));
  html.push(detailRow('clouds','Nebelrisiko MB',rows.map(r=>Number.isFinite(r.mbFog)?cellByQuality(fmt(r.mbFog,0,'%'),scaleQuality(r.mbFog,5,75)):td('—')), 'meteoblue fog_probability aus dem Clouds-Paket.'));
  html.push(detailRow('clouds','Sichtweite MB',rows.map(r=>Number.isFinite(r.mbVisibility)?cellByQuality(fmt(r.mbVisibility/1000,1,' km'),clamp((r.mbVisibility-5000)/(30000-5000)*100,0,100)):td('—')), 'meteoblue Sichtweite; hilfreich als Transparenz-Indikator, aber kein Ersatz für astronomische Extinktion/Aerosolmessung.'));
  html.push(detailRow('clouds','Transparenz 7Timer',rows.map(r=>r.transIndex?cellByQuality(`${r.transIndex}/8`,transparencyQuality(r.transIndex),'','7Timer: 1 ist beste Transparenz, 8 die schlechteste.'):td('—'))));

  html.push(detailGroup('Seeing & Atmosphäre','seeing',rows,'Seeing, Jetstream und Turbulenz'));
  html.push(detailRow('seeing','Seeing meteoblue',rows.map(r=>Number.isFinite(r.mbSeeing)?cellByQuality(`${r.mbSeeing.toFixed(2)}″`,scaleQuality(r.mbSeeing,0.55,2.8),'','meteoblue seeing_arcsec – direkte optische Seeing-Prognose'):td('—','','Paket seeing-1h ist für diesen Key nicht verfügbar oder liefert für diesen Zeitpunkt keinen Wert.')), 'Offizielles meteoblue seeing_arcsec aus dem Paket seeing-1h. Wird als primäre Seeing-Zahl verwendet, wenn verfügbar.'));
  html.push(detailRow('seeing','Seeing Index 1',rows.map(r=>td(Number.isFinite(r.mbSeeing1)?r.mbSeeing1.toFixed(2):'—'))));
  html.push(detailRow('seeing','Seeing Index 2',rows.map(r=>td(Number.isFinite(r.mbSeeing2)?r.mbSeeing2.toFixed(2):'—'))));
  html.push(detailRow('seeing','Seeing 7Timer',rows.map(r=>{
    const info=seeingInfo(r.seeingIndex);
    return info?cellByQuality(info.label,seeingQualityFromIndex(r.seeingIndex),'',`7Timer Seeing-Klasse ${r.seeingIndex}/8`):td('—','','7Timer ASTRO liefert nur ungefähr 3 Tage bzw. Quelle ist nicht verfügbar.');
  }),'Explizite astronomische Seeing-Vorhersage von 7Timer ASTRO. Bereiche werden unverändert als Klasse gezeigt.'));
  html.push(detailRow('seeing','Seeing Modell',rows.map(r=>cellByQuality(Number.isFinite(r.atmQuality)?`${r.atmQuality}/100`:'—',r.atmQuality,'',
    'Turbulenzindikator aus vertikalem Temperaturgradienten, Windscherung, Jetstream, Vertikalbewegung, CAPE und Bodenwind. Keine direkte Arcsec-Prognose.')),
    'Unabhängiger Atmosphären-Turbulenzindikator. 100 = ruhige/stabile Atmosphäre. Kein Ersatz für optisches Seeing in Bogensekunden.'));
  html.push(detailRow('seeing','Seeing-Konsens',rows.map(r=>cellByQuality(r.seeingConfidence,confidenceQuality(r.seeingConfidence))),'Übereinstimmung zwischen meteoblue, 7Timer und/oder unabhängigem Atmosphärenindikator.'));
  html.push(detailRow('seeing','Jet meteoblue',rows.map(r=>td(Number.isFinite(r.mbJet)?fmt(r.mbJet,1):'—')), 'Jetstream-Wert direkt aus dem meteoblue seeing-1h Paket; Einheit gemäß meteoblue API-Antwort.'));
  html.push(detailRow('seeing','Bad Layer MB',rows.map(r=>td(Number.isFinite(r.mbBadBottom)&&Number.isFinite(r.mbBadTop)?`${fmt(r.mbBadBottom,1)}–${fmt(r.mbBadTop,1)}`:'—')), 'Unter- und Obergrenze der von meteoblue als ungünstig erkannten Atmosphärenschicht.'));
  html.push(detailRow('seeing','Bad Grad. MB',rows.map(r=>td(Number.isFinite(r.mbBadGradient)?fmt(r.mbBadGradient,2):'—')), 'Gradient der meteoblue Bad-Layer-Diagnostik.'));
  html.push(detailRow('seeing','Jet 250/300',rows.map(r=>cellByQuality(fmt(r.jetMs*3.6,0,' km/h'),scaleQuality(r.jetMs,8,40))),'Stärkster Höhenwind aus 250/300 hPa.'));
  html.push(detailRow('seeing','Max. Scherung',rows.map(r=>cellByQuality(fmt(r.maxShear,1,' m/s/km'),scaleQuality(r.maxShear,2.5,18))),'Maximale Windänderung pro Kilometer zwischen ausgewerteten Druckflächen.'));
  html.push(detailRow('seeing','Min. Ri',rows.map(r=>{
    const q=!Number.isFinite(r.minRi)?50:r.minRi<0?5:r.minRi<.25?30:r.minRi<1?70:95;
    return cellByQuality(Number.isFinite(r.minRi)?r.minRi.toFixed(2):'—',q,'','Gradient-Richardson-Zahl; Werte <0.25 deuten auf erhöhte dynamische Turbulenzneigung hin.');
  }),'Gradient-Richardson-Zahl als Turbulenzdiagnostik; nicht mit Seeing in Arcsec verwechseln.'));
  html.push(detailRow('seeing','Schlechteste Schicht',rows.map(r=>{
    const b=r.badLayer; return td(b?`${(b.bottom/1000).toFixed(1)}–${(b.top/1000).toFixed(1)} km`:'—');
  })));

  html.push(detailGroup('Wetter & Tau','weather',rows,'Wind, Feuchte und Niederschlag'));
  html.push(detailRow('weather','Wind',rows.map(r=>cellByQuality(fmt(r.wind,0,' km/h'),scaleQuality(r.wind,3,28)))));
  html.push(detailRow('weather','Böen',rows.map(r=>cellByQuality(fmt(r.gust,0,' km/h'),scaleQuality(r.gust,8,45)))));
  html.push(detailRow('weather','Temperatur',rows.map(r=>td(fmt(r.temp,1,'°')))));
  html.push(detailRow('weather','Taupunkt',rows.map(r=>td(fmt(r.dew,1,'°')))));
  html.push(detailRow('weather','ΔT Tau',rows.map(r=>cellByQuality(fmt(r.temp-r.dew,1,' K'),r.dewQ))));
  html.push(detailRow('weather','Feuchte',rows.map(r=>cellByQuality(fmt(r.rh,0,'%'),scaleQuality(r.rh,55,98)))));
  html.push(detailRow('weather','Niederschlag',rows.map(r=>cellByQuality(`${fmt(r.precip,1,' mm')} / ${fmt(r.pop,0,'%')}`,Math.min(scaleQuality(r.precip,0,1.5),scaleQuality(r.pop,5,80))))));
  html.push(detailRow('weather','Wolkenbasis',rows.map(r=>td(Number.isFinite(r.cloudBase)?`${Math.round(r.cloudBase)} m`:'—'))));
  html.push(detailRow('weather','CAPE meteoblue',rows.map(r=>Number.isFinite(r.mbCape)?cellByQuality(fmt(r.mbCape,0,' J/kg'),scaleQuality(r.mbCape,20,800)):td('—')), 'Konvektive verfügbare potentielle Energie aus meteoblue Air.'));

  html.push(detailGroup('Dämmerung & Mond','astro',rows,'Sonnen- und Mondhöhe'));
  html.push(detailRow('astro','Sonnenhöhe',rows.map(r=>cellByQuality(fmt(r.sunAlt,0,'°'),darknessQuality(r.sunAlt)))));
  html.push(detailRow('astro','Mondhöhe',rows.map(r=>td(fmt(r.moonAlt,0,'°')))));
  html.push(detailRow('astro','Mondlicht',rows.map(r=>cellByQuality(fmt(r.moonIllum*100,0,'%'),100-moonPenalty(r.moonAlt,r.moonIllum)))));

  html.push('</tbody>');
  const table=$('#forecastTable');
  table.innerHTML=html.join('');
  table.querySelectorAll('.detail-toggle').forEach(btn=>btn.addEventListener('click',()=>{
    const group=btn.dataset.group;
    const open=btn.getAttribute('aria-expanded')==='true';
    btn.setAttribute('aria-expanded',String(!open));
    const icon=btn.querySelector('.toggle-icon'); if(icon) icon.textContent=open?'▸':'▾';
    table.querySelectorAll(`.detail-${group}`).forEach(tr=>{tr.hidden=open;});
  }));
}
function setStatus(text,mode=''){const el=$('#status');el.textContent=text;el.className=`status card ${mode}`.trim();}
async function geocode(query){const p=new URLSearchParams({name:query,count:'8',language:'de',format:'json'});const data=await fetchJson(`https://geocoding-api.open-meteo.com/v1/search?${p}`);return data.results||[];}
function renderSearchResults(results){
  const box=$('#searchResults');
  if(!results.length){box.hidden=false;box.innerHTML='<div class="search-result">Keine Treffer</div>';return;}
  box.hidden=false; box.innerHTML=results.map((r,i)=>{
    const sub=[r.admin1,r.country,finite(r.elevation)?`${Math.round(r.elevation)} m`:''].filter(Boolean).join(' · ');
    return `<button class="search-result" type="button" data-index="${i}"><strong>${escapeHtml(r.name)}</strong><small>${escapeHtml(sub)}</small></button>`;
  }).join('');
  box.querySelectorAll('[data-index]').forEach(btn=>btn.addEventListener('click',()=>{
    const r=results[Number(btn.dataset.index)]; state.location={name:r.name,latitude:r.latitude,longitude:r.longitude,elevation:r.elevation,country:r.country,admin1:r.admin1,timezone:r.timezone};
    saveLocation(state.location);box.hidden=true;refresh();
  }));
}

$('#searchForm').addEventListener('submit',async(e)=>{e.preventDefault();const q=$('#locationInput').value.trim();if(q.length<2)return;setStatus('Standort wird gesucht…');try{const results=await geocode(q);renderSearchResults(results);setStatus(results.length?'Standort auswählen.':'Kein Standort gefunden.');}catch(err){setStatus(`Standortsuche fehlgeschlagen: ${err.message||err}`,'error');}});
$('#refreshBtn').addEventListener('click',refresh);
$('#settingsBtn').addEventListener('click',()=>$('#infoDialog').showModal());
document.querySelectorAll('.range-btn').forEach(btn=>btn.addEventListener('click',()=>{document.querySelectorAll('.range-btn').forEach(b=>b.classList.remove('active'));btn.classList.add('active');state.hours=Number(btn.dataset.hours);if(state.rows.length)renderAll();}));
window.addEventListener('load',()=>{renderLocation();refresh();if('serviceWorker'in navigator&&location.protocol!=='file:')navigator.serviceWorker.register('./sw.js').catch(()=>{});});
