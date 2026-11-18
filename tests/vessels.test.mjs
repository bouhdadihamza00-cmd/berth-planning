import test from "node:test";
import assert from "node:assert/strict";
import { vesselDimensions, mountVessels } from "../frontend/vessels.js";

function fixture(position, zoom = 16) {
  const bindings = [],
    events = {},
    markers = [];
  const container = {
    getBoundingClientRect: () => ({
      left: 0,
      top: 0,
      right: 1000,
      bottom: 1000,
    }),
    parentElement: { querySelectorAll: () => [] },
  };
  const map = {
    getZoom: () => zoom,
    getContainer: () => container,
    on: (names, fn) => {
      events[names] = fn;
    },
    off: (names) => {
      delete events[names];
    },
  };
  const leaflet = {
    divIcon: (options) => options,
    marker(coordinates, options) {
      const marker = {
        coordinates,
        options,
        handlers: {},
        addTo: () => marker,
        on: (name, fn) => {
          marker.handlers[name] = fn;
          return marker;
        },
        unbindTooltip: () => marker,
        bindTooltip: (content, options) => {
          bindings.push({ content, options });
          return marker;
        },
        getTooltip: () => ({
          getElement: () => ({
            getBoundingClientRect: () => ({
              left: 20,
              right: 60,
              top: 20,
              bottom: 40,
            }),
          }),
        }),
        setIcon: (icon) => {
          marker.options.icon = icon;
        },
        openTooltip: () => {
          marker.tooltipOpened = true;
        },
        remove: () => {
          marker.removed = true;
        },
      };
      markers.push(marker);
      return marker;
    },
  };
  const selected = [];
  const display = mountVessels(map, {
    positions: [
      {
        id: "ship",
        name: "Test ship",
        loa: 200,
        position: [-8.63, 33.12],
        ...position,
      },
    ],
    calls: [],
    colors: {},
    esc: (value) => String(value),
    onSelect: (...args) => selected.push(args),
    leaflet,
  });
  return {
    display,
    markers,
    bindings,
    events,
    selected,
    zoomTo(value) {
      zoom = value;
      Object.values(events).forEach((fn) => fn());
    },
  };
}

test("ship bows follow compass headings rather than an east-facing SVG baseline", () => {
  for (const [heading, rotation] of [
    [0, -90],
    [90, 0],
    [180, 90],
    [270, 180],
  ]) {
    const f = fixture({ heading });
    assert.match(
      f.markers[0].options.icon.html,
      new RegExp(`rotate\\(${rotation}deg\\)`),
    );
  }
});

test("missing and invalid heading fall back to course without losing zero degrees", () => {
  for (const heading of [null, undefined, "", " ", 511, 360, -1, NaN, false]) {
    const f = fixture({ heading, course: "0" });
    assert.match(f.markers[0].options.icon.html, /rotate\(-90deg\)/);
  }
  assert.match(
    fixture({ heading: "90", course: 180 }).markers[0].options.icon.html,
    /rotate\(0deg\)/,
  );
});

test("unreported direction uses a neutral target rather than an invented heading", () => {
  const f = fixture({ heading: 511, course: 360 });
  assert.match(f.markers[0].options.icon.html, /<circle class="vessel-hull"/);
  assert.doesNotMatch(f.markers[0].options.icon.html, /rotate\(32deg\)/);
});

test("satellite placeholders use a small filled circle even with course and length", () => {
  for (const position of [{ name: "[SAT-AIS]" }, { is_satellite: true }]) {
    const f = fixture({ ...position, heading: 90, course: 137, loa: 300 });
    const icon = f.markers[0].options.icon;
    assert.match(icon.className, /ais-point-marker/);
    assert.match(icon.html, /<circle/);
    assert.doesNotMatch(icon.html, /<path|<rect/);
    assert.deepEqual(icon.iconSize, [24, 24]);
    f.zoomTo(19);
    assert.deepEqual(f.markers[0].options.icon.iconSize, [48, 48]);
    assert.match(f.bindings[0].content, /Unidentified AIS observation/);
    f.markers[0].handlers.click();
    assert.equal(f.selected.length, 1);
  }
});

test("explicit buoys use circles while numeric provider types remain vessels", () => {
  assert.match(fixture({ ship_type: "buoy", heading: 90 }).markers[0].options.icon.className, /ais-point-marker/);
  assert.doesNotMatch(fixture({ ship_type: "3", heading: 90 }).markers[0].options.icon.className, /ais-point-marker/);
});

test("rotated hit targets remain centered and preserve bearing when zooming", () => {
  const north = fixture({ heading: 0 });
  const east = fixture({ heading: 90 });
  const n = north.markers[0].options.icon;
  const e = east.markers[0].options.icon;
  assert.ok(Math.abs(n.iconSize[0] - e.iconSize[1]) < 0.001);
  assert.ok(Math.abs(n.iconSize[1] - e.iconSize[0]) < 0.001);
  assert.deepEqual(
    n.iconAnchor,
    n.iconSize.map((v) => v / 2),
  );
  north.zoomTo(15);
  assert.match(north.markers[0].options.icon.html, /rotate\(-90deg\)/);
  assert.ok(north.markers[0].options.icon.iconSize[1] < n.iconSize[1]);
});

test("labels remain hover-only at every zoom and clicking still selects the vessel", () => {
  const f = fixture({ heading: 270 });
  f.zoomTo(18);
  f.zoomTo(10);
  assert.ok(f.bindings.length > 0);
  assert.ok(f.bindings.every((binding) => binding.options.permanent === false));
  assert.match(f.bindings[0].content, /Test ship/);
  f.markers[0].handlers.click();
  assert.equal(f.markers[0].tooltipOpened, true);
  assert.equal(f.selected.length, 1);
  assert.equal(f.selected[0][1].id, "ship");
  assert.deepEqual(f.markers[0].coordinates, [33.12, -8.63]);
  f.display.destroy();
  assert.equal(f.markers[0].removed, true);
  assert.equal(Object.keys(f.events).length, 0);
});

test("each zoom-out step halves vessel length before the minimum symbol size", () => {
  const near = vesselDimensions(200, 33.12, 16);
  const middle = vesselDimensions(200, 33.12, 15);
  const far = vesselDimensions(200, 33.12, 14);
  assert.ok(Math.abs(near.width / 2 - middle.width) < 0.001);
  assert.ok(Math.abs(middle.width / 2 - far.width) < 0.001);
  assert.ok(far.width < 30);
});

test("vessel symbols represent physical length at the same location and zoom", () => {
  const small = vesselDimensions(150, 33.12, 15);
  const large = vesselDimensions(300, 33.12, 15);
  assert.ok(Math.abs(large.width - small.width * 2) < 0.001);
});

test("wide views retain a usable hit target without enlarging the drawn vessel", () => {
  const far = vesselDimensions(200, 33.12, 8);
  assert.equal(far.width, 10);
  assert.ok(far.hitWidth >= 24 && far.hitHeight >= 24);
  const near = vesselDimensions(350, 33.12, 19);
  assert.equal(near.width, 128);
});

test("AIS positions without vessel dimensions use a finite default length", () => {
  assert.deepEqual(
    vesselDimensions(undefined, 33.12, 15),
    vesselDimensions(200, 33.12, 15),
  );
});

test("point observations scale with zoom while retaining a usable hit target", () => {
  const f = fixture({ is_satellite: true, stale: true }, 16);
  const width = () => Number(f.markers[0].options.icon.html.match(/width="([\d.]+)"/)[1]);
  assert.equal(width(), 24);
  f.zoomTo(15);
  assert.equal(width(), 12);
  assert.deepEqual(f.markers[0].options.icon.iconSize, [24,24]);
  f.zoomTo(17);
  assert.equal(width(), 48);
  f.zoomTo(8);
  assert.equal(width(), 12);
  assert.doesNotMatch(f.markers[0].options.icon.html, /opacity:/);
  assert.match(f.bindings[0].content, /Stale position/);
});
