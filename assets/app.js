/* Site shell for convexresearchgroup.com: theme, tabs, home page, markets tab, research,
   the note reader and the command bar. Needs charts.js. stock.js and bonds.js load after this. */
(() => {
const $ = id => document.getElementById(id);
const root = document.documentElement;
const TABS = ['home', 'markets', 'bonds', 'stocks', 'research', 'about'];

/* ---------- shared data: fetched once, used by every tab ---------- */
let stocksReady;
const CRG = window.CRG = {
  markets: getJSON('data/markets.json'),
  bonds: getJSON('data/bonds.json'),
  research: getJSON('data/research.json').then(d => d || []),
  stocks: new Promise(res => { stocksReady = res; }),
  _stocks: v => stocksReady(v),          // stock.js hands over its index, search() and go()
};
let STOCKS = null, RESEARCH = [];
CRG.stocks.then(s => { STOCKS = s; });

/* ---------- theme ---------- */
const themeNow = () => root.dataset.theme === 'dark' ? 'dark' : 'light';
function setTheme(t, save = true) {
  root.dataset.theme = t;
  if (save) { try { localStorage.setItem('crg-theme', t); } catch (e) { /* private window */ } }
  const b = $('theme-toggle');
  if (b) b.setAttribute('aria-label', t === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
  if (calendarLoaded) loadCalendar(true);
}
const toggleTheme = () => setTheme(themeNow() === 'dark' ? 'light' : 'dark');
$('theme-toggle').addEventListener('click', toggleTheme);
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
  let saved = null; try { saved = localStorage.getItem('crg-theme'); } catch (err) { /* ignore */ }
  if (!saved) setTheme(e.matches ? 'dark' : 'light', false);
});

/* ---------- tabs ---------- */
let current = null;
const ind = document.querySelector('.tab-ind');
function moveIndicator() {
  const a = document.querySelector('.tabs-nav a.on');
  if (!a || !ind) return;
  ind.style.width = a.offsetWidth - 26 + 'px';
  ind.style.transform = `translateX(${a.offsetLeft + 13}px)`;
}
window.showTab = (tab, opts = {}) => {
  if (!TABS.includes(tab)) tab = 'home';
  const changed = tab !== current;
  document.querySelectorAll('[data-panel]').forEach(p => {
    const on = p.dataset.panel === tab;
    p.hidden = !on;
    p.classList.toggle('panel-in', on && changed && current !== null);
  });
  document.querySelectorAll('.tabs-nav [data-tab]').forEach(a => {
    const on = a.dataset.tab === tab;
    a.classList.toggle('on', on);
    if (on) { a.setAttribute('aria-current', 'page'); if (a.scrollIntoView && innerWidth <= 760) a.scrollIntoView({ block: 'nearest', inline: 'center' }); }
    else a.removeAttribute('aria-current');
  });
  moveIndicator();
  if (!changed) return;
  current = tab;
  if (!opts.keepScroll) window.scrollTo(0, 0);
  if (tab !== 'stocks') document.title = 'Convex Research Group';
  // charts drawn while a panel was hidden have no width; draw them now it's visible
  requestAnimationFrame(() => {
    window.redraws.forEach(f => f());
    window.dispatchEvent(new CustomEvent('tabshow', { detail: tab }));
  });
};
function route() {
  const h = location.hash.slice(1);
  if (h === 'subscribe') {
    if (!current) showTab('home');
    $('subscribe').scrollIntoView({ behavior: 'smooth' });
    setTimeout(() => $('email-input').focus({ preventScroll: true }), 400);
    return;
  }
  showTab(h || (new URLSearchParams(location.search).get('t') ? 'stocks' : 'home'));
}
window.addEventListener('hashchange', route);
window.addEventListener('popstate', route);   // stock searches use pushState, which doesn't fire hashchange
window.addEventListener('resize', moveIndicator);
if (document.fonts && document.fonts.ready) document.fonts.ready.then(moveIndicator);
route();

/* ---------- market status (NYSE regular hours, holidays and early closes) ---------- */
const HOLIDAYS = new Set(['2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25', '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25',
  '2027-01-01', '2027-01-18', '2027-02-15', '2027-03-26', '2027-05-31', '2027-06-18', '2027-07-05', '2027-09-06', '2027-11-25', '2027-12-24']);
const EARLY = new Set(['2026-11-27', '2026-12-24', '2027-11-26']);
function marketStatus() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23' })
    .formatToParts(new Date()).map(x => [x.type, x.value]));
  const day = `${p.year}-${p.month}-${p.day}`, min = +p.hour * 60 + +p.minute;
  const trading = !['Sat', 'Sun'].includes(p.weekday) && !HOLIDAYS.has(day);
  const close = EARLY.has(day) ? 13 * 60 : 16 * 60;
  const dur = m => (m >= 60 ? Math.floor(m / 60) + 'h ' : '') + (m % 60) + 'm';
  if (trading && min >= 570 && min < close) return { open: true, text: 'U.S. markets are open', sub: 'closes in ' + dur(close - min) };
  if (trading && min >= 240 && min < 570) return { open: false, text: 'Pre-market', sub: 'opens in ' + dur(570 - min) };
  if (trading && min >= close && min < 1200) return { open: false, text: 'After hours', sub: 'regular session closed' };
  return { open: false, text: 'U.S. markets are closed', sub: HOLIDAYS.has(day) ? 'market holiday' : '' };
}
function renderStatus() {
  const s = marketStatus(), el = $('mkt-status');
  if (el) el.innerHTML = `<span class="live-dot ${s.open ? 'live' : 'off'}"></span><strong>${s.text}</strong>${s.sub ? ', ' + s.sub : ''}`;
}
renderStatus(); setInterval(renderStatus, 60000);

/* ---------- home: curve card and tiles ---------- */
const lvl = (r, bp) => bp ? Math.round(r.value * 100) + 'bp' : r.value.toFixed(2) + '%';
function setFlash(el, html) {   // swap a value in and flash it when it changed on a refresh
  if (el.dataset.v !== undefined && el.dataset.v !== html) { el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }
  el.dataset.v = html; el.innerHTML = html;
}
function renderHero(mk) {
  const S = mk.rates?.series || {}, M = mk.markets || {}, c = mk.rates?.curve;
  if (c) {
    const mark = new Set(['2Y', '10Y', '30Y']);
    $('hero-curve-sub').textContent = 'as of ' + fmtDayYr(c.today.date);
    lineChart($('hero-curve'), {
      series: [
        { name: '1M ago', color: 'var(--muted)', ys: c['1m'].yields, dash: '4 4', width: 1.5 },
        { name: 'Today', color: 'var(--ink)', ys: c.today.yields, dots: true, dotColor: 'var(--accent)', width: 2.25,
          label: i => mark.has(c.tenors[i]) ? c.today.yields[i].toFixed(2) + '%' : null },
      ],
      xs: c.tenors, xLabel: t => t, yFmt: (v, ax) => v.toFixed(ax ? 1 : 2) + '%', height: 250, margin: { t: 26, l: 40, r: 14 },
    });
  }
  const stat = (id, label, bp) => { const r = S[id]; return r ? `<div><dt>${label}</dt><dd>${lvl(r, bp)}<small class="${dir(r.chg1dBp)}">${fmtBp(r.chg1dBp)}</small></dd></div>` : ''; };
  const stats = stat('DGS2', '2-year') + stat('DGS10', '10-year') + stat('DGS30', '30-year') + stat('T10Y2Y', '2s10s', true);
  if (stats) $('hero-stats').innerHTML = stats;

  const find = t => ['equities', 'vol', 'commodities', 'fx'].flatMap(g => M[g] || []).find(r => r.ticker === t);
  const hy = S.BAMLH0A0HYM2, hyHist = (mk.rates?.history || {}).BAMLH0A0HYM2;
  const tiles = [
    ['^GSPC', 'S&P 500'], ['^NDX', 'Nasdaq 100'], ['^RUT', 'Russell 2000'], ['^VIX', 'VIX'],
    hy ? { label: 'High yield OAS', v: lvl(hy, true), c: fmtBp(hy.chg1dBp), d: dir(hy.chg1dBp), spark: hyHist ? hyHist.slice(-30).map(p => p[1]) : null, href: '#bonds' } : null,
    ['CL=F', 'WTI crude'], ['GC=F', 'Gold'], ['DX-Y.NYB', 'Dollar index'],
  ].map(t => {
    if (!t || !Array.isArray(t)) return t;
    const r = find(t[0]);
    return r ? { label: t[1], v: fmtNum(r.last, r.last > 10000 ? 0 : 2), c: fmtPct(r.chgPct), d: dir(r.chgPct), spark: r.spark, href: '#markets' } : null;
  }).filter(Boolean);
  if (!tiles.length) return;
  const box = $('tiles');
  if (box.children.length !== tiles.length || box.querySelector('.skel')) {
    box.innerHTML = tiles.map(t => `<a class="tile" href="${t.href}"><span class="tile-l">${esc(t.label)}</span><span class="tile-v"></span><span class="tile-c"></span><span class="tile-s"></span></a>`).join('');
  }
  tiles.forEach((t, i) => {
    const a = box.children[i];
    setFlash(a.querySelector('.tile-v'), t.v);
    const ch = a.querySelector('.tile-c'); ch.className = 'tile-c ' + t.d; ch.textContent = t.c;
    a.querySelector('.tile-s').innerHTML = sparkline(t.spark);
  });
  $('tape-time').textContent = 'Updated ' + fmtET(mk.updated) + '. Prices delayed, rates at prior close.';
}

/* ---------- markets tab ---------- */
function renderMarkets(mk) {
  const meta = $('mk-meta');
  if (!mk) { meta.textContent = 'Live data is temporarily unavailable.'; $('tape-time').textContent = 'Live data is temporarily unavailable.'; return; }
  const ageMin = (Date.now() - new Date(mk.updated)) / 60000;
  meta.innerHTML = `<span class="live-dot${ageMin > 90 ? ' stale' : ''}"></span>Updated ${esc(fmtET(mk.updated))}. Prices delayed, rates at prior close.`;
  renderHero(mk);

  const S = mk.rates?.series || {};
  const rr = (id, label, sub) => {
    const r = S[id]; if (!r) return '';
    return `<tr class="${sub ? 'sub' : ''}"><td class="name">${esc(label)}</td><td>${lvl(r, sub)}</td>${cell(fmtBp(r.chg1dBp), r.chg1dBp)}${cell(fmtBp(r.chg1wBp), r.chg1wBp)}${cell(fmtBp(r.chg1mBp), r.chg1mBp)}</tr>`;
  };
  let ffRow = '';
  if (S.DFEDTARL && S.DFEDTARU) ffRow = `<tr><td class="name">Fed Funds Target</td><td>${S.DFEDTARL.value.toFixed(2)}&ndash;${S.DFEDTARU.value.toFixed(2)}%</td>${cell(fmtBp(S.DFEDTARU.chg1dBp), S.DFEDTARU.chg1dBp)}${cell(fmtBp(S.DFEDTARU.chg1wBp), S.DFEDTARU.chg1wBp)}${cell(fmtBp(S.DFEDTARU.chg1mBp), S.DFEDTARU.chg1mBp)}</tr>`;
  const rows = ffRow + rr('DFF', 'Effective Fed Funds') + rr('DGS3MO', '3M Bill') + rr('DGS2', '2Y') + rr('DGS5', '5Y') + rr('DGS10', '10Y') + rr('DGS30', '30Y')
    + rr('DFII10', '10Y Real (TIPS)') + rr('T10YIE', '10Y Breakeven') + rr('T10Y2Y', '2s10s', true) + rr('T10Y3M', '3m10y', true);
  $('tbl-rates').innerHTML = rows
    ? `<table class="mk"><thead><tr><th>Tenor</th><th>Level</th><th>1D</th><th>1W</th><th>1M</th></tr></thead><tbody>${rows}</tbody></table>`
    : '<p class="mk-empty">Rates data unavailable.</p>';

  const c = mk.rates?.curve;
  if (c) {
    const sers = [
      { name: 'Today', color: 'var(--s1)', ys: c.today.yields, dots: true },
      { name: '1M ago', color: 'var(--s2)', ys: c['1m'].yields },
      { name: '1Y ago', color: 'var(--s3)', ys: c['1y'].yields, dash: true },
    ];
    $('curve-sub').textContent = 'as of ' + fmtDayYr(c.today.date);
    $('curve-legend').innerHTML = sers.map(s => `<span><i class="${s.dash ? 'dash' : ''}" style="background:${s.color};border-color:${s.color}"></i>${esc(s.name)}</span>`).join('');
    lineChart($('chart-curve'), { series: sers, xs: c.tenors, xLabel: t => t, yFmt: (v, ax) => v.toFixed(ax ? 1 : 2) + '%', height: 300 });
  }

  const hist = mk.rates?.history || {};
  const chg = (...parts) => parts.map(([v, f, l]) => `<span><b class="${dir(v)}">${f(v)}</b> ${l}</span>`).join('');
  const histChart = (id, elId, statId, label, zero = false) => {
    const h = hist[id], r = S[id];
    if (r) $(statId).innerHTML = `<div class="lbl">${esc(label)}</div><div class="val num">${lvl(r, true)}</div><div class="chg num">${chg([r.chg1wBp, fmtBp, '1W'], [r.chg1yBp, fmtBp, '1Y'])}</div>`;
    if (!h) return;
    lineChart($(elId), {
      series: [{ name: label, color: 'var(--s1)', ys: h.map(p => p[1] * 100) }],
      xs: h.map(p => p[0]), xLabel: (d, full) => full ? fmtDayYr(d) : fmtDay(d), xTicks: dateTicks,
      yFmt: (v, ax) => Math.round(v) + (ax ? '' : 'bp'), height: 170, zero,
    });
  };
  histChart('BAMLC0A0CM', 'chart-ig', 'ig-stat', 'Investment Grade');
  histChart('BAMLH0A0HYM2', 'chart-hy', 'hy-stat', 'High Yield');
  histChart('T10Y2Y', 'chart-2s10s', 's210-stat', '2s10s', true);

  const M = mk.markets || {};
  const pxRow = r => `<tr><td class="name">${esc(r.name)}</td><td>${fmtNum(r.last, r.last > 10000 ? 0 : decimals(r.ticker))}</td>${cell(fmtPct(r.chgPct), r.chgPct)}${cell(fmtPct(r.ytdPct), r.ytdPct)}</tr>`;
  const tbl = (rs, head = 'Index') => rs.length
    ? `<table class="mk"><thead><tr><th>${head}</th><th>Last</th><th>1D</th><th>YTD</th></tr></thead><tbody>${rs.map(pxRow).join('')}</tbody></table>`
    : '<p class="mk-empty">Data unavailable.</p>';
  $('tbl-eq').innerHTML = tbl(M.equities || []);
  $('tbl-macro').innerHTML = tbl([...(M.vol || []), ...(M.commodities || []), ...(M.fx || [])], 'Asset');
  sectorBars($('chart-sectors'), (M.sectors || []).filter(r => r.chgPct != null));

  const spx = M.spxHistory, now = (M.equities || []).find(r => r.ticker === '^GSPC');
  if (now) $('spx-stat').innerHTML = `<div class="val num">${fmtNum(now.last)}</div><div class="chg num">${chg([now.chgPct, fmtPct, '1D'], [now.wkPct, fmtPct, '1W'], [now.ytdPct, fmtPct, 'YTD'])}</div>`;
  if (spx) lineChart($('chart-spx'), {
    series: [{ name: 'S&P 500', color: 'var(--s1)', ys: spx.map(p => p[1]) }],
    xs: spx.map(p => p[0]), xLabel: (d, full) => full ? fmtDayYr(d) : fmtDay(d), xTicks: dateTicks,
    yFmt: v => fmtNum(v, 0), height: 220,
  });
}
function renderPulse(p) {
  if (!p || !p.bullets || !p.bullets.length) return;
  if ((Date.now() - new Date(p.generated)) / 3.6e6 > 96) return;   // don't show a stale read
  $('pulse-headline').textContent = p.headline || '';
  $('pulse-time').textContent = fmtET(p.generated);
  const ul = $('pulse-bullets'); ul.innerHTML = '';
  p.bullets.forEach(b => { const li = document.createElement('li'); li.textContent = b; ul.appendChild(li); });
  $('pulse').hidden = false;
}
CRG.markets.then(renderMarkets);
getJSON('data/pulse.json').then(renderPulse);
setInterval(() => getJSON('data/markets.json').then(mk => { if (mk) renderMarkets(mk); }), 10 * 60 * 1000);

/* economic calendar: third-party widget, loaded when the Markets tab is first opened and rebuilt on a theme change */
let calendarLoaded = false;
function loadCalendar(force) {
  const box = $('tv-cal');
  if (!box || (calendarLoaded && !force)) return;
  calendarLoaded = true;
  box.innerHTML = '<div class="tradingview-widget-container"><div class="tradingview-widget-container__widget"></div></div>';
  const s = document.createElement('script');
  s.src = 'https://s3.tradingview.com/external-embedding/embed-widget-events.js'; s.async = true;
  s.text = JSON.stringify({ colorTheme: themeNow(), isTransparent: true, width: '100%', height: '440', locale: 'en', importanceFilter: '0,1', countryFilter: 'us' });
  box.firstChild.appendChild(s);
}
window.addEventListener('tabshow', e => { if (e.detail === 'markets') loadCalendar(); });

/* ---------- home: on deck (Treasury supply) ---------- */
const bil = v => v == null ? '' : '$' + (v / 1e9).toFixed(0) + 'B';
CRG.bonds.then(b => {
  const el = $('ondeck-body');
  const A = b && b.auctions;
  if (!A) { el.innerHTML = '<p class="mk-empty">Auction schedule unavailable.</p>'; return; }
  const coupons = (A.upcoming || []).filter(u => u.type !== 'Bill');
  const list = (coupons.length ? coupons : (A.upcoming || [])).slice(0, 4);
  const last = (A.recent || [])[0];
  let html = list.length
    ? `<ul class="up-list">${list.map(u => `<li><span class="d">${fmtDay(u.date)}</span><span class="l">${esc(u.label)}</span><span class="s">${bil(u.size)}</span></li>`).join('')}</ul>`
    : '<p class="mk-empty">No auctions announced.</p>';
  if (last && last.highYield != null) {
    const tail = last.btcAvg6 != null ? `, ${last.btc >= last.btcAvg6 ? 'above' : 'below'} its six-auction average of ${last.btcAvg6.toFixed(2)}x` : '';
    html += `<p class="last-auc">Last result: <b>${esc(last.label)}</b> on ${fmtDay(last.date)} cleared at <b>${last.highYield.toFixed(3)}%</b> with a ${last.btc?.toFixed(2)}x bid-to-cover${tail}.</p>`;
  }
  el.innerHTML = html;
});

/* ---------- home: movers ---------- */
CRG.stocks.then(s => {
  const box = $('home-movers');
  if (!s || !s.rows.length) { box.innerHTML = '<p class="mk-empty">Stock data isn\'t available right now.</p>'; return; }
  const liquid = s.rows.filter(r => (r.mcap || 0) >= 2e9 && r.chgPct != null);
  const col = (title, sub, rows, rel) => `<div class="mv"><h3>${title}<small>${sub}</small></h3>${rows.map(r =>
    `<button type="button" class="mv-row" data-t="${esc(r.t)}"><b>${esc(r.t)}</b><span class="n">${esc(r.n || '')}</span><span class="p">$${fmtNum(r.last)}</span><span class="c ${rel ? '' : dir(r.chgPct)}">${rel ? r.relVol.toFixed(1) + 'x' : fmtPct(r.chgPct)}</span></button>`).join('')}</div>`;
  box.innerHTML = col('Top gainers', '1D', [...liquid].sort((a, b) => b.chgPct - a.chgPct).slice(0, 5))
    + col('Top decliners', '1D', [...liquid].sort((a, b) => a.chgPct - b.chgPct).slice(0, 5))
    + col('Unusual volume', 'vs 30-day avg', liquid.filter(r => r.relVol != null).sort((a, b) => b.relVol - a.relVol).slice(0, 5), true);
  box.querySelectorAll('[data-t]').forEach(b => b.addEventListener('click', () => s.go(b.dataset.t)));
  if (s.meta && s.meta.quotesUpdated) $('movers-time').textContent = 'Prices updated ' + fmtET(s.meta.quotesUpdated);
});

/* ---------- research ---------- */
let filter = 'all', term = '', shown = [];
const thumb = r => r.thumb ? `<img class="doc-thumb" src="${esc(r.thumb)}" alt="" loading="lazy" width="58" height="75">` : '<span></span>';
const itemHTML = r => `<a class="research-item" href="${esc(r.href)}" target="_blank" rel="noopener" data-file="${esc(r.file)}">
  ${thumb(r)}
  <span class="research-date">${r.date ? esc(fmtDayYr(r.date)) : ''}</span>
  <span class="research-meta"><span class="research-type">${esc(r.typeLabel)}</span><span class="research-title">${esc(r.title)}</span>${r.summary ? `<span class="research-summary">${esc(r.summary)}</span>` : ''}</span>
  <span class="research-tag">${esc(r.tag)}</span></a>`;
function renderResearch() {
  const list = $('research-list'), t = term.trim().toLowerCase();
  shown = RESEARCH.filter(r => (filter === 'all' || r.type === filter) && (!t || [r.title, r.summary, r.tag, r.typeLabel].join(' ').toLowerCase().includes(t)));
  if (!shown.length) {
    list.innerHTML = `<div class="empty-state">${RESEARCH.length ? 'No notes match. Try a different filter or search.' : 'Research will appear here as it publishes.'}</div>`;
    return;
  }
  let html = '', month = null;
  shown.forEach(r => {
    const m = r.date ? new Date(r.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : 'Undated';
    if (m !== month) { html += `<h3 class="month-head">${m}</h3>`; month = m; }
    html += itemHTML(r);
  });
  list.innerHTML = html;
}
document.querySelectorAll('.filter-btn').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('.filter-btn').forEach(x => { x.classList.toggle('active', x === b); x.setAttribute('aria-pressed', String(x === b)); });
  filter = b.dataset.f; renderResearch();
}));
$('note-filter').addEventListener('input', e => { term = e.target.value; renderResearch(); });

CRG.research.then(data => {
  RESEARCH = data;
  document.querySelectorAll('.filter-btn').forEach(b => {
    const n = b.dataset.f === 'all' ? data.length : data.filter(r => r.type === b.dataset.f).length;
    b.insertAdjacentHTML('beforeend', `<small>${n}</small>`);
  });
  renderResearch();
  // home: today's note and the most recent other pieces
  const lead = data.find(r => r.type === 'morning-note') || data[0];
  const feat = $('feature');
  if (!lead) { feat.innerHTML = '<p class="mk-empty">The first note is on its way.</p>'; $('home-latest').innerHTML = ''; return; }
  feat.classList.toggle('no-thumb', !lead.thumb);
  feat.innerHTML = `${lead.thumb ? `<button type="button" class="thumb-btn" data-file="${esc(lead.file)}" aria-label="Open ${esc(lead.title)}"><img class="doc-thumb" src="${esc(lead.thumb)}" alt="" width="168" height="217"></button>` : ''}
    <div><p class="feature-meta"><b>${esc(lead.typeLabel)}</b><span>${lead.date ? esc(fmtDayYr(lead.date)) : ''}</span></p>
    <h3>${esc(lead.summary || lead.title)}</h3>
    ${lead.summary ? `<p class="sum">${esc(lead.title)}. Overnight macro, the rates and credit snapshot, sector moves and the day's calendar.</p>` : ''}
    <div class="feature-actions"><a class="btn btn-primary" href="${esc(lead.href)}" target="_blank" rel="noopener" data-file="${esc(lead.file)}">Read the note</a><a class="text-link" href="#subscribe">Get it by email</a></div></div>`;
  $('home-latest').innerHTML = data.filter(r => r !== lead).slice(0, 4).map(itemHTML).join('');
});

/* ---------- note reader: PDFs open in a side panel on wide screens, a new tab on phones ---------- */
const reader = $('reader'), frame = $('reader-frame');
let rList = [], rIdx = 0;
function showNote() {
  const r = rList[rIdx];
  $('reader-meta').innerHTML = `<b>${esc(r.typeLabel)}</b><span>${r.date ? esc(fmtDayYr(r.date)) : ''}</span><span>${esc(r.tag || '')}</span>`;
  $('reader-title').textContent = r.title;
  $('reader-sum').textContent = r.summary || '';
  $('reader-open').href = r.href;
  frame.src = r.href + '#view=FitH';
  $('reader-prev').disabled = rIdx <= 0;
  $('reader-next').disabled = rIdx >= rList.length - 1;
}
function openNote(file, list) {
  rList = list && list.some(r => r.file === file) ? list : RESEARCH;
  rIdx = rList.findIndex(r => r.file === file);
  if (rIdx < 0) return false;
  showNote();
  if (!reader.open) reader.showModal();
  return true;
}
$('reader-prev').addEventListener('click', () => { if (rIdx > 0) { rIdx--; showNote(); } });    // newer
$('reader-next').addEventListener('click', () => { if (rIdx < rList.length - 1) { rIdx++; showNote(); } });
$('reader-close').addEventListener('click', () => reader.close());
reader.addEventListener('click', e => { if (e.target === reader) reader.close(); });
reader.addEventListener('close', () => { frame.src = 'about:blank'; });
reader.addEventListener('keydown', e => {
  if (e.key === 'ArrowLeft') $('reader-prev').click();
  if (e.key === 'ArrowRight') $('reader-next').click();
});
document.addEventListener('click', e => {
  const a = e.target.closest('[data-file]');
  if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button || innerWidth < 900) return;   // phones and modified clicks: the PDF itself
  const inList = a.closest('#research-list');
  if (openNote(a.dataset.file, inList ? shown : RESEARCH)) e.preventDefault();
});

/* ---------- command bar ---------- */
const cmd = $('cmd'), cmdIn = $('cmd-input'), cmdList = $('cmd-list');
const goHash = (h, scrollTo) => () => {
  if (location.hash === '#' + h) route(); else location.hash = h;
  if (scrollTo) setTimeout(() => { const el = $(scrollTo); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 120);
};
const PLACES = [
  ['Home', 'Front page', goHash('home'), 'home front'],
  ['Markets', 'Rates, credit and cross-asset monitor', goHash('markets'), 'markets monitor equities sectors commodities fx vix'],
  ['Bonds', 'Curve, spreads by rating, auctions, ETFs', goHash('bonds'), 'bonds rates treasury credit spreads oas'],
  ['Stocks', 'Desk view for any U.S. stock above $250M', goHash('stocks'), 'stocks equities lookup ticker movers tape'],
  ['Research', 'Every note we publish', goHash('research'), 'research notes morning trade ideas deep dives'],
  ['About', 'Who we are and what we cover', goHash('about'), 'about coverage'],
  ['Compare yields', 'Chart any two to four series', goHash('bonds', 'compare'), 'compare yields chart tool spread 2s10s breakeven real'],
  ['Treasury auctions', 'Recent results and the schedule', goHash('bonds', 'auctions'), 'auctions supply bid cover tail indirect dealer'],
  ['Economic calendar', 'U.S. releases this week', goHash('markets', 'calendar'), 'economic calendar cpi payrolls fomc data releases'],
];
const ACTIONS = [
  [() => themeNow() === 'dark' ? 'Switch to light theme' : 'Switch to dark theme', toggleTheme, 'theme dark light mode appearance'],
  [() => 'Subscribe to the morning note', goHash('subscribe'), 'subscribe email newsletter sign up'],
];
let items = [], selIdx = 0;
function buildCmd() {
  const raw = cmdIn.value.trim(), t = raw.toLowerCase();
  const groups = [];
  const place = p => ({ k: p[0], d: p[1], run: p[2], wide: true });
  const note = r => ({ k: r.title, d: '', r: r.date ? fmtDay(r.date) : '', wide: true, sub: r.typeLabel,
    run: () => { if (innerWidth < 900 || !openNote(r.file, RESEARCH)) window.open(r.href, '_blank', 'noopener'); } });
  const action = a => ({ k: a[0](), d: '', run: a[1], wide: true });
  if (!t) {
    groups.push(['Go to', PLACES.slice(0, 6).map(place)]);
    if (RESEARCH.length) groups.push(['Latest research', RESEARCH.slice(0, 3).map(note)]);
    groups.push(['Actions', ACTIONS.map(action)]);
  } else {
    if (STOCKS) {
      const hits = STOCKS.search(raw).slice(0, 6);
      if (hits.length) groups.push(['Stocks', hits.map(r => ({ k: r.t, d: r.n || '', r: `<span>$${fmtNum(r.last)}</span> <span class="${dir(r.chgPct)}">${fmtPct(r.chgPct)}</span>`, rHtml: true, run: () => STOCKS.go(r.t) }))]);
    } else if (/^[a-z.\-]{1,6}$/.test(t)) {
      groups.push(['Stocks', [{ k: raw.toUpperCase(), d: 'Open the desk view', run: () => { location.href = '?t=' + encodeURIComponent(raw.toUpperCase()) + '#stocks'; } }]]);
    }
    const pl = PLACES.filter(p => (p[0] + ' ' + p[3]).toLowerCase().includes(t));
    if (pl.length) groups.push(['Go to', pl.slice(0, 5).map(place)]);
    const rs = RESEARCH.filter(r => [r.title, r.summary, r.tag, r.typeLabel].join(' ').toLowerCase().includes(t));
    if (rs.length) groups.push(['Research', rs.slice(0, 5).map(note)]);
    const ac = ACTIONS.filter(a => (a[0]() + ' ' + a[2]).toLowerCase().includes(t));
    if (ac.length) groups.push(['Actions', ac.map(action)]);
  }
  items = groups.flatMap(g => g[1]);
  selIdx = 0;
  if (!items.length) { cmdList.innerHTML = `<p class="cmd-empty">Nothing matches "${esc(raw)}". Try a ticker, a company name or a section.</p>`; return; }
  let i = 0;
  cmdList.innerHTML = groups.map(([name, its]) => `<div class="cmd-group">${name}</div>` + its.map(it => {
    const n = i++;
    return `<button type="button" class="cmd-item${it.wide ? ' wide' : ''}" role="option" id="cmd-o${n}" data-i="${n}">`
      + (it.wide ? `<span class="d"><span class="k">${esc(it.k)}</span>${it.d || it.sub ? `<small>${esc(it.d || it.sub)}</small>` : ''}</span>` : `<span class="k">${esc(it.k)}</span><span class="d">${esc(it.d)}</span>`)
      + `<span class="r">${it.rHtml ? it.r : esc(it.r || '')}</span></button>`;
  }).join('')).join('');
  markSel();
}
function markSel(scroll) {
  cmdList.querySelectorAll('.cmd-item').forEach(b => {
    const on = +b.dataset.i === selIdx;
    b.classList.toggle('sel', on); b.setAttribute('aria-selected', String(on));
    if (on && scroll) b.scrollIntoView({ block: 'nearest' });
  });
  cmdIn.setAttribute('aria-activedescendant', items.length ? 'cmd-o' + selIdx : '');
}
function runCmd(i) {
  const it = items[i]; if (!it) return;
  cmd.close();
  it.run();
}
function openCmd() {
  if (cmd.open) return;
  if (reader.open) reader.close();
  cmdIn.value = ''; buildCmd();
  cmd.showModal(); cmdIn.focus();
}
cmdIn.addEventListener('input', buildCmd);
cmdIn.addEventListener('keydown', e => {
  if (e.key === 'ArrowDown') { selIdx = Math.min(items.length - 1, selIdx + 1); markSel(true); e.preventDefault(); }
  else if (e.key === 'ArrowUp') { selIdx = Math.max(0, selIdx - 1); markSel(true); e.preventDefault(); }
  else if (e.key === 'Enter') { e.preventDefault(); runCmd(selIdx); }
});
cmdList.addEventListener('pointermove', e => { const b = e.target.closest('.cmd-item'); if (b && +b.dataset.i !== selIdx) { selIdx = +b.dataset.i; markSel(); } });
cmdList.addEventListener('click', e => { const b = e.target.closest('.cmd-item'); if (b) runCmd(+b.dataset.i); });
cmd.addEventListener('click', e => { if (e.target === cmd) cmd.close(); });
document.querySelectorAll('[data-cmd]').forEach(b => b.addEventListener('click', openCmd));
document.addEventListener('keydown', e => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
  if ((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)) { e.preventDefault(); cmd.open ? cmd.close() : openCmd(); }
  else if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); openCmd(); }
});
CRG.stocks.then(() => { if (cmd.open && cmdIn.value) buildCmd(); });
if (!/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)) document.querySelectorAll('kbd[data-mod]').forEach(k => { k.textContent = 'Ctrl K'; });

/* ---------- subscribe ---------- */
const SUBSCRIBE_URL = 'https://script.google.com/macros/s/AKfycbyD65EN-TBkD3lJrkD5Xq3ZQe8EQjqlZN7jSXHsFOj3sCI5qnn7fZkJFMi8_X5gSTI/exec';
$('subscribe-form').addEventListener('submit', e => {
  e.preventDefault();
  const input = $('email-input'), msg = $('subscribe-msg'), btn = e.target.querySelector('button');
  const email = input.value.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { msg.textContent = 'Enter a valid email address, like name@example.com.'; input.focus(); return; }
  btn.disabled = true; btn.textContent = 'Subscribing…'; msg.textContent = '';
  const done = text => { msg.textContent = text; btn.disabled = false; btn.textContent = 'Subscribe'; };
  fetch(SUBSCRIBE_URL, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'email=' + encodeURIComponent(email) })
    .then(() => { input.value = ''; done('Subscribed. The next morning note will land in your inbox.'); })
    .catch(() => done("Couldn't subscribe right now. Check your connection and try again."));
});
})();
