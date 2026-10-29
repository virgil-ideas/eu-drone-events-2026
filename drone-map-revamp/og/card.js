'use strict';
// Fills the social preview card from the register's data. og/render.py waits
// for body[data-ready] before taking the screenshot and refuses to publish a
// card whose fonts did not load.
(async () => {
  const {events, cutoff} = window.DRONE_DATA;
  const pages = window.DRONE_PAGES || {};
  const strings = window.DRONE_I18N.en;
  const t = (key, values = {}) => strings[key].replace(/\{(\w+)\}/g, (_, name) => values[name]);
  const $ = id => document.getElementById(id);
  const number = new Intl.NumberFormat('en-GB');
  const delta = new Intl.NumberFormat('en-GB', {style:'percent', maximumFractionDigits:0, signDisplay:'exceptZero'});
  const shortDate = new Intl.DateTimeFormat('en-GB', {day:'numeric', month:'short', timeZone:'UTC'});
  const longDate = new Intl.DateTimeFormat('en-GB', {day:'numeric', month:'short', year:'numeric', timeZone:'UTC'});
  const day = iso => new Date(iso + 'T00:00:00Z');
  const countriesOf = event => event.countries.split(';').map(c => c.replace(/ \(.+\)/, '').trim()).filter(Boolean);

  $('brand-title').innerHTML = `${strings['brand.primary']} <span>${strings['brand.secondary']}</span>`;
  $('edition').textContent = strings.edition;

  // The same rolling comparison as the trend pill on the map.
  const comparison = window.DRONE_TREND.rollingComparison(events, cutoff);
  if (comparison.change === null) {
    $('delta').classList.add('flat');
    $('delta-value').textContent = number.format(comparison.recentTotal);
    $('delta-label').textContent = t('trend.legendRecent');
    $('compare').innerHTML = '';
  } else {
    $('delta').classList.toggle('down', comparison.change < 0);
    $('delta').classList.toggle('flat', comparison.change === 0);
    $('delta-value').textContent = delta.format(comparison.change);
    $('delta-label').textContent = t('trend.deltaLabel');
    const range = (from, to) => shortDate.formatRange(day(from), day(to));
    // The coral dot doubles as the map legend: coral markers are the last 90 days.
    $('compare').innerHTML = t('trend.compare', {
      recent: '<i class="dot"></i>' + number.format(comparison.recentTotal),
      recentRange: range(comparison.recentStart, comparison.recentEnd),
      previous: number.format(comparison.previousTotal),
      previousRange: range(comparison.previousStart, comparison.previousEnd)
    });
  }

  // The map lists records oldest to newest and shows the last one first.
  const latest = events[events.length - 1];
  const latestTags = [longDate.format(day(latest.startDate)), countriesOf(latest).join(' / ')];
  if (latest.recordClass === 'candidate') latestTags.push(t('class.candidate'));
  $('latest-label').innerHTML = `<i>Latest</i> · ${latestTags.map(escapeHtml).join(' · ')}`;
  $('latest-headline').textContent = (pages[latest.id] || {}).headline || latest.title;

  const countryCount = new Set(events.flatMap(countriesOf)).size;
  const sep = '<span class="sep">·</span>';
  $('stats').innerHTML = [
    `<b>${number.format(events.length)}</b> ${strings['stats.records']}`,
    `<b>${number.format(countryCount)}</b> ${strings['stats.countries']}`,
    `${strings['stats.cutoff']} <b>${longDate.format(day(cutoff))}</b>`
  ].join(sep);
  $('honesty').textContent = strings['sidebar.foot'];

  try {
    await Promise.all(['800 148px Manrope', '700 23px "DM Sans"', '600 29px "DM Sans"', '500 27px "DM Sans"', '400 19px "DM Sans"']
      .map(font => document.fonts.load(font)));
  } catch (error) {
    // Reported through data-fonts below.
  }
  document.body.dataset.fonts = document.fonts.check('800 148px Manrope') && document.fonts.check('600 29px "DM Sans"') ? 'ok' : 'missing';
  // After the fonts, so map labels measure at their final width.
  drawMap(comparison, latest);
  document.body.dataset.ready = '1';

  function drawMap(comparison, newest) {
    const svg = $('map');
    const W = 452, H = 630, pad = 24;
    const mercY = lat => Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360));
    // Fit the records within the video recorder's limits, with tighter margins.
    const positions = events.flatMap(event => event.positions);
    const lats = positions.map(p => p.lat), lngs = positions.map(p => p.lng);
    const minLat = Math.max(34, Math.min(...lats) - 1.2), maxLat = Math.min(66, Math.max(...lats) + 1.2);
    const minLng = Math.max(8, Math.min(...lngs) - 2), maxLng = Math.min(38, Math.max(...lngs) + 2);
    const spanX = (maxLng - minLng) * Math.PI / 180, spanY = mercY(maxLat) - mercY(minLat);
    const scale = Math.min((W - 2 * pad) / spanX, (H - 2 * pad) / spanY);
    const offsetX = (W - spanX * scale) / 2, offsetY = (H - spanY * scale) / 2;
    const project = (lat, lng) => [
      offsetX + (lng - minLng) * Math.PI / 180 * scale,
      offsetY + (mercY(maxLat) - mercY(lat)) * scale
    ];
    const parts = [];
    for (let lng = Math.ceil(minLng / 5) * 5 - 20; lng <= maxLng + 20; lng += 5) {
      const [x] = project(0, lng);
      parts.push(`<line class="grid" x1="${x.toFixed(1)}" y1="0" x2="${x.toFixed(1)}" y2="${H}"/>`);
    }
    for (let lat = 30; lat <= 70; lat += 5) {
      const [, y] = project(lat, 0);
      parts.push(`<line class="grid" x1="0" y1="${y.toFixed(1)}" x2="${W}" y2="${y.toFixed(1)}"/>`);
    }
    for (const line of window.DRONE_GEO.lines) {
      const points = line.map(([lat, lng]) => project(lat, lng).map(v => v.toFixed(1)).join(',')).join(' ');
      parts.push(`<polyline class="coast" points="${points}"/>`);
    }
    for (const label of window.DRONE_GEO.labels) {
      const [x, y] = project(label.lat, label.lng);
      const text = label.key ? strings[label.key] : label.country;
      parts.push(`<text class="label${label.sea ? ' sea' : ''}" x="${x.toFixed(1)}" y="${y.toFixed(1)}">${escapeHtml(label.sea ? text : text.toUpperCase())}</text>`);
    }
    // Coloured like the trend pill: the last 90 days in coral on top of the earlier records.
    const recent = event => window.DRONE_TREND.windowForDate(event.startDate, comparison) === 'recent';
    const ordered = [...events.filter(event => !recent(event)), ...events.filter(recent)];
    for (const event of ordered) {
      const isRecent = recent(event);
      for (const position of event.positions) {
        const [x, y] = project(position.lat, position.lng);
        parts.push(`<circle class="${isRecent ? 'recent' : 'earlier'}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${isRecent ? 6.5 : 4.5}"/>`);
      }
    }
    for (const position of newest.positions) {
      const [x, y] = project(position.lat, position.lng);
      parts.push(`<circle class="newest" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="15"/>`);
    }
    svg.innerHTML = parts.join('');
    // Keep labels near the panel's right edge inside it.
    for (const label of svg.querySelectorAll('.label')) {
      const overflow = label.getBBox().x + label.getBBox().width - (W - 14);
      if (overflow > 0) label.setAttribute('x', (Number(label.getAttribute('x')) - overflow).toFixed(1));
    }
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"]/g, char => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;'}[char]));
  }
})().catch(error => {
  document.body.dataset.error = error && error.message || String(error);
  document.body.dataset.ready = '1';
});
