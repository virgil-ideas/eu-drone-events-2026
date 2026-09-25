'use strict';
(async () => {
  const {events, contexts, sources, cutoff} = window.DRONE_DATA;
  const media = window.DRONE_MEDIA || {};
  const sourceMedia = media.sources || {};
  const extraMedia = media.extra || {};
  const $ = id => document.getElementById(id);
  const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  // Interface language. Record fields, source titles and notes stay in the
  // register's original English; everything else goes through t().
  const LANGUAGES = {bg:'Български', cs:'Čeština', da:'Dansk', de:'Deutsch', el:'Ελληνικά', en:'English', es:'Español', et:'Eesti', fi:'Suomi', fr:'Français', ga:'Gaeilge', hr:'Hrvatski', hu:'Magyar', it:'Italiano', lt:'Lietuvių', lv:'Latviešu', mt:'Malti', nl:'Nederlands', pl:'Polski', pt:'Português', ro:'Română', sk:'Slovenčina', sl:'Slovenščina', sv:'Svenska'};
  const LANGUAGE_KEY = 'drone-events-lang';
  const translations = window.DRONE_I18N;
  const COUNTRY_CODES = {Bulgaria:'BG', Estonia:'EE', Finland:'FI', Germany:'DE', Greece:'GR', Latvia:'LV', Lithuania:'LT', Poland:'PL', Romania:'RO', Sweden:'SE'};
  let lang = 'en';
  let locale = 'en-GB';
  let format = {};
  function loadLanguage(code) {
    if (translations[code]) return Promise.resolve(true);
    return new Promise(resolve => {
      const script = document.createElement('script');
      script.src = `i18n/${code}.js`;
      script.onload = () => resolve(Boolean(translations[code]));
      script.onerror = () => { script.remove(); resolve(false); };
      document.head.append(script);
    });
  }
  function configureLanguage(code) {
    lang = code;
    // English keeps the register's day-month order.
    const requested = code === 'en' ? 'en-GB' : code;
    locale = Intl.DateTimeFormat.supportedLocalesOf([requested]).length ? requested : 'en-GB';
    const date = options => new Intl.DateTimeFormat(locale, {timeZone:'UTC', ...options});
    let regions = null;
    try { regions = new Intl.DisplayNames([locale], {type:'region'}); } catch { /* Keep English names. */ }
    format = {
      plural:new Intl.PluralRules(code),
      number:new Intl.NumberFormat(locale),
      percent:new Intl.NumberFormat(locale, {style:'percent', maximumFractionDigits:0}),
      delta:new Intl.NumberFormat(locale, {style:'percent', maximumFractionDigits:0, signDisplay:'exceptZero'}),
      list:new Intl.ListFormat(locale, {style:'narrow', type:'unit'}),
      short:date({day:'numeric', month:'short'}),
      shortYear:date({day:'numeric', month:'short', year:'numeric'}),
      long:date({day:'numeric', month:'long', year:'numeric'}),
      month:date({month:'short'}),
      monthNarrow:date({month:'narrow'}),
      monthLong:date({month:'long'}),
      monthYear:date({month:'long', year:'numeric'}),
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

  const colors = {flight:'#3278c5', shotdown:'#7b4ab5', engaged:'#7b4ab5', crash:'#f0700f', explosion:'#d3201c', disposal:'#3a6a72', recovery:'#e8c400', alert:'#7c8697'};
  const categoryLabel = category => t(`cat.${category}`);
  const recordClassLabel = recordClass => t(`class.${recordClass}`);
  const DAY = 86400000;
  const REPLAY_DAYS_PER_SECOND = 8;
  const dateValue = date => Date.parse(date + 'T00:00:00Z');
  const utcDate = date => new Date(dateValue(date));
  const firstTime = dateValue(cutoff.slice(0,4) + '-01-01');
  const lastTime = dateValue(cutoff);
  const totalDays = Math.round((lastTime - firstTime) / DAY);
  const shortDate = date => format.short.format(utcDate(date));
  const shortDateYear = date => format.shortYear.format(utcDate(date));
  const longDate = date => format.long.format(utcDate(date));
  const dayToDate = day => new Date(firstTime + day * DAY).toISOString().slice(0,10);
  const dayOf = date => Math.round((dateValue(date) - firstTime) / DAY);
  const eventDays = [...new Set(events.map(e => dayOf(e.startDate)))];
  const dateCounts = new Map();
  events.forEach(e => dateCounts.set(e.startDate, (dateCounts.get(e.startDate) || 0) + 1));
  let currentDay = totalDays;
  let playbackDay = totalDays;
  let allMode = true;
  let playing = false;
  let animationFrame = null;
  let lastFrameTime = null;
  let renderedRecordKey = '';
  let selectedId = null;
  let visibleEvents = events;
  let returnFocus = null;
  let mobileLayout = null;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let soundEnabled = true;
  let audioContext = null;
  let audioOutput = null;
  // C-major pentatonic, rising with the event type's severity cue.
  const categoryNotes = {alert:72, recovery:74, flight:76, disposal:79, engaged:81, shotdown:84, crash:86, explosion:88};
  const REPLAY_VOLUME = 0.05;
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
      }
      return audioContext.resume().catch(() => {});
    } catch { /* Replay still works when audio is unavailable. */ }
  }
  function stopChord() {
    if (!audioContext) return;
    const now = audioContext.currentTime;
    activeVoices.forEach(({tone,envelope}) => {
      const level = envelope.gain.value;
      if (envelope.gain.cancelAndHoldAtTime) envelope.gain.cancelAndHoldAtTime(now);
      else {
        envelope.gain.cancelScheduledValues(now);
        envelope.gain.setValueAtTime(level,now);
      }
      envelope.gain.linearRampToValueAtTime(0,now + 0.014);
      tone.stop(now + 0.018);
    });
    activeVoices.clear();
  }
  function playArrivalSound(arrivals) {
    if (!soundEnabled || audioContext?.state !== 'running' || !arrivals.length) return;
    stopChord();
    const now = audioContext.currentTime;
    const counts = new Map();
    arrivals.forEach(event => counts.set(event.category,(counts.get(event.category) || 0) + 1));
    // Types form a chord. Repeated types affect its balance, not the volume cap.
    const totalWeight = [...counts.values()].reduce((sum,count) => sum + Math.sqrt(count),0);
    counts.forEach((count,category) => {
      const tone = audioContext.createOscillator();
      const envelope = audioContext.createGain();
      const level = Math.sqrt(count) / totalWeight;
      tone.type = 'sine';
      tone.frequency.setValueAtTime(440 * 2 ** ((categoryNotes[category] - 69) / 12),now);
      envelope.gain.setValueAtTime(0,now);
      envelope.gain.linearRampToValueAtTime(level,now + 0.014);
      envelope.gain.exponentialRampToValueAtTime(0.0001,now + 0.22);
      envelope.gain.linearRampToValueAtTime(0,now + 0.24);
      tone.connect(envelope).connect(audioOutput);
      const voice = {tone,envelope};
      activeVoices.add(voice);
      tone.onended = () => { tone.disconnect(); envelope.disconnect(); activeVoices.delete(voice); };
      tone.start(now);
      tone.stop(now + 0.24);
    });
  }
  function revealEvents(arrivals) {
    if (!arrivals.length) return;
    if (!reducedMotion) arrivals.forEach(event => markers.get(event.id).forEach(marker => {
      const point = marker.getElement()?.querySelector('.marker-point');
      if (!point) return;
      const ripple = document.createElement('span');
      ripple.className = 'marker-ripple';
      ripple.setAttribute('aria-hidden','true');
      ripple.addEventListener('animationend',() => ripple.remove(),{once:true});
      point.append(ripple);
    }));
    playArrivalSound(arrivals);
  }

  const startLanguage = Object.hasOwn(LANGUAGES, window.DRONE_LANG) && await loadLanguage(window.DRONE_LANG) ? window.DRONE_LANG : 'en';
  configureLanguage(startLanguage);

  const map = L.map('map', {zoomControl:false, minZoom:3, maxZoom:16, scrollWheelZoom:true, zoomSnap:.25, worldCopyJump:true});
  const zoomControl = L.control.zoom({position:'topright'}).addTo(map);
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
        icon:markerIcon(event,position), alt:`${event.id}, ${event.title}`, recordId:event.id, recordDate:event.startDate,
        keyboard:true, riseOnHover:true
      });
      marker.bindTooltip('', {direction:'top',offset:[0,-10]});
      marker.on('click', () => selectEvent(event.id, false));
      return marker;
    }));
  });
  function labelMarkers() {
    events.forEach(event => markers.get(event.id).forEach((marker, index) => {
      const position = event.positions[index];
      const title = `${event.id} · ${event.title} · ${recordClassLabel(event.recordClass)} · ${categoryLabel(event.category)} · ${event.status} · ${t('marker.approxPosition')}`;
      const precision = position.precision === 'locality' ? 'tooltip.locality' : position.precision === 'offshore' ? 'tooltip.offshore' : 'tooltip.region';
      // Leaflet reads the title again whenever replay re-adds the marker.
      marker.options.title = title;
      marker.getElement()?.setAttribute('title', title);
      marker.setTooltipContent(`<strong lang="en">${escape(event.title)}</strong><small>${escape(event.id)} · ${escape(shortDate(event.startDate))} · ${escape(categoryLabel(event.category))}</small><small>${escape(recordClassLabel(event.recordClass))}</small><small lang="en">${escape(event.status)}</small><small>${escape(t(precision))}</small>`);
    }));
  }

  function fitEvents() {
    const points = visibleEvents.flatMap(e => e.positions.map(p => [p.lat,p.lng]));
    if (points.length) map.fitBounds(points, {...mapPadding(),maxZoom:8,animate:!reducedMotion});
  }

  function mapPadding() {
    return innerWidth <= 760
      ? {paddingTopLeft:[28,40],paddingBottomRight:[32,40]}
      : {paddingTopLeft:[70,85],paddingBottomRight:[70,125]};
  }

  // Images and video come from the linked reports (and a few matched extra
  // reports). Register-source media leads; video leads within each group.
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
  // Some channels forbid playback on other sites; those open on YouTube instead.
  function externalVideo(video) {
    return video?.kind === 'youtube' && video.embeddable === false && /^[\w-]{11}$/.test(video.id) ? `https://www.youtube.com/watch?v=${video.id}` : null;
  }
  function playableVideo(video) {
    if (!video || video.embeddable === false) return null;
    if (video.kind === 'youtube' && /^[\w-]{11}$/.test(video.id)) return {src:`https://www.youtube-nocookie.com/embed/${video.id}?autoplay=1&rel=0`, host:'youtube.com'};
    if (video.kind === 'vimeo' && /^\d+$/.test(video.id)) return {src:`https://player.vimeo.com/video/${video.id}?autoplay=1`, host:'vimeo.com'};
    if ((video.kind === 'file' || video.kind === 'embed') && /^https:\/\//.test(video.url || '')) {
      const url = new URL(video.url);
      // Embedded players (e.g. portrait reels) state their frame size in the URL.
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
      ? `<button class="media-stage media-play" data-media-play="${index}" aria-label="${escape(t('media.playFrom',{publisher:item.publisher}))}">${mediaImage(item)}${playIcon}</button>`
      : `<a class="media-stage${external ? ' media-play media-external' : ''}" href="${escape(external || item.url)}" target="_blank" rel="noopener noreferrer"${external ? ` aria-label="${escape(t('media.playFrom',{publisher:item.publisher}))} ↗"` : ''}>${mediaImage(item)}${external ? playIcon : ''}</a>`;
    const notes = [item.extra ? t('media.extra') : '', video ? t('media.loadsFrom',{host:video.host}) : ''].filter(Boolean);
    const isVideo = Boolean(video || external);
    const thumbs = items.length > 1 ? `<div class="media-thumbs">${items.map((thumb,i) => `<button class="media-thumb" data-media-index="${i}" aria-pressed="${i === index}" aria-label="${escape(t('media.show',{n:i + 1,total:items.length}))}">${mediaImage(thumb)}${playableVideo(thumb.video) || externalVideo(thumb.video) ? '<span class="media-thumb-play" aria-hidden="true"></span>' : ''}</button>`).join('')}</div>` : '';
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
      // Never interrupt a video that is already playing.
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
        player.title = t('media.video',{publisher:item.publisher});
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

  function renderList() {
    // Newest records first. Quiet days only change the date and highlights,
    // not the list's DOM.
    const recordKey = visibleEvents.map(event => event.id).join(',') + lang;
    if (renderedRecordKey !== recordKey) {
      let previousMonth = '';
      $('event-list').innerHTML = [...visibleEvents].reverse().map(event => {
        const month = event.startDate.slice(0,7);
        let heading = '';
        if (month !== previousMonth) {
          previousMonth = month;
          heading = `<h3 class="event-month">${escape(format.monthYear.format(utcDate(event.startDate)).toLocaleUpperCase(locale))}</h3>`;
        }
        const dayLabel = event.dateLabel === event.startDate ? shortDate(event.startDate) : `${shortDate(event.startDate)} · ${t('card.dateNotes')}`;
        const items = mediaFor(event);
        const hasVideo = items.some(item => playableVideo(item.video) || externalVideo(item.video));
        const badge = items.length ? `<span class="media-badge${hasVideo ? ' video' : ''}" title="${escape(t(hasVideo ? 'card.video' : 'card.photo'))}"><span class="sr-only">${escape(t(hasVideo ? 'card.video' : 'card.photo'))}</span></span>` : '';
        return `${heading}<button class="event-card${!allMode && event.startDate === dayToDate(currentDay) ? ' current' : ''}" id="card-${event.id}" data-id="${event.id}" data-date="${event.startDate}" style="--category:${colors[event.category]}" aria-pressed="${selectedId === event.id}"><span class="event-dot" aria-hidden="true"></span><span class="event-meta"><span>${escape(dayLabel)} · ${escape(countryName(event.countries.split(';')[0].replace(/ \(.+\)/,'')))}</span><span class="event-id">${badge}${event.id}</span></span><span class="event-title" lang="en">${escape(event.title)}</span>${event.recordClass !== 'event' ? `<span class="record-kind">${escape(recordClassLabel(event.recordClass))}</span>` : ''}<span class="event-type" lang="en">${escape(event.status)}</span></button>`;
      }).join('');
      renderedRecordKey = recordKey;
    }
    document.querySelectorAll('.event-card').forEach(card => {
      card.classList.toggle('current', !allMode && card.dataset.date === dayToDate(currentDay));
    });
    $('visible-count').textContent = t('list.visible',{visible:visibleEvents.length,total:events.length});
    $('list-title').textContent = allMode ? t('list.all') : t('list.through',{date:shortDate(dayToDate(currentDay))});
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
    document.querySelectorAll('.event-card').forEach(card => card.setAttribute('aria-pressed', String(card.dataset.id === selectedId)));
    visibleEvents.forEach(event => markers.get(event.id).forEach(marker => {
      const element = marker.getElement();
      element?.classList.toggle('selected', event.id === selectedId);
      element?.classList.toggle('today', !allMode && event.startDate === dayToDate(currentDay));
      marker.setZIndexOffset(event.id === selectedId ? 1000 : 0);
    }));
  }

  function sourceLinks(ids) {
    return ids.map(id => {
      const s = sources[id];
      if (!s || !/^https?:\/\//.test(s.url)) return '';
      return `<a class="source-link" href="${escape(s.url)}" target="_blank" rel="noopener noreferrer" lang="en"><strong>${escape(id)} · ${escape(s.publisher)} ↗</strong><span>${escape(s.title)}</span><small>${s.dateLabel ? escape(s.dateLabel) + ' · ' : ''}${escape(s.audit.replace(/\[([^\]]+)\]\[[^\]]+\]/g,'$1'))}</small></a>`;
    }).join('');
  }
  const DETAIL_FIELDS = ['dateLabel','recordType','endDate','dateBasis','location','categories','circumstances','vehicle','attribution','impact','response','uncertainty','route','payload','deduplication','provenance'];
  function fieldsHTML(event) {
    return DETAIL_FIELDS.filter(key => event[key]).map(key => `<dt>${escape(t(`field.${key}`))}</dt><dd lang="en">${escape(event[key])}</dd>`).join('');
  }
  function outcomeTags(event) {
    return `<div class="outcome-tags" aria-label="${escape(t('detail.stagesAria'))}">${event.stages.map((stage,index) => `<span style="--category:${colors[stage]}"${index === 0 ? ` title="${escape(t('detail.mapColorTitle'))}"` : ''}><i aria-hidden="true"></i>${escape(categoryLabel(stage))}${index === 0 ? ` · ${escape(t('detail.mapColor'))}` : ''}</span>`).join('')}</div>${event.classificationNote ? `<p class="classification-note" lang="en">${escape(event.classificationNote)}</p>` : ''}`;
  }
  function renderDetail(event) {
    const isRegional = event.positions.some(p => p.precision === 'region');
    const geoNote = [t(isRegional ? 'detail.geoRegion' : 'detail.geoLocal'), event.positions.length > 1 ? t('detail.geoTwoAnchors') : '', event.id === 'E058' ? t('detail.geoE058') : ''].filter(Boolean).join(' ');
    $('detail').innerHTML = `<div class="detail-head" style="--category:${colors[event.category]}"><p class="eyebrow">${event.id} · ${escape(shortDateYear(event.startDate))} / <span lang="en">${escape(event.countries)}</span></p><button class="close-detail" aria-label="${escape(t('detail.close'))}">×</button><h2 lang="en">${escape(event.title)}</h2><div class="detail-status" lang="en">${escape(event.status)}</div></div><div class="detail-scroll"><div class="detail-media"></div><section class="detail-sources"><h3>${escape(t('detail.sources',{n:event.sources.length}))}</h3>${sourceLinks(event.sources)}</section><section class="detail-record"><h3>${escape(t('detail.record'))}</h3>${lang !== 'en' ? `<p class="language-note">${escape(t('detail.originalLanguage'))}</p>` : ''}<p class="record-kind">${escape(recordClassLabel(event.recordClass))}</p>${outcomeTags(event)}<p class="position-note">${escape(geoNote)}${event.positionNote ? ` <span lang="en">${escape(event.positionNote)}</span>` : ''}</p><dl>${fieldsHTML(event)}</dl></section></div>`;
    $('detail').querySelector('.close-detail').addEventListener('click', () => closeDetail(true));
    renderMedia(event);
  }
  function selectEvent(id, focusMap = true) {
    const event = events.find(e => e.id === id);
    if (!event) throw new Error('Unknown event ID');
    pause();
    if (!visibleEvents.some(e => e.id === id)) { allMode = false; currentDay = dayOf(event.startDate); playbackDay = currentDay; render(); }
    selectedId = id;
    returnFocus = document.activeElement;
    $('detail').hidden = false;
    renderDetail(event);
    refreshSelection();
    const card = $(`card-${id}`);
    if (card) scrollListTo(card, reducedMotion ? 'auto' : 'smooth');
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
    $('announcer').textContent = t('detail.opened',{id:event.id,title:event.title,status:event.status});
  }
  function closeDetail(restoreFocus = false) {
    $('detail').hidden = true;
    // Removing the panel's content also stops any playing video.
    $('detail').replaceChildren();
    selectedId = null;
    refreshSelection();
    if (restoreFocus && returnFocus?.isConnected) returnFocus.focus({preventScroll:true});
  }

  // The sidebar scrolls as a whole, both on desktop and inside the phone sheet.
  function listScroller() {
    return getComputedStyle($('event-list')).overflowY === 'auto' ? $('event-list') : document.querySelector('.sidebar');
  }
  function scrollListTo(card, behavior) {
    const scroller = listScroller();
    const sticky = scroller === $('event-list') ? 34 : document.querySelector('.list-heading').offsetHeight + 34;
    const top = card.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - sticky;
    scroller.scrollTo({top, behavior});
  }

  // Trend: calendar months, the latest three (including the current, partial
  // month) against the three before. Counts derive from the generated data.
  const year = Number(cutoff.slice(0,4));
  const months = Array.from({length:Number(cutoff.slice(5,7))}, (_,i) => `${year}-${String(i + 1).padStart(2,'0')}`);
  const monthTotals = months.map(month => events.filter(event => event.startDate.startsWith(month)).length);
  const maxMonthTotal = Math.max(1, ...monthTotals);
  const recentStart = Math.max(0, months.length - 3);
  const previousStart = Math.max(0, months.length - 6);
  const sumMonths = (from, to) => monthTotals.slice(from, to).reduce((sum, count) => sum + count, 0);
  const recentTotal = sumMonths(recentStart, months.length);
  const previousTotal = sumMonths(previousStart, recentStart);
  const monthStart = index => new Date(Date.UTC(year, index, 1));
  const monthEnd = index => new Date(Date.UTC(year, index + 1, 0));
  const formatRange = (from, to) => format.short.formatRange ? format.short.formatRange(from, to) : `${format.short.format(from)} – ${format.short.format(to)}`;
  function renderTrend() {
    const change = previousTotal ? recentTotal / previousTotal - 1 : null;
    $('trend-delta').textContent = change === null ? '—' : format.delta.format(change);
    $('trend-delta').classList.toggle('up', change > 0);
    $('trend-delta').classList.toggle('down', change < 0);
    $('trend-compare').textContent = t('trend.compare',{recent:recentTotal, previous:previousTotal, recentRange:formatRange(monthStart(recentStart), utcDate(cutoff)), previousRange:formatRange(monthStart(previousStart), monthEnd(recentStart - 1))});
    $('trend-share').textContent = t('trend.share',{share:format.percent.format(recentTotal / events.length)});
    const partialMonth = cutoff !== monthEnd(months.length - 1).toISOString().slice(0,10);
    const monthLabel = index => format.monthLong.format(monthStart(index));
    // Short month names where they fit the columns; otherwise narrow initials.
    const shortMonths = months.map((_,i) => format.month.format(monthStart(i)).replace(/\.$/,''));
    const columnMonths = shortMonths.some(name => name.length > 4) ? months.map((_,i) => format.monthNarrow.format(monthStart(i))) : shortMonths;
    $('trend-chart').style.setProperty('--months', months.length);
    $('trend-chart').setAttribute('aria-label', t('trend.chartLabel',{list:format.list.format(months.map((_,i) => `${monthLabel(i)} ${format.number.format(monthTotals[i])}`))}));
    $('trend-chart').innerHTML = `<div class="trend-columns" aria-hidden="true">${months.map((_,i) => {
      const group = i >= recentStart ? 'recent' : i >= previousStart ? 'previous' : 'earlier';
      const title = t('trend.column',{month:monthLabel(i), n:monthTotals[i]}) + (partialMonth && i === months.length - 1 ? ` (${t('trend.partial',{date:shortDate(cutoff)})})` : '');
      return `<div class="trend-column ${group}" title="${escape(title)}"><span class="trend-value">${format.number.format(monthTotals[i])}</span><span class="trend-bar" style="--h:${monthTotals[i] / maxMonthTotal}"><span class="trend-fill"></span></span><span class="trend-month">${escape(columnMonths[i])}</span></div>`;
    }).join('')}</div><div class="trend-brackets" aria-hidden="true">${previousStart < recentStart ? `<span class="trend-bracket previous" style="grid-column:${previousStart + 1} / ${recentStart + 1}" title="${escape(t('trend.legendPrevious'))}">${format.number.format(previousTotal)}</span>` : ''}<span class="trend-bracket recent" style="grid-column:${recentStart + 1} / ${months.length + 1}" title="${escape(t('trend.legendRecent'))}">${format.number.format(recentTotal)}</span></div>`;
    renderTrendProgress();
  }
  function renderTrendProgress() {
    const visibleByMonth = new Map();
    visibleEvents.forEach(event => visibleByMonth.set(event.startDate.slice(0,7), (visibleByMonth.get(event.startDate.slice(0,7)) || 0) + 1));
    document.querySelectorAll('.trend-fill').forEach((fill, i) => {
      fill.style.height = monthTotals[i] ? `${(visibleByMonth.get(months[i]) || 0) / monthTotals[i] * 100}%` : '0';
    });
  }

  // Running total above the timeline, drawn on the same date axis as the
  // scrubber. The played part is colored; the rest stays as a gray preview.
  const runningTotals = [];
  for (let day = 0, running = 0; day <= totalDays; day++) runningTotals.push(running += dateCounts.get(dayToDate(day)) || 0);
  const CHART_WIDTH = 1000;
  const CHART_HEIGHT = 100;
  const chartX = day => day / totalDays * CHART_WIDTH;
  const chartY = count => CHART_HEIGHT - count / events.length * (CHART_HEIGHT - 6);
  function renderCumulative() {
    let line = `M0 ${chartY(runningTotals[0])}`;
    for (let day = 1; day <= totalDays; day++) {
      if (runningTotals[day] !== runningTotals[day - 1]) line += `H${chartX(day).toFixed(2)}V${chartY(runningTotals[day]).toFixed(2)}`;
    }
    line += `H${CHART_WIDTH}`;
    const area = `${line}V${CHART_HEIGHT}H0Z`;
    const windowDay = Math.max(0, dayOf(monthStart(recentStart).toISOString().slice(0,10)));
    const before = runningTotals[Math.max(0, windowDay - 1)];
    const point = (day, count) => `left:${chartX(day) / CHART_WIDTH * 100}%;bottom:${(CHART_HEIGHT - chartY(count)) / CHART_HEIGHT * 100}%`;
    $('cumulative').innerHTML = `<svg viewBox="0 0 ${CHART_WIDTH} ${CHART_HEIGHT}" preserveAspectRatio="none" aria-hidden="true"><defs><clipPath id="cumulative-progress"><rect id="cumulative-clip" x="0" y="0" width="${CHART_WIDTH}" height="${CHART_HEIGHT}"/></clipPath></defs><rect class="cumulative-window" x="${chartX(windowDay)}" y="0" width="${CHART_WIDTH - chartX(windowDay)}" height="${CHART_HEIGHT}"/><path class="cumulative-area ghost" d="${area}"/><path class="cumulative-line ghost" d="${line}" vector-effect="non-scaling-stroke"/><g clip-path="url(#cumulative-progress)"><path class="cumulative-area" d="${area}"/><path class="cumulative-line" d="${line}" vector-effect="non-scaling-stroke"/></g></svg><span class="cumulative-title">${escape(t('cumulative.title'))}</span><span class="cumulative-window-label" style="left:${chartX(windowDay) / CHART_WIDTH * 100}%">${escape(t('trend.legendRecent'))}</span><span class="cumulative-point" style="${point(windowDay, before)}"><span>${format.number.format(before)}</span></span><span class="cumulative-point end" style="${point(totalDays, events.length)}"><span>${format.number.format(events.length)}</span></span>`;
    $('cumulative').setAttribute('aria-label', t('cumulative.aria',{first:before, firstDate:shortDate(dayToDate(Math.max(0, windowDay - 1))), last:events.length, lastDate:shortDate(cutoff)}));
  }

  function render() {
    const date = dayToDate(currentDay);
    visibleEvents = allMode ? events : events.filter(e => e.startDate <= date);
    if (selectedId && !visibleEvents.some(e => e.id === selectedId)) closeDetail();
    renderList();
    renderMarkers();
    renderPlayhead();
    renderTrendProgress();
    $('timeline-range').setAttribute('aria-valuetext',t('timeline.valueText',{date:longDate(date), n:visibleEvents.length}));
    $('current-date').textContent = allMode ? t('timeline.allDates') : longDate(date);
    $('timeline-status').textContent = allMode ? t('timeline.statusAll',{n:events.length}) : `${t('timeline.visible',{n:visibleEvents.length})} · ${t('timeline.onDate',{n:dateCounts.get(date) || 0})}`;
    mobileLayout?.update($('timeline-status').textContent.split('·')[0].trim());
    $('map-period').textContent = allMode ? t('map.period',{start:shortDate(dayToDate(0)), end:shortDateYear(cutoff)}) : t('map.through',{date:shortDateYear(date)});
    $('show-all').setAttribute('aria-pressed',String(allMode));
    $('previous').disabled = currentDay <= eventDays[0];
    $('next').disabled = currentDay >= totalDays;
  }

  function renderPlayhead() {
    $('timeline-range').value = playbackDay;
    $('timeline-range').style.setProperty('--progress',`${playbackDay / totalDays * 100}%`);
    $('cumulative-clip')?.setAttribute('width', chartX(playbackDay));
  }
  function updatePlayButton() {
    $('play').setAttribute('aria-label',t(playing ? 'play.pause' : 'play.play'));
    $('play').setAttribute('aria-pressed',String(playing));
    $('play').innerHTML = playing ? `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h4v14H6zm8 0h4v14h-4z"/></svg><span>${escape(t('play.pauseLabel'))}</span>` : `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 11 7-11 7Z"/></svg><span>${escape(t('play.replayLabel'))}</span>`;
  }
  function updateSoundButton() {
    $('sound').setAttribute('aria-pressed',String(soundEnabled));
    $('sound').title = t(soundEnabled ? 'sound.mute' : 'sound.unmute');
    $('sound').querySelector('.sound-waves').toggleAttribute('hidden',!soundEnabled);
    $('sound').querySelector('.sound-muted').toggleAttribute('hidden',soundEnabled);
  }
  function pause(stopSound = true) {
    playing = false;
    cancelAnimationFrame(animationFrame);
    animationFrame = null;
    lastFrameTime = null;
    if (stopSound) stopChord();
    updatePlayButton();
  }
  function tick(timestamp) {
    if (!playing) return;
    const elapsed = lastFrameTime === null ? 0 : Math.max(0,(timestamp - lastFrameTime) / 1000);
    lastFrameTime = timestamp;
    playbackDay = Math.min(totalDays, playbackDay + elapsed * REPLAY_DAYS_PER_SECOND * Number($('speed').value));
    const nextDay = Math.floor(playbackDay);
    if (nextDay !== currentDay) {
      currentDay = nextDay;
      render();
      scrollToCurrent();
    } else {
      renderPlayhead();
    }
    if (currentDay >= totalDays) {
      pause(false);
      $('announcer').textContent = t('replay.complete',{n:events.length});
    } else {
      animationFrame = requestAnimationFrame(tick);
    }
  }
  // The newest records sit at the top of the list. Follow them while the
  // reader is in the list; otherwise leave the trend panel in view.
  function scrollToCurrent() {
    const scroller = listScroller();
    const listTop = scroller === $('event-list') ? 0 : $('event-list').getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - document.querySelector('.list-heading').offsetHeight;
    if (scroller.scrollTop > listTop) scroller.scrollTop = listTop;
  }
  function play() {
    const audioReady = prepareAudio();
    const waitingForAudio = audioContext?.state === 'suspended';
    closeDetail();
    if (allMode || currentDay >= totalDays) currentDay = playbackDay = 0;
    allMode = false;
    playing = true;
    render();
    if (playbackDay === 0) {
      revealEvents(visibleEvents);
      if (waitingForAudio) audioReady?.then(() => { if (playing && currentDay === 0) playArrivalSound(visibleEvents); });
    }
    fitEventsForReplay();
    scrollToCurrent();
    updatePlayButton();
    lastFrameTime = null;
    animationFrame = requestAnimationFrame(tick);
  }
  function fitEventsForReplay() {
    const allPoints = events.flatMap(e => e.positions.map(p => [p.lat,p.lng]));
    map.fitBounds(allPoints,{...mapPadding(),animate:!reducedMotion});
  }
  function setDay(day) {
    if (!Number.isInteger(day) || day < 0 || day > totalDays) throw new Error('Timeline day is outside the register');
    pause();
    document.querySelectorAll('.marker-ripple').forEach(ripple => ripple.remove());
    currentDay = day;
    playbackDay = day;
    allMode = false;
    render();
    scrollToCurrent();
  }
  function showAll() {
    pause();
    document.querySelectorAll('.marker-ripple').forEach(ripple => ripple.remove());
    closeDetail();
    allMode = true;
    currentDay = totalDays;
    playbackDay = totalDays;
    render();
    fitEvents();
    listScroller().scrollTop = 0;
  }

  const baseCount = events.filter(event => event.id.startsWith('E')).length;
  const eventCount = events.filter(event => event.recordClass === 'event').length;
  const candidateCount = events.filter(event => event.recordClass === 'candidate').length;
  const countryCount = new Set(events.flatMap(event => event.countries.split(';').map(country => country.replace(/ \(.+\)/,'').trim()))).size;
  function renderAbout() {
    const rows = [['about.statTotal',events.length], ['about.statBase',baseCount], ['about.statAdded',eventCount - baseCount], ['about.statCandidates',candidateCount], ['about.statContexts',contexts.length], ['about.statSources',Object.keys(sources).length], ['about.statCutoff',longDate(cutoff)]];
    $('register-summary').innerHTML = rows.map(([key,value]) => `<div><dt>${escape(t(key))}</dt><dd>${escape(typeof value === 'number' ? format.number.format(value) : value)}</dd></div>`).join('');
    $('about-replay').textContent = t('about.replay',{seconds:Math.round(totalDays / REPLAY_DAYS_PER_SECOND)});
    $('context-title').textContent = t('about.contextTitle',{n:contexts.length});
  }
  function renderLegend() {
    // Armed engagement shares the purple family, while each event's own label
    // distinguishes a shoot-down from a surface drone damaged by aircraft fire.
    $('map-legend').innerHTML = Object.keys(colors).filter(key => key !== 'engaged').map(key => `<span><i style="background:${colors[key]}"></i>${escape(key === 'shotdown' ? t('legend.shotdownEngaged') : categoryLabel(key))}</span>`).join('');
  }
  function renderMonthLabels() {
    const labels = document.querySelector('.month-labels');
    const shortNames = months.map((_,i) => format.month.format(monthStart(i)).replace(/\.$/,''));
    // Narrow initials when the shortest month gap cannot hold the longest name.
    const monthGap = labels.offsetWidth * 28 * DAY / (lastTime - firstTime);
    const names = monthGap && monthGap < Math.max(...shortNames.map(name => name.length)) * 7.5 + 8 ? months.map((_,i) => format.monthNarrow.format(monthStart(i))) : shortNames;
    labels.innerHTML = months.map((_,i) => {
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
    const zoomIn = zoomControl.getContainer().querySelector('.leaflet-control-zoom-in');
    const zoomOut = zoomControl.getContainer().querySelector('.leaflet-control-zoom-out');
    zoomIn.title = t('zoom.in'); zoomIn.setAttribute('aria-label', t('zoom.in'));
    zoomOut.title = t('zoom.out'); zoomOut.setAttribute('aria-label', t('zoom.out'));
  }
  // Everything language-dependent; used at startup and when switching.
  function localize() {
    applyStaticText();
    $('cutoff-label').textContent = shortDate(cutoff);
    renderLegend();
    renderMonthLabels();
    renderAbout();
    renderTrend();
    renderCumulative();
    labelMarkers();
    updatePlayButton();
    updateSoundButton();
    render();
    if (selectedId && !$('detail').hidden) renderDetail(events.find(event => event.id === selectedId));
    document.documentElement.removeAttribute('data-i18n-pending');
  }
  async function changeLanguage(code) {
    if (!Object.hasOwn(LANGUAGES, code) || code === lang) return;
    if (!(await loadLanguage(code))) { $('language').value = lang; return; }
    try { localStorage.setItem(LANGUAGE_KEY, code); } catch { /* The choice still applies to this visit. */ }
    const url = new URL(location.href);
    if (code === 'en') url.searchParams.delete('lang');
    else url.searchParams.set('lang', code);
    history.replaceState(history.state, '', url);
    configureLanguage(code);
    localize();
    $('announcer').textContent = LANGUAGES[code];
  }

  $('language').innerHTML = Object.entries(LANGUAGES).map(([code,name]) => `<option value="${code}" lang="${code}">${escape(name)}</option>`).join('');
  $('language').value = lang;
  $('language').addEventListener('change', event => changeLanguage(event.target.value));
  $('country-total').textContent = countryCount;
  $('record-total').textContent = events.length;
  $('timeline-range').max = totalDays;
  $('timeline-range').value = totalDays;
  $('context-records').innerHTML = contexts.map(c => `<details><summary><strong>${c.id}</strong> · ${escape(c.countries)}</summary><p class="context-meta">${escape(c.dateLabel)} · ${escape(c.status)}</p><p>${escape(c.vehicle)}</p>${c.attribution ? `<p>${escape(c.attribution)}</p>` : ''}<p>${escape(c.deduplication)}</p>${c.uncertainty ? `<p>${escape(c.uncertainty)}</p>` : ''}${sourceLinks(c.sources)}</details>`).join('');
  $('play').addEventListener('click',() => playing ? pause() : play());
  $('sound').addEventListener('click',() => {
    soundEnabled = !soundEnabled;
    updateSoundButton();
    if (audioOutput) audioOutput.gain.setTargetAtTime(soundEnabled ? REPLAY_VOLUME : 0,audioContext.currentTime,0.005);
    if (!soundEnabled) stopChord();
    if (soundEnabled && playing) prepareAudio();
  });
  $('timeline-range').addEventListener('input',event => setDay(Math.round(Number(event.target.value))));
  // The playhead moves continuously, while manual scrubbing snaps to dates.
  $('timeline-range').addEventListener('keydown',event => {
    const steps = {ArrowLeft:-1, ArrowDown:-1, ArrowRight:1, ArrowUp:1, PageDown:-7, PageUp:7};
    let day;
    if (Object.hasOwn(steps,event.key)) day = currentDay + steps[event.key];
    else if (event.key === 'Home') day = 0;
    else if (event.key === 'End') day = totalDays;
    else return;
    event.preventDefault();
    setDay(Math.max(0,Math.min(totalDays,day)));
  });
  $('previous').addEventListener('click',() => setDay([...eventDays].reverse().find(day => day < currentDay) ?? eventDays[0]));
  $('next').addEventListener('click',() => setDay(eventDays.find(day => day > currentDay) ?? totalDays));
  $('show-all').addEventListener('click',showAll);
  $('fit-map').addEventListener('click',() => { closeDetail(); fitEvents(); });
  $('event-list').addEventListener('click',event => { const card = event.target.closest('[data-id]'); if (card) selectEvent(card.dataset.id); });
  $('about-button').addEventListener('click',() => { pause(); $('about-dialog').showModal(); });
  $('trend-how').addEventListener('click',() => {
    pause();
    $('about-dialog').showModal();
    $('about-trend').scrollIntoView({block:'start'});
    $('about-trend').focus({preventScroll:true});
  });
  $('close-about').addEventListener('click',() => $('about-dialog').close());
  $('about-dialog').addEventListener('click',event => { if (event.target === $('about-dialog')) { const r = event.target.getBoundingClientRect(); if (event.clientX<r.left || event.clientX>r.right || event.clientY<r.top || event.clientY>r.bottom) event.target.close(); } });
  document.addEventListener('keydown',event => { if (event.key === 'Escape' && !$('detail').hidden) closeDetail(true); });
  document.addEventListener('visibilitychange',() => { if (document.hidden) pause(); });
  new ResizeObserver(() => map.invalidateSize()).observe($('map'));
  new ResizeObserver(renderMonthLabels).observe(document.querySelector('.timeline-track'));
  mobileLayout = window.createMobileLayout({pause, showAll, refit:() => {
    map.invalidateSize();
    if (!selectedId) fitEventsForReplay();
  }, t, total:events.length, countries:countryCount, year});
  localize();
  fitEvents();

  // Progressive enhancement for browsers that expose the page-scoped WebMCP API.
  const context = document.modelContext;
  if (context?.registerTool) {
    const lifecycle = new AbortController();
    const register = tool => {
      try { Promise.resolve(context.registerTool(tool,{signal:lifecycle.signal})).catch(() => {}); } catch { /* Optional browser API. */ }
    };
    register({name:'navigate_drone_event',title:'Open an event',description:'Select a register record, reveal it on the map and open its source-backed details. Pauses replay.',inputSchema:{type:'object',properties:{id:{type:'string',pattern:'^[EN]\\d{3}$'}},required:['id'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:true},execute(input){if (!input || typeof input.id !== 'string' || !events.some(e => e.id === input.id)) throw new Error('Supply a valid E-series or N-series record ID from the register.');selectEvent(input.id);return {selectedId,visibleRecords:visibleEvents.length};}});
    register({name:'set_drone_timeline_date',title:'Set the timeline date',description:'Pause playback and show records through a calendar date in the 2026 register.',inputSchema:{type:'object',properties:{date:{type:'string',format:'date'}},required:['date'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:false},execute(input){if (!input || typeof input.date !== 'string' || !/^2026-\d{2}-\d{2}$/.test(input.date)) throw new Error('Supply a 2026 date in YYYY-MM-DD form.');const day = (dateValue(input.date)-firstTime)/DAY;if (!Number.isInteger(day) || day < 0 || day > totalDays || dayToDate(day) !== input.date) throw new Error(`Date must be between ${dayToDate(0)} and ${cutoff}.`);setDay(day);return {date:dayToDate(currentDay),visibleRecords:visibleEvents.length};}});
    register({name:'set_interface_language',title:'Set the interface language',description:'Switch the interface to one of the 24 official EU languages. Record fields stay in English.',inputSchema:{type:'object',properties:{language:{type:'string',enum:Object.keys(LANGUAGES)}},required:['language'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:false},async execute(input){if (!input || !Object.hasOwn(LANGUAGES,input.language)) throw new Error('Supply an EU language code such as de, fr or ro.');$('language').value = input.language;await changeLanguage(input.language);return {language:lang};}});
    window.addEventListener('pagehide',() => lifecycle.abort(),{once:true});
  }
})();
