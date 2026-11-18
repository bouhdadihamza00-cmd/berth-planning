"""SQLite local persistence. Every operational record belongs to exactly one port."""
import hashlib, json, os, secrets, sqlite3
from pathlib import Path
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parent.parent
DB_PATH = os.environ.get('PORTOPS_DB', str(ROOT / 'data' / 'portops.db'))
PERMISSIONS = ['dashboard.view','dashboard.export','calls.view','calls.create','calls.edit','calls.cancel',
 'planning.view','planning.draft','planning.submit','planning.publish','operations.view','operations.update',
 'readiness.view','readiness.update','equipment.view','equipment.update','delays.view','delays.create',
 'alerts.view','alerts.edit','approvals.view','approvals.approve','reports.view','reports.export',
 'scenarios.view','scenarios.create','config.view','config.edit','users.view','users.edit']
ROLES = {
 'Administrator': PERMISSIONS,
 'Berth Planner': [p for p in PERMISSIONS if not p.startswith(('config.', 'users.')) and p != 'approvals.approve'],
 'Approver': [p for p in PERMISSIONS if not p.startswith(('config.', 'users.'))],
 'Production Planner': ['dashboard.view','calls.view','planning.view','planning.submit','readiness.view','readiness.update','alerts.view','alerts.edit','reports.view','approvals.view','equipment.view','delays.view','operations.view'],
 'Shipping Coordinator': ['dashboard.view','calls.view','calls.create','calls.edit','planning.view','planning.draft','planning.submit','readiness.view','alerts.view','reports.view','equipment.view','delays.view','operations.view','approvals.view'],
 'Operations Operator': ['dashboard.view','calls.view','planning.view','operations.view','operations.update','equipment.view','equipment.update','delays.view','delays.create','alerts.view','alerts.edit','reports.view','readiness.view','approvals.view'],
 'Viewer': [p for p in PERMISSIONS if p.endswith('.view')],
}
def now(): return datetime.now(timezone.utc).isoformat()
def uid(): return secrets.token_hex(8)
class LocalConnection(sqlite3.Connection):
    def __exit__(self, exc_type, exc_value, traceback):
        try: return super().__exit__(exc_type, exc_value, traceback)
        finally: self.close()

def connect():
    Path(DB_PATH).parent.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(DB_PATH, timeout=15, factory=LocalConnection)
    c.row_factory = sqlite3.Row
    c.execute('PRAGMA foreign_keys=ON')
    return c

def password_hash(value, salt=None):
    salt = salt or secrets.token_hex(16)
    return salt + ':' + hashlib.pbkdf2_hmac('sha256', value.encode(), salt.encode(), 260000).hex()

def verify_password(value, stored):
    return secrets.compare_digest(password_hash(value, stored.split(':')[0]), stored)

def records(c, port, kind):
    return [dict(json.loads(r['data']), id=r['id'], revision=r['revision']) for r in c.execute('SELECT * FROM records WHERE port_id=? AND kind=?',(port,kind))]

def record(c, port, kind, id):
    r=c.execute('SELECT * FROM records WHERE port_id=? AND kind=? AND id=?',(port,kind,id)).fetchone()
    return dict(json.loads(r['data']), id=r['id'], revision=r['revision']) if r else None

def put(c, port, kind, data, id=None, revision=None):
    d=dict(data); d.pop('revision',None); d.pop('id',None)
    id=id or uid()
    old=c.execute('SELECT revision FROM records WHERE id=? AND port_id=? AND kind=?',(id,port,kind)).fetchone()
    if old:
        if revision is None or old['revision']!=revision: raise ValueError('This record changed. Reload before saving.')
        updated=c.execute('UPDATE records SET data=?,revision=revision+1 WHERE id=? AND revision=?',(json.dumps(d),id,revision))
        if updated.rowcount!=1: raise ValueError('This record changed. Reload before saving.')
    else: c.execute('INSERT INTO records(id,port_id,kind,data) VALUES(?,?,?,?)',(id,port,kind,json.dumps(d)))
    return record(c,port,kind,id)

def audit(c, port, user, action, entity='', detail=None):
    c.execute('INSERT INTO audit(port_id,user_id,action,entity_id,detail,created_at) VALUES(?,?,?,?,?,?)',(port,user,action,entity,json.dumps(detail or {}),now()))

def notification(c,port,title,description,entity=''):
    put(c,port,'notifications',dict(title=title,description=description,entity=entity,created_at=now(),read_by=[]))

def initialize():
    with connect() as c:
        c.executescript((ROOT/'backend/schema.sql').read_text())
        # Migrate old provider selections without enabling previously disabled tracking.
        for row in c.execute('SELECT id,data FROM ports').fetchall():
            data = json.loads(row['data'])
            config = data.setdefault('integration', {})
            updated = {k: v for k, v in config.items() if k in ('enabled', 'radius_km', 'freshness_minutes')}
            updated['provider'] = 'marinetraffic-client'
            if config != updated:
                data['integration'] = updated
                c.execute('UPDATE ports SET data=?,revision=revision+1 WHERE id=?', (json.dumps(data), row['id']))
