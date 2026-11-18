# Planning document extraction

Document extraction reads source observations. It does not execute macros, recalculate spreadsheet formulas, follow embedded links, run document instructions, or infer missing operational values. Interpretation and matching happen separately in the import review workflow.

## Supported formats

| Format | Local extraction | Source references and limitations |
| --- | --- | --- |
| `.xlsx`, `.xlsm` | Spreadsheet cells, cached formula results, dates, sheets | `Sheet name!R12`. Macros are never executed. Formulas without cached values remain unknown and generate a warning. |
| `.xls` | Legacy workbook cells, cached results and formatted dates | Uses the workbook's 1900/1904 date system. Requires `xlrd`. Error cells remain unknown. |
| `.xlsb` | Binary workbook rows and cells | Requires `pyxlsb`. Date serials stay numeric because cell formatting does not reliably establish dates; review the interpretation. |
| `.csv`, `.tsv` | Delimited rows | CSV accepts comma, semicolon, tab or pipe separators. `R12` means the physical starting line, including when quoted cells span several lines. UTF-8, BOM-marked UTF-16 and Windows-1252 text are supported; fallback decoding is disclosed. |
| `.docx` | Body paragraphs and tables | `P12` or `Table 2!R3`. Embedded attachments, drawings, headers and footers are not imported. External links are not followed. |
| `.pdf` | Page text | `Page 3`. Pages without readable text are flagged as needing OCR or a vision-capable service. Requires `pypdf >=6.21` for bounded stream decoding. |
| `.txt`, `.md` | Lines of text | `L12`. Dates and instructions remain source text until interpreted. |
| `.png`, `.jpg`, `.jpeg` | Image validation only | Requires Pillow. These inputs are flagged as needing OCR or vision processing; local extraction does not claim to read the image. Maximum 40 megapixels. |

Legacy Word `.doc`, encrypted files, invalid file/extension combinations and unsupported formats are rejected with conversion guidance. Password-protected PDF or Office documents must be exported as unlocked copies before import.

## Tables and review

The first nonempty row is exposed as the initial table header. Duplicate or empty column names receive unique names, such as `Column 2` or `Vessel (2)`. Repeated identical header rows are skipped. Actual source row references are retained after blank rows or repeated headers. Numeric zero is preserved; blank/unreported cells stay unknown. Date values are serialized without inventing a timezone.

An unfamiliar scheduling workbook may place titles, notes, merged headings, timeline date grids and helper dashboards before its vessel table. Extraction preserves these observations for contextual interpretation; it does not claim that the initial column mapping is correct. Select the relevant table/sheet and inspect its rows. Such documents may need AI interpretation or explicit mapping rather than immediate automatic application.

Each extracted table has a `truncated` flag, in addition to the document-wide flag. A completely extracted selected table can be reviewed independently of a later helper/history sheet that reached a limit. A selected table marked truncated must not be used to silently replace a full schedule. AI interpreting the whole document must also respect document-wide truncation and request a smaller or more focused source.

## Resource bounds

Uploads are limited to **8 MB**. ZIP-based Office containers are checked before their readers run: at most 2,500 archive entries, 64 MB total expanded bytes, 48 MB per entry, and a bounded compression ratio. Unsafe archive paths, encrypted entries and XML entity declarations are rejected. No archive is extracted to a persistent filesystem directory.

Extraction is bounded to 5,000 data rows, 20,000 scanned rows, 2,048 columns, 200,000 stored text characters and 100 PDF pages. Limits are explicit: output flags truncation and includes warnings instead of claiming completeness. PDF decompression, parsing work and object traversal also have limits. XLSB processing uses a private temporary file that is deleted after reading.

These are extraction limits, not guarantees that every document layout can be understood. Scanned pages require a separately configured OCR/vision capability. Dates such as “tomorrow”, incomplete years, conflicting quantities or unidentified vessels require contextual review rather than guessed application data.

## Verification

`python -m unittest tests.test_document_extract -v` exercises actual generated Excel, Word, PDF, CSV and PNG files, including source references, zero/unknown values, cached-formula behavior, encrypted PDF rejection, XML entity/container defenses, per-table completeness, row/page/text limits and bounded PDF decoding. No real client document is sent to an external service by these tests.
