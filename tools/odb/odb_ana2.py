import numpy as np,pandas as pd,json,warnings; warnings.filterwarnings('ignore')
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.metrics import roc_auc_score
from sklearn.inspection import permutation_importance, partial_dependence
from scipy import stats
D=pd.read_csv('odb_dom.csv'); G=pd.read_csv('odb_int.csv')
S=D[D.period.isin([13,14,15,16])].copy()
S['pres']=(S.eff>1).astype(int); S['season']=S.period-13
S['block']=(np.floor(S.lat)).astype(int).astype(str)+'_'+(np.floor(S.lon)).astype(int).astype(str)
print(len(S),S.pres.mean(),S.block.nunique())
groups={'衛星 SST':['sst','ffreq'],'CTD 水文':['T0','S0','T100','S100','Tb','Sb','dT50','N2max','MLD'],'ADCP 海流':['spd0','spd100','spdb','eke0','shear','vort','div','dks'],
 'SST+CTD+ADCP':['sst','ffreq','T0','S0','T100','S100','Tb','Sb','dT50','N2max','MLD','spd0','spd100','spdb','eke0','shear','vort','div','dks'],
 '地形（離岸+水深）':['dist','dmax'],'全部變數':['sst','ffreq','T0','S0','T100','S100','Tb','Sb','dT50','N2max','MLD','spd0','spd100','spdb','eke0','shear','vort','div','dks','dist','dmax']}
blocks=S.block.unique()
def cv(cols,reps=5):
    aucs=[]
    for r in range(reps):
        p=np.zeros(len(S))
        rb=np.random.default_rng(r).permutation(blocks); folds=np.array_split(rb,5)
        for f in folds:
            te=S.block.isin(f).values
            m=HistGradientBoostingClassifier(max_depth=3,learning_rate=0.05,max_iter=200,min_samples_leaf=10,l2_regularization=1.0,random_state=r)
            m.fit(S.loc[~te,cols+['season']],S.pres[~te]); p[te]=m.predict_proba(S.loc[te,cols+['season']])[:,1]
        aucs.append(roc_auc_score(S.pres,p))
    return float(np.mean(aucs)),float(np.std(aucs))
R={}
R['cv']={g:cv(c) for g,c in groups.items()}; print(R['cv'])
cols=groups['全部變數']
m=HistGradientBoostingClassifier(max_depth=3,learning_rate=0.05,max_iter=200,min_samples_leaf=10,l2_regularization=1.0,random_state=0).fit(S[cols+['season']],S.pres)
pi=permutation_importance(m,S[cols+['season']],S.pres,scoring='roc_auc',n_repeats=30,random_state=0)
imp=sorted([(c,float(pi.importances_mean[i]),float(pi.importances_std[i])) for i,c in enumerate(cols+['season'])],key=lambda x:-x[1]); R['imp']=imp; print(imp[:10])
# physics-only model importance (no dist/dmax) to see which ocean var matters
cp=groups['SST+CTD+ADCP']
m2=HistGradientBoostingClassifier(max_depth=3,learning_rate=0.05,max_iter=200,min_samples_leaf=10,l2_regularization=1.0,random_state=0).fit(S[cp+['season']],S.pres)
pi2=permutation_importance(m2,S[cp+['season']],S.pres,scoring='roc_auc',n_repeats=30,random_state=0)
R['imp_phys']=sorted([(c,float(pi2.importances_mean[i]),float(pi2.importances_std[i])) for i,c in enumerate(cp+['season'])],key=lambda x:-x[1]); print(R['imp_phys'][:8])
pdp={}
for v in [x[0] for x in R['imp_phys'][:6] if x[0]!='season']:
    j=(cp+['season']).index(v); r=partial_dependence(m2,S[cp+['season']],[j],grid_resolution=30,kind='average')
    pdp[v]=dict(x=r['grid_values'][0].tolist(),y=r['average'][0].tolist())
R['pdp']=pdp
# ---- water mass T-S at 100 m / bottom: effort share by class ----
def wm(T,Sal):
    if not np.isfinite(T) or not np.isfinite(Sal): return None
    if Sal<34.0: return '沿岸/陸棚稀釋水'
    if Sal>=34.6 and T<22: return '黑潮次表層水'
    if Sal>=34.6: return '黑潮表層水'
    return '陸棚混合水'
tsr={}
for p in [13,14,15,16]:
    d=D[D.period==p].copy(); d['wm']=[wm(a,b) for a,b in zip(d.Tb,d.Sb)]; d=d[d.wm.notna()]
    g=d.groupby('wm').agg(eff=('eff','sum'),n=('eff','size')); g['use']=g.eff/g.eff.sum(); g['avail']=g.n/g.n.sum()
    tsr[p]=g[['use','avail']].to_dict('index')
R['wm']=tsr; print(tsr)
R['ts']={p:D[(D.period==p)&D.Tb.notna()&D.Sb.notna()&(D.pb<=300)][['Tb','Sb','eff','pb','T100','S100']].round(3).to_dict('list') for p in [13,14,15,16]}
# ---- monsoon change: SW - NE ----
a=D[D.period==17].set_index(['lon','lat']); b=D[D.period==18].set_index(['lon','lat'])
j=a.join(b,lsuffix='_ne',rsuffix='_sw',how='inner')
j['sh_ne']=j.eff_ne/j.eff_ne.sum(); j['sh_sw']=j.eff_sw/j.eff_sw.sum(); j['dsh']=(j.sh_sw-j.sh_ne)*100
j=j[(j.eff_ne>0)|(j.eff_sw>0)].reset_index()
mc={}
for v in ['sst','T0','T100','Tb','S0','Sb','dT50','N2max','MLD','spd0','spdb','eke0','vort','div','ffreq']:
    x=(j[v+'_sw']-j[v+'_ne']).values; y=j.dsh.values; k=np.isfinite(x)
    if k.sum()<12: continue
    r=stats.spearmanr(x[k],y[k]); mc[v]=dict(r=float(r.correlation),p=float(r.pvalue),n=int(k.sum()),dmean=float(np.average(x[k],weights=(j.eff_ne+j.eff_sw).values[k])))
R['monsoon']=mc; print(mc)
R['monsoon_cells']=j[['lon','lat','dsh','eff_ne','eff_sw']].round(4).to_dict('list')
# ---- seasonal effort-weighted profile of conditions experienced ----
exp={}
for v in ['sst','T0','T100','Tb','Sb','S100','spd0','spdb','eke0','MLD','dT50']:
    exp[v]={}
    for p in [13,14,15,16,17,18]:
        d=D[(D.period==p)&D[v].notna()]
        if d.eff.sum()>0: exp[v][p]=dict(use=float(np.average(d[v],weights=d.eff)),avail=float(d[v].mean()))
R['exp']=exp
json.dump(R,open('res_odb2.json','w'),ensure_ascii=False,default=float)
