import unittest
from backend.policies import normalize_rules, policy_errors, approval_eligibility
from backend.planning import validate, optimize, align_forecast_for_earlier_start

class PlanningPolicies(unittest.TestCase):
    def setUp(self):
        self.call=dict(id='C1',name='Test vessel',loa=100,draft=5,product='Fertilizer',direction='Export',grade='DAP',subgrade='EU',quantity=100,ready=True,eta='2023-11-28T00:00:00Z',start='2023-11-28T01:00:00Z',end='2023-11-28T03:00:00Z',berth_id='B1',equipment_id='E1',status='Scheduled')
        self.berths=[dict(id=id,max_loa=200,max_draft=10,cargo=['Fertilizer'],status='Available',buffer_hours=1) for id in ['B1','B2']]
        self.equipment=[dict(id='E1',berths=['B1','B2'],status='Available',capacity=1000)]
        self.rule=dict(id='R1',name='DAP export route',enabled=True,effect='allow',berth_ids=['B2'],direction='Export',product='Fertilizer',grade='DAP',subgrade='')
        self.rules=normalize_rules({'custom_rules':[self.rule]},['B1','B2'])
    def test_allow_routing_and_deny_precedence(self):
        self.assertTrue(policy_errors(self.call,self.berths[0],self.rules))
        self.assertFalse(policy_errors(self.call,self.berths[1],self.rules))
        deny={**self.rule,'id':'R2','effect':'deny','name':'Maintenance route'}
        both=normalize_rules({'custom_rules':[self.rule,deny]})
        self.assertIn('Maintenance route',policy_errors(self.call,self.berths[1],both)[0])
    def test_unmatched_cargo_and_disabled_rules_are_unrestricted(self):
        self.assertFalse(policy_errors({**self.call,'grade':'MAP'},self.berths[0],self.rules))
        self.assertFalse(policy_errors(self.call,self.berths[0],{'custom_rules':[{**self.rule,'enabled':False}]}))
    def test_validation_and_optimizer_apply_the_same_rules(self):
        self.assertTrue(validate(self.call,[],self.berths,self.equipment,self.rules)['errors'])
        output=optimize([self.call],self.berths,self.equipment,{},self.rules)
        self.assertIn(output['status'],['Optimal','Feasible'])
        self.assertEqual(output['calls'][0]['berth_id'],'B2')
        closed=normalize_rules({'custom_rules':[{**self.rule,'effect':'deny','berth_ids':['B1','B2']}]})
        self.assertEqual(optimize([self.call],self.berths,self.equipment,{},closed)['status'],'Infeasible')
    def test_allow_rules_never_override_physical_limits(self):
        self.assertTrue(validate({**self.call,'berth_id':'B2','draft':15},[],self.berths,self.equipment,self.rules)['errors'])
    def test_bad_rules_rejected(self):
        for bad in [{'custom_rules':'x'},{'custom_rules':[{**self.rule,'berth_ids':[]}]},{'custom_rules':[{**self.rule,'effect':'execute'}]},{'custom_rules':[{**self.rule,'berth_ids':['unknown']}]}]:
            with self.assertRaises(ValueError):normalize_rules(bad,['B1','B2'])
    def test_existing_draft_with_stale_eta_is_aligned_before_submission(self):
        before={**self.call,'start':'2023-11-28T01:00:00Z','eta':'2023-11-27T22:00:00Z','ready_at':'2023-11-27T20:00:00Z'}
        proposed={**before,'start':'2023-11-27T01:00:00Z','end':'2023-11-27T03:00:00Z'}
        aligned=align_forecast_for_earlier_start(before,proposed)
        self.assertEqual(aligned['eta'],'2023-11-26T22:00:00+00:00')
        self.assertEqual(aligned['ready_at'],'2023-11-26T20:00:00+00:00')
        self.assertEqual(validate(aligned,[],self.berths,self.equipment,{})['errors'],[])
        arrived={**before,'actual_arrival':'2023-11-27T22:00:00Z'}
        self.assertEqual(align_forecast_for_earlier_start(arrived,proposed)['eta'],proposed['eta'])
    def test_earlier_planned_start_keeps_arrival_and_readiness_aligned(self):
        proposed={**self.call,'start':'2023-11-27T01:00:00Z','end':'2023-11-27T03:00:00Z','eta':'2023-11-26T00:00:00Z','ready_at':'2023-11-25T00:00:00Z'}
        self.assertEqual(validate(proposed,[],self.berths,self.equipment,{})['errors'],[])
        arrived={**proposed,'actual_arrival':'2023-11-28T00:00:00Z'}
        self.assertIn('The operation starts before vessel arrival',validate(arrived,[],self.berths,self.equipment,{})['errors'])
    def test_approval_modes_and_limits(self):
        proposed={**self.call,'start':'2023-11-28T02:00:00Z','end':'2023-11-28T04:00:00Z'}
        clean={'errors':[],'warnings':[]}
        manual=approval_eligibility(self.call,proposed,clean,{})
        self.assertFalse(manual['auto_approve'])
        semi=approval_eligibility(self.call,proposed,clean,{'approval_mode':'semi'})
        self.assertTrue(semi['auto_approve']);self.assertFalse(semi['auto_publish'])
        auto=approval_eligibility(self.call,proposed,clean,{'approval_mode':'automatic'})
        self.assertTrue(auto['auto_publish'])
        for validation,change,workflow in [({'errors':['Overlap']},proposed,{}),({'warnings':['Active delay']},proposed,{}),(clean,{**proposed,'berth_id':'B2'},{}),(clean,proposed,{'auto_max_shift_hours':0.5}),(clean,{**proposed,'quantity':900},{})]:
            self.assertFalse(approval_eligibility(self.call,change,validation,{'approval_mode':'automatic',**workflow})['auto_approve'])

if __name__=='__main__':unittest.main()
