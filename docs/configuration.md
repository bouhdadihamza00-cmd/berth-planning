# Configuration

Configuration is grouped into seven sections:

- **General app configuration**: application preferences.
- **People**: users, roles, per-port permissions and departments.
- **Ports**: port and organization inventory, the selected port's geographic editor, berths and equipment.
- **Products & Cargo**: product catalogue, flow, grades and sub-grades.
- **Rules**: a searchable list of approval, automation, scheduling, cargo access, berth and equipment rules. Edit opens a dedicated page; mandatory validation has a read-only explanation.
- **Document Imports**: document extraction, workspace initialization and administrator review.
- **External Integration**: one inventory for AIS and saved HTTP API / OPC UA connectors, including ERP, weather, inventory, production and equipment data categories. Selecting a connector opens its editor.

## Approval workflow

The schedule workflow supports 1–50 named steps. Each step assigns a department or specific active port members with approval permission. Choose whether any one or all assigned reviewers must approve. Routes can run sequential steps or parallel steps; sequential steps cannot be skipped. Steps can be added, removed and reordered.

New proposals capture the route and eligible reviewers. Existing proposals retain their captured route. When author/reviewer separation is enabled, the author is excluded from a new proposal's assigned reviewers; a step with no remaining eligible reviewers blocks creation until an administrator fixes the route. Reviewers still need current approval permission when recording a decision. Clarification resets decisions; rejection ends the request.

Manual, semi-automatic and automatic policies remain separate rules. Automation still requires clean validation, configured shift/duration thresholds, appropriate permissions and agreement between the captured and current policies. Physical safety and booking conflicts are always checked before approval/publication.

## Integration status

AIS uses the existing server-side tracking adapter. HTTP API and OPC UA entries currently store endpoint, server credential reference, polling settings and read-only field/NodeId mappings. They do not yet poll APIs, establish OPC UA sessions or update equipment. The list and editor explicitly show this status; defining a weather or ERP source does not activate a live feed. Runtime adapters and deployment-specific endpoints are required for these connections.

## Product appearance and specifications

Each product card has a palette button. Choose a built-in icon or upload a PNG, JPEG or WebP (256 KB and 1024 × 1024 pixels maximum), then set its color. Uploaded images can retain their original colors or use an optional monochrome tint. Icons are stored per port and reused by catalogue cards and dashboard throughput.

Click a specification row to select it. Edit includes a confirmed deletion action for that grade/sub-grade specification. Specifications referenced by vessel calls or pending proposals are protected from deletion. Removing a specification does not remove its main product.

Dashboard throughput shows only products with a positive total in the current reporting period, ordered by volume, without a four-product cap. New active products appear automatically as throughput records update.

## Port infrastructure and map view

The Ports directory opens each selected port's combined berth/equipment inventory through **Configure**. Filter the inventory by type or search by name. **Place on map** or **Reposition** starts the appropriate drawing tool for that existing asset. Saving the position preserves its operational settings and returns to the inventory; cancelling leaves records unchanged.

The dashboard initially centers on the saved port boundary's bounding-box center, falling back to the configured port coordinates when no boundary exists. Its default zoom is adjusted for latitude so the 100-pixel metric scale reads **300 m**. **Recenter port** restores this view. Manual pan/zoom survives routine refreshes, while a changed saved boundary resets the default view.
