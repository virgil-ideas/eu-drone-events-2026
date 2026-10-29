'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const fonts = require('../og/fonts.js');
const trend = require('../trend-data.js');

test('missing stylesheet cannot pass as loaded fonts', async () => {
  await assert.rejects(fonts.load({load: async () => [], check: () => true}, 'Sample'), /Required card font/);
});

test('a failed face or missing weight rejects the card', async () => {
  await assert.rejects(fonts.load({load: async () => [{status: 'error'}]}, 'Sample'), /Required card font/);
  await assert.rejects(fonts.load({load: async font => font.startsWith('500') ? [] : [{status: 'loaded'}]}, 'Sample'), /500/);
  await assert.rejects(fonts.load({load: async () => { throw new Error('network failure'); }}, 'Sample'), /network failure/);
});

test('all requested weights load with the actual card text', async () => {
  const calls = [];
  await fonts.load({load: async (font, text) => { calls.push([font, text]); return [{status: 'loaded'}]; }}, 'Constanța · Purvėnai');
  assert.equal(calls.length, 5);
  assert(calls.every(([, text]) => text === 'Constanța · Purvėnai'));
});

async function card(search = '') {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {textContent: '', innerHTML: '', classList: {add() {}, toggle() {}}, querySelectorAll: () => []});
    return elements.get(id);
  };
  const context = {
    URLSearchParams, Intl, Date,
    document: {body: {dataset: {}, textContent: 'Card text'}, getElementById: element,
      fonts: {load: async () => [{status: 'loaded'}]}},
    window: {
      location: {search}, DRONE_I18N: {}, DRONE_OG_FONTS: fonts, DRONE_TREND: trend,
      DRONE_GEO: {lines: [], labels: []},
      DRONE_DATA: {cutoff: '2026-10-28', events: [
        {id: 'old', startDate: '2026-06-01', countries: 'Romania', recordClass: 'event', positions: [{lat: 44, lng: 29}], title: 'Older incident'},
        {id: 'new', startDate: '2026-10-28', countries: 'Bulgaria (offshore)', recordClass: 'event', positions: [{lat: 43, lng: 28}], title: 'Newest incident'}
      ]},
      DRONE_PAGES: {new: {headline: 'CONTSHIP JET report'}}
    }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../i18n/en.js'), 'utf8'), context);
  await vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../og/card.js'), 'utf8'), context);
  assert.deepEqual(context.document.body.dataset, {fonts: 'ok', ready: '1'});
  return element;
}

test('homepage card retains the latest incident and highlighted marker', async () => {
  const element = await card();
  assert.equal(element('latest-headline').textContent, 'CONTSHIP JET report');
  assert.match(element('latest-label').innerHTML, /Latest/);
  assert.match(element('map').innerHTML, /class="newest"/);
});

test('event-link overview names no unrelated incident and highlights no latest marker', async () => {
  const element = await card('?view=overview');
  assert.equal(element('latest-headline').textContent, 'Explore the incidents, read the sources and replay the timeline.');
  assert.doesNotMatch(element('latest-label').innerHTML + element('latest-headline').textContent, /CONTSHIP|Latest/);
  assert.doesNotMatch(element('map').innerHTML, /class="newest"/);
  assert.match(element('stats').innerHTML, /28 October 2026|28 Oct 2026/);
});
