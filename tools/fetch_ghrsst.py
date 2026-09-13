#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
fetch_ghrsst.py — 由 NOAA CoastWatch ERDDAP 的 griddap 介面擷取臺灣周邊海域每日網格 SST。

範圍固定為 116–128°E、18–32°N（與水試所每日衛星海面水溫圖圖幅一致）。
資料以 NetCDF 次集（server-side subsetting）方式取得，只傳輸所需格點；
本程式不對任何網頁圖磚做色階反演。

用法：
    python3 fetch_ghrsst.py --src oisst --from 1982 --to 2026 --out raw/
    python3 fetch_ghrsst.py --src mur   --from 2002 --to 2026 --out raw/

輸出：raw/<src>_<year>.npz，內含
    days  : int32  自 1970-01-01 起的日數
    vals  : int16  溫度 ×100，-32768 表無資料，形狀 (nday, nlat, nlon)
    lat   : float64
    lon   : float64
相依：numpy、scipy（scipy.io.netcdf_file 可直接讀 NetCDF-3）
"""
import argparse, io, os, sys, time, urllib.request, urllib.error
import numpy as np
from scipy.io import netcdf_file

MIRRORS = [
    'https://coastwatch.pfeg.noaa.gov/erddap',
    'https://upwell.pfeg.noaa.gov/erddap',
    'https://oceanwatch.pifsc.noaa.gov/erddap',
]

LON0, LON1 = 116.125, 127.875     # 0.25° 格心
LAT0, LAT1 = 18.125, 31.875

SRC = {
    'oisst': dict(ds='ncdcOisst21Agg', var='sst', zlev=True, start='1981-09-01',
                  label='NOAA OISST v2.1 (AVHRR-only, 0.25°)', stride=None),
    'mur':   dict(ds='jplMURSST41mday', var='sst', zlev=False, start='2002-06-01',
                  label='GHRSST MUR L4 monthly (JPL, 0.01° -> 0.05°)', stride=5),
}


def build_url(server, src, d0, d1):
    s = SRC[src]
    sel = '[(%sT00:00:00Z):(%sT23:59:59Z)]' % (d0, d1)
    if s['zlev']:
        sel += '[(0.0)]'
    if s['stride']:
        sel += '[(18.005):%d:(31.995)][(116.005):%d:(127.995)]' % (s['stride'], s['stride'])
    else:
        sel += '[(%s):(%s)][(%s):(%s)]' % (LAT0, LAT1, LON0, LON1)
    return '%s/griddap/%s.nc?%s%s' % (server, s['ds'], s['var'], sel)


def get(url, tries=4, timeout=300):
    last = None
    for k in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=timeout) as r:
                return r.read()
        except Exception as e:                      # noqa: BLE001
            last = e
            time.sleep(2 * (k + 1) ** 2)
    raise RuntimeError('下載失敗：%s\n%s' % (url, last))


def parse_nc(blob, var):
    f = netcdf_file(io.BytesIO(blob), mmap=False)
    name = var if var in f.variables else ('analysed_sst' if 'analysed_sst' in f.variables else var)
    v = f.variables[name]
    a = np.array(v.data, dtype='float64')
    for attr, op in (('scale_factor', 'mul'), ('add_offset', 'add')):
        if hasattr(v, attr):
            x = float(getattr(v, attr))
            a = a * x if op == 'mul' else a + x
    fill = None
    for attr in ('_FillValue', 'missing_value'):
        if hasattr(v, attr):
            fill = float(np.array(getattr(v, attr)).ravel()[0])
    if fill is not None:
        a = np.where(a == fill, np.nan, a)
    t = np.array(f.variables['time'].data, dtype='float64')
    latn = 'latitude' if 'latitude' in f.variables else 'lat'
    lonn = 'longitude' if 'longitude' in f.variables else 'lon'
    lat = np.array(f.variables[latn].data, dtype='float64')
    lon = np.array(f.variables[lonn].data, dtype='float64')
    a = a.reshape(len(t), len(lat), len(lon))       # zlev 長度必為 1，reshape 即可壓掉
    if len(lat) > 1 and lat[1] < lat[0]:            # 統一為由南至北
        a = a[:, ::-1, :]
        lat = lat[::-1]
    return t, lat, lon, a


def quant(a):
    q = np.full(a.shape, -32768, dtype='int16')
    ok = np.isfinite(a) & (a > -5) & (a < 45)
    q[ok] = np.round(a[ok] * 100).astype('int16')
    return q


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--src', default='oisst', choices=list(SRC))
    ap.add_argument('--from', dest='y0', type=int, default=None)
    ap.add_argument('--to', dest='y1', type=int, default=None)
    ap.add_argument('--out', default='raw')
    ap.add_argument('--server', default=None)
    a = ap.parse_args()

    servers = [a.server] if a.server else MIRRORS
    s = SRC[a.src]
    os.makedirs(a.out, exist_ok=True)

    y0 = a.y0 or int(s['start'][:4])
    y1 = a.y1 or time.gmtime().tm_year
    print('來源：%s' % s['label'])

    for y in range(y0, y1 + 1):
        path = os.path.join(a.out, '%s_%d.npz' % (a.src, y))
        if os.path.exists(path):
            print('  %d 已存在，略過' % y); continue
        d0 = max('%d-01-01' % y, s['start'])
        d1 = '%d-12-31' % y
        blob = None
        for sv in servers:
            try:
                blob = get(build_url(sv, a.src, d0, d1)); break
            except Exception as e:                  # noqa: BLE001
                print('  %d 於 %s 失敗：%s' % (y, sv, e))
        if blob is None:
            print('  %d 全部節點皆失敗，跳過' % y); continue
        t, lat, lon, arr = parse_nc(blob, s['var'])
        days = np.round(t / 86400.0).astype('int32')
        np.savez_compressed(path, days=days, vals=quant(arr), lat=lat, lon=lon)
        print('  %d  %d 日 × %d×%d  → %s (%.1f MB)'
              % (y, len(days), len(lat), len(lon), path, os.path.getsize(path) / 1048576))
    print('完成。')


if __name__ == '__main__':
    sys.exit(main())
