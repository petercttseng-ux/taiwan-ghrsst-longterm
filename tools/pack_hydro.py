#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""將 ODB 15' 網格 CTD (ctd_15moa) 與 SADCP (sadcp_15moa) 統計圖集
打包成儀表板用之緊湊二進位檔 data/hydro.bin。

用法：
    python3 tools/pack_hydro.py --ctd ctd_grid15moa.csv --adcp sadcp_grid15moa.csv --out data/

本工具不散布任何資料；原始 CSV 請自 ODB（國科會海洋學門資料庫）取得：
    https://www.odb.ntu.edu.tw/ctd/ctd15moa/
    https://www.odb.ntu.edu.tw/adcp/adcp15moa/
"""
import argparse, csv, gzip, io, json, os, struct, sys
import numpy as np

MAGIC = b'TWHY'
VER = 1
NODATA = -32768
TPS = [0, 13, 14, 15, 16, 17, 18]
TPLAB = ['全年', '冬(12-2)', '春(3-5)', '夏(6-8)', '秋(9-11)',
         '東北季風期(10-4)', '西南季風期(5-9)']
# 目標規則網格（與儀表板範圍一致）
LON0, LON1, LAT0, LAT1, D = 116.0, 128.0, 18.0, 32.0, 0.25
NLON = int(round((LON1 - LON0) / D)) + 1
NLAT = int(round((LAT1 - LAT0) / D)) + 1
CLEV = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95,
        100, 125, 150, 175, 200, 225, 250, 275, 300, 325, 350, 375, 400, 425, 450, 475, 500]
ALEV = list(range(10, 501, 10))
# 欄位 -> (量化倍率)
CVARS = [('temp_avg(deg.c)', 100), ('sal_avg(psu)', 1000), ('sigma-t_avg(kg/m3)', 1000),
         ('temp_std(deg.c)', 100)]
AVARS = [('u_avg(m/s)', 1000), ('v_avg(m/s)', 1000), ('speed(m/s)', 1000),
         ('u_std(m/s)', 1000), ('v_std(m/s)', 1000)]


def grid_index(v, v0, n):
    i = int(round((v - v0) / D))
    return i if 0 <= i < n else -1


def read(path, levcol, levs, varspec):
    lvi = {v: i for i, v in enumerate(levs)}
    tpi = {v: i for i, v in enumerate(TPS)}
    arr = {k: np.full((len(TPS), len(levs), NLAT, NLON), NODATA, np.int16)
           for k, _ in varspec}
    nrow = nkeep = 0
    with open(path, encoding='utf-8-sig', newline='') as fh:
        r = csv.DictReader(fh)
        cols = r.fieldnames
        klon, klat = cols[0], cols[1]
        for d in r:
            nrow += 1
            ix = grid_index(float(d[klon]), LON0, NLON)
            if ix < 0: continue
            iy = grid_index(float(d[klat]), LAT0, NLAT)
            if iy < 0: continue
            lv = float(d[levcol])
            if lv not in lvi: continue
            tp = int(float(d['time_period']))
            if tp not in tpi: continue
            a, b = tpi[tp], lvi[lv]
            nkeep += 1
            for k, sc in varspec:
                s = d[k].strip()
                try:
                    x = float(s)
                except ValueError:
                    continue
                q = int(round(x * sc))
                if -32767 <= q <= 32767:
                    arr[k][a, b, iy, ix] = q
    return arr, nrow, nkeep


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--ctd', required=True)
    ap.add_argument('--adcp', required=True)
    ap.add_argument('--out', default='data/')
    ap.add_argument('--gzip', action='store_true', help='另存 hydro.bin.gz')
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)

    C, n1, k1 = read(a.ctd, 'pressure(db)', CLEV, CVARS)
    print('CTD   讀入 %d 列，落在網格內 %d 列' % (n1, k1))
    A, n2, k2 = read(a.adcp, 'depth(m)', ALEV, AVARS)
    print('SADCP 讀入 %d 列，落在網格內 %d 列' % (n2, k2))

    head = {
        'ver': VER, 'lon0': LON0, 'lat0': LAT0, 'd': D, 'nlon': NLON, 'nlat': NLAT,
        'tps': TPS, 'tplab': TPLAB, 'clev': CLEV, 'alev': ALEV,
        'cvars': [[k, s] for k, s in CVARS], 'avars': [[k, s] for k, s in AVARS],
        'nodata': NODATA,
        'src': 'Ocean Data Bank, National Science and Technology Council (https://www.odb.ntu.edu.tw/)',
        'note': 'ctd_15moa (1985– ) / sadcp_15moa (1991– ) 15-arc-minute gridded climatology'
    }
    hb = json.dumps(head, ensure_ascii=False).encode('utf-8')
    buf = io.BytesIO()
    buf.write(MAGIC); buf.write(struct.pack('<II', VER, len(hb))); buf.write(hb)
    for k, _ in CVARS: buf.write(C[k].astype('<i2').tobytes())
    for k, _ in AVARS: buf.write(A[k].astype('<i2').tobytes())
    raw = buf.getvalue()
    p = os.path.join(a.out, 'hydro.bin')
    open(p, 'wb').write(raw)
    print('寫出 %s（%.1f MB）' % (p, len(raw) / 1048576))
    gz = gzip.compress(raw, 9)
    if a.gzip:
        open(p + '.gz', 'wb').write(gz)
        print('寫出 %s.gz（%.1f MB）' % (p, len(gz) / 1048576))
    else:
        print('（gzip 後約 %.1f MB）' % (len(gz) / 1048576))
    for nm, D_ in (('CTD', C), ('SADCP', A)):
        k = list(D_)[0]
        v = D_[k]
        print('  %-6s %s  有效 %.2f%%' % (nm, v.shape, 100 * (v != NODATA).mean()))


if __name__ == '__main__':
    main()
