const test = require('node:test');
const assert = require('node:assert/strict');
const {rollingComparison, windowForDate} = require('../dist/trend-data.js');

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
