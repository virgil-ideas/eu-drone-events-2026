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
    map:{invalidateSize(){},fitBounds(points){fitted=points;}}, pendingMapFit:false,
    $:()=>({clientWidth:390,clientHeight:700}), mapPadding:()=>({}), reducedMotion:true};
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

function recordingHarness(withAudio = true) {
  const trace = [], timers = new Map(), frames = new Map();
  let nextId = 1, now = 0;
  const recorder = {state:'recording', pause(){this.state='paused';trace.push('recorder.pause');},
    resume(){this.state='recording';trace.push('recorder.resume');}, stop(){this.state='inactive';trace.push('stop');}};
  const context = {trace, mediaRecorder:recorder,
    performance:{now:()=>now}, document:{hidden:false,addEventListener(name,fn){this[name]=fn;}},
    requestAnimationFrame(fn){const id=nextId++;frames.set(id,fn);return id;},cancelAnimationFrame(id){frames.delete(id);},
    setTimeout(fn,ms){const id=nextId++;timers.set(id,{fn,ms});return id;},clearTimeout(id){timers.delete(id);},
    drawRecordingFrame(){trace.push('frame');}, render(){trace.push('render');}, renderPlayhead(){},
    setIntervalControlsDisabled(){},stopVoices(){trace.push('stopVoices');},updatePlayButton(){},
    audioContext:withAudio ? {suspend(){trace.push('audio.suspend');return Promise.resolve();},resume(){trace.push('audio.resume');return Promise.resolve();}} : null,
    t:()=>'', $:()=>({value:'1',classList:{remove(){}},textContent:''})};
  vm.createContext(context);
  const playback = app.slice(app.indexOf('  function pause('),app.indexOf('  function play()'));
  const recording = app.slice(app.indexOf('  function scheduleRecordingTail'),app.indexOf('  function downloadSnapshotPNG'));
  const visibility = app.slice(app.indexOf("  document.addEventListener('visibilitychange'"),app.indexOf('  // Let translated/wrapped headers'));
  vm.runInContext(`let isRecordingVideo=true,recordingFinishing=false,recordingEndTimer=null,recordingHoldFrame=null,
    recordingPausedForVisibility=false,recordingResumeToken=0,recordingTailRemaining=0,recordingTailDeadline=0,
    playing=true,animationFrame=null,lastFrameTime=null,playbackDay=0,currentDay=0,intervalEndDay=295,visibleEvents=[];
    const REPLAY_DAYS_PER_SECOND=8;
    ${playback}${recording}${visibility}
    this.finish=finishVideoRecording;this.resume=resumeVideoRecording;this.tick=tick;
    this.snapshot=()=>({playing,currentDay,recordingPausedForVisibility,recordingFinishing,isRecordingVideo});`,context);
  return {context,trace,timers,frames,recorder,
    frame(timestamp){frames.clear();context.tick(timestamp);},
    setTime(value){now=value;}, hide(){context.document.hidden=true;context.document.visibilitychange();},
    async show(){context.document.hidden=false;await context.resume();}};
}

test('natural recording completion holds the last frame; manual stop cancels the hold', () => {
  const {context,trace,timers}=recordingHarness();
  context.finish({drain:true});
  assert.deepEqual(trace,[]);
  assert.equal(timers.size,1);
  assert([...timers.values()][0].ms >= 1000);
  context.finish({drain:true});
  assert.equal(timers.size,1);
  context.finish();
  assert.equal(timers.size,0);
  assert.deepEqual(trace,['frame','stop']);
  trace.length=0;
  vm.runInContext('isRecordingVideo=true;',context);
  context.mediaRecorder.state='recording';
  context.finish({drain:true});
  [...timers.values()][0].fn();
  assert.deepEqual(trace,['frame','stop']);
  assert.equal(timers.size,0);
});

test('hidden recordings pause video and audio without skipping dates on return', async () => {
  for (const withAudio of [true,false]) {
    const h=recordingHarness(withAudio);
    h.frame(0); h.frame(1000);
    assert.equal(h.context.snapshot().currentDay,8);
    h.hide();
    assert.equal(h.recorder.state,'paused');
    assert.equal(h.frames.size,0);
    h.frame(21000); // Even an already queued frame must not advance while hidden.
    assert.equal(h.context.snapshot().currentDay,8);
    await h.show();
    assert.equal(h.recorder.state,'recording');
    assert.equal(h.frames.size,1);
    h.frame(21000);
    assert.equal(h.context.snapshot().currentDay,8);
    h.frame(22000);
    assert.equal(h.context.snapshot().currentDay,16);
    assert(!h.trace.includes('stopVoices'));
    if(withAudio) assert(h.trace.includes('audio.suspend') && h.trace.includes('audio.resume'));
  }
});

test('the final bell tail excludes hidden time and resumes before saving', async () => {
  const h=recordingHarness();
  h.context.finish({drain:true});
  h.setTime(300); h.hide();
  assert.equal(h.timers.size,0);
  h.setTime(20300); await h.show();
  assert.equal(h.timers.size,1);
  assert.equal([...h.timers.values()][0].ms,800);
  assert(!h.trace.includes('stop'));
  [...h.timers.values()][0].fn();
  assert.equal(h.trace.at(-1),'stop');
  assert.equal(h.context.snapshot().isRecordingVideo,false);
});

test('a stale audio resume cannot restart a recording after another hide or stop', async () => {
  const h=recordingHarness();
  h.hide();
  let resolve;
  h.context.audioContext.resume=()=>new Promise(r=>{resolve=r;});
  h.context.document.hidden=false;
  const pending=h.context.resume();
  h.hide(); resolve(); await pending;
  assert.equal(h.recorder.state,'paused');
  assert.equal(h.frames.size,0);
  h.context.audioContext.resume=()=>Promise.resolve();
  h.context.finish();
  await h.show();
  assert.equal(h.recorder.state,'inactive');
  assert.equal(h.frames.size,0);
});

test('map padding reserves the measured panel height on phones and desktops', () => {
  const context={innerWidth:390,studioOpen:true,$:id=>({getBoundingClientRect:()=>id==='map'
    ? {height:759,bottom:844} : {height:368,top:468}})};
  vm.createContext(context);
  vm.runInContext(app.slice(app.indexOf('  function mapPadding'),app.indexOf('  function fitEvents'))+'this.padding=mapPadding;',context);
  assert.equal(context.padding().paddingBottomRight[1],392);
  context.innerWidth=1280;
  assert.equal(context.padding().paddingBottomRight[1],392);
  context.studioOpen=false;
  assert.equal(context.padding().paddingBottomRight[1],100);
});

test('event stepping follows only the filtered interval, including empty results', () => {
  const greek=active.filter(e=>e.countries==='Greece'&&e.startDate>='2026-10-01'&&e.startDate<='2026-10-04');
  const selected=[];
  const context={currentDay:276,intervalEvents:()=>greek,
    dayOf:date=>Math.round((Date.parse(date)-Date.parse('2026-01-01'))/86400000),
    setDay(day){selected.push(day);context.currentDay=day;}};
  vm.createContext(context);
  vm.runInContext(app.slice(app.indexOf('  function filteredEventDays'),app.indexOf('  function setDay'))+'this.step=stepEvent;',context);
  context.step(-1);assert.deepEqual(selected,[273]);
  context.step(1);assert.deepEqual(selected,[273,276]);
  context.step(1);assert.equal(selected.length,2);
  context.intervalEvents=()=>[];
  context.step(-1);assert.equal(selected.length,2);
});

test('mobile tabs, feed tabs and interval presets expose their actual pressed state', () => {
  const elements=new Map();
  const element=id=>{if(!elements.has(id))elements.set(id,{classList:{toggle(){}},attributes:{},setAttribute(k,v){this.attributes[k]=v;}});return elements.get(id);};
  const workspace={dataset:{mobileView:'map'}};
  const chips=['all','oct'].map(preset=>Object.assign(element(preset),{dataset:{preset}}));
  const context={feedMode:'incidents',$:element,t:x=>x,renderNewsList(){},
    document:{querySelector:()=>workspace,querySelectorAll:()=>chips}};
  vm.createContext(context);
  const mobile=app.slice(app.indexOf('  function syncMobileTabs'),app.indexOf('  let mobileMapFitted'));
  const feed=app.slice(app.indexOf('  function setFeedMode'),app.indexOf("  $('tab-incidents').addEventListener"));
  const presets=app.slice(app.indexOf('  function updatePresetChips'),app.indexOf('  function applyInterval'));
  vm.runInContext(mobile+feed+presets+'syncMobileTabs();updatePresetChips("oct");',context);
  assert.equal(element('mob-tab-feed').attributes['aria-pressed'],'false');
  assert.equal(element('mob-tab-map').attributes['aria-pressed'],'true');
  assert.equal(element('all').attributes['aria-pressed'],'false');
  assert.equal(element('oct').attributes['aria-pressed'],'true');
  workspace.dataset.mobileView='feed';
  vm.runInContext('setFeedMode("news");',context);
  assert.equal(element('tab-incidents').attributes['aria-pressed'],'false');
  assert.equal(element('tab-news').attributes['aria-pressed'],'true');
  assert.equal(element('mob-tab-news').attributes['aria-pressed'],'true');
});

test('the cumulative chart describes the filtered totals and refreshes on empty results', () => {
  const attrs={},chart={setAttribute(k,v){attrs[k]=v;}};
  const context={lang:'en',totalDays:295,intervalStartDay:273,intervalEndDay:276,playbackDay:276,
    firstDateStr:'2026-01-01',cutoff:'2026-10-23',DARK_TURN_DATE:'2026-10-05',window:{DRONE_REPLAY:{cumulative}},
    intervalEvents:()=>active.filter(e=>e.countries==='Greece'&&e.startDate>='2026-10-01'&&e.startDate<='2026-10-04'),
    dayOf:date=>Math.round((Date.parse(date)-Date.parse('2026-01-01'))/86400000),
    dayToDate:day=>new Date(Date.parse('2026-01-01')+day*86400000).toISOString().slice(0,10),
    $:()=>chart,t:(key,values)=>values?JSON.stringify(values):key,shortDate:x=>x,escape:x=>x,format:{number:{format:String}}};
  vm.createContext(context);
  vm.runInContext(app.slice(app.indexOf("  let cumulativeKey = ''"),app.indexOf('  // Render the Black Sea Maritime Escalation'))+'renderCumulative();',context);
  assert.deepEqual(JSON.parse(attrs['aria-label']),{first:0,firstDate:'2026-09-30',last:2,lastDate:'2026-10-04'});
  context.intervalEvents=()=>[];
  vm.runInContext('renderCumulative();',context);
  assert.equal(JSON.parse(attrs['aria-label']).last,0);
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
