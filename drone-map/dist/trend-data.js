'use strict';
(() => {
  const DAY = 86400000;
  const iso = time => new Date(time).toISOString().slice(0, 10);

  function windowForDate(date, comparison) {
    if (date > comparison.recentEnd) return null;
    if (date >= comparison.recentStart) return 'recent';
    if (date >= comparison.previousStart) return 'previous';
    return 'earlier';
  }

  function rollingComparison(events, cutoff) {
    const end = Date.parse(cutoff + 'T00:00:00Z');
    const comparison = {
      recentStart: iso(end - 89 * DAY), recentEnd: cutoff,
      previousStart: iso(end - 179 * DAY), previousEnd: iso(end - 90 * DAY),
      recentTotal: 0, previousTotal: 0
    };
    // The register covers one calendar year. Do not invent a zero baseline
    // when part of the preceding window falls before its coverage starts.
    comparison.hasComparison = comparison.previousStart >= cutoff.slice(0, 4) + '-01-01';
    for (const event of events) {
      const group = windowForDate(event.startDate, comparison);
      if (group === 'recent') comparison.recentTotal++;
      if (group === 'previous') comparison.previousTotal++;
    }
    comparison.change = comparison.hasComparison && comparison.previousTotal
      ? comparison.recentTotal / comparison.previousTotal - 1 : null;
    return comparison;
  }

  const api = {rollingComparison, windowForDate};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.DRONE_TREND = api;
})();
