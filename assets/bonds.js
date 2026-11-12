/* Bonds tab: rates and credit desk view, Treasury auctions, bond ETFs and the yield compare tool. Needs charts.js. */
(() => {
const bpOf = v => v == null ? null : Math.round(v * 100);          // percent -> bp
const lvl = v => v == null ? '–' : v.toFixed(2) + '%';
const bpTxt = v => v == null ? '–' : Math.round(v) + 'bp';
const chgBp = v => v == null ? '–' : (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(Math.round(v)) + 'bp';
const ordinal = n => n + (['th', 'st', 'nd', 'rd'][(n % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th');
const bil = v => v == null ? 'TBA' : '$' + (v / 1e9).toFixed(0) + 'B';
const rng = s => {
  if (!s || s.lo5y == null || s.hi5y == null || s.hi5y === s.lo5y) return '';
  const p = Math.max(0, Math.min(100, (s.value - s.lo5y) / (s.hi5y - s.lo5y) * 100));
  return `<span class="rng" title="5-year range ${s.lo5y} to ${s.hi5y}"><i style="left:${p}%"></i></span>`;
};

/* ---------------- desk read ---------------- */
function deskRead(b) {
  const S = b.rates?.series || {}, out = [];
  const T = Object.fromEntries((b.rates?.tenors || []).map(t => [t.tenor, t]));
  const s210 = S.T10Y2Y, s530 = S.S5S30;
  if (s210) {
    let t = `2s10s is ${bpOf(s210.value)}bp, ${s210.chg1m > 0 ? 'steeper' : s210.chg1m < 0 ? 'flatter' : 'unchanged'} by ${Math.abs(Math.round(s210.chg1m || 0))}bp over the month`;
    if (s530) t += `; 5s30s is ${bpOf(s530.value)}bp`;
    out.push(t + '.');
  }
  const n10 = T['10Y']?.nominal, r10 = T['10Y']?.real, be = S.T10YIE;
  if (n10 && r10 && be && n10.chg1m != null && r10.chg1m != null) {
    const realShare = r10.chg1m, beShare = n10.chg1m - r10.chg1m;
    out.push(`The 10Y is ${chgBp(n10.chg1m)} over the month at ${lvl(n10.value)}: real yields ${chgBp(realShare)} and breakevens ${chgBp(beShare)}, so the move is ${Math.abs(realShare) >= Math.abs(beShare) ? 'mostly real rates' : 'mostly inflation compensation'}.`);
  }
  const tp = S.THREEFYTP10;
  if (tp && tp.pct5y != null) out.push(`10Y term premium is ${tp.value.toFixed(2)}%, in the ${ordinal(tp.pct5y)} percentile of the past five years (Kim-Wright, as of ${fmtDay(tp.asOf)}).`);
  const cr = Object.fromEntries((b.credit?.ratings || []).map(r => [r.label, r]));
  const hy = cr['HY index']?.oas, ig = cr['IG index']?.oas;
  if (hy && ig) out.push(`High yield OAS is ${bpOf(hy.value)}bp (${chgBp(hy.chg1w)} this week, ${ordinal(hy.pct5y)} percentile) and IG is ${bpOf(ig.value)}bp (${ordinal(ig.pct5y)} percentile).`);
  const last = (b.auctions?.recent || [])[0];
  if (last && last.btcAvg6 != null && last.indirectAvg6 != null) {
    const strong = (last.btc >= last.btcAvg6) + (last.indirectPct >= last.indirectAvg6);
    out.push(`Last coupon auction, the ${last.label} on ${fmtDay(last.date)}: ${last.btc.toFixed(2)}x bid-to-cover vs ${last.btcAvg6.toFixed(2)}x six-auction average, indirects ${last.indirectPct.toFixed(1)}% vs ${last.indirectAvg6.toFixed(1)}%, ${strong === 2 ? 'stronger than recent' : strong === 0 ? 'softer than recent' : 'mixed against recent'} demand.`);
  }
  const nextC = (b.auctions?.upcoming || []).find(u => u.type !== 'Bill');
  if (nextC) out.push(`Next coupon supply: ${nextC.label} on ${fmtDay(nextC.date)}${nextC.size ? ', ' + bil(nextC.size) : ''}.`);
  return out;
}

/* ---------------- render ---------------- */
function render(b) {
  const meta = document.getElementById('bd-meta');
  if (!b) { meta.textContent = "Bond data isn't available right now."; return; }
  meta.textContent = 'Updated ' + fmtET(b.updated) + '. Rates at prior close.';
  const read = deskRead(b);
  document.getElementById('bd-read').innerHTML = read.length
    ? `<h2>Desk read</h2><ul>${read.map(t => `<li>${esc(t)}</li>`).join('')}</ul><p class="src">Generated from the figures on this tab.</p>` : '';

  // curve chart
  const c = b.rates?.curve;
  if (c) {
    document.getElementById('bd-curve-sub').textContent = 'as of ' + fmtDayYr(c.asOf);
    const sers = [
      { name: 'Nominal today', color: 'var(--s1)', ys: c.nominal, dots: true },
      { name: 'Nominal 1M ago', color: 'var(--s2)', ys: c.nominal1m },
      { name: 'Real (TIPS)', color: 'var(--s3)', ys: c.real, dash: true, dots: true },
    ];
    document.getElementById('bd-curve-legend').innerHTML = sers.map(s => `<span><i class="${s.dash ? 'dash' : ''}" style="background:${s.color};border-color:${s.color}"></i>${esc(s.name)}</span>`).join('');
    lineChart(document.getElementById('bd-curve'), { series: sers, xs: c.tenors, xLabel: t => t, yFmt: (v, ax) => v.toFixed(ax ? 1 : 2) + '%', height: 280 });
  }

  // tenor table
  const rows = (b.rates?.tenors || []).map(t => {
    const n = t.nominal || {}, r = t.real;
    return `<tr><td class="name">${esc(t.tenor)}</td><td>${lvl(n.value)}</td>${cell(chgBp(n.chg1d), n.chg1d)}${cell(chgBp(n.chg1w), n.chg1w)}${cell(chgBp(n.chg1m), n.chg1m)}${cell(chgBp(n.chg1y), n.chg1y)}<td>${r ? lvl(r.value) : '–'}</td></tr>`;
  }).join('');
  document.getElementById('bd-tenors').innerHTML = rows
    ? `<table class="mk"><thead><tr><th>Tenor</th><th>Yield</th><th>1D</th><th>1W</th><th>1M</th><th>1Y</th><th>Real</th></tr></thead><tbody>${rows}</tbody></table>` : '<p class="mk-empty">Unavailable.</p>';

  // policy, curve spreads, inflation
  const S = b.rates?.series || {};
  const sRow = (id, label, asBp) => {
    const s = S[id]; if (!s) return '';
    return `<tr><td class="name">${esc(label)}</td><td>${asBp ? bpOf(s.value) + 'bp' : lvl(s.value)}</td>${cell(chgBp(s.chg1w), s.chg1w)}${cell(chgBp(s.chg1m), s.chg1m)}<td class="rngcell">${rng(s)}</td><td class="pct">${s.pct5y != null ? ordinal(s.pct5y) : ''}</td></tr>`;
  };
  const grp = t => `<tr class="grp"><td colspan="6">${t}</td></tr>`;
  let target = '';
  if (S.DFEDTARL && S.DFEDTARU) target = `<tr><td class="name">Fed funds target</td><td>${S.DFEDTARL.value.toFixed(2)} to ${S.DFEDTARU.value.toFixed(2)}%</td>${cell(chgBp(S.DFEDTARU.chg1w), S.DFEDTARU.chg1w)}${cell(chgBp(S.DFEDTARU.chg1m), S.DFEDTARU.chg1m)}<td></td><td></td></tr>`;
  document.getElementById('bd-policy').innerHTML = `<table class="mk"><thead><tr><th>Measure</th><th>Level</th><th>1W</th><th>1M</th><th>5Y range</th><th>Pctile</th></tr></thead><tbody>
    ${grp('Policy and funding')}${target}${sRow('DFF', 'Effective fed funds')}${sRow('SOFR', 'SOFR')}${sRow('MORTGAGE30US', '30Y mortgage')}
    ${grp('Curve')}${sRow('T10Y3M', '3m10y', true)}${sRow('S2S5', '2s5s', true)}${sRow('T10Y2Y', '2s10s', true)}${sRow('S5S30', '5s30s', true)}${sRow('THREEFYTP10', '10Y term premium')}
    ${grp('Inflation')}${sRow('T5YIE', '5Y breakeven')}${sRow('T10YIE', '10Y breakeven')}${sRow('T5YIFR', '5y5y forward')}
    </tbody></table>`;

  // credit by rating
  const cr = b.credit?.ratings || [];
  const order = ['AAA', 'AA', 'A', 'BBB', 'IG index', 'BB', 'B', 'CCC and below', 'HY index', 'EM corporate'];
  const crRow = r => `<tr><td class="name">${esc(r.label)}</td><td>${bpTxt(bpOf(r.oas.value))}</td>${cell(chgBp(r.oas.chg1w), r.oas.chg1w)}${cell(chgBp(r.oas.chg1m), r.oas.chg1m)}${cell(chgBp(r.oas.chg1y), r.oas.chg1y)}<td>${r.yield ? lvl(r.yield.value) : ''}</td><td class="rngcell">${rng(r.oas)}</td><td class="pct">${r.oas.pct5y != null ? ordinal(r.oas.pct5y) : ''}</td></tr>`;
  const byL = Object.fromEntries(cr.map(r => [r.label, r]));
  const bucket = (title, labels) => grp(title).replace('colspan="6"', 'colspan="8"') + labels.filter(l => byL[l]).map(l => crRow(byL[l])).join('');
  document.getElementById('bd-credit').innerHTML = cr.length ? `<table class="mk"><thead><tr><th>Rating</th><th>OAS</th><th>1W</th><th>1M</th><th>1Y</th><th>Yield</th><th>5Y range</th><th>Pctile</th></tr></thead><tbody>
    ${bucket('Investment grade', order.slice(0, 5))}${bucket('High yield', order.slice(5, 9))}${bucket('Emerging markets', order.slice(9))}</tbody></table>` : '<p class="mk-empty">Unavailable.</p>';
  const H = b.credit?.history || {};
  if (H.BAMLH0A0HYM2) {
    const hy = H.BAMLH0A0HYM2, igm = Object.fromEntries((H.BAMLC0A0CM || []).map(p => [p[0], p[1]]));
    lineChart(document.getElementById('bd-credit-chart'), {
      series: [{ name: 'HY OAS', color: 'var(--s1)', ys: hy.map(p => p[1]) }, { name: 'IG OAS', color: 'var(--s2)', ys: hy.map(p => igm[p[0]] ?? null) }],
      xs: hy.map(p => p[0]), xLabel: (d, full) => full ? fmtDayYr(d) : new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
      xTicks: dateTicks, yFmt: (v, ax) => Math.round(v) + (ax ? '' : 'bp'), height: 200,
    });
  }

  // auctions
  const A = b.auctions || {};
  const vs = (v, avg, d = 2, sfx = '') => {
    if (v == null) return '<td>–</td>';
    const cls = avg == null ? '' : v > avg ? 'strong' : v < avg ? 'weak' : '';
    return `<td class="${cls}">${v.toFixed(d)}${sfx}<small style="color:var(--muted);font-weight:400"> ${avg != null ? avg.toFixed(d) + sfx : ''}</small></td>`;
  };
  const yld = r => r.highYield == null ? '–' : r.yieldIsMargin ? (r.highYield * 100).toFixed(1) + 'bp DM' : r.highYield.toFixed(3) + '%';
  const yChg = r => (r.highYield != null && r.priorYield != null && !r.yieldIsMargin) ? cell(chgBp((r.highYield - r.priorYield) * 100), r.highYield - r.priorYield) : '<td>–</td>';
  document.getElementById('bd-auctions').innerHTML = (A.recent || []).length ? `<div class="mk-table-wrap"><table class="mk"><thead><tr><th>Auction</th><th>Date</th><th>High yield</th><th>vs prior</th><th>Bid-to-cover</th><th>Indirect</th><th>Dealer</th><th>Size</th></tr></thead><tbody>
    ${A.recent.map(r => `<tr><td class="name">${esc(r.label)}</td><td>${fmtDay(r.date)}</td><td>${yld(r)}</td>${yChg(r)}${vs(r.btc, r.btcAvg6)}${vs(r.indirectPct, r.indirectAvg6, 1, '%')}<td>${r.dealerPct != null ? r.dealerPct.toFixed(1) + '%' : '–'}</td><td>${bil(r.size)}</td></tr>`).join('')}
    </tbody></table></div><p class="auc-note">Small figures are the average of the prior six auctions of the same security. Blue is stronger than that average, red is weaker. Dealer share is what primary dealers had to take down; higher usually means weaker end demand.</p>` : '<p class="mk-empty">No recent coupon auctions.</p>';
  document.getElementById('bd-upcoming').innerHTML = (A.upcoming || []).length
    ? `<ul class="up-list">${A.upcoming.map(u => `<li class="${u.type !== 'Bill' ? 'coupon' : ''}"><span class="d">${fmtDay(u.date)}</span><span class="l">${esc(u.label)}</span><span class="s">${bil(u.size)}</span></li>`).join('')}</ul>`
    : '<p class="mk-empty">Nothing announced.</p>';

  // ETFs
  const E = b.etfs || [];
  document.getElementById('bd-etfs').innerHTML = E.length ? `<div class="mk-table-wrap"><table class="mk"><thead><tr><th>ETF</th><th>Exposure</th><th>Last</th><th>1D</th><th>1M</th><th>YTD</th><th>Yield</th></tr></thead><tbody>
    ${E.map(e => `<tr><td class="name">${esc(e.t)}</td><td style="text-align:left;color:var(--muted)">${esc(e.name)}</td><td>${fmtNum(e.last)}</td>${cell(fmtPct(e.chgPct), e.chgPct)}${cell(fmtPct(e.r1m), e.r1m)}${cell(fmtPct(e.ytd), e.ytd)}<td>${e.yield != null ? e.yield.toFixed(2) + '%' : '–'}</td></tr>`).join('')}
    </tbody></table></div>` : '<p class="mk-empty">Unavailable.</p>';
}

/* ---------------- compare tool ---------------- */
// Each slot has its own color (validated per theme) and its own dash pattern, so identity never rests on color alone
const SLOTS = [  // --c1..--c4 are set per theme in site.css
  { color: 'var(--c1)', dash: '' }, { color: 'var(--c2)', dash: '7 4' },
  { color: 'var(--c3)', dash: '2 3' }, { color: 'var(--c4)', dash: '9 3 2 3' },
];
const RANGES = [['1M', 31], ['3M', 92], ['6M', 183], ['YTD', 'ytd'], ['1Y', 366], ['2Y', 731], ['5Y', 1830]];
const GROUP_ORDER = ['Treasuries', 'Real yields', 'Inflation', 'Policy and funding', 'Mortgages', 'Corporate yields'];
const cmp = { picked: [], range: '1Y', mode: 'level' };  // picked: [{id, slot}]
let H = null;

const swatch = slot => `<svg viewBox="0 0 22 6" aria-hidden="true"><line x1="1" y1="3" x2="21" y2="3" stroke="${SLOTS[slot].color}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="${SLOTS[slot].dash}"/></svg>`;

function cmpLoadState() {
  try {
    const s = JSON.parse(localStorage.getItem('crg-cmp') || 'null');
    if (s && Array.isArray(s.ids)) { cmp.range = s.range || cmp.range; cmp.mode = s.mode || cmp.mode; return s.ids; }
  } catch (e) {}
  return null;
}
function cmpSave() {
  try { localStorage.setItem('crg-cmp', JSON.stringify({ ids: cmp.picked.map(p => p.id), range: cmp.range, mode: cmp.mode })); } catch (e) {}
}

function cmpPick(id) {
  const i = cmp.picked.findIndex(p => p.id === id);
  if (i >= 0) cmp.picked.splice(i, 1);
  else if (cmp.picked.length < 4) {
    const used = new Set(cmp.picked.map(p => p.slot));
    cmp.picked.push({ id, slot: [0, 1, 2, 3].find(s => !used.has(s)) });  // color stays with the series
  }
  cmpSave(); cmpDraw();
}

function cmpPicker() {
  const groups = {};
  Object.entries(H.series).forEach(([id, s]) => (groups[s.group] = groups[s.group] || []).push([id, s]));
  const el = document.getElementById('cmp-picker');
  el.innerHTML = `<label class="cmp-add"><span class="sr-only">Add a series</span>
      <select id="cmp-select" aria-label="Add a series to the chart"><option value="">Add a series&hellip;</option>
      ${GROUP_ORDER.filter(g => groups[g]).map(g => `<optgroup label="${esc(g)}">${groups[g].map(([id, s]) => `<option value="${esc(id)}">${esc(s.label)}</option>`).join('')}</optgroup>`).join('')}
      </select></label>
    <div class="cmp-tags" id="cmp-tags"></div>`;
  const sel = document.getElementById('cmp-select');
  sel.addEventListener('change', () => { if (sel.value) cmpPick(sel.value); sel.value = ''; });
}

function cmpDraw() {
  const full = cmp.picked.length >= 4;
  const selEl = document.getElementById('cmp-select');
  selEl.disabled = full;
  selEl.options[0].textContent = full ? 'Four series max: remove one to add another' : 'Add a series\u2026';
  [...selEl.querySelectorAll('option[value]')].forEach(o => { if (o.value) o.disabled = cmp.picked.some(p => p.id === o.value); });
  const tags = document.getElementById('cmp-tags');
  tags.innerHTML = cmp.picked.map(p => `<span class="tag">${swatch(p.slot)}${esc(H.series[p.id].label)}<button type="button" data-id="${esc(p.id)}" aria-label="Remove ${esc(H.series[p.id].label)}">&times;</button></span>`).join('');
  tags.querySelectorAll('button').forEach(b => b.addEventListener('click', () => cmpPick(b.dataset.id)));
  document.querySelectorAll('#cmp-range button').forEach(b => b.classList.toggle('on', b.dataset.r === cmp.range));
  document.querySelectorAll('#cmp-mode button').forEach(b => b.classList.toggle('on', b.dataset.m === cmp.mode));

  const chartEl = document.getElementById('cmp-chart'), hint = document.getElementById('cmp-hint');
  const legend = document.getElementById('cmp-legend'), table = document.getElementById('cmp-table');
  const sel = cmp.picked;
  const need = cmp.mode === 'spread' ? 2 : 1;
  if (sel.length < need) {
    chartEl.innerHTML = ''; legend.innerHTML = ''; table.innerHTML = '';
    hint.textContent = cmp.mode === 'spread' ? 'Pick two series. The chart shows the first minus the second, in basis points.' : 'Pick up to four series to compare.';
    return;
  }

  // date window
  const D = H.dates, last = D[D.length - 1];
  const r = RANGES.find(x => x[0] === cmp.range)[1];
  const from = r === 'ytd' ? last.slice(0, 4) + '-01-01' : new Date(new Date(last + 'T12:00:00') - r * 864e5).toISOString().slice(0, 10);
  let i0 = D.findIndex(d => d >= from); if (i0 < 0) i0 = 0;
  const xs = D.slice(i0);
  const valsOf = id => H.series[id].v.slice(i0);

  let series, yFmt, rowsHtml;
  if (cmp.mode === 'spread') {
    const [a, b] = sel, va = valsOf(a.id), vb = valsOf(b.id);
    const ys = va.map((x, i) => x != null && vb[i] != null ? Math.round((x - vb[i]) * 1000) / 10 : null);
    const name = `${H.series[a.id].label} minus ${H.series[b.id].label}`;
    series = [{ name, color: SLOTS[a.slot].color, dash: SLOTS[a.slot].dash, ys }];
    yFmt = (v, ax) => (ax ? Math.round(v) : v.toFixed(0)) + (ax ? '' : 'bp');
    const nn = ys.filter(v => v != null), first = ys.find(v => v != null), lastV = [...ys].reverse().find(v => v != null);
    rowsHtml = nn.length ? `<tr><td class="name">${esc(name)}</td><td>${Math.round(lastV)}bp</td>${cell(chgBp(lastV - first), lastV - first)}<td>${Math.round(Math.min(...nn))}bp</td><td>${Math.round(Math.max(...nn))}bp</td></tr>` : '';
    hint.textContent = sel.length > 2 ? 'Spread uses the first two series you picked.' : '';
  } else {
    series = sel.map(p => {
      const v = valsOf(p.id);
      let ys = v;
      if (cmp.mode === 'change') { const b0 = v.find(x => x != null); ys = v.map(x => x == null || b0 == null ? null : Math.round((x - b0) * 1000) / 10); }
      return { name: H.series[p.id].label, color: SLOTS[p.slot].color, dash: SLOTS[p.slot].dash, ys, raw: v };
    });
    yFmt = cmp.mode === 'change' ? (v, ax) => (v > 0 ? '+' : '') + (ax ? Math.round(v) : v.toFixed(0)) + (ax ? '' : 'bp') : (v, ax) => v.toFixed(ax ? 1 : 2) + '%';
    rowsHtml = series.map(s => {
      const nn = s.raw.filter(v => v != null); if (!nn.length) return '';
      const first = s.raw.find(v => v != null), lastV = [...s.raw].reverse().find(v => v != null), ch = (lastV - first) * 100;
      return `<tr><td class="name">${esc(s.name)}</td><td>${lvl(lastV)}</td>${cell(chgBp(ch), ch)}<td>${lvl(Math.min(...nn))}</td><td>${lvl(Math.max(...nn))}</td></tr>`;
    }).join('');
    const short = sel.filter(p => H.series[p.id].group === 'Corporate yields').length && ['5Y'].includes(cmp.range);
    hint.textContent = short ? 'Corporate yield history on FRED goes back three years.' : '';
  }
  legend.innerHTML = series.map((s, i) => `<span>${swatch(cmp.mode === 'spread' ? sel[0].slot : sel[i].slot)}${esc(s.name)}</span>`).join('');
  const fmtX = (d, full) => full ? fmtDayYr(d) : (xs.length > 400 ? new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', year: '2-digit' }) : fmtDay(d));
  lineChart(chartEl, { series, xs, xLabel: fmtX, xTicks: dateTicks, yFmt, height: 320, zero: cmp.mode !== 'level' });
  // only one redraw entry for this chart: drop the one from the previous draw
  table.innerHTML = rowsHtml ? `<table class="mk"><thead><tr><th>Series</th><th>Latest</th><th>Change, ${esc(cmp.range)}</th><th>Low</th><th>High</th></tr></thead><tbody>${rowsHtml}</tbody></table>` : '';
}

function cmpInit(h) {
  if (!h) { document.getElementById('cmp-hint').textContent = "Yield history isn't available right now."; return; }
  H = h;
  cmpPicker();
  document.getElementById('cmp-range').innerHTML = RANGES.map(([k]) => `<button type="button" data-r="${k}">${k}</button>`).join('');
  document.querySelectorAll('#cmp-range button').forEach(b => b.addEventListener('click', () => { cmp.range = b.dataset.r; cmpSave(); cmpDraw(); }));
  document.querySelectorAll('#cmp-mode button').forEach(b => b.addEventListener('click', () => { cmp.mode = b.dataset.m; cmpSave(); cmpDraw(); }));
  const saved = cmpLoadState();
  (saved && saved.length ? saved : ['DGS2', 'DGS10', 'BAMLC0A4CBBBEY']).filter(id => H.series[id]).slice(0, 4).forEach((id, i) => cmp.picked.push({ id, slot: i }));
  cmpDraw();
}

(window.CRG && window.CRG.bonds ? window.CRG.bonds : getJSON('data/bonds.json')).then(render);
// history is ~300KB: fetch it the first time the Bonds tab is opened
let histLoaded = false;
const loadHist = () => { if (histLoaded) return; histLoaded = true; getJSON('data/bond_history.json').then(cmpInit); };
if (!document.getElementById('bonds').hidden) loadHist();
window.addEventListener('tabshow', e => { if (e.detail === 'bonds') loadHist(); });
})();
