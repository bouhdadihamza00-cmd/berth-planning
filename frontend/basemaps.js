// Both map screens share providers and failure handling. No community OSM tile endpoint.
const PROVIDERS = {
  satellite: {
    service: "World_Imagery",
    attribution:
      'Imagery © <a href="https://www.esri.com/">Esri</a>, Maxar, Earthstar Geographics',
  },
  map: {
    service: "World_Street_Map",
    attribution:
      'Map © <a href="https://www.esri.com/">Esri</a>, HERE, Garmin, USGS, NGA',
  },
};
const EMPTY_TILE =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#e4e7e9"/></svg>',
  );

export function attachBasemap(
  map,
  mode,
  { leaflet = window.L, onChange = () => {} } = {},
) {
  let active,
    failed = new Set(),
    errors = 0;
  const banner = document.createElement("div");
  banner.className = "basemap-status";
  banner.setAttribute("role", "status");
  banner.hidden = true;
  map.getContainer().append(banner);
  function show(message) {
    banner.textContent = message;
    banner.hidden = !message;
  }
  function load(kind) {
    if (active) map.removeLayer(active);
    errors = 0;
    const provider = PROVIDERS[kind];
    const layer = leaflet.tileLayer(
      `https://server.arcgisonline.com/ArcGIS/rest/services/${provider.service}/MapServer/tile/{z}/{y}/{x}`,
      {
        maxZoom: 19,
        maxNativeZoom: 19,
        attribution: provider.attribution,
        errorTileUrl: EMPTY_TILE,
        updateWhenIdle: true,
      },
    );
    active = layer;
    layer.on("tileerror", () => {
      if (active !== layer || !map.hasLayer(layer)) return;
      show(
        "Map background is partly unavailable. Port overlays remain visible.",
      );
      if (++errors < 3) return;
      failed.add(kind);
      const fallback = kind === "map" ? "satellite" : "map";
      if (failed.has(fallback)) {
        show(
          "Map background unavailable. Check the connection or try the other map view. Port overlays remain visible.",
        );
        return;
      }
      load(fallback);
      show(
        `${kind === "map" ? "Street map" : "Satellite imagery"} unavailable. Showing ${fallback === "map" ? "street map" : "satellite imagery"}.`,
      );
      onChange(fallback);
    });
    layer.addTo(map);
  }
  load(mode === "map" ? "map" : "satellite");
  return {
    get active() {
      return active;
    },
  };
}
