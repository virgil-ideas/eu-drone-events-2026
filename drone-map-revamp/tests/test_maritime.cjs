'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {maritimeEscalation} = require('../replay-data.js');
const events = JSON.parse(fs.readFileSync(path.join(__dirname,'../../drone-map/data/events.json'),'utf8'));

test('current escalation includes CONTSHIP JET once, with the correct end date', () => {
  const summary=maritimeEscalation(events,'2026-10-28');
  assert.equal(summary.records.length,9);
  assert.equal(summary.ships.length,12);
  assert.equal(summary.endDate,'2026-10-28');
  assert.equal(summary.records.at(-1).id,'N124');
  assert.deepEqual(summary.precursors.map(e=>e.id),['E033','E034','E053']);
  assert.equal(summary.records.filter(e=>e.id==='N073').length,1,'a two-vessel record is counted once');
  assert(summary.records.some(e=>e.id==='N089'),'provisional targeting remains included');
  const ids=new Set(summary.ships.map(e=>e.id));
  for(const id of ['E043','E047','N077']) assert(!ids.has(id),'platform and debris incidents are not shipping attacks');
});

test('later shipping additions advance labels and counts without editing interface IDs', () => {
  const next={...events.find(e=>e.id==='N124'),id:'N999',startDate:'2026-11-02'};
  const input=[next,...events];
  const order=input.map(e=>e.id);
  const summary=maritimeEscalation(input,'2026-11-05');
  assert.equal(summary.records.length,10);
  assert.equal(summary.endDate,'2026-11-02','unrelated cutoff changes do not extend ship replay');
  assert.equal(summary.records.at(-1).id,'N999');
  assert.deepEqual(input.map(e=>e.id),order,'sorting does not mutate register order');
  assert.equal(maritimeEscalation(input,'2026-10-28').records.length,9,'future records stay outside cutoff');
});

test('overnight Sulina reports extend the replay through 15 November and count each ship record once', () => {
  const summary = maritimeEscalation(events, '2026-11-15');
  assert.equal(summary.endDate, '2026-11-15');
  assert.equal(summary.records.length, 13);
  assert.deepEqual(summary.records.filter(event => event.startDate >= '2026-11-13').map(event => event.id),
    ['N158', 'N160', 'N161', 'N168']);
  assert.equal(maritimeEscalation(events, '2026-11-14').endDate, '2026-11-14');
  const overnight = events.find(event => event.id === 'N168');
  const sameDay = events.find(event => event.id === 'N161');
  const later = {...sameDay, id: 'N999', startDate: '2026-11-15'};
  const overlap = {...overnight, endDate: '2026-11-16'};
  assert.equal(maritimeEscalation([overlap, later], '2026-11-18').endDate, '2026-11-16');
});

test('provisional November vessel incidents extend replay while keeping their evidence status', () => {
  const summary = maritimeEscalation(events, '2026-11-17');
  assert.equal(summary.endDate, '2026-11-17');
  assert.equal(summary.records.length, 16);
  for (const id of ['N175', 'N178']) {
    const records = summary.records.filter(event => event.id === id);
    assert.equal(records.length, 1);
    assert.equal(records[0].recordClass, 'candidate');
    assert.equal(records[0].category, 'alert');
  }
  for (const id of ['N173', 'N174', 'N177', 'N179']) {
    assert(!summary.ships.some(event => event.id === id), 'debris, warnings and Aegean flights stay outside vessel replay');
  }
  assert.equal(maritimeEscalation(events, '2026-11-16').records.length, 15);
  assert.equal(maritimeEscalation(events, '2026-11-15').records.length, 13);
  const excluded = events.map(event => event.id === 'N178' ? {...event, recordClass: 'excluded'} : event);
  assert.equal(maritimeEscalation(excluded, '2026-11-17').endDate, '2026-11-16');
});

test('Romanian grounding enters vessel replay once without becoming a new strike', () => {
  const records = maritimeEscalation(events, '2026-11-16').records.filter(event => event.id === 'N181');
  assert.equal(records.length, 1);
  assert.equal(records[0].category, 'alert');
  assert.deepEqual(records[0].stages, ['alert']);
  assert.equal(records[0].startDate, '2026-11-16');
  assert(!maritimeEscalation(events, '2026-11-15').ships.some(event => event.id === 'N181'));
});

test('excluded and non-Black-Sea records do not extend the shipping escalation', () => {
  const ship=events.find(e=>e.id==='N124');
  const additions=[
    {...ship,id:'N997',startDate:'2026-11-01',recordClass:'excluded'},
    {...ship,id:'N998',startDate:'2026-11-02',countries:'Greece'},
    {...ship,id:'N999',startDate:'2026-11-03',recordType:'official_offshore_uav_debris_disposal'}
  ];
  const summary=maritimeEscalation([...events,...additions],'2026-11-05');
  assert.equal(summary.records.length,9);
  assert.equal(summary.endDate,'2026-10-28');
  assert.equal(maritimeEscalation(events,'2026-10-23').records.length,8);
});
