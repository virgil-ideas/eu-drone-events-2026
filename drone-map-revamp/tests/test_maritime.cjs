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
