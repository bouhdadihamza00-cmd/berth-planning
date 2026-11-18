"""Product catalogue provenance, hierarchy and call timing normalization."""
import json, math
from datetime import timedelta
from .planning import dt

def product_types(catalog, existing=()):
    previous={p['name'].casefold():p for p in existing};result=[]
    for name in dict.fromkeys(r['product'] for r in catalog):
        flows=list(dict.fromkeys(r['direction'] for r in catalog if r['product']==name))
        result.append(dict(previous.get(name.casefold(),{}),name=name,direction=flows[0] if len(flows)==1 else 'Import / Export',unit='t'))
    return result

def normalize_timing(d):
    if not d.get('start'): return
    start=dt(d['start']);hours=d.get('duration_hours')
    if not d.get('end') and hours is not None:
        hours=float(hours)
        if not math.isfinite(hours) or not 0<hours<=720: raise ValueError('Duration must be between 0 and 720 hours')
        d['end']=(start+timedelta(hours=hours)).isoformat()
    if d.get('end'):
        actual=(dt(d['end'])-start).total_seconds()/3600
        if actual<=0 or actual>720: raise ValueError('Completion must be after start and within 30 days')
        if hours is not None and abs(float(hours)-actual)>1/60: raise ValueError('Duration and planned completion do not agree')
        d['duration_hours']=round(actual,6)

def check_catalog(catalog):
    if not isinstance(catalog,list) or len(catalog)>10000: raise ValueError('Invalid product catalogue')
    ids=set();variants=set()
    for row in catalog:
        if any(not isinstance(row.get(k),str) or not row[k].strip() for k in ['id','product','grade']): raise ValueError('Every catalogue row needs an ID, product and grade')
        if row.get('direction') not in ['Import','Export']: raise ValueError('Cargo flow must be Import or Export')
        if not isinstance(row.get('subgrade',''),str): raise ValueError('Sub-grade must be text')
        variant=tuple(row.get(k,'').casefold() for k in ['direction','product','grade','subgrade'])
        if row['id'] in ids or variant in variants: raise ValueError('Duplicate product identifier or cargo variant')
        ids.add(row['id']);variants.add(variant)

def match_cargo(d,port,legacy=None):
    if d.get('direction') not in ['Import','Export']: raise ValueError('Select Import or Export')
    catalog=port.get('cargo_catalog',[])
    if not catalog:return
    fields=['direction','product','grade','subgrade']
    row=next((r for r in catalog if all(r.get(k,'')==d.get(k,'') for k in fields)),None)
    if row:
        if d.get('catalog_item_id') and d['catalog_item_id']!=row['id']: raise ValueError('Catalogue identifier does not match the selected cargo')
        d['catalog_item_id']=row['id'];return
    if legacy and all(d.get(k,'')==legacy.get(k,'') for k in fields) and d.get('catalog_item_id')==legacy.get('catalog_item_id'):return
    raise ValueError('Choose a product, grade and sub-grade from the selected port catalogue')
