/* app.js — 臺灣周邊海域 GHRSST 長期海溫時空動態分析：介面與繪圖 */
(function () {
'use strict';

var G = HARVEST.G, A = ANA, REGIONS = ANA.REGIONS;
var S = {
  meta: null, D: null, C: null, ST: null, MC: null, HOV: null,
  ser: {}, mhw: {}, ann: {}, land: null, ready: false
};
var $ = function (s) { return document.querySelector(s); };
var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };
var fmt = function (x, n) { return (x === null || x === undefined || x !== x) ? '—' : x.toFixed(n === undefined ? 2 : n); };

/* ================= 調色盤 ================= */
function ramp(stops) {
  return function (t) {
    if (t !== t) return null;
    t = Math.max(0, Math.min(1, t));
    var i = Math.min(stops.length - 2, Math.floor(t * (stops.length - 1)));
    var f = t * (stops.length - 1) - i, a = stops[i], b = stops[i + 1];
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
  };
}
var PAL = {
  sst: ramp([[8,24,64],[24,80,160],[40,150,190],[90,196,160],[190,216,104],[250,208,64],[244,140,44],[214,64,36],[150,20,28]]),
  div: ramp([[27,74,140],[62,126,190],[132,183,220],[205,226,238],[244,244,240],[248,214,186],[236,150,110],[206,80,52],[140,26,22]]),
  seq: ramp([[12,32,48],[24,74,102],[36,124,140],[92,172,140],[176,206,116],[244,214,96],[240,146,58],[196,58,40]]),
  pv:  ramp([[196,58,40],[240,170,70],[210,224,232],[40,62,84]])
};
function rgb(c) { return 'rgb(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ')'; }

/* ================= Canvas 基本 ================= */
function prep(cv, wCss, hCss) {
  var dpr = window.devicePixelRatio || 1;
  cv.width = Math.round(wCss * dpr); cv.height = Math.round(hCss * dpr);
  cv.style.width = wCss + 'px'; cv.style.height = hCss + 'px';
  var g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, wCss, hCss);
  return g;
}
function cssW(el) { return Math.max(320, el.getBoundingClientRect().width || el.parentNode.getBoundingClientRect().width || 900); }

/* ================= 場繪圖 ================= */
var ASPECT = (G.nlat / G.nlon) / Math.cos(25 * Math.PI / 180);

function drawField(cv, arr, vmin, vmax, pal, opts) {
  opts = opts || {};
  var w = opts.width || Math.min(cssW(cv.parentNode) - 4, 760);
  var h = Math.min(opts.maxH || 620, Math.round(w * ASPECT));
  w = Math.round(h / ASPECT);
  var g = prep(cv, w, h);

  var off = document.createElement('canvas');
  off.width = G.nlon; off.height = G.nlat;
  var og = off.getContext('2d');
  var im = og.createImageData(G.nlon, G.nlat);
  for (var j = 0; j < G.nlat; j++) {
    for (var i = 0; i < G.nlon; i++) {
      var v = arr[j * G.nlon + i];
      // ImageData 由上而下，資料由南而北 → 垂直翻轉
      var p = ((G.nlat - 1 - j) * G.nlon + i) * 4;
      if (v !== v) { im.data[p + 3] = 0; continue; }
      var c = pal((v - vmin) / (vmax - vmin));
      im.data[p] = c[0]; im.data[p + 1] = c[1]; im.data[p + 2] = c[2];
      im.data[p + 3] = opts.alpha ? opts.alpha[j * G.nlon + i] : 255;
    }
  }
  og.putImageData(im, 0, 0);
  g.fillStyle = '#0a1219'; g.fillRect(0, 0, w, h);
  g.imageSmoothingEnabled = opts.smooth !== false;
  // 半格外推，使邊界格點填滿畫布
  var sx = w / G.nlon, sy = h / G.nlat;
  g.drawImage(off, -0.5 * sx, -0.5 * sy, w + sx, h + sy);

  if (S.land) {
    g.imageSmoothingEnabled = true;
    g.drawImage(S.land, 0, 0, w, h);
  }
  grid(g, w, h);
  return { w: w, h: h };
}

function grid(g, w, h) {
  g.save();
  g.strokeStyle = 'rgba(200,220,238,.20)'; g.lineWidth = 1; g.setLineDash([3, 4]);
  g.font = '10px system-ui'; g.fillStyle = 'rgba(232,241,248,.85)';
  g.shadowColor = 'rgba(0,0,0,.85)'; g.shadowBlur = 3;
  for (var lo = 118; lo <= 126; lo += 2) {
    var x = (lo - G.bLon0) / (G.bLon1 - G.bLon0) * w;
    g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke();
    g.fillText(lo + '°E', x + 3, h - 7);
  }
  for (var la = 20; la <= 30; la += 2) {
    var y = h - (la - G.bLat0) / (G.bLat1 - G.bLat0) * h;
    g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke();
    g.fillText(la + '°N', 4, y - 3);
  }
  g.restore();
  g.strokeStyle = '#3c5c78'; g.lineWidth = 1; g.strokeRect(.5, .5, w - 1, h - 1);
}

function drawLegend(cv, vmin, vmax, pal, txtEl, unit) {
  var g = prep(cv, 260, 12);
  for (var x = 0; x < 260; x++) {
    g.fillStyle = rgb(pal(x / 259)); g.fillRect(x, 0, 1, 12);
  }
  if (txtEl) txtEl.textContent = fmt(vmin, 1) + ' – ' + fmt(vmax, 1) + ' ' + (unit || '°C');
}

/* 載入陸地遮罩（0.01°，與資料同一個地理轉換） */
function loadLand() {
  return new Promise(function (res) {
    var img = new Image();
    img.onload = function () {
      var c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      var g = c.getContext('2d');
      g.drawImage(img, 0, 0);
      var d = g.getImageData(0, 0, c.width, c.height);
      var out = g.createImageData(c.width, c.height);
      for (var i = 0; i < c.width * c.height; i++) {
        var v = d.data[i * 4];
        if (v > 127) { out.data[i*4]=52; out.data[i*4+1]=64; out.data[i*4+2]=78; out.data[i*4+3]=255; }
        else out.data[i * 4 + 3] = 0;
      }
      // 描邊：與海相鄰的陸點畫亮色
      var W = c.width, H = c.height;
      for (var y = 1; y < H - 1; y++) for (var x = 1; x < W - 1; x++) {
        var k = y * W + x;
        if (out.data[k*4+3] === 0) continue;
        if (out.data[(k-1)*4+3] === 0 || out.data[(k+1)*4+3] === 0 ||
            out.data[(k-W)*4+3] === 0 || out.data[(k+W)*4+3] === 0) {
          out.data[k*4]=150; out.data[k*4+1]=176; out.data[k*4+2]=198;
        }
      }
      g.putImageData(out, 0, 0);
      S.land = c; res(c);
    };
    img.onerror = function () { res(null); };
    img.src = 'data/land_mask.png';
  });
}

/* ================= 時間軸工具 ================= */
function isoAt(i) { return A.isoOf(S.meta.day0 + i); }
function yearAt(i) { return A.yearOf(S.meta.day0 + i); }

function axes(g, w, h, m, x0, x1, y0, y1, opts) {
  opts = opts || {};
  g.strokeStyle = '#26405a'; g.lineWidth = 1;
  g.beginPath(); g.moveTo(m.l, m.t); g.lineTo(m.l, h - m.b); g.lineTo(w - m.r, h - m.b); g.stroke();
  g.fillStyle = '#8ba6bd'; g.font = '11px ui-monospace,monospace';
  var ny = opts.yticks || 5;
  for (var k = 0; k <= ny; k++) {
    var v = y0 + (y1 - y0) * k / ny;
    var y = h - m.b - (v - y0) / (y1 - y0) * (h - m.t - m.b);
    g.strokeStyle = 'rgba(38,64,90,.55)';
    g.beginPath(); g.moveTo(m.l, y); g.lineTo(w - m.r, y); g.stroke();
    g.fillText(v.toFixed(opts.ydec === undefined ? 1 : opts.ydec), 4, y + 4);
  }
}
function px(v, v0, v1, a, b) { return a + (v - v0) / (v1 - v0) * (b - a); }

/* ================= 主要繪圖：總覽 ================= */
function drawOverview() {
  var w = cssW($('#p-ov .card')) - 40, m = { l: 46, r: 16, t: 14, b: 30 };

  /* 年平均 + Theil-Sen */
  var cv = $('#ovAnn'), h = 300, g = prep(cv, w, h);
  var yr = S.ann.all.years, va = S.ann.all.vals;
  var ok = va.filter(function (x) { return x === x; });
  var y0 = Math.min.apply(null, ok) - 0.15, y1 = Math.max.apply(null, ok) + 0.15;
  axes(g, w, h, m, 0, 1, y0, y1, { ydec: 1 });
  var ts = A.theilSen(Float64Array.from(yr), Float64Array.from(va));
  // 迴歸線（通過中位點）
  var mx = median(yr.filter(function (_, i) { return va[i] === va[i]; }));
  var my = median(ok);
  g.strokeStyle = 'rgba(255,112,67,.85)'; g.lineWidth = 2; g.setLineDash([6, 4]);
  g.beginPath();
  g.moveTo(px(yr[0], yr[0], yr[yr.length-1], m.l, w-m.r), px(my + ts.slope*(yr[0]-mx), y0, y1, h-m.b, m.t));
  g.lineTo(px(yr[yr.length-1], yr[0], yr[yr.length-1], m.l, w-m.r), px(my + ts.slope*(yr[yr.length-1]-mx), y0, y1, h-m.b, m.t));
  g.stroke(); g.setLineDash([]);
  g.strokeStyle = '#4fc3f7'; g.lineWidth = 2; g.beginPath();
  var started = false;
  for (var i = 0; i < yr.length; i++) {
    if (va[i] !== va[i]) { started = false; continue; }
    var X = px(yr[i], yr[0], yr[yr.length-1], m.l, w-m.r), Y = px(va[i], y0, y1, h-m.b, m.t);
    if (!started) { g.moveTo(X, Y); started = true; } else g.lineTo(X, Y);
  }
  g.stroke();
  g.fillStyle = '#4fc3f7';
  for (i = 0; i < yr.length; i++) if (va[i] === va[i]) {
    g.beginPath(); g.arc(px(yr[i], yr[0], yr[yr.length-1], m.l, w-m.r), px(va[i], y0, y1, h-m.b, m.t), 2.6, 0, 7); g.fill();
  }
  g.fillStyle = '#8ba6bd'; g.font = '11px ui-monospace,monospace';
  for (var y = Math.ceil(yr[0] / 5) * 5; y <= yr[yr.length-1]; y += 5) {
    var xx = px(y, yr[0], yr[yr.length-1], m.l, w-m.r);
    g.fillText(String(y), xx - 12, h - 10);
  }
  g.fillStyle = '#ff7043'; g.font = '12px system-ui';
  g.fillText('Theil–Sen ' + (ts.slope * 10 >= 0 ? '+' : '') + fmt(ts.slope * 10, 3) + ' °C/10yr' +
             (ts.p < 0.05 ? '（p < 0.05）' : '（p = ' + ts.p.toExponential(1) + '）'), m.l + 8, m.t + 14);

  /* 各海域趨勢長條 */
  var cv2 = $('#ovBar'), h2 = 320, g2 = prep(cv2, w, h2);
  var rows = REGIONS.map(function (r) {
    var s = S.ann[r.id];
    var t = A.theilSen(Float64Array.from(s.years), Float64Array.from(s.vals));
    return { r: r, slope: t.slope * 10, p: t.p };
  }).sort(function (a, b) { return b.slope - a.slope; });
  var maxS = Math.max.apply(null, rows.map(function (x) { return Math.abs(x.slope); })) * 1.25 || 1;
  var bh = (h2 - 24) / rows.length, x0 = 132;
  rows.forEach(function (row, k) {
    var yy = 12 + k * bh;
    g2.fillStyle = '#8ba6bd'; g2.font = '12px system-ui'; g2.textAlign = 'right';
    g2.fillText(row.r.zh, x0 - 8, yy + bh * .68);
    g2.textAlign = 'left';
    var Lw = (w - x0 - 70) * (row.slope / maxS);
    g2.fillStyle = row.p < 0.05 ? '#ff7043' : 'rgba(255,112,67,.42)';
    g2.fillRect(x0, yy + 3, Math.max(1, Lw), bh - 8);
    g2.fillStyle = '#e8f1f8'; g2.font = '11.5px ui-monospace,monospace';
    g2.fillText((row.slope >= 0 ? '+' : '') + fmt(row.slope, 3) + (row.p < 0.05 ? ' *' : ''), x0 + Math.max(1, Lw) + 6, yy + bh * .68);
  });
  g2.strokeStyle = '#26405a'; g2.beginPath(); g2.moveTo(x0, 8); g2.lineTo(x0, h2 - 8); g2.stroke();
  g2.fillStyle = '#8ba6bd'; g2.font = '11px system-ui'; g2.fillText('°C / 10 年', x0 + 4, h2 - 2);

  /* 熱浪日數 */
  var cv3 = $('#ovMhw'), h3 = 280, g3 = prep(cv3, w, h3);
  var md = S.mhwDaysByYear;
  var mm = { l: 46, r: 16, t: 14, b: 30 };
  var maxD = Math.max(10, Math.max.apply(null, md.vals));
  axes(g3, w, h3, mm, 0, 1, 0, maxD, { ydec: 0 });
  var bw = (w - mm.l - mm.r) / md.years.length;
  md.years.forEach(function (yy2, k) {
    var v = md.vals[k];
    var Y = px(v, 0, maxD, h3 - mm.b, mm.t);
    g3.fillStyle = v > 60 ? '#d84315' : (v > 30 ? '#ff7043' : '#4fc3f7');
    g3.fillRect(mm.l + k * bw + 1, Y, Math.max(1, bw - 2), h3 - mm.b - Y);
  });
  g3.fillStyle = '#8ba6bd'; g3.font = '11px ui-monospace,monospace';
  md.years.forEach(function (yy3, k) {
    if (yy3 % 5) return;
    g3.fillText(String(yy3), mm.l + k * bw - 10, h3 - 10);
  });
}
function median(a) { var b = a.slice().sort(function (x, y) { return x - y; }); var n = b.length; return n % 2 ? b[(n-1)/2] : (b[n/2-1]+b[n/2])/2; }

/* ================= KPI ================= */
function drawKpi() {
  var ts = A.theilSen(Float64Array.from(S.ann.all.years), Float64Array.from(S.ann.all.vals));
  var ok = S.ann.all.vals.map(function (v, i) { return [v, S.ann.all.years[i]]; })
                          .filter(function (x) { return x[0] === x[0]; });
  ok.sort(function (a, b) { return b[0] - a[0]; });
  var md = S.mhwDaysByYear, nH = md.vals.length;
  var early = mean(md.vals.slice(0, Math.floor(nH / 2)));
  var late = mean(md.vals.slice(Math.floor(nH / 2)));
  var ev = S.mhw.all.events;
  var top = ev.slice().sort(function (a, b) { return b.icum - a.icum; })[0];

  $('#ovKpi').innerHTML = [
    kpi('資料期間', S.meta.t0.slice(0, 7) + ' – ' + S.meta.t1.slice(0, 7), S.meta.nday.toLocaleString() + ' 日 · ' + S.meta.srcLabel, 'acc'),
    kpi('全域升溫速率', (ts.slope * 10 >= 0 ? '+' : '') + fmt(ts.slope * 10, 3), '°C / 10 年' + (ts.p < 0.05 ? ' · 顯著 (p<0.05)' : ''), 'warm'),
    kpi('最暖年', String(ok[0][1]), fmt(ok[0][0], 2) + ' °C（次暖 ' + ok[1][1] + '）', 'warm'),
    kpi('年熱浪日數', fmt(late, 0), '後半期；前半期 ' + fmt(early, 0) + ' 日（×' + fmt(late / Math.max(0.5, early), 1) + '）', 'warm'),
    kpi('氣候基期', S.meta.base[0] + '–' + S.meta.base[1], '30 年 · 符合 WMO 標準', 'acc'),
    kpi('最強熱浪事件', top ? top.s.slice(0, 7) : '—', top ? (top.dur + ' 日 · 峰值 +' + fmt(top.imax, 2) + ' °C') : '', 'warm')
  ].join('');

  var totD = ev.reduce(function (a, e) { return a + e.dur; }, 0);
  $('#mhKpi').innerHTML = [
    kpi('事件總數', String(ev.length), '全域面積平均序列', 'acc'),
    kpi('總熱浪日數', totD.toLocaleString(), '占全期 ' + fmt(totD / S.meta.nday * 100, 1) + ' %', 'warm'),
    kpi('最長事件', String(Math.max.apply(null, ev.map(function (e) { return e.dur; }) )) + ' 日', '', 'warm'),
    kpi('第 IV 級事件', String(ev.filter(function (e) { return e.cat >= 4; }).length), 'Hobday et al. (2018) 分級', 'warm')
  ].join('');
}
function kpi(lab, val, sub, cls) {
  return '<div class="kpi ' + (cls || '') + '"><div class="lab">' + lab + '</div><div class="val">' +
         val + '</div><div class="sub">' + (sub || '') + '</div></div>';
}
function mean(a) { var s = 0, n = 0; for (var i = 0; i < a.length; i++) if (a[i] === a[i]) { s += a[i]; n++; } return n ? s / n : NaN; }

/* ================= 空間分布 ================= */
var mapState = { i: 0, layer: 'sst', timer: null, pt: -1 };
function drawMap() {
  var mc = S.MC, i = mapState.i, ncell = G.n;
  var arr = new Float32Array(ncell);
  var vmin, vmax, pal;
  if (mapState.layer === 'sst') {
    for (var c = 0; c < ncell; c++) arr[c] = mc.vals[i * ncell + c];
    var mo = parseInt(mc.labels[i].slice(5), 10) - 1;
    var cl = S.MC.clim, ok = [];
    for (c = 0; c < ncell; c++) { var v = cl[mo * ncell + c]; if (v === v) ok.push(v); }
    ok.sort(function (p, q) { return p - q; });
    if (ok.length > 20) {
      vmin = ok[Math.floor(ok.length * .02)] - 1.2;
      vmax = ok[Math.floor(ok.length * .98)] + 1.2;
    } else { vmin = 18; vmax = 32; }
    pal = PAL.sst;
  } else {
    var mo2 = parseInt(mc.labels[i].slice(5), 10) - 1;
    for (c = 0; c < ncell; c++) arr[c] = mc.vals[i * ncell + c] - S.MC.clim[mo2 * ncell + c];
    vmin = -2.5; vmax = 2.5; pal = PAL.div;
  }
  var r = drawField($('#mapcv'), arr, vmin, vmax, pal, { maxH: 720 });
  drawLegend($('#mapLeg'), vmin, vmax, pal, $('#mapLegTxt'));
  $('#mapLbl').textContent = mc.labels[i];
  $('#mapSlider').value = i;
  $('#mapcv')._arr = arr; $('#mapcv')._geom = r;
}

function drawPoint() {
  var cv = $('#ptCv'), w = cssW(cv.parentNode) - 36, h = 200;
  var g = prep(cv, w, h);
  if (mapState.pt < 0) { g.fillStyle = '#8ba6bd'; g.font = '12px system-ui'; g.fillText('尚未選取格點', 10, 24); return; }
  var c = mapState.pt, ncell = G.n, mc = S.MC;
  var vals = [], labs = [];
  for (var i = 0; i < mc.nm; i++) { vals.push(mc.vals[i * ncell + c]); labs.push(mc.labels[i]); }
  var ok = vals.filter(function (x) { return x === x; });
  if (!ok.length) { g.fillStyle = '#8ba6bd'; g.fillText('該格點無資料（陸地）', 10, 24); return; }
  var m = { l: 40, r: 10, t: 10, b: 24 };
  var y0 = Math.min.apply(null, ok) - .3, y1 = Math.max.apply(null, ok) + .3;
  axes(g, w, h, m, 0, 1, y0, y1, { yticks: 4 });
  var fa = Float32Array.from(vals);
  line(g, fa, fa.length, 0, fa.length - 1, y0, y1, m, w, h, 'rgba(79,195,247,.45)', .8);
  line(g, movavg(fa, 12), fa.length, 0, fa.length - 1, y0, y1, m, w, h, '#ff7043', 1.8);
  g.fillStyle = '#8ba6bd'; g.font = '10px ui-monospace,monospace';
  for (var q = 0; q < labs.length; q++) {
    var yy = parseInt(labs[q].slice(0, 4), 10);
    if (yy % 10 || labs[q].slice(5) !== '01') continue;
    g.fillText(String(yy), px(q, 0, fa.length - 1, m.l, w - m.r) - 12, h - 8);
  }
  var j = Math.floor(c / G.nlon), ii = c % G.nlon;
  var la = G.lat0 + j * G.d, lo = G.lon0 + ii * G.d;
  var tr = S.ST.trend[c], tp = S.ST.trendP[c];
  $('#ptInfo').innerHTML = '格點 <b>' + fmt(lo, 3) + '°E, ' + fmt(la, 3) + '°N</b> ｜ 全期平均 <b>' +
    fmt(S.ST.mean[c], 2) + ' °C</b> ｜ 趨勢 <b>' + (tr >= 0 ? '+' : '') + fmt(tr, 3) + ' °C/10yr</b>' +
    (tp < 0.05 ? '<span class="tag sig">顯著</span>' : '<span class="tag">不顯著</span>') +
    ' ｜ 熱浪 <b>' + fmt(S.ST.mhwDays[c], 0) + ' 日/年</b>';
}

/* ================= 趨勢頁 ================= */
var TRINFO = {
  trend:   { t: '升溫速率（Theil–Sen）', u: '°C/10yr', d: '以各年年平均值計算 Theil–Sen 中位斜率，對離群年份穩健；顯著性以 Mann–Kendall 檢定。', pal: 'div', sym: true },
  trendP:  { t: 'Mann–Kendall p 值', u: '', d: '雙尾 p 值；越小代表單調趨勢越不可能由隨機變異造成。深色為 p < 0.05。', pal: 'pv', lo: 0, hi: 0.2 },
  mean:    { t: '全期平均海溫', u: '°C', d: '全記錄期間之逐格平均。', pal: 'sst' },
  amp:     { t: '季節振幅', u: '°C', d: '日序氣候場的最大值減最小值；反映該海域季節變化的幅度。', pal: 'seq' },
  phase:   { t: '年內最暖日', u: '日序', d: '日序氣候場達到最高溫的日序；數值越大表示季節高峰越晚。', pal: 'seq' },
  sdInter: { t: '年際標準差', u: '°C', d: '年平均值的標準差，衡量年際變異度（ENSO、季風強弱等）。', pal: 'seq' },
  mhwDays: { t: '年均海洋熱浪日數', u: '日/年', d: '逐格以自身氣候基期 90 百分位門檻判定的年均超標日數。', pal: 'seq' },
  mhwDelta:{ t: '熱浪日數變化', u: '日/年', d: '記錄後半期減前半期的年均熱浪日數差；正值代表熱浪明顯增多。', pal: 'div', sym: true }
};
function drawTrend() {
  var f = $('#trField').value, info = TRINFO[f], ncell = G.n;
  var arr = new Float32Array(ncell);
  if (f === 'mhwDelta') for (var c = 0; c < ncell; c++) arr[c] = S.ST.mhwDaysLate[c] - S.ST.mhwDaysEarly[c];
  else arr.set(S.ST[f]);
  var ok = []; for (c = 0; c < ncell; c++) if (arr[c] === arr[c]) ok.push(arr[c]);
  ok.sort(function (a, b) { return a - b; });
  var lo, hi;
  if (info.lo !== undefined) { lo = info.lo; hi = info.hi; }
  else {
    lo = ok[Math.floor(ok.length * 0.02)]; hi = ok[Math.floor(ok.length * 0.98)];
    if (info.sym) { var M = Math.max(Math.abs(lo), Math.abs(hi)); lo = -M; hi = M; }
  }
  var alpha = null;
  if ($('#trSig').checked && (f === 'trend' || f === 'mhwDelta')) {
    alpha = new Uint8Array(ncell);
    for (c = 0; c < ncell; c++) alpha[c] = (S.ST.trendP[c] < 0.05) ? 255 : 95;
  }
  var pal = PAL[info.pal];
  drawField($('#trCv'), arr, lo, hi, pal, { maxH: 720, alpha: alpha });
  drawLegend($('#trLeg'), lo, hi, pal, $('#trLegTxt'), info.u);
  $('#trTitle').textContent = info.t;
  $('#trDesc').textContent = info.d;
  var nSig = 0, nTot = 0;
  for (c = 0; c < ncell; c++) if (S.ST.trendP[c] === S.ST.trendP[c]) { nTot++; if (S.ST.trendP[c] < 0.05) nSig++; }
  var rows = [
    ['中位數', fmt(ok[Math.floor(ok.length / 2)], 3) + ' ' + info.u],
    ['第 5 / 95 百分位', fmt(ok[Math.floor(ok.length * .05)], 3) + ' / ' + fmt(ok[Math.floor(ok.length * .95)], 3)],
    ['最小 / 最大', fmt(ok[0], 3) + ' / ' + fmt(ok[ok.length - 1], 3)],
    ['有效格點', nTot + ' / ' + ncell],
    ['趨勢顯著格點', nSig + '（' + fmt(nSig / Math.max(1, nTot) * 100, 1) + ' %）']
  ];
  $('#trStat').innerHTML = rows.map(function (r) {
    return '<tr><td>' + r[0] + '</td><td class="mono">' + r[1] + '</td></tr>';
  }).join('');
  $('#trCv')._arr = arr;
}

/* ================= 時間序列 ================= */
function drawSeries() {
  var rid = $('#srRegion').value, mode = $$('#srMode button').filter(function (b) { return b.classList.contains('on'); })[0].dataset.m;
  var s = S.ser[rid], cv = $('#srCv'), w = cssW(cv.parentNode) - 40, h = 330;
  var g = prep(cv, w, h), m = { l: 46, r: 16, t: 14, b: 30 };
  var nday = S.meta.nday;

  if (mode === 'clim') {
    var y0 = 99, y1 = -99, d;
    for (d = 0; d < 366; d++) { var a = s.clim[d], b = s.thr[d];
      if (a === a) { y0 = Math.min(y0, a); y1 = Math.max(y1, b === b ? b : a); } }
    y0 -= .5; y1 += .5;
    axes(g, w, h, m, 0, 365, y0, y1);
    line(g, s.thr, 366, 0, 365, y0, y1, m, w, h, '#ff7043', 1.6, [5, 4]);
    line(g, s.clim, 366, 0, 365, y0, y1, m, w, h, '#4fc3f7', 2.2);
    // 近 3 年疊圖
    var cols = ['rgba(255,255,255,.30)', 'rgba(255,213,79,.55)', 'rgba(129,199,132,.7)'];
    var yrs = [], yNow = yearAt(nday - 1);
    for (var k = 2; k >= 0; k--) yrs.push(yNow - k);
    yrs.forEach(function (Y, q) {
      var tmp = new Float32Array(366).fill(NaN);
      for (var t = 0; t < nday; t++) if (yearAt(t) === Y) tmp[A.doyOf(S.meta.day0 + t) - 1] = s.v[t];
      line(g, tmp, 366, 0, 365, y0, y1, m, w, h, cols[q], 1.3);
    });
    g.fillStyle = '#8ba6bd'; g.font = '11px system-ui';
    ['1月','3月','5月','7月','9月','11月'].forEach(function (lab, q) {
      var dd = [0, 59, 120, 181, 243, 304][q];
      g.fillText(lab, px(dd, 0, 365, m.l, w - m.r) - 8, h - 10);
    });
    legendRow(g, w, m, [['氣候值 ' + S.meta.base[0] + '–' + S.meta.base[1], '#4fc3f7'],
                        ['90 百分位門檻', '#ff7043'],
                        [String(yrs[0]), cols[0]], [String(yrs[1]), cols[1]], [String(yrs[2]), cols[2]]]);
    $('#srNote').textContent = '年內變化：實線為氣候日均值，虛線為海洋熱浪門檻；細線為最近三年逐日觀測。';
  } else {
    var arr = mode === 'ano' ? s.ano : s.v;
    var mn = Infinity, mxv = -Infinity;
    for (var t2 = 0; t2 < nday; t2++) { var v = arr[t2]; if (v === v) { if (v < mn) mn = v; if (v > mxv) mxv = v; } }
    var pad = (mxv - mn) * .06; mn -= pad; mxv += pad;
    if (mode === 'ano') { var M2 = Math.max(Math.abs(mn), Math.abs(mxv)); mn = -M2; mxv = M2; }
    axes(g, w, h, m, 0, nday - 1, mn, mxv);
    if (mode === 'ano') {
      // 熱浪區間標示
      g.fillStyle = 'rgba(216,67,21,.28)';
      S.mhw[rid].events.forEach(function (e) {
        var X0 = px(e.i0, 0, nday - 1, m.l, w - m.r), X1 = px(e.i1, 0, nday - 1, m.l, w - m.r);
        g.fillRect(X0, m.t, Math.max(1, X1 - X0), h - m.t - m.b);
      });
      g.strokeStyle = 'rgba(232,241,248,.45)';
      var Y0 = px(0, mn, mxv, h - m.b, m.t);
      g.beginPath(); g.moveTo(m.l, Y0); g.lineTo(w - m.r, Y0); g.stroke();
    }
    line(g, arr, nday, 0, nday - 1, mn, mxv, m, w, h, mode === 'ano' ? '#ffb300' : '#4fc3f7', 0.9);
    // 365 日移動平均
    var sm = movavg(arr, 365);
    line(g, sm, nday, 0, nday - 1, mn, mxv, m, w, h, '#ff7043', 2);
    g.fillStyle = '#8ba6bd'; g.font = '11px ui-monospace,monospace';
    var y0y = yearAt(0), y1y = yearAt(nday - 1);
    for (var Y2 = Math.ceil(y0y / 5) * 5; Y2 <= y1y; Y2 += 5) {
      var idx = dayIndexOfYear(Y2);
      if (idx < 0) continue;
      g.fillText(String(Y2), px(idx, 0, nday - 1, m.l, w - m.r) - 12, h - 10);
    }
    legendRow(g, w, m, [[mode === 'ano' ? '逐日距平' : '逐日海溫', mode === 'ano' ? '#ffb300' : '#4fc3f7'],
                        ['365 日移動平均', '#ff7043']].concat(mode === 'ano' ? [['海洋熱浪期間', 'rgba(216,67,21,.6)']] : []));
    $('#srNote').textContent = mode === 'ano'
      ? '距平相對於 ' + S.meta.base[0] + '–' + S.meta.base[1] + ' 之逐日序氣候值；紅底為 Hobday 判準之海洋熱浪期間。'
      : '面積加權（cos φ）逐日平均海溫。';
  }
  drawMonthTable(rid);
}
function dayIndexOfYear(Y) {
  var t0 = Date.UTC(Y, 0, 1) / 86400000;
  var i = t0 - S.meta.day0;
  return (i >= 0 && i < S.meta.nday) ? i : -1;
}
function line(g, arr, n, x0, x1, y0, y1, m, w, h, col, lw, dash) {
  g.strokeStyle = col; g.lineWidth = lw || 1; g.setLineDash(dash || []);
  g.beginPath();
  var st = false;
  for (var i = 0; i < n; i++) {
    var v = arr[i];
    if (v !== v) { st = false; continue; }
    var X = px(i, x0, x1, m.l, w - m.r), Y = px(v, y0, y1, h - m.b, m.t);
    if (!st) { g.moveTo(X, Y); st = true; } else g.lineTo(X, Y);
  }
  g.stroke(); g.setLineDash([]);
}
function legendRow(g, w, m, items) {
  var x = m.l + 8;
  g.font = '11.5px system-ui';
  items.forEach(function (it) {
    g.fillStyle = it[1]; g.fillRect(x, m.t + 3, 14, 3);
    g.fillStyle = '#c9dcea'; g.fillText(it[0], x + 19, m.t + 8);
    x += 26 + g.measureText(it[0]).width;
  });
}
function movavg(a, w) {
  var n = a.length, out = new Float32Array(n).fill(NaN), h = w >> 1;
  var s = 0, c = 0, i;
  for (i = 0; i < n; i++) {
    if (a[i] === a[i]) { s += a[i]; c++; }
    if (i >= w) { var o = a[i - w]; if (o === o) { s -= o; c--; } }
    if (i >= w - 1 && c > w * .6) out[i - h] = s / c;
  }
  return out;
}
function drawMonthTable(rid) {
  var s = S.ser[rid], nday = S.meta.nday;
  var sum = {}, mm;
  for (var t = 0; t < nday; t++) {
    var v = s.v[t]; if (v !== v) continue;
    mm = A.dateOf(S.meta.day0 + t).getUTCMonth();
    if (!sum[mm]) sum[mm] = { s: 0, n: 0, mn: 99, mx: -99, a: 0, an: 0 };
    var o = sum[mm]; o.s += v; o.n++; if (v < o.mn) o.mn = v; if (v > o.mx) o.mx = v;
    var an = s.ano[t]; if (an === an) { o.a += an; o.an++; }
  }
  var h = '<tr><th>月</th><th>平均</th><th>最低</th><th>最高</th><th>平均距平</th><th>樣本日數</th></tr>';
  for (mm = 0; mm < 12; mm++) {
    var o2 = sum[mm]; if (!o2) continue;
    h += '<tr><td>' + (mm + 1) + ' 月</td><td class="mono">' + fmt(o2.s / o2.n) + '</td><td class="mono">' +
         fmt(o2.mn) + '</td><td class="mono">' + fmt(o2.mx) + '</td><td class="mono">' +
         (o2.an ? (o2.a / o2.an >= 0 ? '+' : '') + fmt(o2.a / o2.an) : '—') + '</td><td class="mono">' + o2.n + '</td></tr>';
  }
  $('#srTbl').innerHTML = h;
}

/* ================= Hovmöller ================= */
function drawHov() {
  var mode = $$('#hovMode button').filter(function (b) { return b.classList.contains('on'); })[0].dataset.m;
  var agg = $$('#hovAgg button').filter(function (b) { return b.classList.contains('on'); })[0].dataset.m;
  hovOne($('#hovCv'), 'zon', G.nlat, G.bLat0, G.bLat1, '°N', mode, agg);
  hovOne($('#hovCv2'), 'mer', G.nlon, G.bLon0, G.bLon1, '°E', mode, agg);
}
/* which: 'zon'（緯向平均→時緯圖）或 'mer'（經向平均→時經圖）
   agg:   'm' 月平均（由月平均立方即時計算）、'p' 候平均（5 日，隨資料檔提供） */
function hovOne(cv, which, nb, a0, a1, unit, mode, agg) {
  var w = cssW(cv.parentNode) - 40, h = 320, g = prep(cv, w, h);
  var m = { l: 46, r: 16, t: 10, b: 26 }, ncell = G.n, cols, nT, i, b, t;

  if (agg === 'm') {
    nT = S.MC.nm;
    cols = new Float32Array(nT * nb).fill(NaN);
    for (i = 0; i < nT; i++) {
      var mo = parseInt(S.MC.labels[i].slice(5), 10) - 1;
      for (b = 0; b < nb; b++) {
        var s = 0, n = 0, sc = 0, nc = 0;
        var len = which === 'zon' ? G.nlon : G.nlat;
        for (var k = 0; k < len; k++) {
          var c = which === 'zon' ? (b * G.nlon + k) : (k * G.nlon + b);
          var v = S.MC.vals[i * ncell + c];
          if (v === v) { s += v; n++; }
          var cl = S.MC.clim[mo * ncell + c];
          if (cl === cl) { sc += cl; nc++; }
        }
        if (n > 4) cols[i * nb + b] = (mode === 'ano' && nc > 4) ? (s / n - sc / nc) : (mode === 'ano' ? NaN : s / n);
      }
    }
  } else {
    var src = which === 'zon' ? S.HOV.zonP : S.HOV.merP;
    var clim = which === 'zon' ? S.HOV.zonClim : S.HOV.merClim;
    nT = S.HOV.np;
    cols = new Float32Array(nT * nb).fill(NaN);
    for (i = 0; i < nT; i++) {
      var doy = A.doyOf(S.meta.day0 + i * 5 + 2) - 1;
      for (b = 0; b < nb; b++) {
        var v2 = src[i * nb + b];
        if (v2 !== v2) continue;
        if (mode === 'ano') {
          var cv2 = clim[doy * nb + b];
          cols[i * nb + b] = (cv2 === cv2) ? v2 - cv2 : NaN;
        } else cols[i * nb + b] = v2;
      }
    }
  }

  var ok = []; for (i = 0; i < cols.length; i++) if (cols[i] === cols[i]) ok.push(cols[i]);
  if (!ok.length) { g.fillStyle = '#8ba6bd'; g.fillText('無資料', 10, 24); return; }
  ok.sort(function (x, y) { return x - y; });
  var lo = ok[Math.floor(ok.length * .01)], hi = ok[Math.floor(ok.length * .99)];
  if (mode === 'ano') { var M = Math.max(Math.abs(lo), Math.abs(hi)); lo = -M; hi = M; }
  var pal = mode === 'ano' ? PAL.div : PAL.sst;

  var off = document.createElement('canvas'); off.width = nT; off.height = nb;
  var og = off.getContext('2d'), im = og.createImageData(nT, nb);
  for (t = 0; t < nT; t++) for (b = 0; b < nb; b++) {
    var val = cols[t * nb + b], p2 = ((nb - 1 - b) * nT + t) * 4;
    if (val !== val) { im.data[p2] = 22; im.data[p2+1] = 34; im.data[p2+2] = 46; im.data[p2+3] = 255; continue; }
    var cc = pal((val - lo) / (hi - lo));
    im.data[p2] = cc[0]; im.data[p2+1] = cc[1]; im.data[p2+2] = cc[2]; im.data[p2+3] = 255;
  }
  og.putImageData(im, 0, 0);
  g.imageSmoothingEnabled = false;
  g.drawImage(off, m.l, m.t, w - m.l - m.r, h - m.t - m.b);
  g.strokeStyle = '#26405a'; g.strokeRect(m.l, m.t, w - m.l - m.r, h - m.t - m.b);
  g.fillStyle = '#8ba6bd'; g.font = '11px ui-monospace,monospace';
  for (var a = Math.ceil(a0 / 2) * 2; a <= a1; a += 2) {
    var Y = m.t + (1 - (a - a0) / (a1 - a0)) * (h - m.t - m.b);
    g.fillText(a + unit, 4, Y + 4);
  }
  var y0 = yearAt(0), y1 = yearAt(S.meta.nday - 1);
  for (var Y2 = Math.ceil(y0 / 5) * 5; Y2 <= y1; Y2 += 5) {
    var frac;
    if (agg === 'm') { var idx = S.MC.labels.indexOf(Y2 + '-01'); if (idx < 0) continue; frac = idx / (nT - 1); }
    else { var di = dayIndexOfYear(Y2); if (di < 0) continue; frac = Math.floor(di / 5) / (nT - 1); }
    var X = m.l + frac * (w - m.l - m.r);
    g.fillText(String(Y2), X - 12, h - 8);
    g.strokeStyle = 'rgba(255,255,255,.18)';
    g.beginPath(); g.moveTo(X, m.t); g.lineTo(X, h - m.b); g.stroke();
  }
  var cap = (mode === 'ano' ? '距平 ' : '海溫 ') + fmt(lo, 1) + ' – ' + fmt(hi, 1) + ' °C  ·  ' +
            (agg === 'm' ? '月平均' : '候（5 日）平均');
  g.font = '11.5px system-ui';
  var cw2 = g.measureText(cap).width + 14;
  g.fillStyle = 'rgba(4,18,28,.82)';
  g.fillRect(w - m.r - cw2, m.t + 4, cw2 - 4, 18);
  g.fillStyle = '#c9dcea';
  g.fillText(cap, w - m.r - cw2 + 6, m.t + 17);
}

/* ================= 年月矩陣 ================= */
function drawMx() {
  var rid = $('#mxRegion').value, s = S.ser[rid], cv = $('#mxCv');
  var w = cssW(cv.parentNode) - 40;
  var y0 = yearAt(0), y1 = yearAt(S.meta.nday - 1), ny = y1 - y0 + 1;
  var cellH = Math.max(13, Math.min(22, Math.floor(700 / ny)));
  var h = ny * cellH + 44;
  var g = prep(cv, w, h);
  var L = 52, R = 60, cw = (w - L - R) / 12;
  var sum = {}, t;
  for (t = 0; t < S.meta.nday; t++) {
    var an = s.ano[t]; if (an !== an) continue;
    var d = A.dateOf(S.meta.day0 + t), k = d.getUTCFullYear() + '-' + d.getUTCMonth();
    if (!sum[k]) sum[k] = [0, 0];
    sum[k][0] += an; sum[k][1]++;
  }
  var vals = [];
  for (var k2 in sum) if (sum[k2][1] > 10) vals.push(sum[k2][0] / sum[k2][1]);
  vals.sort(function (a, b) { return a - b; });
  var M = Math.max(Math.abs(vals[Math.floor(vals.length * .02)]), Math.abs(vals[Math.floor(vals.length * .98)]));
  g.font = '10.5px ui-monospace,monospace';
  for (var y = y0; y <= y1; y++) {
    var Y = 26 + (y - y0) * cellH;
    g.fillStyle = '#8ba6bd'; g.fillText(String(y), 6, Y + cellH * .72);
    var rs = 0, rn = 0;
    for (var mo = 0; mo < 12; mo++) {
      var e = sum[y + '-' + mo];
      var X = L + mo * cw;
      if (!e || e[1] < 10) { g.fillStyle = '#16222e'; g.fillRect(X, Y, cw - 1, cellH - 1); continue; }
      var v = e[0] / e[1]; rs += v; rn++;
      g.fillStyle = rgb(PAL.div((v + M) / (2 * M)));
      g.fillRect(X, Y, cw - 1, cellH - 1);
      if (cellH >= 15 && cw >= 46) {
        g.fillStyle = Math.abs(v) > M * .55 ? '#fff' : '#0d1620';
        g.fillText((v >= 0 ? '+' : '') + v.toFixed(1), X + cw / 2 - 11, Y + cellH * .72);
      }
    }
    if (rn) {
      g.fillStyle = rgb(PAL.div((rs / rn + M) / (2 * M)));
      g.fillRect(w - R + 6, Y, R - 12, cellH - 1);
      g.fillStyle = Math.abs(rs / rn) > M * .55 ? '#fff' : '#0d1620';
      g.fillText((rs / rn >= 0 ? '+' : '') + (rs / rn).toFixed(2), w - R + 10, Y + cellH * .72);
    }
  }
  g.fillStyle = '#8ba6bd'; g.font = '11px system-ui';
  for (mo = 0; mo < 12; mo++) g.fillText((mo + 1) + '月', L + mo * cw + cw / 2 - 10, 18);
  g.fillText('年均', w - R + 10, 18);
  g.fillText('色階 ±' + fmt(M, 1) + ' °C', 6, h - 8);
}

/* ================= 海洋熱浪 ================= */
function drawMhw() {
  var rid = $('#mhRegion').value, s = S.ser[rid], ev = S.mhw[rid].events;
  var cv = $('#mhCv'), w = cssW(cv.parentNode) - 40, h = 320, g = prep(cv, w, h);
  var m = { l: 46, r: 16, t: 14, b: 30 }, nday = S.meta.nday;
  var mn = Infinity, mx = -Infinity;
  for (var t = 0; t < nday; t++) { var v = s.v[t]; if (v === v) { if (v < mn) mn = v; if (v > mx) mx = v; } }
  mn -= .4; mx += .4;
  axes(g, w, h, m, 0, nday - 1, mn, mx);
  var climD = new Float32Array(nday), thrD = new Float32Array(nday);
  for (t = 0; t < nday; t++) { var d = A.doyOf(S.meta.day0 + t) - 1; climD[t] = s.clim[d]; thrD[t] = s.thr[d]; }
  g.fillStyle = 'rgba(216,67,21,.35)';
  ev.forEach(function (e) {
    var X0 = px(e.i0, 0, nday - 1, m.l, w - m.r), X1 = px(e.i1, 0, nday - 1, m.l, w - m.r);
    g.fillRect(X0, m.t, Math.max(1, X1 - X0), h - m.t - m.b);
  });
  line(g, s.v, nday, 0, nday - 1, mn, mx, m, w, h, 'rgba(232,241,248,.8)', .8);
  line(g, climD, nday, 0, nday - 1, mn, mx, m, w, h, '#4fc3f7', 1.4);
  line(g, thrD, nday, 0, nday - 1, mn, mx, m, w, h, '#ff7043', 1.4);
  g.fillStyle = '#8ba6bd'; g.font = '11px ui-monospace,monospace';
  var y0 = yearAt(0), y1 = yearAt(nday - 1);
  for (var Y = Math.ceil(y0 / 5) * 5; Y <= y1; Y += 5) {
    var i = dayIndexOfYear(Y); if (i < 0) continue;
    g.fillText(String(Y), px(i, 0, nday - 1, m.l, w - m.r) - 12, h - 10);
  }
  legendRow(g, w, m, [['逐日海溫', 'rgba(232,241,248,.8)'], ['氣候值', '#4fc3f7'], ['90 百分位門檻', '#ff7043'], ['熱浪事件', 'rgba(216,67,21,.7)']]);

  var rows = ev.slice().sort(function (a, b) { return b.icum - a.icum; });
  var html = '<tr><th>起始</th><th>結束</th><th>持續(日)</th><th>峰值強度</th><th>平均強度</th><th>累積強度</th><th>分級</th></tr>';
  rows.forEach(function (e) {
    html += '<tr><td class="mono">' + e.s + '</td><td class="mono">' + e.e + '</td><td class="mono">' + e.dur +
      '</td><td class="mono">+' + fmt(e.imax) + '</td><td class="mono">+' + fmt(e.imean) + '</td><td class="mono">' +
      fmt(e.icum, 1) + '</td><td><span class="pill ' + (e.cat >= 3 ? 'hot' : '') + '">' +
      ['I 中等', 'II 強', 'III 嚴重', 'IV 極端'][e.cat - 1] + '</span></td></tr>';
  });
  $('#mhTbl').innerHTML = html;
}

/* ================= 方法頁 ================= */
function methodHtml() {
  var m = S.meta || {};
  return [
    '<h2>方法與限制 <small>Methods &amp; caveats</small></h2>',
    '<h3>1. 資料來源與取得方式</h3>',
    '<ul>',
    '<li><b>NOAA Coral Reef Watch CoralTemp v3.1</b>（5 km，每日，1985-04 迄今）—— 本頁的主要長期資料。' +
      '1985–2002 以 Pathfinder 與 OSTIA 重分析、2002 年後以 NOAA/NESDIS Geo-Polar Blended 夜間 SST 為基礎，' +
      '是目前公開、可由瀏覽器直接取用、且橫跨四十年的最高解析度每日 SST 記錄，亦為國際珊瑚白化熱壓力監測的作業標準產品。' +
      '經 PacIOOS ERDDAP 取得。</li>',
    '<li><b>NOAA OISST v2.1</b>（0.25°，每日）—— 交叉檢核用。經 NCEI ERDDAP 取得，' +
      '惟該節點僅開放最近數年的滾動視窗（約 2020 年起），全記錄請走 Python 路徑。</li>',
    '<li>兩者皆以 <b>ERDDAP griddap</b> 之 NetCDF 次集方式取得（server-side subsetting），' +
      '只傳輸 116–128°E、18–32°N 範圍的格點，不下載全球場，亦不對圖磚做色階反演。</li>',
    '</ul>',
    '<div class="warnbox"><b>關於 GHRSST MUR L4 與 OVL 圖層</b>　' +
      'OceanDataLab OVL 上的 <code>GIBS_GHRSST_L4_MUR_Sea_Surface_Temperature</code> 圖層，其底層產品為 JPL 的 MUR L4。' +
      '該產品在 ERDDAP 上由 NOAA CoastWatch 提供，但<b>經實測，CoastWatch、upwell、PIFSC、PolarWatch 等 NOAA 節點皆未送出 ' +
      '<code>Access-Control-Allow-Origin</code> 標頭</b>，瀏覽器無法讀取其回應，因此網頁端無法直接取用 MUR。' +
      '若需 MUR L4 或 OISST 全記錄，請使用 <code>tools/fetch_ghrsst.py</code> 於伺服器端取得 —— ' +
      '該路徑不受同源政策限制，且輸出格式與本頁完全相同。</div>',
    '<div class="warnbox"><b>為何不直接由 OVL 圖磚取值？</b>　OVL 是網頁檢視器，其圖磚為套用調色盤後的影像。' +
      '由影像反推溫度會引入色階量化誤差（約 ±0.15 °C）、調色盤改版風險與等值線／地名疊加物污染，' +
      '且需對第三方檢視器做長年份大量爬取。本專案改用資料提供者為程式存取所設計的 ERDDAP／OPeNDAP 介面，' +
      '取得的是原始物理量而非顏色。</div>',
    '<h3>2. 網格與範圍</h3>',
    '<p>116.125–127.875 °E、18.125–31.875 °N，0.25°×0.25°，共 48×56 = 2,688 格，與 <code>twsst20260907.png</code> 之圖幅完全對齊。' +
      'OISST 為原生 0.25° 網格，無需重取樣；CoralTemp 之 0.05° 格點與本網格恰好對齊，以每 5 格取樣（非區塊平均）取得 0.25° 值，' +
      '等同取各 0.25° 網格中心的 5 km 觀測值。</p>',
    '<h3>3. 氣候基期與距平</h3>',
    '<p>採 <b>' + (m.base ? m.base[0] + '–' + m.base[1] : '1991–2020') + '</b> 之 30 年基期（WMO 標準）。逐格、逐日序氣候值以 <b>±5 日視窗</b>（共 11 日）跨基期各年取平均，再沿日序做 <b>31 日環狀移動平均</b>平滑，即 Hobday et al. (2016) 之標準流程。距平 = 觀測 − 該日序氣候值。</p>',
    '<h3>4. 海洋熱浪判定</h3>',
    '<ul><li>門檻：同一視窗與平滑程序下的 <b>第 90 百分位</b>（線性內插）。</li>',
    '<li>事件：連續 <b>≥ 5 日</b>超過門檻；兩事件間隔 <b>≤ 2 日</b>者合併為同一事件。</li>',
    '<li>強度：距平的峰值、平均與累積值（°C·日）；分級依 Hobday et al. (2018)，以「超出門檻幅度／(門檻−氣候值)」之倍數界定 I–IV 級。</li></ul>',
    '<h3>5. 趨勢估計</h3>',
    '<p>先算<b>年平均</b>（該年有效日數 &gt; 300 才計入），再以 <b>Theil–Sen 中位斜率</b>估計趨勢、<b>Mann–Kendall</b> 檢定顯著性。相較最小平方法，此組合不假設殘差常態、對個別極端年份穩健，適合含 ENSO 大幅年際振盪的海溫序列。</p>',
    '<h3>6. 面積加權</h3>',
    '<p>所有區域平均均以 cos(緯度) 加權，避免高緯格點因面積較小而被高估。</p>',
    '<h3>7. 已知限制</h3>',
    '<ul>',
    '<li><b>L4 分析場非直接觀測</b>：OISST 與 MUR 皆為內插／融合產品，雲量高的期間實際上倚賴背景場與現場資料，近岸與海峽窄水道的細部結構不可過度解讀。</li>',
    '<li><b>解析度限制</b>：本頁取樣至 0.25°（約 25 km），無法解析臺灣海峽內的中小尺度鋒面、上升流與潮汐混合帶。CoralTemp 原生為 5 km，如需該尺度請改以 0.05° 全解析度擷取。</li>',
    '<li><b>取樣而非平均</b>：CoralTemp 以每 5 格取樣降至 0.25°，代表格點中心值而非格內平均；在梯度劇烈的近岸與鋒面帶，與區塊平均可能有數十分之一度的差異。</li>',
    '<li><b>趨勢的區域歸因</b>：局部升溫速率同時包含全球暖化訊號與環流位移（如黑潮路徑變動）造成的重新分配，兩者未在此分離。</li>',
    '<li><b>熱浪統計對基期敏感</b>：以 1991–2020 為基期時，暖化本身會使近年超標日數自然增加；此為「相對於固定基期」之定義，與採移動基期的結果不可直接比較。</li>',
    '<li><b>資料版本</b>：CoralTemp 與 OISST 的最近數週屬 near-real-time／preliminary，日後會由正式版取代，數值可能微調。</li>',
    '</ul>',
    '<h3>8. 與影像反演儀表板的關係</h3>',
    '<p>本專案與 <a href="https://petercttseng-ux.github.io/taiwan-sst-dashboard/">臺灣周邊海域衛星遙測海面水溫時空分布儀表板</a> 互補：後者由水試所每日發布的 SST 圖檔反演，逐日、時間短（2018 迄今）但呈現的是機關實際發布的圖資；本專案直接取用原始數值產品，時間長（1981 迄今）且可做氣候尺度統計。兩者在重疊期間可互為驗證。</p>',
    '<h3>9. 引用</h3>',
    '<ul>',
    '<li>NOAA Coral Reef Watch (2018, updated daily). NOAA Coral Reef Watch Daily Global 5km Satellite Sea Surface Temperature (CoralTemp v3.1). College Park, Maryland, USA: NOAA Coral Reef Watch.</li>',
    '<li>Huang, B. et al. (2021). Improvements of the Daily Optimum Interpolation Sea Surface Temperature (DOISST) Version 2.1. <i>J. Climate</i>, 34, 2923–2939.</li>',
    '<li>JPL MUR MEaSUREs Project (2015). GHRSST Level 4 MUR Global Foundation SST Analysis. PO.DAAC. doi:10.5067/GHGMR-4FJ04（伺服器端路徑）</li>',
    '<li>Hobday, A. J. et al. (2016). A hierarchical approach to defining marine heatwaves. <i>Prog. Oceanogr.</i>, 141, 227–238.</li>',
    '<li>Hobday, A. J. et al. (2018). Categorizing and naming marine heatwaves. <i>Oceanography</i>, 31(2), 162–173.</li>',
    '</ul>'
  ].join('');
}

/* ================= 建置流程 ================= */
function curSrc() {
  var b = $$('#srcSeg button').filter(function (x) { return x.classList.contains('on'); })[0];
  return b ? b.dataset.s : 'crw';
}
function log(msg, cls) {
  var el = $('#buildLog');
  el.innerHTML += '<div class="' + (cls || '') + '">' + msg + '</div>';
  el.scrollTop = el.scrollHeight;
}
function prog(p, txt) {
  $('#progWrap').style.display = '';
  $('#barfill').style.width = (p * 100).toFixed(1) + '%';
  $('#progTxt').textContent = txt;
}

function selfTest() {
  var key = curSrc(), src = HARVEST.SRC[key];
  log('<b>連線自我檢測</b> — ' + src.label + '　@ ' + HARVEST.getServer(key));
  return HARVEST.timeRange(src).then(function (tr) {
    log('✓ 資料集時間範圍：' + tr.t0.slice(0, 10) + ' – ' + tr.t1.slice(0, 10), 'ok');
    $('#hdPeriod').textContent = tr.t0.slice(0, 10) + ' – ' + tr.t1.slice(0, 10);
    var d = tr.t1.slice(0, 10);
    return HARVEST.fetchChunk(src, d, d).then(function (c) {
      var n = 0, s = 0;
      for (var i = 0; i < c.vals.length; i++) if (c.vals[i] !== -32768) { n++; s += c.vals[i] * 0.01; }
      log('✓ 取得 ' + d + ' 單日場：' + c.nlat + '×' + c.nlon + ' 格，有效 ' + n + ' 格，平均 ' +
          (s / n).toFixed(2) + ' °C', 'ok');
      log('✓ NetCDF 解碼、緯度定向、缺值處理皆正常。可以開始建置。', 'ok');
      return true;
    });
  }).catch(function (e) {
    log('✗ 連線失敗：' + e.message, 'err');
    log('可能原因：所在網路封鎖了該節點，或該節點未送出 CORS 標頭而瀏覽器無法讀取回應。' +
        '請改選另一個資料來源，或改走「沒有網路存取權時」段落所述的 Python 路徑。', 'err');
    return false;
  });
}

function build() {
  var srcKey = $$('#srcSeg button').filter(function (b) { return b.classList.contains('on'); })[0].dataset.s;
  var base = [parseInt($('#baseFrom').value, 10), parseInt($('#baseTo').value, 10)];
  var yFrom = $('#yFrom').value.trim(), yTo = $('#yTo').value.trim();
  $('#btnBuild').disabled = true;
  log('<b>開始建置</b>　來源 ' + HARVEST.SRC[srcKey].label);
  var t0 = Date.now();

  return HARVEST.harvest(srcKey, {
    from: yFrom ? yFrom + '-01-01' : undefined,
    to: yTo ? yTo + '-12-31' : undefined
  }, function (p) {
    prog(p.done / p.total * 0.62, '擷取 ' + p.label + '（' + p.done + '/' + p.total + '）');
  }).then(function (D) {
    log('✓ 擷取完成：' + D.nday.toLocaleString() + ' 日 × ' + D.ncell + ' 格（' +
        ((Date.now() - t0) / 1000).toFixed(0) + ' 秒）', 'ok');
    return analyse(D, base, srcKey);
  }).then(function () {
    log('✓ 全部完成，共 ' + ((Date.now() - t0) / 1000).toFixed(0) + ' 秒。', 'ok');
    prog(1, '完成');
    $('#btnBuild').disabled = false;
    $('#btnExport').disabled = false;
    go('ov');
  }).catch(function (e) {
    log('✗ 建置失敗：' + (e && e.message ? e.message : e), 'err');
    $('#btnBuild').disabled = false;
  });
}

function analyse(D, base, srcKey) {
  return Promise.resolve().then(function () {
    prog(0.64, '計算氣候基期與熱浪門檻…');
    var C = A.climatology(D, base, 5);
    S.D = D; S.C = C;
    log('✓ 氣候場：' + base[0] + '–' + base[1] + '，±5 日視窗 + 31 日平滑');
    prog(0.74, '計算逐格趨勢與熱浪統計…');
    var yr0 = A.yearOf(D.day0), yr1 = A.yearOf(D.day0 + D.nday - 1);
    // 只用完整年份做趨勢
    if (A.doyOf(D.day0) > 15) yr0 += 1;
    if (A.doyOf(D.day0 + D.nday - 1) < 350) yr1 -= 1;
    var ST = A.cellStats(D, C, { yr0: yr0, yr1: yr1 });
    S.ST = ST;
    log('✓ 逐格 Theil–Sen 趨勢與 Mann–Kendall 檢定（' + yr0 + '–' + yr1 + '）');
    prog(0.84, '計算月平均場與 Hovmöller…');
    var MC = A.monthlyCube(D);
    MC.index = {};
    MC.labels.forEach(function (l, i) {
      MC.index[parseInt(l.slice(0, 4), 10) * 12 + parseInt(l.slice(5), 10) - 1] = i;
    });
    // 月氣候場（12 × ncell）
    MC.clim = new Float32Array(12 * D.ncell).fill(NaN);
    var s12 = new Float64Array(12 * D.ncell), n12 = new Int32Array(12 * D.ncell);
    MC.labels.forEach(function (l, i) {
      var y = parseInt(l.slice(0, 4), 10), mo = parseInt(l.slice(5), 10) - 1;
      if (y < base[0] || y > base[1]) return;
      for (var c = 0; c < D.ncell; c++) {
        var v = MC.vals[i * D.ncell + c];
        if (v === v) { s12[mo * D.ncell + c] += v; n12[mo * D.ncell + c]++; }
      }
    });
    for (var i2 = 0; i2 < 12 * D.ncell; i2++) if (n12[i2] > 3) MC.clim[i2] = s12[i2] / n12[i2];
    S.MC = MC;
    var HV = A.hovmoller(D, G);
    var pz = A.pentad(HV.zon, G.nlat, D.nday), pm = A.pentad(HV.mer, G.nlon, D.nday);
    S.HOV = { zonP: pz.vals, merP: pm.vals, np: pz.np,
              zonClim: doyClim(HV.zon, G.nlat, D, base),
              merClim: doyClim(HV.mer, G.nlon, D, base) };
    prog(0.92, '計算各海域序列與熱浪事件…');
    var W = A.areaWeights(G);
    S.ser = {}; S.mhw = {}; S.ann = {};
    REGIONS.forEach(function (r) {
      var mask = A.regionMask(r.box, G);
      var v = A.seriesFor(D, mask, W);
      var cs = A.climSeriesFor(C, mask, W, D.ncell);
      var ano = new Float32Array(D.nday).fill(NaN);
      var climD = new Float32Array(D.nday), thrD = new Float32Array(D.nday);
      for (var t = 0; t < D.nday; t++) {
        var d = A.doyOf(D.day0 + t) - 1;
        climD[t] = cs.clim[d]; thrD[t] = cs.thr[d];
        if (v[t] === v[t] && cs.clim[d] === cs.clim[d]) ano[t] = v[t] - cs.clim[d];
      }
      S.ser[r.id] = { v: v, ano: ano, clim: cs.clim, thr: cs.thr };
      S.mhw[r.id] = A.detectMHW(v, climD, thrD, D.day0);
      // 年平均
      var years = [], vals = [], acc = {}, cnt = {};
      for (t = 0; t < D.nday; t++) {
        var y = A.yearOf(D.day0 + t);
        if (v[t] !== v[t]) continue;
        acc[y] = (acc[y] || 0) + v[t]; cnt[y] = (cnt[y] || 0) + 1;
      }
      for (var y2 = yr0; y2 <= yr1; y2++) { years.push(y2); vals.push(cnt[y2] > 300 ? acc[y2] / cnt[y2] : NaN); }
      S.ann[r.id] = { years: years, vals: vals };
    });
    // 全域年熱浪日數
    var fl = S.mhw.all.flag, byY = {}, dy = {};
    for (var t2 = 0; t2 < D.nday; t2++) {
      var y3 = A.yearOf(D.day0 + t2);
      dy[y3] = (dy[y3] || 0) + 1;
      if (fl[t2]) byY[y3] = (byY[y3] || 0) + 1;
    }
    var ys = [], vs = [];
    for (var y4 = yr0; y4 <= yr1; y4++) { ys.push(y4); vs.push(dy[y4] > 300 ? (byY[y4] || 0) : NaN); }
    S.mhwDaysByYear = { years: ys, vals: vs };

    S.meta = {
      src: srcKey, srcLabel: HARVEST.SRC[srcKey].label,
      t0: A.isoOf(D.day0), t1: A.isoOf(D.day0 + D.nday - 1),
      day0: D.day0, nday: D.nday, ncell: D.ncell,
      base: base, yr0: yr0, yr1: yr1,
      generated: new Date().toISOString().slice(0, 19) + 'Z'
    };
    S.ready = true;
    log('✓ ' + REGIONS.length + ' 個海域序列與熱浪事件（全域 ' + S.mhw.all.events.length + ' 起）');
    renderAll();
  });
}
function doyClim(daily, nb, D, base) {
  var out = new Float32Array(366 * nb), cnt = new Int32Array(366 * nb);
  for (var t = 0; t < D.nday; t++) {
    var y = A.yearOf(D.day0 + t);
    if (y < base[0] || y > base[1]) continue;
    var d = A.doyOf(D.day0 + t) - 1;
    for (var b = 0; b < nb; b++) {
      var v = daily[t * nb + b];
      if (v === v) { out[d * nb + b] += v; cnt[d * nb + b]++; }
    }
  }
  for (var i = 0; i < 366 * nb; i++) out[i] = cnt[i] > 3 ? out[i] / cnt[i] : NaN;
  // 沿日序 31 日平滑
  var tmp = new Float32Array(366);
  for (b = 0; b < nb; b++) {
    for (d = 0; d < 366; d++) tmp[d] = out[d * nb + b];
    for (d = 0; d < 366; d++) {
      var s = 0, n = 0;
      for (var k = -15; k <= 15; k++) { var vv = tmp[(d + k + 366) % 366]; if (vv === vv) { s += vv; n++; } }
      out[d * nb + b] = n ? s / n : NaN;
    }
  }
  return out;
}

/* ================= 匯出 ================= */
function b64(buf) {
  var u = new Uint8Array(buf), s = '', CH = 0x8000;
  for (var i = 0; i < u.length; i += CH) s += String.fromCharCode.apply(null, u.subarray(i, i + CH));
  return btoa(s);
}
var SCALES = { trendP: 10000, phase: 10, mhwDays: 10, mhwDaysEarly: 10, mhwDaysLate: 10 };
function scaleOf(k) { return SCALES[k] || 100; }
function exportData() {
  var q = function (f32, sc) {
    var o = new Int16Array(f32.length);
    for (var i = 0; i < f32.length; i++) o[i] = (f32[i] === f32[i]) ? Math.round(f32[i] * sc) : -32768;
    return b64(o.buffer);
  };
  var out = {
    meta: S.meta, regions: REGIONS,
    grid: { nlon: G.nlon, nlat: G.nlat, lon0: G.lon0, lat0: G.lat0, d: G.d },
    monthly: { labels: S.MC.labels, vals: q(S.MC.vals, 100), clim: q(S.MC.clim, 100) },
    cells: {}, series: {}, mhw: {},
    ann: S.ann, mhwDaysByYear: S.mhwDaysByYear,
    hov: { np: S.HOV.np, zonP: q(S.HOV.zonP, 100), merP: q(S.HOV.merP, 100),
           zonClim: q(S.HOV.zonClim, 100), merClim: q(S.HOV.merClim, 100) }
  };
  ['mean','trend','trendP','mhwDays','mhwDaysEarly','mhwDaysLate','amp','phase','sdInter']
    .forEach(function (k) { out.cells[k] = q(S.ST[k], scaleOf(k)); });
  REGIONS.forEach(function (r) {
    out.series[r.id] = { v: q(S.ser[r.id].v, 100), ano: q(S.ser[r.id].ano, 100),
                         clim: q(S.ser[r.id].clim, 100), thr: q(S.ser[r.id].thr, 100) };
    out.mhw[r.id] = S.mhw[r.id].events;
  });
  var blob = new Blob([JSON.stringify(out)], { type: 'application/json' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'analysis.json';
  a.click();
  log('✓ 已匯出 analysis.json（' + (blob.size / 1048576).toFixed(1) + ' MB）。放入 data/ 後本頁即會直接載入。', 'ok');
}

function unb64(s) {
  var bin = atob(s), u = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return new Int16Array(u.buffer);
}
function deq(s, sc) {
  var a = unb64(s), o = new Float32Array(a.length);
  for (var i = 0; i < a.length; i++) o[i] = a[i] === -32768 ? NaN : a[i] / sc;
  return o;
}
function loadPrebuilt(j) {
  S.meta = j.meta;
  S.MC = { labels: j.monthly.labels, nm: j.monthly.labels.length,
           vals: deq(j.monthly.vals, 100), clim: deq(j.monthly.clim, 100), index: {} };
  S.MC.labels.forEach(function (l, i) {
    S.MC.index[parseInt(l.slice(0, 4), 10) * 12 + parseInt(l.slice(5), 10) - 1] = i;
  });
  S.ST = {};
  Object.keys(j.cells).forEach(function (k) { S.ST[k] = deq(j.cells[k], scaleOf(k)); });
  S.ser = {}; S.mhw = {};
  REGIONS.forEach(function (r) {
    var e = j.series[r.id];
    S.ser[r.id] = { v: deq(e.v, 100), ano: deq(e.ano, 100), clim: deq(e.clim, 100), thr: deq(e.thr, 100) };
    S.mhw[r.id] = { events: j.mhw[r.id], flag: null };
  });
  S.ann = j.ann; S.mhwDaysByYear = j.mhwDaysByYear;
  S.HOV = { np: j.hov.np, zonP: deq(j.hov.zonP, 100), merP: deq(j.hov.merP, 100),
            zonClim: deq(j.hov.zonClim, 100), merClim: deq(j.hov.merClim, 100) };
  S.ready = true;
  renderAll();
}

/* ================= 介面裝配 ================= */
function renderAll() {
  $('#hdPeriod').textContent = S.meta.t0 + ' – ' + S.meta.t1;
  $('#hdSrc').textContent = S.meta.srcLabel;
  $('#mapSlider').max = S.MC.nm - 1;
  mapState.i = S.MC.nm - 1;
  drawKpi(); drawOverview(); drawMap(); drawPoint(); drawTrend();
  drawSeries(); drawHov(); drawMx(); drawMhw();
}
function go(p) {
  $$('#tabs button').forEach(function (b) { b.classList.toggle('on', b.dataset.p === p); });
  $$('.page').forEach(function (s) { s.classList.toggle('on', s.id === 'p-' + p); });
  if (S.ready) {
    if (p === 'ov') drawOverview();
    if (p === 'map') { drawMap(); drawPoint(); }
    if (p === 'trend') drawTrend();
    if (p === 'series') drawSeries();
    if (p === 'hov') drawHov();
    if (p === 'mx') drawMx();
    if (p === 'mhw') drawMhw();
  }
}

function initUI() {
  $('#methBody').innerHTML = methodHtml();
  var showServer = function () {
    var k = curSrc();
    $('#srvTxt').textContent = HARVEST.getServer(k).replace('https://', '');
    var s0 = HARVEST.SRC[k];
    $('#yFrom').value = s0.start.slice(0, 4);
  };
  ['#srRegion', '#mxRegion', '#mhRegion'].forEach(function (id) {
    var s = $(id);
    REGIONS.forEach(function (r) {
      var o = document.createElement('option'); o.value = r.id; o.textContent = r.zh; s.appendChild(o);
    });
  });
  $('#tabs').onclick = function (e) { if (e.target.dataset.p) go(e.target.dataset.p); };
  $('#btnTest').onclick = function () { selfTest(); };
  $('#btnBuild').onclick = function () { build(); };
  $('#btnExport').onclick = function () { exportData(); };
  $('#btnClear').onclick = function () {
    HARVEST.idbClear().then(function () { log('已清除本機快取。'); });
  };
  segment('#srcSeg', function () { showServer(); });
  showServer();
  segment('#mapLayer', function (v) { mapState.layer = v; drawMap(); });
  segment('#srMode', function () { drawSeries(); });
  segment('#hovMode', function () { drawHov(); });
  segment('#hovAgg', function () { drawHov(); });
  $('#trField').onchange = drawTrend;
  $('#trSig').onchange = drawTrend;
  $('#srRegion').onchange = drawSeries;
  $('#mxRegion').onchange = drawMx;
  $('#mhRegion').onchange = drawMhw;
  $('#mapSlider').oninput = function () { mapState.i = +this.value; drawMap(); };
  $('#mapPlay').onclick = function () {
    if (mapState.timer) { clearInterval(mapState.timer); mapState.timer = null; this.textContent = '▶ 播放'; return; }
    this.textContent = '⏸ 暫停';
    mapState.timer = setInterval(function () {
      mapState.i = (mapState.i + 1) % S.MC.nm; drawMap();
    }, 90);
  };
  $('#mapcv').onclick = function (e) {
    if (!S.ready) return;
    var r = this.getBoundingClientRect();
    var fx = (e.clientX - r.left) / r.width, fy = (e.clientY - r.top) / r.height;
    var i = Math.min(G.nlon - 1, Math.max(0, Math.floor(fx * G.nlon)));
    var j = Math.min(G.nlat - 1, Math.max(0, Math.floor((1 - fy) * G.nlat)));
    mapState.pt = j * G.nlon + i; drawPoint();
  };
  hover($('#mapcv'), $('#tip'), function (c) {
    var a = $('#mapcv')._arr; if (!a) return null;
    var v = a[c];
    return (v === v) ? (mapState.layer === 'sst' ? fmt(v) + ' °C' : (v >= 0 ? '+' : '') + fmt(v) + ' °C 距平') : '無資料';
  });
  hover($('#trCv'), $('#tip2'), function (c) {
    var a = $('#trCv')._arr; if (!a) return null;
    var v = a[c], info = TRINFO[$('#trField').value];
    return (v === v) ? fmt(v, 3) + ' ' + info.u : '無資料';
  });
  window.addEventListener('resize', debounce(function () {
    if (S.ready) go($$('#tabs button').filter(function (b) { return b.classList.contains('on'); })[0].dataset.p);
  }, 220));
}
function segment(sel, cb) {
  var el = $(sel);
  el.onclick = function (e) {
    var b = e.target.closest('button'); if (!b) return;
    Array.prototype.forEach.call(el.querySelectorAll('button'), function (x) { x.classList.toggle('on', x === b); });
    cb(b.dataset.l || b.dataset.m || b.dataset.s);
  };
}
function hover(cv, tip, fn) {
  cv.onmousemove = function (e) {
    var r = cv.getBoundingClientRect();
    var fx = (e.clientX - r.left) / r.width, fy = (e.clientY - r.top) / r.height;
    var i = Math.min(G.nlon - 1, Math.max(0, Math.floor(fx * G.nlon)));
    var j = Math.min(G.nlat - 1, Math.max(0, Math.floor((1 - fy) * G.nlat)));
    var txt = fn(j * G.nlon + i);
    if (!txt) { tip.style.display = 'none'; return; }
    tip.style.display = 'block';
    tip.textContent = fmt(G.lon0 + i * G.d, 2) + 'E ' + fmt(G.lat0 + j * G.d, 2) + 'N · ' + txt;
    tip.style.left = Math.min(r.width - 150, e.clientX - r.left + 12) + 'px';
    tip.style.top = (e.clientY - r.top + 12) + 'px';
  };
  cv.onmouseleave = function () { tip.style.display = 'none'; };
}
function debounce(f, ms) { var t; return function () { clearTimeout(t); t = setTimeout(f, ms); }; }

/* ================= 啟動 ================= */
function boot() {
  initUI();
  loadLand().then(function () {
    return fetch('data/analysis.json', { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error('no prebuilt');
      return r.json();
    });
  }).then(function (j) {
    loadPrebuilt(j);
    $('#loading').style.display = 'none';
    go('ov');
    log('已載入預先產製的 data/analysis.json（' + j.meta.t0 + ' – ' + j.meta.t1 + '）。', 'ok');
  }).catch(function () {
    $('#loading').style.display = 'none';
    log('尚未偵測到 <b>data/analysis.json</b>。請按「連線自我檢測」確認可連到 ERDDAP，再按「開始建置」。');
    HARVEST.idbKeys().then(function (k) {
      if (k && k.length) log('本機快取中已有 ' + k.length + ' 個年度區塊，建置時會直接沿用。');
    }).catch(function () {});
  });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();

})();
