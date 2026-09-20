/* odbfish.js — ODB 水文（CTD／ADCP）與拖網漁場時空相關分析分頁
   資料：data/odb_fishery.json（離線以 Python 產製：ODB 0.25° 氣候場、VDR 網格作業量、NOAA CRW CoralTemp v3.1 每日 5 km 海溫） */
(function () {
'use strict';
var $ = function (s) { return document.querySelector(s); };
var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };
var O = null, loading = null, cur = null, built = {};
var PAGES = { odb: 1, fsst: 1, fodb: 1 };
var PN = { 13: '冬', 14: '春', 15: '夏', 16: '秋', 17: '東北季風', 18: '西南季風', 0: '全年' };
var fmt = function (x, d) { return (x === null || x === undefined || x !== x) ? '—' : Number(x).toFixed(d === undefined ? 2 : d); };
var css = function (n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); };

/* ---------- 調色盤 ---------- */
function ramp(st) { return function (t) { if (t !== t) return null; t = Math.max(0, Math.min(1, t)); var i = Math.min(st.length - 2, Math.floor(t * (st.length - 1))), f = t * (st.length - 1) - i, a = st[i], b = st[i + 1]; return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]; }; }
var PAL = {
  sst: ramp([[8,24,64],[24,80,160],[40,150,190],[90,196,160],[190,216,104],[250,208,64],[244,140,44],[214,64,36],[150,20,28]]),
  div: ramp([[27,74,140],[62,126,190],[132,183,220],[205,226,238],[244,244,240],[248,214,186],[236,150,110],[206,80,52],[140,26,22]]),
  seq: ramp([[12,32,48],[24,74,102],[36,124,140],[92,172,140],[176,206,116],[244,214,96],[240,146,58],[196,58,40]]),
  sal: ramp([[40,30,90],[50,80,150],[40,140,170],[80,190,160],[190,220,120],[250,230,140]])
};
var rgb = function (c) { return 'rgb(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ')'; };
function prep(cv, w, h) { var d = window.devicePixelRatio || 1; cv.width = Math.round(w * d); cv.height = Math.round(h * d); cv.style.width = w + 'px'; cv.style.height = h + 'px'; var g = cv.getContext('2d'); g.setTransform(d, 0, 0, d, 0, 0); g.clearRect(0, 0, w, h); return g; }
function cw(el) { return Math.max(320, el.getBoundingClientRect().width || 800); }
function legend(cv, lo, hi, pal, el, unit, d) { var g = cv.getContext('2d'); for (var i = 0; i < cv.width; i++) { g.fillStyle = rgb(pal(i / (cv.width - 1))); g.fillRect(i, 0, 1, cv.height); } el.textContent = fmt(lo, d) + ' — ' + fmt(hi, d) + ' ' + unit; }

/* ---------- SVG 小工具 ---------- */
var NS = 'http://www.w3.org/2000/svg';
function S(t, a, p) { var e = document.createElementNS(NS, t); for (var k in a) e.setAttribute(k, a[k]); if (p) p.appendChild(e); return e; }
function sc(d0, d1, r0, r1) { return function (v) { return r0 + (v - d0) / (d1 - d0) * (r1 - r0); }; }
function ticks(a, b, n) { var st = Math.pow(10, Math.floor(Math.log10((b - a) / n))); var e = [1, 2, 2.5, 5, 10].map(function (m) { return m * st; }).find(function (s) { return (b - a) / s <= n; }) || st * 10; var o = []; for (var v = Math.ceil(a / e) * e; v <= b + 1e-9; v += e) o.push(+v.toFixed(6)); return o; }
function frame(el, w, h) { el.innerHTML = ''; return S('svg', { viewBox: '0 0 ' + w + ' ' + h, role: 'img' }, el); }
function axY(s, y, vals, x0, x1, f, right) { vals.forEach(function (v) { S('line', { x1: x0, x2: x1, y1: y(v), y2: y(v), stroke: css('--line') }, s); T(s, right ? x1 + 6 : x0 - 6, y(v) + 4, f ? f(v) : v, { 'text-anchor': right ? 'start' : 'end' }); }); }
function T(s, x, y, str, a) { var t = S('text', Object.assign({ x: x, y: y }, a || {}), s); t.textContent = str; return t; }
function segOn(sel) { var b = $$(sel + ' button').filter(function (x) { return x.classList.contains('on'); })[0]; return b ? (b.dataset.m || b.dataset.l) : null; }
function seg(sel, cb) { var el = $(sel); el.onclick = function (e) { var b = e.target.closest('button'); if (!b) return; $$(sel + ' button').forEach(function (x) { x.classList.toggle('on', x === b); }); cb(b.dataset.m || b.dataset.l); }; }
function bars(el, cats, series, opt) {
  var w = 600, h = 290, L = 48, s = frame(el, w, h), mx = opt.max || Math.max.apply(null, series.reduce(function (a, x) { return a.concat(x.v); }, [])) * 1.1;
  var y = sc(0, mx, 245, 30); axY(s, y, ticks(0, mx, 4), L, w - 10, opt.f);
  var gw = (w - L - 20) / cats.length;
  cats.forEach(function (c, i) {
    series.forEach(function (se, j) { var bw = (gw - 16) / series.length, x0 = L + 10 + i * gw + j * bw, v = se.v[i] || 0;
      S('rect', { x: x0, width: bw - 3, y: y(v), height: 245 - y(v), fill: se.c }, s);
      if (opt.lab) T(s, x0 + bw / 2 - 1, y(v) - 5, opt.lab(v), { 'text-anchor': 'middle' }); });
    T(s, L + 10 + i * gw + (gw - 16) / 2, 264, c, { 'text-anchor': 'middle', style: 'font-size:12px;fill:' + css('--fg') });
    if (opt.sub) T(s, L + 10 + i * gw + (gw - 16) / 2, 280, opt.sub[i], { 'text-anchor': 'middle' });
  });
  series.forEach(function (se, j) { S('rect', { x: L + 10 + j * 120, y: 8, width: 12, height: 8, fill: se.c }, s); T(s, L + 26 + j * 120, 16, se.n, { style: 'fill:' + css('--fg') }); });
}

/* ---------- 陸地遮罩（0.01°，116–128E、18–32N） ---------- */
var LAND = null;
function loadLand() { return new Promise(function (res) { var img = new Image(); img.onload = function () { var c = document.createElement('canvas'); c.width = img.width; c.height = img.height; var g = c.getContext('2d'); g.drawImage(img, 0, 0); var d = g.getImageData(0, 0, c.width, c.height), o = g.createImageData(c.width, c.height); for (var i = 0; i < c.width * c.height; i++) { if (d.data[i * 4] > 127) { o.data[i*4] = 52; o.data[i*4+1] = 64; o.data[i*4+2] = 78; o.data[i*4+3] = 255; } } g.putImageData(o, 0, 0); LAND = c; res(); }; img.onerror = function () { res(); }; img.src = 'data/land_mask.png'; }); }
function drawLand(g, lon0, lon1, lat0, lat1, W, H) { if (!LAND) return; g.drawImage(LAND, (lon0 - 116) / 0.01, (32 - lat1) / 0.01, (lon1 - lon0) / 0.01, (lat1 - lat0) / 0.01, 0, 0, W, H); }
function grat(g, lon0, lon1, lat0, lat1, W, H, step) {
  g.save(); g.strokeStyle = 'rgba(200,220,235,.18)'; g.fillStyle = 'rgba(200,220,235,.75)'; g.font = '11px ' + css('--mono'); g.setLineDash([3, 5]);
  for (var lo = Math.ceil(lon0); lo <= lon1; lo += step) { var x = (lo - lon0) / (lon1 - lon0) * W; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); g.fillText(lo + '°E', x + 3, H - 5); }
  for (var la = Math.ceil(lat0); la <= lat1; la += step) { var y = H - (la - lat0) / (lat1 - lat0) * H; g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); g.fillText(la + '°N', 4, y - 4); }
  g.restore();
}

function drawFsLt() {
  var L0 = V.lt, yrs = L0.years, A = L0.ann_anom_foot, n = yrs.length, w = 1100, h = 300, L = 46, R = 20, s = frame($('#fsLt'), w, h);
  var x = sc(yrs[0] - .5, yrs[n - 1] + .5, L, w - R), y = sc(-1.2, 1.2, 262, 20);
  axY(s, y, [-1, -0.5, 0, 0.5, 1], L, w - R, function (v) { return (v > 0 ? '+' : '') + v + '°'; });
  var mA = L0.anom_foot; mA.forEach(function (v, i) { }); var d = ''; L0.ym.forEach(function (k, i) { var v = mA[i]; if (v == null) return; var t = +k.slice(0, 4) + (+k.slice(5) - .5) / 12 - .5; if (t > yrs[n - 1] + .5) return; d += (d ? 'L' : 'M') + x(t).toFixed(1) + ',' + y(Math.max(-1.2, Math.min(1.2, v))).toFixed(1); });
  A.forEach(function (v, i) { if (v == null) return; S('rect', { x: x(yrs[i]) - 9, width: 18, y: Math.min(y(v), y(0)), height: Math.abs(y(v) - y(0)), fill: v > 0 ? css('--warm') : css('--acc'), opacity: .75 }, s); });
  S('path', { d: d, fill: 'none', stroke: css('--dim'), 'stroke-width': 1, opacity: .6 }, s);
  var tr = L0.trend['全年_足跡'], my = yrs.reduce(function (a, b) { return a + b; }, 0) / n, ma = A.reduce(function (a, b) { return a + b; }, 0) / n, sl = tr.slope_dec / 10;
  S('line', { x1: x(yrs[0]), y1: y(ma + sl * (yrs[0] - my)), x2: x(yrs[n - 1]), y2: y(ma + sl * (yrs[n - 1] - my)), stroke: css('--fg'), 'stroke-width': 2, 'stroke-dasharray': '6 4' }, s);
  yrs.forEach(function (yv) { if (yv % 5 === 0) T(s, x(yv), 284, yv, { 'text-anchor': 'middle' }); });
  [[css('--warm'), '年均距平（暖）'], [css('--acc'), '年均距平（冷）'], [css('--dim'), '月距平'], [css('--fg'), '線性趨勢']].forEach(function (a, i) { S('rect', { x: L + 20 + i * 140, y: 6, width: 14, height: 4, fill: a[0] }, s); T(s, L + 38 + i * 140, 11, a[1], { style: 'fill:' + css('--fg') }); });
  var TT = L0.trend, sea = ['冬', '春', '夏', '秋'];
  $('#fsLtCap').innerHTML = '範圍為 VDR 船隊足跡涵蓋的 0.05° 網格。年均距平線性趨勢 <b class="mono">+' + fmt(tr.slope_dec) + ' ± ' + fmt(tr.ci95) + '°C／10 年</b>（Sen 斜率 +' + fmt(tr.sen_dec) + '，Mann–Kendall p &lt; 0.001；殘差一階自相關 ' + fmt(tr.r1) + '，有效樣本數約 ' + Math.round(tr.neff) + '）。各季：' + sea.map(function (k) { return k + ' +' + fmt(TT[k + '_足跡'].slope_dec); }).join('、') + '°C／10 年。作業熱點（Gi* &gt; 2.58）+' + fmt(TT['全年_熱點'].slope_dec) + '°C／10 年，整個 22–28°N、119–125°E 範圍平均 +' + fmt(L0.trendmap_dom) + '°C／10 年。';
}

/* ================= ODB 水文 ================= */
var VINFO = {
  T0: ['表層水溫', '°C', 'sst', 1], T100: ['100 m 水溫', '°C', 'sst', 1], Tb: ['最深觀測層水溫', '°C', 'sst', 1],
  S0: ['表層鹽度', 'psu', 'sal', 2], S100: ['100 m 鹽度', 'psu', 'sal', 2], Sb: ['最深觀測層鹽度', 'psu', 'sal', 2],
  dT50: ['表層−50 m 溫差', '°C', 'seq', 1], MLD: ['混合層深度', 'm', 'seq', 0], N2max: ['最大 N²', 's⁻²', 'seq', 4],
  spd0: ['近表層流速', 'm/s', 'seq', 2], spd100: ['100 m 流速', 'm/s', 'seq', 2], eke0: ['EKE', 'm²/s²', 'seq', 2],
  vort: ['相對渦度', '10⁻⁶ s⁻¹', 'div', 1], div: ['水平散度', '10⁻⁶ s⁻¹', 'div', 1], shear: ['垂直剪切', '(m/s)/km', 'seq', 1],
  sst: ['衛星海溫', '°C', 'sst', 1], ffreq: ['鋒面出現頻率', '', 'seq', 2]
};
var odbSt = { p: 13, v: 'T100', pt: null };
function rangeOf(v) {
  var all = []; O.odb.periods.forEach(function (p) { if (v.match(/^T|sst/) && p === 0) return; (O.odb.f[v][p] || []).forEach(function (x) { if (x !== null) all.push(x); }); });
  all.sort(function (a, b) { return a - b; }); var q = function (f) { return all[Math.floor(f * (all.length - 1))]; };
  var lo = q(0.02), hi = q(0.98); if (VINFO[v][2] === 'div') { var m = Math.max(Math.abs(lo), Math.abs(hi)); lo = -m; hi = m; }
  if (v === 'Tb') { lo = 10; }
  return [lo, hi];
}
function odbGeo() { var la = O.odb.lat, lo = O.odb.lon; return { nx: lo.length, ny: la.length, lon0: lo[0] - 0.125, lon1: lo[lo.length - 1] + 0.125, lat0: la[0] - 0.125, lat1: la[la.length - 1] + 0.125 }; }
function drawOdbMap() {
  var cv = $('#odbMap'), G = odbGeo(), asp = 1 / Math.cos(25 * Math.PI / 180);
  var W = Math.min(cw(cv.parentNode) - 4, 640), H = Math.round(W * asp); if (H > 700) { H = 700; W = Math.round(H / asp); }
  var g = prep(cv, W, H), v = odbSt.v, p = odbSt.p, arr = O.odb.f[v][p], r = rangeOf(v), pal = PAL[VINFO[v][2]];
  var cwid = W / G.nx, ch = H / G.ny;
  g.fillStyle = '#0a1219'; g.fillRect(0, 0, W, H);
  for (var j = 0; j < G.ny; j++) for (var i = 0; i < G.nx; i++) { var x = arr[j * G.nx + i]; if (x === null) continue; g.fillStyle = rgb(pal((x - r[0]) / (r[1] - r[0]))); g.fillRect(i * cwid, H - (j + 1) * ch, Math.ceil(cwid), Math.ceil(ch)); }
  drawLand(g, G.lon0, G.lon1, G.lat0, G.lat1, W, H);
  grat(g, G.lon0, G.lon1, G.lat0, G.lat1, W, H, 1);
  // 足跡外框
  g.save(); g.strokeStyle = 'rgba(159,211,199,.55)'; g.lineWidth = 1;
  O.odb.foot.forEach(function (f, k) { if (!(f > 0)) return; var i = k % G.nx, j = Math.floor(k / G.nx); g.strokeRect(i * cwid + .5, H - (j + 1) * ch + .5, cwid - 1, ch - 1); }); g.restore();
  if ($('#odbVec').checked) { var U = O.odb.f.u0[p], V = O.odb.f.v0[p]; g.save(); g.strokeStyle = 'rgba(255,255,255,.9)'; g.fillStyle = 'rgba(255,255,255,.9)'; g.lineWidth = 1.2;
    for (var k = 0; k < U.length; k++) { if (U[k] === null) continue; var i2 = k % G.nx, j2 = Math.floor(k / G.nx), cx = (i2 + .5) * cwid, cy = H - (j2 + .5) * ch, s2 = cwid * 0.9, dx = U[k] * s2, dy = -V[k] * s2, L = Math.hypot(dx, dy); if (L < 1) continue;
      g.beginPath(); g.moveTo(cx - dx / 2, cy - dy / 2); g.lineTo(cx + dx / 2, cy + dy / 2); g.stroke(); var a = Math.atan2(dy, dx); g.beginPath(); g.moveTo(cx + dx / 2, cy + dy / 2); g.lineTo(cx + dx / 2 - 5 * Math.cos(a - .45), cy + dy / 2 - 5 * Math.sin(a - .45)); g.lineTo(cx + dx / 2 - 5 * Math.cos(a + .45), cy + dy / 2 - 5 * Math.sin(a + .45)); g.fill(); }
    g.restore(); }
  if ($('#odbEff').checked) { var E = O.odb.f.eff[p]; g.save(); g.strokeStyle = '#fff'; g.lineWidth = 1.6;
    E.forEach(function (e, k) { if (!(e > 1)) return; var i3 = k % G.nx, j3 = Math.floor(k / G.nx); g.beginPath(); g.arc((i3 + .5) * cwid, H - (j3 + .5) * ch, Math.min(cwid * .8, 2 + Math.sqrt(e) * 0.45), 0, 6.283); g.stroke(); }); g.restore(); }
  if ($('#odbAx').checked && O.axis[p]) { g.save(); g.fillStyle = '#ffd54f'; O.axis[p].forEach(function (q) { var x = (q[0] - G.lon0) / (G.lon1 - G.lon0) * W, y = H - (q[1] - G.lat0) / (G.lat1 - G.lat0) * H; g.beginPath(); g.arc(x, y, 3.5, 0, 6.283); g.fill(); }); g.restore(); }
  if (odbSt.pt !== null) { var i4 = odbSt.pt % G.nx, j4 = Math.floor(odbSt.pt / G.nx); g.strokeStyle = '#ffd54f'; g.lineWidth = 2; g.strokeRect(i4 * cwid, H - (j4 + 1) * ch, cwid, ch); }
  legend($('#odbLeg'), r[0], r[1], pal, $('#odbLegTxt'), VINFO[v][1], VINFO[v][3]);
  cv._geo = { W: W, H: H };
}
function odbCell(e) { var cv = $('#odbMap'), G = odbGeo(), r = cv.getBoundingClientRect(); var i = Math.floor((e.clientX - r.left) / r.width * G.nx), j = Math.floor((1 - (e.clientY - r.top) / r.height) * G.ny); if (i < 0 || j < 0 || i >= G.nx || j >= G.ny) return null; return j * G.nx + i; }
function drawProf() {
  var cv = $('#odbProf'), W = cw(cv.parentNode) - 4, H = 360, g = prep(cv, W, H);
  if (odbSt.pt === null) { g.fillStyle = css('--dim'); g.font = '13px sans-serif'; g.fillText('點選左圖任一格點，顯示該點剖面。', 12, 30); return; }
  var G = odbGeo(), lo = O.odb.lon[odbSt.pt % G.nx], la = O.odb.lat[Math.floor(odbSt.pt / G.nx)], key = odbSt.p + '|' + lo.toFixed(2) + '|' + la.toFixed(2);
  $('#odbPtLbl').textContent = lo.toFixed(2) + '°E ' + la.toFixed(2) + 'N · ' + PN[odbSt.p];
  var c = O.prof.ctd[key] || [], a = O.prof.adcp[key] || [];
  var zmax = Math.max(50, c.length ? c[c.length - 1][0] : 0, a.length ? a[a.length - 1][0] : 0); zmax = Math.min(300, Math.ceil(zmax / 50) * 50);
  var half = W / 2, m = { l: 40, r: 12, t: 26, b: 28 }, y = function (z) { return m.t + z / zmax * (H - m.t - m.b); };
  g.font = '11px ' + css('--mono'); g.strokeStyle = css('--line'); g.fillStyle = css('--dim');
  [0, 1].forEach(function (k) { var x0 = k * half + m.l, x1 = (k + 1) * half - m.r; g.strokeRect(x0, m.t, x1 - x0, H - m.t - m.b); for (var z = 0; z <= zmax; z += 50) { g.fillText(z + 'm', k * half + 4, y(z) + 4); } });
  function plot(pts, xi, lo2, hi2, k, col, lab) { if (!pts.length) return; var x0 = k * half + m.l, x1 = (k + 1) * half - m.r, X = function (v) { return x0 + (v - lo2) / (hi2 - lo2) * (x1 - x0); };
    g.strokeStyle = col; g.lineWidth = 2; g.beginPath(); pts.forEach(function (q, i) { var px = X(q[xi]), py = y(Math.min(q[0], zmax)); i ? g.lineTo(px, py) : g.moveTo(px, py); }); g.stroke(); g.fillStyle = col; g.fillText(lab + ' ' + fmt(lo2, 1) + '–' + fmt(hi2, 1), x0 + 4, m.t - 8 - (xi === 2 && k === 0 ? 0 : 0)); }
  if (c.length) { var ts = c.map(function (q) { return q[1]; }), ss = c.map(function (q) { return q[2]; });
    var t0 = Math.floor(Math.min.apply(null, ts)), t1 = Math.ceil(Math.max.apply(null, ts)), s0 = Math.min.apply(null, ss) - .05, s1 = Math.max.apply(null, ss) + .05;
    plot(c, 1, t0, t1, 0, '#ff9e5e', 'T°C'); g.save(); g.translate(0, 12); plot(c, 2, s0, s1, 0, '#4fc3f7', 'S'); g.restore(); }
  else { g.fillStyle = css('--dim'); g.fillText('此格點本時段無 CTD', m.l + 6, 60); }
  if (a.length) { var mx = Math.max(0.3, Math.max.apply(null, a.map(function (q) { return Math.max(Math.abs(q[1]), Math.abs(q[2])); })));
    var x0 = half + m.l, x1 = W - m.r, zx = x0 + (x1 - x0) / 2; g.strokeStyle = css('--line'); g.beginPath(); g.moveTo(zx, m.t); g.lineTo(zx, H - m.b); g.stroke();
    plot(a, 1, -mx, mx, 1, '#4fc3f7', 'u m/s'); g.save(); g.translate(0, 12); plot(a, 2, -mx, mx, 1, '#ff9e5e', 'v m/s'); g.restore(); }
  else { g.fillStyle = css('--dim'); g.fillText('此格點本時段無 ADCP', half + m.l + 6, 60); }
  var F = O.odb.f, k2 = odbSt.pt, p = odbSt.p;
  $('#odbPtNote').innerHTML = '作業量 <b class="mono">' + fmt(F.eff[p][k2], 1) + '</b> h/月 · 觀測水深下限 <b class="mono">' + fmt(F.dmax[0][k2], 0) + '</b> m · 混合層 <b class="mono">' + fmt(F.MLD[p][k2], 0) + '</b> m · EKE <b class="mono">' + fmt(F.eke0[p][k2], 2) + '</b> m²/s² · 渦度 <b class="mono">' + fmt(F.vort[p][k2], 1) + '</b>×10⁻⁶ s⁻¹';
}
function isoSeg(g, grid, nx, nz, X, Y, level) {
  for (var j = 0; j < nz - 1; j++) for (var i = 0; i < nx - 1; i++) {
    var a = grid[j][i], b = grid[j][i + 1], c = grid[j + 1][i + 1], d = grid[j + 1][i]; if ([a, b, c, d].some(function (v) { return v === null || v !== v; })) continue;
    var P = []; function e(v1, v2, x1, y1, x2, y2) { if ((v1 < level) !== (v2 < level)) { var f = (level - v1) / (v2 - v1); P.push([x1 + f * (x2 - x1), y1 + f * (y2 - y1)]); } }
    e(a, b, X(i), Y(j), X(i + 1), Y(j)); e(b, c, X(i + 1), Y(j), X(i + 1), Y(j + 1)); e(c, d, X(i + 1), Y(j + 1), X(i), Y(j + 1)); e(d, a, X(i), Y(j + 1), X(i), Y(j));
    for (var k = 0; k + 1 < P.length; k += 2) { g.moveTo(P[k][0], P[k][1]); g.lineTo(P[k + 1][0], P[k + 1][1]); }
  }
}
function drawSec() {
  var cv = $('#secCv'), W = cw(cv.parentNode) - 4, H = 380, g = prep(cv, W, H), la = +segOn('#secLat'), p = odbSt.p;
  var lons = []; for (var x = 120.5; x <= 124.001; x += 0.25) lons.push(+x.toFixed(2));
  var m = { l: 46, r: 16, t: 70, b: 30 }, zmax = 300, X = sc(120.375, 124.125, m.l, W - m.r), Y = sc(0, zmax, m.t, H - m.b);
  g.fillStyle = '#0a1219'; g.fillRect(m.l, m.t, W - m.l - m.r, H - m.t - m.b);
  var r = [12, 30]; lons.forEach(function (lo) { var c = O.prof.ctd[p + '|' + lo.toFixed(2) + '|' + la.toFixed(2)]; if (!c) return;
    for (var i = 0; i < c.length; i++) { var z0 = i ? (c[i - 1][0] + c[i][0]) / 2 : 0, z1 = i < c.length - 1 ? (c[i][0] + c[i + 1][0]) / 2 : c[i][0] + 2.5; g.fillStyle = rgb(PAL.sst((c[i][1] - r[0]) / (r[1] - r[0]))); g.fillRect(X(lo - .125), Y(z0), X(lo + .125) - X(lo - .125) + 1, Y(Math.min(z1, zmax)) - Y(z0) + 1); } });
  // ADCP v 等值線
  var zs = []; for (var z = 10; z <= 300; z += 10) zs.push(z);
  var grid = zs.map(function (z) { return lons.map(function (lo) { var a = O.prof.adcp[p + '|' + lo.toFixed(2) + '|' + la.toFixed(2)]; if (!a) return null; var q = a.filter(function (r2) { return r2[0] === z; })[0]; return q ? q[2] : null; }); });
  [-0.6, -0.4, -0.2, 0.2, 0.4, 0.6, 0.8, 1.0].forEach(function (lv) { g.beginPath(); g.strokeStyle = lv > 0 ? 'rgba(255,255,255,.9)' : 'rgba(255,255,255,.7)'; g.lineWidth = lv >= 0.6 ? 1.8 : 1; g.setLineDash(lv < 0 ? [4, 3] : []); isoSeg(g, grid, lons.length, zs.length, function (i) { return X(lons[i]); }, function (j) { return Y(zs[j]); }, lv); g.stroke(); });
  g.setLineDash([]);
  // 作業長條
  var G = odbGeo(), jrow = O.odb.lat.indexOf(la), E = O.odb.f.eff[p], em = 1; lons.forEach(function (lo) { var i = O.odb.lon.indexOf(lo); var e = E[jrow * G.nx + i]; if (e > em) em = e; });
  lons.forEach(function (lo) { var i = O.odb.lon.indexOf(lo), e = E[jrow * G.nx + i] || 0; var h = (e / em) * 44; g.fillStyle = '#9fd3c7'; g.fillRect(X(lo) - 8, m.t - 8 - h, 16, h); });
  g.fillStyle = css('--dim'); g.font = '11px ' + css('--mono'); g.fillText('作業量（最大 ' + fmt(em, 0) + ' h/月）', m.l, 14);
  for (var zz = 0; zz <= zmax; zz += 50) g.fillText(zz + 'm', 6, Y(zz) + 4);
  for (var lo2 = 121; lo2 <= 124; lo2++) g.fillText(lo2 + '°E', X(lo2) - 14, H - 10);
  g.fillText(la.toFixed(2) + '°N · ' + PN[p] + ' · 色階 12–30 °C', W - 230, 14);
}
function drawTS() {
  var cv = $('#tsCv'), W = cw(cv.parentNode) - 4, H = 380, g = prep(cv, W, H), m = { l: 50, r: 20, t: 16, b: 36 };
  var X = sc(33.6, 34.9, m.l, W - m.r), Y = sc(10, 30, H - m.b, m.t);
  g.strokeStyle = css('--line'); g.fillStyle = css('--dim'); g.font = '11px ' + css('--mono');
  for (var s = 33.6; s <= 34.91; s += 0.2) { g.beginPath(); g.moveTo(X(s), m.t); g.lineTo(X(s), H - m.b); g.stroke(); g.fillText(s.toFixed(1), X(s) - 12, H - m.b + 16); }
  for (var t = 10; t <= 30; t += 5) { g.beginPath(); g.moveTo(m.l, Y(t)); g.lineTo(W - m.r, Y(t)); g.stroke(); g.fillText(t + '°C', 8, Y(t) + 4); }
  g.fillText('鹽度 (psu)', W / 2 - 20, H - 4);
  g.save(); g.strokeStyle = 'rgba(255,213,79,.8)'; g.setLineDash([5, 4]); g.beginPath(); g.moveTo(X(34.0), m.t); g.lineTo(X(34.0), H - m.b); g.moveTo(X(34.6), m.t); g.lineTo(X(34.6), H - m.b); g.moveTo(X(34.6), Y(22)); g.lineTo(W - m.r, Y(22)); g.stroke(); g.restore();
  g.fillStyle = '#ffd54f'; g.fillText('沿岸／稀釋水', X(33.62), m.t + 12); g.fillText('陸棚混合水', X(34.1), m.t + 12); g.fillText('黑潮表層水', X(34.62), Y(27)); g.fillText('黑潮次表層水', X(34.62), Y(12));
  var cols = { 13: '#4fc3f7', 14: '#9ccc65', 15: '#ff7043', 16: '#ffb300' }, ps = odbSt.p >= 13 && odbSt.p <= 16 ? [odbSt.p] : [13, 14, 15, 16];
  ps.forEach(function (p) { var d = O.r2.ts[p]; if (!d) return; for (var i = 0; i < d.Tb.length; i++) { var e = d.eff[i] || 0; g.beginPath(); g.arc(X(d.Sb[i]), Y(d.Tb[i]), e > 1 ? Math.min(16, 3 + Math.sqrt(e) * .5) : 2.2, 0, 6.283); g.fillStyle = e > 1 ? cols[p] : 'rgba(139,166,189,.45)'; g.globalAlpha = e > 1 ? .8 : 1; g.fill(); g.globalAlpha = 1; } });
  ps.forEach(function (p, k) { g.fillStyle = cols[p]; g.fillRect(W - 170 + k * 38, H - m.b - 18, 10, 10); g.fillStyle = css('--fg'); g.fillText(PN[p], W - 157 + k * 38, H - m.b - 9); });
}
function buildOdb() {
  seg('#odbPer', function (v) { odbSt.p = +v; drawOdbMap(); drawProf(); drawSec(); drawTS(); });
  $('#odbVar').onchange = function () { odbSt.v = this.value; drawOdbMap(); };
  ['#odbVec', '#odbEff', '#odbAx'].forEach(function (id) { $(id).onchange = drawOdbMap; });
  seg('#secLat', drawSec);
  var cv = $('#odbMap'), tip = $('#odbTip');
  cv.onmousemove = function (e) { var k = odbCell(e); if (k === null) { tip.style.display = 'none'; return; } var x = O.odb.f[odbSt.v][odbSt.p][k], G = odbGeo(), r = cv.getBoundingClientRect();
    tip.style.display = 'block'; tip.textContent = O.odb.lon[k % G.nx].toFixed(2) + 'E ' + O.odb.lat[Math.floor(k / G.nx)].toFixed(2) + 'N · ' + VINFO[odbSt.v][0] + ' ' + fmt(x, VINFO[odbSt.v][3]) + ' ' + VINFO[odbSt.v][1] + ' · 作業 ' + fmt(O.odb.f.eff[odbSt.p][k], 1) + ' h/月';
    tip.style.left = Math.min(r.width - 280, e.clientX - r.left + 12) + 'px'; tip.style.top = (e.clientY - r.top + 12) + 'px'; };
  cv.onmouseleave = function () { tip.style.display = 'none'; };
  cv.onclick = function (e) { var k = odbCell(e); if (k === null) return; odbSt.pt = k; drawOdbMap(); drawProf(); };
  // 預設點：宜蘭外海作業熱點
  var G = odbGeo(); odbSt.pt = O.odb.lat.indexOf(25) * G.nx + O.odb.lon.indexOf(122);
}
function drawOdbAll() { drawOdbMap(); drawProf(); drawSec(); drawTS(); }

/* ================= 漁場 × 衛星海溫（VDR） ================= */
var V, NX, NY, NC, SSTb, ANb, GRb, FOOT, HOT, M, fs = { t: 68, layer: 'sst', timer: null, pv: 'sst', ps: '全年', gs: '冬' };
function b64(s) { var b = atob(s), a = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return a; }
var val = { sst: function (t, i) { var q = SSTb[t * NC + i]; return q === 255 ? NaN : 8 + q / 10; }, anom: function (t, i) { var q = ANb[t * NC + i]; return q === 255 ? NaN : -4 + q / 30; }, grad: function (t, i) { var q = GRb[t * NC + i]; return q === 255 ? NaN : q / 2000; } };
var FSL = { sst: [14, 31, '°C', PAL.sst], anom: [-2.5, 2.5, '°C 距平', PAL.div], grad: [0, 0.1, '°C/km', PAL.seq] };
function initV() { V = O.vdr; NX = V.nx; NY = V.ny; NC = NX * NY; SSTb = b64(V.sst); ANb = b64(V.anom); GRb = b64(V.grad); FOOT = new Set(V.foot); HOT = new Set(V.hot); M = V.monthly; }
function buildFsst() {
  initV();
  var tot = M.effort.reduce(function (a, b) { return a + (b || 0); }, 0);
  var LT = V.lt, TR = LT.trend;
  var K = [['海溫資料', 'CoralTemp v3.1', 'NOAA CRW 每日 5 km · 2,431 日'], ['拖網作業時數', Math.round(tot / 1000) + ' 千小時', V.months.length + ' 個月 · 119 艘 · VDR'], ['追溫斜率', fmt(V.dyn.track.slope), '作業海溫對可及均溫'], ['位置＋季節 AUC', fmt(V.gam.models['空間+季節'].auc, 3), '2024 年獨立驗證'], ['冬季鋒面 10 km 內', Math.round(V.front.front['冬'].share_10km_use * 100) + '% / ' + Math.round(V.front.front['冬'].share_10km_av * 100) + '%', '作業 / 可及'], ['漁場長期增溫', '+' + fmt(TR['全年_足跡'].slope_dec) + '°C', '每 10 年 · 1985–2025']];
  $('#fsKpi').innerHTML = K.map(function (k) { return '<div class="kpi acc"><div class="lab">' + k[0] + '</div><div class="val">' + k[1] + '</div><div class="sub">' + k[2] + '</div></div>'; }).join('');
  var F = [['s', '強', '漁場持續增溫，秋季最快', '以 CoralTemp 1985–2025 年月平均計算，船隊足跡範圍年均海溫每 10 年上升 ' + fmt(TR['全年_足跡'].slope_dec) + ' ± ' + fmt(TR['全年_足跡'].ci95) + '°C（已依殘差自相關修正有效樣本數，p &lt; 0.001），作業熱點 +' + fmt(TR['全年_熱點'].slope_dec) + '°C。季節上以秋季 +' + fmt(TR['秋_足跡'].slope_dec) + '°C 最快、冬季 +' + fmt(TR['冬_足跡'].slope_dec) + '°C 最慢；2019–2024 年平均比 1991–2020 年氣候值高 ' + fmt(LT.recent['2019_2024_vs_9120_foot']) + '°C，最暖的 5 年全部落在 2020 年之後。'],
    ['s', '強', '船隊固守漁場，不追隨等溫線', '每月作業處海溫與可及水域均溫幾乎一比一同步（斜率 ' + fmt(V.dyn.track.slope) + '、r = ' + fmt(V.dyn.track.r) + '）；去除季節後斜率仍為 ' + fmt(V.dyn.track.deseason_slope) + '。拖網船是固定在地理上的漁場承受季節變化，而不是追著特定水溫移動。'],
    ['s', '強', '冬、春、秋三季的作業緊貼海溫鋒面', '冬季 ' + Math.round(V.front.front['冬'].share_10km_use * 100) + '% 的作業時數在鋒面（≥ 0.05°C/km）10 km 內，可及水域只有 ' + Math.round(V.front.front['冬'].share_10km_av * 100) + '%；秋季為 ' + Math.round(V.front.front['秋'].share_10km_use * 100) + '% 對 ' + Math.round(V.front.front['秋'].share_10km_av * 100) + '%。冬季梯度 ≥ 0.08°C/km 的網格商數 Q = 9.5。夏季鋒面消失，這個關係也跟著不見。'],
    ['s', '強', '水溫訊號多半已反映在地理位置上', '只用位置加季節的 GAM，2024 年獨立驗證 AUC 為 ' + fmt(V.gam.models['空間+季節'].auc, 3) + '；只用海溫、梯度、距平與離岸距離也有 ' + fmt(V.gam.models['環境+季節'].auc, 3) + '。兩者合併後偏差解釋率只從 ' + Math.round(V.gam.models['空間+季節'].dev * 1000) / 10 + '% 提高到 ' + Math.round(V.gam.models['完整模式'].dev * 1000) / 10 + '%，表示海溫場與漁場位置高度共線。'],
    ['s', '強', '避開黑潮最暖的主軸水', '作業處相對海溫中位數 ' + fmt(V.pref.rel['全年'].q_use[2]) + '°C，可及水域 +' + fmt(V.pref.rel['全年'].q_av[2]) + '°C；夏季偏好比周圍冷 0–1°C 的湧升冷水區（Q ≈ 2.0）。'],
    ['m', '中', '兩種船群策略', '基隆籍與標本船在離岸 13–22 浬、陸棚冷水側作業；宜蘭籍、單拖、雙拖、櫻花蝦船在離岸 3–5 浬、黑潮影響的蘭陽海域作業。'],
    ['w', '弱', '月尺度海溫距平的耦合不顯著', 'MCA 第一模態 SCF ' + Math.round(V.dyn.mca.scf[0] * 100) + '%，但置換檢定 p = ' + fmt(V.dyn.mca.p) + '；各年作業重心緯度與海溫距平的相關 r = ' + fmt(V.dyn.annual_r.r) + '（p = ' + fmt(V.dyn.annual_r.p) + '）。增溫趨勢目前沒有讓漁場位置出現可偵測的年際移動。'],
    ['m', '中', '資料交叉驗證', 'CoralTemp 與先前由水試所每日海溫圖數位化的月平均場相比，r = 0.993、RMSE 0.47°C、平均偏差 0.08°C，主要結論一致；差異在鋒面：CoralTemp 為無缺值的每日 L4 分析場，鋒面商數與冬季作業鋒面占比比數位化資料更明確。']];
  $('#fsFind').innerHTML = F.map(function (f) { return '<div class="finding"><span class="ev ' + f[0] + '">證據 ' + f[1] + '</span><h3>' + f[2] + '</h3><p>' + f[3] + '</p></div>'; }).join('');
  var sel = $('#fsMon'); V.months.forEach(function (k, i) { var o = document.createElement('option'); o.value = i; o.textContent = k; sel.appendChild(o); }); sel.value = fs.t;
  sel.onchange = function () { fs.t = +sel.value; $('#fsRange').value = fs.t; drawFsMap(); };
  $('#fsRange').oninput = function () { fs.t = +this.value; sel.value = fs.t; drawFsMap(); };
  seg('#fsLayer', function (v) { fs.layer = v; drawFsMap(); }); $('#fsHot').onchange = drawFsMap;
  $('#fsPlay').onclick = function () { var b = this; if (fs.timer) { clearInterval(fs.timer); fs.timer = null; b.textContent = '▶ 播放'; return; } b.textContent = '⏸ 暫停'; fs.timer = setInterval(function () { fs.t = (fs.t + 1) % V.months.length; sel.value = fs.t; $('#fsRange').value = fs.t; drawFsMap(); }, 650); };
  seg('#fsPv', function (v) { fs.pv = v; drawFsPref(); }); seg('#fsPs', function (v) { fs.ps = v; drawFsPref(); }); seg('#fsGs', function (v) { fs.gs = v; drawFsGrp(); });
}
function drawFsTs() {
  var w = 1100, h = 330, L = 46, R = 54, s = frame($('#fsTs'), w, h), n = M.ym.length, x = sc(0, n - 1, L + 6, w - R - 6), y1 = sc(18, 31, 190, 34), y2 = sc(0, 300, 305, 205);
  axY(s, y1, [20, 24, 28], L, w - R, function (v) { return v + '°'; }); axY(s, y2, [0, 100, 200, 300], L, w - R, null, true);
  M.epv.forEach(function (v, i) { if (v == null) return; S('rect', { x: x(i) - 5, width: 10, y: y2(v), height: y2(0) - y2(v), fill: css('--acc'), opacity: .35 }, s); });
  function ln(k, st) { var d = ''; M[k].forEach(function (v, i) { if (v == null) return; d += (d ? 'L' : 'M') + x(i).toFixed(1) + ',' + y1(v).toFixed(1); }); S('path', Object.assign({ d: d, fill: 'none', 'stroke-width': 2 }, st), s); }
  ln('sst_a', { stroke: css('--dim'), 'stroke-dasharray': '4 3' }); ln('sst_f', { stroke: css('--warm') });
  M.ym.forEach(function (k, i) { if (k.slice(5) === '01') T(s, x(i), 324, k.slice(0, 4), { 'text-anchor': 'middle' }); });
  [[css('--warm'), '作業處海溫'], [css('--dim'), '可及水域均溫'], [css('--acc'), '每船月作業時數（右軸）']].forEach(function (a, i) { S('rect', { x: L + 30 + i * 150, y: 8, width: 14, height: 4, fill: a[0] }, s); T(s, L + 48 + i * 150, 13, a[1], { style: 'fill:' + css('--fg') }); });
}
function drawFsMap() {
  var cv = $('#fsMap'), W = Math.min(cw(cv.parentNode) - 4, 620), H = Math.round(W * 1.1), g = prep(cv, W, H), L = FSL[fs.layer], t = fs.t, cwid = W / NX, ch = H / NY;
  var off = document.createElement('canvas'); off.width = NX; off.height = NY; var og = off.getContext('2d'), im = og.createImageData(NX, NY);
  for (var r = 0; r < NY; r++) for (var c = 0; c < NX; c++) { var i = r * NX + c, v = val[fs.layer](t, i), p = ((NY - 1 - r) * NX + c) * 4, col = v === v ? L[3]((v - L[0]) / (L[1] - L[0])) : [52, 64, 78]; im.data[p] = col[0]; im.data[p + 1] = col[1]; im.data[p + 2] = col[2]; im.data[p + 3] = 255; }
  og.putImageData(im, 0, 0); g.imageSmoothingEnabled = false; g.drawImage(off, 0, 0, W, H);
  if (fs.layer === 'sst') { g.save(); g.strokeStyle = 'rgba(10,18,25,.55)'; g.lineWidth = .8; g.beginPath();
    var grid = []; for (var r2 = 0; r2 < NY; r2++) { grid.push([]); for (var c2 = 0; c2 < NX; c2++) grid[r2].push(val.sst(t, r2 * NX + c2)); }
    for (var lv = 12; lv <= 31; lv++) isoSeg(g, grid, NX, NY, function (i) { return (i + .5) * cwid; }, function (j) { return H - (j + .5) * ch; }, lv); g.stroke(); g.restore(); }
  grat(g, V.lon0, V.lon0 + NX * V.res, V.lat0, V.lat0 + NY * V.res, W, H, 1);
  if ($('#fsHot').checked) { g.save(); g.strokeStyle = '#9fd3c7'; g.lineWidth = 1.8; g.beginPath(); HOT.forEach(function (i) { var r3 = Math.floor(i / NX), c3 = i % NX, x = c3 * cwid, y = H - (r3 + 1) * ch; if (!HOT.has(i - NX)) { g.moveTo(x, y + ch); g.lineTo(x + cwid, y + ch); } if (!HOT.has(i + NX)) { g.moveTo(x, y); g.lineTo(x + cwid, y); } if (c3 === 0 || !HOT.has(i - 1)) { g.moveTo(x, y); g.lineTo(x, y + ch); } if (c3 === NX - 1 || !HOT.has(i + 1)) { g.moveTo(x + cwid, y); g.lineTo(x + cwid, y + ch); } }); g.stroke(); g.restore(); }
  var e = V.eff[t], idx = e[0], hr = e[1]; g.save(); g.fillStyle = 'rgba(255,255,255,.85)'; g.strokeStyle = 'rgba(10,20,25,.9)';
  idx.forEach(function (i, k) { var r4 = Math.floor(i / NX), c4 = i % NX; g.beginPath(); g.arc((c4 + .5) * cwid, H - (r4 + .5) * ch, Math.min(8, 1 + Math.sqrt(hr[k]) * .38), 0, 6.283); g.fill(); g.stroke(); }); g.restore();
  legend($('#fsLeg'), L[0], L[1], L[3], $('#fsLegTxt'), L[2], fs.layer === 'grad' ? 2 : 1);
  var sw = 0, sv = 0, fa = [];
  idx.forEach(function (i, k) { var v = val.sst(t, i); if (v === v) { sw += hr[k]; sv += hr[k] * v; } }); FOOT.forEach(function (i) { var v = val.sst(t, i); if (v === v) fa.push(v); });
  var fm = fa.reduce(function (a, b) { return a + b; }, 0) / fa.length;
  $('#fsMTitle').textContent = V.months[t].replace('-', ' 年 ') + ' 月';
  var rows = [['作業時數', Math.round(hr.reduce(function (a, b) { return a + b; }, 0)).toLocaleString() + ' h'], ['作業船數', M.nv[t] + ' 艘'], ['作業處海溫', fmt(sv / sw) + ' °C'], ['可及水域均溫', fmt(fm) + ' °C'], ['可及水域距平', fmt(M.an_a[t]) + ' °C'], ['漁場重心', fmt(M.lat_c[t]) + '°N ' + fmt(M.lon_c[t]) + '°E']];
  $('#fsMStat').innerHTML = rows.map(function (r5) { return '<tr><td>' + r5[0] + '</td><td class="mono">' + r5[1] + '</td></tr>'; }).join('');
  var ha = [], hw = []; for (var b = 0; b < 34; b++) { ha.push(0); hw.push(0); }
  fa.forEach(function (v) { var j = Math.floor((v - 14) / .5); if (j >= 0 && j < 34) ha[j] += 1 / fa.length; }); idx.forEach(function (i, k) { var v = val.sst(t, i), j = Math.floor((v - 14) / .5); if (j >= 0 && j < 34) hw[j] += hr[k] / sw; });
  var lo = 0, hi = 33; while (lo < 33 && !ha[lo] && !hw[lo]) lo++; while (hi > 0 && !ha[hi] && !hw[hi]) hi--; lo = Math.max(0, lo - 1); hi = Math.min(33, hi + 1);
  var w2 = 440, h2 = 200, s = frame($('#fsHist'), w2, h2), X = sc(lo, hi + 1, 40, w2 - 10), mx = Math.max.apply(null, ha.concat(hw)), Y = sc(0, mx, 172, 10);
  axY(s, Y, ticks(0, mx, 4), 40, w2 - 10, function (v) { return Math.round(v * 100) + '%'; });
  for (var j2 = lo; j2 <= hi; j2++) { var bw = X(j2 + 1) - X(j2); S('rect', { x: X(j2) + 1, width: bw / 2 - 1, y: Y(ha[j2]), height: 172 - Y(ha[j2]), fill: css('--dim'), opacity: .4 }, s); S('rect', { x: X(j2) + bw / 2, width: bw / 2 - 1, y: Y(hw[j2]), height: 172 - Y(hw[j2]), fill: css('--warm') }, s); if ((14 + j2 * .5) % 2 === 0) T(s, X(j2), 190, (14 + j2 * .5) + '°', { 'text-anchor': 'middle' }); }
}
var PVN = { sst: ['絕對海溫', '°C', 1], rel: ['相對海溫', '°C', 1], grad: ['海溫梯度', '°C/km', 3], anom: ['海溫距平', '°C', 1], dist: ['離岸距離', '浬', 0] };
function drawFsPref() {
  var P = V.pref[fs.pv][fs.ps] || V.pref[fs.pv]['全年'], b = P.bins, n = b.length - 1, w = 1000, h = 320, L = 50, R = 56, s = frame($('#fsPref'), w, h);
  var lo = 0, hi = n - 1; while (lo < n && P.ha[lo] < 1e-4 && P.hw[lo] < 1e-4) lo++; while (hi > 0 && P.ha[hi] < 1e-4 && P.hw[hi] < 1e-4) hi--;
  var x = function (i) { return L + (i - lo) / (hi - lo + 1) * (w - L - R); }, mx = Math.max.apply(null, P.ha.concat(P.hw)), y = sc(0, mx, 280, 26), y2 = sc(0, 6, 280, 26);
  axY(s, y, ticks(0, mx, 4), L, w - R, function (v) { return Math.round(v * 100) + '%'; }); [0, 1, 2, 4, 6].forEach(function (v) { T(s, w - R + 6, y2(v) + 4, v); });
  S('line', { x1: L, x2: w - R, y1: y2(1), y2: y2(1), stroke: css('--warm'), 'stroke-dasharray': '3 3', opacity: .6 }, s);
  var d = '';
  for (var i = lo; i <= hi; i++) { var bw = x(i + 1) - x(i); S('rect', { x: x(i) + 1, width: bw / 2 - 1, y: y(P.ha[i]), height: 280 - y(P.ha[i]), fill: css('--dim'), opacity: .4 }, s); S('rect', { x: x(i) + bw / 2, width: bw / 2 - 1, y: y(P.hw[i]), height: 280 - y(P.hw[i]), fill: css('--acc') }, s);
    if (fs.pv === 'grad' || fs.pv === 'dist' || (i - lo) % 2 === 0) T(s, x(i), 298, b[i], { 'text-anchor': 'middle' });
    var q = P.Q[i]; if (q != null) { q = Math.min(q, 6); d += (d ? 'L' : 'M') + (x(i) + bw / 2).toFixed(1) + ',' + y2(q).toFixed(1); S('circle', { cx: x(i) + bw / 2, cy: y2(q), r: 3, fill: css('--warm') }, s); } }
  S('path', { d: d, fill: 'none', stroke: css('--warm'), 'stroke-width': 2 }, s);
  T(s, L, 316, PVN[fs.pv][0] + '（' + PVN[fs.pv][1] + '，區間下限）', { style: 'fill:' + css('--fg') }); T(s, w - R + 6, 14, '商數 Q');
  [[css('--dim'), '可及水域'], [css('--acc'), '作業時數'], [css('--warm'), '商數 Q（>1 表偏好）']].forEach(function (a, k) { S('rect', { x: L + 10 + k * 130, y: 6, width: 12, height: 8, fill: a[0] }, s); T(s, L + 26 + k * 130, 14, a[1], { style: 'fill:' + css('--fg') }); });
  var dd = PVN[fs.pv][2] + 1;
  $('#fsPrefCap').innerHTML = '作業中位數 <b class="mono">' + fmt(P.q_use[2], dd) + '</b>（四分位距 ' + fmt(P.q_use[1], dd) + '–' + fmt(P.q_use[3], dd) + '），可及中位數 <b class="mono">' + fmt(P.q_av[2], dd) + '</b>（' + fmt(P.q_av[1], dd) + '–' + fmt(P.q_av[3], dd) + '）。D = ' + fmt(P.D, 3) + '，p = ' + fmt(P.p, 3) + '，共 ' + P.nmonth + ' 個月。';
}
function drawFsOther() {
  var se = ['全年', '冬', '春', '夏', '秋'], F = V.front.front;
  bars($('#fsFront'), se, [{ n: '作業時數', c: css('--acc'), v: se.map(function (s) { return F[s].share_10km_use; }) }, { n: '可及水域', c: css('--dim'), v: se.map(function (s) { return F[s].share_10km_av; }) }], { max: .8, f: function (v) { return Math.round(v * 100) + '%'; }, lab: function (v) { return Math.round(v * 100) + '%'; } });
  var tr = V.dyn.track, w = 520, h = 330, L = 46, s = frame($('#fsTrack'), w, h), x = sc(20, 31, L, w - 12), y = sc(20, 31, 296, 12);
  axY(s, y, [20, 22, 24, 26, 28, 30], L, w - 12, function (v) { return v + '°'; }); [20, 22, 24, 26, 28, 30].forEach(function (v) { T(s, x(v), 314, v + '°', { 'text-anchor': 'middle' }); });
  S('line', { x1: x(20), y1: y(20), x2: x(31), y2: y(31), stroke: css('--dim'), 'stroke-dasharray': '4 3' }, s);
  M.sst_a.forEach(function (a, i) { var f = M.sst_f[i]; if (a == null || f == null) return; var mo = +M.ym[i].slice(5); S('circle', { cx: x(a), cy: y(f), r: 4, fill: rgb(PAL.sst(((mo + 5) % 12) / 11)), opacity: .9 }, s); });
  T(s, w / 2, 328, '可及水域月均溫 (°C)', { 'text-anchor': 'middle' }); T(s, L + 4, 10, '作業處月均溫 (°C)');
  $('#fsTrackCap').innerHTML = '斜率 <b class="mono">' + fmt(tr.slope) + '</b>、r = <b class="mono">' + fmt(tr.r, 3) + '</b>；去除季節後斜率 <b class="mono">' + fmt(tr.deseason_slope) + '</b>。如果船隊跟著固定水溫移動，點會排成水平線；實際上點落在 1:1 虛線上，表示船隊固定在漁場不動。';
  var Gm = V.gam, h2 = '<tr><th>模式</th><th>AUC（2024）</th><th>偏差解釋率</th></tr>';
  Object.keys(Gm.models).forEach(function (k) { var v = Gm.models[k]; if (v.auc) h2 += '<tr><td>' + k + '</td><td class="mono">' + fmt(v.auc, 3) + '</td><td class="mono">' + fmt(v.dev * 100, 1) + '%</td></tr>'; });
  $('#fsGam').innerHTML = h2 + '<tr><td>強度模式（有作業網格，log 時數）</td><td>—</td><td class="mono">' + fmt(Gm.models['強度模式(env)'].r2 * 100, 1) + '%</td></tr>';
  drawFsGrp();
}
function drawFsGrp() {
  var rows = V.front.groups.filter(function (r) { return r.season === fs.gs; }).sort(function (a, b) { return a.dist50 - b.dist50; }), w = 620, h = 40 + rows.length * 38, L = 120, R = 130, s = frame($('#fsGrp'), w, h);
  var lo = Math.min.apply(null, rows.map(function (r) { return r.sst25; })) - 1, hi = Math.max.apply(null, rows.map(function (r) { return r.sst75; })) + 1, x = sc(lo, hi, L, w - R);
  ticks(lo, hi, 5).forEach(function (v) { S('line', { x1: x(v), x2: x(v), y1: 20, y2: h - 18, stroke: css('--line') }, s); T(s, x(v), h - 4, v + '°', { 'text-anchor': 'middle' }); });
  rows.forEach(function (r, i) { var yy = 38 + i * 38, c = r.dist50 > 10 ? css('--cool') : css('--warm');
    T(s, L - 10, yy + 4, r.grp, { 'text-anchor': 'end', style: 'font-size:12px;fill:' + css('--fg') }); S('line', { x1: x(r.sst25), x2: x(r.sst75), y1: yy, y2: yy, stroke: c, 'stroke-width': 6, 'stroke-linecap': 'round', opacity: .55 }, s); S('circle', { cx: x(r.sst50), cy: yy, r: 6, fill: c }, s);
    T(s, w - R + 10, yy + 4, fmt(r.dist50, 1) + ' 浬'); T(s, w - R + 66, yy + 4, (r.rel50 > 0 ? '+' : '') + fmt(r.rel50) + '°'); });
  T(s, w - R + 10, 14, '離岸'); T(s, w - R + 66, 14, '相對海溫');
}

/* ================= 漁場 × ODB 水文 ================= */
var VN = null;
var HVARS = ['T100', 'S100', 'ffreq', 'eke0', 'vort', 'spd0', 'spd100', 'T0', 'sst', 'MLD', 'dT50', 'N2max', 'S0', 'Tb', 'Sb', 'spdb', 'shear', 'div', 'dks', 'dmax', 'dist'];
var HPER = [13, 14, 15, 16, 17, 18, 0];
function drawHeat() {
  var cv = $('#foHeat'), W = cw(cv.parentNode) - 4, rh = 24, H = 40 + HVARS.length * rh, g = prep(cv, W, H), L = 170, cwid = (W - L - 10) / HPER.length;
  g.font = '12px sans-serif'; g.fillStyle = css('--dim');
  HPER.forEach(function (p, k) { g.textAlign = 'center'; g.fillText(PN[p], L + (k + .5) * cwid, 22); });
  cv._cells = [];
  HVARS.forEach(function (v, j) { var y = 32 + j * rh; g.textAlign = 'right'; g.fillStyle = css('--fg'); g.fillText(VN[v], L - 10, y + 16);
    HPER.forEach(function (p, k) { var s = (O.r1.sel[v] || {})[p], c = (O.r1.cor[v] || {})[p], x = L + k * cwid;
      if (!s || s.si === null) { g.fillStyle = '#0f1c28'; g.fillRect(x + 1, y + 1, cwid - 2, rh - 2); return; }
      var t = Math.max(-1.6, Math.min(1.6, s.si)); g.fillStyle = rgb(PAL.div((t + 1.6) / 3.2)); g.fillRect(x + 1, y + 1, cwid - 2, rh - 2);
      g.fillStyle = Math.abs(t) > 1 ? '#fff' : '#0d1620'; g.textAlign = 'center'; g.font = '12px ' + css('--mono');
      g.fillText(fmt(s.si, 2) + (c && c.p < 0.05 ? ' *' : ''), x + cwid / 2, y + 16); g.font = '12px sans-serif';
      cv._cells.push([x, y, cwid, rh, v, p, s, c]); }); });
  g.textAlign = 'left';
}
function heatTip(e) { var cv = $('#foHeat'), r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top, hit = (cv._cells || []).filter(function (c) { return mx >= c[0] && mx < c[0] + c[2] && my >= c[1] && my < c[1] + c[3]; })[0];
  cv.title = hit ? VN[hit[4]] + '｜' + PN[hit[5]] + '\n作業加權 ' + fmt(hit[6].use, 3) + '，可及平均 ' + fmt(hit[6].avail, 3) + '\n選擇性指數 ' + fmt(hit[6].si, 2) + (hit[7] ? '\nSpearman ρ = ' + fmt(hit[7].r, 2) + '，p = ' + fmt(hit[7].p, 3) + '（n = ' + hit[7].n + '，有效 n ≈ ' + fmt(hit[7].neff, 0) + '）' : '') : ''; }
function drawExp() {
  var v = $('#foExpVar').value, E = O.r2.exp[v], ps = [13, 14, 15, 16], w = 560, h = 280, L = 50, s = frame($('#foExp'), w, h);
  var vals = []; ps.forEach(function (p) { if (E[p]) vals.push(E[p].use, E[p].avail); }); var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals), pad = (hi - lo) * .2 || 1; lo -= pad; hi += pad;
  var x = sc(0, 3, L + 30, w - 40), y = sc(lo, hi, 240, 24); axY(s, y, ticks(lo, hi, 5), L, w - 10);
  [['use', css('--warm'), '作業加權'], ['avail', css('--dim'), '可及平均']].forEach(function (a, k) { var d = ''; ps.forEach(function (p, i) { if (!E[p]) return; d += (d ? 'L' : 'M') + x(i) + ',' + y(E[p][a[0]]); S('circle', { cx: x(i), cy: y(E[p][a[0]]), r: 4, fill: a[1] }, s); T(s, x(i) + 8, y(E[p][a[0]]) + (k ? 14 : -6), fmt(E[p][a[0]], v === 'eke0' || v === 'spd0' ? 2 : 1), { style: 'fill:' + a[1] }); });
    S('path', { d: d, fill: 'none', stroke: a[1], 'stroke-width': 2, 'stroke-dasharray': k ? '4 3' : '' }, s); S('rect', { x: L + 10 + k * 110, y: 6, width: 12, height: 4, fill: a[1] }, s); T(s, L + 26 + k * 110, 11, a[2], { style: 'fill:' + css('--fg') }); });
  ps.forEach(function (p, i) { T(s, x(i), 264, PN[p], { 'text-anchor': 'middle', style: 'font-size:12px;fill:' + css('--fg') }); });
}
function buildFodb() {
  VN = {}; Object.keys(O.r1.vars).forEach(function (k) { VN[k] = O.r1.vars[k]; });
  var e = O.r2.exp;
  var K = [['100 m 水溫（作業 / 可及）', fmt(e.T100[15].use, 1) + ' / ' + fmt(e.T100[15].avail, 1) + '°C', '夏季；四季作業處都在 17.8–18.2°C'], ['近表層流速', fmt(e.spd0[18].use, 2) + ' / ' + fmt(e.spd0[18].avail, 2), 'm/s · 西南季風期'], ['流速變異 EKE', '×' + fmt(e.eke0[13].use / e.eke0[13].avail, 1), '冬季作業處對可及'],
    ['CTD 水文 AUC', fmt(O.r2.cv['CTD 水文'][0], 2), '空間區塊交叉驗證'], ['衛星 SST AUC', fmt(O.r2.cv['衛星 SST'][0], 2), '只用海溫與鋒面'], ['全部變數 AUC', fmt(O.r2.cv['全部變數'][0], 2), '含離岸距離與水深']];
  $('#foKpi').innerHTML = K.map(function (k) { return '<div class="kpi acc"><div class="lab">' + k[0] + '</div><div class="val" style="font-size:21px">' + k[1] + '</div><div class="sub">' + k[2] + '</div></div>'; }).join('');
  $('#foHeat').onmousemove = heatTip;
  $('#foExpVar').onchange = drawExp;
  $('#foExpert').innerHTML = expertHtml();
}
function drawFodbCharts() {
  drawHeat(); drawExp();
  var cvk = Object.keys(O.r2.cv), w = 600, h = 300, L = 150, s = frame($('#foCv'), w, h), x = sc(0.5, 0.85, L, w - 60);
  [0.5, 0.6, 0.7, 0.8].forEach(function (v) { S('line', { x1: x(v), x2: x(v), y1: 10, y2: h - 26, stroke: css('--line') }, s); T(s, x(v), h - 8, v.toFixed(1), { 'text-anchor': 'middle' }); });
  cvk.forEach(function (k, i) { var v = O.r2.cv[k], y = 24 + i * 44, c = k.indexOf('地形') >= 0 || k === '全部變數' ? css('--dim') : css('--acc');
    S('rect', { x: x(0.5), y: y, width: x(v[0]) - x(0.5), height: 22, fill: c, opacity: .85 }, s); S('line', { x1: x(v[0] - v[1]), x2: x(v[0] + v[1]), y1: y + 11, y2: y + 11, stroke: css('--fg') }, s);
    T(s, L - 8, y + 15, k, { 'text-anchor': 'end', style: 'font-size:12px;fill:' + css('--fg') }); T(s, x(v[0] + v[1]) + 6, y + 15, fmt(v[0], 3)); });
  var imp = O.r2.imp_phys.slice(0, 10), w2 = 600, h2 = 34 + imp.length * 26, s2 = frame($('#foImp'), w2, h2), mx = imp[0][1] * 1.15, x2 = sc(0, mx, 160, w2 - 60);
  imp.forEach(function (r, i) { var y = 14 + i * 26, nm = r[0] === 'season' ? '季節' : VN[r[0]] || r[0]; S('rect', { x: 160, y: y, width: Math.max(1, x2(r[1]) - 160), height: 18, fill: i === 0 ? css('--warm') : css('--acc') }, s2);
    T(s2, 152, y + 13, nm, { 'text-anchor': 'end', style: 'font-size:12px;fill:' + css('--fg') }); T(s2, x2(r[1]) + 6, y + 13, fmt(r[1], 3)); });
  var WM = ['沿岸/陸棚稀釋水', '陸棚混合水', '黑潮次表層水', '黑潮表層水'], wc = ['#4fc3f7', '#9ccc65', '#ff7043', '#ffd54f'], ps = [13, 14, 15, 16], w3 = 600, h3 = 300, s3 = frame($('#foWm'), w3, h3), bw = 50;
  ps.forEach(function (p, i) { ['use', 'avail'].forEach(function (k, j) { var x0 = 60 + i * 135 + j * (bw + 6), y0 = 250; WM.forEach(function (wm, q) { var v = ((O.r2.wm[p] || {})[wm] || {})[k] || 0, hgt = v * 220; S('rect', { x: x0, y: y0 - hgt, width: bw, height: hgt, fill: wc[q], opacity: k === 'use' ? .95 : .45 }, s3); if (v > .08) T(s3, x0 + bw / 2, y0 - hgt / 2 + 4, Math.round(v * 100) + '%', { 'text-anchor': 'middle', style: 'fill:#0d1620;font-size:10px' }); y0 -= hgt; });
      T(s3, x0 + bw / 2, 266, k === 'use' ? '作業' : '可及', { 'text-anchor': 'middle' }); });
    T(s3, 60 + i * 135 + bw + 3, 286, PN[p], { 'text-anchor': 'middle', style: 'font-size:12px;fill:' + css('--fg') }); });
  WM.forEach(function (wm, q) { S('rect', { x: 10 + q * 145, y: 6, width: 10, height: 10, fill: wc[q] }, s3); T(s3, 24 + q * 145, 15, wm, { style: 'fill:' + css('--fg') }); });
  var box = $('#foPd'); box.innerHTML = '';
  Object.keys(O.r2.pdp).forEach(function (k) { var d = document.createElement('div'); d.innerHTML = '<div class="note" style="margin:0 0 4px;color:' + css('--fg') + '">' + (VN[k] || k) + '</div><div class="chart"></div>'; box.appendChild(d);
    var P = O.r2.pdp[k], w4 = 320, h4 = 190, s4 = frame(d.querySelector('.chart'), w4, h4); s4.style.minWidth = '0';
    var x4 = sc(Math.min.apply(null, P.x), Math.max.apply(null, P.x), 40, w4 - 10), lo = Math.min.apply(null, P.y), hi = Math.max.apply(null, P.y), y4 = sc(lo - .1, hi + .1, 160, 10);
    axY(s4, y4, ticks(lo - .1, hi + .1, 4), 40, w4 - 10, function (v) { return v.toFixed(1); }); var dd = ''; P.x.forEach(function (x, i) { dd += (i ? 'L' : 'M') + x4(x) + ',' + y4(P.y[i]); }); S('path', { d: dd, fill: 'none', stroke: css('--acc'), 'stroke-width': 2 }, s4);
    ticks(Math.min.apply(null, P.x), Math.max.apply(null, P.x), 4).forEach(function (v) { T(s4, x4(v), 180, v, { 'text-anchor': 'middle' }); }); });
  var mc = O.r2.monsoon, h5 = '<tr><th>變數</th><th>作業加權平均變化（西南−東北）</th><th>Spearman ρ（Δ變數 vs Δ作業占比）</th><th>p</th><th>n</th></tr>';
  Object.keys(mc).sort(function (a, b) { return Math.abs(mc[b].r) - Math.abs(mc[a].r); }).forEach(function (k) { var r = mc[k]; h5 += '<tr><td>' + (VN[k] || k) + '</td><td class="mono">' + (r.dmean > 0 ? '+' : '') + fmt(r.dmean, 3) + '</td><td class="mono">' + fmt(r.r, 2) + '</td><td class="mono">' + fmt(r.p, 3) + (r.p < 0.05 ? ' <span class="tag sig">p&lt;0.05</span>' : '') + '</td><td class="mono">' + r.n + '</td></tr>'; });
  $('#foMon').innerHTML = h5;
}
function expertHtml() {
  var cv = O.r2.cv;
  return '<h3>專家綜合判讀：拖網漁場 × 海面溫度 × ODB 水文</h3>' +
  '<p>三種資料放在一起看，可以看出臺灣東北海域拖網漁場的物理結構：<b>漁場是由次表層（約 100 m）的冷水抬升區決定，海面溫度只是間接的指標</b>。</p>' +
  '<ul>' +
  '<li><b>100 m 水溫是最關鍵的物理變數。</b>作業處 100 m 水溫四季都穩定在 17.8–18.2°C，可及水域則為 20.7–21.9°C。選擇性指數在所有時段都是 −1.2 到 −1.5 個標準差，經空間自相關修正後，Spearman ρ = −0.58 到 −0.73，p &lt; 0.05。只用海洋變數建模時，它的置換重要度（ΔAUC ≈ 0.09）是第二名衛星 SST 的 5.8 倍。這對應黑潮在宜蘭外海遇陸棚坡折，次表層水向上湧升而形成的<b>東北角冷渦（cold dome）</b>。</li>' +
  '<li><b>作業避開黑潮主流，但緊貼流場變動強的區域。</b>作業處近表層流速只有可及水域的 40–80%（全年 ρ = −0.31，p = 0.02）；流速變異 EKE 卻是可及水域的 1.8–2.3 倍（冬季 ρ = 0.42，p = 0.013），冬、春兩季相對渦度也偏向氣旋式（正值，ρ = 0.21–0.25，p &lt; 0.05）。也就是說，漁場位於黑潮邊緣的剪切帶、渦旋與湧升區，而不是主軸。</li>' +
  '<li><b>水團以陸棚混合水為主；春、夏兩季會利用黑潮次表層水。</b>冬、秋兩季，陸棚混合水占作業的 90–95%（可及 62–64%），沿岸稀釋水與黑潮次表層水都被迴避；春季黑潮次表層水占作業 27%（可及 20%），夏季與可及比例相當，顯示春夏黑潮次表層水入侵陸棚邊緣時，形成可以利用的棲地。</li>' +
  '<li><b>海面溫度與鋒面的訊號，其實是次表層結構在海面的投影。</b>CoralTemp 鋒面出現頻率在冬季、東北季風期與全年顯著（ρ = 0.45–0.47，p &lt; 0.03），夏季與西南季風期也達顯著（ρ = 0.38–0.39），與 VDR 分析中「冬季 54% 作業位於鋒面 10 km 內」一致；但只用衛星 SST 的模式 AUC 為 ' + fmt(cv['衛星 SST'][0], 2) + '，只用 CTD 為 ' + fmt(cv['CTD 水文'][0], 2) + '，三種物理資料合併為 ' + fmt(cv['SST+CTD+ADCP'][0], 2) + '。可見海面溫度只捕捉到部分機制。</li>' +
  '<li><b>地形仍是最強的單一限制。</b>只用離岸距離與觀測水深下限，AUC 為 ' + fmt(cv['地形（離岸+水深）'][0], 2) + '，全部變數合併為 ' + fmt(cv['全部變數'][0], 2) + '。物理條件與地形高度共線：冷渦本身就是坡折地形與黑潮交互作用的產物。</li>' +
  '<li><b>季風轉換時，作業量往流速變異增加的格點移動</b>（ΔEKE 與 Δ作業占比 ρ = 0.26，p = 0.004），但這一項沒有做空間自相關修正，應視為假說。</li>' +
  '</ul>' +
  '<h3>管理與研究建議</h3><ol>' +
  '<li><b>以 100 m 水溫（冷渦強度與範圍）當作漁況指標</b>：可以取 CMEMS GLORYS 的逐日 100 m 溫度，或在水試所定期航次加測東北角斷面，建立冷渦指數，並檢驗其與拖網 CPUE 的年際關係。</li>' +
  '<li><b>把表層海溫的預報產品升級為「表層＋次表層」</b>：本站的長期 SST 趨勢加上 ODB 剖面，可估算升溫是否已經擾動次表層冷水的供應，這是氣候變遷對底拖網棲地衝擊的關鍵路徑。</li>' +
  '<li><b>資料時間尺度的限制</b>：ODB 是多年氣候平均場，無法處理年際變化；VDR 只有努力量、沒有漁獲。下一步應串接漁獲日誌與同步的剖面觀測（網具溫深記錄器）。</li>' +
  '<li><b>空間管理</b>：作業熱點與冷渦、坡折高度重疊，而且船隊定點忠誠度高，因此以坡折帶為單位的空間管理（例如季節性保護區），可能比以海溫為基礎的動態管理更有效。</li>' +
  '</ol>' +
  '<h3>方法摘要</h3><ul>' +
  '<li>ODB 0.25° CTD 與 ADCP 氣候場：衍生表層、100 m 與最深觀測層的溫鹽，表層減 50 m 溫差，最大浮力頻率 N²，混合層深度（比 10 m 水溫低 0.5°C 處），近表層、100 m 與近底流速，EKE（½(σu²+σv²)），垂直剪切，以及由近表層流場以中央差分計算的相對渦度與散度。</li>' +
  '<li>時段對應：以本站 2019–2024 年衛星海溫月氣候，逐一比對 ODB 表層溫度，選定 DJF／MAM／JJA／SON 四季與 10–3 月、5–9 月兩個季風期。</li>' +
  '<li>作業量：VDR 2021–2024 年，依時段換算為每月平均作業時數，彙整到 0.25° 格點。可及水域為船隊足跡涵蓋的 244 個格點。</li>' +
  '<li>統計方法：選擇性指數；Spearman ρ 搭配 Clifford et al.（1989）的有效樣本數修正；梯度提升樹（HistGradientBoosting）以 1°×1° 空間區塊做 5 折交叉驗證並重複 5 次，計算置換重要度與部分依賴；水團依 T–S 分類。</li>' +
  '</ul>' +
  '<div class="warnbox"><b>限制</b>：ODB 各時段的觀測密度不一，冬季 CTD 只有 113 個有效格點。「最深觀測層」不一定是海床，在深水格點會混入深層水，所以底層水溫、鹽度只在水深 ≤ 300 m 的格點上解讀。本頁的 VDR 資料只呈現彙整後的格點作業量，不含任何個別船舶資訊。</div>';
}

/* ================= 分頁掛勾 ================= */
var IDB_NAME = 'odbfish', IDB_STORE = 'kv';
function idb(mode, fn) { return new Promise(function (res, rej) { var r = indexedDB.open(IDB_NAME, 1); r.onupgradeneeded = function () { r.result.createObjectStore(IDB_STORE); }; r.onerror = function () { rej(r.error); }; r.onsuccess = function () { var tx = r.result.transaction(IDB_STORE, mode), st = tx.objectStore(IDB_STORE), q = fn(st); tx.oncomplete = function () { res(q && q.result); }; tx.onerror = function () { rej(tx.error); }; }; }); }
function idbGet() { return idb('readonly', function (st) { return st.get('data'); }); }
function idbPut(txt) { return idb('readwrite', function (st) { st.put(txt, 'data'); }); }
function idbDel() { return idb('readwrite', function (st) { st.delete('data'); }); }
var DATA_VER = 'crw31';
function valid(j) { return j && j.odb && j.vdr && j.r1 && j.r2 && j.ver === DATA_VER; }
function askFile() {
  return new Promise(function (res) {
    $$('.odbload').forEach(function (e) { e.remove(); });
    ['odb', 'fsst', 'fodb'].forEach(function (p) {
      var sec = $('#p-' + p), d = document.createElement('div'); d.className = 'card odbload'; sec.classList.add('odbnodata');
      d.innerHTML = '<h2>載入分析資料檔 <small>data/odb_fishery.json</small></h2><p class="note">本分頁使用的 ODB 水文格點與拖網漁船 VDR 網格作業量<b>不隨公開網站散布</b>。請選擇您本機的 <code>odb_fishery.json</code>（約 5 MB，須為 CoralTemp v3.1 版本；舊版檔案會被拒絕），資料只在您的瀏覽器內讀取，並快取在本機 IndexedDB，下次開啟會自動載入。</p><div class="ctl"><input type="file" accept=".json,application/json" class="odbfile"> <span class="note odbmsg" style="margin:0"></span></div>';
      sec.insertBefore(d, sec.firstChild);
    });
    $$('.odbfile').forEach(function (inp) { inp.onchange = function () { var f = inp.files[0]; if (!f) return; var msg = inp.parentNode.querySelector('.odbmsg'); msg.textContent = '讀取中…';
      f.text().then(function (txt) { var j = JSON.parse(txt); if (!valid(j)) throw new Error(j && j.odb && !j.ver ? '這是舊版（水試所海溫圖）資料檔，請改用 CoralTemp 版' : '檔案格式不符'); idbPut(txt).catch(function () {}); $$('.odbload').forEach(function (e) { e.remove(); }); $$('.odbnodata').forEach(function (e) { e.classList.remove('odbnodata'); }); res(j); })
       .catch(function (e) { msg.textContent = '無法讀取：' + e.message; }); }; });
  });
}
function ensure() {
  if (O) return Promise.resolve();
  if (!loading) {
    loading = loadLand().then(function () {
      return fetch('data/odb_fishery.json', { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw 0; return r.json(); })
        .catch(function () { return idbGet().then(function (t) { if (!t) throw 0; var j = JSON.parse(t); if (!valid(j)) throw 0; return j; }); })
        .catch(function () { return askFile(); });
    }).then(function (j) { O = j; });
  }
  return loading;
}
function render(p) {
  cur = p;
  ensure().then(function () {
    if (!built[p]) { built[p] = 1; if (p === 'odb') buildOdb(); if (p === 'fsst') buildFsst(); if (p === 'fodb') buildFodb(); }
    if (p === 'odb') drawOdbAll();
    if (p === 'fsst') { drawFsTs(); drawFsLt(); drawFsMap(); drawFsPref(); drawFsOther(); }
    if (p === 'fodb') drawFodbCharts();
  }).catch(function (e) { console.error(e); });
}
function init() {
  $('#tabs').addEventListener('click', function (e) { var p = e.target.dataset && e.target.dataset.p; if (!p) return; if (PAGES[p]) setTimeout(function () { render(p); }, 0); else cur = null; });
  var t; window.addEventListener('resize', function () { clearTimeout(t); t = setTimeout(function () { if (cur && O) render(cur); }, 250); });
  var m = $('#methBody'); if (m) { var d = document.createElement('div'); d.innerHTML = '<h3>ODB 水文與拖網漁場耦合（新增分頁）</h3><ul><li><b>ODB 水文</b>：臺灣海洋學門資料庫 CTD 與船載 ADCP 0.25° 氣候場，分四季與東北、西南季風期；衍生分層、混合層、渦度、散度、EKE 等變數。</li><li><b>漁場 × 衛星海溫</b>：採用 NOAA Coral Reef Watch CoralTemp v3.1 每日 5 km（0.05°）海溫，由 OceanWatch ERDDAP 取得 22–28°N、119–125°E 範圍（2018/11–2025/06 共 2,431 日），與拖網漁船 VDR 作業時數逐月配對：月平均海溫、逐日梯度的月平均、鋒面出現頻率（逐日梯度 ≥ 0.05°C/km 的比例），距平相對 CoralTemp 1991–2020 月氣候值；進行商數分析、Perry–Smith 檢定、GAM、交叉相關與 MCA，並以 1985–2025 月平均計算漁場長期增溫趨勢。</li><li><b>漁場 × ODB 水文</b>：計算選擇性指數，以 Clifford 有效樣本數修正 Spearman 相關，並用梯度提升樹做空間區塊交叉驗證、水團分析與季風期轉換分析。詳細判讀見該分頁最後一段。</li></ul>'; m.appendChild(d); }
  if (location.hash && PAGES[location.hash.slice(1)]) { var b = $$('#tabs button').filter(function (x) { return x.dataset.p === location.hash.slice(1); })[0]; if (b) b.click(); }
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
