"""Saved connector definitions. No network requests or field writes are performed."""
import re
from urllib.parse import urlsplit
from fastapi import HTTPException, Request
from .store import connect, records, record, put, audit

DATA_TYPES = {'inventory', 'production', 'vessel_calls', 'weather', 'equipment', 'quality', 'erp'}
POLICIES = {'None', 'Basic256Sha256', 'Aes128_Sha256_RsaOaep', 'Aes256_Sha256_RsaPss'}

def validate_connector(d):
    if not isinstance(d, dict): raise ValueError('Connector settings must be an object')
    allowed={'name','protocol','data_type','endpoint','security_mode','security_policy','credential_ref','poll_seconds','tags','revision','id'}
    if set(d)-allowed: raise ValueError('Unsupported connector setting; keep credentials on the server')
    result={k:v for k,v in d.items() if k not in {'revision','id'}}
    if not isinstance(d.get('name'),str) or not 1<=len(d['name'].strip())<=100: raise ValueError('Enter a connector name, up to 100 characters')
    if not isinstance(d.get('protocol'),str) or d.get('protocol') not in {'api','opcua'}: raise ValueError('Choose API or OPC UA')
    if not isinstance(d.get('data_type'),str) or d.get('data_type') not in DATA_TYPES: raise ValueError('Choose a supported data category')
    endpoint=d.get('endpoint','')
    if not isinstance(endpoint,str) or len(endpoint)>1500: raise ValueError('Enter a valid endpoint')
    parts=urlsplit(endpoint)
    if parts.scheme not in ({'https','http'} if d['protocol']=='api' else {'opc.tcp'}) or not parts.hostname or parts.username or parts.password or parts.fragment or parts.query:
        raise ValueError('Enter an endpoint without embedded credentials, query parameters or fragments')
    ref=d.get('credential_ref','')
    if not isinstance(ref,str) or (ref and not re.fullmatch(r'[A-Z][A-Z0-9_]{0,99}',ref)): raise ValueError('Credential reference must be a server environment variable name')
    interval=d.get('poll_seconds',30)
    if isinstance(interval,bool) or not isinstance(interval,int) or not 1<=interval<=86400: raise ValueError('Polling interval must be 1–86400 seconds')
    tags=d.get('tags',[])
    if not isinstance(tags,list) or len(tags)>200: raise ValueError('Use at most 200 tag mappings')
    seen=set()
    for tag in tags:
        if not isinstance(tag,dict) or set(tag)!={'source','target','unit'} or any(not isinstance(v,str) or len(v)>300 for v in tag.values()): raise ValueError('Each mapping needs source, target and unit text')
        if not tag['source'].strip() or not tag['target'].strip() or tag['target'] in seen: raise ValueError('Mapping destinations must be unique and non-empty')
        seen.add(tag['target'])
        if d['protocol']=='opcua' and not re.fullmatch(r'(?:ns=\d+;)?(?:i=\d+|s=.+|g=[0-9a-fA-F-]{36}|b=[A-Za-z0-9+/=]+)',tag['source']): raise ValueError('Enter an OPC UA NodeId, for example ns=2;s=Loader.Rate')
    if d['protocol']=='opcua':
        mode=d.get('security_mode','SignAndEncrypt'); policy=d.get('security_policy','Basic256Sha256')
        if not isinstance(mode,str) or not isinstance(policy,str) or mode not in {'None','Sign','SignAndEncrypt'} or policy not in POLICIES or ((mode=='None') != (policy=='None')): raise ValueError('Choose matching OPC UA security mode and policy')
    return result

def register_connectors(app, access):
    @app.get('/api/ports/{port}/configuration/connectors')
    async def list_connectors(port:str,request:Request):
        with connect() as c:
            access(c,request,port,'config.view')
            return [dict(x,connection_status='Not connected · configuration only',read_only=True) for x in records(c,port,'connectors')]

    @app.post('/api/ports/{port}/configuration/connectors')
    async def save_connector(port:str,request:Request):
        d=await request.json(); settings=validate_connector(d)
        with connect() as c:
            u,p=access(c,request,port,'config.edit')
            if d.get('id'):
                old=record(c,port,'connectors',d['id'])
                if not old: raise HTTPException(404,'Connector not found')
                if old['revision']!=d.get('revision'): raise ValueError('Connector changed. Reload before saving.')
            result=put(c,port,'connectors',settings,d.get('id'),d.get('revision'))
            audit(c,port,u['id'],'connector.configured',result['id'],result)
            return result

    @app.delete('/api/ports/{port}/configuration/connectors/{id}')
    async def remove_connector(port:str,id:str,request:Request):
        d=await request.json()
        with connect() as c:
            u,p=access(c,request,port,'config.edit'); old=record(c,port,'connectors',id)
            if not old: raise HTTPException(404,'Connector not found')
            if old['revision']!=d.get('revision'): raise ValueError('Connector changed. Reload before deleting.')
            c.execute('DELETE FROM records WHERE port_id=? AND kind=? AND id=?',(port,'connectors',id))
            audit(c,port,u['id'],'connector.removed',id,old)
            return {'ok':True}
