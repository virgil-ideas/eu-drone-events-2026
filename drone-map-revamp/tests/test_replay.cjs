'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {intervalEvents, cumulative, territorialCountry} = require('../replay-data.js');
const app = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
const canonical = fs.readFileSync(path.join(__dirname, '../../drone-map/dist/app.js'), 'utf8');
const events = JSON.parse(fs.readFileSync(path.join(__dirname, '../../drone-map/data/events.json'), 'utf8'));
const active = events.filter(event => event.recordClass !== 'excluded');

test('only explicitly territorial records receive that jurisdiction label', () => {
  for (const id of ['N086', 'N089']) assert.equal(territorialCountry(events.find(e => e.id === id)), 'Romania');
  for (const id of ['N072', 'N073', 'N079', 'N080', 'N090', 'N112', 'E033', 'E034']) {
    assert.equal(territorialCountry(events.find(e => e.id === id)), null, id);
  }
});

test('interval framing keeps all October locations before the playhead advances', () => {
  const pool = intervalEvents(active, '2026-10-01', '2026-10-23');
  assert.equal(pool.length, active.filter(e=>e.startDate>='2026-10-01'&&e.startDate<='2026-10-23').length);
  assert(pool.some(e => e.id === 'N068'));
  assert(pool.some(e => e.id === 'N112'));
  let fitted;
  const context = {intervalEvents:()=>pool, visibleEvents:[pool[0]], events:active,
    map:{fitBounds(points){fitted=points;}}, mapPadding:()=>({}), reducedMotion:true};
  vm.createContext(context);
  vm.runInContext(app.slice(app.indexOf('  function fitEvents'),app.indexOf('  // Media helpers'))+'\nfitEvents();',context);
  assert.equal(fitted.length,pool.reduce((n,event)=>n+event.positions.length,0));
  const khoryv=pool.find(event=>event.id==='N112').positions[0];
  assert(fitted.some(([lat,lng])=>lat===khoryv.lat&&lng===khoryv.lng));
});

test('country, date and empty filtered curves count records once', () => {
  const greek = active.filter(event => event.countries === 'Greece');
  const greekThroughCutoff = greek.filter(event => event.startDate <= '2026-10-23');
  assert.equal(cumulative(greek, '2026-01-01', '2026-10-23').at(-1), greekThroughCutoff.length);
  const oct = intervalEvents(greek, '2026-10-01', '2026-10-23');
  const totals = cumulative(oct, '2026-01-01', '2026-10-23');
  assert.equal(totals[272], 0);
  assert.equal(totals.at(-1), oct.length);
  assert.equal(cumulative([], '2026-01-01', '2026-10-23').at(-1), 0);
  assert.deepEqual(cumulative([{startDate:'2026-10-23', positions:[{},{}]}], '2026-10-22', '2026-10-23'), [0,1]);
});

function audioHarness(source) {
  const nodes = [];
  const param = () => ({value:0, calls:[], setValueAtTime(...a){this.calls.push(['set',...a]);},
    linearRampToValueAtTime(...a){this.calls.push(['ramp',...a]);},
    exponentialRampToValueAtTime(...a){this.calls.push(['exp',...a]);},
    cancelAndHoldAtTime(...a){this.calls.push(['hold',...a]);}});
  class Audio {
    constructor(){this.currentTime=0;this.state='running';this.sampleRate=48000;this.destination={};}
    resume(){return Promise.resolve();}
    createGain(){return {gain:param(),connect(){return this;},disconnect(){}};}
    createOscillator(){const node={frequency:param(),stops:[],connect(to){this.envelope=to;return to;},disconnect(){},start(at){this.started=at;},stop(at){this.stops.push(at);}};nodes.push(node);return node;}
    createBufferSource(){return this.createOscillator();}
    createBuffer(ch,length,sampleRate){const samples=new Float32Array(length);return {duration:length/sampleRate,getChannelData:()=>samples};}
    createMediaStreamDestination(){return {stream:{}};}
  }
  const context={window:{AudioContext:Audio}};
  vm.createContext(context);
  const snippet=source.slice(source.indexOf('  let soundEnabled'), source.indexOf('  function revealEvents'));
  vm.runInContext(snippet+'\nthis.audio={prepareAudio,playArrivalSound,createBellBuffer,get context(){return audioContext;}};',context);
  context.audio.prepareAudio();
  return {...context.audio,nodes};
}

test('every category pair starts immediately and leaves the older voice untouched', () => {
  const categories=['alert','recovery','flight','disposal','engaged','shotdown','crash','strike','explosion'];
  for (const first of categories) for (const next of categories) {
    const audio=audioHarness(app);
    audio.playArrivalSound([{category:first}]);
    const voice=audio.nodes[0], stops=[...voice.stops], envelope=JSON.stringify(voice.envelope.gain.calls);
    audio.context.currentTime=.03125; // One replay day at 4× speed.
    audio.playArrivalSound([{category:next}]);
    assert.deepEqual(voice.stops,stops,`${first} -> ${next}`);
    assert.equal(JSON.stringify(voice.envelope.gain.calls),envelope);
    assert.equal(audio.nodes[1].started,.03125);
  }
});

test('red and purple bells retain the exact approved waveform and duration', () => {
  const revised=audioHarness(app), original=audioHarness(canonical);
  for(const note of [76,81,84]) {
    const actual=revised.createBellBuffer(note), expected=original.createBellBuffer(note);
    assert.equal(actual.duration,.9);
    assert.deepEqual(actual.getChannelData(0),expected.getChannelData(0));
  }
});

test('natural recording completion holds the last frame; manual stop cancels the hold', () => {
  const trace=[], timers=new Map();let nextTimer=1;
  const context={trace,requestAnimationFrame:()=>1,cancelAnimationFrame(){},
    setTimeout(fn,ms){const id=nextTimer++;timers.set(id,{fn,ms});return id;},clearTimeout(id){timers.delete(id);},
    drawRecordingFrame(){trace.push('frame');},setIntervalControlsDisabled(){},t:()=>'',
    $:()=>({classList:{remove(){}},textContent:''})};
  vm.createContext(context);
  const finish=app.slice(app.indexOf('  function finishVideoRecording'),app.indexOf('  function downloadSnapshotPNG'));
  vm.runInContext(`let isRecordingVideo=true,recordingFinishing=false,recordingEndTimer=null,recordingHoldFrame=null;
    const mediaRecorder={state:'recording',stop(){trace.push('stop');}};${finish}
    this.finish=finishVideoRecording;`,context);
  context.finish({drain:true});
  assert.deepEqual(trace,[]);
  assert.equal(timers.size,1);
  assert([...timers.values()][0].ms >= 1000);
  context.finish({drain:true});
  assert.equal(timers.size,1);
  context.finish();
  assert.equal(timers.size,0);
  assert.deepEqual(trace,['frame','stop']);
  // A later one-day recording must also save automatically, with no user stop.
  trace.length=0;
  vm.runInContext('isRecordingVideo=true;',context);
  context.finish({drain:true});
  [...timers.values()][0].fn();
  assert.deepEqual(trace,['frame','stop']);
  assert.equal(timers.size,0);
});

test('new interface labels exist and are not an English fallback block', () => {
  const dictionaries={window:{}};
  vm.createContext(dictionaries);
  const folder=path.join(__dirname,'../i18n');
  for(const file of fs.readdirSync(folder).filter(name=>name.endsWith('.js'))) {
    vm.runInContext(fs.readFileSync(path.join(folder,file),'utf8'),dictionaries);
  }
  const locales=dictionaries.window.DRONE_I18N;
  const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
  const referenced=[...html.matchAll(/data-i18n(?:-aria|-title|-placeholder)?="([^"]+)"/g),
    ...app.matchAll(/\bt\('([^']+)'/g)].map(match=>match[1]);
  for(const key of referenced) assert(key in locales.en,`Missing UI string: ${key}`);
  const newKeys=Object.keys(locales.en).filter(key=>key.startsWith('revamp.'));
  for(const [language,strings] of Object.entries(locales)) {
    if(language==='en') continue;
    // Allow shared terms such as "Studio" and "TL;DR", but reject copied blocks.
    const copied=newKeys.filter(key=>strings[key]===locales.en[key]);
    assert(copied.length < newKeys.length/4,`${language}: untranslated interface block`);
  }
});
