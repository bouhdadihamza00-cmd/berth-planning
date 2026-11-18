# Public distribution verification

The public app starts with schema only. `scripts/create_workspace.py` creates an owner-selected administrator and an empty port; it refuses to overwrite existing users. Existing operational databases are preserved on startup.

Tests use temporary databases and explicit synthetic fixtures. No private workbook or catalogue file is needed. Empty-install tests verify zero startup records, owner login, disabled tracking, restart persistence, refusal to overwrite and exclusion of public HTML-preview output paths.

README screenshots were captured from a separate synthetic Example Harbor workspace on a public Rotterdam backdrop. They do not represent surveyed port geometry, customer vessel calls or a live AIS connection. No screenshot workspace is loaded by normal startup.

Local databases, credentials, uploaded documents and exports are ignored by Git. Historical screenshots, captured AIS fixtures, operational HTML previews and customer-specific automatic imports are removed from the public tree and its replacement history.

Browser validation was performed in Chrome. Other browsers and production deployment were not verified in this pass.
