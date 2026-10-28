/* Pure replay calculations shared by the interface and regression checks. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DRONE_REPLAY = api;
})(typeof window === 'undefined' ? globalThis : window, function () {
  'use strict';
  const DAY = 86400000;
  const time = date => Date.parse(`${date}T00:00:00Z`);

  function intervalEvents(events, start, end) {
    return events.filter(event => event.startDate >= start && event.startDate <= end);
  }

  function cumulative(events, firstDate, cutoff) {
    const counts = new Map();
    events.forEach(event => counts.set(event.startDate, (counts.get(event.startDate) || 0) + 1));
    const totals = [];
    let total = 0;
    for (let day = time(firstDate); day <= time(cutoff); day += DAY) {
      total += counts.get(new Date(day).toISOString().slice(0, 10)) || 0;
      totals.push(total);
    }
    return totals;
  }

  // Only the explicit country qualifier establishes territorial-water scope.
  // Do not infer it from prose that may say "outside territorial waters".
  function territorialCountry(event) {
    return /^([^()]+)\s+\(territorial waters\)$/i.exec(event.countries)?.[1].trim() || null;
  }

  // Legacy research predates recordType. New shipping records use the database's
  // existing types, so a daily addition needs no change to an interface ID list.
  const LEGACY_SHIP_IDS = new Set(['E033', 'E034', 'E053']);
  const SHIP_RECORD_TYPES = new Set([
    'reported_offshore_drone_strike', 'reported_maritime_drone_strike',
    'suspected_maritime_drone_attack'
  ]);
  function maritimeEscalation(events, cutoff) {
    const startDate = '2026-10-05';
    const ships = events.filter(event => event.recordClass !== 'excluded'
      && event.startDate <= cutoff
      && /^(Romania|Bulgaria)(?:\s*\(|$)/.test(event.countries)
      && (LEGACY_SHIP_IDS.has(event.id) || SHIP_RECORD_TYPES.has(event.recordType)))
      .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.id.localeCompare(b.id));
    const records = ships.filter(event => event.startDate >= startDate);
    const precursors = ships.filter(event => event.startDate < startDate);
    const endDate = records.at(-1)?.startDate || startDate;
    return {ships, records, precursors, startDate, endDate};
  }

  return {intervalEvents, cumulative, territorialCountry, maritimeEscalation};
});
