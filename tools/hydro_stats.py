#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""現場水文／流場之整合統計（Python 路徑，與 js/hydro.js 同一組定義）。

    python3 tools/pack_hydro.py --ctd ctd_grid15moa.csv --adcp sadcp_grid15moa.csv --out data/
    python3 tools/hydro_stats.py --bin data/hydro.bin [--trend data/analysis.json]

輸出：各海域上層結構、季節流場、經向斷面輸送，以及
      「衛星升溫速率 × 現場層結」之等級相關診斷。
資料來源：Ocean Data Bank, National Science and Technology Council
          https://www.odb.ntu.edu.tw/  （本工具不散布任何資料）
"""
import argparse, json, os, struct, sys
import numpy as np
np.seterr(all='ignore')

NODATA = -32768
REGIONS = [
    ('nts',   '臺灣海峽北部',     119.0, 121.0, 24.5, 26.0),
    ('sts',   '臺灣海峽南部',     118.5, 120.5, 22.5, 24.5),
    ('penghu','澎湖海域',         119.0, 120.0, 23.0, 24.0),
    ('ne',    '東北部海域',       121.5, 123.5, 25.0, 26.5),
    ('east',  '東部海域(黑潮)',   121.5, 123.0, 22.5, 24.5),
    ('sw',    '西南部海域(高屏)', 119.5, 120.5, 21.5, 22.5),
    ('bashi', '巴士海峽',         120.5, 122.0, 20.5, 22.0),
    ('nscs',  '南海北部(東沙)',   116.5, 118.5, 19.5, 21.5),
    ('secs',  '東海南部',         122.0, 126.0, 27.5, 30.5),
    ('nwp',   '西北太平洋',       124.0, 127.0, 22.5, 25.5),
]
SECT = [('東部 23.50°N', 23.50, 121.0, 124.5, 500),
        ('東北 25.25°N', 25.25, 121.0, 124.5, 500),
        ('巴士 21.75°N', 21.75, 120.0, 122.5, 500),
        ('海峽 24.50°N', 24.50, 119.0, 121.0, 80),
        ('海峽 23.00°N', 23.00, 118.5, 120.5, 80)]


def load(path):
    raw = open(path, 'rb').read()
    assert raw[:4] == b'TWHY', '不是 hydro.bin'
    ver, hlen = struct.unpack('<II', raw[4:12])
    h = json.loads(raw[12:12 + hlen].decode('utf-8'))
    off = 12 + hlen
    ntp, nlat, nlon = len(h['tps']), h['nlat'], h['nlon']
    out = {'h': h}
    for spec, levs in ((h['cvars'], h['clev']), (h['avars'], h['alev'])):
        for name, sc in spec:
            cnt = ntp * len(levs) * nlat * nlon
            a = np.frombuffer(raw, '<i2', cnt, off).reshape(ntp, len(levs), nlat, nlon)
            off += cnt * 2
            v = a.astype(np.float64)
            v[a == NODATA] = np.nan
            out[name] = v / sc
    return out


def prof_metrics(t, s, sg, p):
    m = np.isfinite(t)
    if m.sum() < 4: return {}
    tp, pp = t[m].astype(np.float64), p[m].astype(np.float64)   # 與 JS 同以倍精度運算
    if pp[0] > 15 or pp[-1] < 60: return {}
    o = {'sst': float(tp[0]), 'pmax': float(pp[-1])}
    # 混合層：自表層往下「首次」跨越 ΔT = 0.5 °C 之深度（不假設溫度剖面單調）
    dt = tp[0] - tp
    for k in range(1, len(pp)):
        if dt[k] >= 0.5:
            f = (0.5 - dt[k-1]) / (dt[k] - dt[k-1]) if dt[k] != dt[k-1] else 0.0
            o['mld'] = float(pp[k-1] + f * (pp[k] - pp[k-1]))
            break
    # 原始溫度僅兩位小數，梯度取至 1e-6 以免因浮點雜訊在等值處任意跳動；並列時取較淺者
    g = np.round(-np.diff(tp) / np.diff(pp), 6)
    if len(g) and np.isfinite(g).any():
        j = int(np.nanargmax(g)); o['thd'] = float(0.5 * (pp[j] + pp[j+1])); o['thg'] = float(g[j] * 100)
    if tp[0] >= 20 >= tp[-1]:
        for j in range(1, len(pp)):          # 首次由上而下跨越 20 °C
            if tp[j] <= 20 < tp[j-1]:
                o['d20'] = float(pp[j-1] + (tp[j-1] - 20.0) / (tp[j-1] - tp[j]) * (pp[j] - pp[j-1]))
                break
    sel = pp <= 200
    if sel.sum() >= 3 and pp[sel][-1] >= 160:
        o['tm200'] = float(np.trapezoid(tp[sel], pp[sel]) / (pp[sel][-1] - pp[sel][0]))
    ms = np.isfinite(sg)
    if ms.sum() >= 4 and p[ms][0] <= 15 and p[ms][-1] >= 100:
        o['dsig'] = float(np.interp(100.0, p[ms], sg[ms]) - np.interp(0.0, p[ms], sg[ms]))
    return o


def spearman(x, y):
    from scipy import stats
    return stats.spearmanr(x, y)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--bin', default='data/hydro.bin')
    ap.add_argument('--trend', default='', help='data/analysis.json（取各海域升溫速率做整合診斷）')
    a = ap.parse_args()
    D = load(a.bin); h = D['h']
    lon = h['lon0'] + np.arange(h['nlon']) * h['d']
    lat = h['lat0'] + np.arange(h['nlat']) * h['d']
    P = np.array(h['clev'], float); Z = np.array(h['alev'], float)
    tpi = {c: i for i, c in enumerate(h['tps'])}
    T, S, SG = D['temp_avg(deg.c)'], D['sal_avg(psu)'], D['sigma-t_avg(kg/m3)']
    U, V, SP = D['u_avg(m/s)'], D['v_avg(m/s)'], D['speed(m/s)']

    def bx(b):
        return (np.where((lat >= b[2]) & (lat <= b[3]))[0],
                np.where((lon >= b[0]) & (lon <= b[1]))[0])

    def region(b, tp=0):
        it = tpi[tp]; ly, lx = bx(b)
        acc, wt = {}, {}
        n = 0
        for j in ly:
            w = np.cos(np.deg2rad(lat[j]))
            for i in lx:
                m = prof_metrics(T[it, :, j, i], S[it, :, j, i], SG[it, :, j, i], P)
                if m: n += 1
                for k, v in m.items():
                    acc[k] = acc.get(k, 0.0) + v * w; wt[k] = wt.get(k, 0.0) + w
        o = {k: acc[k] / wt[k] for k in acc}; o['ncell'] = n
        kz = Z <= 100
        u = U[it][np.ix_(kz, ly, lx)]; v = V[it][np.ix_(kz, ly, lx)]; sp = SP[it][np.ix_(kz, ly, lx)]
        if np.isfinite(u).any():
            o['u'], o['v'] = float(np.nanmean(u)), float(np.nanmean(v))
            o['spd'] = float(np.nanmean(sp))
            o['vec'] = float(np.hypot(o['u'], o['v']))
            o['stab'] = o['vec'] / o['spd'] if o['spd'] else np.nan
        return o

    print('=' * 100)
    print('各海域上層水體結構與流場（全年氣候值；cos φ 面積加權）')
    print('=' * 100)
    hh = '%-14s %5s %6s %6s %6s %7s %6s %6s %7s %7s %6s'
    print(hh % ('海域', '格數', 'SST', 'MLD', '溫躍層', '梯度', 'Δσt', 'D20', '流速', '北向v', '穩定度'))
    R = {}
    g = lambda d, k, f='%.2f': ('—' if k not in d or d[k] != d[k] else f % d[k])
    for rid, zh, *b in REGIONS:
        r = region(b); R[rid] = r
        print(hh % (zh, r['ncell'], g(r, 'sst'), g(r, 'mld', '%.0f'), g(r, 'thd', '%.0f'),
                    g(r, 'thg'), g(r, 'dsig'), g(r, 'd20', '%.0f'),
                    g(r, 'spd', '%.3f'), g(r, 'v', '%+.3f'), g(r, 'stab')))

    print()
    print('=' * 100)
    print('季節上層 100 m 流場（僅計四季皆有觀測之共同格點）')
    print('=' * 100)
    hf = '%-14s %-12s %6s %8s %8s %7s %7s %6s'
    print(hf % ('海域', '期別', '格點', 'u m/s', 'v m/s', '流速', '向量', '穩定度'))
    kz = Z <= 100
    for rid, zh, *b in REGIONS:
        ly, lx = bx(b)
        cm = np.ones((int(kz.sum()), len(ly), len(lx)), bool)
        for c in (13, 14, 15, 16):
            cm &= np.isfinite(U[tpi[c]][np.ix_(kz, ly, lx)])
        if not cm.any():
            continue
        for c in h['tps']:
            u = np.where(cm, U[tpi[c]][np.ix_(kz, ly, lx)], np.nan)
            v = np.where(cm, V[tpi[c]][np.ix_(kz, ly, lx)], np.nan)
            sp = np.where(cm, SP[tpi[c]][np.ix_(kz, ly, lx)], np.nan)
            if not np.isfinite(u).any(): continue
            uu, vv, ss = np.nanmean(u), np.nanmean(v), np.nanmean(sp)
            print(hf % (zh if c == 0 else '', h['tplab'][tpi[c]], int(np.isfinite(u).any(0).sum()),
                        '%+.3f' % uu, '%+.3f' % vv, '%.3f' % ss, '%.3f' % np.hypot(uu, vv),
                        '%.2f' % (np.hypot(uu, vv) / ss if ss else np.nan)))
        print('-' * 100)

    print()
    print('=' * 100)
    print('經向體積輸送（Sv；共同格 = 四季皆有觀測之水體格，季節間才可比）')
    print('=' * 100)
    ht = '%-16s %-12s %6s %9s %9s %9s %10s'
    print(ht % ('斷面', '期別', '格數', '北向', '南向', '淨', '共同格淨'))
    for nm, la, a0, a1, zm in SECT:
        j = int(np.argmin(np.abs(lat - la)))
        ix = np.where((lon >= a0) & (lon <= a1))[0]
        kk = np.where(Z <= zm)[0]
        cm = np.ones((len(kk), len(ix)), bool)
        for c in (13, 14, 15, 16):
            cm &= np.isfinite(V[tpi[c]][np.ix_(kk, [j], ix)][:, 0, :])
        dx = h['d'] * 111320.0 * np.cos(np.deg2rad(lat[j])); dz = float(Z[1] - Z[0])
        for c in h['tps']:
            v = V[tpi[c]][np.ix_(kk, [j], ix)][:, 0, :]
            if not np.isfinite(v).any(): continue
            pos = np.nansum(np.where(v > 0, v, 0)) * dx * dz / 1e6
            neg = np.nansum(np.where(v < 0, v, 0)) * dx * dz / 1e6
            vc = np.where(cm, v, np.nan)
            netc = np.nansum(np.where(vc > 0, vc, 0) + np.where(vc < 0, vc, 0)) * dx * dz / 1e6
            print(ht % ('%s 0–%dm' % (nm, zm) if c == 0 else '', h['tplab'][tpi[c]],
                        int(np.isfinite(v).sum()), '%+.2f' % pos, '%+.2f' % neg,
                        '%+.2f' % (pos + neg), '%+.2f' % netc))
        print('   共同格 %d / %d' % (cm.sum(), cm.size))
        print('-' * 100)

    if a.trend and os.path.exists(a.trend):
        J = json.load(open(a.trend))
        tr = {k: v for k, v in (J.get('regionTrend') or {}).items()}
        if tr:
            print()
            print('=' * 100)
            print('整合診斷：衛星升溫速率 × 現場層結（Spearman 等級相關）')
            print('=' * 100)
            keys = [k for k in R if k in tr]
            t = [tr[k] for k in keys]
            for var, lab in (('dsig', '上層 100 m Δσt'), ('mld', '混合層深度'),
                             ('thg', '溫躍層梯度'), ('d20', '20 °C 面深度'),
                             ('sst', '氣候表層溫'), ('spd', '上層流速'),
                             ('v', '北向分量'), ('stab', '流向穩定度')):
                x = [R[k].get(var, np.nan) for k in keys]
                m = [i for i in range(len(x)) if x[i] == x[i]]
                if len(m) < 5: continue
                s = spearman([x[i] for i in m], [t[i] for i in m])
                print('%-18s n=%2d  ρ=%+.3f  p=%.4f' % (lab, len(m), s.statistic, s.pvalue))
    else:
        print('\n（未提供 --trend data/analysis.json，略過整合診斷）')


if __name__ == '__main__':
    main()
