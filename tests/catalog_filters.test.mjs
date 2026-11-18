import test from "node:test";
import assert from "node:assert/strict";
import { filterCatalog, catalogOptions } from "../frontend/cargo.js";
const rows = [
  {
    id: "JPH-01",
    direction: "Export",
    product: "Fertilizer",
    grade: "DAP",
    subgrade: "Bangladesh",
  },
  {
    id: "JPH-02",
    direction: "Export",
    product: "Fertilizer",
    grade: "DAP",
    subgrade: "Black",
  },
  {
    id: "JPH-03",
    direction: "Export",
    product: "Phosphate rock",
    grade: "Standard",
    subgrade: "",
  },
  {
    id: "JPH-04",
    direction: "Import",
    product: "Sulfur",
    grade: "Standard",
    subgrade: "",
  },
];
test("catalogue combines structured filters and case-insensitive query words", () => {
  assert.deepEqual(
    filterCatalog(
      rows,
      { direction: "Export", grade: "DAP" },
      "fertilizer black",
    ).map((r) => r.id),
    ["JPH-02"],
  );
  assert.equal(filterCatalog(rows, { direction: "Import" }, "DAP").length, 0);
  assert.equal(filterCatalog(rows, {}, "JPH-04").length, 1);
});
test("blank subgrades are selectable without treating blank as all rows", () => {
  assert.deepEqual(
    filterCatalog(rows, { direction: "Export", subgrade: "__none__" }).map(
      (r) => r.id,
    ),
    ["JPH-03"],
  );
});
test("facets retain other constraints and do not mutate active filters", () => {
  const filters = { direction: "Export", product: "Fertilizer", grade: "DAP" };
  assert.deepEqual(catalogOptions(rows, filters, "subgrade"), [
    "Bangladesh",
    "Black",
  ]);
  assert.deepEqual(catalogOptions(rows, filters, "product"), [
    "Fertilizer",
    "Phosphate rock",
  ]);
  assert.deepEqual(catalogOptions(rows, filters, "direction"), [
    "Export",
    "Import",
  ]);
  assert.equal(filters.product, "Fertilizer");
});

test('dashboard throughput excludes zero totals and includes every active product', async () => {
  const {activeThroughputProducts}=await import('../frontend/cargo.js');
  const rows=[{name:'Zero',quantity:0},...Array.from({length:6},(_,i)=>({name:'Product '+i,quantity:i+1})),{name:'Unknown',quantity:NaN}];
  const result=activeThroughputProducts(rows);
  assert.equal(result.length,6);
  assert.equal(result[0].quantity,6);
  assert.equal(rows[0].name,'Zero');
});
