const METRES_PER_WORLD = 40075016.686;

export function aisObservationPresentation(position) {
  const satellite = position.is_satellite === true ||
    String(position.name || "").trim().toUpperCase() === "[SAT-AIS]";
  const kind = String(position.entity_type || position.ship_type || "").trim().toLowerCase();
  const nonVessel = ["buoy", "beacon", "aid to navigation", "aton", "base station"].includes(kind);
  return {
    point: satellite || nonVessel,
    label: satellite ? "Unidentified AIS observation" : nonVessel ? "AIS object" : "Observed vessel",
    icon: satellite || nonVessel ? "circle" : "ship",
  };
}

// Use vessel length in map metres, rather than a fixed-size screen symbol.
export function vesselDimensions(loa, latitude, zoom) {
  const length = Number(loa) > 0 ? Number(loa) : 200;
  const metresPerPixel =
    (METRES_PER_WORLD * Math.cos((latitude * Math.PI) / 180)) / 2 ** (zoom + 8);
  const width = Math.max(10, Math.min(128, length / metresPerPixel));
  const height = (width * 28) / 74;
  return {
    width,
    height,
    hitWidth: Math.max(24, width),
    hitHeight: Math.max(24, height),
  };
}

function bearing(position) {
  for (const value of [position.heading, position.course]) {
    if (
      (typeof value !== "number" && typeof value !== "string") ||
      (typeof value === "string" && !value.trim())
    )
      continue;
    const angle = Number(value);
    if (Number.isFinite(angle) && angle >= 0 && angle < 360) return angle;
  }
  return null;
}

function dimensions(position, call, zoom) {
  if (!call && aisObservationPresentation(position).point) {
    const diameter = Math.max(12, Math.min(48, 24 * 2 ** (zoom - 16)));
    return { width: diameter, height: diameter, rotatedWidth: diameter, rotatedHeight: diameter,
      hitWidth: Math.max(24, diameter), hitHeight: Math.max(24, diameter), rotation: 0, heading: null };
  }
  const size = vesselDimensions(
    call?.loa || position.loa,
    position.position[1],
    zoom,
  );
  const heading = bearing(position);
  // The SVG bow points east; AIS bearings start at north and turn clockwise.
  const rotation = heading == null ? 0 : heading - 90;
  const radians = (rotation * Math.PI) / 180;
  const rotatedWidth =
    Math.abs(size.width * Math.cos(radians)) +
    Math.abs(size.height * Math.sin(radians));
  const rotatedHeight =
    Math.abs(size.width * Math.sin(radians)) +
    Math.abs(size.height * Math.cos(radians));
  return {
    ...size,
    heading,
    rotation,
    rotatedWidth,
    rotatedHeight,
    hitWidth: Math.max(24, rotatedWidth),
    hitHeight: Math.max(24, rotatedHeight),
  };
}

function icon(leaflet, position, call, color, zoom) {
  const size = dimensions(position, call, zoom);
  if (!call && aisObservationPresentation(position).point)
    return leaflet.divIcon({
      className: "ship-marker ais-point-marker",
      iconSize: [size.hitWidth, size.hitHeight], iconAnchor: [size.hitWidth / 2, size.hitHeight / 2],
      html: `<svg width="${size.width}" height="${size.height}" viewBox="0 0 16 16" aria-hidden="true" style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);filter:drop-shadow(0 0 2px #102d40)"><circle cx="8" cy="8" r="6" fill="${color}" stroke="#ffffff" stroke-width="2"/><circle cx="8" cy="8" r="3" fill="#173a4d"/></svg>`,
    });
  return leaflet.divIcon({
    className: "ship-marker",
    iconSize: [size.hitWidth, size.hitHeight],
    iconAnchor: [size.hitWidth / 2, size.hitHeight / 2],
    html: `<div class="vessel-target" style="position:relative"><div class="vessel-silhouette ${position.stale ? "is-stale" : ""}" style="position:absolute;left:50%;top:50%;--vessel-color:${color};--vessel-glow:${Math.min(3, size.width / 24)}px;width:${size.width}px;height:${size.height}px;transform:translate(-50%,-50%) rotate(${size.rotation}deg)"><svg width="${size.width}" height="${size.height}" viewBox="0 0 92 34" aria-hidden="true">${size.heading == null ? '<circle class="vessel-hull" cx="46" cy="17" r="12"/><circle cx="46" cy="17" r="3" fill="currentColor"/>' : '<path class="vessel-halo" d="M10 5H62Q80 5 89 17Q80 29 62 29H10Q5 29 5 24V10Q5 5 10 5Z"/><path class="vessel-hull" d="M10 5H62Q80 5 89 17Q80 29 62 29H10Q5 29 5 24V10Q5 5 10 5Z"/><path d="M13 8H23V26H13Z" fill="currentColor" opacity=".9"/><path d="M11 11H25V14H11Z" fill="#f8fafc" opacity=".9"/><rect x="30" y="10" width="12" height="14" rx="2"/><rect x="46" y="10" width="12" height="14" rx="2"/><path d="M64 11Q76 12 81 17Q76 22 64 23Z"/><path d="M9 17H4M7 10L3 8M7 24L3 26" opacity=".7"/>'}</svg></div></div>`,
  });
}

export function mountVessels(
  map,
  { positions, calls, colors, esc, onSelect, leaflet = window.L },
) {
  function bindLabel(marker, position, call) {
    const size = dimensions(position, call, map.getZoom());
    const presentation = aisObservationPresentation(position);
    const content = `<b>${esc(call?.name || position.name)}</b><br><small>${esc(call?.status || (presentation.point ? presentation.label : position.navigation_label) || "AIS position")}${call ? " · " + esc(call.product) : ""}${position.stale ? " · Stale position" : ""}</small>`;
    marker.unbindTooltip();
    marker.bindTooltip(content, {
      permanent: false,
      direction: "top",
      offset: [0, -size.rotatedHeight / 2 - 5],
      className: "ship-label",
      opacity: 1,
    });
  }
  const entries = positions.map((position) => {
    const call = calls.find((c) => c.id === position.id);
    const color = colors[call?.status] || "#bfdae9";
    const marker = leaflet
      .marker([...position.position].reverse(), {
        icon: icon(leaflet, position, call, color, map.getZoom()),
        title: `${call?.name || position.name} · ${call?.status || position.navigation_label || "AIS position"}`,
        alt: call?.name || position.name,
      })
      .addTo(map);
    bindLabel(marker, position, call);
    marker.on("click", () => {
      marker.openTooltip();
      onSelect(call, position);
    });
    return { marker, position, call, color };
  });
  let drawnZoom = map.getZoom();
  function update() {
    const zoom = map.getZoom();
    if (zoom === drawnZoom) return;
    for (const entry of entries) {
      const { marker, position, call, color } = entry;
      marker.setIcon(icon(leaflet, position, call, color, zoom));
      bindLabel(marker, position, call);
    }
    drawnZoom = zoom;
  }
  map.on("zoomend moveend resize", update);
  update();
  return {
    markers: entries.map((entry) => entry.marker),
    destroy() {
      map.off("zoomend moveend resize", update);
      entries.forEach((entry) => entry.marker.remove());
    },
  };
}
