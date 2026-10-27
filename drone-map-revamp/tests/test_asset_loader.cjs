'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const loader = fs.readFileSync(path.join(__dirname, '../asset-loader.js'), 'utf8');

function harness(overrides = {}) {
  const assets = {'events.js':'a'.repeat(16), 'pages-data.js':'b'.repeat(16),
    'media.js':'c'.repeat(16), 'i18n/ro.js':'d'.repeat(16), 'i18n/pages/ro.js':'e'.repeat(16)};
  const scripts = [], requests = [];
  // Model an existing tab/browser cache containing the old register.
  const window = {DRONE_DATA:{events:Array(164),cutoff:'2026-10-23'}, DRONE_PAGES:{old:true}, DRONE_MEDIA:{old:true}};
  const resources = {
    [`events.js?v=${assets['events.js']}`]: () => { window.DRONE_DATA = {events:Array(170),cutoff:'2026-10-26',sources:{newArticle:true}}; },
    [`pages-data.js?v=${assets['pages-data.js']}`]: () => { window.DRONE_PAGES = {newSummary:true}; },
    [`media.js?v=${assets['media.js']}`]: () => { window.DRONE_MEDIA = {newImage:true}; },
  };
  const manifest = {schemaVersion:1, assets};
  overrides.changeManifest?.(manifest);
  let clock = 1000;
  const context = {window,Date:{now:()=>clock++},
    fetch:async (url, options) => {
      requests.push({url,options});
      if (overrides.offline) throw new Error('offline');
      return {ok:!overrides.httpError,status:overrides.httpError || 200,json:async()=>manifest};
    },
    document:{createElement:()=>({remove(){}}),head:{append(script){
      scripts.push(script.src);
      if (overrides.failScript === script.src.split('?')[0] || !resources[script.src]) script.onerror();
      else { resources[script.src](); script.onload(); }
    }}}
  };
  vm.runInNewContext(loader,context);
  return {api:window.DRONE_ASSETS,window,scripts,requests,assets};
}

test('cached page gets fresh records, news, summaries and media from content URLs', async () => {
  const h = harness();
  await h.api.loadData();
  assert.equal(h.window.DRONE_DATA.events.length,170);
  assert.equal(h.window.DRONE_DATA.cutoff,'2026-10-26');
  assert.equal(h.window.DRONE_DATA.sources.newArticle,true);
  assert.equal(h.window.DRONE_PAGES.newSummary,true);
  assert.equal(h.window.DRONE_MEDIA.newImage,true);
  assert.equal(h.requests.length,1);
  assert.equal(h.requests[0].options.cache,'no-store');
  assert.match(h.requests[0].url,/^asset-manifest\.json\?fresh=\d+$/);
  assert.equal(h.scripts.length,3);
  for (const name of ['events.js','pages-data.js','media.js']) assert(h.scripts.includes(`${name}?v=${h.assets[name]}`));
});

test('manifest refresh bypasses shared caches while unchanged asset URLs stay reusable', async () => {
  const h = harness();
  await h.api.loadData();
  const firstScripts = [...h.scripts];
  await h.api.loadData();
  assert.notEqual(h.requests[0].url,h.requests[1].url);
  assert.deepEqual(h.scripts.slice(3),firstScripts);
});

test('lazy record and interface translations use the same manifest revision', async () => {
  const h = harness();
  await h.api.loadData();
  assert.equal(h.api.url('i18n/pages/ro.js'),`i18n/pages/ro.js?v=${h.assets['i18n/pages/ro.js']}`);
  assert.equal(h.api.url('i18n/ro.js'),`i18n/ro.js?v=${h.assets['i18n/ro.js']}`);
  assert.throws(()=>h.api.url('unknown.js'),/Missing or invalid/);
});

test('manifest failures never silently accept the older cached register', async () => {
  for (const settings of [{offline:true},{httpError:503},{changeManifest:m=>{m.schemaVersion=2;}},
    {changeManifest:m=>{delete m.assets['events.js'];}},
    {changeManifest:m=>{m.assets['events.js']='https://example.com/script.js';}}]) {
    const h = harness(settings);
    await assert.rejects(h.api.loadData());
    assert.equal(h.scripts.length,0);
  }
});

test('failed data script rejects startup rather than combining old and new data', async () => {
  const h = harness({failScript:'events.js'});
  await assert.rejects(h.api.loadData(),/Could not load events.js/);
});

test('startup waits for data and presents a retry when loading fails', async () => {
  const app = fs.readFileSync(path.join(__dirname,'../app.js'),'utf8');
  const startup = app.slice(0,app.indexOf('  const {events, contexts, sources, cutoff}'));
  let completed = false, message, retry;
  const context = {window:{DRONE_ASSETS:{loadData:async()=>{throw new Error('offline');}}},
    console:{error(){}},location:{reload(){completed=true;}},
    document:{documentElement:{removeAttribute(){}},
      createElement:()=>({setAttribute(){},querySelector:()=>({addEventListener:(_,fn)=>{retry=fn;}})}),
      body:{replaceChildren:node=>{message=node;}}}};
  await vm.runInNewContext(startup+'throw new Error("must not initialize with stale data");})();',context);
  assert.match(message.innerHTML,/Could not load the latest records/);
  assert.equal(message.lang,'en');
  retry();
  assert.equal(completed,true);
});
