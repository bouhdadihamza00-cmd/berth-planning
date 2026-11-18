import test from 'node:test';
import assert from 'node:assert/strict';
import {portMapView,portMapBoundaryKey} from '../frontend/port-map-view.js';
test('dashboard centers on saved boundary instead of the independent port coordinates',()=>{
 const port={center:[0,0],zoom:10,boundary:{type:'Polygon',coordinates:[[[-8.65,33.10],[-8.61,33.10],[-8.61,33.14],[-8.65,33.14],[-8.65,33.10]]]}};
 const view=portMapView(port);assert.ok(Math.abs(view.center[0]-33.12)<1e-9);assert.ok(Math.abs(view.center[1]+8.63)<1e-9);assert.equal(view.zoom,15);
 const before=portMapBoundaryKey(port);port.boundary.coordinates[0][0][0]=-8.67;assert.notEqual(before,portMapBoundaryKey(port));
});
test('fallback center and latitude-adjusted zoom keep the scale in the 300 m range',()=>{
 for(const latitude of [0,33,60,80]){
  const view=portMapView({center:[10,latitude],zoom:6});assert.deepEqual(view.center,[latitude,10]);
  const distance=40075016.68557849*Math.cos(latitude*Math.PI/180)/(256*2**view.zoom)*100;
  assert.ok(distance>=300&&distance<500,`${latitude}: ${distance}`);
 }
});

test('an unconfigured port starts at world scale instead of offshore close-up',()=>{
 assert.deepEqual(portMapView({center:[0,0],zoom:2}),{center:[0,0],zoom:2});
 assert.deepEqual(portMapView({}),{center:[0,0],zoom:2});
});
