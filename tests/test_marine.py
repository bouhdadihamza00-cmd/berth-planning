import tempfile
import unittest
from pathlib import Path
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import numpy as np
import xarray as xr
from backend import marine


class MarineTests(unittest.TestCase):
    def setUp(self):
        self.now = datetime.now(timezone.utc).replace(microsecond=0)
        self.center = [-8.63, 33.12]
        self.data = xr.Dataset({v: (('time','latitude','longitude'), np.array([[[np.nan, 1.], [2.,3.]], [[np.nan, 2.],[3.,4.]]])) for v in ['zos','uo','vo']},
                               coords={'time': [self.now.replace(tzinfo=None), (self.now+timedelta(hours=1)).replace(tzinfo=None)],
                                       'latitude':[33.12,33.15], 'longitude':[-8.63,-8.60]})
        marine._REQUESTED.clear(); marine._ERRORS.clear()

    def test_uses_nearest_wet_cell_consistently_and_rejects_distant_cells(self):
        result = marine.extract(self.data, ['zos','uo','vo'], self.center, self.now)
        self.assertEqual(result['model_position'], [-8.6,33.12])
        self.assertEqual(result['rows'][0]['zos'],1)
        self.assertEqual(result['rows'][1]['zos'],2)
        with self.assertRaises(ValueError): marine.extract(self.data,['zos','uo','vo'], [0,0],self.now)

    def test_current_units_direction_datum_staleness_and_outage(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(marine.store,'ROOT',Path(directory)):
            group = marine.extract(self.data,['zos','uo','vo'],self.center,self.now)
            group['dataset_id']=marine.PHYSICS
            group['rows'][0].update(uo=1,vo=0)
            marine.save(self.center, {'physics':group})
            result=marine.snapshot({'center':self.center},self.now)
            p=result['groups']['physics']
            self.assertEqual(p['current_knots'],1.94)
            self.assertEqual(p['current_to_degrees'],90)
            self.assertEqual(p['datum'],'geoid')
            marine._ERRORS.add((tuple(self.center),'physics'))
            self.assertEqual(marine.snapshot({'center':self.center},self.now)['groups']['physics']['status'],'stale')
            self.assertEqual(marine.snapshot({'center':self.center},self.now+timedelta(hours=7))['groups'],{})
            self.assertNotIn('Token',str(result))

    def test_invalid_coordinates_do_not_schedule_requests(self):
        for center in ([0,91],[float('nan'),0],[True,0]):
            with self.assertRaises(ValueError):marine.snapshot({'center':center})
        self.assertEqual(marine._REQUESTED,{})
