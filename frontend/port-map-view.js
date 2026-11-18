/** Boundary-based default view, with a 300 m metric scale at 100 px maximum width. */
export function portMapView(port) {
  const points = [];
  const collect = (value) => {
    if (!Array.isArray(value)) return;
    if (
      value.length >= 2 &&
      typeof value[0] === "number" &&
      typeof value[1] === "number"
    ) {
      if (Number.isFinite(value[0]) && Number.isFinite(value[1]))
        points.push(value);
    } else value.forEach(collect);
  };
  collect(port.boundary?.coordinates);
  let center;
  if (points.length) {
    center = [
      (Math.min(...points.map((p) => p[1])) +
        Math.max(...points.map((p) => p[1]))) /
        2,
      (Math.min(...points.map((p) => p[0])) +
        Math.max(...points.map((p) => p[0]))) /
        2,
    ];
  } else center = [...(port.center || [0, 0])].reverse();
  if (!points.length && center[0] === 0 && center[1] === 0)
    return { center, zoom: 2 };
  const latitude = Math.max(-85, Math.min(85, center[0]));
  // Leaflet rounds ~400 metres across a 100 px control down to the 300 m label.
  const zoom =
    Math.round(
      Math.log2(
        (Math.cos((latitude * Math.PI) / 180) * 40075016.68557849 * 100) /
          (256 * 400),
      ) * 10,
    ) / 10;
  return { center, zoom: Math.max(2, Math.min(19, zoom)) };
}
export function portMapBoundaryKey(port) {
  return JSON.stringify(port.boundary || port.center);
}
