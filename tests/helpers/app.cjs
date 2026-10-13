const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadApp({ now = '2026-10-12T12:30:00Z', sunAlt = -20, moonAlt = -10, illumination = 0.5,
  navigator = {}, fetch, elements = {}, events = {}, location = {protocol: 'https:', search: ''},
  localStorage = { getItem: () => null, setItem() {} } } = {}) {
  const epoch = Date.parse(now);
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : [epoch])); }
    static now() { return epoch; }
  }
  const element = { addEventListener() {}, querySelectorAll: () => [] };
  const SunCalc = {
    getPosition: () => ({ altitude: sunAlt * Math.PI / 180 }),
    getMoonPosition: () => ({ altitude: moonAlt * Math.PI / 180 }),
    getMoonIllumination: () => ({ fraction: illumination })
  };
  const context = vm.createContext({
    Date: FixedDate, Intl, URLSearchParams, console, SunCalc, navigator, fetch, AbortController, setTimeout, clearTimeout, location,
    localStorage,
    document: { querySelector: (selector) => elements[selector] || element, querySelectorAll: () => [] },
    window: { SunCalc, addEventListener(name, callback) { events[name] = callback; } }
  });
  const source = fs.readFileSync(path.join(__dirname, '../../app.js'), 'utf8');
  vm.runInContext(source, context, { filename: 'app.js' });
  return vm.runInContext(`({
    state, buildRows, horizonRows, visibleRows, groupNights, nightKey,
    moonPenalty, darknessQuality, conservativeCloud, nearestIndex,
    meteoblueIndex, buildAstroIndex, weatherUrl, upperAirUrl, hourIntervalLabel, seeingQualityFromIndex,
    transparencyQuality, dewQuality, renderNightTable, bestBy, atmosphereDiagnostics,
    gpsLocation, useGpsLocation, selectLocation, refresh
  })`, context);
}
module.exports = { loadApp };

