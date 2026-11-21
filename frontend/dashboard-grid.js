// The persisted dashboard uses one-based coordinates and two tracks per KPI column.
export const MAX_WIDGET_ROW = 256;

export const rowMajor = (a, b) => a.row - b.row || a.column - b.column;

export function insertWidget(cells, id, target, {first = 1, last = target.tracks} = {}) {
  const {tracks, column, row, width, height} = target;
  if (!cells.has(id) || column < first || column + width > last + 1 || row < 1 || row > MAX_WIDGET_ROW) return null;

  const occupied = [];
  const result = new Map();
  const reserve = (key, cell) => {
    for (let y = cell.row; y < cell.row + cell.height; y++) {
      occupied[y] ??= new Uint8Array(tracks);
      occupied[y].fill(1, cell.column - 1, cell.column - 1 + cell.width);
    }
    result.set(key, cell);
  };
  const fits = cell => {
    for (let y = cell.row; y < cell.row + cell.height; y++) {
      for (let x = cell.column - 1; x < cell.column - 1 + cell.width; x++) {
        if (occupied[y]?.[x]) return false;
      }
    }
    return true;
  };
  const columns = last - first + 1;
  const index = cell => (cell.row - 1) * columns + cell.column - first;
  const neighbors = [...cells].filter(([key]) => key !== id).sort(([, a], [, b]) => rowMajor(a, b));

  reserve(id, target);
  // An empty target only moves the dragged item, even when there are gaps earlier in the grid.
  if (neighbors.every(([, cell]) => fits(cell))) return new Map(cells).set(id, target);

  // Keep the unaffected prefix in place, including tall widgets extending into later rows.
  const displaced = neighbors.filter(([key, cell]) => {
    if (rowMajor(cell, target) >= 0 || !fits(cell)) return true;
    reserve(key, cell);
    return false;
  });
  let cursor = index(target);
  for (const [key, cell] of displaced) {
    cursor = Math.max(cursor, index(cell));
    for (;;) {
      const next = {...cell, column: cursor % columns + first, row: Math.floor(cursor / columns) + 1};
      if (next.row > MAX_WIDGET_ROW) return null;
      cursor++;
      if (next.column + next.width <= last + 1 && fits(next)) {
        reserve(key, next);
        break;
      }
    }
  }
  return result;
}

export function snapWidgetTrack(value, current, max, step = 1, origin = 1) {
  const margin = step * .12;
  if (Math.abs(value - current) <= step / 2 + margin) return current;
  const biased = value - Math.sign(value - current) * margin;
  return Math.min(max, Math.max(1, origin + Math.round((biased - origin) / step) * step));
}

export function occupiedWidgetColumns(layout) {
  const tracks = layout[0]?.position?.tracks;
  if (!tracks || !layout.every(card => card.position?.tracks === tracks)) return null;
  const first = Math.min(...layout.map(card => card.position.column));
  const end = Math.max(...layout.map(card => card.position.column + Math.min(tracks, card.width * 2)));
  return {tracks, offset: first - 1, count: end - first};
}
