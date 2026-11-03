/* Shared helpers + charts for convexresearchgroup.com (no dependencies). */
  const bust = '?v=' + Math.floor(Date.now() / 60000);
const getJSON = p => fetch(p + bust).then(r => r.ok ? r.json() : null).catch(() => null);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const SVGNS = 'http://www.w3.org/2000/svg';
const svgEl = (tag, attrs = {}, parent) => {
  const e = document.createElementNS(SVGNS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
};
const dir = v => v == null ? 'flat' : v > 0 ? 'up' : v < 0 ? 'down' : 'flat';
const sgn = v => v > 0 ? '+' : v < 0 ? '−' : '';
const fmtNum = (v, d = 2) => v == null ? '–' : Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtPct = v => v == null ? '–' : sgn(v) + Math.abs(v).toFixed(2) + '%';
const fmtBp = v => v == null ? '–' : sgn(v) + Math.abs(Math.round(v)) + 'bp';
const cell = (txt, v) => `<td class="${dir(v)}">${txt}</td>`;
const decimals = t => t === 'USDJPY=X' ? 2 : /=X$/.test(t) ? 4 : 2;
const fmtDay = iso => new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const fmtDayYr = iso => new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const fmtET = iso => new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: '2-digit' }) + ' ET';

/* ---------- generic line chart (shared x positions, crosshair tooltip) ---------- */
function lineChart(el, { series, xs, xLabel, yFmt, height = 220, xTicks, zero = false }) {
  const draw = () => {
    if (!el.isConnected || (el.offsetParent === null && el.innerHTML)) return;  // hidden tab: keep last render
    el.innerHTML = '';
    const W = Math.max(260, el.clientWidth), H = height;
    const m = { t: 10, r: 12, b: 26, l: 44 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const all = series.flatMap(s => s.ys.filter(v => v != null));
    if (!all.length) { el.innerHTML = '<p class="mk-empty">No data yet.</p>'; return; }
    let lo = Math.min(...all), hi = Math.max(...all);
    if (zero) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
    const pad = (hi - lo) * 0.08 || 0.1; lo -= pad; hi += pad;
    const n = xs.length;
    const x = i => m.l + (n === 1 ? iw / 2 : (i / (n - 1)) * iw);
    const y = v => m.t + ih - ((v - lo) / (hi - lo)) * ih;
    const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img' }, el);
    const g = svgEl('g', { class: 'grid' }, svg);
    const ax = svgEl('g', { class: 'axis' }, svg);
    const step = niceStep((hi - lo) / 4);
    for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) {
      svgEl('line', { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v) }, g);
      const t = svgEl('text', { x: m.l - 8, y: y(v) + 4, 'text-anchor': 'end' }, ax); t.textContent = yFmt(v, true);
    }
    if (zero && lo < 0 && hi > 0) svgEl('line', { class: 'zero', x1: m.l, x2: W - m.r, y1: y(0), y2: y(0) }, svg);
    const ticks = xTicks ? xTicks(n, iw) : [...Array(n).keys()].filter(i => iw >= 360 || i % 2 === 0 || i === n - 1);
    ticks.forEach(i => {
      const t = svgEl('text', { x: x(i), y: H - 6, 'text-anchor': i === 0 && xTicks ? 'start' : i === n - 1 && xTicks ? 'end' : 'middle' }, ax);
      t.textContent = xLabel(xs[i]);
    });
    series.forEach(s => {
      let d = '';
      s.ys.forEach((v, i) => { if (v != null) d += (d ? 'L' : 'M') + x(i).toFixed(1) + ',' + y(v).toFixed(1); });
      svgEl('path', { d, fill: 'none', stroke: s.color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', 'stroke-dasharray': s.dash ? (typeof s.dash === 'string' ? s.dash : '5 4') : 'none' }, svg);
      if (s.dots) s.ys.forEach((v, i) => v != null && svgEl('circle', { cx: x(i), cy: y(v), r: 3.5, fill: s.color, stroke: '#fff', 'stroke-width': 2 }, svg));
    });
    // hover layer
    const hair = svgEl('line', { class: 'hair', y1: m.t, y2: m.t + ih, opacity: 0 }, svg);
    const marks = series.map(s => svgEl('circle', { r: 4.5, fill: s.color, stroke: '#fff', 'stroke-width': 2, opacity: 0 }, svg));
    const tip = document.createElement('div'); tip.className = 'tip'; el.appendChild(tip);
    const hit = svgEl('rect', { x: m.l, y: 0, width: iw, height: H, fill: 'transparent', tabindex: 0 }, svg);
    const show = i => {
      hair.setAttribute('x1', x(i)); hair.setAttribute('x2', x(i)); hair.setAttribute('opacity', 1);
      tip.innerHTML = '';
      const tl = document.createElement('div'); tl.className = 'tl'; tl.textContent = xLabel(xs[i], true); tip.appendChild(tl);
      series.forEach((s, k) => {
        const v = s.ys[i];
        marks[k].setAttribute('opacity', v == null ? 0 : 1);
        if (v == null) return;
        marks[k].setAttribute('cx', x(i)); marks[k].setAttribute('cy', y(v));
        const row = document.createElement('div'); row.className = 'row';
        const key = document.createElement('i'); key.style.background = s.color;
        const b = document.createElement('b'); b.textContent = yFmt(v);
        row.append(key, b);
        if (series.length > 1) { const nm = document.createElement('span'); nm.textContent = s.name; row.append(nm); }
        tip.appendChild(row);
      });
      const top = Math.min(...series.map(s => s.ys[i]).filter(v => v != null).map(y));
      tip.style.left = Math.min(Math.max(x(i), 70), W - 70) + 'px';
      tip.style.top = (top - 10) + 'px';
      tip.classList.add('on');
    };
    const hide = () => { hair.setAttribute('opacity', 0); marks.forEach(c => c.setAttribute('opacity', 0)); tip.classList.remove('on'); };
    let cur = n - 1;
    hit.addEventListener('pointermove', e => {
      const r = svg.getBoundingClientRect();
      const px = (e.clientX - r.left) * (W / r.width);
      cur = Math.max(0, Math.min(n - 1, Math.round(((px - m.l) / iw) * (n - 1))));
      show(cur);
    });
    hit.addEventListener('pointerleave', hide);
    hit.addEventListener('focus', () => show(cur));
    hit.addEventListener('blur', hide);
    hit.addEventListener('keydown', e => {
      if (e.key === 'ArrowLeft') { cur = Math.max(0, cur - 1); show(cur); }
      if (e.key === 'ArrowRight') { cur = Math.min(n - 1, cur + 1); show(cur); }
    });
  };
  draw();
  redraws.push(draw);
}
function niceStep(raw) {
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / p;
  return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p;
}
const dateTicks = (n, iw) => {
  const k = iw < 360 ? 3 : 5;
  return [...Array(k).keys()].map(j => Math.round(j * (n - 1) / (k - 1)));
};
const redraws = [];
window.redraws = redraws;
let rT; window.addEventListener('resize', () => { clearTimeout(rT); rT = setTimeout(() => redraws.forEach(f => f()), 150); });

/* ---------- diverging horizontal bars ---------- */
function sectorBars(el, rows) {
  const draw = () => {
    if (!el.isConnected || (el.offsetParent === null && el.innerHTML)) return;  // hidden tab: keep last render
    el.innerHTML = '';
    if (!rows.length) { el.innerHTML = '<p class="mk-empty">No data yet.</p>'; return; }
    const sorted = [...rows].sort((a, b) => b.chgPct - a.chgPct);
    const W = Math.max(260, el.clientWidth), rowH = 26, H = sorted.length * rowH + 6;
    const labW = 132, valW = 52, iw = W - labW - valW;
    const maxAbs = Math.max(0.25, ...sorted.map(r => Math.abs(r.chgPct)));
    const x0 = labW + iw / 2, sc = (iw / 2) / maxAbs;
    const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Sector performance today' }, el);
    svgEl('line', { class: 'zero', x1: x0, x2: x0, y1: 0, y2: H }, svg);
    const tip = document.createElement('div'); tip.className = 'tip'; el.appendChild(tip);
    sorted.forEach((r, i) => {
      const g = svgEl('g', { class: 'bar', tabindex: 0 }, svg);
      const cy = i * rowH + rowH / 2 + 3;
      const w = Math.max(2, Math.abs(r.chgPct) * sc);
      const pos = r.chgPct >= 0;
      svgEl('rect', { x: 0, y: cy - rowH / 2, width: W, height: rowH, fill: 'transparent' }, g);
      svgEl('rect', { x: pos ? x0 + 1 : x0 - 1 - w, y: cy - 7, width: w, height: 14, rx: 3, fill: pos ? 'var(--up)' : 'var(--down)' }, g);
      const l = svgEl('text', { x: 0, y: cy + 4, class: 'lbl' }, g); l.textContent = r.name;
      const v = svgEl('text', { x: W, y: cy + 4, 'text-anchor': 'end', class: 'val' }, g); v.textContent = fmtPct(r.chgPct);
      const on = () => {
        tip.innerHTML = '';
        const tl = document.createElement('div'); tl.className = 'tl'; tl.textContent = r.name + ' (' + r.ticker + ')';
        const row = document.createElement('div'); row.className = 'row';
        const b = document.createElement('b'); b.textContent = fmtPct(r.chgPct) + ' today';
        const s = document.createElement('span'); s.textContent = 'YTD ' + fmtPct(r.ytdPct);
        row.append(b, s); tip.append(tl, row);
        tip.style.left = Math.min(Math.max(x0, 90), W - 90) + 'px'; tip.style.top = (cy - 10) + 'px';
        tip.classList.add('on');
      };
      g.addEventListener('pointerenter', on); g.addEventListener('focus', on);
      g.addEventListener('pointerleave', () => tip.classList.remove('on')); g.addEventListener('blur', () => tip.classList.remove('on'));
    });
  };
  draw(); redraws.push(draw);
}

