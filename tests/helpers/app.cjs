const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadApp({ now = '2026-10-12T12:30:00Z', sunAlt = -20, moonAlt = -10, illumination = 0.5 } = {}) {
  const epoch = Date.parse(now);
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : [epoch])); }
    static now() { return epoch; }
  }
  const element = { addEventListener() {} };
  const SunCalc = {
    getPosition: () => ({ altitude: sunAlt * Math.PI / 180 }),
    getMoonPosition: () => ({ altitude: moonAlt * Math.PI / 180 }),
    getMoonIllumination: () => ({ fraction: illumination })
  };
  const context = vm.createContext({
    Date: FixedDate, Intl, URLSearchParams, console, SunCalc,
    localStorage: { getItem: () => null },
    document: { querySelector: () => element, querySelectorAll: () => [] },
    window: { SunCalc, addEventListener() {} }
  });
  const source = fs.readFileSync(path.join(__dirname, '../../app.js'), 'utf8');
  vm.runInContext(source, context, { filename: 'app.js' });
  return vm.runInContext(`({
    state, buildRows, horizonRows, visibleRows, groupNights, nightKey,
    moonPenalty, darknessQuality, conservativeCloud, nearestIndex,
    meteoblueIndex, buildAstroIndex, seeingQualityFromIndex,
    transparencyQuality, dewQuality, renderNightTable, bestBy, atmosphereDiagnostics
  })`, context);
}
module.exports = { loadApp };

