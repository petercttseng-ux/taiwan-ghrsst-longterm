/* harvest.js — 由 ERDDAP griddap 直接擷取每日網格 SST，於瀏覽器端完成、快取於 IndexedDB。
   設計理由：GHRSST/OISST 的原始檔以 NetCDF 提供，透過 ERDDAP 的 griddap 介面可直接做
   時空次集擷取（server-side subsetting），不需下載全球場，也不需對圖磚做色階反演。 */
(function (root) {
  'use strict';

  /* ---------- 網格定義（與 twsst20260907.png 完全對齊）---------- */
  var G = {
    lon0: 116.125, lon1: 127.875, lat0: 18.125, lat1: 31.875,
    d: 0.25, nlon: 48, nlat: 56, n: 48 * 56,
    // 格點邊界（供繪圖用）
    bLon0: 116.0, bLon1: 128.0, bLat0: 18.0, bLat1: 32.0
  };

  /* 可用來源。瀏覽器端只能使用有送出 CORS 標頭的 ERDDAP 節點；
     NOAA CoastWatch／upwell／PIFSC 等節點未送 Access-Control-Allow-Origin，
     網頁無法讀取其回應（已實測），故僅供 tools/fetch_ghrsst.py 的伺服器端路徑使用。 */
  var SRC = {
    crw: {
      key: 'crw',
      server: 'https://pae-paha.pacioos.hawaii.edu/erddap',
      ds: 'dhw_5km',
      v: 'CRW_SST',
      zlev: false,
      stride: 5,                 // 0.05° → 每 5 格取樣為 0.25°（格點恰好對齊）
      start: '1985-04-01',
      label: 'NOAA Coral Reef Watch CoralTemp v3.1（5 km 逐日，1985– ）',
      cite: 'NOAA Coral Reef Watch (2018, updated). Daily Global 5km Satellite SST (CoralTemp v3.1).'
    },
    oisst: {
      key: 'oisst',
      server: 'https://www.ncei.noaa.gov/erddap',
      ds: 'ncdc_oisst_v2_avhrr_by_time_zlev_lat_lon',
      v: 'sst',
      zlev: true,
      stride: null,              // 原生即 0.25°
      start: '2020-02-28',       // NCEI ERDDAP 僅提供滾動視窗，非全記錄
      label: 'NOAA OISST v2.1（0.25° 逐日，近 6 年，供交叉檢核）',
      cite: 'Huang, B. et al. (2021). DOISST v2.1. J. Climate 34, 2923–2939.'
    }
  };

  /* ---------- IndexedDB 快取 ---------- */
  var DB = null, DBNAME = 'ghrsst-tw', STORE = 'chunks';
  function db() {
    if (DB) return Promise.resolve(DB);
    return new Promise(function (res, rej) {
      var rq = indexedDB.open(DBNAME, 1);
      rq.onupgradeneeded = function () {
        var d = rq.result;
        if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE);
      };
      rq.onsuccess = function () { DB = rq.result; res(DB); };
      rq.onerror = function () { rej(rq.error); };
    });
  }
  function idbGet(k) {
    return db().then(function (d) {
      return new Promise(function (res, rej) {
        var t = d.transaction(STORE, 'readonly').objectStore(STORE).get(k);
        t.onsuccess = function () { res(t.result); };
        t.onerror = function () { rej(t.error); };
      });
    });
  }
  function idbPut(k, v) {
    return db().then(function (d) {
      return new Promise(function (res, rej) {
        var t = d.transaction(STORE, 'readwrite').objectStore(STORE).put(v, k);
        t.onsuccess = function () { res(true); };
        t.onerror = function () { rej(t.error); };
      });
    });
  }
  function idbKeys() {
    return db().then(function (d) {
      return new Promise(function (res, rej) {
        var t = d.transaction(STORE, 'readonly').objectStore(STORE).getAllKeys();
        t.onsuccess = function () { res(t.result); };
        t.onerror = function () { rej(t.error); };
      });
    });
  }
  function idbClear() {
    return db().then(function (d) {
      return new Promise(function (res, rej) {
        var t = d.transaction(STORE, 'readwrite').objectStore(STORE).clear();
        t.onsuccess = function () { res(true); };
        t.onerror = function () { rej(t.error); };
      });
    });
  }

  /* ---------- 日期工具（一律以 UTC 處理）---------- */
  function ymd(d) {
    return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
  }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function mkDate(s) { return new Date(s + 'T12:00:00Z'); }
  function addDays(d, n) { return new Date(d.getTime() + n * 86400000); }
  function dayNo(d) { return Math.floor(d.getTime() / 86400000); }

  /* ---------- ERDDAP 存取 ---------- */
  var override = null;   // 若使用者指定節點則覆寫

  function serverOf(src) { return override || src.server; }
  function url(src, path) { return serverOf(src) + '/griddap/' + src.ds + path; }

  function fetchBuf(u, tries) {
    tries = tries || 4;
    var attempt = 0;
    function go() {
      attempt++;
      return fetch(u, { credentials: 'omit', cache: 'no-store' }).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.arrayBuffer();
      }).catch(function (e) {
        if (attempt >= tries) throw e;
        return new Promise(function (res) { setTimeout(res, 1500 * attempt * attempt); }).then(go);
      });
    }
    return go();
  }

  /* 取得資料集的時間範圍（回傳 ISO 字串） */
  function timeRange(src) {
    var u = url(src, '.json?time%5B0:1:0%5D,time%5Blast%5D');
    return fetch(u, { credentials: 'omit' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (j) {
      var rows = j.table.rows, vals = [];
      for (var i = 0; i < rows.length; i++) vals.push(rows[i][0]);
      vals.sort();
      return { t0: vals[0], t1: vals[vals.length - 1] };
    }).catch(function () {
      // 退而求其次：由 .das 解析
      return fetch(url(src, '.das'), { credentials: 'omit' }).then(function (r) { return r.text(); })
        .then(function (t) {
          var a = /time_coverage_start\s+"([^"]+)"/.exec(t);
          var b = /time_coverage_end\s+"([^"]+)"/.exec(t);
          return { t0: a ? a[1] : src.start, t1: b ? b[1] : ymd(new Date()) };
        });
    });
  }

  /* 組出一段期間的 .nc 次集 URL。
     取樣網格一律為 116.125–127.875 °E、18.125–31.875 °N，0.25° 共 48 × 56 格，
     與水試所每日衛星海面水溫圖的圖幅完全對齊。 */
  function chunkUrl(src, d0, d1) {
    var st = src.stride ? (':' + src.stride + ':') : ':';
    var sel = '%5B(' + d0 + 'T00:00:00Z):(' + d1 + 'T23:59:59Z)%5D';
    if (src.zlev) sel += '%5B(0.0)%5D';
    sel += '%5B(' + G.lat0 + ')' + st + '(' + G.lat1 + ')%5D';
    sel += '%5B(' + G.lon0 + ')' + st + '(' + G.lon1 + ')%5D';
    return url(src, '.nc?' + src.v + sel);
  }

  /* 擷取一段期間，回傳 {days:Int32Array(自1970起的日數), vals:Int16Array(n*ncell), nlat, nlon} */
  function fetchChunk(src, d0, d1) {
    return fetchBuf(chunkUrl(src, d0, d1)).then(function (buf) {
      var h = root.NC.parse(buf);
      var vname = h.vars[src.v] ? src.v : (h.vars.analysed_sst ? 'analysed_sst' : src.v);
      var sst = root.NC.read(h, vname);
      var tv = root.NC.read(h, h.vars.time ? 'time' : 'time');
      var latName = h.vars.latitude ? 'latitude' : 'lat';
      var lonName = h.vars.longitude ? 'longitude' : 'lon';
      var lat = root.NC.read(h, latName), lon = root.NC.read(h, lonName);
      var nt = tv.length, nlat = lat.length, nlon = lon.length;
      var ncell = nlat * nlon;
      if (sst.length !== nt * ncell) throw new Error('nc: 資料長度不符 ' + sst.length + ' vs ' + nt * ncell);

      // 緯度若為遞減，翻轉為由南至北
      var flip = nlat > 1 && lat[1] < lat[0];
      var out = new Int16Array(nt * ncell);
      for (var t = 0; t < nt; t++) {
        for (var j = 0; j < nlat; j++) {
          var js = flip ? (nlat - 1 - j) : j;
          for (var i = 0; i < nlon; i++) {
            var x = sst[(t * nlat + js) * nlon + i];
            var k = (t * nlat + j) * nlon + i;
            out[k] = (x === x && x > -5 && x < 45) ? Math.round(x * 100) : -32768;
          }
        }
      }
      var days = new Int32Array(nt);
      for (var q = 0; q < nt; q++) days[q] = Math.round(tv[q] / 86400);
      return { days: days, vals: out, nlat: nlat, nlon: nlon,
               lat0: flip ? lat[nlat - 1] : lat[0], lon0: lon[0] };
    });
  }

  /* 逐年擷取整段記錄，支援續傳。onProg({done,total,label,bytes}) */
  function harvest(srcKey, opts, onProg) {
    opts = opts || {};
    var src = SRC[srcKey];
    var state = { chunks: [], nlat: 0, nlon: 0 };
    return timeRange(src).then(function (tr) {
      var y0 = parseInt((opts.from || tr.t0).slice(0, 4), 10);
      var y1 = parseInt((opts.to || tr.t1).slice(0, 4), 10);
      var years = [];
      for (var y = y0; y <= y1; y++) years.push(y);
      var i = 0, t0 = (opts.from || tr.t0).slice(0, 10), t1 = (opts.to || tr.t1).slice(0, 10);

      function step() {
        if (i >= years.length) return Promise.resolve(state);
        var y = years[i];
        var a = (y === y0) ? t0 : (y + '-01-01');
        var b = (y === y1) ? t1 : (y + '-12-31');
        var key = srcKey + '|' + y + '|' + a + '|' + b;
        if (onProg) onProg({ done: i, total: years.length, label: y + ' 年', phase: 'fetch' });
        return idbGet(key).then(function (hit) {
          if (hit && hit.vals) return hit;
          return fetchChunk(src, a, b).then(function (c) {
            return idbPut(key, c).then(function () { return c; });
          });
        }).then(function (c) {
          state.chunks.push(c); state.nlat = c.nlat; state.nlon = c.nlon;
          i++;
          return new Promise(function (r) { setTimeout(r, 30); }).then(step);
        });
      }
      return step().then(function () {
        if (onProg) onProg({ done: years.length, total: years.length, label: '完成', phase: 'fetch' });
        return assemble(state);
      });
    });
  }

  /* 把逐年區塊併成連續的日曆立方 */
  function assemble(state) {
    var chunks = state.chunks;
    if (!chunks.length) throw new Error('沒有取得任何資料');
    var ncell = state.nlat * state.nlon;
    var minD = Infinity, maxD = -Infinity, i, k;
    for (i = 0; i < chunks.length; i++) {
      var ds = chunks[i].days;
      if (ds.length) { if (ds[0] < minD) minD = ds[0]; if (ds[ds.length - 1] > maxD) maxD = ds[ds.length - 1]; }
    }
    var nd = maxD - minD + 1;
    var cube = new Int16Array(nd * ncell).fill(-32768);
    var have = new Uint8Array(nd);
    for (i = 0; i < chunks.length; i++) {
      var c = chunks[i];
      for (var t = 0; t < c.days.length; t++) {
        var idx = c.days[t] - minD;
        have[idx] = 1;
        cube.set(c.vals.subarray(t * ncell, (t + 1) * ncell), idx * ncell);
      }
    }
    return { cube: cube, have: have, nday: nd, day0: minD,
             nlat: state.nlat, nlon: state.nlon, ncell: ncell };
  }

  root.HARVEST = {
    G: G, SRC: SRC,
    setServer: function (s) { override = s || null; },
    getServer: function (key) { return override || (SRC[key] ? SRC[key].server : ''); },
    timeRange: timeRange, fetchChunk: fetchChunk, harvest: harvest,
    idbKeys: idbKeys, idbClear: idbClear,
    util: { ymd: ymd, mkDate: mkDate, addDays: addDays, dayNo: dayNo, pad2: pad2 }
  };
})(typeof window !== 'undefined' ? window : globalThis);
