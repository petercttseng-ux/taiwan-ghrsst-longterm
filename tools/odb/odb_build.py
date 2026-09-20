import numpy as np,pandas as pd,warnings,json; warnings.filterwarnings('ignore')
U='/mnt/user-data/uploads/衛星水溫圖/'
LA=np.arange(22.25,27.76,0.25); LO=np.arange(119.25,124.76,0.25)
PER={13:'冬',14:'春',15:'夏',16:'秋',17:'東北季風',18:'西南季風',0:'全年'}
PM={13:[12,1,2],14:[3,4,5],15:[6,7,8],16:[9,10,11],17:[10,11,12,1,2,3],18:[5,6,7,8,9],0:list(range(1,13))}
c=pd.read_csv(U+'ctd_grid15moa/ctd_grid15moa.csv'); c.columns=['lon','lat','p','t','tsd','s','ssd','sig','sigsd','period','item']
c=c[(c.lat>=22.2)&(c.lat<=27.8)&(c.lon>=119.2)&(c.lon<=124.8)]
a=pd.read_csv(U+'sadcp_grid15moa/sadcp_grid15moa.csv'); a.columns=['lon','lat','z','u','usd','v','vsd','dir','spd','period','item']
a=a[(a.lat>=22.2)&(a.lat<=27.8)&(a.lon>=119.2)&(a.lon<=124.8)]
def interp(prof_p,prof_x,z):
    if prof_p.min()>z or prof_p.max()<z: return np.nan
    return float(np.interp(z,prof_p,prof_x))
rows=[]
for (lo,la,per),q in c.groupby(['lon','lat','period']):
    q=q.sort_values('p'); p=q.p.values.astype(float); t=q.t.values; s=q.s.values; sg=q.sig.values
    if p.min()>10: continue
    r=dict(lon=lo,lat=la,period=per,T0=t[0],S0=s[0],pb=p[-1],Tb=t[-1],Sb=s[-1],sigb=sg[-1],T50=interp(p,t,50),S50=interp(p,s,50),T100=interp(p,t,100),S100=interp(p,s,100),Tsd0=q.tsd.values[0])
    zz=min(50,p[-1]); r['dT50']=t[0]-interp(p,t,zz) if p[-1]>=20 else np.nan
    # N2 max (1/s2) from sigma-t
    if len(p)>=3:
        dz=np.diff(p); n2=9.81/1025*np.diff(sg)/np.where(dz>0,dz,np.nan); r['N2max']=float(np.nanmax(n2)); k=int(np.nanargmax(n2)); r['zN2']=float((p[k]+p[k+1])/2)
    t10=interp(p,t,10) if p.max()>=10 else t[0]
    below=np.where((p>10)&(t<t10-0.5))[0]
    r['MLD']=float(p[below[0]]) if len(below) else float(p[-1])
    r['mld_bottom']=int(len(below)==0)
    rows.append(r)
C=pd.DataFrame(rows)
rows=[]
for (lo,la,per),q in a.groupby(['lon','lat','period']):
    q=q.sort_values('z'); z=q.z.values.astype(float)
    r=dict(lon=lo,lat=la,period=per,z0=z[0],u0=q.u.values[0],v0=q.v.values[0],spd0=q.spd.values[0],eke0=0.5*(q.usd.values[0]**2+q.vsd.values[0]**2),zb=z[-1],ub=q.u.values[-1],vb=q.v.values[-1],spdb=q.spd.values[-1])
    r['u100']=interp(z,q.u.values,100); r['v100']=interp(z,q.v.values,100); r['spd100']=np.hypot(r['u100'],r['v100'])
    r['shear']=np.hypot(r['u0']-r['ub'],r['v0']-r['vb'])/max(z[-1]-z[0],10)*1000 if z[-1]-z[0]>=20 else np.nan  # (m/s)/km
    rows.append(r)
A=pd.DataFrame(rows)
print(len(C),len(A)); print(A.z0.describe())
G=pd.MultiIndex.from_product([LO.round(2),LA.round(2),list(PM)],names=['lon','lat','period']).to_frame(index=False)
for X in (C,A): X['lon']=X.lon.round(2); X['lat']=X.lat.round(2)
G=G.merge(C,on=['lon','lat','period'],how='left').merge(A,on=['lon','lat','period'],how='left')
# vorticity/divergence of near-surface currents per period (1e-6 s-1)
G['vort']=np.nan; G['div']=np.nan
for per in PM:
    g=G[G.period==per].set_index(['lat','lon'])
    uu=g.u0.unstack().reindex(index=LA.round(2),columns=LO.round(2)).values; vv=g.v0.unstack().reindex(index=LA.round(2),columns=LO.round(2)).values
    dy=0.25*111.2e3; dx=dy*np.cos(np.radians(LA))[:,None]
    dvdx=np.gradient(vv,axis=1)/dx; dudy=np.gradient(uu,axis=0)/dy; dudx=np.gradient(uu,axis=1)/dx; dvdy=np.gradient(vv,axis=0)/dy
    vo=(dvdx-dudy)*1e6; dv=(dudx+dvdy)*1e6
    idx=G.index[G.period==per]
    key=pd.MultiIndex.from_frame(G.loc[idx,['lat','lon']])
    VO=pd.DataFrame(vo,index=LA.round(2),columns=LO.round(2)).stack(); DV=pd.DataFrame(dv,index=LA.round(2),columns=LO.round(2)).stack()
    G.loc[idx,'vort']=VO.reindex(key).values; G.loc[idx,'div']=DV.reindex(key).values
# depth proxy: max observed depth across periods (CTD pb, ADCP zb)
dp=pd.concat([C[['lon','lat','pb']].rename(columns={'pb':'d'}),A[['lon','lat','zb']].rename(columns={'zb':'d'})]).groupby(['lon','lat']).d.max().rename('dmax')
G=G.merge(dp.reset_index(),on=['lon','lat'],how='left')
# SST digitized + front freq + effort per period
m=np.load('sst_monthly.npz'); months=list(m['months']); SST=m['sst']; FF=m['ffreq']; GR=m['grad']
mon=np.array([int(k[5:]) for k in months]); yr=np.array([int(k[:4]) for k in months])
E=np.load('panel.npz')['E']; foot=np.load('panel.npz')['foot']; dist=np.load('dist05.npy')
def box(arr2,la,lo,fn=np.nanmean):
    iy=int(round((la-0.125-22)/0.05)); ix=int(round((lo-0.125-119)/0.05))
    sub=arr2[max(iy,0):iy+5,max(ix,0):ix+5]
    return fn(sub) if sub.size else np.nan
out=[]
for per,ms in PM.items():
    ks=np.isin(mon,ms); ke=ks&(yr>=2021)&(yr<=2024); ksst=ks&(yr>=2019)&(yr<=2024)
    s=np.nanmean(SST[ksst],0); f=np.nanmean(FF[ksst],0); gr=np.nanmean(GR[ksst],0); e=E[ke].sum(0)/ke.sum()
    for la in LA.round(2):
        for lo in LO.round(2):
            out.append(dict(lon=lo,lat=la,period=per,sst=box(s,la,lo),ffreq=box(f,la,lo),grad=box(gr,la,lo),eff=box(e,la,lo,np.nansum),foot=box(foot.astype(float),la,lo,np.nanmean),dist=box(dist,la,lo)))
G=G.merge(pd.DataFrame(out),on=['lon','lat','period'],how='left')
G['pname']=G.period.map(PER)
G.to_csv('odb_int.csv',index=False)
print(G.groupby('period')[['T0','Tb','spd0','sst','eff']].count())
print(G[G.period==0].describe().T[['count','mean','min','max']].round(3))
