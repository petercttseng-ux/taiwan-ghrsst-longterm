/* analysis.js — 長期時空統計分析核心
   氣候基期日序氣候值與 90 百分位門檻採 Hobday et al. (2016) 之定義：
     ±5 日視窗（共 11 日）× 基期各年 → 逐日序統計，再以 31 日移動平均沿日序平滑。
   趨勢採 Theil–Sen 斜率與 Mann–Kendall 檢定（對離群值穩健，且不假設常態）。 */
(function (root) {
  'use strict';

  var NODATA = -32768, SCALE = 0.01;

  var REGIONS = [
    { id: 'all',    zh: '臺灣周邊全域',     en: 'Full domain',        box: [116.0, 128.0, 18.0, 32.0] },
    { id: 'nts',    zh: '臺灣海峽北部',     en: 'N. Taiwan Strait',   box: [119.0, 121.0, 24.5, 26.0] },
    { id: 'sts',    zh: '臺灣海峽南部',     en: 'S. Taiwan Strait',   box: [118.5, 120.5, 22.5, 24.5] },
    { id: 'penghu', zh: '澎湖海域',         en: 'Penghu',             box: [119.0, 120.0, 23.0, 24.0] },
    { id: 'ne',     zh: '東北部海域',       en: 'NE off Taiwan',      box: [121.5, 123.5, 25.0, 26.5] },
    { id: 'east',   zh: '東部海域(黑潮)',   en: 'E. Taiwan / Kuroshio', box: [121.5, 123.0, 22.5, 24.5] },
    { id: 'sw',     zh: '西南部海域(高屏)', en: 'SW off Taiwan',      box: [119.5, 120.5, 21.5, 22.5] },
    { id: 'bashi',  zh: '巴士海峽',         en: 'Bashi Channel',      box: [120.5, 122.0, 20.5, 22.0] },
    { id: 'nscs',   zh: '南海北部(東沙)',   en: 'N. South China Sea', box: [116.5, 118.5, 19.5, 21.5] },
    { id: 'secs',   zh: '東海南部',         en: 'S. East China Sea',  box: [122.0, 126.0, 27.5, 30.5] },
    { id: 'nwp',    zh: '西北太平洋',       en: 'NW Pacific',         box: [124.0, 127.0, 22.5, 25.5] }
  ];

  /* ---------- 日期 ---------- */
  function dateOf(dayNo) { return new Date(dayNo * 86400000); }
  function yearOf(dayNo) { return dateOf(dayNo).getUTCFullYear(); }
  function doyOf(dayNo) {
    var d = dateOf(dayNo);
    var y0 = Date.UTC(d.getUTCFullYear(), 0, 1);
    return Math.floor((d.getTime() - y0) / 86400000) + 1; // 1..366
  }
  function isoOf(dayNo) {
    var d = dateOf(dayNo), p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate());
  }

  /* ---------- 快速選擇（第 k 小），用於百分位 ---------- */
  function quickselect(a, k, lo, hi) {
    while (lo < hi) {
      var pivot = a[(lo + hi) >> 1], i = lo, j = hi;
      while (i <= j) {
        while (a[i] < pivot) i++;
        while (a[j] > pivot) j--;
        if (i <= j) { swap(a, i, j); i++; j--; }
      }
      if (k <= j) hi = j;
      else if (k >= i) lo = i;
      else return a[k];
    }
    return a[k];
  }
  function swap(a, i, j) { var t = a[i]; a[i] = a[j]; a[j] = t; }

  /* 線性內插百分位（與 numpy.percentile 預設 'linear' 一致） */
  function pctl(a, n, p) {
    if (n === 0) return NaN;
    if (n === 1) return a[0];
    var pos = p * (n - 1), lo = Math.floor(pos), frac = pos - lo;
    var v0 = quickselect(a, lo, 0, n - 1);
    if (frac === 0) return v0;
    var v1 = Infinity;
    for (var i = lo + 1; i < n; i++) if (a[i] < v1) v1 = a[i];
    return v0 + frac * (v1 - v0);
  }

  /* ---------- 氣候場與門檻 ---------- */
  /* cube: Int16Array(nday*ncell)，day0: 起始日數；base:[y0,y1]；win: 半視窗（預設 5） */
  function climatology(D, base, win, onProg) {
    win = win === undefined ? 5 : win;
    var nday = D.nday, ncell = D.ncell, cube = D.cube, day0 = D.day0;
    var clim = new Float32Array(366 * ncell).fill(NaN);
    var thr = new Float32Array(366 * ncell).fill(NaN);

    // 依日序建立基期內的日期索引（跨年閏年：doy 366 樣本較少，以視窗補足）
    var idxByDoy = new Array(367);
    for (var d = 1; d <= 366; d++) idxByDoy[d] = [];
    var doyArr = new Int16Array(nday), yrArr = new Int16Array(nday);
    for (var t = 0; t < nday; t++) { doyArr[t] = doyOf(day0 + t); yrArr[t] = yearOf(day0 + t); }
    for (t = 0; t < nday; t++) {
      var y = yrArr[t];
      if (y < base[0] || y > base[1]) continue;
      var dd = doyArr[t];
      for (var w = -win; w <= win; w++) {
        var target = dd + w;
        if (target < 1) target += 366;
        if (target > 366) target -= 366;
        idxByDoy[target].push(t);
      }
    }
    var flat = new Array(367), maxN = 0;
    for (d = 1; d <= 366; d++) { flat[d] = Int32Array.from(idxByDoy[d]); if (flat[d].length > maxN) maxN = flat[d].length; }
    var buf = new Float32Array(maxN);

    for (var c = 0; c < ncell; c++) {
      if (onProg && (c & 255) === 0) onProg(c / ncell);
      for (d = 1; d <= 366; d++) {
        var ids = flat[d], m = 0, sum = 0;
        for (var q = 0; q < ids.length; q++) {
          var v = cube[ids[q] * ncell + c];
          if (v !== NODATA) { buf[m++] = v * SCALE; sum += v * SCALE; }
        }
        if (m < 10) continue;
        clim[(d - 1) * ncell + c] = sum / m;
        thr[(d - 1) * ncell + c] = pctl(buf, m, 0.9);
      }
    }
    smoothDoy(clim, ncell, 31);
    smoothDoy(thr, ncell, 31);
    return { clim: clim, thr: thr, doy: doyArr, year: yrArr };
  }

  /* 沿日序做環狀 31 日移動平均（Hobday 平滑步驟） */
  function smoothDoy(a, ncell, w) {
    var h = (w - 1) / 2, tmp = new Float32Array(366);
    for (var c = 0; c < ncell; c++) {
      var ok = false;
      for (var d = 0; d < 366; d++) { tmp[d] = a[d * ncell + c]; if (tmp[d] === tmp[d]) ok = true; }
      if (!ok) continue;
      for (d = 0; d < 366; d++) {
        var s = 0, n = 0;
        for (var k = -h; k <= h; k++) {
          var j = (d + k + 366) % 366, v = tmp[j];
          if (v === v) { s += v; n++; }
        }
        a[d * ncell + c] = n ? s / n : NaN;
      }
    }
  }

  /* ---------- 區域遮罩與逐日區域平均 ---------- */
  function regionMask(box, G) {
    var m = new Uint8Array(G.n), k = 0;
    for (var j = 0; j < G.nlat; j++) {
      var la = G.lat0 + j * G.d;
      for (var i = 0; i < G.nlon; i++, k++) {
        var lo = G.lon0 + i * G.d;
        m[k] = (lo >= box[0] && lo <= box[1] && la >= box[2] && la <= box[3]) ? 1 : 0;
      }
    }
    return m;
  }

  /* 以 cos(lat) 加權的面積平均 */
  function areaWeights(G) {
    var w = new Float32Array(G.n), k = 0;
    for (var j = 0; j < G.nlat; j++) {
      var cw = Math.cos((G.lat0 + j * G.d) * Math.PI / 180);
      for (var i = 0; i < G.nlon; i++, k++) w[k] = cw;
    }
    return w;
  }

  function seriesFor(D, mask, W) {
    var nday = D.nday, ncell = D.ncell, cube = D.cube;
    var out = new Float32Array(nday).fill(NaN);
    var idx = [];
    for (var c = 0; c < ncell; c++) if (mask[c]) idx.push(c);
    var ii = Int32Array.from(idx);
    for (var t = 0; t < nday; t++) {
      var s = 0, ws = 0, off = t * ncell;
      for (var q = 0; q < ii.length; q++) {
        var v = cube[off + ii[q]];
        if (v !== NODATA) { s += v * SCALE * W[ii[q]]; ws += W[ii[q]]; }
      }
      if (ws > 0) out[t] = s / ws;
    }
    return out;
  }

  function climSeriesFor(C, mask, W, ncell) {
    var out = new Float32Array(366).fill(NaN), thr = new Float32Array(366).fill(NaN);
    for (var d = 0; d < 366; d++) {
      var s = 0, ws = 0, s2 = 0, ws2 = 0, off = d * ncell;
      for (var c = 0; c < ncell; c++) {
        if (!mask[c]) continue;
        var a = C.clim[off + c], b = C.thr[off + c];
        if (a === a) { s += a * W[c]; ws += W[c]; }
        if (b === b) { s2 += b * W[c]; ws2 += W[c]; }
      }
      if (ws) out[d] = s / ws;
      if (ws2) thr[d] = s2 / ws2;
    }
    return { clim: out, thr: thr };
  }

  /* ---------- 海洋熱浪偵測（Hobday et al. 2016）---------- */
  /* vals/thr 對齊逐日；回傳事件清單與逐日旗標 */
  function detectMHW(vals, clim, thr, day0, minDur, maxGap) {
    minDur = minDur || 5; maxGap = maxGap === undefined ? 2 : maxGap;
    var n = vals.length, over = new Uint8Array(n);
    for (var t = 0; t < n; t++) {
      var v = vals[t], th = thr[t];
      over[t] = (v === v && th === th && v > th) ? 1 : 0;
    }
    // 初步事件
    var evs = [], s = -1;
    for (t = 0; t < n; t++) {
      if (over[t] && s < 0) s = t;
      if ((!over[t] || t === n - 1) && s >= 0) {
        var e = over[t] ? t : t - 1;
        if (e - s + 1 >= minDur) evs.push([s, e]);
        s = -1;
      }
    }
    // 合併短間隔
    var merged = [];
    for (var i = 0; i < evs.length; i++) {
      if (merged.length && evs[i][0] - merged[merged.length - 1][1] - 1 <= maxGap)
        merged[merged.length - 1][1] = evs[i][1];
      else merged.push([evs[i][0], evs[i][1]]);
    }
    var flag = new Uint8Array(n);
    var out = merged.map(function (ev) {
      var a = ev[0], b = ev[1], sum = 0, mx = 0, nn = 0;
      for (var k = a; k <= b; k++) {
        flag[k] = 1;
        var d = vals[k] - clim[k];
        if (d === d) { sum += d; nn++; if (d > mx) mx = d; }
      }
      var mean = nn ? sum / nn : NaN;
      return {
        s: isoOf(day0 + a), e: isoOf(day0 + b), i0: a, i1: b,
        dur: b - a + 1, imax: +mx.toFixed(2), imean: +mean.toFixed(2),
        icum: +sum.toFixed(1),
        cat: category(vals, clim, thr, a, b)
      };
    });
    return { events: out, flag: flag };
  }

  /* 強度分級 I–IV（Hobday et al. 2018）：以超出門檻的倍數界定 */
  function category(vals, clim, thr, a, b) {
    var mx = 0;
    for (var k = a; k <= b; k++) {
      var c = clim[k], th = thr[k], v = vals[k];
      if (!(c === c && th === th && v === v)) continue;
      var d = th - c;
      if (d <= 0) continue;
      var r = (v - c) / d;
      if (r > mx) mx = r;
    }
    return Math.max(1, Math.min(4, Math.floor(mx)));
  }

  /* ---------- Theil–Sen 斜率 + Mann–Kendall ---------- */
  function theilSen(x, y) {
    var n = x.length, sl = [];
    for (var i = 0; i < n; i++) for (var j = i + 1; j < n; j++) {
      if (x[j] === x[i]) continue;
      if (!(y[i] === y[i] && y[j] === y[j])) continue;
      sl.push((y[j] - y[i]) / (x[j] - x[i]));
    }
    if (!sl.length) return { slope: NaN, p: NaN };
    sl.sort(function (a, b) { return a - b; });
    var m = sl.length;
    var slope = m % 2 ? sl[(m - 1) / 2] : 0.5 * (sl[m / 2 - 1] + sl[m / 2]);
    // Mann–Kendall S 統計量
    var S = 0, valid = [];
    for (i = 0; i < n; i++) if (y[i] === y[i]) valid.push(y[i]);
    var nv = valid.length;
    for (i = 0; i < nv; i++) for (j = i + 1; j < nv; j++) S += Math.sign(valid[j] - valid[i]);
    var varS = nv * (nv - 1) * (2 * nv + 5) / 18;
    var Z = S > 0 ? (S - 1) / Math.sqrt(varS) : (S < 0 ? (S + 1) / Math.sqrt(varS) : 0);
    var p = 2 * (1 - normCdf(Math.abs(Z)));
    return { slope: slope, p: p, z: Z, n: nv };
  }
  function normCdf(z) {
    // Abramowitz & Stegun 26.2.17
    var t = 1 / (1 + 0.2316419 * z);
    var d = 0.3989422804014327 * Math.exp(-z * z / 2);
    var pr = d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
    return 1 - pr;
  }

  /* ---------- 逐格統計 ---------- */
  function cellStats(D, C, opts, onProg) {
    var nday = D.nday, ncell = D.ncell, cube = D.cube, day0 = D.day0;
    var yr0 = opts.yr0, yr1 = opts.yr1, ny = yr1 - yr0 + 1;
    var mean = new Float32Array(ncell).fill(NaN);
    var trend = new Float32Array(ncell).fill(NaN);
    var trendP = new Float32Array(ncell).fill(NaN);
    var mhwDays = new Float32Array(ncell).fill(NaN);
    var mhwDaysEarly = new Float32Array(ncell).fill(NaN);
    var mhwDaysLate = new Float32Array(ncell).fill(NaN);
    var amp = new Float32Array(ncell).fill(NaN);
    var phase = new Float32Array(ncell).fill(NaN);
    var sdInter = new Float32Array(ncell).fill(NaN);
    var annual = new Float32Array(ny * ncell).fill(NaN);

    var doy = C.doy, year = C.year;
    var xs = new Float64Array(ny); for (var k = 0; k < ny; k++) xs[k] = yr0 + k;
    var ys = new Float64Array(ny);
    var half = Math.floor(ny / 2);

    var accS = new Float64Array(ny), accN = new Int32Array(ny);

    for (var c = 0; c < ncell; c++) {
      if (onProg && (c & 127) === 0) onProg(c / ncell);
      accS.fill(0); accN.fill(0);
      var gs = 0, gn = 0;
      var overE = 0, dayE = 0, overL = 0, dayL = 0;
      for (var t = 0; t < nday; t++) {
        var v = cube[t * ncell + c];
        if (v === NODATA) continue;
        var x = v * SCALE, yi = year[t] - yr0;
        gs += x; gn++;
        if (yi >= 0 && yi < ny) { accS[yi] += x; accN[yi]++; }
        var th = C.thr[(doy[t] - 1) * ncell + c];
        if (th === th && yi >= 0 && yi < ny) {
          if (yi < half) { dayE++; if (x > th) overE++; }
          else { dayL++; if (x > th) overL++; }
        }
      }
      if (!gn) continue;
      mean[c] = gs / gn;
      var nOk = 0, sy = 0, sy2 = 0;
      for (k = 0; k < ny; k++) {
        ys[k] = accN[k] > 300 ? accS[k] / accN[k] : NaN;
        annual[k * ncell + c] = ys[k];
        if (ys[k] === ys[k]) { nOk++; sy += ys[k]; sy2 += ys[k] * ys[k]; }
      }
      if (nOk >= 10) {
        var ts = theilSen(xs, ys);
        trend[c] = ts.slope * 10; // °C / 10 yr
        trendP[c] = ts.p;
        sdInter[c] = Math.sqrt(Math.max(0, sy2 / nOk - (sy / nOk) * (sy / nOk)));
      }
      if (dayE > 300) mhwDaysEarly[c] = overE / dayE * 365.25;
      if (dayL > 300) mhwDaysLate[c] = overL / dayL * 365.25;
      if (dayE + dayL > 600) mhwDays[c] = (overE + overL) / (dayE + dayL) * 365.25;

      // 季節振幅與相位（由氣候場取）
      var mn = Infinity, mx = -Infinity, arg = 0;
      for (var d = 0; d < 366; d++) {
        var a = C.clim[d * ncell + c];
        if (a !== a) continue;
        if (a < mn) mn = a;
        if (a > mx) { mx = a; arg = d + 1; }
      }
      if (mx > -Infinity) { amp[c] = mx - mn; phase[c] = arg; }
    }
    return { mean: mean, trend: trend, trendP: trendP, mhwDays: mhwDays,
             mhwDaysEarly: mhwDaysEarly, mhwDaysLate: mhwDaysLate,
             amp: amp, phase: phase, sdInter: sdInter, annual: annual, yr0: yr0, ny: ny };
  }

  /* ---------- 月平均立方 ---------- */
  function monthlyCube(D, onProg) {
    var nday = D.nday, ncell = D.ncell, cube = D.cube, day0 = D.day0;
    var keys = [], map = {};
    for (var t = 0; t < nday; t++) {
      var dt = dateOf(day0 + t);
      var k = dt.getUTCFullYear() * 12 + dt.getUTCMonth();
      if (map[k] === undefined) { map[k] = keys.length; keys.push(k); }
    }
    keys.sort(function (a, b) { return a - b; });
    map = {}; for (var i = 0; i < keys.length; i++) map[keys[i]] = i;
    var nm = keys.length;
    var sum = new Float64Array(nm * ncell), cnt = new Int32Array(nm * ncell);
    for (t = 0; t < nday; t++) {
      if (onProg && (t & 511) === 0) onProg(t / nday);
      var d2 = dateOf(day0 + t);
      var mi = map[d2.getUTCFullYear() * 12 + d2.getUTCMonth()], off = mi * ncell, o2 = t * ncell;
      for (var c = 0; c < ncell; c++) {
        var v = cube[o2 + c];
        if (v !== NODATA) { sum[off + c] += v * SCALE; cnt[off + c]++; }
      }
    }
    var full = new Float32Array(nm * ncell).fill(NaN);
    for (i = 0; i < nm * ncell; i++) if (cnt[i] > 10) full[i] = sum[i] / cnt[i];
    // 覆蓋率不足的月份（例如記錄首尾的不完整月）整月剔除，避免圖面出現空白格
    var keep = [];
    for (var mi2 = 0; mi2 < nm; mi2++) {
      var ok = 0;
      for (var c2 = 0; c2 < ncell; c2++) if (full[mi2 * ncell + c2] === full[mi2 * ncell + c2]) ok++;
      if (ok > ncell * 0.2) keep.push(mi2);
    }
    var out = new Float32Array(keep.length * ncell);
    for (var q2 = 0; q2 < keep.length; q2++)
      out.set(full.subarray(keep[q2] * ncell, (keep[q2] + 1) * ncell), q2 * ncell);
    var labels = keep.map(function (mi3) {
      var k = keys[mi3], y = Math.floor(k / 12), m = k % 12 + 1;
      return y + '-' + (m < 10 ? '0' : '') + m;
    });
    return { vals: out, labels: labels, nm: keep.length };
  }

  /* ---------- Hovmöller：逐日緯向/經向平均 ---------- */
  function hovmoller(D, G) {
    var nday = D.nday, cube = D.cube, ncell = D.ncell;
    var zon = new Float32Array(nday * G.nlat).fill(NaN);
    var mer = new Float32Array(nday * G.nlon).fill(NaN);
    for (var t = 0; t < nday; t++) {
      var off = t * ncell;
      for (var j = 0; j < G.nlat; j++) {
        var s = 0, n = 0;
        for (var i = 0; i < G.nlon; i++) { var v = cube[off + j * G.nlon + i]; if (v !== NODATA) { s += v; n++; } }
        if (n > 5) zon[t * G.nlat + j] = s * SCALE / n;
      }
      for (i = 0; i < G.nlon; i++) {
        var s2 = 0, n2 = 0;
        for (j = 0; j < G.nlat; j++) { var v2 = cube[off + j * G.nlon + i]; if (v2 !== NODATA) { s2 += v2; n2++; } }
        if (n2 > 5) mer[t * G.nlon + i] = s2 * SCALE / n2;
      }
    }
    return { zon: zon, mer: mer };
  }

  /* 逐日 (nday × nb) → 候（5 日）平均 */
  function pentad(daily, nb, nday) {
    var np = Math.ceil(nday / 5);
    var out = new Float32Array(np * nb).fill(NaN);
    for (var p = 0; p < np; p++) {
      for (var b = 0; b < nb; b++) {
        var s = 0, n = 0;
        for (var k = 0; k < 5; k++) {
          var t = p * 5 + k;
          if (t >= nday) break;
          var v = daily[t * nb + b];
          if (v === v) { s += v; n++; }
        }
        if (n) out[p * nb + b] = s / n;
      }
    }
    return { vals: out, np: np };
  }

  root.ANA = {
    REGIONS: REGIONS, NODATA: NODATA, SCALE: SCALE,
    doyOf: doyOf, yearOf: yearOf, isoOf: isoOf, dateOf: dateOf,
    pctl: pctl, quickselect: quickselect,
    climatology: climatology, smoothDoy: smoothDoy,
    regionMask: regionMask, areaWeights: areaWeights,
    seriesFor: seriesFor, climSeriesFor: climSeriesFor,
    detectMHW: detectMHW, theilSen: theilSen, normCdf: normCdf,
    cellStats: cellStats, monthlyCube: monthlyCube, hovmoller: hovmoller, pentad: pentad
  };
})(typeof window !== 'undefined' ? window : globalThis);
