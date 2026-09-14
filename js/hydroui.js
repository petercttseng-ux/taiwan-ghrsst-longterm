/* hydroui.js — 「水體結構與流場」分頁之介面與繪圖 */
(function (root) {
'use strict';
var H = root.HYDRO, ANA = root.ANA;
var REG = ANA ? ANA.REGIONS : [];
var $ = function (s, r) { return (r || document).querySelector(s); };
var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
var fmt = function (x, n) { return (x === null || x === undefined || x !== x) ? '—' : x.toFixed(n === undefined ? 2 : n); };
var st = { ready: false, busy: false, satRows: null };

/* ---------- 調色盤 ---------- */
function ramp(s) {
  return function (t) {
    if (t !== t) return null;
    t = Math.max(0, Math.min(1, t));
    var i = Math.min(s.length - 2, Math.floor(t * (s.length - 1)));
    var f = t * (s.length - 1) - i, a = s[i], b = s[i + 1];
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
  };
}
var PAL = {
  sst: ramp([[8,24,64],[24,80,160],[40,150,190],[90,196,160],[190,216,104],[250,208,64],[244,140,44],[214,64,36],[150,20,28]]),
  div: ramp([[27,74,140],[62,126,190],[132,183,220],[205,226,238],[244,244,240],[248,214,186],[236,150,110],[206,80,52],[140,26,22]]),
  seq: ramp([[12,32,48],[24,74,102],[36,124,140],[92,172,140],[176,206,116],[244,214,96],[240,146,58],[196,58,40]]),
  sal: ramp([[40,26,72],[46,70,140],[38,132,160],[92,178,146],[186,206,110],[244,206,96],[236,140,70]])
};
function rgb(c) { return 'rgb(' + (c[0]|0) + ',' + (c[1]|0) + ',' + (c[2]|0) + ')'; }
function prep(cv, w, h) {
  var d = root.devicePixelRatio || 1;
  cv.width = Math.round(w * d); cv.height = Math.round(h * d);
  cv.style.width = w + 'px'; cv.style.height = h + 'px';
  var g = cv.getContext('2d'); g.setTransform(d, 0, 0, d, 0, 0); g.clearRect(0, 0, w, h);
  return g;
}
function cssW(el) {
  return Math.max(320, (el.getBoundingClientRect().width || (el.parentNode && el.parentNode.getBoundingClientRect().width) || 900));
}
function px(v, v0, v1, a, b) { return a + (v - v0) / (v1 - v0) * (b - a); }

/* ---------- 版面 ---------- */
var HTML = [
'<div class="card">',
'  <h2>載入現場水文資料 <small>ODB 15′ 網格氣候圖集 — 檔案僅在您的瀏覽器內解析，不會上傳</small></h2>',
'  <p class="note">',
'    本儲存庫不散布任何第三方資料集，因此本分頁需要您自行提供兩個 CSV。請至',
'    <a href="https://www.odb.ntu.edu.tw/ctd/ctd15moa/" target="_blank" rel="noopener">ODB 水文（ctd_15moa）</a> 與',
'    <a href="https://www.odb.ntu.edu.tw/adcp/adcp15moa/" target="_blank" rel="noopener">ODB 海流（sadcp_15moa）</a>',
'    下載後一次選取兩個檔（或分兩次選）。解析結果以 <code>int16</code> 量化後存入本機 IndexedDB，',
'    下次開啟直接載入，無需重新選檔。也可改為載入 <code>tools/pack_hydro.py</code> 產出的',
'    <code>hydro.bin</code>。',
'  </p>',
'  <div class="ctl">',
'    <input type="file" id="hyFile" accept=".csv,.bin,.txt" multiple>',
'    <button class="btn" id="hyClear">清除本機水文快取</button>',
'    <span class="mono" id="hyStat">尚未載入</span>',
'  </div>',
'  <div id="hyProgWrap" style="display:none"><div class="bar"><div class="barfill" id="hyBar"></div></div></div>',
'  <div id="hyLog" class="logbox mono" style="max-height:160px"></div>',
'</div>',
'<div id="hyMain" style="display:none">',
'  <div class="card">',
'    <h2>水平分布與流場 <small>Horizontal fields &amp; currents</small></h2>',
'    <div class="ctl">',
'      <label>期別</label><select id="hyTp"></select>',
'      <label>深度</label><select id="hyLev"></select>',
'      <label>底圖</label>',
'      <select id="hyBase">',
'        <option value="T">水溫 °C</option><option value="S">鹽度 psu</option>',
'        <option value="SG">密度 σt kg/m³</option><option value="SP">流速 m/s</option>',
'        <option value="MLD">混合層深度 m</option><option value="DSIG">上層 100 m Δσt</option>',
'        <option value="D20">20 °C 等溫面深度 m</option><option value="THG">溫躍層強度 °C/100 m</option>',
'      </select>',
'      <label><input type="checkbox" id="hyVec" checked> 疊加流向量</label>',
'    </div>',
'    <div class="hygrid">',
'      <div>',
'        <div id="hyMapWrap" style="position:relative"><canvas id="hyMap"></canvas><div id="hyTip" class="tip"></div></div>',
'        <div class="legend"><canvas id="hyLeg" width="260" height="12"></canvas><span id="hyLegTxt"></span></div>',
'      </div>',
'      <div><div class="card" style="margin:0">',
'        <h2>垂直剖面 <small>Click a cell</small></h2>',
'        <p class="note" id="hyPtInfo">在左圖點選任一格點，顯示該點四季之溫、鹽、密度剖面。</p>',
'        <canvas id="hyProf" height="300"></canvas>',
'        <div class="tblwrap"><table id="hyPtTbl"></table></div>',
'      </div></div>',
'    </div>',
'  </div>',
'  <div class="card">',
'    <h2>經向斷面 <small>Meridional section — v(z, lon) 正值為北向</small></h2>',
'    <div class="ctl">',
'      <label>緯度</label><select id="hySectLat"></select>',
'      <label>變數</label>',
'      <div class="seg" id="hySectVar">',
'        <button data-m="v" class="on">北向流速 v</button><button data-m="u">東向流速 u</button>',
'        <button data-m="T">水溫</button><button data-m="S">鹽度</button>',
'      </div>',
'      <label>期別</label><select id="hySectTp"></select>',
'    </div>',
'    <canvas id="hySect" height="340"></canvas>',
'    <p class="note" id="hySectNote"></p>',
'  </div>',
'  <div class="card">',
'    <h2>整合診斷：衛星升溫速率 × 現場層結 <small>Satellite trend vs. in-situ stratification</small></h2>',
'    <p class="note" id="hyDiagNote">需先於「資料建置」完成衛星海溫分析，本卡才會填入升溫速率。</p>',
'    <div class="hygrid2">',
'      <div><canvas id="hyScat" height="330"></canvas></div>',
'      <div><div class="tblwrap"><table id="hyCorr"></table></div></div>',
'    </div>',
'    <div class="tblwrap"><table id="hyRegTbl"></table></div>',
'  </div>',
'</div>'].join('\n');

/* ---------- 記錄 ---------- */
function log(m, c) {
  var b = $('#hyLog'); if (!b) return;
  var d = document.createElement('div'); if (c) d.className = c;
  d.innerHTML = m; b.appendChild(d); b.scrollTop = b.scrollHeight;
}

/* ---------- 載入 ---------- */
function haveAll(D) { return D && D.T && D.U; }

function saveCache(D) {
  var o = {};
  for (var k in D) o[k] = D[k];
  return H.kPut('v1', o).then(function () { log('已存入本機快取。'); }, function (e) {
    log('存入快取失敗（' + e.message + '），本次仍可使用。', 'warn');
  });
}

function onFiles(files) {
  if (st.busy) return;
  st.busy = true;
  $('#hyProgWrap').style.display = '';
  var D = H.data || {};
  var list = Array.prototype.slice.call(files);
  var step = function (i) {
    if (i >= list.length) {
      H.data = D; st.busy = false; $('#hyProgWrap').style.display = 'none';
      finish(); return Promise.resolve();
    }
    var f = list[i];
    log('讀取 <b>' + f.name + '</b>（' + (f.size / 1048576).toFixed(1) + ' MB）…');
    return f.arrayBuffer().then(function (buf) {
      if (/\.bin$/i.test(f.name)) {
        var o = H.parseBin(buf);
        for (var k in o) D[k] = o[k];
        log('　hydro.bin 解析完成。');
      } else {
        var txt = new TextDecoder('utf-8').decode(buf);
        var r = H.parseCSV(txt, function (p) { $('#hyBar').style.width = (100 * p).toFixed(1) + '%'; });
        for (var k2 in r.arr) D[k2] = r.arr[k2];
        log('　' + (r.kind === 'ctd' ? 'CTD' : 'SADCP') + '：讀入 ' + r.rows.toLocaleString() +
            ' 列，落在 116–128°E／18–32°N 網格內 ' + r.kept.toLocaleString() + ' 列。');
      }
      $('#hyBar').style.width = '100%';
      return step(i + 1);
    }).catch(function (e) {
      log('✗ ' + f.name + '：' + e.message, 'warn');
      return step(i + 1);
    });
  };
  step(0);
}

function finish() {
  var D = H.data;
  if (!D || !D.T) { $('#hyStat').textContent = '尚缺 CTD 水文檔'; return; }
  if (!D.U) { $('#hyStat').textContent = 'CTD 已載入，尚缺 SADCP 海流檔'; }
  else $('#hyStat').textContent = 'CTD + SADCP 已載入';
  st.ready = true;
  saveCache(D);
  $('#hyMain').style.display = '';
  fillSelectors();
  drawAll();
}

function tryCache() {
  return H.kGet('v1').then(function (o) {
    if (!o || !o.T) return false;
    H.data = o; st.ready = true;
    $('#hyStat').textContent = '已自本機快取載入' + (o.U ? '（CTD + SADCP）' : '（僅 CTD）');
    log('自本機快取載入水文資料。');
    $('#hyMain').style.display = '';
    fillSelectors(); drawAll();
    return true;
  }).catch(function () { return false; });
}

/* ---------- 選單 ---------- */
function fillSelectors() {
  var f = function (sel, items, val) {
    var s = $(sel); if (!s || s._done) return;
    items.forEach(function (it) {
      var o = document.createElement('option'); o.value = it[0]; o.textContent = it[1]; s.appendChild(o);
    });
    s.value = val; s._done = true;
  };
  f('#hyTp', H.TPS.map(function (c, i) { return [c, H.TPLAB[i]]; }), 0);
  f('#hySectTp', H.TPS.map(function (c, i) { return [c, H.TPLAB[i]]; }), 0);
  f('#hyLev', H.ALEV.filter(function (z) { return z <= 300; }).map(function (z) { return [z, z + ' m']; }), 10);
  var lats = [];
  for (var la = 20; la <= 28.01; la += 0.25) lats.push([la.toFixed(2), la.toFixed(2) + '°N']);
  f('#hySectLat', lats, '23.50');
}

/* ---------- 衍生場 ---------- */
var FIELD = {
  T:   { pal: 'sst', unit: '°C',       lab: '水溫' },
  S:   { pal: 'sal', unit: 'psu',      lab: '鹽度' },
  SG:  { pal: 'seq', unit: 'kg/m³',    lab: '密度 σt' },
  SP:  { pal: 'seq', unit: 'm/s',      lab: '流速' },
  MLD: { pal: 'seq', unit: 'm',        lab: '混合層深度', inv: true },
  DSIG:{ pal: 'seq', unit: 'kg/m³',    lab: '上層 100 m Δσt' },
  D20: { pal: 'seq', unit: 'm',        lab: '20 °C 等溫面深度' },
  THG: { pal: 'seq', unit: '°C/100 m', lab: '溫躍層強度' }
};
function buildField(key, it, lev) {
  var n = H.NLON * H.NLAT, a = new Float64Array(n); a.fill(NaN);
  var kz;
  if (key === 'T' || key === 'S' || key === 'SG') {
    kz = H.nearLev(H.CLEV, lev);
    for (var j = 0; j < H.NLAT; j++) for (var i = 0; i < H.NLON; i++)
      a[j * H.NLON + i] = H.cval(key, it, kz, j, i);
  } else if (key === 'SP') {
    kz = H.nearLev(H.ALEV, lev);
    for (j = 0; j < H.NLAT; j++) for (i = 0; i < H.NLON; i++)
      a[j * H.NLON + i] = H.aval('SP', it, kz, j, i);
  } else {
    var mk = { MLD: 'mld', DSIG: 'dsig', D20: 'd20', THG: 'thg' }[key];
    for (j = 0; j < H.NLAT; j++) for (i = 0; i < H.NLON; i++) {
      var m = H.metrics(H.profile(it, j, i));
      a[j * H.NLON + i] = (m[mk] === m[mk]) ? m[mk] : NaN;
    }
  }
  return a;
}
function pctRange(a, lo, hi) {
  var v = [];
  for (var i = 0; i < a.length; i++) if (a[i] === a[i]) v.push(a[i]);
  if (v.length < 4) return [0, 1];
  v.sort(function (x, y) { return x - y; });
  var q = function (p) { return v[Math.max(0, Math.min(v.length - 1, Math.round(p * (v.length - 1))))]; };
  var a0 = q(lo), a1 = q(hi);
  return a1 > a0 ? [a0, a1] : [a0 - 1, a0 + 1];
}

/* ---------- 陸地遮罩 ---------- */
var LAND = null, landTried = false;
function loadLand() {
  if (landTried) return; landTried = true;
  var img = new Image();
  img.onload = function () {
    var c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    var g = c.getContext('2d'); g.drawImage(img, 0, 0);
    var d = g.getImageData(0, 0, c.width, c.height), o = g.createImageData(c.width, c.height);
    var n = c.width * c.height, i;
    for (i = 0; i < n; i++) {
      if (d.data[i * 4] > 127) {
        o.data[i*4] = 52; o.data[i*4+1] = 64; o.data[i*4+2] = 78; o.data[i*4+3] = 255;
      } else o.data[i*4+3] = 0;
    }
    var W = c.width, Hh = c.height;
    for (var y = 1; y < Hh - 1; y++) for (var x = 1; x < W - 1; x++) {
      var k = y * W + x;
      if (o.data[k*4+3] === 0) continue;
      if (o.data[(k-1)*4+3] === 0 || o.data[(k+1)*4+3] === 0 ||
          o.data[(k-W)*4+3] === 0 || o.data[(k+W)*4+3] === 0) {
        o.data[k*4] = 150; o.data[k*4+1] = 176; o.data[k*4+2] = 198;
      }
    }
    g.putImageData(o, 0, 0); LAND = c; drawMap();
  };
  img.onerror = function () {};
  img.src = 'data/land_mask.png';
}

/* ---------- 地圖 ---------- */
var ASPECT = (H.NLAT / H.NLON) / Math.cos(25 * Math.PI / 180);
function drawMap() {
  var cv = $('#hyMap'); if (!cv || !H.data) return;
  loadLand();
  var w0 = Math.min(cssW($('#hyMapWrap')) - 4, 700);
  var h = Math.min(880, Math.round(w0 * ASPECT));
  var w = Math.round(h / ASPECT);
  var g = prep(cv, w, h);
  var key = $('#hyBase').value, it = H.tpIdx(+$('#hyTp').value), lev = +$('#hyLev').value;
  var a = buildField(key, it, lev);
  cv._arr = a; cv._key = key;
  var info = FIELD[key], rr = pctRange(a, 0.02, 0.98);
  var pal = PAL[info.pal];
  var cw = w / H.NLON, ch = h / H.NLAT;
  g.fillStyle = '#0d151d'; g.fillRect(0, 0, w, h);
  for (var j = 0; j < H.NLAT; j++) for (var i = 0; i < H.NLON; i++) {
    var v = a[j * H.NLON + i]; if (v !== v) continue;
    var t = (v - rr[0]) / (rr[1] - rr[0]);
    if (info.inv) t = 1 - t;
    g.fillStyle = rgb(pal(t));
    g.fillRect(i * cw, h - (j + 1) * ch, cw + 0.6, ch + 0.6);
  }
  if (LAND) { g.imageSmoothingEnabled = true; g.drawImage(LAND, 0, 0, w, h); }
  grid(g, w, h);
  if ($('#hyVec').checked && H.data.U) drawVec(g, w, h, it, lev);
  legend(rr, info, key);
}
function grid(g, w, h) {
  g.strokeStyle = 'rgba(140,175,205,.16)'; g.lineWidth = 1;
  g.fillStyle = '#7e99b3'; g.font = '11px system-ui';
  for (var lo = 118; lo <= 126; lo += 2) {
    var x = (lo - H.LON0) / (H.NLON * H.DD) * w;
    g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke();
    g.fillText(lo + '°E', x + 3, h - 4);
  }
  for (var la = 20; la <= 30; la += 2) {
    var y = h - (la - H.LAT0) / (H.NLAT * H.DD) * h;
    g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke();
    g.fillText(la + '°N', 3, y - 3);
  }
}
function drawVec(g, w, h, it, lev) {
  var kz = H.nearLev(H.ALEV, lev);
  var cw = w / H.NLON, ch = h / H.NLAT;
  var step = w < 520 ? 3 : 2;
  var sc = Math.min(cw, ch) * step * 2.2;   /* 1 m/s 對應之像素長度 */
  g.lineWidth = 1.1; g.strokeStyle = 'rgba(18,26,34,.85)';
  for (var j = 0; j < H.NLAT; j += step) for (var i = 0; i < H.NLON; i += step) {
    var u = H.aval('U', it, kz, j, i), v = H.aval('V', it, kz, j, i);
    if (u !== u || v !== v) continue;
    var sp = Math.sqrt(u * u + v * v); if (sp < 0.02) continue;
    var x = (i + 0.5) * cw, y = h - (j + 0.5) * ch;
    var L = Math.min(sc * 1.4, sc * sp), ux = u / sp, vy = v / sp;
    var x2 = x + ux * L, y2 = y - vy * L;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x2, y2); g.stroke();
    var ah = Math.min(5, L * 0.45);
    g.beginPath(); g.moveTo(x2, y2);
    g.lineTo(x2 - ah * (ux * 0.9 + vy * 0.5), y2 + ah * (vy * 0.9 - ux * 0.5));
    g.lineTo(x2 - ah * (ux * 0.9 - vy * 0.5), y2 + ah * (vy * 0.9 + ux * 0.5));
    g.closePath(); g.fillStyle = 'rgba(18,26,34,.85)'; g.fill();
  }
  /* 比例尺 */
  g.fillStyle = 'rgba(12,20,28,.72)'; g.fillRect(w - 96, 6, 90, 26);
  g.strokeStyle = '#dfe9f2'; g.lineWidth = 1.4;
  g.beginPath(); g.moveTo(w - 88, 24); g.lineTo(w - 88 + sc * 0.5, 24); g.stroke();
  g.fillStyle = '#dfe9f2'; g.font = '11px system-ui'; g.fillText('0.5 m/s', w - 88, 17);
}
function legend(rr, info, key) {
  var cv = $('#hyLeg'), g = cv.getContext('2d');
  var pal = PAL[info.pal];
  for (var x = 0; x < cv.width; x++) {
    var t = x / (cv.width - 1);
    g.fillStyle = rgb(pal(info.inv ? 1 - t : t));
    g.fillRect(x, 0, 1, cv.height);
  }
  $('#hyLegTxt').textContent = info.lab + '　' + fmt(rr[0], 2) + ' – ' + fmt(rr[1], 2) + ' ' + info.unit;
}

/* ---------- 剖面 ---------- */
function drawProfile() {
  var cv = $('#hyProf'); if (!cv) return;
  var w = cssW(cv.parentNode), h = 300, g = prep(cv, w, h);
  var pt = H.UI.pt;
  if (pt < 0 || !H.data) {
    g.fillStyle = '#7e99b3'; g.font = '13px system-ui';
    g.fillText('在上圖點選任一格點。', 42, 40); return;
  }
  var i = pt % H.NLON, j = (pt / H.NLON) | 0;
  var lo = H.LON0 + i * H.DD, la = H.LAT0 + j * H.DD;
  var seasons = [[0, '全年', '#e8eef5'], [13, '冬', '#5b9bd5'], [14, '春', '#6fbf73'],
                 [15, '夏', '#e06c4f'], [16, '秋', '#d9a441']];
  var m = { l: 42, r: 10, t: 14, b: 26 };
  var pmax = 300;
  var prs = seasons.map(function (s) { return H.profile(H.tpIdx(s[0]), j, i); });
  var tmin = 99, tmax = -99;
  prs.forEach(function (p) { p.t.forEach(function (v, k) { if (p.p[k] <= pmax) { tmin = Math.min(tmin, v); tmax = Math.max(tmax, v); } }); });
  if (tmin > tmax) { g.fillStyle = '#7e99b3'; g.font = '13px system-ui'; g.fillText('此格點無 CTD 觀測', m.l, 40); return; }
  tmin = Math.floor(tmin - 0.5); tmax = Math.ceil(tmax + 0.5);
  axes(g, w, h, m, tmin, tmax, pmax, 0, '水溫 °C', '壓力 db', 1, 0);
  prs.forEach(function (p, si) {
    if (!p.p.length) return;
    g.strokeStyle = seasons[si][2]; g.lineWidth = si === 0 ? 2.2 : 1.4;
    g.beginPath();
    var first = true;
    for (var k = 0; k < p.p.length; k++) {
      if (p.p[k] > pmax) break;
      var x = px(p.t[k], tmin, tmax, m.l, w - m.r), y = px(p.p[k], 0, pmax, m.t, h - m.b);
      if (first) { g.moveTo(x, y); first = false; } else g.lineTo(x, y);
    }
    g.stroke();
  });
  g.font = '11px system-ui'; g.textAlign = 'left';
  seasons.forEach(function (s, si) {
    g.fillStyle = s[2];
    g.fillText(s[1], m.l + 6, m.t + 12 + si * 13);
  });
  $('#hyPtInfo').innerHTML = '格點 <b>' + lo.toFixed(2) + '°E, ' + la.toFixed(2) + '°N</b>　（0–300 db）';
  ptTable(i, j);
}
function axes(g, w, h, m, x0, x1, y0, y1, xl, yl, xd, yd) {
  xd = xd === undefined ? 1 : xd; yd = yd === undefined ? 0 : yd;
  g.strokeStyle = 'rgba(140,175,205,.25)'; g.lineWidth = 1;
  g.fillStyle = '#7e99b3'; g.font = '11px system-ui';
  var k;
  for (k = 0; k <= 4; k++) {
    var xv = x0 + (x1 - x0) * k / 4, x = px(xv, x0, x1, m.l, w - m.r);
    g.beginPath(); g.moveTo(x, m.t); g.lineTo(x, h - m.b); g.stroke();
    g.textAlign = 'center'; g.fillText(xv.toFixed(xd), x, h - m.b + 14);
  }
  for (k = 0; k <= 5; k++) {
    var yv = y1 + (y0 - y1) * k / 5, y = px(yv, y1, y0, m.t, h - m.b);
    g.beginPath(); g.moveTo(m.l, y); g.lineTo(w - m.r, y); g.stroke();
    g.textAlign = 'right'; g.fillText(yv.toFixed(yd), m.l - 5, y + 4);
  }
  g.textAlign = 'left'; g.fillText(yl, 2, 10);
  g.textAlign = 'center'; g.fillText(xl, (m.l + w - m.r) / 2, h - 3);
  g.textAlign = 'left';
}
function ptTable(i, j) {
  var rows = ['<tr><th>期別</th><th>SST</th><th>MLD</th><th>躍層</th><th>梯度</th><th>D20</th><th>Δσt</th></tr>' +
              '<tr class="unit"><td></td><td>°C</td><td>m</td><td>m</td><td>°C/100m</td><td>m</td><td>kg/m³</td></tr>'];
  [0, 13, 14, 15, 16].forEach(function (c, k) {
    var m = H.metrics(H.profile(H.tpIdx(c), j, i));
    rows.push('<tr><td>' + H.TPLAB[H.tpIdx(c)] + '</td><td>' + fmt(m.sst) + '</td><td>' + fmt(m.mld, 0) +
              '</td><td>' + fmt(m.thd, 0) + '</td><td>' + fmt(m.thg) + '</td><td>' + fmt(m.d20, 0) +
              '</td><td>' + fmt(m.dsig) + '</td></tr>');
  });
  $('#hyPtTbl').innerHTML = rows.join('');
}

/* ---------- 斷面 ---------- */
function drawSection() {
  var cv = $('#hySect'); if (!cv || !H.data) return;
  var w = cssW(cv.parentNode), h = 340, g = prep(cv, w, h);
  var la = +$('#hySectLat').value, it = H.tpIdx(+$('#hySectTp').value);
  var key = H.UI.sectVar;
  var j = Math.round((la - H.LAT0) / H.DD);
  var isCur = (key === 'v' || key === 'u');
  var levs = isCur ? H.ALEV : H.CLEV.filter(function (z) { return z <= 500; });
  var zmax = 500;
  var m = { l: 46, r: 14, t: 14, b: 30 };
  var vals = [], any = false;
  for (var k = 0; k < levs.length; k++) {
    var row = [];
    for (var i = 0; i < H.NLON; i++) {
      var v;
      if (key === 'v') v = H.aval('V', it, k, j, i);
      else if (key === 'u') v = H.aval('U', it, k, j, i);
      else v = H.cval(key, it, k, j, i);
      row.push(v); if (v === v) any = true;
    }
    vals.push(row);
  }
  if (!any) {
    g.fillStyle = '#7e99b3'; g.font = '13px system-ui';
    g.fillText('此緯度在所選期別無觀測。', m.l, 40);
    $('#hySectNote').textContent = '';
    return;
  }
  /* 裁切到有觀測的經度範圍（左右各留 1 格） */
  var i0 = H.NLON, i1 = -1;
  for (k = 0; k < vals.length; k++) for (var q = 0; q < H.NLON; q++)
    if (vals[k][q] === vals[k][q]) { if (q < i0) i0 = q; if (q > i1) i1 = q; }
  i0 = Math.max(0, i0 - 1); i1 = Math.min(H.NLON - 1, i1 + 1);
  var nx = i1 - i0 + 1;
  var flat = [];
  vals.forEach(function (r) { r.forEach(function (v) { if (v === v) flat.push(v); }); });
  var rr = pctRange(Float64Array.from(flat), 0.02, 0.98);
  var pal = isCur ? PAL.div : (key === 'T' ? PAL.sst : PAL.sal);
  if (isCur) { var a = Math.max(Math.abs(rr[0]), Math.abs(rr[1])); rr = [-a, a]; }
  var W = w - m.l - m.r, Hh = h - m.t - m.b;
  var cw = W / nx;
  var lon0 = H.LON0 + i0 * H.DD, lon1 = H.LON0 + (i1 + 1) * H.DD;
  g.fillStyle = '#0d151d'; g.fillRect(m.l, m.t, W, Hh);
  for (k = 0; k < levs.length; k++) {
    var z0 = k === 0 ? 0 : 0.5 * (levs[k - 1] + levs[k]);
    var z1 = k === levs.length - 1 ? levs[k] : 0.5 * (levs[k] + levs[k + 1]);
    if (z0 >= zmax) break;
    z1 = Math.min(z1, zmax);
    var y0 = px(z0, 0, zmax, m.t, m.t + Hh), y1 = px(z1, 0, zmax, m.t, m.t + Hh);
    for (i = i0; i <= i1; i++) {
      var v2 = vals[k][i]; if (v2 !== v2) continue;
      g.fillStyle = rgb(pal((v2 - rr[0]) / (rr[1] - rr[0])));
      g.fillRect(m.l + (i - i0) * cw, y0, cw + 0.6, y1 - y0 + 0.6);
    }
  }
  /* 零流速線 */
  if (isCur) {
    g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 1;
    for (k = 0; k < levs.length; k++) {
      if (levs[k] > zmax) break;
      var yy = px(levs[k], 0, zmax, m.t, m.t + Hh);
      for (i = i0 + 1; i <= i1; i++) {
        var a1 = vals[k][i - 1], b1 = vals[k][i];
        if (a1 === a1 && b1 === b1 && (a1 > 0) !== (b1 > 0)) {
          var xx = m.l + (i - i0 - a1 / (b1 - a1)) * cw;
          g.beginPath(); g.moveTo(xx, yy - 2); g.lineTo(xx, yy + 2); g.stroke();
        }
      }
    }
  }
  g.strokeStyle = 'rgba(140,175,205,.3)'; g.fillStyle = '#7e99b3'; g.font = '11px system-ui';
  var lstep = (lon1 - lon0) > 6 ? 2 : ((lon1 - lon0) > 2.5 ? 1 : 0.5);
  for (var lo = Math.ceil(lon0 / lstep) * lstep; lo <= lon1; lo += lstep) {
    var x = m.l + (lo - lon0) / (lon1 - lon0) * W;
    g.beginPath(); g.moveTo(x, m.t); g.lineTo(x, m.t + Hh); g.stroke();
    g.textAlign = 'center'; g.fillText(lo.toFixed(lstep < 1 ? 1 : 0) + '°E', x, h - 10);
  }
  for (var z = 0; z <= zmax; z += 100) {
    var y = px(z, 0, zmax, m.t, m.t + Hh);
    g.beginPath(); g.moveTo(m.l, y); g.lineTo(m.l + W, y); g.stroke();
    g.textAlign = 'right'; g.fillText(z + '', m.l - 5, y + 4);
  }
  g.textAlign = 'left'; g.fillText(isCur ? '深度 m' : '壓力 db', 2, 10);
  var lab = { v: '北向流速 v (m/s)', u: '東向流速 u (m/s)', T: '水溫 (°C)', S: '鹽度 (psu)' }[key];
  $('#hySectNote').innerHTML = la.toFixed(2) + '°N　' + lab + '　色階 ' + fmt(rr[0], 2) + ' – ' + fmt(rr[1], 2) +
    (isCur ? '（藍 = 南向，紅 = 北向，白色短線為零流速）' : '') +
    '　期別 ' + H.TPLAB[it] + '。空白處代表該網格無觀測，非零值。';
}

/* ---------- 整合診斷 ---------- */
var DIAGV = [
  ['dsig', '上層 100 m 密度差 Δσt', 'kg/m³'],
  ['mld',  '混合層深度 MLD', 'm'],
  ['thg',  '溫躍層最大梯度', '°C/100m'],
  ['thd',  '溫躍層深度', 'm'],
  ['d20',  '20 °C 等溫面深度', 'm'],
  ['sst',  '氣候表層水溫', '°C'],
  ['tm200','0–200 m 垂直平均溫', '°C'],
  ['spd',  '上層 100 m 平均流速', 'm/s'],
  ['v',    '上層 100 m 北向分量', 'm/s'],
  ['stab', '流向穩定度', '']
];
function diagRows() {
  if (!st.satRows || !H.data) return null;
  return st.satRows.map(function (r) {
    if (r.id === 'all') return null;
    var reg = REG.filter(function (x) { return x.id === r.id; })[0];
    if (!reg) return null;
    var s = H.regionStats(reg.box, 0);
    s.id = r.id; s.zh = reg.zh; s.trend = r.slope; s.p = r.p;
    return s;
  }).filter(Boolean);
}
function drawDiag() {
  var rows = diagRows();
  if (!rows || rows.length < 4) {
    $('#hyDiagNote').textContent = '需先於「資料建置」完成衛星海溫分析，本卡才會填入升溫速率。';
    return;
  }
  $('#hyDiagNote').innerHTML =
    '以 ' + rows.length + ' 個海域為樣本，檢驗「衛星觀測到的升溫速率」是否與「現場觀測到的上層海洋層結與流場」有系統性關係。' +
    '層結指標 Δσt 為 0 與 100 m 之 σt 差，愈大代表上層愈難與下層交換熱量。';
  var t = rows.map(function (r) { return r.trend; });
  /* 相關表 */
  var tb = ['<tr><th>現場指標</th><th>n</th><th>Spearman ρ</th><th>p</th></tr>'];
  DIAGV.forEach(function (d) {
    var x = [], y = [];
    rows.forEach(function (r, k) { if (r[d[0]] === r[d[0]]) { x.push(r[d[0]]); y.push(t[k]); } });
    if (x.length < 5) return;
    var s = H.spearman(x, y);
    var mk = s.p < 0.01 ? ' ***' : (s.p < 0.05 ? ' **' : (s.p < 0.1 ? ' *' : ''));
    tb.push('<tr><td>' + d[1] + (d[2] ? '（' + d[2] + '）' : '') + '</td><td>' + s.n + '</td><td>' +
            (s.rho >= 0 ? '+' : '') + fmt(s.rho, 3) + mk + '</td><td>' + fmt(s.p, 4) + '</td></tr>');
  });
  $('#hyCorr').innerHTML = tb.join('');
  /* 散布圖：Δσt vs 升溫速率 */
  var cv = $('#hyScat'), w = cssW(cv.parentNode), h = 330, g = prep(cv, w, h);
  var pts = rows.filter(function (r) { return r.dsig === r.dsig; });
  if (pts.length < 4) return;
  var xs = pts.map(function (r) { return r.dsig; }), ys = pts.map(function (r) { return r.trend; });
  var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs);
  var y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
  var pad = (x1 - x0) * 0.12 || 0.2; x0 -= pad; x1 += pad;
  pad = (y1 - y0) * 0.16 || 0.02; y0 -= pad; y1 += pad;
  var m = { l: 52, r: 14, t: 14, b: 34 };
  axes(g, w, h, m, x0, x1, y0, y1, '上層 100 m Δσt（kg/m³）', '升溫速率 °C/10yr', 2, 3);
  /* 最小平方線 */
  var n = pts.length, sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (var k = 0; k < n; k++) { sx += xs[k]; sy += ys[k]; sxx += xs[k] * xs[k]; sxy += xs[k] * ys[k]; }
  var sl = (n * sxy - sx * sy) / (n * sxx - sx * sx), ic = (sy - sl * sx) / n;
  g.strokeStyle = 'rgba(230,170,90,.8)'; g.lineWidth = 1.6; g.setLineDash([6, 4]);
  g.beginPath();
  g.moveTo(px(x0, x0, x1, m.l, w - m.r), px(sl * x0 + ic, y0, y1, h - m.b, m.t));
  g.lineTo(px(x1, x0, x1, m.l, w - m.r), px(sl * x1 + ic, y0, y1, h - m.b, m.t));
  g.stroke(); g.setLineDash([]);
  g.font = '11px system-ui';
  var placed = [];
  pts.slice().sort(function (a, b) { return a.trend - b.trend; }).forEach(function (r) {
    var x = px(r.dsig, x0, x1, m.l, w - m.r), y = px(r.trend, y0, y1, h - m.b, m.t);
    g.fillStyle = '#e06c4f'; g.beginPath(); g.arc(x, y, 5, 0, 6.2832); g.fill();
    /* 標籤避讓：與已放置者垂直距離不足 12 px 時往下推 */
    var ly = y + 4, tries = 0;
    while (tries++ < 12 && placed.some(function (q) {
      return Math.abs(q[1] - ly) < 12 && Math.abs(q[0] - x) < 92;
    })) ly += 12;
    placed.push([x, ly]);
    if (ly !== y + 4) {
      g.strokeStyle = 'rgba(198,213,227,.35)'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(x + 6, y); g.lineTo(x + 8, ly - 4); g.stroke();
    }
    g.fillStyle = '#c6d5e3'; g.textAlign = 'left'; g.fillText(r.zh, x + 9, ly);
  });
  var s2 = H.spearman(xs, ys);
  g.fillStyle = '#8fb2cf'; g.textAlign = 'right';
  g.fillText('Spearman ρ = ' + (s2.rho >= 0 ? '+' : '') + fmt(s2.rho, 3) + '，p = ' + fmt(s2.p, 4) + '（n = ' + s2.n + '）',
             w - m.r, m.t + 12);
  g.textAlign = 'left';
  /* 區域總表 */
  var rt = ['<tr><th>海域</th><th>升溫 °C/10yr</th><th>CTD 格</th><th>SST °C</th><th>MLD m</th><th>溫躍層 m</th>' +
            '<th>Δσt</th><th>D20 m</th><th>流速 m/s</th><th>北向 v</th><th>穩定度</th></tr>'];
  rows.slice().sort(function (a, b) { return b.trend - a.trend; }).forEach(function (r) {
    rt.push('<tr><td>' + r.zh + '</td><td><b>' + fmt(r.trend, 3) + '</b></td><td>' + (r.ncell || 0) + '</td><td>' +
            fmt(r.sst) + '</td><td>' + fmt(r.mld, 0) + '</td><td>' + fmt(r.thd, 0) + '</td><td>' + fmt(r.dsig) +
            '</td><td>' + fmt(r.d20, 0) + '</td><td>' + fmt(r.spd, 3) + '</td><td>' +
            (r.v >= 0 ? '+' : '') + fmt(r.v, 3) + '</td><td>' + fmt(r.stab) + '</td></tr>');
  });
  $('#hyRegTbl').innerHTML = rt.join('');
}

/* ---------- 總繪 ---------- */
function drawAll() { drawMap(); drawProfile(); drawSection(); drawDiag(); }

/* ---------- 初始化 ---------- */
function mount(el) {
  if (el._done) { drawAll(); return; }
  el.innerHTML = HTML; el._done = true;
  $('#hyFile').onchange = function () { onFiles(this.files); this.value = ''; };
  $('#hyClear').onclick = function () {
    H.kClr().then(function () { log('已清除本機水文快取。'); });
  };
  ['#hyTp', '#hyLev', '#hyBase'].forEach(function (s) { $(s).onchange = drawMap; });
  $('#hyVec').onchange = drawMap;
  $('#hySectLat').onchange = drawSection;
  $('#hySectTp').onchange = drawSection;
  $('#hySectVar').onclick = function (e) {
    var b = e.target.closest('button'); if (!b) return;
    $$('button', this).forEach(function (x) { x.classList.toggle('on', x === b); });
    H.UI.sectVar = b.dataset.m; drawSection();
  };
  $('#hyMap').onclick = function (e) {
    if (!H.data) return;
    var r = this.getBoundingClientRect();
    var fx = (e.clientX - r.left) / r.width, fy = (e.clientY - r.top) / r.height;
    var i = Math.min(H.NLON - 1, Math.max(0, Math.floor(fx * H.NLON)));
    var j = Math.min(H.NLAT - 1, Math.max(0, Math.floor((1 - fy) * H.NLAT)));
    H.UI.pt = j * H.NLON + i; drawProfile();
  };
  $('#hyMap').onmousemove = function (e) {
    var a = this._arr; if (!a) return;
    var r = this.getBoundingClientRect();
    var fx = (e.clientX - r.left) / r.width, fy = (e.clientY - r.top) / r.height;
    var i = Math.min(H.NLON - 1, Math.max(0, Math.floor(fx * H.NLON)));
    var j = Math.min(H.NLAT - 1, Math.max(0, Math.floor((1 - fy) * H.NLAT)));
    var v = a[j * H.NLON + i], tip = $('#hyTip');
    var lo = (H.LON0 + i * H.DD).toFixed(2), la = (H.LAT0 + j * H.DD).toFixed(2);
    tip.style.display = 'block';
    tip.style.left = (e.clientX - r.left + 12) + 'px';
    tip.style.top = (e.clientY - r.top + 12) + 'px';
    tip.textContent = lo + '°E ' + la + '°N　' +
      (v === v ? fmt(v, 2) + ' ' + FIELD[this._key].unit : '無觀測');
  };
  $('#hyMap').onmouseleave = function () { $('#hyTip').style.display = 'none'; };
  tryCache();
  root.addEventListener('resize', debounce(function () {
    if (st.ready && el.offsetParent) drawAll();
  }, 220));
}
function debounce(f, ms) { var t; return function () { clearTimeout(t); t = setTimeout(f, ms); }; }

root.HYDROUI = {
  mount: mount,
  redraw: drawAll,
  setSatellite: function (rows) { st.satRows = rows; if (st.ready) drawDiag(); }
};
})(typeof window !== 'undefined' ? window : globalThis);
