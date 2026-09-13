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
      win: 30,                   // 每次請求的天數：CoralTemp 為逐日檔，跨度過大會逾時
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
      win: 180,                  // 單一聚合檔，跨度可較大
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

  var TIMEOUT_MS = 100000;   // 單次請求上限；ERDDAP 前端代理通常在 60–120 秒切斷連線

  /* 逾時中止的 fetch。ERDDAP 前端代理逾時所送出的 502／504 錯誤頁不帶 CORS 標頭，
     瀏覽器一律以 TypeError: Failed to fetch 呈現，因此必須自行設上限並縮小請求。 */
  function fetchOnce(u) {
    var ctl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var timer = ctl ? setTimeout(function () { ctl.abort(); }, TIMEOUT_MS) : null;
    var opt = { credentials: 'omit', cache: 'no-store' };
    if (ctl) opt.signal = ctl.signal;
    return fetch(u, opt).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.arrayBuffer();
    }).then(function (b) {
      if (timer) clearTimeout(timer);
      return b;
    }, function (e) {
      if (timer) clearTimeout(timer);
      var m = (e && e.name === 'AbortError') ? '逾時 ' + (TIMEOUT_MS / 1000) + ' 秒'
            : (e && e.message) ? e.message : String(e);
      throw new Error(m);
    });
  }

  function fetchBuf(u, tries) {
    tries = tries || 2;
    var attempt = 0;
    function go() {
      attempt++;
      return fetchOnce(u).catch(function (e) {
        if (attempt >= tries) throw e;
        return new Promise(function (res) { setTimeout(res, 1200 * attempt); }).then(go);
      });
    }
    return go();
  }

  /* 取得資料集的時間範圍（回傳 ISO 字串）。先試 .json，再退回 .das，皆有重試。 */
  function timeRange(src) {
    var u = url(src, '.json?time%5B0:1:0%5D,time%5Blast%5D');
    return fetchText(u, 3).then(function (txt) {
      var j = JSON.parse(txt), rows = j.table.rows, vals = [];
      for (var i = 0; i < rows.length; i++) vals.push(rows[i][0]);
      vals.sort();
      if (!vals.length) throw new Error('時間軸為空');
      return { t0: vals[0], t1: vals[vals.length - 1] };
    }).catch(function () {
      // 退而求其次：由 .das 解析
      return fetchText(url(src, '.das'), 3).then(function (t) {
        var a = /time_coverage_start\s+"([^"]+)"/.exec(t);
        var b = /time_coverage_end\s+"([^"]+)"/.exec(t);
        if (!a && !b) throw new Error('.das 無時間範圍');
        return { t0: a ? a[1] : src.start, t1: b ? b[1] : ymd(new Date()) };
      });
    });
  }

  function fetchText(u, tries) {
    tries = tries || 3;
    var attempt = 0;
    function go() {
      attempt++;
      var ctl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      var timer = ctl ? setTimeout(function () { ctl.abort(); }, 45000) : null;
      var opt = { credentials: 'omit', cache: 'no-store' };
      if (ctl) opt.signal = ctl.signal;
      return fetch(u, opt).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.text();
      }).then(function (t) { if (timer) clearTimeout(timer); return t; },
        function (e) {
          if (timer) clearTimeout(timer);
          if (attempt >= tries) {
            throw new Error(e && e.name === 'AbortError' ? '逾時 45 秒' : ((e && e.message) || String(e)));
          }
          return new Promise(function (res) { setTimeout(res, 1500 * attempt); }).then(go);
        });
    }
    return go();
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

  /* 切出固定天數的時間視窗。跨度太大時 ERDDAP 須開啟數百個逐日檔，
     常在前端代理逾時前無法回應，因此以小視窗多次請求換取穩定度與可續傳性。 */
  function windows(t0, t1, win) {
    var a = mkDate(t0), end = mkDate(t1), out = [];
    while (a <= end) {
      var b = addDays(a, win - 1);
      if (b > end) b = end;
      out.push([ymd(a), ymd(b)]);
      a = addDays(b, 1);
    }
    return out;
  }

  var MIN_WIN = 4;   // 再小就沒有意義；若連 4 日都取不到即為真正的連線問題

  /* 取一個視窗；失敗時對半切開重試，直到 MIN_WIN 為止。 */
  function fetchWindow(src, a, b, onNote) {
    return fetchChunk(src, a, b).catch(function (e) {
      var da = dayNo(mkDate(a)), db = dayNo(mkDate(b)), span = db - da + 1;
      if (span <= MIN_WIN) throw new Error(a + '…' + b + '：' + e.message);
      var mid = ymd(addDays(mkDate(a), Math.floor(span / 2) - 1));
      var nxt = ymd(addDays(mkDate(mid), 1));
      if (onNote) onNote(a + '…' + b + ' 失敗（' + e.message + '），改以 ' +
                         Math.ceil(span / 2) + ' 日為單位重試');
      return fetchWindow(src, a, mid, onNote).then(function (c1) {
        return fetchWindow(src, nxt, b, onNote).then(function (c2) { return mergeChunks(c1, c2); });
      });
    });
  }

  function mergeChunks(c1, c2) {
    var ncell = c1.nlat * c1.nlon;
    var days = new Int32Array(c1.days.length + c2.days.length);
    days.set(c1.days, 0); days.set(c2.days, c1.days.length);
    var vals = new Int16Array(days.length * ncell);
    vals.set(c1.vals, 0); vals.set(c2.vals, c1.vals.length);
    return { days: days, vals: vals, nlat: c1.nlat, nlon: c1.nlon, lat0: c1.lat0, lon0: c1.lon0 };
  }

  /* 依時間視窗擷取整段記錄，支援續傳與部分失敗。onProg({done,total,label,phase,note}) */
  function harvest(srcKey, opts, onProg) {
    opts = opts || {};
    var src = SRC[srcKey];
    var conc = opts.concurrency || 2;
    var state = { chunks: [], nlat: 0, nlon: 0, failed: [], aborted: false, rangeGuessed: false };
    return timeRange(src).catch(function (e) {
      // 取不到時間軸不應中止整個建置：改用來源內建的起始日與今日，
      // 讓後續逐段擷取自行回報成敗，錯誤訊息才有診斷價值。
      state.rangeGuessed = true;
      if (onProg) onProg({ done: 0, total: 0, phase: 'note', label: '',
        note: '無法取得資料集時間範圍（' + e.message + '），改用內建預設範圍 ' +
              src.start + ' – 今日 繼續嘗試' });
      return { t0: src.start, t1: ymd(new Date()) };
    }).then(function (tr) {
      var t0 = (opts.from || tr.t0).slice(0, 10), t1 = (opts.to || tr.t1).slice(0, 10);
      if (t0 < src.start) t0 = src.start;
      if (t1 > tr.t1.slice(0, 10)) t1 = tr.t1.slice(0, 10);
      var win = opts.win || src.win || 30;
      var ws = windows(t0, t1, win);
      var total = ws.length, done = 0, next = 0;
      if (onProg) onProg({ done: 0, total: total, phase: 'range', t0: t0, t1: t1, win: win,
                           guessed: state.rangeGuessed, label: t0 + ' – ' + t1 });

      function note(m) { if (onProg) onProg({ done: done, total: total, label: m, phase: 'note', note: m }); }

      // 連續失敗多次代表節點已不可用（封鎖、限流或離線），
      // 與其硬跑完 505 段，不如及早停下並保留已取得的段落。
      var GIVE_UP = 8, consec = 0, pace = 40;

      function one() {
        if (next >= total || state.aborted) return Promise.resolve();
        var idx = next++, a = ws[idx][0], b = ws[idx][1];
        var key = srcKey + '|' + a + '|' + b;
        return idbGet(key).then(function (hit) {
          if (hit && hit.vals && hit.days) return hit;
          return fetchWindow(src, a, b, note).then(function (c) {
            return idbPut(key, c).then(function () { return c; }, function () { return c; });
          });
        }).then(function (c) {
          state.chunks.push(c); state.nlat = c.nlat; state.nlon = c.nlon;
          consec = 0; pace = 40;
        }, function (e) {
          // 單一視窗徹底失敗不中止整體建置；缺漏日期在統計中會被視為無資料
          state.failed.push({ a: a, b: b, msg: e.message });
          note('✗ ' + a + '…' + b + '：' + e.message);
          consec++;
          pace = Math.min(8000, pace * 3);   // 失敗後放慢，避免持續衝撞限流
          if (consec >= GIVE_UP) {
            state.aborted = true;
            note('連續 ' + GIVE_UP + ' 段失敗，判定節點目前不可用，已停止擷取；' +
                 '已取得的段落都留在快取，稍後再按一次「開始建置」即可續傳。');
          }
        }).then(function () {
          done++;
          if (onProg) onProg({ done: done, total: total, label: a.slice(0, 7), phase: 'fetch' });
          return new Promise(function (r) { setTimeout(r, pace); }).then(one);
        });
      }

      var lanes = [];
      for (var q = 0; q < Math.max(1, conc); q++) lanes.push(one());
      return Promise.all(lanes).then(function () {
        if (onProg) onProg({ done: total, total: total, label: '完成', phase: 'fetch' });
        if (!state.chunks.length) {
          throw new Error('一段資料都沒取到（共 ' + state.failed.length + ' 段失敗）。' +
            (state.failed.length ? '第一段的錯誤是：' + state.failed[0].msg : ''));
        }
        var D = assemble(state);
        D.failed = state.failed;
        D.aborted = state.aborted;
        D.total = total;
        return D;
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
