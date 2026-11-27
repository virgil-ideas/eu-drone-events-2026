'use strict';
// The figures and charts in "Charts & figures" are what the press will quote,
// so every count is checked against the register itself.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const stats = require('../stats.js');
const charts = require('../charts.js');
const replay = require('../replay-data.js');

const context = {window: {}};
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../events.js'), 'utf8'), context);
const {events, cutoff, sources} = context.window.DRONE_DATA;
const months = stats.monthsBetween(events, cutoff);

const record = (id, startDate, extra = {}) => ({id, startDate, countries: 'Romania', category: 'flight', stages: ['flight'], sources: ['S1'], title: id, ...extra});

test('months run without gaps from the first record to the cutoff', () => {
  assert.equal(months[0], events.map(event => event.startDate).sort()[0].slice(0, 7));
  assert.equal(months.at(-1), cutoff.slice(0, 7));
  for (let i = 1; i < months.length; i++) assert.equal(stats.previousMonth(months[i]), months[i - 1]);
});

test('monthly totals add up to every record, split into the two outcome groups', () => {
  const series = stats.monthly(events, months);
  assert.equal(series.reduce((sum, item) => sum + item.total, 0), events.length);
  for (const item of series) assert.equal(item.impact + item.quiet, item.total);
  const impact = events.filter(event => ['strike', 'explosion', 'shotdown', 'engaged', 'crash'].includes(event.category)).length;
  assert.equal(series.reduce((sum, item) => sum + item.impact, 0), impact);
});

test('a record counts once in each country it names', () => {
  const rows = stats.byCountry(events, months);
  for (const row of rows) {
    assert.equal(row.total, stats.inScope(events, row.country).length, row.country);
    assert.equal(row.months.reduce((a, b) => a + b, 0), row.total, row.country);
  }
  const twoCountries = [record('A', '2026-01-02', {countries: 'Romania; Bulgaria'}), record('B', '2026-01-03', {countries: 'Romania (offshore EEZ)'})];
  assert.deepEqual(stats.byCountry(twoCountries, ['2026-01']).map(row => [row.country, row.total]), [['Romania', 2], ['Bulgaria', 1]]);
});

test('stages count records that include them, so a record can count in several', () => {
  const sample = [record('A', '2026-01-02', {stages: ['shotdown', 'flight', 'recovery']}), record('B', '2026-01-03', {stages: ['engaged', 'disposal']})];
  const counts = Object.fromEntries(stats.stages(sample).map(row => [row.key, row.count]));
  assert.deepEqual(counts, {flight: 1, alert: 0, shotdown: 2, crash: 0, strike: 0, recovery: 1, disposal: 1});
  for (const row of stats.stages(events)) assert.ok(row.count <= events.length);
});

test('the calendar has every day to the cutoff and every record on its first date', () => {
  const days = stats.daily(events, cutoff);
  const start = Date.parse(`${months[0].slice(0, 4)}-01-01T00:00:00Z`);
  assert.equal(days.length, (Date.parse(`${cutoff}T00:00:00Z`) - start) / 86400000 + 1);
  assert.equal(days.at(-1).date, cutoff);
  assert.equal(days.reduce((sum, day) => sum + day.n, 0), events.length);
});

test('sourcing bins and publishers come from the cited sources', () => {
  const result = stats.sourcing(events, sources);
  assert.equal(result.bins.reduce((sum, bin) => sum + bin.count, 0), events.length);
  assert.equal(result.single + result.multiple, events.length);
  assert.equal(result.single, events.filter(event => new Set(event.sources).size <= 1).length);
  assert.ok(result.publishers.every((row, i, all) => i === 0 || all[i - 1].count >= row.count));
});

test('vessel names follow the register titles', () => {
  const name = title => stats.vesselName({title});
  assert.equal(name('Off Byala · CHELSEA 3 drone strike'), 'CHELSEA 3');
  assert.equal(name('ALFA WATAN / ABLE · offshore drone attack'), 'ALFA WATAN / ABLE');
  assert.equal(name('HS Dignity off Krapets · Drone strike and sinking'), 'HS Dignity');
  assert.equal(name('Royad Mammadov · reported drone attack'), 'Royad Mammadov');
  assert.equal(name('Sea Destiny near Sulina · Suspected attempted drone attack'), 'Sea Destiny');
});

test('ship rows list the escalation records in date order and mark unconfirmed claims', () => {
  const escalation = replay.maritimeEscalation(events, cutoff);
  const rows = stats.ships(escalation.records);
  assert.equal(rows.length, escalation.records.length);
  assert.ok(rows.every((row, i) => i === 0 || rows[i - 1].date <= row.date));
  for (const row of rows) {
    const source = events.find(event => event.id === row.id);
    assert.equal(row.confirmed, !['suspected_maritime_drone_attack', 'unconfirmed_offshore_drone_strike'].includes(source.recordType), row.id);
    assert.equal(row.casualties, source.casualties === true, row.id);
  }
});

test('the month figure compares the same days of the previous month', () => {
  const sample = [record('A', '2026-02-05'), record('B', '2026-02-20'), record('C', '2026-03-02'), record('D', '2026-03-09')];
  const figures = stats.keyFigures(sample, '2026-03-10');
  assert.equal(figures.monthTotal, 2);
  assert.equal(figures.previousSameDays, 1);
  assert.equal(figures.monthChange, 1);
  assert.equal(figures.monthComplete, false);
  assert.equal(figures.monthIsRecord, false, 'February had as many records');
  const ahead = stats.keyFigures([...sample, record('E', '2026-03-10')], '2026-03-10');
  assert.equal(ahead.monthIsRecord, true);
  // A 31-day month after a 28-day one still compares every earlier day.
  assert.equal(stats.keyFigures([record('A', '2026-02-28'), record('B', '2026-03-31')], '2026-03-31').previousSameDays, 1);
});

test('headline figures match the register', () => {
  const figures = stats.keyFigures(events, cutoff);
  assert.equal(figures.total, events.length);
  assert.equal(figures.casualties, events.filter(event => event.casualties === true).length);
  assert.equal(figures.latest.startDate, events.map(event => event.startDate).sort().at(-1));
  assert.equal(figures.countries.length, new Set(events.flatMap(stats.countriesOf)).size);
});

test('chart scenes render to SVG with escaped tooltips and no invalid numbers', () => {
  const scenes = [
    charts.columns({width: 600, items: [{label: 'Jan', total: 0, segments: [{value: 0, color: '#000'}], tip: '<b>"x"</b>'}, {label: 'Feb', total: 3, segments: [{value: 1, color: '#c00'}, {value: 2, color: '#00c'}], tip: 'Feb', data: {month: '2026-02'}}]}),
    charts.rankedBars({width: 400, rows: [{label: 'Flight', value: 4, valueText: '4', dot: '#00c', tip: 't'}, {label: 'Crash', value: 0, valueText: '0', tip: 't'}]}),
    charts.calendar({width: 700, days: stats.daily(events, cutoff), monthLabel: month => month, tipFor: day => day.date}),
    charts.smallMultiples({width: 500, firstLabel: 'Jan', lastLabel: 'Nov', rows: stats.byCountry(events, months).map(row => ({label: row.country, totalText: String(row.total), values: row.months})), tipFor: () => 'tip'}),
    charts.shipRows({width: 700, start: '2026-10-05', end: cutoff, ticks: [{date: '2026-10-05', text: '5 Oct'}], items: stats.ships(replay.maritimeEscalation(events, cutoff).records).map(row => ({...row, code: 'RO', dateText: row.date, tip: row.name}))})
  ];
  for (const scene of scenes) {
    const svg = charts.toSVG(scene, 'Chart & "label"');
    assert.ok(!/NaN|undefined|Infinity/.test(svg), svg.slice(0, 200));
    assert.ok(scene.height > 0);
  }
  const svg = charts.toSVG(scenes[0]);
  assert.match(svg, /data-tip="&lt;b&gt;&quot;x&quot;&lt;\/b&gt;"/);
  assert.match(svg, /data-month="2026-02"/);
  const cells = charts.toSVG(scenes[2]).match(/data-day=/g) || [];
  assert.equal(cells.length, stats.daily(events, cutoff).filter(day => day.n).length);
});
