'use strict';
(async () => {
  const {events, contexts, sources, cutoff} = window.DRONE_DATA;
  const pagesData = window.DRONE_PAGES || {};
  const media = window.DRONE_MEDIA || {};
  const sourceMedia = media.sources || {};
  const extraMedia = media.extra || {};
  const $ = id => document.getElementById(id);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  // Interface language. Record fields, source titles and notes stay in the
  // register's original English; everything else goes through t().
  const LANGUAGES = {bg:'Български', cs:'Čeština', da:'Dansk', de:'Deutsch', el:'Ελληνικά', en:'English', es:'Español', et:'Eesti', fi:'Suomi', fr:'Français', ga:'Gaeilge', hr:'Hrvatski', hu:'Magyar', it:'Italiano', lt:'Lietuvių', lv:'Latviešu', mt:'Malti', nl:'Nederlands', pl:'Polski', pt:'Português', ro:'Română', sk:'Slovenčina', sl:'Slovenščina', sv:'Svenska'};
  const LANGUAGE_KEY = 'drone-events-lang';
  const translations = window.DRONE_I18N;
  const COUNTRY_CODES = {Bulgaria:'BG', Estonia:'EE', Finland:'FI', Germany:'DE', Greece:'GR', Latvia:'LV', Lithuania:'LT', Poland:'PL', Romania:'RO', Sweden:'SE'};
  let lang = 'en';
  let locale = 'en-GB';
  let format = {};

  // Black Sea Maritime Escalation ("When Things Took a Dark Turn" — Oct 2026)
  const MARITIME_SHIP_IDS = new Set(['E033', 'E034', 'E053', 'N072', 'N073', 'N079', 'N080', 'N086', 'N089', 'N090', 'N112']);
  const OCT_MARITIME_IDS = new Set(['N072', 'N073', 'N079', 'N080', 'N086', 'N089', 'N090', 'N112']);
  const CASUALTY_IDS = new Set(['E033', 'E053', 'N072', 'N073', 'N079', 'N080', 'N090', 'N112']);
  const DARK_TURN_DATE = '2026-10-05';
  const isMaritimeVessel = event => MARITIME_SHIP_IDS.has(event.id);
  const hasCasualties = event => CASUALTY_IDS.has(event.id);

  function loadLanguage(code) {
    if (translations[code]) return Promise.resolve(true);
    return new Promise(resolve => {
      const script = document.createElement('script');
      script.src = `i18n/${code}.js?v=20261023-revamp`;
      script.onload = () => resolve(Boolean(translations[code]));
      script.onerror = () => { script.remove(); resolve(false); };
      document.head.append(script);
    });
  }

  function configureLanguage(code) {
    lang = code;
    const requested = code === 'en' ? 'en-GB' : code;
    locale = Intl.DateTimeFormat.supportedLocalesOf([requested]).length ? requested : 'en-GB';
    const date = options => new Intl.DateTimeFormat(locale, {timeZone:'UTC', ...options});
    let regions = null;
    try { regions = new Intl.DisplayNames([locale], {type:'region'}); } catch { /* Keep English names. */ }
    format = {
      plural: new Intl.PluralRules(code),
      number: new Intl.NumberFormat(locale),
      percent: new Intl.NumberFormat(locale, {style:'percent', maximumFractionDigits:0}),
      delta: new Intl.NumberFormat(locale, {style:'percent', maximumFractionDigits:0, signDisplay:'exceptZero'}),
      list: new Intl.ListFormat(locale, {style:'narrow', type:'unit'}),
      short: date({day:'numeric', month:'short'}),
      shortYear: date({day:'numeric', month:'short', year:'numeric'}),
      long: date({day:'numeric', month:'long', year:'numeric'}),
      month: date({month:'short'}),
      monthNarrow: date({month:'narrow'}),
      monthLong: date({month:'long'}),
      monthYear: date({month:'long', year:'numeric'}),
      regions
    };
  }

  function t(key, vars = {}) {
    let text = translations[lang]?.[key] ?? translations.en[key] ?? key;
    if (typeof text === 'object') text = text[format.plural.select(vars.n ?? vars.total ?? 0)] ?? text.other;
    return text.replace(/\{(\w+)\}/g, (match, name) => {
      if (!Object.hasOwn(vars, name)) return match;
      return typeof vars[name] === 'number' ? format.number.format(vars[name]) : vars[name];
    });
  }

  const countryName = name => (COUNTRY_CODES[name] && format.regions?.of(COUNTRY_CODES[name])) || name;
  const primaryCountry = event => event.countries.split(';')[0].replace(/ \(.+\)/,'').trim();
  const allCountriesOf = event => event.countries.split(';').map(c => c.replace(/ \(.+\)/,'').trim()).filter(Boolean);

  // Editorial headline, TL;DR description, and summary paragraphs for each event
  function pageCopyFor(event) {
    if (pagesData[event.id]) return pagesData[event.id];
    const place = allCountriesOf(event).join(', ');
    return {
      headline: `${event.title}, ${place}: ${event.status}`,
      description: `${event.circumstances} ${event.impact || ''}`.trim(),
      summary: [event.circumstances, [event.status, event.attribution, event.uncertainty].filter(Boolean).join(' ')].filter(Boolean)
    };
  }

  const colors = {flight:'#3278c5', shotdown:'#7b4ab5', engaged:'#7b4ab5', crash:'#f0700f', strike:'#d3201c', explosion:'#d3201c', disposal:'#3a6a72', recovery:'#e8c400', alert:'#7c8697'};
  const categoryLabel = category => t(`cat.${category}`);
  const recordClassLabel = recordClass => t(`class.${recordClass}`);
  const DAY = 86400000;
  const REPLAY_DAYS_PER_SECOND = 8;
  const dateValue = date => Date.parse(date + 'T00:00:00Z');
  const utcDate = date => new Date(dateValue(date));
  const firstDateStr = cutoff.slice(0, 4) + '-01-01';
  const firstTime = dateValue(firstDateStr);
  const lastTime = dateValue(cutoff);
  const totalDays = Math.round((lastTime - firstTime) / DAY);
  const shortDate = date => format.short.format(utcDate(date));
  const shortDateYear = date => format.shortYear.format(utcDate(date));
  const longDate = date => format.long.format(utcDate(date));
  const dayToDate = day => new Date(firstTime + Math.max(0, Math.min(totalDays, Math.round(day))) * DAY).toISOString().slice(0, 10);
  const dayOf = date => Math.max(0, Math.min(totalDays, Math.round((dateValue(date) - firstTime) / DAY)));

  const eventDays = [...new Set(events.map(e => dayOf(e.startDate)))].sort((a, b) => a - b);
  const dateCounts = new Map();
  events.forEach(e => dateCounts.set(e.startDate, (dateCounts.get(e.startDate) || 0) + 1));

  // State: Time Interval [intervalStartDay, intervalEndDay], Playhead, Filters, Feed Mode
  let intervalStartDay = 0;
  let intervalEndDay = totalDays;
  let currentDay = totalDays;
  let playbackDay = totalDays;
  let allMode = true;
  let playing = false;
  let studioOpen = false;
  let studioReturnFocus = null;
  let feedMode = 'incidents'; // 'incidents' | 'news'
  let searchQuery = '';
  let selectedCountry = '';
  let selectedCategoryGroup = '';
  let animationFrame = null;
  let lastFrameTime = null;
  let renderedRecordKey = '';
  let renderedNewsKey = '';
  let selectedId = null;
  let openAreaId = null;
  let visibleEvents = events;
  let returnFocus = null;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // WebAudio pentatonic + textured metallic bell synthesis (synced with origin/main + recording gain)
  let soundEnabled = true;
  let audioContext = null;
  let audioOutput = null;
  let recordingGain = null;
  let recordingAudioDest = null;
  const categoryNotes = {alert:72, recovery:74, flight:76, disposal:79, engaged:81, shotdown:84, crash:86, strike:76, explosion:76};
  const bellCategories = new Set(['engaged', 'shotdown', 'strike', 'explosion']);
  const bellBuffers = new Map();
  const REPLAY_VOLUME = 0.05;
  const RECORDING_VOLUME = 0.35;
  const BELL_GAIN = 2.6;
  const activeVoices = new Set();

  function prepareAudio() {
    if (!soundEnabled) return;
    try {
      const Audio = window.AudioContext || window.webkitAudioContext;
      if (!Audio) return;
      if (!audioContext) {
        audioContext = new Audio();
        audioOutput = audioContext.createGain();
        audioOutput.gain.value = REPLAY_VOLUME;
        audioOutput.connect(audioContext.destination);
        if (audioContext.createMediaStreamDestination) {
          recordingGain = audioContext.createGain();
          recordingGain.gain.value = RECORDING_VOLUME / REPLAY_VOLUME;
          recordingAudioDest = audioContext.createMediaStreamDestination();
          audioOutput.connect(recordingGain);
          recordingGain.connect(recordingAudioDest);
        }
      }
      return audioContext.resume().catch(() => {});
    } catch { /* Replay still works when audio is unavailable. */ }
  }

  function createBellBuffer(note) {
    if (bellBuffers.has(note)) return bellBuffers.get(note);
    const sampleRate = audioContext.sampleRate;
    const duration = 0.72;
    const length = Math.floor(sampleRate * duration);
    const buffer = audioContext.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);
    const base = 440 * 2 ** ((note - 69) / 12);
    const partials = [[0.5, 0.24, 3.6], [1, 1, 4.8], [1.183, 0.55, 6.2], [1.506, 0.42, 7.6], [2, 0.62, 8.8], [2.514, 0.34, 11], [2.662, 0.26, 13], [3.011, 0.2, 15.5], [4.166, 0.12, 20], [5.433, 0.07, 26]];
    let peak = 0;
    let seed = note * 2654435761 >>> 0;
    for (let i = 0; i < length; i++) {
      const time = i / sampleRate;
      const attack = Math.min(1, time / 0.0025);
      seed = seed * 1664525 + 1013904223 >>> 0;
      const clapper = ((seed / 4294967296) * 2 - 1) * Math.exp(-time * 95) * 0.28;
      let sample = clapper + Math.sin(2 * Math.PI * base * 3.4 * time) * Math.exp(-time * 55) * 0.22;
      for (const [ratio, amp, decay] of partials) {
        const detune = 1 + Math.sin(time * 6.5 * ratio) * 0.0006;
        sample += Math.sin(2 * Math.PI * base * ratio * detune * time) * amp * Math.exp(-time * decay);
      }
      const fadeOut = time > duration - 0.04 ? (duration - time) / 0.04 : 1;
      data[i] = sample * attack * fadeOut;
      peak = Math.max(peak, Math.abs(data[i]));
    }
    if (peak) for (let i = 0; i < length; i++) data[i] = data[i] / peak * 0.9;
    bellBuffers.set(note, buffer);
    return buffer;
  }

  function stopVoices(voices = activeVoices) {
    if (!audioContext) return;
    const now = audioContext.currentTime;
    [...voices].forEach(voice => {
      const {source, envelope} = voice;
      const level = envelope.gain.value;
      if (envelope.gain.cancelAndHoldAtTime) envelope.gain.cancelAndHoldAtTime(now);
      else {
        envelope.gain.cancelScheduledValues(now);
        envelope.gain.setValueAtTime(level, now);
      }
      envelope.gain.linearRampToValueAtTime(0, now + 0.014);
      source.stop(now + 0.018);
      activeVoices.delete(voice);
    });
  }

  function startVoice(source, envelope, stopTime, bell = false) {
    source.connect(envelope).connect(audioOutput);
    const voice = {source, envelope, bell};
    activeVoices.add(voice);
    source.onended = () => { source.disconnect(); envelope.disconnect(); activeVoices.delete(voice); };
    source.start(audioContext.currentTime);
    source.stop(stopTime);
  }

  function playArrivalSound(arrivals) {
    if (!soundEnabled || audioContext?.state !== 'running' || !arrivals.length) return;
    stopVoices([...activeVoices].filter(voice => !voice.bell));
    const now = audioContext.currentTime;
    const counts = new Map();
    arrivals.forEach(event => counts.set(event.category, (counts.get(event.category) || 0) + 1));
    const totalWeight = [...counts.values()].reduce((sum, count) => sum + Math.sqrt(count), 0);
    counts.forEach((count, category) => {
      const level = Math.sqrt(count) / totalWeight;
      if (bellCategories.has(category)) {
        const bell = audioContext.createBufferSource();
        const filter = audioContext.createBiquadFilter();
        const envelope = audioContext.createGain();
        bell.buffer = createBellBuffer(categoryNotes[category]);
        filter.type = 'highshelf';
        filter.frequency.setValueAtTime(1800, now);
        filter.gain.setValueAtTime(3.5, now);
        envelope.gain.setValueAtTime(level * BELL_GAIN, now);
        envelope.gain.exponentialRampToValueAtTime(0.0001, now + bell.buffer.duration);
        bell.connect(filter);
        const voice = {source:bell, envelope, bell:true};
        filter.connect(envelope).connect(audioOutput);
        activeVoices.add(voice);
        bell.onended = () => { bell.disconnect(); filter.disconnect(); envelope.disconnect(); activeVoices.delete(voice); };
        bell.start(now);
        return;
      }
      const tone = audioContext.createOscillator();
      const envelope = audioContext.createGain();
      tone.type = 'sine';
      tone.frequency.setValueAtTime(440 * 2 ** ((categoryNotes[category] - 69) / 12), now);
      envelope.gain.setValueAtTime(0, now);
      envelope.gain.linearRampToValueAtTime(level, now + 0.014);
      envelope.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
      envelope.gain.linearRampToValueAtTime(0, now + 0.24);
      startVoice(tone, envelope, now + 0.24);
    });
  }

  // Recording ripple tracking for video export canvas
  const recentRipples = [];
  function revealEvents(arrivals) {
    if (!arrivals.length) return;
    const nowPerf = performance.now();
    arrivals.forEach(event => {
      event.positions.forEach(pos => {
        recentRipples.push({lat: pos.lat, lng: pos.lng, color: colors[event.category], start: nowPerf, title: event.title, headline: pageCopyFor(event).headline, date: event.startDate, country: primaryCountry(event)});
      });
    });
    if (!reducedMotion) {
      arrivals.forEach(event => markers.get(event.id)?.forEach(marker => {
        const point = marker.getElement()?.querySelector('.marker-point');
        if (!point) return;
        const ripple = document.createElement('span');
        ripple.className = 'marker-ripple';
        ripple.setAttribute('aria-hidden', 'true');
        ripple.addEventListener('animationend', () => ripple.remove(), {once: true});
        point.append(ripple);
      }));
    }
    playArrivalSound(arrivals);
  }

  const startLanguage = Object.hasOwn(LANGUAGES, window.DRONE_LANG) && await loadLanguage(window.DRONE_LANG) ? window.DRONE_LANG : 'en';
  configureLanguage(startLanguage);

  // Initialize Leaflet Map
  const map = L.map('map', {zoomControl:false, minZoom:3, maxZoom:16, scrollWheelZoom:true, zoomSnap:0.25, worldCopyJump:true});
  const zoomControl = L.control.zoom({position:'topright'}).addTo(map);
  L.control.scale({position:'bottomright', imperial:false}).addTo(map);
  let tileFailures = 0;
  const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    crossOrigin: 'anonymous',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>'
  }).addTo(map);
  tiles.on('tileerror', () => { if (++tileFailures >= 3) $('map-error').hidden = false; });
  tiles.on('tileload', () => { tileFailures = 0; $('map-error').hidden = true; });

  const eventLayer = L.layerGroup().addTo(map);
  const markers = new Map();
  function markerIcon(event, position) {
    return L.divIcon({
      className: `record-marker ${position.precision === 'region' ? 'regional' : ''} ${selectedId === event.id ? 'selected' : ''} ${!allMode && event.startDate === dayToDate(currentDay) ? 'today' : ''}`,
      html: `<span class="marker-point" style="--category:${colors[event.category]}"></span>`,
      iconSize: [28, 28],
      iconAnchor: [14, 14]
    });
  }

  events.forEach(event => {
    markers.set(event.id, event.positions.map(position => {
      const marker = L.marker([position.lat, position.lng], {
        icon: markerIcon(event, position),
        alt: `${event.id}, ${event.title}`,
        recordId: event.id,
        recordDate: event.startDate,
        keyboard: true,
        riseOnHover: true
      });
      marker.bindTooltip('', {direction:'top', offset:[0, -10]});
      marker.on('click', () => selectEvent(event.id, false));
      return marker;
    }));
  });

  // Areas of interest (Neptun Deep)
  const AREAS = [{id:'neptun-deep', name:'Neptun Deep', lat:44.044, lng:30.58, text:'area.neptunDeep', match:/Neptun Deep/}];
  map.createPane('areas').style.zIndex = 450;
  const areaSize = () => { const zoom = map.getZoom(); return zoom < 5 ? 58 : zoom < 6 ? 72 : zoom < 7 ? 92 : zoom < 8 ? 116 : 132; };
  const areaMarkers = AREAS.map(area => {
    const marker = L.marker([area.lat, area.lng], {
      pane: 'areas',
      keyboard: true,
      icon: L.divIcon({
        className: 'area-marker',
        iconSize: [0, 0],
        html: `<span class="area-halo" aria-hidden="true"></span><canvas class="area-model" aria-hidden="true"></canvas><span class="area-label">${escape(area.name)}</span>`
      })
    }).addTo(map);
    marker.on('click', () => openArea(area));
    let model = null;
    const entry = {
      area,
      marker,
      resize() {
        const element = marker.getElement();
        if (!element) return;
        element.style.setProperty('--area-size', `${areaSize()}px`);
        element.classList.toggle('compact', map.getZoom() < 6);
        model?.resize(areaSize());
      }
    };
    marker.on('add', () => {
      const element = marker.getElement();
      element.setAttribute('role', 'button');
      element.setAttribute('aria-label', t('area.open', {name: area.name}));
      model?.destroy();
      try { model = window.createPlatformModel?.(element.querySelector('canvas'), {still: reducedMotion}) || null; } catch { model = null; }
      if (!model) element.classList.add('no-model');
      entry.resize();
    });
    return entry;
  });
  map.on('zoomend', () => areaMarkers.forEach(entry => entry.resize()));

  function labelAreas() {
    areaMarkers.forEach(({area, marker}) => marker.getElement()?.setAttribute('aria-label', t('area.open', {name: area.name})));
  }

  function labelMarkers() {
    events.forEach(event => markers.get(event.id).forEach((marker, index) => {
      const position = event.positions[index];
      const copy = pageCopyFor(event);
      const classNote = event.recordClass === 'candidate' ? ` · ${recordClassLabel(event.recordClass)}` : '';
      const title = `${event.id} · ${copy.headline} · ${categoryLabel(event.category)}${classNote}`;
      const precision = position.precision === 'locality' ? 'tooltip.locality' : position.precision === 'offshore' ? 'tooltip.offshore' : 'tooltip.region';
      marker.options.title = title;
      marker.getElement()?.setAttribute('title', title);
      marker.setTooltipContent(
        `<strong lang="en">${escape(copy.headline)}</strong>` +
        `<small>${escape(event.id)} · ${escape(shortDateYear(event.startDate))} · ${escape(categoryLabel(event.category))}${escape(classNote)}</small>` +
        `<small lang="en">${escape(event.status)}</small>` +
        `<small>${escape(t(precision))}</small>`
      );
    }));
  }

  function mapPadding() {
    return innerWidth <= 860
      ? {paddingTopLeft:[24, 50], paddingBottomRight:[24, 90]}
      : {paddingTopLeft:[50, 65], paddingBottomRight:[50, studioOpen ? 230 : 100]};
  }

  function fitEvents() {
    const pool = visibleEvents.length ? visibleEvents : events;
    const points = pool.flatMap(e => e.positions.map(p => [p.lat, p.lng]));
    if (points.length) map.fitBounds(points, {...mapPadding(), maxZoom: 8, animate: !reducedMotion});
  }

  // Media helpers
  const brokenMedia = new Set();
  function mediaFor(event) {
    const cited = event.sources.filter(id => sourceMedia[id] && sources[id]).map(id => ({...sourceMedia[id], url:sources[id].url, publisher:sources[id].publisher}));
    const extra = (extraMedia[event.id] || []).map(item => ({...item, extra:true}));
    const seen = new Set();
    const playable = item => Boolean(playableVideo(item.video));
    const linked = item => Boolean(externalVideo(item.video));
    const still = item => !playable(item) && !linked(item);
    return [...cited.filter(playable), ...extra.filter(playable), ...cited.filter(linked), ...extra.filter(linked), ...cited.filter(still), ...extra.filter(still)].filter(item => {
      const key = item.image || item.url;
      if (!/^https:\/\//.test(item.url || '') || brokenMedia.has(key) || seen.has(key) || !(item.image || playableVideo(item.video))) return false;
      seen.add(key);
      return true;
    });
  }

  function externalVideo(video) {
    return video?.kind === 'youtube' && video.embeddable === false && /^[\w-]{11}$/.test(video.id) ? `https://www.youtube.com/watch?v=${video.id}` : null;
  }

  function playableVideo(video) {
    if (!video || video.embeddable === false) return null;
    if (video.kind === 'youtube' && /^[\w-]{11}$/.test(video.id)) return {src:`https://www.youtube-nocookie.com/embed/${video.id}?autoplay=1&rel=0`, host:'youtube.com'};
    if (video.kind === 'vimeo' && /^\d+$/.test(video.id)) return {src:`https://player.vimeo.com/video/${video.id}?autoplay=1`, host:'vimeo.com'};
    if ((video.kind === 'file' || video.kind === 'embed') && /^https:\/\//.test(video.url || '')) {
      const url = new URL(video.url);
      const width = Number(video.width || url.searchParams.get('width')) || 16;
      const height = Number(video.height || url.searchParams.get('height')) || 9;
      return {src:video.url, host:url.hostname.replace(/^www\./,''), file:video.kind === 'file', aspect:width / height};
    }
    return null;
  }

  const mediaImage = (item, className = '') => item.image ? `<img class="${className}" src="${escape(item.image)}" data-media-src="${escape(item.image)}" alt="${escape(item.alt || '')}" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : '';

  function mediaHTML(items, index) {
    const item = items[index];
    if (!item) return '';
    const video = playableVideo(item.video);
    const external = externalVideo(item.video);
    const playIcon = `<span class="media-play-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m9 6 10 6-10 6Z"/></svg></span>`;
    const stage = video
      ? `<button class="media-stage media-play" type="button" data-media-play="${index}" aria-label="${escape(t('media.playFrom',{publisher:item.publisher}))}">${mediaImage(item)}${playIcon}</button>`
      : `<a class="media-stage${external ? ' media-play media-external' : ''}" href="${escape(external || item.url)}" target="_blank" rel="noopener noreferrer"${external ? ` aria-label="${escape(t('media.playFrom',{publisher:item.publisher}))} ↗"` : ''}>${mediaImage(item)}${external ? playIcon : ''}</a>`;
    const notes = [item.extra ? t('media.extra') : '', video ? t('media.loadsFrom',{host:video.host}) : ''].filter(Boolean);
    const isVideo = Boolean(video || external);
    const thumbs = items.length > 1 ? `<div class="media-thumbs">${items.map((thumb,i) => `<button class="media-thumb" type="button" data-media-index="${i}" aria-pressed="${i === index}" aria-label="${escape(t('media.show',{n:i + 1,total:items.length}))}">${mediaImage(thumb)}${playableVideo(thumb.video) || externalVideo(thumb.video) ? '<span class="media-thumb-play" aria-hidden="true"></span>' : ''}</button>`).join('')}</div>` : '';
    return `<figure class="media">${stage}<figcaption><span class="media-credit">${escape(t(isVideo ? 'media.video' : 'media.image',{publisher:item.publisher}))}</span><a href="${escape(item.url)}" target="_blank" rel="noopener noreferrer">${escape(t('media.openReport'))} ↗</a>${notes.map(note => `<small>${escape(note)}</small>`).join('')}</figcaption></figure>${thumbs}`;
  }

  function renderMedia(event, index = 0) {
    const container = $('detail').querySelector('.detail-media');
    if (!container) return;
    const items = mediaFor(event);
    const current = Math.min(index, Math.max(0, items.length - 1));
    container.innerHTML = mediaHTML(items, current);
    container.hidden = !items.length;
    container.querySelectorAll('img[data-media-src]').forEach(image => image.addEventListener('error', () => {
      brokenMedia.add(image.dataset.mediaSrc);
      if (container.querySelector('.media-player')) image.closest('.media-thumb')?.remove();
      else renderMedia(event, current);
    }, {once:true}));
    container.querySelectorAll('[data-media-index]').forEach(button => button.addEventListener('click', () => renderMedia(event, Number(button.dataset.mediaIndex))));
    container.querySelector('[data-media-play]')?.addEventListener('click', click => {
      const item = items[current];
      const video = playableVideo(item.video);
      const player = document.createElement(video.file ? 'video' : 'iframe');
      if (video.file) Object.assign(player, {controls:true, autoplay:true, playsInline:true, poster:item.image || ''});
      else {
        player.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
        player.allowFullscreen = true;
        player.referrerPolicy = 'strict-origin-when-cross-origin';
        player.title = t('media.video', {publisher:item.publisher});
      }
      player.src = video.src;
      player.className = 'media-stage media-player';
      const figure = click.currentTarget.closest('.media');
      if (!video.file && video.aspect < 1) {
        player.style.aspectRatio = String(video.aspect);
        figure.classList.add('portrait');
      }
      click.currentTarget.replaceWith(player);
      player.focus?.({preventScroll:true});
    });
  }

  // Filtering logic (Time interval + Search query + Country + Outcome category / Maritime group)
  function matchesCategoryGroup(event, group) {
    if (!group) return true;
    if (group === 'maritime') return isMaritimeVessel(event);
    const category = event.category;
    if (group === 'strike_explosion') return category === 'strike' || category === 'explosion';
    if (group === 'shotdown_engaged') return category === 'shotdown' || category === 'engaged';
    return category === group;
  }

  function matchesSearch(event, query) {
    if (!query) return true;
    const q = query.toLowerCase();
    const copy = pageCopyFor(event);
    if (
      event.id.toLowerCase().includes(q) ||
      event.title.toLowerCase().includes(q) ||
      event.countries.toLowerCase().includes(q) ||
      event.location.toLowerCase().includes(q) ||
      event.status.toLowerCase().includes(q) ||
      event.circumstances.toLowerCase().includes(q) ||
      (event.attribution || '').toLowerCase().includes(q) ||
      (event.vehicle || '').toLowerCase().includes(q) ||
      copy.headline.toLowerCase().includes(q) ||
      copy.description.toLowerCase().includes(q)
    ) return true;
    return event.sources.some(srcId => {
      const s = sources[srcId];
      return s && (
        s.publisher.toLowerCase().includes(q) ||
        s.title.toLowerCase().includes(q) ||
        (s.audit || '').toLowerCase().includes(q)
      );
    });
  }

  function computeVisibleEvents() {
    const startDate = dayToDate(intervalStartDay);
    const endCapDate = allMode ? dayToDate(intervalEndDay) : dayToDate(Math.min(intervalEndDay, currentDay));
    return events.filter(event => {
      if (event.startDate < startDate || event.startDate > endCapDate) return false;
      if (selectedCountry && !allCountriesOf(event).includes(selectedCountry)) return false;
      if (selectedCategoryGroup && !matchesCategoryGroup(event, selectedCategoryGroup)) return false;
      if (searchQuery && !matchesSearch(event, searchQuery)) return false;
      return true;
    });
  }

  // Populate Country & Category filter dropdowns
  function populateFilterDropdowns() {
    const countryTotals = new Map();
    events.forEach(event => {
      allCountriesOf(event).forEach(c => countryTotals.set(c, (countryTotals.get(c) || 0) + 1));
    });
    const sortedCountries = [...countryTotals.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const countrySelect = $('country-filter');
    const prevCountry = countrySelect.value;
    countrySelect.innerHTML = `<option value="">${escape(t('revamp.allCountries', {n: events.length}))}</option>` +
      sortedCountries.map(([c, count]) => `<option value="${escape(c)}">${escape(countryName(c))} (${format.number.format(count)})</option>`).join('');
    countrySelect.value = prevCountry;

    const categoryGroups = [
      ['maritime', t('revamp.filterMaritime', {n: MARITIME_SHIP_IDS.size})],
      ['strike_explosion', t('legend.strikeExplosion')],
      ['shotdown_engaged', t('legend.shotdownEngaged')],
      ['crash', categoryLabel('crash')],
      ['flight', categoryLabel('flight')],
      ['disposal', categoryLabel('disposal')],
      ['recovery', categoryLabel('recovery')],
      ['alert', categoryLabel('alert')]
    ];
    const catSelect = $('category-filter');
    const prevCat = catSelect.value;
    catSelect.innerHTML = `<option value="">${escape(t('revamp.allOutcomes', {n: events.length}))}</option>` +
      categoryGroups.map(([val, label]) => `<option value="${val}">${escape(label)}</option>`).join('');
    catSelect.value = prevCat;
  }

  // Render Rich Incident Cards with Headlines, Visible TL;DRs & Clickable News Chips
  function renderList() {
    // Note: currentDay is intentionally omitted from filterKey so same-day playback frames do not rebuild DOM
    const filterKey = [
      visibleEvents.map(e => e.id).join(','),
      lang
    ].join('|');

    if (renderedRecordKey !== filterKey) {
      if (!visibleEvents.length) {
        $('event-list').innerHTML = `<div class="empty-feed-state">${escape(t('revamp.emptyIncidents'))}</div>`;
      } else {
        let previousMonth = '';
        $('event-list').innerHTML = [...visibleEvents].reverse().map((event, idx) => {
          const month = event.startDate.slice(0, 7);
          let heading = '';
          if (month !== previousMonth) {
            previousMonth = month;
            heading = `<h2 class="event-month">${escape(format.monthYear.format(utcDate(event.startDate)).toLocaleUpperCase(locale))}</h2>`;
          }
          const copy = pageCopyFor(event);
          const dayLabel = shortDate(event.startDate);
          const countryLabel = allCountriesOf(event).map(countryName).join(', ');
          const items = mediaFor(event);
          const hasVideo = items.some(item => playableVideo(item.video) || externalVideo(item.video));
          const badge = items.length ? `<span class="media-badge${hasVideo ? ' video' : ''}" title="${escape(t(hasVideo ? 'card.video' : 'card.photo'))}"><span class="sr-only">${escape(t(hasVideo ? 'card.video' : 'card.photo'))}</span></span>` : '';

          const candidatePill = event.recordClass === 'candidate'
            ? `<span class="candidate-pill">${escape(recordClassLabel(event.recordClass))}</span>`
            : '';
          const maritimePill = isMaritimeVessel(event)
            ? `<span class="maritime-badge">${escape(t('revamp.maritimeBadge'))}</span>`
            : '';
          const casualtyPill = hasCasualties(event)
            ? `<span class="casualty-badge">${escape(t('revamp.casualtyBadge'))}</span>`
            : '';

          // Cited news source chips directly on the card (compact publisher names)
          const sourceChips = event.sources.slice(0, 2).map(srcId => {
            const s = sources[srcId];
            if (!s || !/^https?:\/\//.test(s.url)) return '';
            const shortPub = s.publisher.split('/')[0].replace(/\s+via\s+.+/i, '').trim();
            return `<a class="source-chip" href="${escape(s.url)}" target="_blank" rel="noopener noreferrer" title="${escape(s.publisher + ': ' + s.title)}">📰 ${escape(shortPub)} ↗</a>`;
          }).filter(Boolean).join('');
          const extraSourcesCount = event.sources.length > 2 ? `<span class="source-more-chip">+${event.sources.length - 2}</span>` : '';
          const shortPlace = event.normalizedLocality || event.title.split(/[·;,(]/)[0].trim();

          // Apply content-visibility: auto only to below-the-fold cards (idx >= 8)
          const deferredClass = idx >= 8 ? ' deferred-card' : '';
          const isCurrent = !allMode && event.startDate === dayToDate(currentDay);
          const isSelected = selectedId === event.id;

          return `${heading}<article class="event-card${isCurrent ? ' current' : ''}${isSelected ? ' selected' : ''}${deferredClass}" id="card-${event.id}" data-id="${event.id}" data-date="${event.startDate}" style="--category:${colors[event.category]}">
            <button type="button" class="card-select-btn" data-select-id="${event.id}" aria-pressed="${isSelected}">
              <div class="card-top-row">
                <div class="card-badges">
                  <span class="cat-pill"><i aria-hidden="true"></i>${escape(categoryLabel(event.category))}</span>
                  ${maritimePill}${casualtyPill}${candidatePill}
                  <span class="card-date-place">${escape(dayLabel)} · ${escape(countryLabel)}${shortPlace ? ` · ${escape(shortPlace)}` : ''}</span>
                </div>
                <span class="card-id-group">${badge}${escape(event.id)}</span>
              </div>
              <h3 class="event-headline" lang="en">${escape(copy.headline)}</h3>
              <p class="card-tldr" lang="en"><span class="card-tldr-label">${escape(t('revamp.tldrBadge'))}</span>${escape(copy.description)}</p>
            </button>
            <div class="card-sources-row">
              <span class="card-sources-label">${escape(t('revamp.newsLabel', {n: event.sources.length}))}</span>
              ${sourceChips}${extraSourcesCount}
              <button type="button" class="card-open-briefing" data-select-id="${event.id}">${escape(t('revamp.briefingCta'))}</button>
            </div>
          </article>`;
        }).join('');
      }
      renderedRecordKey = filterKey;
    }

    $('visible-count').textContent = format.number.format(visibleEvents.length);
    $('mob-feed-count').textContent = format.number.format(visibleEvents.length);
  }

  // Render Dedicated News Articles & Sources Stream
  function renderNewsList() {
    // Collect unique cited sources across visibleEvents, ordered by most recent linked event
    const sourceEntries = [];
    const seenSources = new Map();
    [...visibleEvents].reverse().forEach(event => {
      event.sources.forEach(srcId => {
        const s = sources[srcId];
        if (!s || !/^https?:\/\//.test(s.url)) return;
        if (!seenSources.has(srcId)) {
          const entry = {source: s, events: [event], latestDate: event.startDate};
          seenSources.set(srcId, entry);
          sourceEntries.push(entry);
        } else {
          const entry = seenSources.get(srcId);
          if (!entry.events.some(e => e.id === event.id)) entry.events.push(event);
        }
      });
    });

    const formattedNewsCount = format.number.format(sourceEntries.length);
    $('news-count').textContent = formattedNewsCount;
    $('mob-news-count').textContent = formattedNewsCount;

    // Skip rebuilding hidden news cards until the News tab is active
    if (feedMode !== 'news') return;

    const newsKey = visibleEvents.map(e => e.id).join(',') + '|' + searchQuery + '|' + lang;
    if (renderedNewsKey === newsKey) return;
    renderedNewsKey = newsKey;

    if (!sourceEntries.length) {
      $('news-list').innerHTML = `<div class="empty-feed-state">${escape(t('revamp.emptyNews'))}</div>`;
      return;
    }

    $('news-list').innerHTML = sourceEntries.map(({source, events: linkedEvents}, idx) => {
      const auditText = (source.audit || '').replace(/\[([^\]]+)\]\[[^\]]+\]/g, '$1');
      const deferredClass = idx >= 8 ? ' deferred-card' : '';
      const eventPills = linkedEvents.map(ev => {
        const copy = pageCopyFor(ev);
        return `<button type="button" class="news-event-btn" data-jump-event="${ev.id}" style="--category:${colors[ev.category]}" title="${escape(copy.headline)}">
          <i aria-hidden="true"></i>
          <span>${escape(ev.id)} · ${escape(shortDate(ev.startDate))} · ${escape(ev.title)}</span>
        </button>`;
      }).join('');

      return `<article class="news-card${deferredClass}" lang="en">
        <div class="news-card-head">
          <span class="news-publisher">📰 ${escape(source.publisher)}</span>
          <span class="news-date">${escape(source.dateLabel || shortDateYear(linkedEvents[0].startDate))} · ${escape(source.id)}</span>
        </div>
        <a class="news-title-link" href="${escape(source.url)}" target="_blank" rel="noopener noreferrer">${escape(source.title)} ↗</a>
        ${auditText ? `<p class="news-audit-tldr"><span class="card-tldr-label">${escape(t('revamp.auditBadge'))}</span>${escape(auditText)}</p>` : ''}
        <div class="news-linked-events">
          <span class="card-sources-label">${escape(t('revamp.mappedIncident'))}</span>
          ${eventPills}
        </div>
      </article>`;
    }).join('');
  }

  function renderMarkers() {
    const visibleIds = new Set(visibleEvents.map(event => event.id));
    const arrivals = new Set();
    events.forEach(event => markers.get(event.id).forEach(marker => {
      if (visibleIds.has(event.id)) {
        if (!eventLayer.hasLayer(marker)) {
          eventLayer.addLayer(marker);
          arrivals.add(event);
        }
      } else if (eventLayer.hasLayer(marker)) {
        eventLayer.removeLayer(marker);
      }
    }));
    refreshSelection();
    if (playing) revealEvents([...arrivals]);
  }

  function refreshSelection() {
    const activeDate = dayToDate(currentDay);
    document.querySelectorAll('.event-card').forEach(card => {
      const isSelected = card.dataset.id === selectedId;
      const isCurrent = !allMode && card.dataset.date === activeDate;
      card.classList.toggle('selected', isSelected);
      card.classList.toggle('current', isCurrent);
      card.querySelector('.card-select-btn')?.setAttribute('aria-pressed', String(isSelected));
    });
    visibleEvents.forEach(event => markers.get(event.id).forEach(marker => {
      const element = marker.getElement();
      element?.classList.toggle('selected', event.id === selectedId);
      element?.classList.toggle('today', !allMode && event.startDate === activeDate);
      marker.setZIndexOffset(event.id === selectedId ? 1000 : 0);
    }));
  }

  function sourceLinks(ids) {
    return ids.map(id => {
      const s = sources[id];
      if (!s || !/^https?:\/\//.test(s.url)) return '';
      const cleanAudit = (s.audit || '').replace(/\[([^\]]+)\]\[[^\]]+\]/g, '$1');
      return `<a class="source-link" href="${escape(s.url)}" target="_blank" rel="noopener noreferrer" lang="en">
        <strong><span>📰 ${escape(s.publisher)} (${escape(id)})</span><span>${escape(t('revamp.openArticle'))}</span></strong>
        <span>${escape(s.title)}</span>
        <small><strong>${escape(t('revamp.sourceAuditLabel'))}</strong> ${s.dateLabel ? escape(s.dateLabel) + ' — ' : ''}${escape(cleanAudit)}</small>
      </a>`;
    }).join('');
  }

  const DETAIL_FIELDS = ['dateLabel','recordType','endDate','dateBasis','location','categories','circumstances','vehicle','attribution','impact','response','uncertainty','route','payload','deduplication','provenance'];
  function fieldsHTML(event) {
    return DETAIL_FIELDS.filter(key => event[key]).map(key => `<dt>${escape(t(`field.${key}`))}</dt><dd lang="en">${escape(event[key])}</dd>`).join('');
  }

  function outcomeTags(event) {
    return `<div class="outcome-tags" aria-label="${escape(t('detail.stagesAria'))}">${event.stages.map((stage, index) => `<span style="--category:${colors[stage]}"${index === 0 ? ` title="${escape(t('detail.mapColorTitle'))}"` : ''}><i aria-hidden="true"></i>${escape(categoryLabel(stage))}${index === 0 ? ` · ${escape(t('detail.mapColor'))}` : ''}</span>`).join('')}</div>${event.classificationNote ? `<p class="classification-note" lang="en">${escape(event.classificationNote)}</p>` : ''}`;
  }

  // Redesigned Incident Briefing Panel: TL;DR Executive Summary & News Brought Forth!
  function renderDetail(event) {
    const copy = pageCopyFor(event);
    const isRegional = event.positions.some(p => p.precision === 'region');
    const geoNote = [t(isRegional ? 'detail.geoRegion' : 'detail.geoLocal'), event.positions.length > 1 ? t('detail.geoTwoAnchors') : '', event.id === 'E058' ? t('detail.geoE058') : ''].filter(Boolean).join(' ');
    const summaryParagraphs = copy.summary.map(p => `<p lang="en">${escape(p)}</p>`).join('');
    const candidateBadge = event.recordClass === 'candidate'
      ? `<span class="candidate-pill">${escape(recordClassLabel(event.recordClass))}</span>`
      : '';
    const maritimeBadge = isMaritimeVessel(event)
      ? `<span class="maritime-badge">${escape(t('revamp.maritimeBadge'))}</span>`
      : '';
    const casualtyBadge = hasCasualties(event)
      ? `<span class="casualty-badge">${escape(t('revamp.casualtyBadge'))}</span>`
      : '';

    $('detail').innerHTML = `
      <div class="detail-head" style="--category:${colors[event.category]}">
        <p class="eyebrow">
          <span class="cat-pill" style="--category:${colors[event.category]}"><i aria-hidden="true"></i>${escape(categoryLabel(event.category))}</span>
          ${maritimeBadge}${casualtyBadge}${candidateBadge}
          <span>${escape(event.id)} · ${escape(shortDateYear(event.startDate))} · <span lang="en">${escape(event.countries)}</span></span>
        </p>
        <button class="close-detail" type="button" aria-label="${escape(t('detail.close'))}">×</button>
        <h2 lang="en">${escape(copy.headline)}</h2>
        <div class="detail-head-actions">
          <div class="detail-status" lang="en">${escape(event.status)}</div>
          ${event.page ? `<a class="detail-page" href="${escape(event.page)}">${escape(t('detail.page'))} →</a>` : ''}
        </div>
      </div>
      <div class="detail-scroll">
        ${lang !== 'en' ? `<p class="language-note">${escape(t('detail.originalLanguage'))}</p>` : ''}

        <!-- 1. Prominent Executive TL;DR Summary -->
        <section class="tldr-briefing-box" aria-label="${escape(t('revamp.detailTldrAria'))}">
          <div class="tldr-briefing-head">
            <span class="tldr-badge">${escape(t('revamp.detailTldrBadge'))}</span>
            <span style="font-size:0.72rem;color:var(--muted)" lang="en">${escape(event.title)}</span>
          </div>
          <div class="tldr-paragraphs">${summaryParagraphs}</div>
        </section>

        <!-- 2. Structured 2x2 Key Facts At-A-Glance -->
        <section class="key-facts-grid" aria-label="${escape(t('revamp.detailFactsAria'))}">
          <div class="key-fact-card">
            <strong>${escape(t('revamp.factHappened'))}</strong>
            <span lang="en">${escape(event.circumstances)}</span>
          </div>
          <div class="key-fact-card">
            <strong>${escape(t('revamp.factVehicle'))}</strong>
            <span lang="en">${escape(event.vehicle)}${event.payload && event.payload !== 'Not reported' ? ` · ${escape(event.payload)}` : ''}</span>
          </div>
          <div class="key-fact-card">
            <strong>${escape(t('revamp.factImpact'))}</strong>
            <span lang="en">${escape(event.impact || t('revamp.noneReported'))}</span>
          </div>
          <div class="key-fact-card">
            <strong>${escape(t('revamp.factResponse'))}</strong>
            <span lang="en">${escape(event.response || t('revamp.notSpecified'))}</span>
          </div>
        </section>

        <!-- 3. Attribution & Uncertainty Shown Up Front (Never Footnoted) -->
        <section class="uncertainty-callout" aria-label="${escape(t('revamp.detailAttributionAria'))}">
          <strong>${escape(t('revamp.detailAttributionTitle'))}</strong>
          <div lang="en"><strong>${escape(t('revamp.reportedAttribution'))}</strong> ${escape(event.attribution || t('revamp.unresolved'))}</div>
          ${event.uncertainty ? `<div style="margin-top:4px" lang="en"><strong>${escape(t('revamp.caveats'))}</strong> ${escape(event.uncertainty)}</div>` : ''}
        </section>

        <!-- 4. Media & Cited News Articles -->
        <div class="detail-media"></div>
        <section class="detail-sources">
          <h3>📰 ${escape(t('detail.sources', {n: event.sources.length}))}</h3>
          ${sourceLinks(event.sources)}
        </section>

        <!-- 5. Native <details> Disclosure for Full Register Audit Fields (Searchable via Find-in-Page) -->
        <section class="detail-record">
          ${outcomeTags(event)}
          <details class="raw-record-details">
            <summary>${escape(t('detail.record'))} · ${escape(t('revamp.positioningNotes'))} (${escape(event.id)})</summary>
            <p class="position-note">${escape(geoNote)}${event.positionNote ? ` <span lang="en">${escape(event.positionNote)}</span>` : ''}</p>
            <dl>${fieldsHTML(event)}</dl>
          </details>
        </section>
      </div>`;

    $('detail').querySelector('.close-detail').addEventListener('click', () => closeDetail(true));
    renderMedia(event);
  }

  const slugOf = event => event.page?.split('/')[1] || '';
  function setRecordHash(event) { setHash(event ? slugOf(event) : ''); }
  function setHash(slug) {
    const hash = slug ? `#${slug}` : '';
    if (location.hash !== hash) history.replaceState(history.state, '', `${location.pathname}${location.search}${hash}`);
  }
  const areaFromHash = () => AREAS.find(area => area.id === location.hash.slice(1));
  function eventFromHash() {
    let slug = '';
    try {
      slug = decodeURIComponent(location.hash.slice(1));
    } catch {
      slug = location.hash.slice(1);
    }
    return slug ? events.find(event => slugOf(event) === slug) : null;
  }

  function syncMobileTabs() {
    const workspace = document.querySelector('.workspace');
    const view = workspace.dataset.mobileView || 'feed';
    const isIncidents = view === 'feed' && feedMode === 'incidents';
    const isNews = view === 'feed' && feedMode === 'news';
    const isMap = view === 'map';
    $('mob-tab-feed').classList.toggle('active', isIncidents);
    $('mob-tab-feed').setAttribute('aria-selected', String(isIncidents));
    $('mob-tab-news').classList.toggle('active', isNews);
    $('mob-tab-news').setAttribute('aria-selected', String(isNews));
    $('mob-tab-map').classList.toggle('active', isMap);
    $('mob-tab-map').setAttribute('aria-selected', String(isMap));
  }

  let mobileMapFitted = window.innerWidth > 860;

  function setMobileView(view, targetFeedMode) {
    const workspace = document.querySelector('.workspace');
    workspace.dataset.mobileView = view;
    if (targetFeedMode) setFeedMode(targetFeedMode);
    syncMobileTabs();
    if (view === 'map') {
      map.invalidateSize({animate: false});
      if (!mobileMapFitted) {
        mobileMapFitted = true;
        if (!selectedId && !openAreaId) fitEvents();
      }
      requestAnimationFrame(() => {
        map.invalidateSize({animate: false});
      });
    }
  }

  function selectEvent(id, focusMap = true) {
    const event = events.find(e => e.id === id);
    if (!event) return;
    pause();
    // Ensure event is within visible interval/filters if user explicitly selected it
    if (!visibleEvents.some(e => e.id === id)) {
      const evDay = dayOf(event.startDate);
      if (evDay < intervalStartDay) intervalStartDay = evDay;
      if (evDay > intervalEndDay) intervalEndDay = evDay;
      if (!allMode && currentDay < evDay) currentDay = playbackDay = evDay;
      selectedCountry = '';
      selectedCategoryGroup = '';
      searchQuery = '';
      $('country-filter').value = '';
      $('category-filter').value = '';
      $('feed-search').value = '';
      $('clear-search').hidden = true;
      syncIntervalInputs();
      render();
    }
    selectedId = id;
    openAreaId = null;
    setRecordHash(event);
    returnFocus = document.activeElement;
    if (window.innerWidth <= 860) setMobileView('map');
    $('detail').hidden = false;
    renderDetail(event);
    refreshSelection();
    const card = $(`card-${id}`);
    if (card) scrollListTo(card, reducedMotion ? 'auto' : 'smooth');
    if (focusMap) {
      const position = event.positions[0];
      focusBesidePanel([position.lat, position.lng], position.precision === 'region' ? 6.5 : 9);
    }
    $('detail').querySelector('.close-detail').focus({preventScroll:true});
    $('announcer').textContent = t('detail.opened', {id:event.id, title:pageCopyFor(event).headline, status:event.status});
  }

  function focusBesidePanel(point, zoom) {
    const offset = window.innerWidth > 860 ? 215 : 0;
    map.setView(map.unproject(map.project(point, zoom).add([offset, 0]), zoom), zoom, {animate: !reducedMotion});
  }

  function openArea(area, focusMap = true) {
    pause();
    selectedId = null;
    refreshSelection();
    returnFocus = document.activeElement;
    if (window.innerWidth <= 860) setMobileView('map');
    $('detail').hidden = false;
    renderArea(area);
    setHash(area.id);
    if (focusMap) focusBesidePanel([area.lat, area.lng], 7);
    $('detail').querySelector('.close-detail').focus({preventScroll:true});
    $('announcer').textContent = `${t('area.eyebrow')}: ${area.name}`;
  }

  function renderArea(area) {
    openAreaId = area.id;
    const records = events.filter(event => area.match.test(event.location));
    const where = location => { const [first, ...rest] = location.split(';'); return `<strong>${escape(first)}</strong>${rest.length ? escape(';' + rest.join(';')) : ''}`; };
    $('detail').innerHTML = `<div class="detail-head area-head"><p class="eyebrow">${escape(t('area.eyebrow'))}</p><button class="close-detail" type="button" aria-label="${escape(t('detail.close'))}">×</button><h2>${escape(area.name)}</h2><p class="area-intro" style="margin-top:6px">${escape(t(area.text))}</p></div><div class="detail-scroll"><h3 class="area-records-title">${escape(t('area.records',{n:records.length}))}</h3>${records.map(event => `<button class="area-record" type="button" data-id="${event.id}" style="--category:${colors[event.category]}"><div class="card-top-row"><span class="card-date-place">${escape(shortDateYear(event.startDate))} · ${escape(categoryLabel(event.category))}</span><span class="card-id-group">${event.id}</span></div><div class="event-headline" lang="en" style="margin:4px 0">${escape(pageCopyFor(event).headline)}</div><span class="area-where" lang="en">${where(event.location)}</span></button>`).join('')}<p class="position-note">${escape(t('area.note'))}</p></div>`;
    $('detail').querySelector('.close-detail').addEventListener('click', () => closeDetail(true));
    $('detail').querySelectorAll('.area-record').forEach(button => button.addEventListener('click', () => selectEvent(button.dataset.id)));
  }

  function closeDetail(restoreFocus = false) {
    $('detail').hidden = true;
    $('detail').replaceChildren();
    selectedId = null;
    openAreaId = null;
    setRecordHash(null);
    refreshSelection();
    if (restoreFocus && returnFocus?.isConnected) returnFocus.focus({preventScroll:true});
  }

  function scrollListTo(card, behavior) {
    const scroller = $('event-list');
    const top = card.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - 36;
    scroller.scrollTo({top, behavior});
  }

  // Monthly bars & rolling 90-day trend comparison
  const year = Number(cutoff.slice(0, 4));
  const months = Array.from({length: Number(cutoff.slice(5, 7))}, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
  const monthTotals = months.map(month => events.filter(event => event.startDate.startsWith(month)).length);
  const maxMonthTotal = Math.max(1, ...monthTotals);
  const comparison = window.DRONE_TREND.rollingComparison(events, cutoff);
  const {recentTotal, previousTotal, change, hasComparison} = comparison;
  const trendGroup = date => window.DRONE_TREND.windowForDate(date, comparison);
  const trendGroups = ['earlier', 'previous', 'recent'];
  const monthStart = index => new Date(Date.UTC(year, index, 1));
  const monthEnd = index => new Date(Date.UTC(year, index + 1, 0));
  const formatRange = (from, to) => format.short.formatRange ? format.short.formatRange(from, to) : `${format.short.format(from)} – ${format.short.format(to)}`;

  function renderTrend() {
    document.querySelector('.trend-figure').hidden = !hasComparison;
    $('trend-compare').hidden = !hasComparison;
    const formattedDelta = change === null ? '—' : format.delta.format(change);
    $('trend-delta').textContent = formattedDelta;
    $('trend-delta').classList.toggle('up', change > 0);
    $('trend-delta').classList.toggle('down', change < 0);
    $('trend-pill-delta').textContent = `${change > 0 ? '▲ ' : change < 0 ? '▼ ' : ''}${formattedDelta}`;
    $('mobile-trend-delta').textContent = `${change > 0 ? '▲' : change < 0 ? '▼' : ''}${formattedDelta}`;

    // Render miniature monthly spark-bars in the topbar pill
    $('mini-spark').innerHTML = monthTotals.map((total, i) => {
      const m = months[i];
      const isRecent = events.some(e => e.startDate.startsWith(m) && trendGroup(e.startDate) === 'recent');
      const h = Math.max(2, Math.round((total / maxMonthTotal) * 14));
      return `<i class="${isRecent ? 'recent' : ''}" style="height:${h}px"></i>`;
    }).join('');

    $('trend-compare').textContent = t('trend.compare', {
      recent: recentTotal,
      previous: previousTotal,
      recentRange: formatRange(utcDate(comparison.recentStart), utcDate(comparison.recentEnd)),
      previousRange: formatRange(utcDate(comparison.previousStart), utcDate(comparison.previousEnd))
    });
    $('trend-share').textContent = t('trend.share', {share: format.percent.format(recentTotal / events.length)});
    const partialMonth = cutoff !== monthEnd(months.length - 1).toISOString().slice(0, 10);
    const monthLabel = index => format.monthLong.format(monthStart(index));
    const partialNote = t('trend.partialNote', {month: monthLabel(months.length - 1), date: shortDate(cutoff)});
    $('trend-partial').hidden = !partialMonth;
    $('trend-partial').textContent = `* ${partialNote}`;
    const shortMonths = months.map((_, i) => format.month.format(monthStart(i)).replace(/\.$/, ''));
    const columnMonths = shortMonths.some(name => name.length > 4) ? months.map((_, i) => format.monthNarrow.format(monthStart(i))) : shortMonths;
    $('trend-chart').style.setProperty('--months', months.length);
    $('trend-chart').setAttribute('aria-label', t('trend.chartLabel', {list: format.list.format(months.map((_, i) => `${monthLabel(i)} ${format.number.format(monthTotals[i])}`))}) + (partialMonth ? `. ${partialNote}` : ''));
    $('trend-chart').innerHTML = `<div class="trend-columns" aria-hidden="true">${months.map((month, i) => {
      const partial = partialMonth && i === months.length - 1;
      const title = t('trend.column', {month: monthLabel(i), n: monthTotals[i]}) + (partial ? ` (${t('trend.partial', {date: shortDate(cutoff)})})` : '');
      const recent = events.some(event => event.startDate.startsWith(month) && trendGroup(event.startDate) === 'recent');
      return `<div class="trend-column${recent ? ' recent' : ''}${partial ? ' partial' : ''}" title="${escape(title)}"><span class="trend-value">${format.number.format(monthTotals[i])}</span><span class="trend-bar" style="--h:${monthTotals[i] / maxMonthTotal}">${trendGroups.map(group => `<span class="trend-fill ${group}" data-month="${month}" data-window="${group}"></span>`).join('')}</span><span class="trend-month">${escape(columnMonths[i])}${partial ? '*' : ''}</span></div>`;
    }).join('')}</div><div class="trend-window-key" aria-hidden="true"><span><i class="previous"></i>${escape(t('trend.legendPrevious'))}</span><span><i class="recent"></i>${escape(t('trend.legendRecent'))}</span></div>`;
    renderTrendProgress();
  }

  function renderTrendProgress() {
    const counts = new Map();
    visibleEvents.forEach(event => {
      const key = `${event.startDate.slice(0, 7)}:${trendGroup(event.startDate)}`;
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    document.querySelectorAll('.trend-fill').forEach(fill => {
      const month = fill.dataset.month;
      const total = monthTotals[months.indexOf(month)];
      fill.style.height = total ? `${(counts.get(`${month}:${fill.dataset.window}`) || 0) / total * 100}%` : '0';
    });
  }

  // Cumulative curve above timeline scrubber (with Oct 5 maritime turning-point marker)
  const runningTotals = [];
  for (let day = 0, running = 0; day <= totalDays; day++) runningTotals.push(running += dateCounts.get(dayToDate(day)) || 0);
  const CHART_WIDTH = 1000;
  const CHART_HEIGHT = 100;
  const chartX = day => day / totalDays * CHART_WIDTH;
  const chartY = count => CHART_HEIGHT - count / events.length * (CHART_HEIGHT - 6);
  const darkTurnDay = dayOf(DARK_TURN_DATE);

  function renderCumulative() {
    let line = `M0 ${chartY(runningTotals[0])}`;
    for (let day = 1; day <= totalDays; day++) {
      if (runningTotals[day] !== runningTotals[day - 1]) line += `H${chartX(day).toFixed(2)}V${chartY(runningTotals[day]).toFixed(2)}`;
    }
    line += `H${CHART_WIDTH}`;
    const area = `${line}V${CHART_HEIGHT}H0Z`;
    const winStart = intervalStartDay;
    const winEnd = intervalEndDay;
    const before = winStart > 0 ? runningTotals[winStart - 1] : 0;
    const atEnd = runningTotals[winEnd];
    const point = (day, count) => `left:${chartX(day) / CHART_WIDTH * 100}%;bottom:${(CHART_HEIGHT - chartY(count)) / CHART_HEIGHT * 100}%`;
    const intervalLabel = (winStart === 0 && winEnd === totalDays)
      ? t('trend.legendRecent')
      : `${shortDate(dayToDate(winStart))} – ${shortDate(dayToDate(winEnd))}`;
    const turnX = chartX(darkTurnDay);
    const turnPct = (turnX / CHART_WIDTH) * 100;

    $('cumulative').innerHTML = `<svg viewBox="0 0 ${CHART_WIDTH} ${CHART_HEIGHT}" preserveAspectRatio="none" aria-hidden="true"><defs><clipPath id="cumulative-progress"><rect id="cumulative-clip" x="${chartX(winStart)}" y="0" width="${Math.max(0, chartX(playbackDay) - chartX(winStart))}" height="${CHART_HEIGHT}"/></clipPath></defs><rect class="cumulative-window" x="${chartX(winStart)}" y="0" width="${Math.max(2, chartX(winEnd) - chartX(winStart))}" height="${CHART_HEIGHT}"/><path class="cumulative-area ghost" d="${area}"/><path class="cumulative-line ghost" d="${line}" vector-effect="non-scaling-stroke"/><g clip-path="url(#cumulative-progress)"><path class="cumulative-area" d="${area}"/><path class="cumulative-line" d="${line}" vector-effect="non-scaling-stroke"/></g><line class="cumulative-turn-line" x1="${turnX}" y1="0" x2="${turnX}" y2="${CHART_HEIGHT}" vector-effect="non-scaling-stroke"/></svg><span class="cumulative-title">${escape(t('cumulative.title'))}</span><span class="cumulative-window-label" style="left:${chartX(winStart) / CHART_WIDTH * 100}%">${escape(intervalLabel)}</span><span class="cumulative-turn-label" style="left:${turnPct}%" title="${escape(t('revamp.turnMarker'))}">⚓ ${escape(shortDate(DARK_TURN_DATE))}</span><span class="cumulative-point" style="${point(winStart, before)}"><span>${format.number.format(before)}</span></span><span class="cumulative-point end" style="${point(winEnd, atEnd)}"><span>${format.number.format(atEnd)}</span></span>`;
  }

  // Render the Black Sea Maritime Escalation modal vessel list
  function renderMaritimeDialog() {
    const container = $('maritime-vessel-list');
    if (!container) return;
    $('focus-maritime-label').textContent = t('revamp.darkTurnFocusBtn', {n: MARITIME_SHIP_IDS.size});
    const octRecords = events.filter(e => OCT_MARITIME_IDS.has(e.id));
    const precursorRecords = events.filter(e => MARITIME_SHIP_IDS.has(e.id) && !OCT_MARITIME_IDS.has(e.id));
    const renderItem = event => {
      const copy = pageCopyFor(event);
      const isTerritorial = /territorial waters/i.test(event.countries) || /territorial waters/i.test(event.location);
      const casualtyBadge = hasCasualties(event) ? `<span class="casualty-badge">${escape(t('revamp.casualtyBadge'))}</span>` : '';
      return `<button type="button" class="maritime-vessel-item" data-maritime-event="${event.id}" style="--category:${colors[event.category]}">
        <div class="maritime-vessel-top">
          <span>${escape(event.id)} · ${escape(shortDateYear(event.startDate))} · <span lang="en">${escape(event.countries)}</span></span>
          <span>${casualtyBadge} <span class="cat-pill" style="--category:${colors[event.category]}"><i aria-hidden="true"></i>${escape(categoryLabel(event.category))}</span></span>
        </div>
        <div class="maritime-vessel-title" lang="en">${escape(copy.headline)}${isTerritorial ? ' · 🇷🇴 Territorial waters' : ''}</div>
        <div class="maritime-vessel-summary" lang="en">${escape(event.status)}${event.impact ? ` — ${escape(event.impact)}` : ''}</div>
      </button>`;
    };
    container.innerHTML = [...octRecords, ...precursorRecords].map(renderItem).join('');
  }

  // Focus map & feed on the October 2026 Black Sea Maritime Escalation
  function focusMaritimeEscalation(startReplay = false) {
    pause();
    closeDetail();
    intervalStartDay = dayOf(DARK_TURN_DATE);
    intervalEndDay = totalDays;
    currentDay = intervalEndDay;
    playbackDay = intervalEndDay;
    allMode = true;
    selectedCountry = '';
    selectedCategoryGroup = 'maritime';
    searchQuery = '';
    $('country-filter').value = '';
    $('category-filter').value = 'maritime';
    $('feed-search').value = '';
    $('clear-search').hidden = true;
    syncIntervalInputs();
    updatePresetChips('maritime');
    renderCumulative();
    render();
    if (window.innerWidth <= 860 && startReplay) setMobileView('map');
    fitEvents();
    if (startReplay) {
      setStudioOpen(true);
      requestAnimationFrame(renderMonthLabels);
      play();
    }
  }

  function updateFilterBanner() {
    const isCustomInterval = intervalStartDay > 0 || intervalEndDay < totalDays || !allMode;
    const hasDropdownFilter = Boolean(selectedCountry) || Boolean(selectedCategoryGroup);
    const hasFilter = isCustomInterval || hasDropdownFilter || Boolean(searchQuery);
    $('active-filter-banner').hidden = !hasFilter;
    $('mobile-filter-dot').hidden = !hasDropdownFilter;
    if (hasFilter) {
      const parts = [];
      if (isCustomInterval) {
        const endD = allMode ? intervalEndDay : Math.min(intervalEndDay, currentDay);
        parts.push(`${shortDate(dayToDate(intervalStartDay))} – ${shortDateYear(dayToDate(endD))}`);
      }
      if (selectedCountry) parts.push(countryName(selectedCountry));
      if (selectedCategoryGroup) parts.push($('category-filter').selectedOptions[0]?.textContent || selectedCategoryGroup);
      if (searchQuery) parts.push(`"${searchQuery}"`);
      $('active-filter-text').textContent = t('revamp.showingFiltered', {
        visible: visibleEvents.length,
        total: events.length,
        filters: parts.join(' · ')
      });
    }
  }

  function render() {
    const date = dayToDate(currentDay);
    visibleEvents = computeVisibleEvents();
    if (selectedId && !visibleEvents.some(e => e.id === selectedId)) closeDetail();
    renderList();
    renderNewsList();
    renderMarkers();
    renderPlayhead();
    renderTrendProgress();
    updateFilterBanner();

    const startStr = shortDate(dayToDate(intervalStartDay));
    const endStr = shortDateYear(dayToDate(intervalEndDay));
    const isFullYear = intervalStartDay === 0 && intervalEndDay === totalDays;

    $('timeline-range').setAttribute('aria-valuetext', t('timeline.valueText', {date: longDate(date), n: visibleEvents.length}));
    $('current-date').textContent = allMode
      ? (isFullYear ? t('timeline.allDates') : `${startStr} – ${endStr}`)
      : longDate(date);
    $('timeline-status').textContent = allMode
      ? t('revamp.recordsInInterval', {n: visibleEvents.length})
      : `${t('timeline.visible', {n: visibleEvents.length})} · ${t('timeline.onDate', {n: dateCounts.get(date) || 0})}`;

    const periodText = allMode
      ? `${startStr} — ${endStr}`
      : `${startStr} — ${shortDateYear(date)}`;
    $('map-period').textContent = periodText;
    $('map-visible-summary').textContent = t('timeline.visible', {n: visibleEvents.length});
    $('launcher-date-label').textContent = periodText;
    $('header-interval-badge').textContent = isFullYear && allMode ? t('revamp.presetAll') : `${startStr} – ${shortDate(dayToDate(allMode ? intervalEndDay : currentDay))}`;

    $('show-all').setAttribute('aria-pressed', String(allMode && isFullYear));
    $('previous').disabled = currentDay <= Math.max(intervalStartDay, eventDays[0] ?? 0);
    $('next').disabled = currentDay >= intervalEndDay;
  }

  function renderPlayhead() {
    $('timeline-range').value = playbackDay;
    const startPct = (intervalStartDay / totalDays) * 100;
    const endPct = (intervalEndDay / totalDays) * 100;
    const progPct = (Math.max(intervalStartDay, Math.min(intervalEndDay, playbackDay)) / totalDays) * 100;
    $('timeline-range').style.setProperty('--interval-start-pct', `${startPct}%`);
    $('timeline-range').style.setProperty('--interval-end-pct', `${endPct}%`);
    $('timeline-range').style.setProperty('--progress', `${progPct}%`);
    const clip = $('cumulative-clip');
    if (clip) {
      clip.setAttribute('x', chartX(intervalStartDay));
      clip.setAttribute('width', Math.max(0, chartX(playbackDay) - chartX(intervalStartDay)));
    }
  }

  function updatePlayButton() {
    $('play').setAttribute('aria-label', t(playing ? 'play.pause' : 'play.play'));
    $('play').setAttribute('aria-pressed', String(playing));
    const iconHTML = playing
      ? `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h4v14H6zm8 0h4v14h-4z"/></svg><span>${escape(t('play.pauseLabel'))}</span>`
      : `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 11 7-11 7Z"/></svg><span>${escape(t('play.replayLabel'))}</span>`;
    $('play').innerHTML = iconHTML;
    $('quick-play-btn').innerHTML = playing
      ? `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h4v14H6zm8 0h4v14h-4z"/></svg><span>${escape(t('play.pauseLabel'))}</span>`
      : `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 11 7-11 7Z"/></svg><span>${escape(t('play.replayLabel'))}</span>`;
  }

  function updateSoundButton() {
    $('sound').setAttribute('aria-pressed', String(soundEnabled));
    $('sound').title = t(soundEnabled ? 'sound.mute' : 'sound.unmute');
    $('sound').querySelector('.sound-waves').toggleAttribute('hidden', !soundEnabled);
    $('sound').querySelector('.sound-muted').toggleAttribute('hidden', soundEnabled);
  }

  function pause(stopSound = true) {
    playing = false;
    cancelAnimationFrame(animationFrame);
    animationFrame = null;
    lastFrameTime = null;
    if (stopSound) stopVoices();
    if (isRecordingVideo) finishVideoRecording();
    updatePlayButton();
  }

  function tick(timestamp) {
    if (!playing) return;
    const elapsed = lastFrameTime === null ? 0 : Math.max(0, (timestamp - lastFrameTime) / 1000);
    lastFrameTime = timestamp;
    playbackDay = Math.min(intervalEndDay, playbackDay + elapsed * REPLAY_DAYS_PER_SECOND * Number($('speed').value));
    const nextDay = Math.floor(playbackDay);
    if (nextDay !== currentDay) {
      currentDay = nextDay;
      render();
    } else {
      renderPlayhead();
    }
    if (isRecordingVideo) {
      drawRecordingFrame();
    }
    if (currentDay >= intervalEndDay) {
      pause(false);
      $('announcer').textContent = t('replay.complete', {n: visibleEvents.length});
    } else {
      animationFrame = requestAnimationFrame(tick);
    }
  }

  function play() {
    cancelAnimationFrame(animationFrame);
    animationFrame = null;
    const audioReady = prepareAudio();
    const waitingForAudio = audioContext?.state === 'suspended';
    closeDetail();
    if (allMode || currentDay >= intervalEndDay || currentDay < intervalStartDay) {
      currentDay = playbackDay = intervalStartDay;
    }
    allMode = false;
    playing = true;
    render();
    if (playbackDay === intervalStartDay) {
      revealEvents(visibleEvents);
      if (waitingForAudio) audioReady?.then(() => { if (playing && currentDay === intervalStartDay) playArrivalSound(visibleEvents); });
    }
    fitEvents();
    updatePlayButton();
    lastFrameTime = null;
    animationFrame = requestAnimationFrame(tick);
  }

  function setDay(day) {
    const clamped = Math.max(intervalStartDay, Math.min(intervalEndDay, Math.round(day)));
    pause();
    document.querySelectorAll('.marker-ripple').forEach(ripple => ripple.remove());
    currentDay = clamped;
    playbackDay = clamped;
    allMode = false;
    render();
  }

  function showAll() {
    pause();
    document.querySelectorAll('.marker-ripple').forEach(ripple => ripple.remove());
    closeDetail();
    intervalStartDay = 0;
    intervalEndDay = totalDays;
    allMode = true;
    currentDay = totalDays;
    playbackDay = totalDays;
    syncIntervalInputs();
    updatePresetChips('all');
    renderCumulative();
    render();
    fitEvents();
    $('event-list').scrollTop = 0;
  }

  // Studio Open / Close with focus management
  function setStudioOpen(open) {
    if (open && !studioOpen) studioReturnFocus = document.activeElement;
    studioOpen = open;
    $('timeline-drawer').hidden = !open;
    $('replay-launcher').hidden = open;
    $('toggle-studio-btn').setAttribute('aria-expanded', String(open));
    $('open-studio-pill').setAttribute('aria-expanded', String(open));
    if (open) {
      $('play').focus({preventScroll: true});
    } else if (studioReturnFocus?.isConnected) {
      studioReturnFocus.focus({preventScroll: true});
    }
  }

  // Time Interval Controls (`From` — `To` + Presets)
  function syncIntervalInputs() {
    $('interval-start').value = dayToDate(intervalStartDay);
    $('interval-end').value = dayToDate(intervalEndDay);
    $('interval-start').max = dayToDate(intervalEndDay);
    $('interval-end').min = dayToDate(intervalStartDay);
  }

  function updatePresetChips(activePreset) {
    document.querySelectorAll('.preset-chip').forEach(chip => {
      chip.classList.toggle('active', chip.dataset.preset === activePreset);
    });
  }

  function applyInterval(startDay, endDay, presetName = '') {
    pause();
    intervalStartDay = Math.max(0, Math.min(totalDays, startDay));
    intervalEndDay = Math.max(intervalStartDay, Math.min(totalDays, endDay));
    currentDay = intervalEndDay;
    playbackDay = intervalEndDay;
    allMode = true;
    syncIntervalInputs();
    updatePresetChips(presetName);
    renderCumulative();
    render();
    fitEvents();
  }

  // ==========================================================================
  // Custom Time-Interval Video Recorder & Snapshot Exporter (Canvas + MediaRecorder)
  // ==========================================================================
  let isRecordingVideo = false;
  let mediaRecorder = null;
  let recCanvas = null;
  let recCtx = null;

  // Simplified European & Black Sea / Baltic coastline & border polylines for crisp, CORS-proof canvas rendering
  const GEO_LINES = [
    // Black Sea West & North Coast (Turkey -> Bulgaria -> Romania -> Ukraine -> Crimea)
    [[41.2,29.0],[41.9,28.0],[42.5,27.5],[42.7,27.7],[43.2,27.9],[43.4,28.5],[43.7,28.6],[44.2,28.65],[44.8,29.6],[45.2,29.7],[45.5,29.6],[46.0,30.4],[46.5,30.7],[46.6,31.5],[46.2,32.2],[46.0,33.5],[45.3,32.5],[44.4,33.8],[44.6,34.4],[45.3,36.5]],
    // Danube / Romania-Bulgaria-Ukraine border
    [[43.8,22.9],[43.7,24.0],[43.6,25.5],[44.0,26.5],[44.1,27.3],[44.4,28.0],[45.2,28.2],[45.4,28.2],[45.3,28.8],[45.2,29.7]],
    // Romania-Moldova-Ukraine inland
    [[45.4,28.2],[46.5,28.2],[47.2,27.6],[48.2,26.6],[47.9,25.2],[47.9,23.9]],
    // Aegean & Greece
    [[38.0,23.5],[38.4,24.1],[39.3,23.2],[40.5,22.9],[40.6,24.5],[40.9,26.0],[40.0,26.2],[39.0,26.9],[38.3,26.2],[37.0,27.4]],
    // Baltic Coast & Finland / Sweden / Poland / Germany
    [[53.9,14.2],[54.5,16.5],[54.4,18.6],[54.7,20.0],[55.3,21.0],[55.7,21.1],[56.0,21.0],[57.0,21.4],[57.8,22.6],[57.0,24.1],[57.8,24.4],[58.4,24.5],[59.4,24.7],[59.5,26.5],[59.4,28.2],[60.1,29.7],[60.5,27.8],[60.1,24.9],[60.4,22.2],[61.5,21.5],[63.8,22.7]],
    // Lithuania / Latvia / Estonia / Poland / Belarus eastern borders
    [[53.9,23.5],[54.3,25.6],[55.2,26.6],[55.7,26.6],[56.2,28.1],[57.5,27.3],[57.8,27.5],[59.4,28.2]],
    // Southern Sweden & Denmark
    [[55.4,13.0],[56.0,12.7],[57.7,11.9],[58.9,11.1],[59.3,18.1],[56.2,16.0],[55.4,13.0]]
  ];
  const COUNTRY_LABELS = [
    {name:'ROMANIA', lat:45.8, lng:25.2},
    {name:'BULGARIA', lat:42.7, lng:25.5},
    {name:'GREECE', lat:39.2, lng:22.2},
    {name:'POLAND', lat:52.2, lng:19.4},
    {name:'LITHUANIA', lat:55.3, lng:23.9},
    {name:'LATVIA', lat:56.9, lng:24.6},
    {name:'ESTONIA', lat:58.7, lng:25.5},
    {name:'FINLAND', lat:61.2, lng:25.8},
    {name:'SWEDEN', lat:56.8, lng:14.8},
    {name:'GERMANY', lat:52.5, lng:12.5},
    {name:'BLACK SEA', lat:43.6, lng:31.4, sea:true},
    {name:'BALTIC SEA', lat:56.4, lng:19.2, sea:true}
  ];

  function createRecordingCanvas() {
    if (!recCanvas) {
      recCanvas = document.createElement('canvas');
      recCanvas.width = 1280;
      recCanvas.height = 720;
      recCtx = recCanvas.getContext('2d');
    }
    return {canvas: recCanvas, ctx: recCtx};
  }

  function mercY(lat) {
    const rad = Math.max(-85, Math.min(85, lat)) * Math.PI / 180;
    return Math.log(Math.tan(Math.PI / 4 + rad / 2));
  }

  function drawRecordingFrame() {
    const {canvas, ctx} = createRecordingCanvas();
    const W = canvas.width;
    const H = canvas.height;

    // 1. Background Ocean / Map Slate
    const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
    bgGrad.addColorStop(0, '#0f2027');
    bgGrad.addColorStop(1, '#152b34');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, W, H);

    // Compute bounding box from events in the active interval (or all events)
    const intervalPool = events.filter(e => {
      const d = dayOf(e.startDate);
      if (d < intervalStartDay || d > intervalEndDay) return false;
      if (selectedCountry && !allCountriesOf(e).includes(selectedCountry)) return false;
      if (selectedCategoryGroup && !matchesCategoryGroup(e, selectedCategoryGroup)) return false;
      return true;
    });
    const boundsPool = intervalPool.length >= 2 ? intervalPool : events;
    const lats = boundsPool.flatMap(e => e.positions.map(p => p.lat));
    const lngs = boundsPool.flatMap(e => e.positions.map(p => p.lng));
    const minLat = Math.max(34, Math.min(...lats) - 2.2);
    const maxLat = Math.min(66, Math.max(...lats) + 2.2);
    const minLng = Math.max(8, Math.min(...lngs) - 3.5);
    const maxLng = Math.min(38, Math.max(...lngs) + 3.5);

    const mapLeft = 40;
    const mapTop = 84;
    const mapW = W - 80;
    const mapH = H - 210;

    const minMY = mercY(minLat);
    const maxMY = mercY(maxLat);
    const spanLng = (maxLng - minLng) * Math.PI / 180;
    const spanMY = Math.max(0.05, maxMY - minMY);
    const scale = Math.min(mapW / spanLng, mapH / spanMY);
    const offsetX = mapLeft + (mapW - spanLng * scale) / 2;
    const offsetY = mapTop + (mapH - spanMY * scale) / 2;

    const project = (lat, lng) => {
      const x = offsetX + ((lng - minLng) * Math.PI / 180) * scale;
      const y = offsetY + (maxMY - mercY(lat)) * scale;
      return [x, y];
    };

    // 2. Subtle Lat/Lng Grid
    ctx.save();
    ctx.beginPath();
    ctx.rect(mapLeft, mapTop, mapW, mapH);
    ctx.clip();

    ctx.strokeStyle = 'rgba(156, 208, 203, 0.08)';
    ctx.lineWidth = 1;
    for (let lat = 35; lat <= 65; lat += 5) {
      const [, y] = project(lat, minLng);
      ctx.beginPath();
      ctx.moveTo(mapLeft, y);
      ctx.lineTo(mapLeft + mapW, y);
      ctx.stroke();
    }
    for (let lng = 10; lng <= 40; lng += 5) {
      const [x] = project(minLat, lng);
      ctx.beginPath();
      ctx.moveTo(x, mapTop);
      ctx.lineTo(x, mapTop + mapH);
      ctx.stroke();
    }

    // 3. Draw Coastlines & Borders
    ctx.strokeStyle = 'rgba(162, 205, 212, 0.36)';
    ctx.lineWidth = 1.8;
    ctx.lineJoin = 'round';
    GEO_LINES.forEach(line => {
      ctx.beginPath();
      line.forEach(([lat, lng], i) => {
        const [x, y] = project(lat, lng);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    });

    // 4. Country & Sea Labels
    ctx.textAlign = 'center';
    COUNTRY_LABELS.forEach(lbl => {
      const [x, y] = project(lbl.lat, lbl.lng);
      if (x < mapLeft + 30 || x > mapLeft + mapW - 30 || y < mapTop + 20 || y > mapTop + mapH - 20) return;
      ctx.font = lbl.sea ? 'italic 600 11px "DM Sans", system-ui, sans-serif' : '700 11px "DM Sans", system-ui, sans-serif';
      ctx.fillStyle = lbl.sea ? 'rgba(130, 185, 205, 0.38)' : 'rgba(205, 226, 230, 0.42)';
      ctx.fillText(lbl.name, x, y);
    });

    // 5. Draw Active Incident Markers
    const activeDate = dayToDate(allMode ? intervalEndDay : currentDay);
    visibleEvents.forEach(event => {
      const isToday = !allMode && event.startDate === activeDate;
      const col = colors[event.category] || '#3278c5';
      event.positions.forEach(pos => {
        const [x, y] = project(pos.lat, pos.lng);
        // Outer halo
        ctx.beginPath();
        ctx.arc(x, y, isToday ? 14 : 9, 0, Math.PI * 2);
        ctx.fillStyle = col + (isToday ? '55' : '28');
        ctx.fill();
        // Core dot
        ctx.beginPath();
        ctx.arc(x, y, isToday ? 6.5 : 5, 0, Math.PI * 2);
        ctx.fillStyle = col;
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = '#ffffffcc';
        ctx.stroke();
      });
    });

    // 6. Expanding Ripples for Newly Revealed Incidents
    const nowPerf = performance.now();
    for (let i = recentRipples.length - 1; i >= 0; i--) {
      const r = recentRipples[i];
      const age = (nowPerf - r.start) / 900;
      if (age > 1) {
        recentRipples.splice(i, 1);
        continue;
      }
      const [x, y] = project(r.lat, r.lng);
      ctx.beginPath();
      ctx.arc(x, y, 6 + age * 28, 0, Math.PI * 2);
      ctx.strokeStyle = r.color;
      ctx.globalAlpha = Math.max(0, (1 - age) * 0.85);
      ctx.lineWidth = 2.2;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    // 7. Top Broadcast Header Bar
    ctx.fillStyle = 'rgba(13, 27, 33, 0.92)';
    ctx.fillRect(0, 0, W, 68);
    ctx.strokeStyle = '#25434d';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, 68);
    ctx.lineTo(W, 68);
    ctx.stroke();

    ctx.fillStyle = '#9cd0cb';
    ctx.font = '700 12px "DM Sans", system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('EUROPE / FOREIGN DRONE EVENTS · 2026 RESEARCH REGISTER', 32, 26);

    ctx.fillStyle = '#ffffff';
    ctx.font = '700 20px Manrope, system-ui, sans-serif';
    const intervalHeader = `${shortDateYear(dayToDate(intervalStartDay))} → ${shortDateYear(dayToDate(intervalEndDay))}`;
    ctx.fillText(`Interval: ${intervalHeader}`, 32, 52);

    // Top-right current replay date & visible counter
    ctx.textAlign = 'right';
    ctx.fillStyle = '#a9e5df';
    ctx.font = '700 13px "DM Sans", system-ui, sans-serif';
    ctx.fillText(allMode ? 'ALL INTERVAL DATES' : longDate(activeDate).toUpperCase(), W - 32, 27);
    ctx.fillStyle = '#ffffff';
    ctx.font = '800 22px Manrope, system-ui, sans-serif';
    ctx.fillText(t('revamp.recordsInInterval', {n: visibleEvents.length}), W - 32, 53);

    // 8. Bottom HUD: Latest Incident Ticker + Progress Bar + Legend
    ctx.fillStyle = 'rgba(13, 27, 33, 0.94)';
    ctx.fillRect(0, H - 114, W, 114);
    ctx.strokeStyle = '#25434d';
    ctx.beginPath();
    ctx.moveTo(0, H - 114);
    ctx.lineTo(W, H - 114);
    ctx.stroke();

    // Latest visible event headline ticker
    const latestEv = visibleEvents[visibleEvents.length - 1];
    if (latestEv) {
      const latestCopy = pageCopyFor(latestEv);
      ctx.textAlign = 'left';
      ctx.fillStyle = colors[latestEv.category] || '#258d86';
      ctx.font = '700 12px "DM Sans", system-ui, sans-serif';
      ctx.fillText(`LATEST (${shortDate(latestEv.startDate)} · ${primaryCountry(latestEv).toUpperCase()} · ${latestEv.id}):`, 32, H - 84);
      ctx.fillStyle = '#ffffff';
      ctx.font = '600 15px Manrope, system-ui, sans-serif';
      const maxHeadline = latestCopy.headline.length > 98 ? latestCopy.headline.slice(0, 95) + '…' : latestCopy.headline;
      ctx.fillText(maxHeadline, 265, H - 84);
    }

    // Timeline Progress Track on Canvas
    const trackX = 32;
    const trackY = H - 54;
    const trackW = W - 64;
    ctx.fillStyle = '#243d46';
    ctx.fillRect(trackX, trackY, trackW, 6);
    const spanDays = Math.max(1, intervalEndDay - intervalStartDay);
    const curProgress = Math.max(0, Math.min(1, ((allMode ? intervalEndDay : playbackDay) - intervalStartDay) / spanDays));
    ctx.fillStyle = '#25a097';
    ctx.fillRect(trackX, trackY, trackW * curProgress, 6);

    // Category Legend Row + Honesty Note
    const legendItems = [
      [categoryLabel('flight'), colors.flight],
      [t('legend.shotdownEngaged'), colors.shotdown],
      [categoryLabel('crash'), colors.crash],
      [t('legend.strikeExplosion'), colors.explosion],
      [categoryLabel('disposal'), colors.disposal],
      [categoryLabel('recovery'), colors.recovery],
      [categoryLabel('alert'), colors.alert]
    ];
    let lx = 32;
    const ly = H - 22;
    ctx.font = '500 11.5px "DM Sans", system-ui, sans-serif';
    legendItems.forEach(([label, color]) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(lx + 4, ly - 4, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#c8d9dd';
      ctx.textAlign = 'left';
      ctx.fillText(label, lx + 13, ly);
      lx += ctx.measureText(label).width + 28;
    });

    ctx.textAlign = 'right';
    ctx.fillStyle = '#89a3aa';
    ctx.font = '500 11px "DM Sans", system-ui, sans-serif';
    ctx.fillText('droneincidents.eu · Approximate positions · Record counts ≠ confirmed attacks', W - 32, ly);
  }

  function pickSupportedMimeType() {
    if (typeof MediaRecorder === 'undefined') return '';
    const candidates = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm',
      'video/mp4'
    ];
    return candidates.find(type => MediaRecorder.isTypeSupported(type)) || '';
  }

  function setIntervalControlsDisabled(disabled) {
    $('interval-start').disabled = disabled;
    $('interval-end').disabled = disabled;
    document.querySelectorAll('.preset-chip').forEach(chip => { chip.disabled = disabled; });
  }

  function startVideoRecording() {
    if (isRecordingVideo) {
      finishVideoRecording();
      return;
    }
    const {canvas} = createRecordingCanvas();
    if (!canvas.captureStream || typeof MediaRecorder === 'undefined') {
      downloadSnapshotPNG();
      return;
    }

    prepareAudio();
    isRecordingVideo = true;
    const localChunks = [];
    const recStartDate = dayToDate(intervalStartDay);
    const recEndDate = dayToDate(intervalEndDay);
    setIntervalControlsDisabled(true);
    $('record-video-btn').classList.add('recording');
    $('record-video-label').textContent = t('revamp.stopSaveVideo');
    $('recording-status-bar').hidden = false;
    $('recording-status-text').textContent = t('revamp.recordingActive', {
      start: shortDate(recStartDate),
      end: shortDate(recEndDate)
    });

    // Start replay from the beginning of the selected interval
    currentDay = playbackDay = intervalStartDay;
    allMode = false;
    drawRecordingFrame();

    const stream = canvas.captureStream(30);
    if (soundEnabled && recordingAudioDest?.stream) {
      recordingAudioDest.stream.getAudioTracks().forEach(track => stream.addTrack(track));
    }

    const mimeType = pickSupportedMimeType();
    const localRecorder = mimeType ? new MediaRecorder(stream, {mimeType, videoBitsPerSecond: 4500000}) : new MediaRecorder(stream);
    mediaRecorder = localRecorder;
    localRecorder.ondataavailable = e => {
      if (e.data && e.data.size > 0) localChunks.push(e.data);
    };
    localRecorder.onstop = () => {
      const ext = (localRecorder.mimeType || '').includes('mp4') ? 'mp4' : 'webm';
      const blob = new Blob(localChunks, {type: localRecorder.mimeType || 'video/webm'});
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `eu-drone-incidents-${recStartDate}-to-${recEndDate}.${ext}`;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      $('recording-status-text').textContent = t('revamp.recordingSaved', {file: a.download});
      setTimeout(() => {
        if (!isRecordingVideo) $('recording-status-bar').hidden = true;
      }, 4500);
    };

    localRecorder.start(200);
    play();
  }

  function finishVideoRecording() {
    if (!isRecordingVideo) return;
    isRecordingVideo = false;
    setIntervalControlsDisabled(false);
    drawRecordingFrame();
    $('record-video-btn').classList.remove('recording');
    $('record-video-label').textContent = t('revamp.recordVideo');
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
    }
  }

  function downloadSnapshotPNG() {
    drawRecordingFrame();
    const {canvas} = createRecordingCanvas();
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = `eu-drone-incidents-snapshot-${dayToDate(intervalStartDay)}-to-${dayToDate(allMode ? intervalEndDay : currentDay)}.png`;
    document.body.append(a);
    a.click();
    a.remove();
  }

  function downloadIntervalCSV() {
    const headers = ['id','startDate','endDate','countries','title','category','status','headline','tldr_description','attribution','uncertainty','impact','response','sources'];
    const csvEscape = val => {
      const str = String(val ?? '');
      const safe = /^[=+\-@\t\r]/.test(str) ? `'${str}` : str;
      return `"${safe.replace(/"/g, '""')}"`;
    };
    const rows = [headers.join(',')];
    visibleEvents.forEach(ev => {
      const copy = pageCopyFor(ev);
      const srcUrls = ev.sources.map(id => sources[id]?.url || id).join(' | ');
      rows.push([
        ev.id,
        ev.startDate,
        ev.endDate || ev.startDate,
        ev.countries,
        ev.title,
        ev.category,
        ev.status,
        copy.headline,
        copy.description,
        ev.attribution,
        ev.uncertainty,
        ev.impact,
        ev.response,
        srcUrls
      ].map(csvEscape).join(','));
    });
    const blob = new Blob([rows.join('\n')], {type: 'text/csv;charset=utf-8'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `eu-drone-incidents-${dayToDate(intervalStartDay)}-to-${dayToDate(allMode ? intervalEndDay : currentDay)}.csv`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  // About & Legend rendering
  const baseCount = events.filter(event => event.id.startsWith('E')).length;
  const eventCount = events.filter(event => event.recordClass === 'event').length;
  const candidateCount = events.filter(event => event.recordClass === 'candidate').length;
  const countryCount = new Set(events.flatMap(allCountriesOf)).size;

  function renderAbout() {
    const rows = [
      ['about.statTotal', events.length],
      ['about.statBase', baseCount],
      ['about.statAdded', eventCount - baseCount],
      ['about.statCandidates', candidateCount],
      ['about.statContexts', contexts.length],
      ['about.statSources', Object.keys(sources).length],
      ['about.statCutoff', longDate(cutoff)]
    ];
    $('register-summary').innerHTML = rows.map(([key, value]) => `<div><dt>${escape(t(key))}</dt><dd>${escape(typeof value === 'number' ? format.number.format(value) : value)}</dd></div>`).join('');
    $('about-replay').textContent = t('about.replay', {seconds: Math.round(totalDays / REPLAY_DAYS_PER_SECOND)});
    $('context-title').textContent = t('about.contextTitle', {n: contexts.length});
  }

  function renderLegend() {
    const sharedLegendLabels = {shotdown: 'legend.shotdownEngaged', explosion: 'legend.strikeExplosion'};
    $('map-legend').innerHTML = Object.keys(colors)
      .filter(key => key !== 'engaged' && key !== 'strike')
      .map(key => `<span><i style="background:${colors[key]}"></i>${escape(sharedLegendLabels[key] ? t(sharedLegendLabels[key]) : categoryLabel(key))}</span>`).join('');
  }

  function renderMonthLabels() {
    const labels = document.querySelector('.month-labels');
    if (!labels) return;
    const shortNames = months.map((_, i) => format.month.format(monthStart(i)).replace(/\.$/, ''));
    const monthGap = labels.offsetWidth * 28 * DAY / (lastTime - firstTime);
    const names = monthGap && monthGap < Math.max(...shortNames.map(name => name.length)) * 7.5 + 8
      ? months.map((_, i) => format.monthNarrow.format(monthStart(i)))
      : shortNames;
    labels.innerHTML = months.map((_, i) => {
      const time = monthStart(i).getTime();
      return `<span style="left:${(time - firstTime) / (lastTime - firstTime) * 100}%">${escape(names[i].toLocaleUpperCase(locale))}</span>`;
    }).join('');
  }

  function applyStaticText() {
    document.documentElement.lang = lang;
    $('language-code').textContent = lang.toUpperCase();
    document.title = t('meta.title');
    document.querySelector('meta[name="description"]').content = t('meta.description');
    document.querySelectorAll('[data-i18n]').forEach(element => { element.textContent = t(element.dataset.i18n); });
    document.querySelectorAll('[data-i18n-aria]').forEach(element => element.setAttribute('aria-label', t(element.dataset.i18nAria)));
    document.querySelectorAll('[data-i18n-title]').forEach(element => { element.title = t(element.dataset.i18nTitle); });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(element => { element.placeholder = t(element.dataset.i18nPlaceholder); });
    const zoomIn = zoomControl.getContainer().querySelector('.leaflet-control-zoom-in');
    const zoomOut = zoomControl.getContainer().querySelector('.leaflet-control-zoom-out');
    zoomIn.title = t('zoom.in'); zoomIn.setAttribute('aria-label', t('zoom.in'));
    zoomOut.title = t('zoom.out'); zoomOut.setAttribute('aria-label', t('zoom.out'));
  }

  function localize() {
    applyStaticText();
    $('cutoff-label').textContent = shortDate(cutoff);
    populateFilterDropdowns();
    renderLegend();
    renderMonthLabels();
    renderAbout();
    renderMaritimeDialog();
    renderTrend();
    renderCumulative();
    labelMarkers();
    labelAreas();
    updatePlayButton();
    updateSoundButton();
    render();
    if (selectedId && !$('detail').hidden) renderDetail(events.find(event => event.id === selectedId));
    else if (openAreaId && !$('detail').hidden) renderArea(AREAS.find(area => area.id === openAreaId));
    document.documentElement.removeAttribute('data-i18n-pending');
  }

  async function changeLanguage(code) {
    if (!Object.hasOwn(LANGUAGES, code) || code === lang) return;
    if (!(await loadLanguage(code))) { $('language').value = lang; return; }
    try { localStorage.setItem(LANGUAGE_KEY, code); } catch { /* Ignore */ }
    const url = new URL(location.href);
    if (code === 'en') url.searchParams.delete('lang');
    else url.searchParams.set('lang', code);
    history.replaceState(history.state, '', url);
    configureLanguage(code);
    localize();
    $('announcer').textContent = LANGUAGES[code];
  }

  // Event Listeners
  $('language').innerHTML = Object.entries(LANGUAGES).map(([code, name]) => `<option value="${code}" lang="${code}">${escape(name)}</option>`).join('');
  $('language').value = lang;
  $('language').addEventListener('change', event => changeLanguage(event.target.value));
  $('country-total').textContent = countryCount;
  $('record-total').textContent = events.length;
  $('timeline-range').max = totalDays;
  $('timeline-range').value = totalDays;
  $('interval-start').min = firstDateStr;
  $('interval-start').max = cutoff;
  $('interval-start').value = firstDateStr;
  $('interval-end').min = firstDateStr;
  $('interval-end').max = cutoff;
  $('interval-end').value = cutoff;

  $('context-records').innerHTML = contexts.map(c => `<details><summary><strong>${c.id}</strong> · ${escape(c.countries)}</summary><p class="context-meta">${escape(c.dateLabel)} · ${escape(c.status)}</p><p>${escape(c.vehicle)}</p>${c.attribution ? `<p>${escape(c.attribution)}</p>` : ''}<p>${escape(c.deduplication)}</p>${c.uncertainty ? `<p>${escape(c.uncertainty)}</p>` : ''}${sourceLinks(c.sources)}</details>`).join('');

  // Feed Mode Switching: Latest Incidents vs News Articles
  function setFeedMode(mode) {
    feedMode = mode;
    $('tab-incidents').classList.toggle('active', mode === 'incidents');
    $('tab-incidents').setAttribute('aria-selected', String(mode === 'incidents'));
    $('tab-news').classList.toggle('active', mode === 'news');
    $('tab-news').setAttribute('aria-selected', String(mode === 'news'));
    $('event-list').hidden = mode !== 'incidents';
    $('news-list').hidden = mode !== 'news';
    $('list-title').textContent = mode === 'incidents'
      ? t('revamp.listTitleIncidents')
      : t('revamp.listTitleNews');
    if (mode === 'news') renderNewsList();
    syncMobileTabs();
  }
  $('tab-incidents').addEventListener('click', () => setFeedMode('incidents'));
  $('tab-news').addEventListener('click', () => setFeedMode('news'));

  // Search & Filter Listeners
  $('feed-search').addEventListener('input', e => {
    searchQuery = e.target.value.trim();
    $('clear-search').hidden = !searchQuery;
    render();
  });
  $('clear-search').addEventListener('click', () => {
    searchQuery = '';
    $('feed-search').value = '';
    $('clear-search').hidden = true;
    render();
    $('feed-search').focus();
  });
  $('mobile-filter-toggle').addEventListener('click', () => {
    const isOpen = $('filter-selects').classList.toggle('mobile-open');
    $('mobile-filter-toggle').setAttribute('aria-expanded', String(isOpen));
  });
  $('country-filter').addEventListener('change', e => {
    selectedCountry = e.target.value;
    render();
    fitEvents();
  });
  $('category-filter').addEventListener('change', e => {
    selectedCategoryGroup = e.target.value;
    render();
    fitEvents();
  });
  $('reset-all-filters').addEventListener('click', () => {
    searchQuery = '';
    selectedCountry = '';
    selectedCategoryGroup = '';
    $('feed-search').value = '';
    $('clear-search').hidden = true;
    $('country-filter').value = '';
    $('category-filter').value = '';
    $('filter-selects').classList.remove('mobile-open');
    $('mobile-filter-toggle').setAttribute('aria-expanded', 'false');
    showAll();
  });

  // Black Sea Maritime Escalation ("When Things Took a Dark Turn") Listeners
  $('toggle-maritime-banner').addEventListener('click', () => {
    const banner = $('maritime-turn-banner');
    const collapsed = banner.classList.toggle('collapsed');
    $('toggle-maritime-banner').setAttribute('aria-expanded', String(!collapsed));
    $('toggle-maritime-banner').textContent = collapsed ? '+' : '▾';
  });
  $('focus-maritime-btn').addEventListener('click', () => focusMaritimeEscalation(false));
  $('replay-maritime-btn').addEventListener('click', () => focusMaritimeEscalation(true));
  $('open-maritime-modal-btn').addEventListener('click', () => {
    pause();
    $('maritime-dialog').showModal();
  });
  $('maritime-turn-btn').addEventListener('click', () => {
    pause();
    $('maritime-dialog').showModal();
  });
  $('close-maritime').addEventListener('click', () => $('maritime-dialog').close());
  $('modal-filter-maritime-btn').addEventListener('click', () => {
    $('maritime-dialog').close();
    focusMaritimeEscalation(false);
  });
  $('modal-replay-maritime-btn').addEventListener('click', () => {
    $('maritime-dialog').close();
    focusMaritimeEscalation(true);
  });
  $('maritime-vessel-list').addEventListener('click', event => {
    const btn = event.target.closest('[data-maritime-event]');
    if (!btn) return;
    $('maritime-dialog').close();
    selectEvent(btn.dataset.maritimeEvent, true);
  });

  // Mobile View Tabs (Unified 3-tab bar: Incidents, News, Map & Replay)
  $('mob-tab-feed').addEventListener('click', () => setMobileView('feed', 'incidents'));
  $('mob-tab-news').addEventListener('click', () => setMobileView('feed', 'news'));
  $('mob-tab-map').addEventListener('click', () => setMobileView('map'));

  // Studio & Playback Listeners
  $('toggle-studio-btn').addEventListener('click', () => {
    if (window.innerWidth <= 860) setMobileView('map');
    setStudioOpen(!studioOpen);
    requestAnimationFrame(renderMonthLabels);
  });
  $('open-studio-pill').addEventListener('click', () => {
    setStudioOpen(true);
    requestAnimationFrame(renderMonthLabels);
  });
  $('close-studio-btn').addEventListener('click', () => setStudioOpen(false));
  $('quick-play-btn').addEventListener('click', () => {
    setStudioOpen(true);
    requestAnimationFrame(renderMonthLabels);
    playing ? pause() : play();
  });
  $('play').addEventListener('click', () => playing ? pause() : play());

  $('sound').addEventListener('click', () => {
    soundEnabled = !soundEnabled;
    updateSoundButton();
    if (audioOutput) audioOutput.gain.setTargetAtTime(soundEnabled ? REPLAY_VOLUME : 0, audioContext.currentTime, 0.005);
    if (!soundEnabled) stopVoices();
    if (soundEnabled && playing) prepareAudio();
  });

  $('timeline-range').addEventListener('input', event => setDay(Math.round(Number(event.target.value))));
  $('timeline-range').addEventListener('keydown', event => {
    const steps = {ArrowLeft:-1, ArrowDown:-1, ArrowRight:1, ArrowUp:1, PageDown:-7, PageUp:7};
    let day;
    if (Object.hasOwn(steps, event.key)) day = currentDay + steps[event.key];
    else if (event.key === 'Home') day = intervalStartDay;
    else if (event.key === 'End') day = intervalEndDay;
    else return;
    event.preventDefault();
    setDay(Math.max(intervalStartDay, Math.min(intervalEndDay, day)));
  });

  $('previous').addEventListener('click', () => {
    const prev = [...eventDays].reverse().find(day => day < currentDay && day >= intervalStartDay);
    setDay(prev ?? intervalStartDay);
  });
  $('next').addEventListener('click', () => {
    const nxt = eventDays.find(day => day > currentDay && day <= intervalEndDay);
    setDay(nxt ?? intervalEndDay);
  });
  $('show-all').addEventListener('click', showAll);
  $('fit-map').addEventListener('click', () => { closeDetail(); fitEvents(); });

  // Time Interval Date Pickers & Presets
  $('interval-start').addEventListener('change', e => {
    if (!e.target.value) return;
    applyInterval(dayOf(e.target.value), intervalEndDay, '');
  });
  $('interval-end').addEventListener('change', e => {
    if (!e.target.value) return;
    applyInterval(intervalStartDay, dayOf(e.target.value), '');
  });
  document.querySelectorAll('.preset-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const p = chip.dataset.preset;
      if (p === 'all') {
        if (selectedCategoryGroup === 'maritime') {
          selectedCategoryGroup = '';
          $('category-filter').value = '';
        }
        applyInterval(0, totalDays, 'all');
      }
      else if (p === '30d') applyInterval(Math.max(0, totalDays - 29), totalDays, '30d');
      else if (p === '90d') applyInterval(Math.max(0, totalDays - 89), totalDays, '90d');
      else if (p === 'surge') applyInterval(dayOf(`${year}-08-01`), totalDays, 'surge');
      else if (p === 'oct') applyInterval(dayOf(`${year}-10-01`), totalDays, 'oct');
      else if (p === 'maritime') focusMaritimeEscalation(false);
    });
  });

  // Video Recording & Export Listeners
  $('record-video-btn').addEventListener('click', startVideoRecording);
  $('export-snapshot-btn').addEventListener('click', downloadSnapshotPNG);
  $('export-data-btn').addEventListener('click', downloadIntervalCSV);

  // Feed Card Button Click Listener
  $('event-list').addEventListener('click', event => {
    const selectBtn = event.target.closest('[data-select-id]');
    if (selectBtn) selectEvent(selectBtn.dataset.selectId);
  });

  // News Stream Incident Jump Listener
  $('news-list').addEventListener('click', event => {
    const btn = event.target.closest('[data-jump-event]');
    if (btn) selectEvent(btn.dataset.jumpEvent);
  });

  // Dialogs (with light-dismiss fallback per modern-web-guidance `light-dismiss-a-dialog`)
  $('trend-pill-button').addEventListener('click', () => {
    pause();
    $('trend-dialog').showModal();
  });
  $('mobile-trend-btn').addEventListener('click', () => {
    pause();
    $('trend-dialog').showModal();
  });
  $('close-trend').addEventListener('click', () => $('trend-dialog').close());

  $('about-button').addEventListener('click', () => { pause(); $('about-dialog').showModal(); });
  $('sidebar-scope-btn').addEventListener('click', () => { pause(); $('about-dialog').showModal(); });
  $('close-about').addEventListener('click', () => $('about-dialog').close());

  if (!('closedBy' in HTMLDialogElement.prototype)) {
    document.querySelectorAll('dialog').forEach(dialog => {
      dialog.addEventListener('click', event => {
        if (event.target !== dialog) return;
        const rect = dialog.getBoundingClientRect();
        const isDialogContent = (
          rect.top <= event.clientY &&
          event.clientY <= rect.top + rect.height &&
          rect.left <= event.clientX &&
          event.clientX <= rect.left + rect.width
        );
        if (isDialogContent) return;
        dialog.close();
      });
    });
  }

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !$('detail').hidden) closeDetail(true);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && !isRecordingVideo) pause();
  });

  new ResizeObserver(() => map.invalidateSize()).observe($('map'));
  new ResizeObserver(renderMonthLabels).observe(document.querySelector('.timeline-track'));

  localize();
  fitEvents();
  const linkedEvent = eventFromHash(), linkedArea = areaFromHash();
  if (linkedEvent) selectEvent(linkedEvent.id);
  else if (linkedArea) openArea(linkedArea);
  else setRecordHash(null);

  window.addEventListener('hashchange', () => {
    const event = eventFromHash(), area = areaFromHash();
    if (event && event.id !== selectedId) selectEvent(event.id);
    else if (area) openArea(area);
    else if (!event && !$('detail').hidden) closeDetail();
  });

  // WebMCP API progressive enhancement
  const context = document.modelContext;
  if (context?.registerTool) {
    const lifecycle = new AbortController();
    const register = tool => {
      try { Promise.resolve(context.registerTool(tool, {signal:lifecycle.signal})).catch(() => {}); } catch { /* Optional browser API. */ }
    };
    register({
      name: 'navigate_drone_event',
      title: 'Open an event',
      description: 'Select a register record, reveal it on the map and open its source-backed details. Pauses replay.',
      inputSchema: {type:'object', properties:{id:{type:'string', pattern:'^[EN]\\d{3}$'}}, required:['id'], additionalProperties:false},
      annotations: {readOnlyHint:false, untrustedContentHint:true},
      execute(input) {
        if (!input || typeof input.id !== 'string' || !events.some(e => e.id === input.id)) throw new Error('Supply a valid E-series or N-series record ID from the register.');
        selectEvent(input.id);
        return {selectedId, visibleRecords: visibleEvents.length};
      }
    });
    register({
      name: 'set_drone_timeline_interval',
      title: 'Set the timeline interval',
      description: 'Filter the map and incident feed to a custom start and end date in 2026.',
      inputSchema: {type:'object', properties:{startDate:{type:'string', format:'date'}, endDate:{type:'string', format:'date'}}, required:['startDate','endDate'], additionalProperties:false},
      annotations: {readOnlyHint:false, untrustedContentHint:false},
      execute(input) {
        const isoDate = /^\d{4}-\d{2}-\d{2}$/;
        if (!input || !isoDate.test(input.startDate || '') || !isoDate.test(input.endDate || '')) {
          throw new Error(`Supply valid YYYY-MM-DD dates between ${firstDateStr} and ${cutoff}.`);
        }
        const sTime = dateValue(input.startDate);
        const eTime = dateValue(input.endDate);
        if (Number.isNaN(sTime) || Number.isNaN(eTime)) {
          throw new Error(`Supply valid YYYY-MM-DD dates between ${firstDateStr} and ${cutoff}.`);
        }
        applyInterval(dayOf(input.startDate), dayOf(input.endDate), '');
        return {startDate: dayToDate(intervalStartDay), endDate: dayToDate(intervalEndDay), visibleRecords: visibleEvents.length};
      }
    });
    window.addEventListener('pagehide', () => lifecycle.abort(), {once:true});
  }
})();
