#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build_ghrsst.py — 由 fetch_ghrsst.py 產出的年度 .npz 計算全部長期統計，
輸出儀表板所需的 data/analysis.json（與瀏覽器端建置結果格式完全相同）。

演算法定義（與 js/analysis.js 逐項對應，可互相驗證）：
  * 日序氣候值／90 百分位門檻：±5 日視窗 × 基期各年，再沿日序 31 日環狀移動平均（Hobday et al. 2016）
  * 海洋熱浪：連續 ≥5 日超過門檻，間隔 ≤2 日合併；分級依 Hobday et al. (2018)
  * 趨勢：年平均（有效日數 >300）之 Theil–Sen 中位斜率 + Mann–Kendall 檢定
  * 區域平均：cos(緯度) 面積加權

用法：
    python3 build_ghrsst.py --raw raw/ --src oisst --base 1991 2020 --out data/
"""
import argparse, base64, datetime as dt, glob, json, os, sys
import numpy as np

NODATA = -32768
SCALE = 0.01
EPOCH = dt.date(1970, 1, 1)

SRC_LABEL = {
    'oisst': 'NOAA OISST v2.1（AVHRR-only，0.25°）',
    'mur': 'GHRSST MUR L4（JPL，0.01° → 取樣 0.25°）',
    'crw': 'NOAA Coral Reef Watch CoralTemp v3.1（5 km → 取樣 0.25°）',
    'fri': '水試所每日衛星海溫圖數位化（G1SST／MUR，約每 5 日一幅、線性內插為逐日，0.25°）',
}

REGIONS = [
    dict(id='all',    zh='臺灣周邊全域',     en='Full domain',          box=[116.0, 128.0, 18.0, 32.0]),
    dict(id='nts',    zh='臺灣海峽北部',     en='N. Taiwan Strait',     box=[119.0, 121.0, 24.5, 26.0]),
    dict(id='sts',    zh='臺灣海峽南部',     en='S. Taiwan Strait',     box=[118.5, 120.5, 22.5, 24.5]),
    dict(id='penghu', zh='澎湖海域',         en='Penghu',               box=[119.0, 120.0, 23.0, 24.0]),
    dict(id='ne',     zh='東北部海域',       en='NE off Taiwan',        box=[121.5, 123.5, 25.0, 26.5]),
    dict(id='east',   zh='東部海域(黑潮)',   en='E. Taiwan / Kuroshio', box=[121.5, 123.0, 22.5, 24.5]),
    dict(id='sw',     zh='西南部海域(高屏)', en='SW off Taiwan',        box=[119.5, 120.5, 21.5, 22.5]),
    dict(id='bashi',  zh='巴士海峽',         en='Bashi Channel',        box=[120.5, 122.0, 20.5, 22.0]),
    dict(id='nscs',   zh='南海北部(東沙)',   en='N. South China Sea',   box=[116.5, 118.5, 19.5, 21.5]),
    dict(id='secs',   zh='東海南部',         en='S. East China Sea',    box=[122.0, 126.0, 27.5, 30.5]),
    dict(id='nwp',    zh='西北太平洋',       en='NW Pacific',           box=[124.0, 127.0, 22.5, 25.5]),
]

SCALES = {'trendP': 10000, 'phase': 10, 'mhwDays': 10, 'mhwDaysEarly': 10, 'mhwDaysLate': 10}


# ---------------------------------------------------------------- 基本工具
def dayno(d):
    return (d - EPOCH).days


def date_of(n):
    return EPOCH + dt.timedelta(days=int(n))


def doy_of(n):
    d = date_of(n)
    return (d - dt.date(d.year, 1, 1)).days + 1


def q16(a, sc):
    o = np.full(a.shape, NODATA, dtype='int16')
    ok = np.isfinite(a)
    v = np.round(a[ok] * sc)
    v = np.clip(v, -32767, 32767)
    o[ok] = v.astype('int16')
    return base64.b64encode(o.tobytes()).decode('ascii')


# ---------------------------------------------------------------- 載入
def load_cube(rawdir, src):
    files = sorted(glob.glob(os.path.join(rawdir, '%s_*.npz' % src)))
    if not files:
        sys.exit('找不到 %s/%s_*.npz；請先執行 fetch_ghrsst.py' % (rawdir, src))
    days, blocks, lat, lon = [], [], None, None
    for f in files:
        z = np.load(f)
        days.append(z['days'])
        blocks.append(z['vals'])
        lat, lon = z['lat'], z['lon']
    days = np.concatenate(days)
    vals = np.concatenate(blocks, axis=0)
    nlat, nlon = vals.shape[1], vals.shape[2]
    d0, d1 = int(days.min()), int(days.max())
    nd = d1 - d0 + 1
    cube = np.full((nd, nlat * nlon), NODATA, dtype='int16')
    cube[days - d0] = vals.reshape(len(days), -1)
    return cube, d0, nd, nlat, nlon, lat, lon


# ---------------------------------------------------------------- 氣候場
def climatology(cube, d0, nd, base, win=5):
    ncell = cube.shape[1]
    doy = np.array([doy_of(d0 + t) for t in range(nd)])
    yr = np.array([date_of(d0 + t).year for t in range(nd)])
    idx = [[] for _ in range(367)]
    for t in range(nd):
        if not (base[0] <= yr[t] <= base[1]):
            continue
        for w in range(-win, win + 1):
            k = doy[t] + w
            k = k + 366 if k < 1 else (k - 366 if k > 366 else k)
            idx[k].append(t)
    clim = np.full((366, ncell), np.nan, dtype='float32')
    thr = np.full((366, ncell), np.nan, dtype='float32')
    for d in range(1, 367):
        ii = np.asarray(idx[d], dtype=np.int64)
        if ii.size == 0:
            continue
        sub = cube[ii].astype('float32')
        sub[sub == NODATA] = np.nan
        sub *= SCALE
        n = np.sum(np.isfinite(sub), axis=0)
        good = n >= 10
        if not good.any():
            continue
        with np.errstate(invalid='ignore'):
            m = np.nanmean(sub, axis=0)
            p = np.nanpercentile(sub, 90, axis=0)
        clim[d - 1, good] = m[good]
        thr[d - 1, good] = p[good]
    return smooth_doy(clim), smooth_doy(thr), doy, yr


def smooth_doy(a, w=31):
    h = (w - 1) // 2
    idx = (np.arange(366)[:, None] + np.arange(-h, h + 1)[None, :]) % 366
    with np.errstate(invalid='ignore'):
        return np.nanmean(a[idx], axis=1).astype('float32')


# ---------------------------------------------------------------- 統計
def theil_sen(x, y):
    ok = np.isfinite(y)
    if ok.sum() < 10:
        return np.nan, np.nan
    xx, yy = x[ok], y[ok]
    n = len(xx)
    i, j = np.triu_indices(n, 1)
    sl = (yy[j] - yy[i]) / (xx[j] - xx[i])
    slope = float(np.median(sl))
    s = float(np.sum(np.sign(yy[j] - yy[i])))
    var = n * (n - 1) * (2 * n + 5) / 18.0
    z = (s - 1) / np.sqrt(var) if s > 0 else ((s + 1) / np.sqrt(var) if s < 0 else 0.0)
    from math import erfc, sqrt
    p = erfc(abs(z) / sqrt(2))
    return slope, p


def detect_mhw(v, clim, thr, d0, min_dur=5, max_gap=2):
    n = len(v)
    over = np.isfinite(v) & np.isfinite(thr) & (v > thr)
    evs, s = [], None
    for i in range(n):
        if over[i] and s is None:
            s = i
        if (not over[i] or i == n - 1) and s is not None:
            e = i if over[i] else i - 1
            if e - s + 1 >= min_dur:
                evs.append([s, e])
            s = None
    mg = []
    for a, b in evs:
        if mg and a - mg[-1][1] - 1 <= max_gap:
            mg[-1][1] = b
        else:
            mg.append([a, b])
    flag = np.zeros(n, dtype='uint8')
    out = []
    for a, b in mg:
        flag[a:b + 1] = 1
        d = v[a:b + 1] - clim[a:b + 1]
        rng = thr[a:b + 1] - clim[a:b + 1]
        with np.errstate(invalid='ignore', divide='ignore'):
            ratio = np.where(rng > 0, (v[a:b + 1] - clim[a:b + 1]) / rng, np.nan)
        cat = int(np.clip(np.floor(np.nanmax(ratio)) if np.isfinite(ratio).any() else 1, 1, 4))
        out.append(dict(s=str(date_of(d0 + a)), e=str(date_of(d0 + b)), i0=a, i1=b,
                        dur=b - a + 1,
                        imax=round(float(np.nanmax(d)), 2),
                        imean=round(float(np.nanmean(d)), 2),
                        icum=round(float(np.nansum(d)), 1),
                        cat=cat))
    return out, flag


# ---------------------------------------------------------------- 主流程
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--raw', default='raw')
    ap.add_argument('--src', default='crw')
    ap.add_argument('--base', nargs=2, type=int, default=[1991, 2020])
    ap.add_argument('--out', default='data')
    a = ap.parse_args()

    cube, d0, nd, nlat, nlon, lat, lon = load_cube(a.raw, a.src)
    ncell = nlat * nlon
    lat0, lon0 = float(lat[0]), float(lon[0])
    dd = float(round(lat[1] - lat[0], 4)) if nlat > 1 else 0.25
    print('立方：%d 日 × %d×%d（%s – %s）' % (nd, nlat, nlon, date_of(d0), date_of(d0 + nd - 1)))

    clim, thr, doy, yr = climatology(cube, d0, nd, a.base)
    print('氣候場完成（基期 %d–%d）' % tuple(a.base))

    yr0, yr1 = date_of(d0).year, date_of(d0 + nd - 1).year
    if doy_of(d0) > 15:
        yr0 += 1
    if doy_of(d0 + nd - 1) < 350:
        yr1 -= 1
    years = np.arange(yr0, yr1 + 1)
    ny = len(years)

    F = np.where(cube == NODATA, np.nan, cube * SCALE).astype('float32')

    # --- 逐格統計 ---
    cells = {}
    with np.errstate(invalid='ignore'):
        cells['mean'] = np.nanmean(F, axis=0)
    annual = np.full((ny, ncell), np.nan, dtype='float32')
    for k, y in enumerate(years):
        sel = yr == y
        if sel.sum() < 300:
            continue
        sub = F[sel]
        n = np.sum(np.isfinite(sub), axis=0)
        with np.errstate(invalid='ignore'):
            m = np.nanmean(sub, axis=0)
        annual[k] = np.where(n > 300, m, np.nan)
    trend = np.full(ncell, np.nan, dtype='float32')
    trendP = np.full(ncell, np.nan, dtype='float32')
    xs = years.astype('float64')
    for c in range(ncell):
        sl, p = theil_sen(xs, annual[:, c].astype('float64'))
        trend[c] = sl * 10 if np.isfinite(sl) else np.nan
        trendP[c] = p
    cells['trend'] = trend
    cells['trendP'] = trendP
    with np.errstate(invalid='ignore'):
        cells['sdInter'] = np.nanstd(annual, axis=0)
        cells['amp'] = np.nanmax(clim, axis=0) - np.nanmin(clim, axis=0)
        cells['phase'] = (np.nanargmax(np.where(np.isfinite(clim), clim, -1e9), axis=0) + 1).astype('float32')
    cells['phase'][~np.isfinite(cells['amp'])] = np.nan

    thr_by_day = thr[doy - 1]                    # (nd, ncell)
    over = np.isfinite(F) & np.isfinite(thr_by_day) & (F > thr_by_day)
    inrange = (yr >= yr0) & (yr <= yr1)
    half = yr0 + ny // 2
    for name, sel in (('mhwDays', inrange),
                      ('mhwDaysEarly', inrange & (yr < half)),
                      ('mhwDaysLate', inrange & (yr >= half))):
        valid = np.sum(np.isfinite(F[sel]) & np.isfinite(thr_by_day[sel]), axis=0)
        cnt = np.sum(over[sel], axis=0)
        with np.errstate(invalid='ignore', divide='ignore'):
            cells[name] = np.where(valid > 300, cnt / np.maximum(valid, 1) * 365.25, np.nan).astype('float32')
    print('逐格趨勢與熱浪統計完成')

    # --- 月平均立方 ---
    ym = np.array([date_of(d0 + t).year * 12 + date_of(d0 + t).month - 1 for t in range(nd)])
    keys = np.unique(ym)
    labels = ['%04d-%02d' % (k // 12, k % 12 + 1) for k in keys]
    mvals = np.full((len(keys), ncell), np.nan, dtype='float32')
    for i, k in enumerate(keys):
        sub = F[ym == k]
        n = np.sum(np.isfinite(sub), axis=0)
        with np.errstate(invalid='ignore'):
            mvals[i] = np.where(n > 10, np.nanmean(sub, axis=0), np.nan)
    keep = np.array([np.isfinite(mvals[i]).sum() > ncell * 0.2 for i in range(len(keys))])
    keys, labels, mvals = keys[keep], [l for l, k in zip(labels, keep) if k], mvals[keep]

    mclim = np.full((12, ncell), np.nan, dtype='float32')
    for mo in range(12):
        sel = np.array([(k % 12) == mo and a.base[0] <= (k // 12) <= a.base[1] for k in keys])
        if sel.sum() == 0:
            continue
        sub = mvals[sel]
        n = np.sum(np.isfinite(sub), axis=0)
        with np.errstate(invalid='ignore'):
            mclim[mo] = np.where(n > 3, np.nanmean(sub, axis=0), np.nan)

    # --- Hovmöller ---
    F3 = F.reshape(nd, nlat, nlon)
    with np.errstate(invalid='ignore'):
        zon = np.nanmean(F3, axis=2).astype('float32')      # (nd, nlat)
        mer = np.nanmean(F3, axis=1).astype('float32')      # (nd, nlon)

    def doyclim(d2, nb):
        out = np.full((366, nb), np.nan, dtype='float32')
        sel = (yr >= a.base[0]) & (yr <= a.base[1])
        for d in range(366):
            s = sel & (doy == d + 1)
            if s.sum() == 0:
                continue
            with np.errstate(invalid='ignore'):
                out[d] = np.nanmean(d2[s], axis=0)
        return smooth_doy(out)

    zonClim, merClim = doyclim(zon, nlat), doyclim(mer, nlon)

    def to_pentad(d2, nb):
        npd = int(np.ceil(nd / 5))
        pad = npd * 5 - nd
        x = np.concatenate([d2, np.full((pad, nb), np.nan, dtype='float32')]) if pad else d2
        with np.errstate(invalid='ignore'):
            return np.nanmean(x.reshape(npd, 5, nb), axis=1).astype('float32'), npd

    zonP, npd = to_pentad(zon, nlat)
    merP, _ = to_pentad(mer, nlon)

    # --- 區域序列 ---
    jj, ii = np.meshgrid(np.arange(nlat), np.arange(nlon), indexing='ij')
    LA = lat0 + jj * dd
    LO = lon0 + ii * dd
    Wt = np.cos(np.radians(LA)).ravel().astype('float32')

    series, mhw, ann = {}, {}, {}
    mhw_flag_all = None
    for r in REGIONS:
        b = r['box']
        mask = ((LO >= b[0]) & (LO <= b[1]) & (LA >= b[2]) & (LA <= b[3])).ravel()
        w = np.where(mask, Wt, 0.0)
        ok = np.isfinite(F)
        num = np.nansum(np.where(ok, F, 0) * w, axis=1)
        den = (ok * w).sum(axis=1)
        v = np.where(den > 0, num / den, np.nan).astype('float32')
        cnum = np.nansum(np.where(np.isfinite(clim), clim, 0) * w, axis=1)
        cden = (np.isfinite(clim) * w).sum(axis=1)
        cv = np.where(cden > 0, cnum / cden, np.nan).astype('float32')
        tnum = np.nansum(np.where(np.isfinite(thr), thr, 0) * w, axis=1)
        tden = (np.isfinite(thr) * w).sum(axis=1)
        tv = np.where(tden > 0, tnum / tden, np.nan).astype('float32')
        climD, thrD = cv[doy - 1], tv[doy - 1]
        ano = (v - climD).astype('float32')
        ev, flag = detect_mhw(v, climD, thrD, d0)
        series[r['id']] = dict(v=q16(v, 100), ano=q16(ano, 100), clim=q16(cv, 100), thr=q16(tv, 100))
        mhw[r['id']] = ev
        av = []
        for y in years:
            s = (yr == y) & np.isfinite(v)
            av.append(float(v[s].mean()) if s.sum() > 300 else None)
        ann[r['id']] = dict(years=years.tolist(), vals=av)
        if r['id'] == 'all':
            mhw_flag_all = flag
    print('區域序列與熱浪事件完成（全域 %d 起）' % len(mhw['all']))

    md_years, md_vals = [], []
    for y in years:
        s = yr == y
        md_years.append(int(y))
        md_vals.append(int(mhw_flag_all[s].sum()) if s.sum() > 300 else None)

    out = dict(
        meta=dict(src=a.src, srcLabel=SRC_LABEL.get(a.src, a.src),
                  t0=str(date_of(d0)), t1=str(date_of(d0 + nd - 1)),
                  day0=int(d0), nday=int(nd), ncell=int(ncell),
                  base=list(a.base), yr0=int(yr0), yr1=int(yr1),
                  generated=dt.datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ')),
        regions=REGIONS,
        grid=dict(nlon=int(nlon), nlat=int(nlat), lon0=lon0, lat0=lat0, d=dd),
        monthly=dict(labels=labels, vals=q16(mvals.ravel(), 100), clim=q16(mclim.ravel(), 100)),
        cells={k: q16(v, SCALES.get(k, 100)) for k, v in cells.items()},
        series=series, mhw=mhw, ann=ann,
        mhwDaysByYear=dict(years=md_years, vals=md_vals),
        hov=dict(np=int(npd), zonP=q16(zonP.ravel(), 100), merP=q16(merP.ravel(), 100),
                 zonClim=q16(zonClim.ravel(), 100), merClim=q16(merClim.ravel(), 100)),
    )
    os.makedirs(a.out, exist_ok=True)
    p = os.path.join(a.out, 'analysis.json')
    with open(p, 'w', encoding='utf-8') as fh:
        json.dump(out, fh, ensure_ascii=False, separators=(',', ':'))
    print('寫出 %s（%.1f MB）' % (p, os.path.getsize(p) / 1048576))


if __name__ == '__main__':
    sys.exit(main())
