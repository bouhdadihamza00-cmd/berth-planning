import base64
import io
import unittest
from PIL import Image

class ProductAppearanceAPI(unittest.TestCase):
    def setUp(self):
        from tests.test_document_imports_api import DocumentImportsAPI
        self.helper=DocumentImportsAPI();self.helper.setUp()
    def tearDown(self):self.helper.tearDown()
    def __getattr__(self,name):
        if name=='helper':raise AttributeError(name)
        return getattr(self.helper,name)
    def appearance(self,**data):
        port=self.snapshot()['port']
        return self.client.post(self.root+'/configuration/product-icon',json={'product':port['products'][0]['name'],'revision':port['revision'],**data})
    def test_builtin_color_persists_across_catalogue_save(self):
        response=self.appearance(type='builtin',icon='flame',color='#ef6351');self.assertEqual(response.status_code,200,response.text)
        port=self.snapshot()['port'];name=port['products'][0]['name']
        self.assertEqual(port['product_icons'][name],{'type':'builtin','name':'flame','color':'#ef6351'})
        response=self.client.put(self.root,json=port);self.assertEqual(response.status_code,200,response.text)
        self.assertEqual(self.snapshot()['port']['product_icons'][name]['color'],'#ef6351')
    def test_custom_image_is_port_scoped_and_can_be_retinted(self):
        image=io.BytesIO();Image.new('RGBA',(24,24),(255,100,0,255)).save(image,format='PNG')
        response=self.appearance(type='image',content_base64=base64.b64encode(image.getvalue()).decode(),color='#087db3',tint=True);self.assertEqual(response.status_code,200,response.text)
        port=self.snapshot()['port'];asset=port['product_icons'][port['products'][0]['name']]['asset_id']
        response=self.client.get(self.root+'/product-icons/'+asset);self.assertEqual(response.status_code,200);self.assertEqual(response.content,image.getvalue())
        self.assertEqual(self.client.get('/api/ports/safi/product-icons/'+asset).status_code,404)
        response=self.appearance(type='image',asset_id=asset,color='#258452',tint=True);self.assertEqual(response.status_code,200,response.text)
    def test_bad_images_colors_and_unpermitted_writes_are_rejected(self):
        self.assertEqual(self.appearance(type='image',content_base64=base64.b64encode(b'<svg onload="alert(1)"/>').decode()).status_code,422)
        self.assertEqual(self.appearance(type='builtin',icon='flame',color='red;display:none').status_code,422)
        self.login('viewer');self.assertEqual(self.appearance(type='builtin',icon='flame').status_code,403)
    def test_unused_specification_deletes_but_referenced_specification_is_protected(self):
        snapshot=self.snapshot();used={call.get('catalog_item_id') for call in snapshot['calls']}
        row=next(row for row in snapshot['port']['cargo_catalog'] if row['id'] not in used)
        response=self.client.request('DELETE',self.root+'/configuration/catalog/'+row['id'],json={'revision':snapshot['port']['revision']})
        self.assertEqual(response.status_code,200,response.text)
        self.assertFalse(any(x['id']==row['id'] for x in self.snapshot()['port']['cargo_catalog']))
        ref=next(iter(used-{None}));response=self.client.request('DELETE',self.root+'/configuration/catalog/'+ref,json={'revision':self.snapshot()['port']['revision']})
        self.assertEqual(response.status_code,409,response.text)
