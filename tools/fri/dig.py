import numpy as np
from PIL import Image
from scipy.spatial import cKDTree
LAT1,LAT0,LON0,LON1=28.0,22.0,119.0,125.0
RES=0.05
def georef(a):
    # detect dashed grid lines (dark pixels) columns/rows inside plot
    g=a.sum(2)<150
    colc=g[60:1430].sum(0); rowc=g[:,90:1260].sum(1)
    xs=[]; 
    for lon in [118,120,122,124,126]:
        x0=int(75+(lon-116)*100); w=np.arange(x0-8,x0+9); xs.append(w[np.argmax(colc[w])])
    ys=[]
    for lat in [30,28,26,24,22,20]:
        y0=int(48+(32-lat)*100); w=np.arange(y0-8,y0+9); ys.append(w[np.argmax(rowc[w])])
    px=np.polyfit([118,120,122,124,126],xs,1); py=np.polyfit([30,28,26,24,22,20],ys,1)
    return px,py,xs,ys
def colorbar(a):
    col=a[:,115]; sat=(col.max(1)-col.min(1))>40
    y0=int(np.where(sat[200:900])[0].min())+200; y=y0
    while sat[y]: y+=1
    y1=y-1; h=y1-y0+1
    vmax=35.0 if h>515 else 30.0
    band=a[y0+2:y1-1, 104:126].reshape(y1-y0-3,-1,3)
    cols=np.median(band,axis=1)
    yy=np.arange(y0+2,y1-1)
    vals=vmax-(yy-y0)/(y1-y0)*(vmax+2.0)
    return cols,vals,vmax,h
def decode(path):
    a=np.array(Image.open(path).convert('RGB')).astype(float)
    cols,vals,vmax,h=colorbar(a)
    px,py,xs,ys=georef(a.astype(int))
    tree=cKDTree(cols)
    ny=int(round((LAT1-LAT0)/RES)); nx=int(round((LON1-LON0)/RES))
    out=np.full((ny,nx),np.nan,np.float32); frac=np.zeros((ny,nx),np.float32)
    # pixel window
    xa=int(np.floor(np.polyval(px,LON0))); xb=int(np.ceil(np.polyval(px,LON1)))
    ya=int(np.floor(np.polyval(py,LAT1))); yb=int(np.ceil(np.polyval(py,LAT0)))
    sub=a[ya:yb+1,xa:xb+1]
    d,idx=tree.query(sub.reshape(-1,3))
    sat=(sub.max(2)-sub.min(2)).reshape(-1)>100
    v=np.where((d<18)&sat,vals[idx],np.nan).reshape(sub.shape[:2])
    YY,XX=np.mgrid[ya:yb+1,xa:xb+1]
    lon=(XX-px[1])/px[0]; lat=(YY-py[1])/py[0]
    iy=np.floor((lat-LAT0)/RES).astype(int); ix=np.floor((lon-LON0)/RES).astype(int)
    ok=(iy>=0)&(iy<ny)&(ix>=0)&(ix<nx)
    k=(iy*nx+ix)[ok]; vv=v[ok]
    order=np.argsort(k,kind='stable'); k=k[order]; vv=vv[order]
    bounds=np.searchsorted(k,np.arange(ny*nx+1))
    flat=out.reshape(-1); ff=frac.reshape(-1)
    for c in range(ny*nx):
        s=vv[bounds[c]:bounds[c+1]]
        if len(s)==0: continue
        s2=s[np.isfinite(s)]
        ff[c]=len(s2)/len(s)
        if len(s2)>=max(3,0.3*len(s)):
            m=np.median(s2); s3=s2[np.abs(s2-m)<1.0]
            flat[c]=np.mean(s3) if len(s3) else m
    return out,frac,dict(vmax=vmax,cbh=h,px=px.tolist(),py=py.tolist())

from numpy.lib.stride_tricks import sliding_window_view
def nanmed5(o):
    p=np.pad(o,2,mode='edge'); w=sliding_window_view(p,(5,5))
    return np.nanmedian(w.reshape(o.shape[0],o.shape[1],25),axis=2)
def clean(o):
    o=o.copy(); orig=np.isfinite(o)
    for it in range(2):
        med=nanmed5(o)
        bad=(o-med)>0.6
        o[bad]=np.nan
    med=nanmed5(o)
    fill=orig&~np.isfinite(o)
    o[fill]=med[fill]
    return o
