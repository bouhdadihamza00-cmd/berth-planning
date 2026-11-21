import test from "node:test";
import assert from "node:assert/strict";
import {insertWidget, MAX_WIDGET_ROW, snapWidgetTrack, occupiedWidgetColumns} from "../frontend/dashboard-grid.js";

const board = (columns, entries) => new Map(entries.map(([id, x, y, w = 1, h = 1]) =>
  [id, {column: (x - 1) * 2 + 1, row: y, width: Math.min(w, columns) * 2, height: h, tracks: columns * 2}]));
const move = (cells, id, column, row) => insertWidget(cells, id, {...cells.get(id), column: column * 2 - 1, row});
const positions = cells => Object.fromEntries([...cells].map(([id, cell]) => [id, [(cell.column + 1) / 2, cell.row]]));
function verify(cells, expected) {
  const occupied = new Set();
  assert.deepEqual([...cells.keys()].sort(), [...expected.keys()].sort());
  for (const [id, cell] of cells) {
    assert.equal(cell.width, expected.get(id).width);
    assert.equal(cell.height, expected.get(id).height);
    assert.ok(cell.column > 0 && cell.column + cell.width <= cell.tracks + 1);
    assert.ok(cell.row > 0 && cell.row <= MAX_WIDGET_ROW);
    for (let y = cell.row; y < cell.row + cell.height; y++) {
      for (let x = cell.column; x < cell.column + cell.width; x++) {
        const key = `${x},${y}`;
        assert.ok(!occupied.has(key), `${id} overlaps at ${key}`);
        occupied.add(key);
      }
    }
  }
}

test("a 1x1 insertion shifts the occupied run right and wraps at the row end", () => {
  const cells = board(4, [["a", 1, 1], ["b", 2, 1], ["c", 3, 1], ["d", 4, 1], ["e", 1, 2], ["drag", 2, 2]]);
  const next = move(cells, "drag", 2, 1);
  verify(next, cells);
  assert.deepEqual(positions(next), {a:[1,1], drag:[2,1], b:[3,1], c:[4,1], d:[1,2], e:[2,2]});
});

test("a 4x2 insertion at the top reserves both rows", () => {
  const cells = board(4, [["a",1,1], ["b",4,1], ["c",2,2], ["d",4,2], ["drag",1,4,4,2]]);
  const next = move(cells, "drag", 1, 1);
  verify(next, cells);
  assert.deepEqual(positions(next), {drag:[1,1], a:[1,3], b:[2,3], c:[3,3], d:[4,3]});
});

test("a 2x2 middle insertion moves a tall blocker and keeps unaffected gaps and anchors", () => {
  const cells = board(4, [["a",1,1,1,3], ["b",2,1,2,2], ["c",4,2], ["d",3,3], ["e",4,5], ["drag",1,6,2,2]]);
  const next = move(cells, "drag", 2, 2);
  verify(next, cells);
  assert.deepEqual(positions(next), {a:[1,1], drag:[2,2], b:[1,4], c:[3,4], d:[4,4], e:[4,5]});
});

test("repeated previews are deterministic and canceling leaves the committed baseline intact", () => {
  const cells = board(4, [["a",1,1], ["b",2,1], ["c",4,1], ["drag",3,2]]);
  const baseline = structuredClone(cells);
  const left = move(cells, "drag", 1, 1);
  const right = move(cells, "drag", 4, 1);
  const down = move(cells, "drag", 3, 3);
  for (const next of [left, right, down]) verify(next, cells);
  assert.deepEqual(move(cells, "drag", 1, 1), left);
  assert.deepEqual(cells, baseline);
  assert.deepEqual(positions(down), {...positions(baseline), drag:[3,3]});
  const committed = move(left, "drag", 4, 1);
  verify(committed, cells);
  assert.deepEqual(positions(committed), {drag:[4,1], a:[2,1], b:[3,1], c:[1,2]});
});

test("moving down into an occupied run leaves earlier rows and unneeded later anchors alone", () => {
  const cells = board(3, [["drag",1,1], ["a",2,1], ["b",1,2], ["c",2,2], ["d",3,4]]);
  const next = move(cells, "drag", 1, 2);
  verify(next, cells);
  assert.deepEqual(positions(next), {a:[2,1], drag:[1,2], b:[2,2], c:[3,2], d:[3,4]});
});

test("narrow grids wrap mixed sizes and reject an insertion that exceeds the persisted row limit", () => {
  const cells = board(2, [["a",1,1], ["b",2,1], ["drag",1,2,4,2]]);
  const next = move(cells, "drag", 1, 1);
  verify(next, cells);
  assert.deepEqual(positions(next), {drag:[1,1], a:[1,3], b:[2,3]});
  const full = board(2, [["a",1,MAX_WIDGET_ROW,2], ["drag",1,1,2]]);
  assert.equal(move(full, "drag", 1, MAX_WIDGET_ROW), null);
});

test("track hysteresis resists jitter and allows reversal or a jump across multiple slots", () => {
  assert.equal(snapWidgetTrack(1.59, 1, 5), 1);
  assert.equal(snapWidgetTrack(1.65, 1, 5), 2);
  assert.equal(snapWidgetTrack(1.45, 2, 5), 2);
  assert.equal(snapWidgetTrack(1.35, 2, 5), 1);
  assert.equal(snapWidgetTrack(7, 1, 9, 2), 7);
  assert.equal(snapWidgetTrack(5.9, 7, 9, 2), 7);
  assert.equal(snapWidgetTrack(5.7, 7, 9, 2), 5);
});

test("saved views trim outer columns while retaining interior gaps and the original coordinates", () => {
  const layout = [
    {id: "map", width: 3.5, position: {tracks: 16, column: 3, row: 1}},
    {id: "weather", width: 2, position: {tracks: 16, column: 11, row: 1}},
  ];
  const original = structuredClone(layout);
  assert.deepEqual(occupiedWidgetColumns(layout), {tracks: 16, offset: 2, count: 12});
  assert.deepEqual(layout, original);
  assert.equal(occupiedWidgetColumns([...layout, {id: "clock", width: 1}]), null);
  assert.equal(occupiedWidgetColumns([]), null);
});

test("reflow wraps at the fitted edge while keeping the saved grid coordinates", () => {
  const cells = board(8, [["a", 2, 1], ["b", 3, 1], ["drag", 2, 2]]);
  const target = {...cells.get("drag"), row: 1};
  const next = insertWidget(cells, "drag", target, {first: 3, last: 6});
  verify(next, cells);
  assert.deepEqual(positions(next), {drag:[2,1], a:[3,1], b:[2,2]});
});
