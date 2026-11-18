"""Illustrative demonstration fixtures; not surveyed port or vessel records."""
from datetime import datetime, timedelta, timezone
from backend.store import *

def seed(c):
    t=datetime.now(timezone.utc).replace(minute=0,second=0,microsecond=0)
    iso=lambda h:(t+timedelta(hours=h)).isoformat()
    c.execute('INSERT INTO organizations VALUES(?,?)',('demo-org','Example Port Operations'))
    c.execute('INSERT INTO organizations VALUES(?,?)',('other','Independent Terminal Group'))
    for id,name,code,center,org in [('jph','Example Harbor','JPH',[-25.635,20.1208],'demo-org'),('safi','Example Terminal','SAT',[-26.276,21.301],'demo-org'),('other-port','Independent Demonstration Port','IDP',[-24.62,20.60],'other')]:
        d=dict(name=name,code=code,timezone='Africa/Casablanca',center=center,zoom=15,brand='Portside',mode='demo',boundary=None,
          departments=['Production','Supply Chain','Operations'],workflow={'departments':['Operations'],'segregation':True,'mode':'parallel'},rules={'buffer_hours':1,'freshness_minutes':30},integration={'enabled':False,'provider':'marinetraffic-client','freshness_minutes':30},products=[{'name':n,'direction':di,'grade':'Standard','unit':'t'} for n,di in [('Sulfur','Import'),('Fertilizer','Export'),('Phosphate Rock','Export'),('Phosphoric Acid','Export')]])
        if id=='jph': d['boundary']={'type':'Polygon','coordinates':[[[-25.650,20.109],[-25.650,20.135],[-25.620,20.135],[-25.620,20.109],[-25.650,20.109]]]}
        c.execute('INSERT INTO ports(id,org_id,data) VALUES(?,?,?)',(id,org,json.dumps(d)))
    for id,email,name,role,dept,superadmin,org,ports in [
      ('admin','admin@portside.demo','Demo Administrator','Administrator','Administration',1,'demo-org',['jph','safi']),
      ('planner','planner@portside.demo','Demo Planner','Berth Planner','Operations',0,'demo-org',['jph','safi']),
      ('approver','approver@portside.demo','Demo Approver','Approver','Operations',0,'demo-org',['jph','safi']),
      ('production','production@portside.demo','Demo Production','Production Planner','Production',0,'demo-org',['jph']),
      ('supply','supply@portside.demo','Demo Coordinator','Shipping Coordinator','Supply Chain',0,'demo-org',['jph']),
      ('operations','operations@portside.demo','Demo Operator','Operations Operator','Operations',0,'demo-org',['jph']),
      ('viewer','viewer@portside.demo','Demo Viewer','Viewer','Operations',0,'demo-org',['jph']),
      ('other','isolated@portside.demo','Independent Operator','Administrator','Operations',0,'other',['other-port'])]:
        c.execute('INSERT INTO users(id,org_id,email,name,password,superadmin) VALUES(?,?,?,?,?,?)',(id,org,email,name,password_hash('Portside2026!'),superadmin))
        for p in ports: c.execute('INSERT INTO memberships VALUES(?,?,?,?,?)',(id,p,dept,role,json.dumps(ROLES[role])))
    coords=[[-25.6323,20.1180],[-25.6300,20.1205],[-25.6350,20.1160],[-25.6285,20.1181],[-25.6250,20.1230],[-25.6300,20.1260]]
    for i,xy in enumerate(coords,1):
        put(c,'jph','berths',dict(name=f'Berth {i:02}',code=f'B{i}',terminal='Example terminal',length=300 if i!=3 else 350,max_loa=280,max_draft=14.5,cargo=['Sulfur'] if i==3 else ['Fertilizer','Phosphate Rock','Phosphoric Acid'],status='Available',buffer_hours=1,geometry={'type':'LineString','coordinates':[xy,[xy[0]+.0015,xy[1]-.001]]}),f'berth-{i}')
        put(c,'jph','equipment',dict(name=f'{"Unloader" if i==3 else "Shiploader"} {i:02}',type='Unloader' if i==3 else 'Shiploader',berths=[f'berth-{i}'],capacity=1800,status='Available',geometry={'type':'Point','coordinates':[xy[0]+.0007,xy[1]-.0008]}),f'eq-{i}')
    fixtures=[('Gulf Pioneer',1,'Fertilizer',32000,72,'Loading',-20,8),('Eastern Star',2,'Fertilizer',28500,64,'Loading',-16,12),('Al Safa',3,'Sulfur',41000,83,'Unloading',-26,5),('Red Sea',4,'Phosphoric Acid',7000,59,'Delayed',-18,16),('Horizon',5,'Phosphate Rock',36000,18,'Loading',-5,30),('Sahara',6,'Fertilizer',24000,0,'Waiting',10,30),('Atlas Spirit',1,'Fertilizer',18000,0,'Scheduled',12,32),('Ocean Grace',2,'Phosphate Rock',22000,0,'Scheduled',16,40),('Nordic Pearl',3,'Sulfur',26000,0,'Scheduled',10,32),('Pacific Dawn',4,'Phosphoric Acid',12000,0,'Scheduled',20,38),('Blue Meridian',5,'Phosphate Rock',30000,0,'Scheduled',35,62),('Atlantic Hope',6,'Fertilizer',25000,0,'Scheduled',35,60)]
    for i,(name,b,product,q,progress,status,start,end) in enumerate(fixtures):
        xy=coords[b-1]; pos=[xy[0]-.00045,xy[1]-.0002] if status!='Waiting' else [-25.640,20.126]
        put(c,'jph','calls',dict(name=f'MV {name}',imo=str(9300000+i*11),mmsi=str(242100000+i),loa=190+i*2,draft=11.5,product=product,grade='Standard',quantity=q,direction='Import' if product=='Sulfur' else 'Export',berth_id=f'berth-{b}',equipment_id=f'eq-{b}',start=iso(start),end=iso(end),eta=iso(start-3),status=status,progress=progress,ready=True,ready_at=iso(start-5),priority=2,rate=1800,position=pos if status!='Scheduled' else None,position_at=now(),actual_arrival=iso(start-3) if start<0 else None,actual_start=iso(start) if start<0 else None,actual_end=None,actual_departure=None,planned_start=iso(start),planned_end=iso(end)),f'call-{i+1}')
    # Completed calls supply real stored historical observations for KPIs and throughput.
    for i,(prod,qty) in enumerate([('Sulfur',41000),('Fertilizer',52500),('Phosphate Rock',24000),('Phosphoric Acid',7000)]):
        put(c,'jph','calls',dict(name='MV '+['Casablanca','Tanger','Rabat','Dakhla'][i],imo=str(9400000+i),mmsi=str(242200000+i),loa=190,draft=11,product=prod,grade='Standard',quantity=qty,direction='Import' if prod=='Sulfur' else 'Export',berth_id=f'berth-{i+1}',equipment_id=f'eq-{i+1}',start=iso(-180-i*40),end=iso(-150-i*40),eta=iso(-186-i*40),planned_start=iso(-180-i*40),planned_end=iso(-150-i*40),actual_arrival=iso(-186-i*40),actual_start=iso(-180-i*40),actual_end=iso(-150-i*40),actual_departure=iso(-148-i*40),status='Completed',progress=100,ready=True,priority=2,rate=1800),f'history-{i}')
    for i,(cause,hours,description) in enumerate([('Production',6.8,'Fertilizer batch availability below the planned quantity.'),('Quality Control',4.1,'Additional sampling required for phosphate rock.'),('Operations',4,'Shiploader conveyor inspection at Berth 04.'),('Supply Chain',3.6,'Revised vessel documentation pending release.')]):
        put(c,'jph','delays',dict(cause=cause,hours=hours,call_id='call-4' if i==2 else 'call-2',description=description,status='Open',created_at=iso(-hours),department=cause))
    for i,(title,desc,severity,dept,call) in enumerate([('Berth 04 schedule at risk','MV Red Sea is delayed. Review the next berth window.','High','Operations','call-4'),('Production availability','Fertilizer availability is lower than planned.','Medium','Production','call-2'),('Quality control hold','Phosphate rock requires additional sampling and analysis.','Medium','Production','call-5')]):
        put(c,'jph','alerts',dict(title=title,description=desc,severity=severity,department=dept,call_id=call,status='Open',created_at=iso(-i-1),comments=[]),f'alert-{i}')
    notification(c,'jph','Your port is ready','Demonstration data is active. All positions and port geometry are illustrative.')
    put(c,'jph','versions',dict(label='Initial published plan',status='Published',author='System',created_at=now(),calls=records(c,'jph','calls'),berths=records(c,'jph','berths')))

    # Fictional overlays on a public Rotterdam backdrop; no customer geometry.
    def relocate(value):
        if isinstance(value, list):
            if len(value) == 2 and all(isinstance(x, (int, float)) for x in value):
                return [round(value[0] + 29.775, 7), round(value[1] + 31.8292, 7)]
            return [relocate(x) for x in value]
        return value
    row = c.execute("SELECT data FROM ports WHERE id='jph'").fetchone()
    p = json.loads(row['data']);p['center'] = relocate(p['center'])
    p['boundary']['coordinates'] = relocate(p['boundary']['coordinates'])
    c.execute("UPDATE ports SET data=? WHERE id='jph'", (json.dumps(p),))
    for row in c.execute("SELECT id,data FROM records WHERE port_id='jph' AND kind IN ('berths','equipment','calls')").fetchall():
        d=json.loads(row['data'])
        if d.get('geometry'):d['geometry']['coordinates']=relocate(d['geometry']['coordinates'])
        if d.get('position'):d['position']=relocate(d['position'])
        c.execute('UPDATE records SET data=? WHERE id=?',(json.dumps(d),row['id']))
