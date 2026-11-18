# Configuration workflows

## Map and shared assets

Use **Configuration → Geographic configuration → Berth**. Click two endpoints and **Finish drawing**, then select an existing quai/berth or create a new one. Equipment uses the same assignment dialog after placing a marker. Closing the dialog cancels the new geometry. There is one polygon tool: **Port boundary**.

**Berths & equipment → Add berth / Add equipment** also creates operational assets without requiring map geometry. They become available in shared lists and planning. Draw and assign their map geometry later. Removing geometry keeps the operational asset and existing vessel allocations. Staged removals are saved before assigning new geometry; they are not reloaded when changing drawing tools.

## Planning and approval

**Planning rules** provides duration/safety sliders, individual berth limits, and named cargo access rules. Each access rule matches optional import/export, product, grade and sub-grade conditions. Allow rules restrict matching cargo to the union of selected berths; Deny takes precedence. Vessel dimensions, cargo compatibility, readiness, equipment capacity and overlaps remain mandatory. Validation, publication and scenario optimization use the same policies.

**Approval workflows** configures departmental review and bounded automation:

- Manual: reviewers approve, then an authorized publisher publishes.
- Semi-automatic: eligible changes become approved; publication remains explicit.
- Automatic: eligible changes are approved and published when the submitting user already has Publish permission. Otherwise they stop at Approved.

Eligibility requires no errors or warnings, unchanged cargo/quantity/equipment, configured start/duration thresholds, and permitted berth reassignment. Both the route captured on the draft and current policy must permit automation. Larger changes fall back to departmental review. Decisions and resulting published versions are recorded. Revision checks prevent overwriting concurrent vessel changes.

## Data connectors

**External integrations → Data APIs & OPC UA** saves connector definitions per port. Choose inventory, production, vessel calls, weather, equipment or quality data. HTTP API definitions record the endpoint, polling interval, server credential-reference name and read-only field mappings. OPC UA also records message security, security policy and NodeId mappings, including engineering units.

These new connectors are **configuration only**: no endpoint polling, tag reads, certificate provisioning or field commands are implemented. Status says “Configured · not connected”. Credentials and certificates must remain on the server; configuration accepts an environment-variable reference, not a secret. The existing AIS connector remains separate.

## Appearance and lists

General settings contains per-user browser preferences for theme, text size, density, motion, contrast and language. The application name is not editable. French/Arabic translate known interface labels and regional formats; source descriptions and vessel names remain unchanged. Tables and lists scroll inside the fixed operator screen, with search and relevant filters instead of page controls. Product catalogue filters cascade across flow, product, grade and sub-grade.

For custom workbook-aligned reporting, see [custom-reports.md](custom-reports.md).

## Terminating and deleting approval workflows

The initiator (or a super administrator) can terminate an unpublished workflow from Workflow center → Approvals. Termination sets the ticket to Cancelled and prevents further submission, approval or publication. It works even if the proposal is invalid or its original call no longer exists. The published plan is unchanged.

The initiator can also delete their workflow ticket at any stage, including after termination. Deletion removes the ticket from the approval list while retaining its audit history and published versions. Deleting a published ticket does not undo its published vessel changes. Both actions check the current ticket revision and require port access.
