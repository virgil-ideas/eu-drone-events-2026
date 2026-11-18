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

  // Every calendar day belongs to exactly one block, anchored at the published
  // cutoff. The oldest block stops at January 1 rather than inventing history.
  function ninetyDayBreakdown(events, cutoff) {
    const yearStart = cutoff.slice(0, 4) + '-01-01';
    const firstDay = Date.parse(yearStart + 'T00:00:00Z');
    const blocks = [];
    for (let end = Date.parse(cutoff + 'T00:00:00Z'); end >= firstDay;) {
      const start = Math.max(firstDay, end - 89 * DAY);
      const days = (end - start) / DAY + 1;
      blocks.push({start: iso(start), end: iso(end), days, age: blocks.length, partial: days < 90, total: 0});
      end = start - DAY;
    }
    blocks.reverse();
    const months = Array.from({length: Number(cutoff.slice(5, 7))}, (_, i) => ({
      month: `${cutoff.slice(0, 4)}-${String(i + 1).padStart(2, '0')}`,
      total: 0, counts: blocks.map(() => 0)
    }));
    for (const event of events) {
      if (event.recordClass === 'excluded' || event.startDate < yearStart || event.startDate > cutoff) continue;
      const index = blocks.findIndex(block => event.startDate >= block.start && event.startDate <= block.end);
      if (index === -1) continue;
      const month = months[Number(event.startDate.slice(5, 7)) - 1];
      month.counts[index]++;
      month.total++;
      blocks[index].total++;
    }
    for (const block of blocks) block.dailyAverage = block.total / block.days;
    return {blocks, months};
  }

  const api = {rollingComparison, windowForDate, ninetyDayBreakdown};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.DRONE_TREND = api;
})();
