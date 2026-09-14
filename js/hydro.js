/* hydro.js — 現場水文與流場（ODB 15' 網格氣候圖集）之解析、診斷與繪圖
   資料來源：Ocean Data Bank, National Science and Technology Council
             https://www.odb.ntu.edu.tw/ctd/ctd15moa/  （ctd_15moa，1985– ）
             https://www.odb.ntu.edu.tw/adcp/adcp15moa/（sadcp_15moa，1991– ）
   本檔不隨附任何資料：CSV 由使用者自本機載入，解析後僅存於瀏覽器 IndexedDB，不上傳。 */
(function (root) {
'use strict';

/* ================= 網格與常數 ================= */
var LON0 = 116.0, LAT0 = 18.0, DD = 0.25, NLON = 49, NLAT = 57;
var NODATA = -32768;
var TPS = [0, 13, 14, 15, 16, 17, 18];
var TPLAB = ['全年', '冬 12–2', '春 3–5', '夏 6–8', '秋 9–11', '東北季風 10–4', '西南季風 5–9'];
var CLEV = [0,5,10,15,20,25,30,35,40,45,50,55,60,65,70,75,80,85,90,95,
            100,125,150,175,200,225,250,275,300,325,350,375,400,425,450,475,500];
var ALEV = []; for (var _i = 10; _i <= 500; _i += 10) ALEV.push(_i);
var CVARS = { 'temp_avg(deg.c)': ['T', 100], 'sal_avg(psu)': ['S', 1000],
              'sigma-t_avg(kg/m3)': ['SG', 1000], 'temp_std(deg.c)': ['TSD', 100] };
var AVARS = { 'u_avg(m/s)': ['U', 1000], 'v_avg(m/s)': ['V', 1000],
              'speed(m/s)': ['SP', 1000], 'u_std(m/s)': ['USD', 1000],
              'v_std(m/s)': ['VSD', 1000] };

var REG = (root.ANA && root.ANA.REGIONS) || [];
var D = null;            // 解析後資料
var SAT = null;          // 由 app.js 注入之衛星區域趨勢
var UI = { tp: 0, lev: 10, base: 'T', vec: true, pt: -1, sectLat: 23.5, sectVar: 'v' };

/* ================= IndexedDB ================= */
var DBN = 'ghrsst-tw-hydro', ST = 'blob', _db = null;
function db() {
  if (_db) return Promise.resolve(_db);
  return new Promise(function (res, rej) {
    var q = indexedDB.open(DBN, 1);
    q.onupgradeneeded = function () {
      var d = q.result; if (!d.objectStoreNames.contains(ST)) d.createObjectStore(ST);
    };
    q.onsuccess = function () { _db = q.result; res(_db); };
    q.onerror = function () { rej(q.error); };
  });
}
function idb(mode, fn) {
  return db().then(function (d) {
    return new Promise(function (res, rej) {
      var r = fn(d.transaction(ST, mode).objectStore(ST));
      r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); };
    });
  });
}
var kGet = function (k) { return idb('readonly', function (s) { return s.get(k); }); };
var kPut = function (k, v) { return idb('readwrite', function (s) { return s.put(v, k); }); };
var kClr = function () { return idb('readwrite', function (s) { return s.clear(); }); };

/* ================= 解析 ================= */
function blank(nlev) {
  var a = new Int16Array(TPS.length * nlev * NLAT * NLON);
  a.fill(NODATA); return a;
}
function idxOf(v, v0) { var i = Math.round((v - v0) / DD); return i; }

function parseCSV(text, onProg) {
  // 自表頭判斷是 CTD 還是 SADCP
  var nl = text.indexOf('\n');
  var head = text.slice(0, nl).replace(/^﻿/, '').replace(/\r$/, '').split(',');
  var isCtd = head.indexOf('pressure(db)') >= 0;
  var levs = isCtd ? CLEV : ALEV;
  var spec = isCtd ? CVARS : AVARS;
  var levKey = isCtd ? 'pressure(db)' : 'depth(m)';
  var iLon = 0, iLat = 1, iLev = head.indexOf(levKey), iTp = head.indexOf('time_period');
  if (iLev < 0 || iTp < 0) throw new Error('表頭缺少 ' + levKey + ' 或 time_period 欄位');
  var cols = [];   // [csvIndex, targetName, scale]
  for (var k in spec) { var j = head.indexOf(k); if (j >= 0) cols.push([j, spec[k][0], spec[k][1]]); }
  if (!cols.length) throw new Error('表頭找不到任何可用的數值欄位');

  var lvi = {}; for (var q = 0; q < levs.length; q++) lvi[levs[q]] = q;
  var tpi = {}; for (q = 0; q < TPS.length; q++) tpi[TPS[q]] = q;
  var out = {}; for (q = 0; q < cols.length; q++) out[cols[q][1]] = blank(levs.length);
  var stride = NLAT * NLON, plane = levs.length * stride;

  var pos = nl + 1, n = text.length, row = 0, kept = 0, tick = 0;
  while (pos < n) {
    var e = text.indexOf('\n', pos); if (e < 0) e = n;
    var line = text.slice(pos, e); pos = e + 1;
    if (!line || line.length < 8) continue;
    row++;
    if ((++tick & 32767) === 0 && onProg) onProg(pos / n);
    var f = line.split(',');
    var ix = idxOf(+f[iLon], LON0); if (ix < 0 || ix >= NLON) continue;
    var iy = idxOf(+f[iLat], LAT0); if (iy < 0 || iy >= NLAT) continue;
    var kz = lvi[+f[iLev]]; if (kz === undefined) continue;
    var it = tpi[+f[iTp]]; if (it === undefined) continue;
    var o = it * plane + kz * stride + iy * NLON + ix;
    kept++;
    for (q = 0; q < cols.length; q++) {
      var s = f[cols[q][0]];
      if (!s || s === 'NULL' || s === 'NaN' || s === 'NA') continue;
      var v = +s; if (v !== v) continue;
      var z = Math.round(v * cols[q][2]);
      if (z >= -32767 && z <= 32767) out[cols[q][1]][o] = z;
    }
  }
  return { kind: isCtd ? 'ctd' : 'adcp', arr: out, rows: row, kept: kept };
}

/* 讀取 tools/pack_hydro.py 產出之 hydro.bin */
function parseBin(buf) {
  var u8 = new Uint8Array(buf), dv = new DataView(buf);
  if (String.fromCharCode(u8[0], u8[1], u8[2], u8[3]) !== 'TWHY') throw new Error('不是 hydro.bin');
  var hlen = dv.getUint32(8, true), off = 12;
  var h = JSON.parse(new TextDecoder('utf-8').decode(u8.subarray(off, off + hlen)));
  off += hlen;
  var out = {};
  function take(spec, nlev) {
    spec.forEach(function (x) {
      var nm = (nlev === CLEV.length ? CVARS : AVARS)[x[0]][0];
      var cnt = TPS.length * nlev * NLAT * NLON, a = new Int16Array(cnt);
      new Uint8Array(a.buffer).set(u8.subarray(off, off + cnt * 2));
      off += cnt * 2; out[nm] = a;
    });
  }
  take(h.cvars, CLEV.length);
  take(h.avars, ALEV.length);
  return out;
}

/* ================= 取值 ================= */
function at(a, nlev, it, kz, j, i, sc) {
  var v = a[((it * nlev + kz) * NLAT + j) * NLON + i];
  return v === NODATA ? NaN : v / sc;
}
function cval(name, it, kz, j, i) {
  if (!D || !D[name]) return NaN;
  var sc = name === 'T' || name === 'TSD' ? 100 : 1000;
  return at(D[name], CLEV.length, it, kz, j, i, sc);
}
function aval(name, it, kz, j, i) {
  if (!D || !D[name]) return NaN;
  return at(D[name], ALEV.length, it, kz, j, i, 1000);
}
function tpIdx(c) { return TPS.indexOf(c); }
function nearLev(levs, z) {
  var b = 0, d0 = 1e9;
  for (var i = 0; i < levs.length; i++) { var d = Math.abs(levs[i] - z); if (d < d0) { d0 = d; b = i; } }
  return b;
}

/* ================= 剖面診斷 ================= */
function profile(it, j, i) {
  var p = [], t = [], s = [], g = [];
  for (var k = 0; k < CLEV.length; k++) {
    var v = cval('T', it, k, j, i);
    if (v !== v) continue;
    p.push(CLEV[k]); t.push(v);
    s.push(cval('S', it, k, j, i)); g.push(cval('SG', it, k, j, i));
  }
  return { p: p, t: t, s: s, sg: g };
}
function metrics(pr) {
  var p = pr.p, t = pr.t, sg = pr.sg, o = {};
  if (p.length < 4 || p[0] > 15 || p[p.length - 1] < 60) return o;
  o.sst = t[0]; o.pmax = p[p.length - 1]; o.nlev = p.length;
  /* 混合層：ΔT = 0.5 °C */
  for (var k = 1; k < p.length; k++) {
    var d0 = t[0] - t[k - 1], d1 = t[0] - t[k];
    if (d1 >= 0.5) { o.mld = p[k - 1] + (d1 !== d0 ? (0.5 - d0) / (d1 - d0) : 0) * (p[k] - p[k - 1]); break; }
  }
  /* 溫躍層：最大垂直梯度 */
  var gm = -1e9, gj = -1;
  for (k = 1; k < p.length; k++) {
    /* 原始溫度僅兩位小數，梯度取至 1e-6 以免因浮點雜訊在等值處任意跳動；
       並列時取較淺者（迴圈由上而下、嚴格大於） */
    var gg = Math.round((t[k - 1] - t[k]) / (p[k] - p[k - 1]) * 1e6) / 1e6;
    if (gg > gm) { gm = gg; gj = k; }
  }
  if (gj > 0) { o.thd = 0.5 * (p[gj - 1] + p[gj]); o.thg = gm * 100; }
  /* 20 °C 等溫面 */
  if (t[0] >= 20 && t[t.length - 1] <= 20) {
    for (k = 1; k < p.length; k++) {
      if (t[k] <= 20 && t[k - 1] > 20) {
        o.d20 = p[k - 1] + (t[k - 1] - 20) / (t[k - 1] - t[k]) * (p[k] - p[k - 1]); break;
      }
    }
  }
  /* 0–200 m 垂直平均溫 */
  var sum = 0, dep = 0;
  for (k = 1; k < p.length && p[k] <= 200; k++) { sum += 0.5 * (t[k] + t[k - 1]) * (p[k] - p[k - 1]); dep = p[k]; }
  if (dep >= 160) o.tm200 = sum / (dep - p[0]);
  /* 上層 100 m 密度差 Δσt */
  var ok = [], oq = [];
  for (k = 0; k < p.length; k++) if (sg[k] === sg[k]) { oq.push(p[k]); ok.push(sg[k]); }
  if (ok.length >= 4 && oq[0] <= 15 && oq[oq.length - 1] >= 100) {
    o.dsig = interp(oq, ok, 100) - interp(oq, ok, 0);
  }
  return o;
}
function interp(x, y, xi) {
  if (xi <= x[0]) return y[0];
  for (var k = 1; k < x.length; k++) if (x[k] >= xi)
    return y[k - 1] + (y[k] - y[k - 1]) * (xi - x[k - 1]) / (x[k] - x[k - 1]);
  return y[y.length - 1];
}

/* 區域面積加權統計 */
function regionStats(box, it) {
  var acc = {}, hit = {};
  var i0 = Math.max(0, Math.ceil((box[0] - LON0) / DD)), i1 = Math.min(NLON - 1, Math.floor((box[1] - LON0) / DD));
  var j0 = Math.max(0, Math.ceil((box[2] - LAT0) / DD)), j1 = Math.min(NLAT - 1, Math.floor((box[3] - LAT0) / DD));
  for (var j = j0; j <= j1; j++) {
    var w = Math.cos((LAT0 + j * DD) * Math.PI / 180);
    for (var i = i0; i <= i1; i++) {
      var m = metrics(profile(it, j, i));
      for (var k in m) {
        if (m[k] !== m[k]) continue;
        if (!acc[k]) { acc[k] = 0; hit[k] = 0; }
        acc[k] += m[k] * w; hit[k] += w;
      }
      if (typeof m.sst === 'number' && m.sst === m.sst) { acc.__n = (acc.__n || 0) + 1; }
    }
  }
  var o = {};
  for (k in acc) if (k !== '__n') o[k] = acc[k] / hit[k];
  o.ncell = acc.__n || 0;
  /* 上層 100 m 流場 */
  var su = 0, sv = 0, ss = 0, nn = 0;
  for (j = j0; j <= j1; j++) for (i = i0; i <= i1; i++)
    for (var kz = 0; kz < ALEV.length && ALEV[kz] <= 100; kz++) {
      var u = aval('U', it, kz, j, i), v = aval('V', it, kz, j, i), sp = aval('SP', it, kz, j, i);
      if (u !== u || v !== v) continue;
      su += u; sv += v; ss += (sp === sp ? sp : Math.sqrt(u * u + v * v)); nn++;
    }
  if (nn) {
    o.u = su / nn; o.v = sv / nn; o.spd = ss / nn;
    o.vec = Math.sqrt(o.u * o.u + o.v * o.v);
    o.stab = o.spd > 0 ? o.vec / o.spd : NaN;
    o.nflow = nn;
  }
  return o;
}

/* Spearman 等級相關 */
function rank(a) {
  var idx = a.map(function (v, i) { return [v, i]; }).sort(function (x, y) { return x[0] - y[0]; });
  var r = new Array(a.length), i = 0;
  while (i < idx.length) {
    var j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    var m = (i + j) / 2 + 1;
    for (var k = i; k <= j; k++) r[idx[k][1]] = m;
    i = j + 1;
  }
  return r;
}
function spearman(x, y) {
  var n = x.length; if (n < 4) return { rho: NaN, p: NaN, n: n };
  var a = rank(x), b = rank(y);
  var ma = 0, mb = 0, i;
  for (i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
  ma /= n; mb /= n;
  var sa = 0, sb = 0, sab = 0;
  for (i = 0; i < n; i++) { var da = a[i] - ma, dbv = b[i] - mb; sa += da * da; sb += dbv * dbv; sab += da * dbv; }
  var rho = sab / Math.sqrt(sa * sb);
  var df = n - 2, t = rho * Math.sqrt(df / Math.max(1e-12, 1 - rho * rho));
  return { rho: rho, p: 2 * tSf(Math.abs(t), df), n: n };
}
function tSf(t, df) {           /* Student-t 上尾機率（連分數不完全 beta） */
  var x = df / (df + t * t);
  return 0.5 * betainc(x, df / 2, 0.5);
}
function betainc(x, a, b) {
  if (x <= 0) return 0; if (x >= 1) return 1;
  var lbeta = gln(a) + gln(b) - gln(a + b);
  var f = Math.exp(a * Math.log(x) + b * Math.log(1 - x) - lbeta);
  var cf = (x < (a + 1) / (a + b + 2)) ? bcf(x, a, b) : 0;
  return (x < (a + 1) / (a + b + 2)) ? f * cf / a : 1 - Math.exp(b * Math.log(1 - x) + a * Math.log(x) - lbeta) * bcf(1 - x, b, a) / b;
}
function bcf(x, a, b) {
  var qab = a + b, qap = a + 1, qam = a - 1, c = 1, d = 1 - qab * x / qap;
  if (Math.abs(d) < 1e-30) d = 1e-30; d = 1 / d;
  var h = d;
  for (var m = 1; m <= 200; m++) {
    var m2 = 2 * m, aa = m * (b - m) * x / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < 1e-30) d = 1e-30;
    c = 1 + aa / c; if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d; h *= d * c;
    aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < 1e-30) d = 1e-30;
    c = 1 + aa / c; if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d; var del = d * c; h *= del;
    if (Math.abs(del - 1) < 3e-9) break;
  }
  return h;
}
function gln(z) {
  var g = [76.18009172947146, -86.50532032941677, 24.01409824083091,
           -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  var x = z, y = z, tmp = x + 5.5; tmp -= (x + 0.5) * Math.log(tmp);
  var s = 1.000000000190015;
  for (var j = 0; j < 6; j++) s += g[j] / ++y;
  return -tmp + Math.log(2.5066282746310005 * s / x);
}

root.HYDRO = {
  LON0: LON0, LAT0: LAT0, DD: DD, NLON: NLON, NLAT: NLAT,
  TPS: TPS, TPLAB: TPLAB, CLEV: CLEV, ALEV: ALEV, NODATA: NODATA,
  UI: UI,
  get data() { return D; },
  set data(v) { D = v; },
  get sat() { return SAT; },
  set sat(v) { SAT = v; },
  parseCSV: parseCSV, parseBin: parseBin,
  cval: cval, aval: aval, tpIdx: tpIdx, nearLev: nearLev,
  profile: profile, metrics: metrics, regionStats: regionStats,
  spearman: spearman, interp: interp,
  kGet: kGet, kPut: kPut, kClr: kClr
};
})(typeof window !== 'undefined' ? window : globalThis);
