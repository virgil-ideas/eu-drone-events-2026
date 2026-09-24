'use strict';
(() => {
  const {events, contexts, sources, cutoff} = window.DRONE_DATA;
  const $ = id => document.getElementById(id);
  const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const colors = {flight:'#3278c5', shotdown:'#7b4ab5', engaged:'#7b4ab5', crash:'#d99018', explosion:'#d94343', disposal:'#3a6a72', recovery:'#239284', alert:'#7c8697'};
  const categoryLabels = {flight:'Flight', shotdown:'Shot down', engaged:'Military engagement', crash:'Crash', explosion:'Explosion', disposal:'Controlled disposal', recovery:'Recovery', alert:'Alert / other'};
  // Armed engagement shares the purple family, while each event's own label
  // distinguishes a shoot-down from a surface drone damaged by aircraft fire.
  $('map-legend').innerHTML = Object.entries(categoryLabels).filter(([key]) => key !== 'engaged').map(([key,label]) => `<span><i style="background:${colors[key]}"></i>${key === 'shotdown' ? 'Shot down / armed engagement' : label}</span>`).join('');
  const DAY = 86400000;
  const dateValue = date => Date.parse(date + 'T00:00:00Z');
  const firstTime = dateValue(events[0].startDate);
  const lastTime = dateValue(cutoff);
  const totalDays = Math.round((lastTime - firstTime) / DAY);
  const shortDate = date => new Date(dateValue(date)).toLocaleDateString('en-GB', {day:'numeric',month:'short',timeZone:'UTC'});
  const longDate = date => new Date(dateValue(date)).toLocaleDateString('en-GB', {day:'numeric',month:'long',year:'numeric',timeZone:'UTC'});
  const dayToDate = day => new Date(firstTime + day * DAY).toISOString().slice(0,10);
  const eventDays = [...new Set(events.map(e => Math.round((dateValue(e.startDate) - firstTime) / DAY)))];
  const dateCounts = new Map();
  events.forEach(e => dateCounts.set(e.startDate, (dateCounts.get(e.startDate) || 0) + 1));
  let currentDay = totalDays;
  let allMode = true;
  let playing = false;
  let timer = null;
  let selectedId = null;
  let visibleEvents = events;
  let returnFocus = null;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const map = L.map('map', {zoomControl:false, minZoom:3, maxZoom:16, scrollWheelZoom:true, zoomSnap:.25, worldCopyJump:true});
  L.control.zoom({position:'topright'}).addTo(map);
  L.control.scale({position:'bottomright', imperial:false}).addTo(map);
  let tileFailures = 0;
  const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom:19,
    attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>'
  }).addTo(map);
  tiles.on('tileerror', () => { if (++tileFailures >= 3) $('map-error').hidden = false; });
  tiles.on('tileload', () => { tileFailures = 0; $('map-error').hidden = true; });

  // Keep every record on the map at every zoom. Fixed-size, translucent blobs
  // retain their visible footprint and build up density where events overlap.
  const eventLayer = L.layerGroup().addTo(map);
  const markers = new Map();
  function markerIcon(event, position) {
    return L.divIcon({
      className:`record-marker ${position.precision === 'region' ? 'regional' : ''} ${selectedId === event.id ? 'selected' : ''} ${!allMode && event.startDate === dayToDate(currentDay) ? 'today' : ''}`,
      html:`<span class="marker-point" style="--category:${colors[event.category]}"></span>`,iconSize:[28,28],iconAnchor:[14,14]
    });
  }
  events.forEach(event => {
    markers.set(event.id, event.positions.map(position => {
      const marker = L.marker([position.lat,position.lng], {
        icon:markerIcon(event,position), title:`${event.id} · ${event.title} · ${categoryLabels[event.category]} · ${event.status} · approximate position`,
        alt:`${event.id}, ${event.title}`, recordId:event.id, recordDate:event.startDate,
        keyboard:true, riseOnHover:true
      });
      marker.bindTooltip(`<strong>${escape(event.title)}</strong><small>${escape(event.id)} · ${escape(shortDate(event.startDate))} · ${categoryLabels[event.category]}</small><small>${escape(event.status)}</small><small>Approximate ${position.precision === 'locality' ? 'locality' : position.precision === 'offshore' ? 'offshore area' : 'region'}</small>`, {direction:'top',offset:[0,-10]});
      marker.on('click', () => selectEvent(event.id, false));
      return marker;
    }));
  });

  function fitEvents() {
    const points = visibleEvents.flatMap(e => e.positions.map(p => [p.lat,p.lng]));
    if (points.length) map.fitBounds(points, {paddingTopLeft:[70,85],paddingBottomRight:[70,125],maxZoom:8,animate:!reducedMotion});
  }

  function renderList() {
    let previousMonth = '';
    $('event-list').innerHTML = visibleEvents.map(event => {
      const month = event.startDate.slice(0,7);
      let heading = '';
      if (month !== previousMonth) {
        previousMonth = month;
        const monthName = new Date(dateValue(event.startDate)).toLocaleDateString('en-GB',{month:'long',timeZone:'UTC'});
        heading = `<h3 class="event-month">${escape(monthName.toUpperCase())} 2026</h3>`;
      }
      const dayLabel = event.dateLabel === event.startDate ? shortDate(event.startDate) : `${shortDate(event.startDate)} · date notes`;
      return `${heading}<button class="event-card${!allMode && event.startDate === dayToDate(currentDay) ? ' current' : ''}" id="card-${event.id}" data-id="${event.id}" style="--category:${colors[event.category]}" aria-pressed="${selectedId === event.id}"><span class="event-dot" aria-hidden="true"></span><span class="event-meta"><span>${escape(dayLabel)} · ${escape(event.countries.split(';')[0].replace(/ \(.+\)/,''))}</span><span class="event-id">${event.id}</span></span><span class="event-title">${escape(event.title)}</span><span class="event-type">${escape(event.status)}</span></button>`;
    }).join('');
    $('visible-count').textContent = `${visibleEvents.length} of 84 records`;
    $('list-title').textContent = allMode ? 'All events' : `Through ${shortDate(dayToDate(currentDay))}`;
  }

  function renderMarkers() {
    eventLayer.clearLayers();
    visibleEvents.forEach(event => markers.get(event.id).forEach((marker,index) => {
      marker.setIcon(markerIcon(event,event.positions[index]));
      marker.setZIndexOffset(event.id === selectedId ? 1000 : 0);
      eventLayer.addLayer(marker);
    }));
  }

  function refreshSelection() {
    document.querySelectorAll('.event-card').forEach(card => card.setAttribute('aria-pressed', String(card.dataset.id === selectedId)));
    visibleEvents.forEach(event => markers.get(event.id).forEach((marker,index) => {
      marker.setIcon(markerIcon(event,event.positions[index]));
      marker.setZIndexOffset(event.id === selectedId ? 1000 : 0);
    }));
  }

  function sourceLinks(ids) {
    return ids.map(id => {
      const s = sources[id];
      if (!s || !/^https?:\/\//.test(s.url)) return '';
      return `<a class="source-link" href="${escape(s.url)}" target="_blank" rel="noopener noreferrer"><strong>${escape(id)} · ${escape(s.publisher)} ↗</strong><span>${escape(s.title)}</span><small>${escape(s.audit)}</small></a>`;
    }).join('');
  }
  function fieldsHTML(event, fields) {
    return fields.map(([key,label]) => `<dt>${label}</dt><dd>${escape(event[key])}</dd>`).join('');
  }
  function outcomeTags(event) {
    return `<div class="outcome-tags" aria-label="Reported event stages">${event.stages.map((stage,index) => `<span style="--category:${colors[stage]}"${index === 0 ? ' title="Determines the map color"' : ''}><i aria-hidden="true"></i>${categoryLabels[stage]}${index === 0 ? ' · map color' : ''}</span>`).join('')}</div>${event.classificationNote ? `<p class="classification-note">${escape(event.classificationNote)}</p>` : ''}`;
  }
  function selectEvent(id, focusMap = true) {
    const event = events.find(e => e.id === id);
    if (!event) throw new Error('Unknown event ID');
    pause();
    if (!visibleEvents.some(e => e.id === id)) { allMode = false; currentDay = Math.round((dateValue(event.startDate)-firstTime)/DAY); render(); }
    selectedId = id;
    returnFocus = document.activeElement;
    $('detail').hidden = false;
    const isRegional = event.positions.some(p => p.precision === 'region');
    const geoNote = isRegional ? 'Representative regional anchor; the exact site or track is not established here.' : 'Approximate map anchor for the named locality or offshore area; not a verified incident coordinate.';
    $('detail').innerHTML = `<div class="detail-head" style="--category:${colors[event.category]}"><p class="eyebrow">${event.id} / ${escape(event.countries)}</p><button class="close-detail" aria-label="Close event details">×</button><h2>${escape(event.title)}</h2><div class="detail-status">${escape(event.status)}</div></div><div class="detail-scroll"><p class="detail-date">${escape(event.dateLabel)}</p>${outcomeTags(event)}<p class="position-note">${geoNote}${event.positions.length > 1 ? ' This single record has two regional map anchors.' : ''}${event.id === 'E058' ? ' The Pratkūnai site is not geocoded; the marker represents Lithuania only.' : ''}</p><dl>${fieldsHTML(event,[['dateBasis','Date basis'],['location','Location / jurisdiction'],['categories','Event categories'],['circumstances','What was reported'],['vehicle','Aircraft / vessel / quantity'],['attribution','Origin / operator / attribution'],['impact','Damage / casualties / disruption'],['response','Response / outcome'],['uncertainty','Investigation / uncertainty'],['route','Route / entry mechanism'],['payload','Explosive payload'],['deduplication','Counting / links'],['provenance','Research provenance']])}</dl><h3>Source references · ${event.sources.length}</h3>${sourceLinks(event.sources)}</div>`;
    $('detail').querySelector('.close-detail').addEventListener('click', () => closeDetail(true));
    refreshSelection();
    const card = $(`card-${id}`);
    if (card) $('event-list').scrollTo({top:card.offsetTop - $('event-list').offsetTop - 34,behavior:reducedMotion ? 'auto' : 'smooth'});
    if (focusMap) {
      const position = event.positions[0];
      const zoom = position.precision === 'region' ? 6.5 : 9;
      // Offset the map center so the selected location remains beside the panel.
      const offset = window.innerWidth > 760 ? 195 : 0;
      const center = map.unproject(map.project([position.lat,position.lng],zoom).add([offset,0]),zoom);
      map.setView(center,zoom,{animate:!reducedMotion});
    }
    $('detail').querySelector('.close-detail').focus({preventScroll:true});
    if (window.innerWidth <= 760) $('map').scrollIntoView({behavior:'instant',block:'start'});
    $('announcer').textContent = `${event.id}: ${event.title}. ${event.status}. Event details opened.`;
  }
  function closeDetail(restoreFocus = false) {
    $('detail').hidden = true;
    selectedId = null;
    refreshSelection();
    if (restoreFocus && returnFocus?.isConnected) returnFocus.focus({preventScroll:true});
  }

  function render() {
    const date = dayToDate(currentDay);
    visibleEvents = allMode ? events : events.filter(e => e.startDate <= date);
    if (selectedId && !visibleEvents.some(e => e.id === selectedId)) { selectedId = null; $('detail').hidden = true; }
    renderList();
    renderMarkers();
    $('timeline-range').value = currentDay;
    $('timeline-range').style.setProperty('--progress',`${currentDay / totalDays * 100}%`);
    $('timeline-range').setAttribute('aria-valuetext',`${longDate(date)}, ${visibleEvents.length} records visible`);
    $('current-date').textContent = allMode ? 'All events' : longDate(date);
    $('timeline-status').textContent = allMode ? '84 records · cumulative replay' : `${visibleEvents.length} visible · ${dateCounts.get(date) || 0} on this date`;
    $('map-period').textContent = allMode ? '28 January — 24 September' : `Through ${shortDate(date)} 2026`;
    $('show-all').setAttribute('aria-pressed',String(allMode));
    $('previous').disabled = currentDay <= 0;
    $('next').disabled = currentDay >= totalDays;
    document.querySelectorAll('.histogram-bar').forEach(bar => {
      bar.classList.toggle('future',Number(bar.dataset.day) > currentDay);
      bar.classList.toggle('active',!allMode && Number(bar.dataset.day) === currentDay);
    });
  }

  function updatePlayButton() {
    $('play').setAttribute('aria-label',playing ? 'Pause timeline' : 'Play timeline');
    $('play').setAttribute('aria-pressed',String(playing));
    $('play').innerHTML = playing ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h4v14H6zm8 0h4v14h-4z"/></svg><span>Pause</span>' : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 11 7-11 7Z"/></svg><span>Replay</span>';
  }
  function pause() {
    playing = false;
    clearTimeout(timer);
    timer = null;
    updatePlayButton();
  }
  function scheduleTick() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!playing) return;
      const nextDay = eventDays.find(day => day > currentDay);
      if (nextDay === undefined) { pause(); return; }
      currentDay = nextDay;
      render();
      scrollToCurrent();
      if (currentDay >= totalDays) { pause(); $('announcer').textContent = 'Replay complete. All 84 records are visible.'; }
      else scheduleTick();
    },1800 / Number($('speed').value));
  }
  function scrollToCurrent() {
    const current = $('event-list').querySelector('.event-card.current');
    if (current) $('event-list').scrollTo({top:current.offsetTop - $('event-list').offsetTop - 34,behavior:'auto'});
  }
  function play() {
    closeDetail();
    if (allMode || currentDay >= totalDays) currentDay = 0;
    allMode = false;
    playing = true;
    render();
    fitEventsForReplay();
    scrollToCurrent();
    updatePlayButton();
    scheduleTick();
  }
  function fitEventsForReplay() {
    const allPoints = events.flatMap(e => e.positions.map(p => [p.lat,p.lng]));
    map.fitBounds(allPoints,{paddingTopLeft:[70,85],paddingBottomRight:[70,125],animate:!reducedMotion});
  }
  function setDay(day) {
    if (!Number.isInteger(day) || day < 0 || day > totalDays) throw new Error('Timeline day is outside the register');
    pause();
    currentDay = day;
    allMode = false;
    render();
    scrollToCurrent();
  }
  function showAll() {
    pause();
    closeDetail();
    allMode = true;
    currentDay = totalDays;
    render();
    fitEvents();
    $('event-list').scrollTop = 0;
  }

  $('timeline-range').max = totalDays;
  $('timeline-range').value = totalDays;
  const maxCount = Math.max(...dateCounts.values());
  $('histogram').innerHTML = Array.from({length:totalDays+1},(_,day) => {
    const count = dateCounts.get(dayToDate(day)) || 0;
    return `<span class="histogram-bar" data-day="${day}" style="height:${count ? Math.max(4,count/maxCount*27) : 0}px"></span>`;
  }).join('');
  document.querySelector('.month-labels').innerHTML = Array.from({length:8},(_,i) => {
    const time = Date.UTC(2026,i+1,1);
    const label = new Date(time).toLocaleDateString('en-GB',{month:'short',timeZone:'UTC'}).toUpperCase();
    return `<span style="left:${(time-firstTime)/(lastTime-firstTime)*100}%">${label}</span>`;
  }).join('');
  $('context-records').innerHTML = contexts.map(c => `<details><summary><strong>${c.id}</strong> · ${escape(c.countries)}</summary><p class="context-meta">${escape(c.dateLabel)} · ${escape(c.status)}</p><p>${escape(c.vehicle)}</p><p>${escape(c.attribution)}</p><p>${escape(c.deduplication)}</p><p>${escape(c.uncertainty)}</p>${sourceLinks(c.sources)}</details>`).join('');
  $('play').addEventListener('click',() => playing ? pause() : play());
  $('speed').addEventListener('change',() => { if (playing) scheduleTick(); });
  $('timeline-range').addEventListener('input',event => setDay(Number(event.target.value)));
  $('previous').addEventListener('click',() => setDay([...eventDays].reverse().find(day => day < currentDay) ?? 0));
  $('next').addEventListener('click',() => setDay(eventDays.find(day => day > currentDay) ?? totalDays));
  $('show-all').addEventListener('click',showAll);
  $('fit-map').addEventListener('click',() => { closeDetail(); fitEvents(); });
  $('event-list').addEventListener('click',event => { const card = event.target.closest('[data-id]'); if (card) selectEvent(card.dataset.id); });
  $('about-button').addEventListener('click',() => { pause(); $('about-dialog').showModal(); });
  $('close-about').addEventListener('click',() => $('about-dialog').close());
  $('about-dialog').addEventListener('click',event => { if (event.target === $('about-dialog')) { const r = event.target.getBoundingClientRect(); if (event.clientX<r.left || event.clientX>r.right || event.clientY<r.top || event.clientY>r.bottom) event.target.close(); } });
  document.addEventListener('keydown',event => { if (event.key === 'Escape' && !$('detail').hidden) closeDetail(true); });
  document.addEventListener('visibilitychange',() => { if (document.hidden) pause(); });
  new ResizeObserver(() => map.invalidateSize()).observe($('map'));
  render();
  fitEvents();

  // Progressive enhancement for browsers that expose the page-scoped WebMCP API.
  const context = document.modelContext;
  if (context?.registerTool) {
    const lifecycle = new AbortController();
    const register = tool => {
      try { Promise.resolve(context.registerTool(tool,{signal:lifecycle.signal})).catch(() => {}); } catch { /* Optional browser API. */ }
    };
    register({name:'navigate_drone_event',title:'Open an event',description:'Select a register record, reveal it on the map and open its source-backed details. Pauses replay.',inputSchema:{type:'object',properties:{id:{type:'string',pattern:'^E\\d{3}$'}},required:['id'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:true},execute(input){if (!input || typeof input.id !== 'string' || !events.some(e => e.id === input.id)) throw new Error('Supply a valid event ID from E001 to E084.');selectEvent(input.id);return {selectedId,visibleRecords:visibleEvents.length};}});
    register({name:'set_drone_timeline_date',title:'Set the timeline date',description:'Pause playback and show records through a calendar date in the 2026 register.',inputSchema:{type:'object',properties:{date:{type:'string',format:'date'}},required:['date'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:false},execute(input){if (!input || typeof input.date !== 'string' || !/^2026-\d{2}-\d{2}$/.test(input.date)) throw new Error('Supply a 2026 date in YYYY-MM-DD form.');const day = (dateValue(input.date)-firstTime)/DAY;if (!Number.isInteger(day) || day < 0 || day > totalDays || dayToDate(day) !== input.date) throw new Error('Date must be between 2026-01-28 and 2026-09-24.');setDay(day);return {date:dayToDate(currentDay),visibleRecords:visibleEvents.length};}});
    window.addEventListener('pagehide',() => lifecycle.abort(),{once:true});
  }
})();
