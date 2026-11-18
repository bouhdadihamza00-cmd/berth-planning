# Document imports

Open **Configuration → Document imports**. Operational analysis has its own **Operational assistant** navigation tab, with a **Document intelligence** shortcut to this workspace.

1. Upload a planning document (up to 8 MB); choose its date and date order when needed.
2. Local extraction reads tables or explicit key/value text. For unfamiliar layouts, abbreviations and narrative instructions, explicitly choose the configured client-hosted AI interpreter. No cloud fallback exists.
3. Check vessel matches and source references. Use **Map columns** to select a table, promote its actual header row, and map fields. Correct uncertain values in the row editor; corrected values are identified as manual entries rather than source quotes.
4. **Save planning proposals** creates normal approval drafts. New calls remain absent from the working plan until approved and published. Proposals with planning conflicts may be saved, but conflicts must be resolved before submission/publication.
5. **Apply selected changes** publishes valid new nominations when authorized. Existing-call updates must satisfy the configured automatic approval policy; otherwise use proposals and the normal departmental route. Imported actual status/progress and readiness changes require their corresponding operational permissions.

## Repeat uploads and automation

The same file content is recognized within its port and processing method to prevent duplicate imports. A new document version is reconciled with existing calls. Exact company references, IMO/MMSI and vessel names are used; ambiguous voyages require confirmation. A name matching a different planning period cannot silently overwrite another voyage. Explicitly choose **Create a new vessel call** in the row editor for a new voyage.

A reusable local table mapping can be saved as a template. Administrators can mark it for automatic application. Automatic application still needs the uploader's publication/creation permissions, complete source extraction, valid physical constraints, no warnings and the current approval policy. AI interpretations always require explicit human review and are not silently auto-applied during upload. Source documents cannot change roles or approval settings. Configuration discovery is available only when **Initialize configuration from documents** is enabled.

Fields absent from a document preserve existing values. A document's omission of a call never deletes or cancels that call. Every affected call, draft and published plan version retains import provenance. Quantities are tonnes, durations hours and vessel dimensions metres; units and date order must be unambiguous. Missing dimensions, exact times, readiness or equipment are not invented. Each working call has one configured cargo specification; multiple cargo lots need consolidation or separate confirmed calls before application.

## Initialize a fresh workspace

Select multiple documents and enable **Initialize configuration from documents** (preselected when products or berths are empty). Local initialization scans all workbook sheets, discovers product specifications, berths and equipment, and reconciles planning rows against the resulting configuration. Upload files containing specifications before planning when possible; later specification uploads also revalidate earlier initialization batches.

Complete, explicit local configuration can be created by an authorized administrator. Complete local planning can apply only when the uploader has the required permissions and existing publication rules allow it. Normal imports retain their previous review workflow.

Missing grades, dimensions, safety buffers, capacities, compatibility, ambiguous matches and conflicting configuration become **administrator requests** in the import preview and generate a **Document imports** notification. An administrator can review source references, enter confirmed missing values, then **Confirm and populate**, or skip the request. Configuration conflicts must be resolved in Configuration; imports never silently overwrite them. Every AI interpretation requires administrator confirmation. AI setup interpretation supports source-readable document text; image-only documents may still require OCR or manual confirmation.

No default grade, physical limit, readiness, equipment capacity, exact operation date or map geometry is invented. Created assets without surveyed geometry stay off the map. Port identity, users, roles, approval policy and other unsupported settings remain manually configured. The original files, extracted evidence and audit records are retained. **Restore previous plan** restores planning only, not configuration created during initialization.

## Recovery

**Restore previous plan** reverses a directly applied import or published proposals linked to it. Newly created calls are cancelled; existing calls regain their previous values. Imported delays/alerts are reversed only when unchanged. Any later vessel or event revision blocks restoration so newer work is not overwritten. Remaining proposals from a partially applied import are withdrawn. Original documents, audit entries and the restoration plan version remain retained.

## Formats and AI setup

See [document-formats.md](document-formats.md) for supported formats and extraction limits, and [ai-assistant.md](ai-assistant.md) for client-hosted deployment configuration. Text-readable PDFs and DOCX work locally; scanned PDFs need local OCR or page export to images with a configured vision-capable internal model. Legacy `.doc` needs conversion to `.docx`. Very wide scheduling workbooks may need a focused sheet/range export; incomplete tables are blocked from application.

The supplied daily workbook can be uploaded and mapped for review. Its multiple sections, abbreviations and conflicting alternative sheet must be contextualized; the importer does not assume those records are all new vessels. The older tailored Excel-demo importer remains separate.


The model adapter is implemented and tested against simulated provider responses. No live model has been configured or tested in this deployment. Local imports and deterministic bottleneck findings work without it.
