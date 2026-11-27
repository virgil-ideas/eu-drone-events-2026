'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const app = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
function section(start, end) {
  const from = app.indexOf(start), to = app.indexOf(end, from);
  assert(from >= 0 && to > from);
  return app.slice(from, to);
}

function shareCard() {
  const pending = [], downloads = [], errors = [];
  let click, encode;
  const canvas = {
    width: 300, height: 150, parentElement: {dataset: {}}, setAttribute() {},
    getContext: () => ({drawImage(scratch) { canvas.image = scratch.image; }}),
    toBlob(callback) { encode = () => callback({image: canvas.image}); }
  };
  const nodes = {
    'share-canvas': canvas,
    'share-download': {disabled: true},
    'share-period': {value: 'year'},
    'stats-body': {addEventListener(type, handler) { click = handler; }}
  };
  const context = {
    $: id => nodes[id], shareFormat: 'square', dataYear: '2026', country: 'eu',
    scopeSlug: () => context.country,
    shareCardModel: () => ({format: context.shareFormat, period: nodes['share-period'].value}),
    document: {createElement: () => ({})},
    CHARTS: {drawShareCard: (scratch, model) => new Promise((resolve, reject) => pending.push({
      finish() { Object.assign(scratch, {width: 1080, height: model.format === 'story' ? 1920 : 1080, image: model.period}); resolve(); },
      reject
    }))},
    console: {error: (...args) => errors.push(args)},
    downloadBlob: (blob, name) => downloads.push({blob, name})
  };
  vm.createContext(context);
  vm.runInContext(section('  let shareDrawToken', '  function showChartRecordsOnMap')
    + section("  $('stats-body').addEventListener('click'", "  $('stats-body').addEventListener('change'")
    + 'this.render = renderShareCard;', context);
  return {context, canvas, nodes, pending, downloads, errors,
    download: () => click({target: {closest: selector => selector === '#share-download' ? nodes['share-download'] : null}}),
    encode: () => encode?.()};
}

test('PNG downloads stay unavailable until the first card finishes rendering', async () => {
  const card = shareCard();
  const rendering = card.context.render();
  assert.equal(card.nodes['share-download'].disabled, true);
  card.download();
  card.encode();
  assert.equal(card.downloads.length, 0, 'never export the initial blank canvas');
  card.pending[0].finish();
  await rendering;
  assert.equal(card.nodes['share-download'].disabled, false);
  card.download();
  card.encode();
  assert.equal(card.downloads[0].blob.image, 'year');
  assert.equal(card.canvas.width, 1080);
});

test('only the latest period and format render can enable downloading', async () => {
  const card = shareCard();
  const first = card.context.render();
  card.nodes['share-period'].value = '2026-11';
  card.context.shareFormat = 'story';
  const latest = card.context.render();
  card.pending[0].finish();
  await first;
  assert.equal(card.nodes['share-download'].disabled, true);
  card.pending[1].finish();
  await latest;
  card.download();
  card.encode();
  assert.equal(card.canvas.height, 1920);
  assert.equal(card.downloads[0].blob.image, '2026-11');
  assert.equal(card.downloads[0].name, 'droneincidents-eu-eu-2026-11-story.png');
});

test('a failed redraw cannot export the old card and a subsequent render recovers', async () => {
  const card = shareCard();
  const first = card.context.render();
  card.pending[0].finish();
  await first;
  const failed = card.context.render();
  card.pending[1].reject(new Error('Drawing failed'));
  await failed;
  card.download();
  card.encode();
  assert.equal(card.downloads.length, 0);
  assert.equal(card.errors.length, 1);
  const retry = card.context.render();
  card.pending[2].finish();
  await retry;
  assert.equal(card.nodes['share-download'].disabled, false);
});

test('PNG filename keeps the exported settings while image encoding is pending', async () => {
  const card = shareCard();
  const rendering = card.context.render();
  card.pending[0].finish();
  await rendering;
  card.download();
  card.context.country = 'romania';
  card.context.shareFormat = 'story';
  card.nodes['share-period'].value = '2026-11';
  card.encode();
  assert.equal(card.downloads[0].name, 'droneincidents-eu-eu-2026-square.png');
});
