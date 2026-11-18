"""Cached port weather from MET Norway's free Locationforecast API."""
import copy
import math
import os
import threading
import time
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime

import httpx

_CACHE = {}
_LOCK = threading.Lock()
URL = 'https://api.met.no/weatherapi/locationforecast/2.0/compact'


def timestamp(value):
    result = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if result.tzinfo is None:
        raise ValueError('Weather timestamp requires a time zone')
    return result


def normalize(payload, now):
    properties = payload['properties']
    updated = timestamp(properties['meta']['updated_at'])
    series = properties['timeseries']
    entry = min(series, key=lambda item: abs((timestamp(item['time']) - now).total_seconds()))
    valid_at = timestamp(entry['time'])
    if abs((valid_at - now).total_seconds()) > 10800:
        raise ValueError('No current forecast available')
    details = entry['data']['instant']['details']
    values = {}
    for field in ('air_temperature', 'relative_humidity', 'air_pressure_at_sea_level',
                  'wind_speed', 'wind_from_direction', 'wind_speed_of_gust'):
        value = details.get(field)
        if value is not None and (isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value)):
            raise ValueError('Invalid weather value')
        values[field] = value
    if values['air_temperature'] is None or values['wind_speed'] is None:
        raise ValueError('Missing weather data')
    period = entry['data'].get('next_1_hours', {})
    rain = period.get('details', {}).get('precipitation_amount')
    if rain is not None and (isinstance(rain, bool) or not isinstance(rain, (int, float)) or not math.isfinite(rain) or rain < 0):
        raise ValueError('Invalid precipitation')
    return dict(provider='met-norway', status='current', source='MET Norway',
                attribution_url='https://www.met.no/en', license_url='https://creativecommons.org/licenses/by/4.0/',
                kind='forecast', valid_at=valid_at.isoformat(), updated_at=updated.isoformat(),
                fetched_at=now.isoformat(), temperature_c=values['air_temperature'],
                humidity_percent=values['relative_humidity'], pressure_hpa=values['air_pressure_at_sea_level'],
                wind_knots=round(values['wind_speed'] * 1.943844, 1),
                wind_from_degrees=values['wind_from_direction'],
                gust_knots=round(values['wind_speed_of_gust'] * 1.943844, 1) if values['wind_speed_of_gust'] is not None else None,
                precipitation_next_hour_mm=rain,
                condition=str(period.get('summary', {}).get('symbol_code') or '').replace('_', ' '),
                message='Current forecast estimate at the port center; not a measured port observation.')


def weather(port):
    lon, lat = port['center']
    if any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) for v in (lat, lon)) or not -90 <= lat <= 90 or not -180 <= lon <= 180:
        raise ValueError('Invalid port coordinates')
    key = (round(lat, 4), round(lon, 4))
    # One shared cache prevents simultaneous dashboard viewers repeating requests.
    with _LOCK:
        now = datetime.now(timezone.utc)
        entry = _CACHE.get(key)
        if entry and time.monotonic() < entry['expires']:
            return copy.deepcopy(entry['data'])
        try:
            response = httpx.get(URL, params={'lat': key[0], 'lon': key[1]}, timeout=6,
                                 headers={'User-Agent': os.environ.get('WEATHER_USER_AGENT', 'Portside-BerthPlanning/1.0 local-development'),
                                          'Accept': 'application/json'})
            response.raise_for_status()
            result = normalize(response.json(), now)
            ttl = 600
            try:
                ttl = max(ttl, (parsedate_to_datetime(response.headers['expires']) - now).total_seconds())
            except (KeyError, TypeError, ValueError, OverflowError):
                pass
        except Exception:
            result = copy.deepcopy(entry['data']) if entry and entry['data'].get('fetched_at') and (now - timestamp(entry['data']['fetched_at'])).total_seconds() < 21600 else dict(provider='met-norway', kind='forecast')
            result.update(status='stale' if result.get('fetched_at') else 'unavailable',
                          message='Weather source unavailable. Showing the last retrieved forecast.' if result.get('fetched_at') else 'Weather source unavailable. No weather values have been substituted.')
            ttl = 120
        if result.get('valid_at') and abs((timestamp(result['valid_at']) - now).total_seconds()) > 10800:
            result['status'] = 'stale'
        if len(_CACHE) >= 256 and key not in _CACHE:
            _CACHE.pop(next(iter(_CACHE)))
        _CACHE[key] = {'expires': time.monotonic() + ttl, 'data': result}
        return copy.deepcopy(result)
