'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const app = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
const records = JSON.parse(fs.readFileSync(path.join(__dirname, '../../drone-map/data/events.json'), 'utf8'));
const active = records.filter(e => e.recordClass !== 'excluded');
function section(start, end) {
  const from = app.indexOf(start), to = app.indexOf(end, from);
  assert(from >= 0 && to > from, `${start} … ${end}`);
  return app.slice(from, to);
}
function elements() {
  const nodes = new Map();
  return id => {
    if (!nodes.has(id)) nodes.set(id, {textContent:'', innerHTML:'', hidden:false,
      classList:{toggle(){}}, setAttribute(){}});
    return nodes.get(id);
  };
}

test('filtering a hidden mobile map defers framing until it is visible again', () => {
  const size = {clientWidth:390,clientHeight:700}, workspace = {dataset:{mobileView:'map'}};
  let pool = [active[0]], fits = [];
  const context = {window:{innerWidth:390}, document:{querySelector:()=>workspace},
    $:()=>size, intervalEvents:()=>pool, reducedMotion:true, mapPadding:()=>({}),
    selectedId:null,openAreaId:null, syncMobileTabs(){}, requestAnimationFrame:fn=>fn(),
    map:{invalidateSize(){},fitBounds(points){fits.push(points);}}};
  vm.createContext(context);
  vm.runInContext(section('  let pendingMapFit', '  // Media helpers')
    + section('  let mobileMapFitted', '  function selectEvent')
    + 'this.fit=fitEvents;this.show=()=>setMobileView("map");', context);
  context.show();
  assert.equal(fits.length, 1);
  workspace.dataset.mobileView='feed'; size.clientWidth=size.clientHeight=0;
  pool=active.filter(e=>e.countries==='Greece');
  context.fit();
  assert.equal(fits.length, 1, 'hidden containers must never be fitted');
  size.clientWidth=390; size.clientHeight=700;
  context.show();
  assert.equal(fits.length, 2);
  assert.equal(fits[1].length,pool.reduce((n,e)=>n+e.positions.length,0));
  context.show();
  assert.equal(fits.length, 2, 'returning without a filter change preserves the view');
});

test('news shows only known source dates, never the linked incident date', () => {
  const $=elements();
  const context = {$,visibleEvents:[{id:'E001',startDate:'2026-01-28',title:'Incident',sources:['S01','S02']}],
    sources:{S01:{id:'S01',publisher:'Press',title:'Report from 2 February',url:'https://example.com/1'},
      S02:{id:'S02',publisher:'Press',title:'Dated report',dateLabel:'2026-02-03',url:'https://example.com/2'}},
    format:{number:{format:String}},feedMode:'news',searchQuery:'',lang:'en',renderedNewsKey:'',
    pageCopyFor:()=>({headline:'Incident'}),shortDate:()=> '28 Jan',escape:String,t:x=>x,colors:{}};
  vm.createContext(context);
  vm.runInContext(section('  function renderNewsList', '  function renderMarkers')+'renderNewsList();',context);
  const html=$('news-list').innerHTML;
  assert.match(html, /class="news-date">S01<\/span>/);
  assert.match(html, /class="news-date">2026-02-03 · S02<\/span>/);
  assert.match(html, /28 Jan/, 'incident dates remain on the explicitly linked incident');
});

test('incident cards mark qualified dates while exact dates stay compact', () => {
  const $=elements();
  const precise={...active[0],id:'E001',startDate:'2026-01-28',dateLabel:'2026-01-28',sources:[]};
  const approximate={...precise,id:'E002',dateLabel:'Late January 2026'};
  const context={$,visibleEvents:[precise,approximate],lang:'en',locale:'en-GB',renderedRecordKey:'',
    selectedId:null,allMode:true,colors:{},sources:{},pageCopyFor:()=>({headline:'Test',description:'Summary'}),
    shortDate:()=> '28 Jan',utcDate:date=>new Date(date),t:key=>key==='card.dateNotes'?'date notes':key,
    allCountriesOf:()=>['Romania'],countryName:x=>x,mediaFor:()=>[],isMaritimeVessel:()=>false,hasCasualties:()=>false,
    format:{monthYear:{format:()=> 'January'},number:{format:String}},categoryLabel:x=>x,escape:String};
  vm.createContext(context);
  vm.runInContext(section('  function renderList', '  // Render Dedicated News')+'renderList();',context);
  assert.match($('event-list').innerHTML,/28 Jan · date notes · Romania/);
  assert.equal(($('event-list').innerHTML.match(/date notes/g)||[]).length,1);
});

test('CSV preserves original date labels and basis, with an Excel UTF-8 signature', async () => {
  let blob;
  const context={visibleEvents:[{...active[0],dateLabel:'Late January 2026',dateBasis:'Discovery date; exact crash date unknown',sources:[]}],
    pageCopyFor:()=>({headline:'Sfântu Gheorghe',description:'Summary'}),sources:{},Blob,
    URL:{createObjectURL:b=>(blob=b,'blob:test'),revokeObjectURL(){}},
    document:{body:{append(){}},createElement:()=>({click(){},remove(){}})},setTimeout(){},
    dayToDate:()=> '2026-01-28',intervalStartDay:0,intervalEndDay:1,currentDay:1,allMode:true};
  vm.createContext(context);
  vm.runInContext(section('  function downloadIntervalCSV', '  // About & Legend')+'downloadIntervalCSV();',context);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  assert.deepEqual([...bytes.slice(0,3)],[0xef,0xbb,0xbf]);
  const text=await blob.text();
  assert.match(text,/startDate,endDate,dateLabel,dateBasis,countries/);
  assert.match(text,/"Late January 2026","Discovery date; exact crash date unknown"/);
  assert.match(text,/Sfântu Gheorghe/);
});

test('localization preserves News mode and the active recording action', () => {
  const $=elements(), context={$,feedMode:'news',isRecordingVideo:true,selectedId:null,openAreaId:null,cutoff:'2026-10-23',
    document:{documentElement:{removeAttribute(){}}},t:key=>'translated:'+key,shortDate:x=>x,
    applyStaticText(){ $('list-title').textContent='Incidents';$('record-video-label').textContent='Record Video'; }};
  for (const name of ['populateFilterDropdowns','renderLegend','renderMonthLabels','renderAbout','renderMaritimeDialog',
    'renderTrend','renderCumulative','labelMarkers','labelAreas','updatePlayButton','updateSoundButton','render',
    'renderNewsList','syncMobileTabs']) context[name]=()=>{};
  vm.createContext(context);
  vm.runInContext(section('  function localize()', '  async function changeLanguage')
    + section('  function setFeedMode', "  $('tab-incidents').addEventListener")+'localize();',context);
  assert.equal($('list-title').textContent,'translated:revamp.listTitleNews');
  assert.equal($('record-video-label').textContent,'translated:revamp.stopSaveVideo');
  assert.equal($('news-list').hidden,false);
  context.feedMode='incidents';context.isRecordingVideo=false;
  vm.runInContext('localize();',context);
  assert.equal($('record-video-label').textContent,'translated:revamp.recordVideo');
});

test('maritime focus labels count the actual October interval in both locations', () => {
  const $=elements(), context={$,events:active,cutoff:'2026-10-23',window:{DRONE_REPLAY:{territorialCountry:()=>null}},
    pageCopyFor:()=>({headline:'Ship'}),shortDateYear:x=>x,escape:String,colors:{},categoryLabel:x=>x,
    t:(key,vars)=>`${key}:${vars?.n ?? ''}`};
  vm.createContext(context);
  vm.runInContext(section('  const MARITIME_SHIP_IDS','  const loadScript')
    +section('  function renderMaritimeDialog','  // Focus map & feed')+'renderMaritimeDialog();',context);
  assert.equal($('focus-maritime-label').textContent,'revamp.darkTurnFocusBtn:8');
  assert.equal($('modal-filter-maritime-label').textContent,$('focus-maritime-label').textContent);
});

test('interval tool rejects invalid, out-of-coverage and reversed dates without changing state', () => {
  const tools=[],calls=[],firstTime=Date.parse('2026-01-01'),lastTime=Date.parse('2026-10-23');
  const context={document:{modelContext:{registerTool:tool=>tools.push(tool)}},window:{addEventListener(){}},AbortController,
    events:active,firstDateStr:'2026-01-01',cutoff:'2026-10-23',firstTime,lastTime,
    dateValue:date=>Date.parse(date+'T00:00:00Z'),dayOf:date=>Math.round((Date.parse(date)-firstTime)/86400000),
    dayToDate:day=>new Date(firstTime+day*86400000).toISOString().slice(0,10),visibleEvents:[],
    applyInterval(start,end){calls.push([start,end]);context.intervalStartDay=start;context.intervalEndDay=end;}};
  vm.createContext(context);
  vm.runInContext(app.slice(app.indexOf('  // WebMCP API'),app.lastIndexOf('})();')),context);
  const tool=tools.find(t=>t.name==='set_drone_timeline_interval');
  for(const [startDate,endDate] of [
    ['2026-02-30','2026-03-05'],['2026-02-01','2026-02-29'],['2025-06-01','2026-10-23'],
    ['2026-01-01','2026-12-31'],['2026-10-23','2026-10-01'],['2026-00-01','2026-02-01'],
    [20260101,'2026-02-01']]) assert.throws(()=>tool.execute({startDate,endDate}));
  assert.equal(calls.length,0);
  for(const pair of [['2026-01-01','2026-10-23'],['2026-02-28','2026-02-28']]) {
    const result=tool.execute({startDate:pair[0],endDate:pair[1]});
    assert.equal(result.startDate,pair[0]);assert.equal(result.endDate,pair[1]);
  }
});

test('interval counts select locale-specific singular and plural forms', () => {
  const context={window:{}};vm.createContext(context);
  for (const file of fs.readdirSync(path.join(__dirname,'../i18n')).filter(name => name.endsWith('.js'))) {
    vm.runInContext(fs.readFileSync(path.join(__dirname,'../i18n',file),'utf8'),context);
  }
  const strings=context.window.DRONE_I18N;
  const count=(lang,n)=>strings[lang]['revamp.recordsInInterval'][new Intl.PluralRules(lang).select(n)].replace('{n}',n);
  assert.equal(count('en',1),'1 record in interval');
  assert.equal(count('en',2),'2 records in interval');
  assert.equal(count('pl',1),'1 wpis w okresie');
  assert.equal(count('pl',2),'2 wpisy w okresie');
  assert.equal(count('pl',5),'5 wpisów w okresie');
  for (const lang of Object.keys(strings)) for(const n of [0,1,2,5,21,100]) assert(count(lang,n));
});
