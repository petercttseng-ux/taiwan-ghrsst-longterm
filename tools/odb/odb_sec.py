import numpy as np,pandas as pd,json
U='/mnt/user-data/uploads/衛星水溫圖/'
c=pd.read_csv(U+'ctd_grid15moa/ctd_grid15moa.csv'); c.columns=['lon','lat','p','t','tsd','s','ssd','sig','sigsd','period','item']
a=pd.read_csv(U+'sadcp_grid15moa/sadcp_grid15moa.csv'); a.columns=['lon','lat','z','u','usd','v','vsd','dir','spd','period','item']
rows=[24.75,25.0,25.25,25.5,25.75,26.0,26.25]
P=[13,14,15,16,17,18]
out={'rows':rows,'ctd':{},'adcp':{}}
for per in P:
    for la in rows:
        q=c[(c.period==per)&(np.isclose(c.lat,la))&(c.lon>=120.5)&(c.lon<=124.0)&(c.p<=300)]
        out['ctd'][f'{per}_{la}']=[[float(x),int(p),round(float(t),2),round(float(s),3)] for x,p,t,s in zip(q.lon,q.p,q.t,q.s)]
        q=a[(a.period==per)&(np.isclose(a.lat,la))&(a.lon>=120.5)&(a.lon<=124.0)&(a.z<=300)]
        out['adcp'][f'{per}_{la}']=[[float(x),int(z),round(float(u),3),round(float(v),3)] for x,z,u,v in zip(q.lon,q.z,q.u,q.v)]
# Kuroshio axis: for each lat row 24.0..26.5 the lon of max near-surface speed within 121.5-124.5
G=pd.read_csv('odb_int.csv')
ax={}
for per in P+[0]:
    g=G[(G.period==per)&G.spd0.notna()&(G.lon>=121.5)]
    pts=[]
    for la in np.arange(22.5,27.51,0.25):
        r=g[np.isclose(g.lat,la)]
        if len(r)==0: continue
        k=r.spd0.idxmax()
        if r.spd0.max()>=0.5: pts.append([round(float(r.lon[k]),2),round(float(la),2),round(float(r.spd0.max()),2)])
    ax[per]=pts
out['axis']=ax
json.dump(out,open('odb_sec.json','w'))
print({k:len(v) for k,v in list(out['ctd'].items())[:7]}, ax[13][:8], ax[15][:8])
