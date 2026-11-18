"""Vessel data comes exclusively from the supplied MarineTraffic map client."""
import math

def inside(point,geometry):
    if not geometry or geometry.get('type')!='Polygon': return None
    x,y=point; ring=geometry['coordinates'][0]; result=False
    for i in range(len(ring)-1):
        x1,y1=ring[i]; x2,y2=ring[i+1]
        if (y1>y)!=(y2>y) and x<(x2-x1)*(y-y1)/(y2-y1)+x1: result=not result
    return result

def bounds(port):
    lon, lat = port['center']
    radius = float(port.get('integration', {}).get('radius_km', 25))
    dy = radius / 111.32
    dx = dy / max(.01, math.cos(math.radians(lat)))
    points = [[lon-dx, lat-dy], [lon+dx, lat+dy]]
    if port.get('boundary'):
        points += port['boundary']['coordinates'][0]
    return [max(-90, min(p[1] for p in points)), max(-180, min(p[0] for p in points)),
            min(90, max(p[1] for p in points)), min(180, max(p[0] for p in points))]


def positions(port,calls,force=False):
    if port.get('mode') == 'historical':
        return dict(mode='historical', provider='marinetraffic-client', positions=[], message='Historical Excel report. Workbooks contain no vessel coordinates; no positions are inferred.', last_sync=None)
    if port.get('excel_source') and not port.get('integration', {}).get('enabled'):
        return dict(mode='demo', provider='workbook-demo', positions=[], message='Working Excel demo. The source workbooks contain no vessel coordinates; positions are not inferred.', last_sync=None)
    from .ais_marinetraffic_client import collector
    return collector.snapshot(port,calls)
