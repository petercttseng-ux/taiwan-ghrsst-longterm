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
import argparse, datetime, io, os, sys, time, urllib.request, urllib.error
import numpy as np
from scipy.io import netcdf_file

# 伺服器端不受瀏覽器同源政策限制，因此可使用未送出 CORS 標頭的 NOAA 節點
# （CoastWatch／upwell／PIFSC 等），也就能取得 GHRSST MUR L4 與 OISST 的全記錄。
LON0, LON1 = 116.125, 127.875     # 0.25° 格心，與水試所圖幅對齊
LAT0, LAT1 = 18.125, 31.875

SRC = {
    'oisst': dict(
        server='https://coastwatch.pfeg.noaa.gov/erddap',
        mirrors=['https://upwell.pfeg.noaa.gov/erddap',
                 'https://oceanwatch.pifsc.noaa.gov/erddap'],
        ds='ncdcOisst21Agg', var='sst', zlev=True, stride=None,
        lat=(LAT0, LAT1), lon=(LON0, LON1), start='1981-09-01', win=366,
        label='NOAA OISST v2.1 (AVHRR-only, 0.25°)'),
    'mur': dict(
        server='https://coastwatch.pfeg.noaa.gov/erddap',
        mirrors=['https://upwell.pfeg.noaa.gov/erddap'],
        ds='jplMURSST41', var='analysed_sst', zlev=False, stride=25,
        # MUR 之 0.01° 格點無法與 0.25° 格心完全重合，取最接近者（偏移 0.005°）
        lat=(18.13, 31.88), lon=(116.13, 127.88), start='2002-06-01', win=30,
        label='GHRSST MUR L4 (JPL, 0.01° -> sampled 0.25°)'),
    'crw': dict(
        server='https://pae-paha.pacioos.hawaii.edu/erddap',
        mirrors=[],
        ds='dhw_5km', var='CRW_SST', zlev=False, stride=5,
        lat=(LAT0, LAT1), lon=(LON0, LON1), start='1985-04-01', win=30,
        label='NOAA Coral Reef Watch CoralTemp v3.1 (5 km)'),
}


def build_url(server, src, d0, d1):
    s = SRC[src]
    st = ':%d:' % s['stride'] if s['stride'] else ':'
    sel = '[(%sT00:00:00Z):(%sT23:59:59Z)]' % (d0, d1)
    if s['zlev']:
        sel += '[(0.0)]'
    sel += '[(%s)%s(%s)]' % (s['lat'][0], st, s['lat'][1])
    sel += '[(%s)%s(%s)]' % (s['lon'][0], st, s['lon'][1])
    return '%s/griddap/%s.nc?%s%s' % (server, s['ds'], s['var'], sel)


def get(url, tries=3, timeout=180):
    last = None
    for k in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=timeout) as r:
                return r.read()
        except Exception as e:                      # noqa: BLE001
            last = e
            time.sleep(2 * (k + 1) ** 2)
    raise RuntimeError('下載失敗：%s\n%s' % (url, last))


DAY = datetime.timedelta(days=1)


def dparse(s):
    return datetime.date(int(s[:4]), int(s[5:7]), int(s[8:10]))


def windows(d0, d1, win):
    """把 d0–d1 切成固定天數的視窗。跨度過大時 ERDDAP 需開啟數百個逐日檔，
    常在前端代理逾時前無法回應，故一律小視窗多次請求。"""
    a, end, out = dparse(d0), dparse(d1), []
    while a <= end:
        b = min(a + (win - 1) * DAY, end)
        out.append((a.isoformat(), b.isoformat()))
        a = b + DAY
    return out


MIN_WIN = 4


def fetch_window(servers, src, d0, d1, depth=0):
    """取一個時間視窗；失敗時對半切開重試，直到 MIN_WIN 為止。"""
    last = None
    for sv in servers:
        try:
            return get(build_url(sv, src, d0, d1))
        except Exception as e:                      # noqa: BLE001
            last = e
    span = (dparse(d1) - dparse(d0)).days + 1
    if span <= MIN_WIN:
        raise RuntimeError('%s…%s 取得失敗：%s' % (d0, d1, last))
    mid = (dparse(d0) + (span // 2 - 1) * DAY).isoformat()
    nxt = (dparse(mid) + DAY).isoformat()
    print('    %s…%s 失敗，改以 %d 日為單位重試' % (d0, d1, (span + 1) // 2))
    return [fetch_window(servers, src, d0, mid, depth + 1),
            fetch_window(servers, src, nxt, d1, depth + 1)]


def flatten(x):
    if isinstance(x, list):
        out = []
        for y in x:
            out.extend(flatten(y))
        return out
    return [x]


def parse_nc(blob, var):
    f = netcdf_file(io.BytesIO(blob), mmap=False)
    name = var
    if name not in f.variables:
        cand = [k for k in f.variables if k not in ('time', 'depth', 'zlev',
                                                    'latitude', 'longitude', 'lat', 'lon')]
        if not cand:
            raise RuntimeError('NetCDF 中找不到資料變數')
        name = cand[0]
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
    ap.add_argument('--src', default='crw', choices=list(SRC))
    ap.add_argument('--from', dest='y0', type=int, default=None)
    ap.add_argument('--to', dest='y1', type=int, default=None)
    ap.add_argument('--out', default='raw')
    ap.add_argument('--server', default=None)
    ap.add_argument('--win', type=int, default=None,
                    help='每次請求的天數（預設 crw/mur 30、oisst 366）；逾時時可再調小')
    a = ap.parse_args()

    s = SRC[a.src]
    servers = [a.server] if a.server else ([s['server']] + s['mirrors'])
    os.makedirs(a.out, exist_ok=True)

    y0 = a.y0 or int(s['start'][:4])
    y1 = a.y1 or time.gmtime().tm_year
    print('來源：%s' % s['label'])

    for y in range(y0, y1 + 1):
        path = os.path.join(a.out, '%s_%d.npz' % (a.src, y))
        if os.path.exists(path):
            print('  %d 已存在，略過' % y); continue
        d0 = max('%d-01-01' % y, s['start'])
        d1 = min('%d-12-31' % y, time.strftime('%Y-%m-%d', time.gmtime()))
        if d1 < d0:
            continue
        wins = windows(d0, d1, a.win or s.get('win', 30))
        parts, lat, lon, nfail = [], None, None, 0
        for (w0, w1) in wins:
            try:
                blobs = flatten(fetch_window(servers, a.src, w0, w1))
            except Exception as e:                  # noqa: BLE001
                print('  %s…%s 放棄：%s' % (w0, w1, e)); nfail += 1; continue
            for blob in blobs:
                t, lat, lon, arr = parse_nc(blob, s['var'])
                parts.append((np.round(t / 86400.0).astype('int32'), quant(arr)))
            print('    %s…%s ✓' % (w0, w1))
        if not parts:
            print('  %d 完全無法取得，跳過' % y); continue
        days = np.concatenate([p[0] for p in parts])
        vals = np.concatenate([p[1] for p in parts], axis=0)
        order = np.argsort(days, kind='stable')
        days, vals = days[order], vals[order]
        keep = np.concatenate(([True], np.diff(days) != 0))   # 去除邊界重複日
        days, vals = days[keep], vals[keep]
        np.savez_compressed(path, days=days, vals=vals, lat=lat, lon=lon)
        print('  %d  %d 日 × %d×%d%s  → %s (%.1f MB)'
              % (y, len(days), len(lat), len(lon),
                 ('  [%d 段未取得]' % nfail) if nfail else '',
                 path, os.path.getsize(path) / 1048576))
    print('完成。')


if __name__ == '__main__':
    sys.exit(main())
