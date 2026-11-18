# Custom Portside reports

Open **Workflow center → Reports**. Select a dataset, a data version and any date interval, then generate the preview. Empty dates include the full history. Empty filter selections include all values; Command/Control supports multiple values. Choose report columns after generating the first preview. Download CSV, Excel or PDF with the same filters. The preview is bounded to 500 rows; downloads include up to 10,000 rows and require narrower filters beyond that limit. Tables scroll normally, without pagination.

## Source and working versions

**Original workbook snapshot** reads immutable `source_snapshot` values stored on imported calls, and original `source_plans`. The 28 November 2023 daily report has 60 distinct vessel calls and 69 cargo lots. The daily situation and lot reports have one row per cargo lot; vessel lineup has one row per call. The lot report reproduces daily fertilizer 38,182 t, phosphoric acid 12,140 t and sulfur 12,144 t, and waiting sulfur nominations 453,833.998 t. Source file, sheet and row/cell fields preserve provenance. The report date is the date of the source document, including its expected and waiting calls; it is not each vessel's ETA. Daily observations are the workbook's 07:00 figures. Macro workbooks supply planning slots of 12-hour precision.

**Current working version** reads editable port records, including delays and approval decisions. Workbook daily throughput is excluded because edits are not dated measured tonnage. Working cumulative handled and remaining tonnage are estimates from current nominated quantity multiplied by progress, rather than stale original totals. A working cargo specification report has one current cargo specification per call; the original version retains the full multi-lot breakdown. Historical measured daily throughput is not inferred from changes to progress or nominations. Blank numeric cells mean unknown/not reported, while numeric zero remains zero. All amounts are tonnes.

Date filters can use the workbook date (or current planned start), ETA, planned start/completion, actual arrival/start/completion, recorded event time, or any overlap with the planned interval. Date-only end values include that entire day in the port time zone. There is no artificial 24-hour/30-day maximum period. Undated records cannot match a date filter.

Available datasets: Portside daily situation, vessel lineup, cargo lots/specifications, berth planning, delays, actual milestones, readiness, approval decisions, schedule changes and equipment. Approvals have one row per recorded decision. Original workbooks do not contain structured approval, delay, readiness-event or equipment records; where unavailable, the report states this rather than inventing data. Readiness uses the explicit imported readiness status. Original berth planning is a segment report: repeated segments and grids do not establish unique cargo nominations, so its summary suppresses nominated-tonnage totals.

Grouping supports product, grade, quai/berth, direction, status, day, week (Monday), month and year. Summaries are computed before grouping at the selected dataset's row grain. Vessel counts use distinct call references, and cargo lot quantities are not joined to planning segments. Grouped planning segment quantities can repeat across source grids; use cargo lots for nominations. Date grouping uses the selected date field. With workbook-date selection, undated working records fall back to recorded event time or planned start; planned-overlap grouping uses planned start.

## API

`POST /api/ports/{port}/reports/query` requires `reports.view`; `POST /api/ports/{port}/reports/custom-export` requires `reports.export`. Both enforce authenticated port membership. Existing legacy export URLs remain supported.

Example request:

```json
{
  "dataset": "cargo_lots",
  "origin": "original",
  "start": "2023-11-28",
  "end": "2023-11-28",
  "date_basis": "report_date",
  "products": ["Sulfur"],
  "statuses": ["Waiting"],
  "columns": ["vessel", "quantity", "grade", "source_row"],
  "group_by": "none",
  "limit": 500
}
```

Optional array filters: `directions`, `products`, `grades`, `subgrades`, `berths`, `statuses`. Berths accept code or ID. Optional text filters: `customer`, `supplier`, `search` (case-insensitive contains). Query returns field definitions, selected columns, rows, summary, total row count, truncation flag, generation timestamp and interpretation notes. Export adds `format: "csv" | "xlsx" | "pdf"`. Selected numeric Excel cells remain numeric. Potential spreadsheet formulas in string cells are escaped. XLSX includes a context sheet; PDF repeats headings and divides wide column selections into readable sections. Export actions are audited.

Integration: import and call `register_reporting(app, access)` from `backend.reporting` after the shared access function is defined. Frontend `workflows.js` imports `renderReports()` and `bindReports()` from `reporting.js`.
