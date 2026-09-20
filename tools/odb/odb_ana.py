import numpy as np,pandas as pd,json,warnings; warnings.filterwarnings('ignore')
from scipy import stats
rng=np.random.default_rng(3)
G=pd.read_csv('odb_int.csv')
V={'sst':'衛星 SST','ffreq':'鋒面出現頻率','T0':'表層水溫(CTD)','S0':'表層鹽度','T100':'100 m 水溫','S100':'100 m 鹽度','Tb':'底層水溫','Sb':'底層鹽度','dT50':'表層−50 m 溫差','N2max':'最大浮力頻率 N²','MLD':'混合層深度','spd0':'表層流速','spd100':'100 m 流速','spdb':'近底流速','eke0':'流速變異 EKE','shear':'垂直流速剪切','vort':'相對渦度','div':'水平散度','dmax':'觀測水深下限','dist':'離岸距離'}
SEAS=[13,14,15,16]; PN={13:'冬',14:'春',15:'夏',16:'秋',17:'東北季風',18:'西南季風',0:'全年'}
D=G[G.foot>0].copy(); D['leff']=np.log1p(D.eff)
# Kuroshio core distance: nodes with spd0>=0.6 in same period
D['dks']=np.nan
for p in PN:
    k=G[(G.period==p)&(G.spd0>=0.6)]
    if len(k)==0: continue
    idx=D.period==p
    dd=np.sqrt(((D.loc[idx,'lat'].values[:,None]-k.lat.values[None])*111.2)**2+((D.loc[idx,'lon'].values[:,None]-k.lon.values[None])*111.2*np.cos(np.radians(25)))**2)
    D.loc[idx,'dks']=dd.min(1)
V['dks']='距黑潮主流距離'
R={'vars':V,'periods':PN}
# ---- Clifford et al. 1989 effective N via Moran correlograms ----
def moran_corr(x,lat,lon,bins):
    z=x-x.mean(); dd=np.sqrt(((lat[:,None]-lat[None])*111.2)**2+((lon[:,None]-lon[None])*111.2*np.cos(np.radians(25)))**2)
    I=[];N=[]
    for a,b in zip(bins[:-1],bins[1:]):
        W=((dd>a)&(dd<=b)).astype(float); np.fill_diagonal(W,0); s=W.sum()
        if s==0: I.append(0);N.append(0);continue
        I.append(len(x)/s*(z@W@z)/(z@z)); N.append(s)
    return np.array(I),np.array(N)
def clifford(x,y,lat,lon):
    bins=np.array([0,30,60,90,120,160,220,300])
    Ix,Nk=moran_corr(x,lat,lon,bins); Iy,_=moran_corr(y,lat,lon,bins)
    n=len(x); var=(1/n**2)*np.sum(Nk*Ix*Iy)+1/n
    ne=max(3,1+1/var) if var>0 else n
    return min(ne,n)
def srho(x,y,lat,lon):
    k=np.isfinite(x)&np.isfinite(y)
    if k.sum()<12 or np.nanstd(x[k])==0: return None
    xr=stats.rankdata(x[k]); yr=stats.rankdata(y[k]); r=np.corrcoef(xr,yr)[0,1]
    ne=clifford(xr,yr,lat[k],lon[k]); t=r*np.sqrt((ne-2)/max(1e-9,1-r*r)); p=2*stats.t.sf(abs(t),ne-2)
    return dict(r=float(r),p=float(p),n=int(k.sum()),neff=float(ne))
# 1) selectivity & correlation matrices
sel={};cor={}
for v in V:
    sel[v]={};cor[v]={}
    for p in [13,14,15,16,17,18,0]:
        d=D[D.period==p]; x=d[v].values; w=d.eff.values; k=np.isfinite(x)
        if k.sum()<10 or w[k].sum()==0: continue
        mu=np.average(x[k],weights=w[k]); ma=x[k].mean(); sd=x[k].std()
        sel[v][p]=dict(use=float(mu),avail=float(ma),sd=float(sd),si=float((mu-ma)/sd) if sd>0 else None)
        cor[v][p]=srho(x,d.leff.values,d.lat.values,d.lon.values)
R['sel']=sel;R['cor']=cor
for v in V: print(v,{PN[p]:(round(s['si'],2) if s['si'] is not None else None, round(cor[v][p]['r'],2) if cor[v].get(p) else None, round(cor[v][p]['p'],3) if cor[v].get(p) else None) for p,s in sel[v].items()})
json.dump(R,open('res_odb1.json','w'),ensure_ascii=False,default=float)
D.to_csv('odb_dom.csv',index=False)
