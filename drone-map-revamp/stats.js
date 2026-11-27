'use strict';
// Figures and chart series for "Charts & figures" and the share cards. Pure
// functions of the register's records, so the Node tests can check every count
// the press may quote.
(() => {
  // The map's two outcome presets: what the marker colour says happened.
  const IMPACT = new Set(['strike', 'explosion', 'shotdown', 'engaged', 'crash']);
  const outcomeOf = event => IMPACT.has(event.category) ? 'impact' : 'quiet';

  // Stages a record can include. One record can include several.
  const STAGES = [
    ['flight', ['flight']],
    ['alert', ['alert']],
    ['shotdown', ['shotdown', 'engaged']],
    ['crash', ['crash']],
    ['strike', ['strike', 'explosion']],
    ['recovery', ['recovery']],
    ['disposal', ['disposal']]
  ];

  const countriesOf = event => event.countries.replace(/\([^()]*\)/g, '').split(';').map(c => c.trim()).filter(Boolean);
  const inScope = (events, country) => country ? events.filter(event => countriesOf(event).includes(country)) : events;
  const monthOf = date => date.slice(0, 7);
  const dayNumber = date => Number(date.slice(8, 10));
  const isoDay = time => new Date(time).toISOString().slice(0, 10);
  const DAY = 86400000;

  function previousMonth(month) {
    const [year, number] = month.split('-').map(Number);
    return number === 1 ? `${year - 1}-12` : `${year}-${String(number - 1).padStart(2, '0')}`;
  }

  function lastDayOf(month) {
    const [year, number] = month.split('-').map(Number);
    return new Date(Date.UTC(year, number, 0)).getUTCDate();
  }

  // Every month from the first record to the cutoff, with no gaps.
  function monthsBetween(events, cutoff) {
    const first = events.reduce((min, event) => event.startDate < min ? event.startDate : min, cutoff);
    const months = [];
    for (let month = monthOf(first); month <= monthOf(cutoff); month = nextMonth(month)) months.push(month);
    return months;
  }

  function nextMonth(month) {
    const [year, number] = month.split('-').map(Number);
    return number === 12 ? `${year + 1}-01` : `${year}-${String(number + 1).padStart(2, '0')}`;
  }

  // Records per month split by outcome. Counted by first listed date, like the trend.
  function monthly(events, months) {
    return months.map(month => {
      const records = events.filter(event => monthOf(event.startDate) === month);
      const impact = records.filter(event => outcomeOf(event) === 'impact').length;
      const byCategory = {};
      for (const event of records) byCategory[event.category] = (byCategory[event.category] || 0) + 1;
      return {month, total: records.length, impact, quiet: records.length - impact, byCategory};
    });
  }

  // A record naming two countries counts once in each.
  function byCountry(events, months) {
    const rows = new Map();
    for (const event of events) {
      for (const country of new Set(countriesOf(event))) {
        if (!rows.has(country)) rows.set(country, {country, total: 0, months: months.map(() => 0)});
        const row = rows.get(country);
        row.total++;
        const index = months.indexOf(monthOf(event.startDate));
        if (index >= 0) row.months[index]++;
      }
    }
    return [...rows.values()].sort((a, b) => b.total - a.total || a.country.localeCompare(b.country));
  }

  function stages(events) {
    return STAGES.map(([key, names]) => ({
      key,
      count: events.filter(event => (event.stages || [event.category]).some(stage => names.includes(stage))).length
    })).sort((a, b) => b.count - a.count || STAGES.findIndex(([key]) => key === a.key) - STAGES.findIndex(([key]) => key === b.key));
  }

  // One entry per calendar day from 1 January of the first record's year to the cutoff.
  function daily(events, cutoff) {
    const start = Date.parse(`${monthsBetween(events, cutoff)[0].slice(0, 4)}-01-01T00:00:00Z`);
    const end = Date.parse(`${cutoff}T00:00:00Z`);
    const byDate = new Map();
    for (const event of events) {
      if (!byDate.has(event.startDate)) byDate.set(event.startDate, []);
      byDate.get(event.startDate).push(event.id);
    }
    const days = [];
    for (let time = start; time <= end; time += DAY) {
      const date = isoDay(time);
      const ids = byDate.get(date) || [];
      days.push({date, n: ids.length, ids});
    }
    return days;
  }

  function sourcing(events, sources = {}) {
    const bins = [1, 2, 3, 4, 5].map(size => ({size, count: 0}));
    const publishers = new Map();
    for (const event of events) {
      const ids = [...new Set(event.sources || [])];
      const size = Math.max(1, Math.min(5, ids.length));
      bins[size - 1].count++;
      const named = new Set(ids.map(id => sources[id]?.publisher).filter(Boolean));
      for (const name of named) publishers.set(name, (publishers.get(name) || 0) + 1);
    }
    const single = bins[0].count;
    return {
      bins,
      single,
      multiple: events.length - single,
      publishers: [...publishers].map(([name, count]) => ({name, count}))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    };
  }

  // Vessel names as the register writes them: an upper-case name where there is
  // one (CHELSEA 3), otherwise the part of the title before " · ".
  function vesselName(event) {
    const caps = event.title.match(/\b[A-Z][A-Z0-9]+(?:[ /.-]+[A-Z0-9]+)*\b/g)?.filter(name => /[A-Z]{3,}/.test(name) && !/^(EEZ|UAV|EOD|USV)$/.test(name));
    if (caps?.length) return caps.sort((a, b) => b.length - a.length)[0];
    return event.title.split(' · ')[0].replace(/^(off|near)\s+/i, '').replace(/\s+(off|near)\s+.*$/i, '').trim();
  }

  const UNCONFIRMED = new Set(['suspected_maritime_drone_attack', 'unconfirmed_offshore_drone_strike']);
  function ships(records) {
    return records.map(event => ({
      id: event.id,
      date: event.startDate,
      name: vesselName(event),
      country: countriesOf(event)[0],
      confirmed: !UNCONFIRMED.has(event.recordType),
      casualties: event.casualties === true
    })).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  }

  // The figures in the numbers panel. The month compares like with like: the
  // days of the current month so far against the same days of the month before.
  function keyFigures(events, cutoff) {
    const months = monthsBetween(events, cutoff);
    const series = monthly(events, months);
    const month = monthOf(cutoff);
    const lastDay = dayNumber(cutoff);
    const previous = previousMonth(month);
    const current = series.at(-1)?.total || 0;
    const previousSameDays = events.filter(event => monthOf(event.startDate) === previous && dayNumber(event.startDate) <= lastDay).length;
    const others = series.slice(0, -1).map(item => item.total);
    const busiest = series.reduce((best, item) => item.total > best.total ? item : best, series[0] || {month, total: 0});
    const latest = events.reduce((last, event) => !last || event.startDate >= last.startDate ? event : last, null);
    return {
      total: events.length,
      firstDate: `${months[0] || month}-01`,
      month,
      monthTotal: current,
      monthComplete: lastDay === lastDayOf(month),
      monthIsRecord: current > 0 && others.every(total => current > total),
      previousMonth: previous,
      previousSameDays,
      monthChange: previousSameDays ? (current - previousSameDays) / previousSameDays : null,
      busiest,
      shotdown: events.filter(event => (event.stages || [event.category]).some(stage => stage === 'shotdown' || stage === 'engaged')).length,
      impact: events.filter(event => outcomeOf(event) === 'impact').length,
      casualties: events.filter(event => event.casualties === true).length,
      countries: byCountry(events, months).map(row => row.country),
      latest
    };
  }

  const api = {IMPACT, STAGES, outcomeOf, countriesOf, inScope, monthsBetween, previousMonth, lastDayOf,
    monthly, byCountry, stages, daily, sourcing, vesselName, ships, keyFigures};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.DRONE_STATS = api;
})();
