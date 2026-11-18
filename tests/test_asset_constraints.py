import unittest
from backend.policies import normalize_rules, constrained_asset
from backend.planning import validate, optimize


class AssetConstraints(unittest.TestCase):
    def setUp(self):
        from tests.test_planning_policies import PlanningPolicies
        data = PlanningPolicies(); data.setUp()
        self.call, self.berths, self.equipment = data.call, data.berths, data.equipment

    def rule(self, kind='berths', field='max_loa', value=90, asset='B1'):
        return {'id': 'limit-1', 'name': 'Temporary operating limit', 'kind': kind, 'asset_id': asset, 'field': field, 'value': value, 'enabled': True}

    def test_validation_and_solver_apply_constraints_without_mutating_assets(self):
        rules = normalize_rules({'asset_constraints': [self.rule()]}, ['B1','B2'], ['E1'])
        self.assertTrue(any('length' in e for e in validate(self.call, [], self.berths, self.equipment, rules)['errors']))
        output = optimize([self.call], self.berths, self.equipment, {}, rules)
        self.assertIn(output['status'], ['Feasible','Optimal'])
        self.assertEqual(output['calls'][0]['berth_id'], 'B2')
        self.assertEqual(self.berths[0]['max_loa'], 200)
        rules = {'asset_constraints': [self.rule('equipment','capacity',40,'E1')]}
        self.assertTrue(any('capacity' in e for e in validate(self.call, [], self.berths, self.equipment, rules)['errors']))
        self.assertEqual(optimize([self.call], self.berths, self.equipment, {}, rules)['status'], 'Infeasible')

    def test_constraints_only_tighten_limits_and_can_be_disabled(self):
        rule = self.rule(value=500)
        self.assertEqual(constrained_asset(self.berths[0], 'berths', {'asset_constraints':[rule]})['max_loa'], 200)
        rule = self.rule(field='buffer_hours', value=3)
        self.assertEqual(constrained_asset(self.berths[0], 'berths', {'asset_constraints':[rule]})['buffer_hours'], 3)
        rule['enabled'] = False
        self.assertEqual(constrained_asset(self.berths[0], 'berths', {'asset_constraints':[rule]})['buffer_hours'], 1)

    def test_invalid_constraints_are_rejected(self):
        for rule in [self.rule(asset='unknown'), self.rule(value=-1), self.rule(value=float('nan')), self.rule(value=True), self.rule(field='execute'), self.rule('equipment','capacity',10,'B1')]:
            with self.subTest(rule=rule), self.assertRaises(ValueError):
                normalize_rules({'asset_constraints':[rule]}, ['B1'], ['E1'])


class AssetConstraintAPI(unittest.TestCase):
    def setUp(self):
        from tests.test_removal import RemovalTests
        self.helper=RemovalTests(); self.helper.setUp()
    def tearDown(self): self.helper.tearDown()

    def test_add_edit_remove_constraint_preserves_infrastructure(self):
        client=self.helper.client; root=self.helper.base
        before=client.get(root+'/snapshot').json()
        berth=before['berths'][0]
        rule={'id':'temporary','name':'Temporary limit','kind':'berths','asset_id':berth['id'],'field':'max_draft','value':7,'enabled':True}
        for constraints in [[rule], [{**rule,'value':8}], []]:
            p=client.get(root+'/snapshot').json()['port']
            response=client.post(root+'/configuration/rules',json={'port_revision':p['revision'],'rules':{**p['rules'],'asset_constraints':constraints},'berths':[]})
            self.assertEqual(response.status_code,200,response.text)
        after=client.get(root+'/snapshot').json()
        self.assertEqual(before['berths'],after['berths'])
        self.assertEqual(after['port']['rules']['asset_constraints'],[])
