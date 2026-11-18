import test from "node:test";
import assert from "node:assert/strict";
import { attachBasemap } from "../frontend/basemaps.js";

function fixture(mode = "map") {
  const layers = [],
    mounted = new Set(),
    changes = [];
  const banner = { hidden: true, setAttribute() {} };
  globalThis.document = { createElement: () => banner };
  const map = {
    getContainer: () => ({ append() {} }),
    removeLayer: (layer) => mounted.delete(layer),
    hasLayer: (layer) => mounted.has(layer),
  };
  const leaflet = {
    tileLayer(url, options) {
      const events = {};
      const layer = {
        url,
        options,
        on(name, callback) {
          events[name] = callback;
          return this;
        },
        addTo() {
          mounted.add(this);
          return this;
        },
        fail() {
          events.tileerror();
        },
      };
      layers.push(layer);
      return layer;
    },
  };
  attachBasemap(map, mode, { leaflet, onChange: (kind) => changes.push(kind) });
  return { layers, mounted, changes, banner };
}

test("street view uses the shared Esri provider with attribution and a neutral error tile", () => {
  const { layers } = fixture();
  assert.match(layers[0].url, /arcgisonline.com.*World_Street_Map/);
  assert.doesNotMatch(layers[0].url, /tile.openstreetmap.org/);
  assert.match(layers[0].options.attribution, /Esri/);
  assert.match(layers[0].options.errorTileUrl, /^data:image\/svg\+xml/);
});

test("repeated failed street tiles switch to imagery without removing operational overlays", () => {
  const { layers, changes, mounted, banner } = fixture();
  const overlay = {};
  mounted.add(overlay);
  layers[0].fail();
  assert.equal(layers.length, 1);
  assert.equal(banner.hidden, false);
  layers[0].fail();
  layers[0].fail();
  assert.deepEqual(changes, ["satellite"]);
  assert.match(layers[1].url, /World_Imagery/);
  assert.equal(mounted.has(layers[0]), false);
  assert.equal(mounted.has(overlay), true);
  assert.match(banner.textContent, /Showing satellite imagery/);
  layers[0].fail();
  assert.equal(
    layers.length,
    2,
    "ignore late errors from the removed provider",
  );
});

test("failure of both providers stops switching and reports degraded map context", () => {
  const { layers, banner, changes } = fixture("satellite");
  for (let i = 0; i < 3; i++) layers[0].fail();
  for (let i = 0; i < 8; i++) layers[1].fail();
  assert.equal(layers.length, 2);
  assert.deepEqual(changes, ["map"]);
  assert.match(banner.textContent, /Map background unavailable/);
  assert.match(banner.textContent, /Port overlays remain visible/);
});
