import unittest
from unittest.mock import patch
from backend.ais import inside, positions

class AISContract(unittest.TestCase):
    def test_geofencing(self):
        polygon={'type':'Polygon','coordinates':[[[0,0],[2,0],[2,2],[0,2],[0,0]]]}
        self.assertTrue(inside([1,1],polygon))
        self.assertFalse(inside([3,1],polygon))
        self.assertIsNone(inside([1,1],None))

    def test_all_legacy_settings_use_only_supplied_client(self):
        with patch('backend.ais_marinetraffic_client.collector') as collector:
            for provider in ('aisstream', 'marinetraffic', 'json', 'offline', 'marinetraffic-client', None):
                port={'integration': {'provider': provider}}
                self.assertIs(positions(port, [], force=True), collector.snapshot.return_value)
                collector.snapshot.assert_called_with(port, [])

    def test_tracking_radius_accepts_5000km_and_rejects_invalid_values(self):
        from backend.main import check_port
        from fastapi import HTTPException
        for radius in (201, 1000, 5000):
            check_port({'name': 'Test port', 'code': 'TEST', 'departments': ['Operations'], 'center': [-8.63, 33.12],
                        'integration': {'provider': 'marinetraffic-client', 'radius_km': radius}})
        for radius in (5001, 0, float('nan'), True):
            with self.assertRaises(HTTPException):
                check_port({'name': 'Test port', 'code': 'TEST', 'departments': ['Operations'], 'center': [-8.63, 33.12],
                            'integration': {'provider': 'marinetraffic-client', 'radius_km': radius}})
