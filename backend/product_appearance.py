"""Port-scoped product icon assets and revision-aware catalogue deletion."""
import base64
import binascii
import io
import json
import re
from fastapi import HTTPException, Request, Response
from PIL import Image
from .store import connect, records, record, put, audit

ICONS={'package','boxes','sprout','leaf','mountain','flask-conical','flask-round','droplet','droplets','flame','wind','gem','factory','wheat','fuel','ship','container','recycle','atom','snowflake','sun','circle-dot'}
MAX_IMAGE=256*1024

def image_bytes(encoded):
    if not isinstance(encoded,str) or len(encoded)>MAX_IMAGE*4//3+8:raise ValueError('Use a PNG, JPEG or WebP image no larger than 256 KB')
    try:
        raw=base64.b64decode(encoded,validate=True)
        if not raw or len(raw)>MAX_IMAGE:raise ValueError()
        with Image.open(io.BytesIO(raw)) as image:
            if image.format not in ['PNG','JPEG','WEBP'] or image.width>1024 or image.height>1024 or image.width<1 or image.height<1:raise ValueError()
            mime={'PNG':'image/png','JPEG':'image/jpeg','WEBP':'image/webp'}[image.format];image.verify()
    except (ValueError,binascii.Error,OSError,Image.DecompressionBombError):raise ValueError('Use a valid PNG, JPEG or WebP image up to 1024 × 1024 pixels and 256 KB') from None
    return raw,mime

def save_port(c,port,p,revision):
    if revision!=p['revision']:raise ValueError('Port configuration changed. Reload before saving.')
    data={k:v for k,v in p.items() if k not in ['id','org_id','revision']}
    result=c.execute('UPDATE ports SET data=?,revision=revision+1 WHERE id=? AND revision=?',(json.dumps(data),port,revision))
    if result.rowcount!=1:raise ValueError('Port configuration changed. Reload before saving.')

def register_product_appearance(app,access):
    @app.post('/api/ports/{port}/configuration/product-icon')
    async def set_icon(port:str,request:Request):
        d=await request.json()
        with connect() as c:
            c.execute('BEGIN IMMEDIATE');u,p=access(c,request,port,'config.edit')
            if d.get('revision')!=p['revision']:raise ValueError('Port configuration changed. Reload before saving.')
            name=d.get('product');known={x['name'] for x in p.get('products',[])}|{x['product'] for x in p.get('cargo_catalog',[])}
            if name not in known:raise ValueError('Select an existing product')
            color=d.get('color','#087db3')
            if not isinstance(color,str) or not re.fullmatch(r'#[0-9a-fA-F]{6}',color):raise ValueError('Choose a valid icon color')
            if not isinstance(d.get('tint',False),bool):raise ValueError('Icon tint must be true or false')
            icons=dict(p.get('product_icons',{}));kind=d.get('type')
            if kind=='default':icons[name]={'type':'default','color':color}
            elif kind=='builtin':
                if d.get('icon') not in ICONS:raise ValueError('Choose a supported product icon')
                icons[name]={'type':'builtin','name':d['icon'],'color':color}
            elif kind=='image':
                if d.get('asset_id'):
                    asset=record(c,port,'product_icon_assets',d['asset_id'])
                    if not asset:raise ValueError('Upload an icon for this port')
                else:
                    raw,mime=image_bytes(d.get('content_base64'))
                    asset=put(c,port,'product_icon_assets',{'content_base64':base64.b64encode(raw).decode(),'mime':mime})
                icons[name]={'type':'image','asset_id':asset['id'],'color':color,'tint':d.get('tint',False)}
            else:raise ValueError('Choose a built-in icon, image or automatic icon')
            p['product_icons']=icons;save_port(c,port,p,d['revision'])
            audit(c,port,u['id'],'product.icon.updated',name,{'type':kind})
            return {'ok':True,'revision':p['revision']+1}

    @app.get('/api/ports/{port}/product-icons/{id}')
    def read_icon(port:str,id:str,request:Request):
        with connect() as c:
            for permission in ['dashboard.view','config.view','planning.view','calls.view']:
                try:access(c,request,port,permission);break
                except HTTPException as error:
                    if error.status_code!=403:raise
            else:raise HTTPException(403,'Product icon access is restricted')
            asset=record(c,port,'product_icon_assets',id)
            if not asset:raise HTTPException(404,'Product icon not found')
            return Response(base64.b64decode(asset['content_base64']),media_type=asset['mime'],headers={'X-Content-Type-Options':'nosniff'})

    @app.delete('/api/ports/{port}/configuration/products/{name}')
    async def delete_product(port:str,name:str,request:Request):
        d=await request.json()
        with connect() as c:
            c.execute('BEGIN IMMEDIATE');u,p=access(c,request,port,'config.edit')
            if not any(x['name']==name for x in p.get('products',[])): raise HTTPException(404,'Product not found')
            if any(x.get('product')==name for x in records(c,port,'calls')): raise HTTPException(409,'This product is used by vessel calls. Reassign those calls first.')
            if any(x.get('proposed',{}).get('product')==name for x in records(c,port,'drafts')): raise HTTPException(409,'This product is referenced by planning workflows')
            if any(x.get('product')==name for x in p.get('rules',{}).get('custom_rules',[])): raise HTTPException(409,'Remove cargo rules for this product first')
            p['products']=[x for x in p.get('products',[]) if x['name']!=name]
            p['cargo_catalog']=[x for x in p.get('cargo_catalog',[]) if x['product']!=name]
            p.get('product_icons',{}).pop(name,None)
            save_port(c,port,p,d.get('revision'))
            for berth in records(c,port,'berths'):
                if name in berth.get('cargo',[]):
                    berth['cargo']=[x for x in berth['cargo'] if x!=name]
                    put(c,port,'berths',berth,berth['id'],berth['revision'])
            audit(c,port,u['id'],'catalog.product.deleted',name)
            return {'ok':True}

    @app.delete('/api/ports/{port}/configuration/catalog/{reference}')
    async def delete_specification(port:str,reference:str,request:Request):
        d=await request.json()
        with connect() as c:
            c.execute('BEGIN IMMEDIATE');u,p=access(c,request,port,'config.edit')
            rows=p.get('cargo_catalog',[])
            if not any(x['id']==reference for x in rows):raise HTTPException(404,'Specification not found')
            if any(call.get('catalog_item_id')==reference for call in records(c,port,'calls')):raise HTTPException(409,'This specification is used by vessel calls. Keep it for their records or reassign those calls first.')
            if any(draft.get('status') in ['Draft','Submitted','Approved','Clarification requested'] and draft.get('proposed',{}).get('catalog_item_id')==reference for draft in records(c,port,'drafts')):raise HTTPException(409,'This specification is used by a pending planning proposal. Resolve that proposal first.')
            p['cargo_catalog']=[x for x in rows if x['id']!=reference]
            # Deleting a grade does not delete the product or its berth compatibility.
            save_port(c,port,p,d.get('revision'))
            audit(c,port,u['id'],'catalog.specification.deleted',reference)
            return {'ok':True,'revision':p['revision']+1}
