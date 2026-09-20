import warnings; warnings.filterwarnings('ignore')
import glob,re,os,json,numpy as np,pandas as pd,sys
sys.path.insert(0,'/home/claude/w')
import dig
from PIL import Image
from scipy.spatial import cKDTree
from multiprocessing import Pool
R='/mnt/user-data/uploads/衛星水溫圖'
LAT=np.arange(18.125,31.876,0.25); LON=np.arange(116.125,127.876,0.25)
fs=[f for f in glob.glob(R+'/**/*',recursive=True) if f.lower().endswith('.png') and 'contour' in f and 'only' not in f.lower() and '拖網' not in f and ('domain-' not in f or 'domain-taiwan' in f)]
def date(f):
    b=os.path.basename(f); m=re.search(r'_(20\d\d)(\d\d)(\d\d)\d{6}',b) or re.search(r'(20\d\d)-?(\d\d)-?\s?(\d\d)',b); return '%s-%s-%s'%m.groups()
sc=pd.read_csv('scale_check.csv'); FIX=set(sc.d[sc.switch])
def work(f):
    try:
        a=np.array(Image.open(f).convert('RGB')).astype(float)
        cols,vals,vmax,h=dig.colorbar(a); px,py,_,_=dig.georef(a.astype(int))
        tree=cKDTree(cols)
        xa=int(np.floor(np.polyval(px,116)))+2; xb=int(np.ceil(np.polyval(px,128)))-2
        ya=int(np.floor(np.polyval(py,32)))+2; yb=int(np.ceil(np.polyval(py,18)))-2
        sub=a[ya:yb+1,xa:xb+1]; d,idx=tree.query(sub.reshape(-1,3)); sat=(sub.max(2)-sub.min(2)).reshape(-1)>100
        v=np.where((d<18)&sat,vals[idx],np.nan).reshape(sub.shape[:2])
        dt=date(f)
        if dt in FIX: v=(v+2)*37/32-2
        YY,XX=np.mgrid[ya:yb+1,xa:xb+1]; lon=(XX-px[1])/px[0]; lat=(YY-py[1])/py[0]
        iy=np.floor((lat-18)/0.25).astype(int); ix=np.floor((lon-116)/0.25).astype(int)
        ok=(iy>=0)&(iy<56)&(ix>=0)&(ix<48)&np.isfinite(v)
        k=(iy*48+ix)[ok]; vv=v[ok]; o=np.argsort(k); k=k[o]; vv=vv[o]
        tot=np.bincount((iy*48+ix)[(iy>=0)&(iy<56)&(ix>=0)&(ix<48)],minlength=56*48)
        b=np.searchsorted(k,np.arange(56*48+1)); out=np.full(56*48,np.nan,np.float32)
        for c in range(56*48):
            s=vv[b[c]:b[c+1]]
            if len(s)>=max(20,0.3*tot[c]):
                m=np.median(s); s2=s[np.abs(s-m)<1.0]; out[c]=np.mean(s2) if len(s2) else m
        return dt,out
    except Exception as e:
        return date(f),None
if __name__=='__main__':
    with Pool(4) as p: res=p.map(work,fs)
    res=sorted([r for r in res if r[1] is not None]); 
    d={}; [d.__setitem__(a,b) for a,b in res]
    dates=sorted(d); A=np.stack([d[x] for x in dates])
    np.savez_compressed('full_sparse.npz',dates=np.array(dates),sst=A); print(len(dates),np.isfinite(A).mean(),np.nanmin(A),np.nanmax(A))
