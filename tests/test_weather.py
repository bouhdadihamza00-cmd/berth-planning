from tests.fixtures import initialize_demo
from tests.fixtures import demo_client
import copy
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import MagicMock, patch

from backend import weather, store


def payload():
    now = datetime.now(timezone.utc).isoformat()
    return {'properties': {'meta': {'updated_at': now}, 'timeseries': [
        {'time': now, 'data': {'instant': {'details': {'air_temperature': 21.5, 'wind_speed': 5,
         'wind_from_direction': 270, 'relative_humidity': 70, 'air_pressure_at_sea_level': 1015}},
         'next_1_hours': {'summary': {'symbol_code': 'partlycloudy_day'}, 'details': {'precipitation_amount': .2}}}}]}}


class WeatherTests(unittest.TestCase):
    def setUp(self):
        weather._CACHE.clear()
        self.port = {'center': [-8.635, 33.12]}

    def test_cache_coordinates_units_and_missing_optional_gust(self):
        response = MagicMock(headers={})
        response.json.return_value = payload()
        with patch.object(weather.httpx, 'get', return_value=response) as get:
            result = weather.weather(self.port)
            result['temperature_c'] = -999
            cached = weather.weather(self.port)
        self.assertEqual(get.call_count, 1)
        self.assertEqual(get.call_args.kwargs['params'], {'lat': 33.12, 'lon': -8.635})
        self.assertEqual(cached['temperature_c'], 21.5)
        self.assertEqual(cached['wind_knots'], 9.7)
        self.assertIsNone(cached['gust_knots'])
        self.assertEqual(cached['precipitation_next_hour_mm'], .2)
        self.assertEqual(cached['kind'], 'forecast')

    def test_outage_retains_data_with_stale_label_and_sanitizes_error(self):
        response = MagicMock(headers={}); response.json.return_value = payload()
        with patch.object(weather.httpx, 'get', return_value=response):
            weather.weather(self.port)
        next(iter(weather._CACHE.values()))['expires'] = 0
        with patch.object(weather.httpx, 'get', side_effect=RuntimeError('private-upstream-detail')):
            result = weather.weather(self.port)
        self.assertEqual(result['status'], 'stale')
        self.assertEqual(result['temperature_c'], 21.5)
        self.assertNotIn('private-upstream-detail', str(result))

    def test_invalid_or_old_response_is_not_current(self):
        response = MagicMock(headers={})
        data = payload()
        data['properties']['timeseries'][0]['time'] = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
        for value in ({'error': 'secret'}, data):
            weather._CACHE.clear(); response.json.return_value = value
            with patch.object(weather.httpx, 'get', return_value=response):
                result = weather.weather(self.port)
            self.assertEqual(result['status'], 'unavailable')
            self.assertNotIn('temperature_c', result)

    def test_bad_coordinates_do_not_call_provider(self):
        with patch.object(weather.httpx, 'get') as get:
            with self.assertRaises(ValueError): weather.weather({'center': [0, 100]})
            get.assert_not_called()

    def test_weather_endpoint_requires_port_access(self):
        from fastapi.testclient import TestClient
        from backend.main import app, _LOGIN_ATTEMPTS
        with tempfile.TemporaryDirectory() as directory, patch.object(store, 'DB_PATH', str(Path(directory) / 'test.db')):
            initialize_demo(); _LOGIN_ATTEMPTS.clear()
            with demo_client() as client, patch('backend.weather.weather', return_value={'status': 'current'}) as read:
                self.assertEqual(client.get('/api/ports/jph/weather').status_code, 401)
                login = client.post('/api/auth/login', json={'email': 'viewer@portside.demo', 'password': 'Portside2026!'})
                self.assertEqual(login.status_code, 200)
                self.assertEqual(client.get('/api/ports/other-port/weather').status_code, 403)
                read.assert_not_called()
                self.assertEqual(client.get('/api/ports/jph/weather').json(), {'status': 'current'})
