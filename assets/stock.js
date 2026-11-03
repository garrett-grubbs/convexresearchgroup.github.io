/* Stock lookup section: search, today's movers and the per-stock desk view. Needs charts.js. */
(() => {
let scrollOnRender = !!new URLSearchParams(location.search).get('t');
  // local preview reads ./stockdata/; the live site reads the stock-data branch
const BASE = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) ? 'stockdata/' : 'https://raw.githubusercontent.com/garrett-grubbs/convexresearchgroup.github.io/stock-data/';
const getData = p => fetch(BASE + p + '?v=' + Math.floor(Date.now() / 300000)).then(r => r.ok ? r.json() : null).catch(() => null);
const view = document.getElementById('view');
const yfSym = t => t.replace(/\./g, '-');
let INDEX = [];
const byT = new Map();

/* ---------- formatting ---------- */
const big = v => v == null ? '–' : v >= 1e12 ? '$' + (v / 1e12).toFixed(2) + 'T' : v >= 1e9 ? '$' + (v / 1e9).toFixed(1) + 'B' : v >= 1e6 ? '$' + (v / 1e6).toFixed(0) + 'M' : '$' + fmtNum(v, 0);
const cnt = v => v == null ? '–' : v >= 1e9 ? (v / 1e9).toFixed(2) + 'B' : v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(0) + 'K' : String(v);
const px = v => v == null ? '–' : '$' + fmtNum(v, v >= 1000 ? 2 : 2);
const pct1 = v => v == null ? '–' : sgn(v) + Math.abs(v).toFixed(1) + '%';
const span = (txt, v) => `<span class="${dir(v)}">${txt}</span>`;
const daysTo = iso => Math.round((new Date(iso + 'T12:00:00') - new Date(new Date().toDateString())) / 864e5);
const ratingTxt = r => ({ strong_buy: 'Strong buy', buy: 'Buy', hold: 'Hold', underperform: 'Underperform', sell: 'Sell', none: '–' }[r] || (r ? r[0].toUpperCase() + r.slice(1) : '–'));

/* ---------- search ---------- */
const q = document.getElementById('q'), ac = document.getElementById('ac');
let hits = [], sel = -1;
function search(term) {
  term = term.trim().toUpperCase();
  if (!term) return [];
  const tick = [], namePre = [], nameIn = [];
  for (const r of INDEX) {
    const n = (r.n || '').toUpperCase();
    if (r.t === term || r.t.startsWith(term)) tick.push(r);
    else if (n.startsWith(term)) namePre.push(r);
    else if (term.length > 2 && n.includes(term)) nameIn.push(r);
  }
  tick.sort((a, b) => (a.t === term ? -1 : b.t === term ? 1 : a.t.length - b.t.length || (b.mcap || 0) - (a.mcap || 0)));
  return [...tick, ...namePre, ...nameIn].slice(0, 8);
}
function drawAc() {
  ac.innerHTML = '';
  hits.forEach((r, i) => {
    const b = document.createElement('button');
    b.type = 'button'; b.setAttribute('role', 'option'); if (i === sel) b.className = 'sel';
    b.innerHTML = `<span class="t"></span><span class="n"></span><span class="p">${px(r.last)}</span><span class="c ${dir(r.chgPct)}">${fmtPct(r.chgPct)}</span>`;
    b.querySelector('.t').textContent = r.t; b.querySelector('.n').textContent = r.n || '';
    b.addEventListener('mousedown', e => { e.preventDefault(); go(r.t); });
    ac.appendChild(b);
  });
  ac.hidden = !hits.length;
  q.parentElement.setAttribute('aria-expanded', String(!!hits.length));
}
q.addEventListener('input', () => { hits = search(q.value); sel = hits.length ? 0 : -1; drawAc(); });
q.addEventListener('keydown', e => {
  if (e.key === 'ArrowDown') { sel = Math.min(hits.length - 1, sel + 1); drawAc(); e.preventDefault(); }
  else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); drawAc(); e.preventDefault(); }
  else if (e.key === 'Enter') {
    const t = hits[sel]?.t || q.value.trim().toUpperCase();
    if (t) go(t);
  } else if (e.key === 'Escape') { hits = []; drawAc(); }
});
q.addEventListener('blur', () => setTimeout(() => { ac.hidden = true; }, 120));

function go(t) {
  scrollOnRender = true;
  hits = []; drawAc(); q.value = ''; q.blur();
  history.pushState({ t }, '', '?t=' + encodeURIComponent(t) + '#stocks');
  route();
}
window.addEventListener('popstate', route);

/* ---------- landing: movers ---------- */
function moverTable(title, sub, rows, col) {
  const tr = rows.map(r => `<tr data-t="${esc(r.t)}"><td class="name"><b>${esc(r.t)}</b><span>${esc(r.n || '')}</span></td><td>${px(r.last)}</td><td class="${col === 'relVol' ? '' : dir(r.chgPct)}">${col === 'relVol' ? r.relVol.toFixed(1) + 'x' : fmtPct(r.chgPct)}</td></tr>`).join('');
  return `<div class="card"><div class="card-head"><span class="card-title">${title}</span><span class="card-sub">${sub}</span></div>
    <table class="mk"><thead><tr><th>Stock</th><th>Last</th><th>${col === 'relVol' ? 'vs avg' : '1D'}</th></tr></thead><tbody>${tr}</tbody></table></div>`;
}
function landing(meta) {
  document.title = 'Convex Research Group';
  const liquid = INDEX.filter(r => (r.mcap || 0) >= 2e9 && r.chgPct != null);
  const up = [...liquid].sort((a, b) => b.chgPct - a.chgPct).slice(0, 10);
  const dn = [...liquid].sort((a, b) => a.chgPct - b.chgPct).slice(0, 10);
  const vol = liquid.filter(r => r.relVol != null).sort((a, b) => b.relVol - a.relVol).slice(0, 10);
  view.innerHTML = `<div class="sec-head" style="margin-top:24px"><div><h2>Today's tape</h2>
    <p>Largest moves and heaviest volume among stocks above $2B. Select one for the full desk view.</p></div>
    <p class="mk-meta">${meta.quotesUpdated ? 'Prices updated ' + esc(fmtET(meta.quotesUpdated)) : ''}</p></div>
    <div class="movers">${moverTable('Top gainers', '1D %', up, 'chg')}${moverTable('Top decliners', '1D %', dn, 'chg')}${moverTable('Unusual volume', 'Today vs 30-day avg', vol, 'relVol')}</div>`;
  view.querySelectorAll('tr[data-t]').forEach(tr => tr.addEventListener('click', () => go(tr.dataset.t)));
}

/* ---------- desk read: plain statements built only from the numbers ---------- */
function deskRead(s) {
  const out = [];
  const o = s.options || {}, f = o.front, p = s.positioning || {}, c = s.catalysts || {};
  let a = `${s.t} ${s.chgPct >= 0 ? 'rose' : 'fell'} ${Math.abs(s.chgPct).toFixed(2)}% to ${px(s.last)} in the last session`;
  if (s.moveAtr != null) a += `, a ${Math.abs(s.moveAtr).toFixed(1)} ATR move`;
  if (s.relVol != null) a += ` on ${s.relVol.toFixed(1)}x its 30-day average volume`;
  a += '.';
  if (s.pre && s.pre.price) a += ` Indicated ${fmtPct(s.pre.chgPct)} pre-market at ${px(s.pre.price)}.`;
  out.push(a);
  const above = n => s['sma' + n] != null ? (s.last >= s['sma' + n] ? 'above' : 'below') : null;
  const a50 = above(50), a200 = above(200);
  if (a50 && a200) {
    let t = a50 === a200 ? `Trading ${a50} both its 50 and 200-day averages` : `Trading ${a50} its 50-day but ${a200} its 200-day average`;
    t += `, ${Math.abs(s.fromHi52).toFixed(1)}% ${s.fromHi52 < 0 ? 'below' : 'above'} the 52-week high`;
    if (s.rsi14 >= 70) t += `, with RSI at ${s.rsi14} (overbought)`;
    else if (s.rsi14 <= 30) t += `, with RSI at ${s.rsi14} (oversold)`;
    out.push(t + '.');
  }
  if (s.relSpy1m != null) {
    let t = `${s.relSpy1m >= 0 ? 'Outperformed' : 'Underperformed'} SPY by ${Math.abs(s.relSpy1m).toFixed(1)} points over the past month`;
    if (s.relSector1m != null && s.sectorEtf) t += ` and ${s.relSector1m >= 0 ? 'beat' : 'lagged'} ${s.sectorEtf} by ${Math.abs(s.relSector1m).toFixed(1)}`;
    out.push(t + '.');
  }
  if (o.earnings && c.earnings) {
    out.push(`Options price a ${o.earnings.impliedMovePct.toFixed(1)}% move through earnings on ${fmtDay(c.earnings)} (${daysTo(c.earnings)} days), via the ${fmtDay(o.earnings.expiry)} straddle.`);
  } else if (f && f.atmIv != null && s.hv20 != null) {
    const prem = f.atmIv - s.hv20;
    out.push(`At the money implied vol is ${f.atmIv.toFixed(1)}% vs ${s.hv20.toFixed(1)}% 20-day realized, ${Math.abs(prem) < 2 ? 'roughly in line' : prem > 0 ? 'a ' + prem.toFixed(1) + ' point premium' : 'a ' + Math.abs(prem).toFixed(1) + ' point discount'}.`);
  }
  if (p.shortPctFloat != null) {
    let t = p.shortPctFloat >= 10 ? `Crowded short: ${p.shortPctFloat.toFixed(1)}% of float` : `Short interest is ${p.shortPctFloat.toFixed(1)}% of float`;
    if (p.daysToCover != null) t += ` (${p.daysToCover.toFixed(1)} days to cover)`;
    if (p.shortChgPct != null && Math.abs(p.shortChgPct) >= 5) t += `, ${p.shortChgPct > 0 ? 'up' : 'down'} ${Math.abs(p.shortChgPct).toFixed(0)}% from the prior report`;
    out.push(t + '.');
  }
  if (f && f.pcVol != null && (f.pcVol >= 1.5 || f.pcVol <= 0.4) && f.callVol + f.putVol >= 5000) {
    out.push(`Front-month flow skewed to ${f.pcVol >= 1.5 ? 'puts' : 'calls'}: put/call volume ${f.pcVol.toFixed(2)} on ${cnt(f.callVol + f.putVol)} contracts.`);
  }
  return out;
}

/* ---------- stock view ---------- */
function kv(rows) {
  return `<table class="kv"><tbody>${rows.filter(Boolean).map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('')}</tbody></table>`;
}
const sma = (arr, n) => arr.map((_, i) => i < n - 1 ? null : arr.slice(i - n + 1, i + 1).reduce((a, b) => a + b, 0) / n);

function renderStock(s) {
  const live = byT.get(s.t);
  // intraday quote overlay from the 30-minute refresh, if newer than the deep snapshot
  if (live && live.asOf >= s.asOf && live.last != null) { s.last = live.last; s.chgPct = live.chgPct; if (live.relVol != null) s.relVol = live.relVol; }
  document.title = `${s.t} | Convex Research Group`;
  const p = s.positioning || {}, o = s.options || {}, f = o.front, c = s.catalysts || {}, v = s.valuation || {};
  const ext = s.pre && s.pre.price ? `<span class="ext">Pre-market <b>${px(s.pre.price)}</b> ${span(fmtPct(s.pre.chgPct), s.pre.chgPct)}</span>`
    : s.post && s.post.price ? `<span class="ext">After hours <b>${px(s.post.price)}</b> ${span(fmtPct(s.post.chgPct), s.post.chgPct)}</span>` : '';
  const subline = [s.sector, s.sub].filter(Boolean).map(esc).join(', ') + (s.exchange ? '. ' + esc(s.exchange) : '');
  const read = deskRead(s);
  // same relevance rule as the pipeline: keep headlines that name the company or ticker
  const nameKeys = (s.n || '').toLowerCase().replace(/[,.]|\b(inc|corp|corporation|co|company|holdings|group|ltd|plc|the)\b/g, ' ').split(/\s+/).filter(w => w.length > 2).slice(0, 2);
  const tRe = new RegExp('\\b' + s.t.toLowerCase().replace('.', '\\.') + '\\b');
  const news = (s.news || []).filter(n => { const tl = (n.title || '').toLowerCase(); return tRe.test(tl) || nameKeys.some(k => tl.includes(k)); });

  view.innerHTML = `
  <div class="sh">
    <div>
      <h1>${esc(s.t)}<small>${esc(s.n || '')}</small></h1>
      <p class="sub">${subline}</p>
      <div class="px"><span class="last">${px(s.last)}</span><span class="chg ${dir(s.chgPct)}">${fmtPct(s.chgPct)}</span>${ext}</div>
    </div>
    <dl class="keyfacts">
      <div><dt>Market cap</dt><dd>${big(s.mcap)}</dd></div>
      <div><dt>Avg daily value</dt><dd>${big(s.avgDollarVol30)}</dd></div>
      <div><dt>Beta (1Y)</dt><dd>${s.beta1y ?? '–'}</dd></div>
      <div><dt>P/E fwd</dt><dd>${v.fwdPe ?? '–'}</dd></div>
      <div><dt>Next earnings</dt><dd>${c.earnings ? fmtDay(c.earnings) : '–'}</dd></div>
      <div><dt>As of</dt><dd>${fmtDay(s.asOf)}</dd></div>
    </dl>
  </div>

  ${read.length ? `<div class="read"><h2>Desk read</h2><ul>${read.map(t => `<li>${esc(t)}</li>`).join('')}</ul>
    <p class="src">Generated from the figures on this page${s.stale ? '. Some positioning and options data is from an earlier pull' : ''}.</p></div>` : ''}

  <div class="sgrid two">
    <div class="card">
      <div class="card-head"><span class="card-title">Price and levels</span><span class="card-sub">1 year, with 50 and 200-day averages</span></div>
      <div class="legend" id="px-legend"></div>
      <div class="chart" id="chart-px"></div>
      <div class="ret-strip">
        <div><span>1W</span><b class="${dir(s.r1w)}">${pct1(s.r1w)}</b></div>
        <div><span>1M</span><b class="${dir(s.r1m)}">${pct1(s.r1m)}</b></div>
        <div><span>3M</span><b class="${dir(s.r3m)}">${pct1(s.r3m)}</b></div>
        <div><span>YTD</span><b class="${dir(s.ytd)}">${pct1(s.ytd)}</b></div>
        <div><span>1Y</span><b class="${dir(s.r1y)}">${pct1(s.r1y)}</b></div>
      </div>
    </div>
    <div class="card">
      <div class="card-head"><span class="card-title">Tape</span><span class="card-sub">Last session</span></div>
      ${kv([
        ['Prior close', px(s.prev)],
        ['Open', `${px(s.open)}<small>${s.gapPct != null ? 'gap ' + fmtPct(s.gapPct) : ''}</small>`],
        ['Day range', `${px(s.low)} to ${px(s.high)}`],
        ['Volume', `${cnt(s.vol)}<small>${s.relVol != null ? s.relVol.toFixed(1) + 'x 30d avg' : ''}</small>`],
        ['30-day avg volume', cnt(s.avgVol30)],
        ['ATR (14)', `${px(s.atr14)}<small>${s.atrPct != null ? s.atrPct.toFixed(1) + '% of price' : ''}</small>`],
        ['Move in ATRs', s.moveAtr != null ? span((s.moveAtr > 0 ? '+' : '') + s.moveAtr.toFixed(1), s.moveAtr) : '–'],
        ['vs SPY, 1M', s.relSpy1m != null ? span((s.relSpy1m > 0 ? '+' : '') + s.relSpy1m.toFixed(1) + ' pts', s.relSpy1m) : '–'],
        s.sectorEtf ? [`vs ${esc(s.sectorEtf)}, 1M`, s.relSector1m != null ? span((s.relSector1m > 0 ? '+' : '') + s.relSector1m.toFixed(1) + ' pts', s.relSector1m) : '–'] : null,
      ])}
    </div>
  </div>

  <div class="sgrid three">
    <div class="card">
      <div class="card-head"><span class="card-title">Technical levels</span></div>
      ${kv([
        ['52-week high', `${px(s.hi52)}<small>${s.fromHi52 != null ? fmtPct(s.fromHi52) : ''}</small>`],
        ['52-week low', `${px(s.lo52)}<small>${s.fromLo52 != null ? fmtPct(s.fromLo52) : ''}</small>`],
        ['20-day high', px(s.hi20)],
        ['20-day low', px(s.lo20)],
        ['20-day average', px(s.sma20)],
        ['50-day average', `${px(s.sma50)}<small>${s.sma50 ? (s.last >= s.sma50 ? 'above' : 'below') : ''}</small>`],
        ['200-day average', `${px(s.sma200)}<small>${s.sma200 ? (s.last >= s.sma200 ? 'above' : 'below') : ''}</small>`],
        ['RSI (14)', s.rsi14 ?? '–'],
      ])}
    </div>
    <div class="card">
      <div class="card-head"><span class="card-title">Positioning</span><span class="card-sub">${p.shortAsOf ? 'Short interest as of ' + fmtDay(p.shortAsOf) : ''}</span></div>
      ${p.shortPctFloat == null && p.instPct == null ? '<p class="na">Not available for this stock.</p>' : kv([
        ['Short % of float', p.shortPctFloat != null ? p.shortPctFloat.toFixed(1) + '%' : '–'],
        ['Days to cover', p.daysToCover ?? '–'],
        ['Shares short', cnt(p.sharesShort)],
        ['Change vs prior report', p.shortChgPct != null ? span(pct1(p.shortChgPct), p.shortChgPct) : '–'],
        ['Institutional ownership', p.instPct != null ? p.instPct.toFixed(1) + '%' : '–'],
        ['Float', cnt(p.floatShares)],
      ])}
    </div>
    <div class="card">
      <div class="card-head"><span class="card-title">Options</span><span class="card-sub">${f ? 'Exp ' + fmtDay(f.expiry) + ', as of ' + esc(fmtET(s.optionsUpdated || s.updated)) : ''}</span></div>
      ${!f ? '<p class="na">No listed options data for this stock.</p>' : kv([
        ['ATM implied vol', f.atmIv != null ? f.atmIv.toFixed(1) + '%' : '–'],
        ['20-day realized vol', s.hv20 != null ? s.hv20.toFixed(1) + '%' : '–'],
        ['Implied move to expiry', f.impliedMovePct != null ? '±' + f.impliedMovePct.toFixed(1) + '%' : '–'],
        o.earnings ? ['Implied move thru earnings', '±' + o.earnings.impliedMovePct.toFixed(1) + '%<small>' + fmtDay(o.earnings.expiry) + ' exp</small>'] : null,
        ['Put/call volume', f.pcVol ?? '–'],
        ['Put/call open interest', f.pcOi ?? '–'],
        ['Contracts traded', cnt(f.callVol + f.putVol)],
      ])}
      ${o.unusual && o.unusual.length ? `<p class="card-sub" style="margin:14px 0 6px">Volume above open interest</p>
        <table class="mk"><thead><tr><th>Strike</th><th>Vol</th><th>OI</th><th>IV</th></tr></thead><tbody>
        ${o.unusual.map(u => `<tr><td class="name">${px(u.strike)} ${u.type === 'C' ? 'call' : 'put'}</td><td>${cnt(u.vol)}</td><td>${cnt(u.oi)}</td><td>${u.iv != null ? u.iv + '%' : '–'}</td></tr>`).join('')}
        </tbody></table>` : ''}
    </div>
  </div>

  <div class="sgrid three">
    <div class="card">
      <div class="card-head"><span class="card-title">Catalysts and valuation</span></div>
      ${kv([
        ['Next earnings', c.earnings ? `${fmtDayYr(c.earnings)}<small>${daysTo(c.earnings)} days</small>` : '–'],
        [c.exDiv && daysTo(c.exDiv) < 0 ? 'Last ex-dividend' : 'Ex-dividend', c.exDiv ? fmtDayYr(c.exDiv) : '–'],
        ['Dividend yield', v.divYield != null ? v.divYield.toFixed(2) + '%' : '–'],
        ['P/E trailing', v.pe ?? '–'],
        ['P/E forward', v.fwdPe ?? '–'],
        ['Analyst target', v.target ? `${px(v.target)}<small>${fmtPct((v.target / s.last - 1) * 100)}</small>` : '–'],
        ['Consensus', v.rating ? `${ratingTxt(v.rating)}<small>${v.analysts ? v.analysts + ' analysts' : ''}</small>` : '–'],
        ['Correlation to SPY', s.corrSpy1y ?? '–'],
      ])}
    </div>
    <div class="card">
      <div class="card-head"><span class="card-title">Peers</span><span class="card-sub" id="peer-sub"></span></div>
      <div class="mk-table-wrap" id="peers"></div>
    </div>
    <div class="card">
      <div class="card-head"><span class="card-title">Headlines</span><a class="card-sub" href="https://finance.yahoo.com/quote/${encodeURIComponent(yfSym(s.t))}/news" target="_blank" rel="noopener">More news</a></div>
      ${news.length ? `<ul class="news">${news.map(n => `<li><a href="${esc(n.url)}" target="_blank" rel="noopener nofollow">${esc(n.title)}</a><span>${esc(n.source || '')}${n.date ? ', ' + esc(fmtDay(n.date)) : ''}</span></li>`).join('')}</ul>` : '<p class="na">No recent headlines.</p>'}
    </div>
  </div>
  <p class="mk-disclaimer">Snapshot ${esc(fmtET(s.updated))}. Price, volume and options from Yahoo Finance (delayed); short interest from exchange reports via Yahoo. Desk read is generated from these figures and is not a recommendation.</p>`;

  // chart
  const cl = s.closes || [];
  if (cl.length) {
    const ys = cl.map(p => p[1]);
    const ser = [
      { name: 'Close', color: 'var(--s1)', ys },
      { name: '50-day', color: 'var(--s2)', ys: sma(ys, 50) },
      { name: '200-day', color: 'var(--s3)', ys: sma(ys, 200), dash: true },
    ].filter(x => x.ys.some(y => y != null));
    document.getElementById('px-legend').innerHTML = ser.map(x => `<span><i class="${x.dash ? 'dash' : ''}" style="background:${x.color};border-color:${x.color}"></i>${x.name}</span>`).join('');
        lineChart(document.getElementById('chart-px'), {
      series: ser, xs: cl.map(p => p[0]), xLabel: (d, full) => full ? fmtDayYr(d) : fmtDay(d), xTicks: dateTicks,
      yFmt: (v, ax) => ax ? '$' + fmtNum(v, v >= 100 ? 0 : 2) : px(v), height: 260,
    });
  }

  // peers from the index: same sub-industry, else same sector
  let peers = INDEX.filter(r => r.sub && r.sub === s.sub);
  let label = s.sub;
  if (peers.length < 4) { peers = INDEX.filter(r => r.sector && r.sector === s.sector); label = s.sector; }
  peers = peers.sort((a, b) => (b.mcap || 0) - (a.mcap || 0));
  let top = peers.slice(0, 7);
  if (!top.some(r => r.t === s.t)) { const me = byT.get(s.t); if (me) top = [...top.slice(0, 6), me]; }
  document.getElementById('peer-sub').textContent = label ? label + ', by market cap' : '';
  document.getElementById('peers').innerHTML = top.length > 1 ? `<table class="mk tbl-peers"><thead><tr><th>Stock</th><th>1D</th><th>1M</th><th>YTD</th></tr></thead><tbody>
    ${top.map(r => `<tr class="${r.t === s.t ? 'me' : ''}"><td class="name"><a href="?t=${encodeURIComponent(r.t)}#stocks" data-t="${esc(r.t)}">${esc(r.t)}</a></td>${cell(fmtPct(r.chgPct), r.chgPct)}${cell(pct1(r.r1m), r.r1m)}${cell(pct1(r.ytd), r.ytd)}</tr>`).join('')}
    </tbody></table>` : '<p class="na">No peers in coverage.</p>';
  view.querySelectorAll('#peers a[data-t]').forEach(a => a.addEventListener('click', e => { e.preventDefault(); go(a.dataset.t); }));
}

let indexMeta = {};
async function route() {
  const t = (new URLSearchParams(location.search).get('t') || '').trim().toUpperCase();
  if (!t) { if (INDEX.length) landing(indexMeta); return; }
  view.innerHTML = '<p class="msg">Loading ' + esc(t) + '&hellip;</p>';
  const s = await getData(yfSym(t) + '.json');
  if (!s) {
    view.innerHTML = `<p class="msg">${esc(t)} isn't in coverage. The lookup covers U.S.-listed stocks above $250M in market cap; check the ticker or search by company name.</p>`;
    return;
  }
  renderStock(s);
  if (scrollOnRender) { window.showTab && window.showTab('stocks'); window.scrollTo(0, 0); }
  scrollOnRender = true;
}

getData('index.json').then(idx => {
  const hint = document.getElementById('hint');
  if (!idx) { hint.textContent = "Stock data isn't available right now. Try again in a few minutes."; return; }
  indexMeta = idx; INDEX = idx.stocks || [];
  INDEX.forEach(r => byT.set(r.t, r));
  hint.textContent = `${INDEX.length.toLocaleString()} U.S. stocks above $250M. Snapshot ${fmtET(idx.updated)}${idx.quotesUpdated && idx.quotesUpdated !== idx.updated ? ', prices ' + fmtET(idx.quotesUpdated) : ''}.`;
  route();
});

// Homepage hero ticker box: open the stock in the section below instead of leaving the page
const heroForm = document.querySelector('.hero-search');
if (heroForm) heroForm.addEventListener('submit', e => {
  e.preventDefault();
  const t = heroForm.querySelector('input').value.trim().toUpperCase();
  if (t) { heroForm.querySelector('input').value = ''; go(t); }
});
})();
