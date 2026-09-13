/* netcdf.js — 最小 NetCDF-3 (classic / 64-bit offset) 讀取器
   用途：解析 ERDDAP griddap 的 .nc 回應。純 ArrayBuffer 運算，無外部相依。
   規格：https://docs.unidata.ucar.edu/netcdf-c/current/file_format_specifications.html
   所有整數為 big-endian；字串與屬性值均補齊至 4 byte 邊界。 */
(function (root) {
  'use strict';

  var NC_BYTE = 1, NC_CHAR = 2, NC_SHORT = 3, NC_INT = 4, NC_FLOAT = 5, NC_DOUBLE = 6;
  var TYPESIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 4, 6: 8 };

  function Reader(buf) {
    this.dv = new DataView(buf);
    this.buf = buf;
    this.p = 0;
  }
  Reader.prototype.i8 = function () { var v = this.dv.getInt8(this.p); this.p += 1; return v; };
  Reader.prototype.i32 = function () { var v = this.dv.getInt32(this.p, false); this.p += 4; return v; };
  Reader.prototype.i64 = function () {
    // NetCDF 檔案不會超過 2^53 byte，安全轉為 Number
    var hi = this.dv.getInt32(this.p, false), lo = this.dv.getUint32(this.p + 4, false);
    this.p += 8; return hi * 4294967296 + lo;
  };
  Reader.prototype.pad = function (n) { this.p += (4 - (n % 4)) % 4; };
  Reader.prototype.name = function () {
    var n = this.i32(), s = '';
    for (var i = 0; i < n; i++) s += String.fromCharCode(this.dv.getUint8(this.p + i));
    this.p += n; this.pad(n);
    return s;
  };
  Reader.prototype.values = function (type, n) {
    var out, i;
    if (type === NC_CHAR) {
      out = '';
      for (i = 0; i < n; i++) out += String.fromCharCode(this.dv.getUint8(this.p + i));
      this.p += n; this.pad(n); return out;
    }
    out = new Array(n);
    for (i = 0; i < n; i++) {
      if (type === NC_BYTE) out[i] = this.dv.getInt8(this.p + i);
      else if (type === NC_SHORT) out[i] = this.dv.getInt16(this.p + i * 2, false);
      else if (type === NC_INT) out[i] = this.dv.getInt32(this.p + i * 4, false);
      else if (type === NC_FLOAT) out[i] = this.dv.getFloat32(this.p + i * 4, false);
      else if (type === NC_DOUBLE) out[i] = this.dv.getFloat64(this.p + i * 8, false);
    }
    var bytes = n * TYPESIZE[type];
    this.p += bytes; this.pad(bytes);
    return out;
  };
  Reader.prototype.attrs = function () {
    var tag = this.i32(), n = this.i32(), a = {};
    if (tag === 0 && n === 0) return a;
    if (tag !== 0x0C) throw new Error('nc: 屬性標記異常 0x' + tag.toString(16));
    for (var i = 0; i < n; i++) {
      var nm = this.name(), t = this.i32(), cnt = this.i32();
      var v = this.values(t, cnt);
      a[nm] = (t !== NC_CHAR && cnt === 1) ? v[0] : v;
    }
    return a;
  };

  /* 解析標頭，回傳 {version, numrecs, dims, vars, gattrs} */
  function parse(buf) {
    var r = new Reader(buf);
    if (r.dv.getUint8(0) !== 67 || r.dv.getUint8(1) !== 68 || r.dv.getUint8(2) !== 70)
      throw new Error('nc: 不是 NetCDF-3 檔（可能是 HDF5/NetCDF-4，或伺服器回傳錯誤頁）');
    var version = r.dv.getUint8(3);
    if (version !== 1 && version !== 2) throw new Error('nc: 不支援的版本 ' + version);
    r.p = 4;
    var numrecs = r.i32();
    if (numrecs < 0) numrecs = 0; // STREAMING

    // dim_list
    var dims = [], tag = r.i32(), n = r.i32(), i;
    if (tag === 0x0A) { for (i = 0; i < n; i++) dims.push({ name: r.name(), len: r.i32() }); }
    else if (!(tag === 0 && n === 0)) throw new Error('nc: 維度標記異常');
    var recDim = -1;
    for (i = 0; i < dims.length; i++) if (dims[i].len === 0) { recDim = i; dims[i].len = numrecs; }

    var gattrs = r.attrs();

    // var_list
    var vars = {}, order = [];
    tag = r.i32(); n = r.i32();
    if (tag === 0x0B) {
      for (i = 0; i < n; i++) {
        var nm = r.name(), nd = r.i32(), ids = [];
        for (var k = 0; k < nd; k++) ids.push(r.i32());
        var at = r.attrs(), t = r.i32(), vsize = r.i32();
        var begin = version === 1 ? r.i32() : r.i64();
        var shape = ids.map(function (d) { return dims[d].len; });
        vars[nm] = {
          name: nm, type: t, dimIds: ids, shape: shape, attrs: at,
          vsize: vsize, begin: begin,
          isRecord: ids.length > 0 && ids[0] === recDim
        };
        order.push(nm);
      }
    } else if (!(tag === 0 && n === 0)) throw new Error('nc: 變數標記異常');

    return { version: version, numrecs: numrecs, dims: dims, vars: vars, order: order,
             gattrs: gattrs, recDim: recDim, _buf: buf };
  }

  /* 讀出整個變數為 Float64Array（已套用 scale_factor / add_offset，_FillValue → NaN） */
  function read(hdr, name) {
    var v = hdr.vars[name];
    if (!v) throw new Error('nc: 找不到變數 ' + name);
    var dv = new DataView(hdr._buf);
    var total = v.shape.reduce(function (a, b) { return a * b; }, 1);
    var out = new Float64Array(total);
    var ts = TYPESIZE[v.type];

    function get(off) {
      switch (v.type) {
        case NC_BYTE: return dv.getInt8(off);
        case NC_CHAR: return dv.getUint8(off);
        case NC_SHORT: return dv.getInt16(off, false);
        case NC_INT: return dv.getInt32(off, false);
        case NC_FLOAT: return dv.getFloat32(off, false);
        case NC_DOUBLE: return dv.getFloat64(off, false);
      }
      return NaN;
    }

    if (!v.isRecord) {
      for (var i = 0; i < total; i++) out[i] = get(v.begin + i * ts);
    } else {
      // record 變數：每筆記錄在檔中以 recsize 為間隔交錯存放
      var recsize = 0, nm;
      for (var q = 0; q < hdr.order.length; q++) {
        nm = hdr.order[q];
        if (hdr.vars[nm].isRecord) recsize += pad4(hdr.vars[nm].vsize);
      }
      var per = total / Math.max(1, v.shape[0]);
      for (var t2 = 0; t2 < v.shape[0]; t2++)
        for (var j = 0; j < per; j++)
          out[t2 * per + j] = get(v.begin + t2 * recsize + j * ts);
    }

    var fv = v.attrs._FillValue !== undefined ? v.attrs._FillValue
           : (v.attrs.missing_value !== undefined ? v.attrs.missing_value : undefined);
    var sf = v.attrs.scale_factor, ao = v.attrs.add_offset;
    if (fv !== undefined || sf !== undefined || ao !== undefined) {
      for (var m = 0; m < total; m++) {
        var x = out[m];
        if (fv !== undefined && x === fv) { out[m] = NaN; continue; }
        if (sf !== undefined) x *= sf;
        if (ao !== undefined) x += ao;
        out[m] = x;
      }
    }
    // ERDDAP 對缺值也可能直接送 NaN（float），保持原樣
    return out;
  }

  function pad4(n) { return n + ((4 - (n % 4)) % 4); }

  root.NC = { parse: parse, read: read };
})(typeof window !== 'undefined' ? window : globalThis);
