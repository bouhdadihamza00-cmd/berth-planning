import test from "node:test";
import assert from "node:assert/strict";
import { buildTimeline, shiftAnchor } from "../frontend/timeline.js";
const make = (
  mode,
  anchor = "2023-11-28T08:00:00Z",
  timezone = "Africa/Casablanca",
) => buildTimeline({ mode, anchor, timezone, viewportWidth: 900, records: [] });
test("day, week, month and year fit their calendar period into the viewport", () => {
  for (const mode of ["day", "week", "month", "year"]) {
    const m = make(mode);
    assert.ok(
      Math.abs(((m.periodEnd - m.periodStart) / 3600000) * m.scale - 900) <
        1e-6,
    );
    assert.ok(m.start < m.periodStart);
    assert.ok(m.end > m.periodEnd);
    assert.ok(m.minor.length > 0 && m.major.length > 0);
    assert.ok(Number.isFinite(m.width));
  }
  assert.equal(make("day").visibleHours, 24);
  assert.equal(make("week").visibleHours, 168);
  assert.equal(make("month").visibleHours, 720);
  assert.equal(make("year").visibleHours, 8760);
});
test("calendar month and year include leap days and year boundaries", () => {
  const feb = make("month", "2024-02-15T12:00:00Z", "UTC");
  assert.equal(feb.visibleHours, 29 * 24);
  assert.equal(feb.periodStart.toISOString(), "2024-02-01T00:00:00.000Z");
  assert.equal(feb.periodEnd.toISOString(), "2024-03-01T00:00:00.000Z");
  assert.equal(
    make("year", "2024-02-29T12:00:00Z", "UTC").visibleHours,
    366 * 24,
  );
});
test("weeks start Monday in the port timezone and day lengths follow clock changes", () => {
  const week = make("week");
  assert.equal(week.periodStart.toISOString(), "2023-11-26T23:00:00.000Z");
  const day = make("day", "2024-03-10T12:00:00Z", "America/New_York");
  assert.equal(day.visibleHours, 23);
  assert.equal(day.periodStart.toISOString(), "2024-03-10T05:00:00.000Z");
});
test("month/year stepping clamps invalid dates and previous/next use the chosen unit", () => {
  assert.equal(
    shiftAnchor("2024-01-31T12:00:00Z", "month", 1, "UTC").toISOString(),
    "2024-02-29T12:00:00.000Z",
  );
  assert.equal(
    shiftAnchor("2024-02-29T12:00:00Z", "year", 1, "UTC").toISOString(),
    "2025-02-28T12:00:00.000Z",
  );
  assert.equal(
    shiftAnchor("2023-11-28T08:00:00Z", "week", -1, "UTC").toISOString(),
    "2023-11-21T08:00:00.000Z",
  );
});
test("navigation covers source data without rendering an unbounded calendar", () => {
  const records = [
    { start: "2023-11-20T00:00:00Z", end: "2023-12-20T00:00:00Z" },
    { start: "1900-01-01", end: "9999-01-01" },
    { start: "bad", end: null },
  ];
  const m = buildTimeline({
    mode: "day",
    anchor: "2023-11-28T08:00:00Z",
    timezone: "UTC",
    viewportWidth: 600,
    records,
  });
  assert.ok(m.start <= new Date(records[0].start));
  assert.ok(m.end >= new Date(records[0].end));
  assert.ok(m.minor.length < 1200);
  assert.ok(m.width > 600);
  assert.throws(() => make("unsupported"), /scale/i);
});
test("timeline labels use the requested display locale without changing calendar geometry", () => {
  const input = {mode: "week", anchor: new Date("2026-11-18T12:00:00Z"), timezone: "Africa/Casablanca", viewportWidth: 1000};
  const english = buildTimeline({...input, locale:"en-GB"});
  const french = buildTimeline({...input, locale:"fr-MA"});
  assert.equal(+english.start, +french.start);
  assert.equal(english.width, french.width);
  assert.notDeepEqual(english.minor.map(x=>x.label), french.minor.map(x=>x.label));
});
