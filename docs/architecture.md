# Data and service boundaries

`organizations` own `ports`. Each `membership` assigns a user a department, role label and explicit permission set for one port. A non-superadmin must have membership and the same organization as the port. Operational records always carry `port_id` and a resource `kind`.

| Record | Shared behavior |
| --- | --- |
| Port boundary, center, rules, products, workflow | Port-scoped versioned configuration |
| Berth | Stored geometry and physical constraints drive both map and timeline |
| Equipment | Stored position, berth reach, capacity and availability drive map and planning |
| Call | Nomination, cargo, allocation, readiness, actuals and progress |
| Delay | Analytics, operational alert, notification, optional equipment outage |
| Draft | Original call revision, proposed values, justification, routing and decisions |
| Version | Immutable-in-content call and berth snapshot; publication status can become superseded |
| Scenario | Input assumptions, CP-SAT result, impact totals and recommendations |
| Audit | Actor, time, entity, action and before/after data where applicable |

## Transaction and concurrency behavior

The store rejects updates without the current revision. SQL updates also compare that revision, checking the affected row count. Publication checks the draft state, every current hard constraint and the call revision. Updating the call, superseding the prior version, inserting a new version, changing draft state and writing audit/notification events commit together. No endpoint permits a general vessel record overwrite that could bypass the draft workflow.

Calls are nominations when created. Assigning a berth makes a nomination visible on the timeline; it can carry unresolved planning constraints. Changes made through the draft workflow are validated again on submission, review and publication. Operational updates and production readiness are authorized through dedicated endpoints and increment revisions, preventing an old approved draft from silently overwriting newer actual/readiness records.

## Production evolution

Move the store to PostgreSQL with tenant-scoped foreign keys and row-level isolation before scaling to untrusted organizations. Replace JSON-heavy resource storage with typed tables and SQLAlchemy/Alembic migrations as the domain stabilizes. Add PostGIS spatial indexes/topology validation for surveyed areas. Keep the same planning validator and event boundaries when adding ERP, AIS or notification workers. Add durable jobs and a transactional outbox before distributed delivery.

The frontend uses no service credentials. It derives its visible capabilities from the authenticated membership, while API checks remain authoritative. The same-origin application returns operational dashboard data to users with dashboard view access; sensitive membership/audit details are separate endpoints. Server-derived collections for drafts, versions and scenarios require their corresponding read permissions.
