"""Copernicus forecast subsets, cached by port coordinates; no account secrets in responses."""
import asyncio
import hashlib
import json
import math
import os
from pathlib import Path
from datetime import datetime, timedelta, timezone

from . import store
from .weather import timestamp

WAVES = 'cmems_mod_glo_wav_anfc_0.083deg_PT3H-i'
PHYSICS = 'cmems_mod_ibi_phy_anfc_0.027deg-2D_PT15M-i'
GROUPS = {'waves': (WAVES, ['VHM0', 'VTPK', 'VMDR', 'VHM0_SW1', 'VTM01_SW1']),
          'physics': (PHYSICS, ['zos', 'uo', 'vo'])}
_REQUESTED = {}
_RETRY = {}
_ERRORS = set()


def session_path():
    return Path(os.environ.get('COPERNICUS_SESSION_FILE', str(store.ROOT / 'data/copernicus-session.json')))


def cache_path(center):
    return store.ROOT / 'data' / ('marine-' + hashlib.sha256(json.dumps(center).encode()).hexdigest()[:20] + '.json')


def load(center):
    try:
        return json.loads(cache_path(center).read_text())
    except (OSError, ValueError):
        return {}


def save(center, data):
    path = cache_path(center)
    path.parent.mkdir(exist_ok=True)
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(data, allow_nan=False))
    temporary.replace(path)


def extract(dataset, variables, center, now):
    """Use one nearest wet cell consistently for every variable and forecast time."""
    import numpy as np
    lon, lat = center
    current = dataset.sel(time=now.replace(tzinfo=None), method='nearest')
    valid = np.ones((len(dataset.latitude), len(dataset.longitude)), dtype=bool)
    for variable in variables:
        values = current[variable].transpose('latitude', 'longitude').values
        valid &= np.isfinite(values)
    yy, xx = np.meshgrid(dataset.latitude.values, dataset.longitude.values, indexing='ij')
    distance = 111.32 * np.sqrt((yy-lat)**2 + ((xx-lon)*math.cos(math.radians(lat)))**2)
    distance = np.where(valid, distance, np.inf)
    index = np.unravel_index(np.argmin(distance), distance.shape)
    if not np.isfinite(distance[index]) or distance[index] > 25:
        raise ValueError('No valid nearby ocean model cell')
    selected = dataset.isel(latitude=index[0], longitude=index[1])
    rows = []
    for i, time in enumerate(selected.time.values):
        row = {'valid_at': str(np.datetime_as_string(time, unit='s')) + 'Z'}
        for variable in variables:
            value = float(selected[variable].isel(time=i).values)
            row[variable] = value if math.isfinite(value) else None
        rows.append(row)
    return dict(rows=rows, fetched_at=now.isoformat(),
                model_position=[float(selected.longitude), float(selected.latitude)],
                distance_km=round(float(distance[index]), 2))


def poll(center):
    os.environ.setdefault('COPERNICUSMARINE_HTTPS_TIMEOUT', '20')
    os.environ.setdefault('COPERNICUSMARINE_HTTPS_RETRIES', '1')
    import copernicusmarine as cm
    session = json.loads(session_path().read_text())
    # The official client supports MyOcean's offline token for federated accounts.
    # Its authentication service handles renewal; CDSE passwords are not stored.
    os.environ['COPERNICUSMARINE_MYOCEAN_AUTH'] = session['refreshToken']
    lon, lat = center
    now = datetime.now(timezone.utc)
    cached = load(center)
    for group, (dataset, variables) in GROUPS.items():
        key = (tuple(center), group)
        try:
            with cm.open_dataset(dataset_id=dataset, variables=variables,
                                 minimum_longitude=max(-180, lon-.15), maximum_longitude=min(180, lon+.15),
                                 minimum_latitude=max(-90, lat-.15), maximum_latitude=min(90, lat+.15),
                                 start_datetime=now-timedelta(hours=3), end_datetime=now+timedelta(hours=24)) as data:
                data.load()
                if group == 'physics' and data.zos.attrs.get('standard_name') != 'sea_surface_height_above_geoid':
                    raise ValueError('Unexpected sea-level datum')
                cached[group] = extract(data, variables, center, now)
                cached[group]['dataset_id'] = dataset
            _ERRORS.discard(key)
        except Exception:
            _ERRORS.add(key)
        save(center, cached)


def snapshot(port, now=None):
    now = now or datetime.now(timezone.utc)
    center = port['center']
    if len(center) != 2 or any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) for v in center) or not -180 <= center[0] <= 180 or not -90 <= center[1] <= 90:
        raise ValueError('Invalid marine coordinates')
    if not port.get('source_feed') and not port.get('excel_source') and port.get('mode') != 'historical':
        _REQUESTED[tuple(center)] = list(center)
    cached = load(center)
    result = dict(provider='copernicus-marine', source='E.U. Copernicus Marine Service',
                  status='connecting' if session_path().is_file() else 'not-connected', groups={},
                  message='Offshore model estimates; sea level is above geoid, not port chart datum.')
    for group, value in cached.items():
        if group not in GROUPS or not value.get('rows'):
            continue
        age = (now - timestamp(value['fetched_at'])).total_seconds()
        if age > 21600 or age < 0:
            continue
        row = min(value['rows'], key=lambda r: abs((timestamp(r['valid_at'])-now).total_seconds()))
        if abs((timestamp(row['valid_at'])-now).total_seconds()) > 10800:
            continue
        current = dict(row, fetched_at=value['fetched_at'], model_position=value['model_position'],
                       distance_km=value['distance_km'], dataset_id=value['dataset_id'],
                       status='stale' if age > 3600 or (tuple(center), group) in _ERRORS else 'current')
        if group == 'physics':
            u, v = row.get('uo'), row.get('vo')
            current.update(datum='geoid', current_knots=round(math.hypot(u, v)*1.943844, 2) if u is not None and v is not None else None,
                           current_to_degrees=round(math.degrees(math.atan2(u, v)) % 360) if u is not None and v is not None and math.hypot(u,v) > .0001 else None)
        result['groups'][group] = current
    if result['groups']:
        result['status'] = 'current' if len(result['groups']) == 2 and all(g['status'] == 'current' for g in result['groups'].values()) else 'partial'
    return result


async def run():
    while True:
        for key, center in list(_REQUESTED.items()):
            if not session_path().is_file() or datetime.now(timezone.utc).timestamp() < _RETRY.get(key, 0):
                continue
            try:
                await asyncio.to_thread(poll, center)
                _RETRY[key] = datetime.now(timezone.utc).timestamp() + 1800
            except Exception:
                _ERRORS.update((key, group) for group in GROUPS)
                _RETRY[key] = datetime.now(timezone.utc).timestamp() + 120
        await asyncio.sleep(5)
