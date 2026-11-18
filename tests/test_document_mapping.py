"""Document normalization checks against source meaning, not parser implementation."""
import unittest
from backend.document_imports import infer_mapping, normalize_data, local_items, source_truncated, timestamp, find_match

class DocumentMappingTests(unittest.TestCase):
 def test_units_and_explicit_zero_false_preserve_meaning(self):
  source={'tables':[{'name':'Cargo','headers':['Navire','Quantité (kt)','Cargo ready','Progress %'], 'rows':[{'ref':'Cargo!R2','values':['MV Atlas',2.5,False,0]}]}]}
  items,mapping=local_items(source,{})
  values,errors=normalize_data(items[0]['data'],{'timezone':'Africa/Casablanca'},items[0]['evidence'],'ISO','')
  self.assertEqual(values['quantity'],2500);self.assertIs(values['ready'],False);self.assertEqual(values['progress'],0);self.assertEqual(errors,[])
 def test_incomplete_dates_and_ambiguous_numbers_are_not_guessed(self):
  p={'timezone':'Africa/Casablanca'}
  values,errors=normalize_data({'start':'2023-11-28','quantity':'12,500'},p,[],'ISO','')
  self.assertNotIn('start',values);self.assertNotIn('quantity',values);self.assertEqual(len(errors),2)
  self.assertEqual(timestamp('28/11/2023 15:30',p['timezone'],'DMY'), '2023-11-28T15:30:00+01:00')
 def test_explicit_new_voyage_and_ambiguous_matching(self):
  call={'id':'one','name':'MV Atlas','start':'2023-11-28T10:00:00Z','eta':'2023-11-28T08:00:00Z'}
  match,errors=find_match({'name':'Atlas','start':'2024-11-28T10:00:00Z'},[call]);self.assertIsNone(match);self.assertTrue(errors)
  match,errors=find_match({'name':'Atlas'},[call],force_new=True);self.assertIsNone(match);self.assertEqual(errors,[])
  match,errors=find_match({'name':'Atlas'},[call,{**call,'id':'two'}]);self.assertIsNone(match);self.assertTrue(errors)
 def test_header_promotion_and_table_specific_completeness(self):
  source={'truncated':True,'tables':[{'name':'Relevant','headers':['Caption','Column 2'],'truncated':False,'rows':[{'ref':'S!R2','values':['Vessel','Quantity']},{'ref':'S!R3','values':['Atlas',123]}]},{'name':'Helpers','headers':['x'],'rows':[],'truncated':True}]}
  items,mapping=local_items(source,{},0,1);self.assertEqual(mapping['name'],'Vessel');self.assertEqual(items[0]['evidence'][0]['ref'],'S!R3')
  self.assertFalse(source_truncated({'method':'local','extraction':source,'table_index':0}));self.assertTrue(source_truncated({'method':'ai','extraction':source}))
 def test_bad_identifiers_and_nested_values_are_errors(self):
  values,errors=normalize_data({'imo':'junk','mmsi':123,'product':{'secret':'not text'}},{'timezone':'UTC'},[],'ISO','')
  self.assertEqual(values,{});self.assertEqual(len(errors),3)

if __name__=='__main__':unittest.main()
