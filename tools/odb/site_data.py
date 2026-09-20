import numpy as np,pandas as pd,json,math
U='/mnt/user-data/uploads/衛星水溫圖/'
G=pd.read_csv('odb_int.csv')
LA=sorted(G.lat.unique()); LO=sorted(G.lon.unique()); P=[13,14,15,16,17,18,0]
VARS=['T0','S0','T100','S100','Tb','Sb','pb','dT50','N2max','MLD','u0','v0','spd0','spd100','spdb','eke0','shear','vort','div','dmax','sst','ffreq','eff','dist']
F={}
for v in VARS:
    F[v]={}
    for p in P:
        g=G[G.period==p].set_index(['lat','lon'])[v].unstack().reindex(index=LA,columns=LO).values
        F[v][p]=[None if not np.isfinite(x) else round(float(x),5 if v in('N2max',) else 3) for x in g.ravel()]
foot=G[G.period==0].set_index(['lat','lon']).foot.unstack().reindex(index=LA,columns=LO).values.ravel()
c=pd.read_csv(U+'ctd_grid15moa/ctd_grid15moa.csv'); c.columns=['lon','lat','p','t','tsd','s','ssd','sig','sigsd','period','item']
c=c[(c.lat>=22.2)&(c.lat<=27.8)&(c.lon>=119.2)&(c.lon<=124.8)&(c.p<=300)&c.period.isin(P)]
a=pd.read_csv(U+'sadcp_grid15moa/sadcp_grid15moa.csv'); a.columns=['lon','lat','z','u','usd','v','vsd','dir','spd','period','item']
a=a[(a.lat>=22.2)&(a.lat<=27.8)&(a.lon>=119.2)&(a.lon<=124.8)&(a.z<=300)&a.period.isin(P)]
prof={'ctd':{},'adcp':{}}
for (p,lo,la),q in c.groupby(['period','lon','lat']):
    q=q.sort_values('p'); prof['ctd'][f'{p}|{lo:.2f}|{la:.2f}']=[[int(x),round(t,2),round(s,3)] for x,t,s in zip(q.p,q.t,q.s)]
for (p,lo,la),q in a.groupby(['period','lon','lat']):
    q=q.sort_values('z'); prof['adcp'][f'{p}|{lo:.2f}|{la:.2f}']=[[int(x),round(u,3),round(v,3)] for x,u,v in zip(q.z,q.u,q.v)]
O={'odb':dict(lat=[float(x) for x in LA],lon=[float(x) for x in LO],periods=P,f=F,foot=[float(x) for x in foot]),'prof':prof,
   'axis':json.load(open('odb_sec.json'))['axis'],
   'r1':json.load(open('res_odb1.json')),'r2':json.load(open('res_odb2.json'))}
V=json.load(open('data.json'))
if 'pref' in V['pref']: V['pref']=V['pref']['pref']
O['vdr']=V
def san(o):
    if isinstance(o,float): return None if not math.isfinite(o) else o
    if isinstance(o,dict): return {str(k):san(v) for k,v in o.items()}
    if isinstance(o,(list,tuple)): return [san(v) for v in o]
    return o
s=json.dumps(san(O),ensure_ascii=False,separators=(',',':'),allow_nan=False)
open('/home/claude/site/ghrsst/data/odb_fishery.json','w').write(s); print(len(s)/1e6,'MB')
