const test = require('node:test');
const assert = require('node:assert/strict');
const {rollingComparison, windowForDate, ninetyDayBreakdown} = require('../dist/trend-data.js');

test('90-day windows include both endpoints without overlap or a gap', () => {
  const dates = ['2026-04-05', '2026-04-06', '2026-07-04', '2026-07-05', '2026-10-02', '2026-10-03'];
  const result = rollingComparison(dates.map(startDate => ({startDate})), '2026-10-02');
  assert.deepEqual([result.previousStart, result.previousEnd, result.recentStart, result.recentEnd],
    ['2026-04-06', '2026-07-04', '2026-07-05', '2026-10-02']);
  assert.deepEqual(dates.map(date => windowForDate(date, result)),
    ['earlier', 'previous', 'previous', 'recent', 'recent', null]);
  assert.equal(result.recentTotal, 2);
  assert.equal(result.previousTotal, 2);
  assert.equal(result.change, 0);
});

test('month rollover advances one day, not an entire month', () => {
  const before = rollingComparison([], '2026-09-30');
  const after = rollingComparison([], '2026-10-01');
  assert.equal(before.recentStart, '2026-07-03');
  assert.equal(after.recentStart, '2026-07-04');
  assert.equal(before.previousStart, '2026-04-04');
  assert.equal(after.previousStart, '2026-04-05');
});

test('each window has exactly 90 UTC dates across leap days and clock changes', () => {
  for (const cutoff of ['2028-05-01', '2026-11-01']) {
    const result = rollingComparison([], cutoff);
    for (const prefix of ['recent', 'previous']) {
      assert.equal((Date.parse(result[prefix + 'End']) - Date.parse(result[prefix + 'Start'])) / 86400000 + 1, 90);
    }
  }
});

test('missing historical coverage and zero baselines do not produce percentages', () => {
  const early = rollingComparison([{startDate: '2026-01-02'}], '2026-01-03');
  assert.equal(early.hasComparison, false);
  assert.equal(early.change, null);
  const zero = rollingComparison([{startDate: '2026-10-01'}], '2026-10-02');
  assert.equal(zero.hasComparison, true);
  assert.equal(zero.change, null);
});

test('counts records once regardless of anchors or reported aircraft totals', () => {
  const events = [
    {startDate: '2026-04-06'},
    {startDate: '2026-07-05', positions: [{}, {}], reported_UAVs: 5},
    {startDate: '2026-10-02', recordClass: 'candidate'}
  ];
  const result = rollingComparison(events, '2026-10-02');
  assert.equal(result.previousTotal, 1);
  assert.equal(result.recentTotal, 2);
  assert.equal(result.change, 1);
});

test('all 90-day blocks run backwards from cutoff and stop at January 1', () => {
  const {blocks} = ninetyDayBreakdown([], '2026-11-17');
  assert.deepEqual(blocks.map(({start, end, days, age, partial}) => [start, end, days, age, partial]), [
    ['2026-01-01', '2026-02-20', 51, 3, true],
    ['2026-02-21', '2026-05-21', 90, 2, false],
    ['2026-05-22', '2026-08-19', 90, 1, false],
    ['2026-08-20', '2026-11-17', 90, 0, false]
  ]);
});

test('monthly splits count boundary dates once and retain records with several positions', () => {
  const dates = ['2026-02-20', '2026-02-21', '2026-05-21', '2026-05-22', '2026-08-19', '2026-08-20', '2026-11-17'];
  const events = dates.map(startDate => ({startDate, positions: [{}, {}], reported_UAVs: 5}));
  events.push({startDate: '2025-12-31'}, {startDate: '2026-11-18'}, {startDate: '2026-11-17', recordClass: 'excluded'});
  const {blocks, months} = ninetyDayBreakdown(events, '2026-11-17');
  assert.deepEqual(blocks.map(b => b.total), [1, 2, 2, 2]);
  assert.deepEqual(months[1].counts, [1, 1, 0, 0]);
  assert.deepEqual(months[4].counts, [0, 1, 1, 0]);
  assert.deepEqual(months[7].counts, [0, 0, 1, 1]);
  assert.equal(months.reduce((n, month) => n + month.total, 0), dates.length);
  for (const month of months) assert.equal(month.total, month.counts.reduce((a, b) => a + b, 0));
  for (let i = 0; i < blocks.length; i++) {
    assert.equal(blocks[i].total, months.reduce((n, month) => n + month.counts[i], 0));
    assert.equal(blocks[i].dailyAverage, blocks[i].total / blocks[i].days);
  }
});

test('year-start, leap-day and full-year cutoffs cover each UTC date exactly once', () => {
  for (const cutoff of ['2026-01-01', '2026-03-31', '2028-02-29', '2026-12-31', '2028-12-31']) {
    const events = [];
    for (let date = Date.parse(cutoff.slice(0, 4) + '-01-01'); date <= Date.parse(cutoff); date += 86400000) {
      events.push({startDate: new Date(date).toISOString().slice(0, 10)});
    }
    const {blocks, months} = ninetyDayBreakdown(events, cutoff);
    assert.equal(blocks[0].start, cutoff.slice(0, 4) + '-01-01');
    assert.equal(blocks.at(-1).end, cutoff);
    assert.equal(blocks.reduce((n, block) => n + block.days, 0), events.length);
    for (const block of blocks) {
      assert.equal(block.total, block.days);
      assert.equal(block.dailyAverage, 1);
      assert.ok(block.days <= 90);
    }
    for (let i = 1; i < blocks.length; i++) assert.equal(Date.parse(blocks[i].start) - Date.parse(blocks[i - 1].end), 86400000);
    assert.equal(months.reduce((n, month) => n + month.total, 0), events.length);
    if (cutoff.endsWith('12-31')) assert.equal(blocks.length, 5);
  }
});

test('empty periods remain visible with zero totals and finite daily averages', () => {
  const {blocks, months} = ninetyDayBreakdown([], '2026-11-17');
  assert.equal(blocks.length, 4);
  assert.equal(months.length, 11);
  assert.ok(blocks.every(block => block.total === 0 && block.dailyAverage === 0));
  assert.ok(months.every(month => month.total === 0));
});
