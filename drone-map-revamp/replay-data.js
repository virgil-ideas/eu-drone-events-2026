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

  return {intervalEvents, cumulative, territorialCountry};
});
