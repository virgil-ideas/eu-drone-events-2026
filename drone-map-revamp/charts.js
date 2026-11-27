'use strict';
// Charts for "Charts & figures". Each builder returns a scene: shapes in a fixed
// coordinate space, laid out for one width. The page draws the scene as SVG; the
// PNG download draws the same scene onto a canvas, so the image matches the page
// and keeps the site's fonts. Share cards are drawn straight onto a canvas.
(() => {
  const FONT = '"DM Sans", system-ui, -apple-system, sans-serif';
  const DISPLAY = 'Manrope, "DM Sans", system-ui, sans-serif';
  const C = {
    ink: '#112228', muted: '#5a6d74', faint: '#8a9a9f', grid: '#e3e9eb', rule: '#cfd8db',
    empty: '#eef2f3', surface: '#ffffff', teal: '#1e827b', dim: '#b8c6ca',
    impact: '#c42b1c', quiet: '#6d9bcf',
    // Calendar steps for 1, 2, 3 and 4+ records a day (one hue, checked for contrast).
    ramp: ['#7fbdb6', '#479f97', '#1f7a74', '#0f514b']
  };
  const f = value => Math.round(value * 10) / 10;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  // Text width, measured with the page's fonts when a canvas exists (Node falls back).
  let measureContext = null;
  function measure(text, size = 12, weight = 400, family = FONT) {
    if (typeof document !== 'undefined') {
      measureContext ||= document.createElement('canvas').getContext('2d');
      measureContext.font = `${weight} ${size}px ${family}`;
      return measureContext.measureText(String(text)).width;
    }
    return String(text).length * size * 0.56;
  }

  function fit(text, size, weight, maxWidth) {
    text = String(text);
    if (measure(text, size, weight) <= maxWidth) return text;
    while (text.length > 1 && measure(`${text}…`, size, weight) > maxWidth) text = text.slice(0, -1);
    return `${text.trimEnd()}…`;
  }

  function wrap(text, size, weight, maxWidth, family = FONT) {
    const lines = [];
    let line = '';
    for (const word of String(text).split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (line && measure(next, size, weight, family) > maxWidth) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    if (line) lines.push(line);
    return lines;
  }

  // Columns and bars: 4px rounded data end, square at the baseline.
  function columnPath(x, y, w, h, r = 4) {
    if (h <= 0 || w <= 0) return '';
    r = Math.min(r, h, w / 2);
    return `M${f(x)} ${f(y + h)}V${f(y + r)}Q${f(x)} ${f(y)} ${f(x + r)} ${f(y)}H${f(x + w - r)}Q${f(x + w)} ${f(y)} ${f(x + w)} ${f(y + r)}V${f(y + h)}Z`;
  }
  function barPath(x, y, w, h, r = 4) {
    if (h <= 0 || w <= 0) return '';
    r = Math.min(r, w, h / 2);
    return `M${f(x)} ${f(y)}H${f(x + w - r)}Q${f(x + w)} ${f(y)} ${f(x + w)} ${f(y + r)}V${f(y + h - r)}Q${f(x + w)} ${f(y + h)} ${f(x + w - r)} ${f(y + h)}H${f(x)}Z`;
  }
  function rectPath(x, y, w, h, r = 0) {
    if (!r) return `M${f(x)} ${f(y)}h${f(w)}v${f(h)}h${f(-w)}Z`;
    r = Math.min(r, w / 2, h / 2);
    return `M${f(x + r)} ${f(y)}H${f(x + w - r)}Q${f(x + w)} ${f(y)} ${f(x + w)} ${f(y + r)}V${f(y + h - r)}Q${f(x + w)} ${f(y + h)} ${f(x + w - r)} ${f(y + h)}H${f(x + r)}Q${f(x)} ${f(y + h)} ${f(x)} ${f(y + h - r)}V${f(y + r)}Q${f(x)} ${f(y)} ${f(x + r)} ${f(y)}Z`;
  }

  const text = (x, y, value, options = {}) => ({type: 'text', x, y, text: String(value), size: 12, weight: 400, fill: C.ink, anchor: 'start', ...options});
  const hit = (x, y, w, h, tip, data = {}) => ({type: 'path', d: rectPath(x, y, w, h), fill: 'transparent', hit: true, tip, data});

  // ---- Builders -----------------------------------------------------------

  // Stacked columns, one per item. Every column total sits on its cap.
  function columns({width, height = 250, items, max, valueText = String}) {
    const top = 24, bottom = 28, side = 2;
    const plotH = height - top - bottom;
    const base = top + plotH;
    const band = (width - side * 2) / Math.max(1, items.length);
    const barW = Math.min(24, band * 0.62);
    const scale = plotH / Math.max(1, max ?? Math.max(...items.map(item => item.total)));
    const labelSize = band < 30 ? 10.5 : 11.5;
    const shapes = [{type: 'line', x1: 0, y1: f(base) + 0.5, x2: width, y2: f(base) + 0.5, stroke: C.rule, width: 1}];
    items.forEach((item, i) => {
      const x = side + band * i + (band - barW) / 2;
      let y = base;
      const drawn = item.segments.filter(segment => segment.value > 0);
      drawn.forEach((segment, j) => {
        const h = segment.value * scale;
        const gap = j ? 2 : 0;
        const isTop = j === drawn.length - 1;
        const d = isTop ? columnPath(x, y - h + gap, barW, h - gap) : rectPath(x, y - h + gap, barW, h - gap);
        if (h - gap > 0) shapes.push({type: 'path', d, fill: segment.color, opacity: item.dim ? 0.35 : 1});
        y -= h;
      });
      if (item.total) shapes.push(text(x + barW / 2, y - 7, valueText(item.total), {size: labelSize + 0.5, weight: 600, anchor: 'middle'}));
      shapes.push(text(x + barW / 2, height - 9, item.label, {size: labelSize, fill: C.muted, anchor: 'middle'}));
      shapes.push(hit(side + band * i, 0, band, height, item.tip, item.data));
    });
    return {width, height, shapes};
  }

  // One small column chart per row, all on the same scale.
  function smallMultiples({width, rows, firstLabel, lastLabel, max, tipFor}) {
    const cols = width >= 820 ? 5 : width >= 600 ? 4 : width >= 400 ? 3 : 2;
    const gapX = width >= 600 ? 26 : 16, gapY = 22, cellH = 104;
    const cellW = (width - gapX * (cols - 1)) / cols;
    const scaleMax = Math.max(1, max ?? Math.max(...rows.flatMap(row => row.values)));
    const shapes = [];
    rows.forEach((row, index) => {
      const cx = (index % cols) * (cellW + gapX);
      const cy = Math.floor(index / cols) * (cellH + gapY);
      const totalWidth = measure(row.totalText, 16, 700);
      shapes.push(text(cx, cy + 15, fit(row.label, 12.5, 600, cellW - totalWidth - 8), {size: 12.5, weight: 600, fill: row.dim ? C.faint : C.ink}));
      shapes.push(text(cx + cellW, cy + 16, row.totalText, {size: 16, weight: 700, anchor: 'end', fill: row.dim ? C.faint : C.ink}));
      const plotTop = cy + 28, plotH = cellH - 28 - 20, base = plotTop + plotH;
      const band = cellW / row.values.length;
      const barW = Math.max(2, Math.min(10, band * 0.66));
      row.values.forEach((value, i) => {
        const h = value / scaleMax * plotH;
        const x = cx + band * i + (band - barW) / 2;
        if (value) shapes.push({type: 'path', d: columnPath(x, base - Math.max(h, 1.5), barW, Math.max(h, 1.5), 2), fill: row.dim ? C.dim : C.teal});
        shapes.push(hit(cx + band * i, plotTop - 4, band, plotH + 8, tipFor(row, i), row.data?.(i) || {}));
      });
      shapes.push({type: 'line', x1: f(cx), y1: f(base) + 0.5, x2: f(cx + cellW), y2: f(base) + 0.5, stroke: C.rule, width: 1});
      shapes.push(text(cx, base + 14, firstLabel, {size: 10.5, fill: C.faint}));
      shapes.push(text(cx + cellW, base + 14, lastLabel, {size: 10.5, fill: C.faint, anchor: 'end'}));
    });
    const rowCount = Math.ceil(rows.length / cols);
    return {width, height: rowCount * cellH + (rowCount - 1) * gapY, shapes};
  }

  // Ranked horizontal bars with the value at the tip. A dot beside a label links
  // it to the map's marker colour.
  function rankedBars({width, rows, max, color = C.teal}) {
    const rowH = 32, thickness = 14, dotSpace = rows.some(row => row.dot) ? 16 : 0;
    const longest = Math.max(...rows.map(row => measure(row.label, 13, 500)));
    const labelW = Math.min(width * 0.46, longest + dotSpace + 4);
    const valueW = Math.max(...rows.map(row => measure(row.valueText, 12.5, 600))) + 10;
    const x0 = labelW + 12, span = Math.max(40, width - x0 - valueW);
    const scaleMax = Math.max(1, max ?? Math.max(...rows.map(row => row.value)));
    const shapes = [];
    rows.forEach((row, i) => {
      const y = i * rowH + 4;
      const mid = y + rowH / 2;
      if (row.dot) shapes.push({type: 'circle', cx: 5, cy: mid, r: 4.5, fill: row.dot});
      shapes.push(text(dotSpace, mid + 4.5, fit(row.label, 13, 500, labelW - dotSpace), {size: 13, weight: 500}));
      const w = row.value / scaleMax * span;
      if (row.value) shapes.push({type: 'path', d: barPath(x0, mid - thickness / 2, Math.max(w, 2), thickness), fill: color});
      shapes.push(text(x0 + Math.max(w, 2) + 7, mid + 4.5, row.valueText, {size: 12.5, weight: 600}));
      shapes.push(hit(0, y, width, rowH, row.tip, row.data || {}));
    });
    return {width, height: rows.length * rowH + 8, shapes};
  }

  // A small calendar per month; each day shaded by its number of records.
  function calendar({width, days, monthLabel, tipFor}) {
    const months = [];
    for (const day of days) {
      const key = day.date.slice(0, 7);
      if (months.at(-1)?.key !== key) months.push({key, days: []});
      months.at(-1).days.push(day);
    }
    const cols = width >= 1000 ? 6 : width >= 700 ? 4 : width >= 470 ? 3 : 2;
    const gapM = width >= 700 ? 28 : 18;
    const blockW = (width - gapM * (cols - 1)) / cols;
    const step = Math.max(12, Math.min(25, Math.floor(blockW / 7)));
    const cell = step - 3;
    const blockH = 22 + step * 6;
    const shapes = [];
    months.forEach((month, index) => {
      const bx = (index % cols) * (blockW + gapM);
      const by = Math.floor(index / cols) * (blockH + 16);
      shapes.push(text(bx, by + 13, monthLabel(month.key), {size: 12.5, weight: 600}));
      const [year, number] = month.key.split('-').map(Number);
      const offset = (new Date(Date.UTC(year, number - 1, 1)).getUTCDay() + 6) % 7;
      for (const day of month.days) {
        const position = offset + Number(day.date.slice(8)) - 1;
        const x = bx + (position % 7) * step;
        const y = by + 22 + Math.floor(position / 7) * step;
        const fill = day.n ? C.ramp[Math.min(day.n, 4) - 1] : C.empty;
        shapes.push({type: 'path', d: rectPath(x, y, cell, cell, 3), fill, hit: Boolean(day.n), tip: tipFor(day), data: day.n ? {day: day.date} : {}});
      }
    });
    const rowCount = Math.ceil(months.length / cols);
    return {width, height: rowCount * blockH + (rowCount - 1) * 16, shapes};
  }

  // One row per vessel along a shared date axis, oldest first, so a cluster of
  // incidents reads as a steep run of rows.
  function shipRows({width, items, start, end, ticks}) {
    const rowH = 27, top = 26;
    const nameW = Math.max(...items.map(item => measure(item.name, 12.5, 600)));
    const codeW = Math.max(...items.map(item => measure(item.code, 11, 600)));
    const labelW = Math.min(width * 0.42, nameW + codeW + 14);
    const x0 = labelW + 18, x1 = width - 54;
    const startTime = Date.parse(start), span = Math.max(1, Date.parse(end) - startTime);
    const x = date => x0 + (Date.parse(date) - startTime) / span * (x1 - x0);
    const bottom = top + 6 + items.length * rowH;
    const shapes = [];
    // Skip date ticks whose labels would touch the previous one on narrow screens.
    let lastRight = -Infinity;
    for (const tick of ticks) {
      const half = measure(tick.text, 11) / 2;
      if (x(tick.date) - half < lastRight + 10) continue;
      lastRight = x(tick.date) + half;
      shapes.push({type: 'line', x1: f(x(tick.date)) + 0.5, y1: top - 4, x2: f(x(tick.date)) + 0.5, y2: bottom, stroke: C.grid, width: 1});
      shapes.push(text(x(tick.date), 12, tick.text, {size: 11, fill: C.muted, anchor: 'middle'}));
    }
    items.forEach((item, i) => {
      const mid = top + 6 + i * rowH + rowH / 2;
      shapes.push(text(0, mid + 4.5, fit(item.name, 12.5, 600, labelW - codeW - 10), {size: 12.5, weight: 600}));
      shapes.push(text(labelW, mid + 4, item.code, {size: 11, weight: 600, fill: C.faint, anchor: 'end'}));
      const cx = x(item.date);
      if (item.casualties) shapes.push({type: 'circle', cx, cy: mid, r: 10.5, fill: C.surface, stroke: C.ink, width: 1.5});
      shapes.push({type: 'circle', cx, cy: mid, r: 8, fill: C.surface});
      shapes.push(item.confirmed
        ? {type: 'circle', cx, cy: mid, r: 6, fill: C.impact}
        : {type: 'circle', cx, cy: mid, r: 5, fill: C.surface, stroke: C.impact, width: 2});
      shapes.push(text(cx + 15, mid + 4, item.dateText, {size: 11, fill: C.muted}));
      shapes.push(hit(0, mid - rowH / 2, width, rowH, item.tip, {event: item.id}));
    });
    return {width, height: bottom + 4, shapes};
  }

  // ---- Renderers ----------------------------------------------------------

  function shapeSVG(shape) {
    const data = Object.entries(shape.data || {}).map(([key, value]) => ` data-${key}="${esc(value)}"`).join('');
    const tip = shape.tip ? ` data-tip="${esc(shape.tip)}"` : '';
    const cls = shape.hit ? ' class="hit"' : '';
    if (shape.type === 'path') {
      return `<path d="${shape.d}" fill="${shape.fill || 'none'}"${shape.opacity != null && shape.opacity !== 1 ? ` opacity="${shape.opacity}"` : ''}${shape.stroke ? ` stroke="${shape.stroke}" stroke-width="${shape.width || 1}"` : ''}${cls}${tip}${data}/>`;
    }
    if (shape.type === 'circle') {
      return `<circle cx="${f(shape.cx)}" cy="${f(shape.cy)}" r="${shape.r}" fill="${shape.fill || 'none'}"${shape.stroke ? ` stroke="${shape.stroke}" stroke-width="${shape.width || 1}"` : ''}${cls}${tip}${data}/>`;
    }
    if (shape.type === 'line') {
      return `<line x1="${f(shape.x1)}" y1="${f(shape.y1)}" x2="${f(shape.x2)}" y2="${f(shape.y2)}" stroke="${shape.stroke}" stroke-width="${shape.width || 1}"/>`;
    }
    if (shape.type === 'text') {
      const anchor = shape.anchor === 'start' ? '' : ` text-anchor="${shape.anchor}"`;
      return `<text x="${f(shape.x)}" y="${f(shape.y)}" font-size="${shape.size}" font-weight="${shape.weight}" fill="${shape.fill}"${anchor}>${esc(shape.text)}</text>`;
    }
    if (shape.type === 'group') return `<g transform="translate(${f(shape.x)} ${f(shape.y)})">${shape.shapes.map(shapeSVG).join('')}</g>`;
    return '';
  }

  function toSVG(scene, label = '') {
    return `<svg viewBox="0 0 ${f(scene.width)} ${f(scene.height)}" width="${f(scene.width)}" height="${f(scene.height)}" role="img" aria-label="${esc(label)}" font-family='${FONT}'>${scene.shapes.map(shapeSVG).join('')}</svg>`;
  }

  function drawShape(ctx, shape) {
    if (shape.hit && shape.fill === 'transparent') return;
    ctx.save();
    if (shape.opacity != null) ctx.globalAlpha = shape.opacity;
    if (shape.type === 'path') {
      const path = new Path2D(shape.d);
      if (shape.fill && shape.fill !== 'none') { ctx.fillStyle = shape.fill; ctx.fill(path); }
      if (shape.stroke) { ctx.strokeStyle = shape.stroke; ctx.lineWidth = shape.width || 1; ctx.stroke(path); }
    } else if (shape.type === 'circle') {
      ctx.beginPath();
      ctx.arc(shape.cx, shape.cy, shape.r, 0, Math.PI * 2);
      if (shape.fill && shape.fill !== 'none') { ctx.fillStyle = shape.fill; ctx.fill(); }
      if (shape.stroke) { ctx.strokeStyle = shape.stroke; ctx.lineWidth = shape.width || 1; ctx.stroke(); }
    } else if (shape.type === 'line') {
      ctx.beginPath();
      ctx.moveTo(shape.x1, shape.y1);
      ctx.lineTo(shape.x2, shape.y2);
      ctx.strokeStyle = shape.stroke;
      ctx.lineWidth = shape.width || 1;
      ctx.stroke();
    } else if (shape.type === 'text') {
      ctx.font = `${shape.weight} ${shape.size}px ${shape.family || FONT}`;
      ctx.fillStyle = shape.fill;
      ctx.textAlign = shape.anchor === 'middle' ? 'center' : shape.anchor === 'end' ? 'right' : 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(shape.text, shape.x, shape.y);
    } else if (shape.type === 'group') {
      ctx.translate(shape.x, shape.y);
      shape.shapes.forEach(child => drawShape(ctx, child));
    }
    ctx.restore();
  }

  async function fontsReady() {
    if (typeof document === 'undefined' || !document.fonts) return;
    await Promise.all(['400 16px "DM Sans"', '500 16px "DM Sans"', '600 16px "DM Sans"', '700 16px "DM Sans"', '800 64px Manrope']
      .map(font => document.fonts.load(font).catch(() => [])));
  }

  // A chart as a stand-alone image: title, takeaway, legend, chart, notes and credit.
  async function chartImage(scene, {title, subtitle = '', legend = [], notes = [], credit = ''}, scale = 2) {
    await fontsReady();
    const pad = 48, inner = scene.width;
    const titleLines = wrap(title, 30, 700, inner);
    const subtitleLines = subtitle ? wrap(subtitle, 17, 400, inner) : [];
    const noteLines = notes.flatMap(note => wrap(note, 13, 400, inner));
    const header = 6 + titleLines.length * 36 + (subtitleLines.length ? 8 + subtitleLines.length * 24 : 0) + (legend.length ? 36 : 0) + 22;
    const footer = 22 + noteLines.length * 19 + 34;
    const width = inner + pad * 2, height = pad + header + scene.height + footer + pad - 28;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);
    ctx.fillStyle = C.surface;
    ctx.fillRect(0, 0, width, height);
    let y = pad + 26;
    for (const line of titleLines) { drawShape(ctx, text(pad, y, line, {size: 30, weight: 700})); y += 36; }
    if (subtitleLines.length) {
      y += 4;
      for (const line of subtitleLines) { drawShape(ctx, text(pad, y, line, {size: 17, fill: C.muted})); y += 24; }
    }
    if (legend.length) {
      y += 14;
      let x = pad;
      for (const item of legend) {
        drawLegendKey(ctx, item, x, y - 5);
        drawShape(ctx, text(x + 18, y, item.label, {size: 14, fill: C.ink}));
        x += 18 + measure(item.label, 14) + 22;
      }
      y += 8;
    }
    y = pad + header;
    drawShape(ctx, {type: 'group', x: pad, y, shapes: scene.shapes});
    y += scene.height + 30;
    for (const line of noteLines) { drawShape(ctx, text(pad, y, line, {size: 13, fill: C.muted})); y += 19; }
    y += 14;
    drawShape(ctx, {type: 'line', x1: pad, y1: y - 22, x2: pad + inner, y2: y - 22, stroke: C.grid, width: 1});
    drawShape(ctx, text(pad, y, credit, {size: 14, weight: 600}));
    return canvas;
  }

  function drawLegendKey(ctx, item, x, cy) {
    if (item.kind === 'ring') drawShape(ctx, {type: 'circle', cx: x + 6, cy, r: 5, fill: C.surface, stroke: item.color, width: 2});
    else if (item.kind === 'halo') {
      drawShape(ctx, {type: 'circle', cx: x + 6, cy, r: 7, fill: C.surface, stroke: C.ink, width: 1.5});
      drawShape(ctx, {type: 'circle', cx: x + 6, cy, r: 4, fill: item.color});
    } else if (item.kind === 'dot') drawShape(ctx, {type: 'circle', cx: x + 6, cy, r: 5.5, fill: item.color});
    else drawShape(ctx, {type: 'path', d: rectPath(x, cy - 6, 12, 12, 3), fill: item.color});
  }

  // ---- Share cards --------------------------------------------------------

  const CARD = {bg: '#112228', panel: '#17303a', line: '#2c4a53', text: '#ffffff', soft: '#d2e1e4', muted: '#8fa9af', teal: '#9cd0cb', coral: '#ff8b7e', quiet: '#6d9bcf', bar: '#335560'};
  const CARD_SIZES = {square: [1080, 1080], story: [1080, 1920]};

  function cardText(ctx, value, x, y, {size, weight = 400, color = CARD.text, align = 'left', family = FONT, spacing = 0}) {
    ctx.font = `${weight} ${size}px ${family}`;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.textBaseline = 'alphabetic';
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${spacing}px`;
    ctx.fillText(value, x, y);
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  }

  function drawBrand(ctx, x, y, label) {
    ctx.save();
    ctx.strokeStyle = CARD.teal;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x + 22, y, 15, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + 22, y - 21); ctx.lineTo(x + 22, y + 21); ctx.moveTo(x + 1, y); ctx.lineTo(x + 43, y); ctx.stroke();
    ctx.fillStyle = CARD.coral;
    ctx.beginPath(); ctx.arc(x + 22, y, 6, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    cardText(ctx, label, x + 62, y + 10, {size: 30, weight: 700, spacing: 0.5});
  }

  function drawCardMap(ctx, map, box) {
    const mercY = lat => Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360));
    const {bounds} = map;
    const spanX = (bounds.maxLng - bounds.minLng) * Math.PI / 180;
    const spanY = mercY(bounds.maxLat) - mercY(bounds.minLat);
    const scale = Math.min(box.w / spanX, box.h / spanY);
    const ox = box.x + (box.w - spanX * scale) / 2, oy = box.y + (box.h - spanY * scale) / 2;
    const project = (lat, lng) => [ox + (lng - bounds.minLng) * Math.PI / 180 * scale, oy + (mercY(bounds.maxLat) - mercY(lat)) * scale];
    ctx.save();
    ctx.beginPath();
    ctx.rect(box.x, box.y, box.w, box.h);
    ctx.clip();
    ctx.strokeStyle = '#3d5b63';
    ctx.lineWidth = 1.6;
    ctx.lineJoin = 'round';
    for (const line of map.lines) {
      ctx.beginPath();
      line.forEach(([lat, lng], i) => { const [px, py] = project(lat, lng); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
      ctx.stroke();
    }
    // Country names only: sea names collide with the coastal markers at card size.
    for (const label of map.labels.filter(item => !item.sea)) {
      const [lx, py] = project(label.lat, label.lng);
      const half = (measure(label.text, 14, 600) + label.text.length * 1.5) / 2;
      const px = Math.min(box.x + box.w - half - 4, Math.max(box.x + half + 4, lx));
      cardText(ctx, label.text, px, py, {size: 14, weight: 600, color: '#6f8d95', align: 'center', spacing: 1.5});
    }
    for (const point of map.points.filter(p => !p.hot)) {
      const [px, py] = project(point.lat, point.lng);
      ctx.fillStyle = 'rgba(156, 208, 203, 0.28)';
      ctx.beginPath(); ctx.arc(px, py, 4, 0, Math.PI * 2); ctx.fill();
    }
    const hot = map.points.filter(p => p.hot);
    const radius = Math.max(3.5, Math.min(7, scale / 260));
    ctx.fillStyle = 'rgba(255, 139, 126, 0.16)';
    for (const point of hot) {
      const [px, py] = project(point.lat, point.lng);
      ctx.beginPath(); ctx.arc(px, py, radius * 2.2, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = CARD.coral;
    for (const point of hot) {
      const [px, py] = project(point.lat, point.lng);
      ctx.beginPath(); ctx.arc(px, py, radius, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  function drawCardColumns(ctx, months, box) {
    const max = Math.max(1, ...months.map(month => month.value));
    const band = box.w / months.length;
    const barW = Math.min(46, band * 0.62);
    months.forEach((month, i) => {
      const h = month.value / max * (box.h - 64);
      const x = box.x + band * i + (band - barW) / 2;
      const base = box.y + box.h - 34;
      ctx.fillStyle = month.highlight ? CARD.coral : CARD.bar;
      if (h > 0) ctx.fill(new Path2D(columnPath(x, base - Math.max(h, 3), barW, Math.max(h, 3), 6)));
      if (month.highlight && month.value) cardText(ctx, month.valueText, x + barW / 2, base - Math.max(h, 3) - 12, {size: 24, weight: 700, color: CARD.text, align: 'center'});
      cardText(ctx, month.label, x + barW / 2, box.y + box.h, {size: 20, weight: month.highlight ? 700 : 500, color: month.highlight ? CARD.text : CARD.muted, align: 'center'});
    });
  }

  function drawWrapped(ctx, value, x, y, maxWidth, lineHeight, maxLines, style) {
    let lines = wrap(value, style.size, style.weight, maxWidth, style.family);
    if (lines.length > maxLines) {
      lines = lines.slice(0, maxLines);
      lines[maxLines - 1] = fit(`${lines[maxLines - 1]}…`, style.size, style.weight, maxWidth).replace(/……$/, '…');
    }
    lines.forEach((line, i) => cardText(ctx, line, x, y + i * lineHeight, style));
    return lines.length;
  }

  // A share card in the visitor's language: one number, the months around it,
  // a map of the records it counts and the credit line.
  async function drawShareCard(canvas, model) {
    await fontsReady();
    const [W, H] = CARD_SIZES[model.format] || CARD_SIZES.square;
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    const story = model.format === 'story';
    const pad = 80;
    ctx.fillStyle = CARD.bg;
    ctx.fillRect(0, 0, W, H);
    drawBrand(ctx, pad, pad + 22, model.brand);
    cardText(ctx, model.eyebrow, pad, pad + 128, {size: 27, weight: 700, color: CARD.teal, spacing: 3});

    // The number shrinks to fit its column; the map takes what the text leaves.
    const valueMax = story ? W - pad * 2 : 470;
    const valueSize = Math.min(story ? 300 : 250, (story ? 300 : 250) * valueMax / Math.max(1, measure(model.value, story ? 300 : 250, 800, DISPLAY) - 30));
    const valueY = story ? 520 : 430;
    cardText(ctx, model.value, pad - 8, valueY, {size: valueSize, weight: 800, color: CARD.coral, family: DISPLAY, spacing: -10});
    const textW = story ? W - pad * 2 : 470;
    let y = valueY + 70;
    y += drawWrapped(ctx, model.label, pad, y, textW, 50, 2, {size: 42, weight: 600, color: CARD.text}) * 50 + 6;
    if (model.detail) y += drawWrapped(ctx, model.detail, pad, y, textW, 38, 2, {size: 28, weight: 500, color: CARD.muted}) * 38;

    const footY = H - (story ? 70 : pad);
    const chartBox = story ? {x: pad, y: 1480, w: W - pad * 2, h: 200} : {x: pad, y: 660, w: W - pad * 2, h: 190};
    const mapTop = story ? Math.max(720, y + 20) : 150;
    const mapBox = story ? {x: pad - 30, y: mapTop, w: W - pad * 2 + 60, h: chartBox.y - 40 - mapTop} : {x: 560, y: 150, w: 470, h: 520};
    drawCardMap(ctx, model.map, mapBox);
    drawCardColumns(ctx, model.months, chartBox);

    // Outcome split on one line, smaller type when a language needs the room.
    const parts = model.breakdown.flatMap(item => [[item.label, 500, CARD.soft, 10], [item.valueText, 700, CARD.text, 40]]);
    const natural = parts.reduce((sum, [value, weight, , gap]) => sum + measure(value, 26, weight) + gap, -40);
    const breakdownSize = Math.min(26, 26 * (W - pad * 2) / natural);
    const breakdownY = story ? 1730 : 906;
    let x = pad;
    for (const [value, weight, color, gap] of parts) {
      cardText(ctx, value, x, breakdownY, {size: breakdownSize, weight, color});
      x += measure(value, breakdownSize, weight) + gap * breakdownSize / 26;
    }
    ctx.strokeStyle = CARD.line;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(pad, footY - 50); ctx.lineTo(W - pad, footY - 50); ctx.stroke();
    cardText(ctx, model.credit, pad, footY, {size: 27, weight: 700, color: CARD.text});
    cardText(ctx, model.dataNote, W - pad, footY, {size: 23, weight: 500, color: CARD.muted, align: 'right'});
    if (story && model.honesty) cardText(ctx, fit(model.honesty, 22, 500, W - pad * 2), pad, footY - 78, {size: 22, weight: 500, color: CARD.muted});
    return canvas;
  }

  const api = {C, CARD, CARD_SIZES, measure, fit, wrap, columns, smallMultiples, rankedBars, calendar, shipRows,
    toSVG, drawShape, chartImage, drawShareCard, fontsReady, columnPath, barPath, rectPath};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.DRONE_CHARTS = api;
})();
