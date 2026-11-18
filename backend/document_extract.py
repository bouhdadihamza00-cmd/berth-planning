"""Bounded, non-executing extraction of planning documents with source references.

This module extracts observations only. It does not infer planning dates, execute
workbook macros/formulas, follow links, or interpret document instructions.
"""
from __future__ import annotations

import csv
import io
import math
import tempfile
import zipfile
from datetime import date, datetime, time
from pathlib import Path
from xml.etree import ElementTree as ET

MAX_BYTES = 8 * 1024 * 1024
MAX_PAGES = 100
MAX_ROWS = 5000
MAX_SCAN_ROWS = 20000
MAX_TEXT = 200000
MAX_COLUMNS = 2048
MAX_ARCHIVE_BYTES = 64 * 1024 * 1024
MAX_ENTRY_BYTES = 48 * 1024 * 1024
MAX_PDF_STREAM = 8 * 1024 * 1024


class _ExtractionError(ValueError):
    """Messages deliberately safe for display to a document uploader."""


SUPPORTED = {'.xlsx', '.xlsm', '.xlsb', '.xls', '.csv', '.tsv', '.txt', '.md', '.docx', '.pdf', '.png', '.jpg', '.jpeg'}


def _value(value):
    if value is None or isinstance(value, (bool, int)):
        return value
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if isinstance(value, (datetime, date, time)):
        return value.isoformat()
    return str(value)


def _text(value):
    return '' if value is None else str(value)


class _Output:
    def __init__(self, format):
        self.result = dict(format=format, blocks=[], tables=[], warnings=[], needs_ocr=False, truncated=False)
        self.characters = 0
        self.rows = 0
        self.scanned_rows = 0
        self.active_table = None

    def warn(self, message):
        if message not in self.result['warnings']:
            self.result['warnings'].append(message)

    def truncate(self, message):
        self.result['truncated'] = True
        if self.active_table is not None:
            self.active_table['truncated'] = True
        self.warn(message)

    def text(self, value):
        value = _text(value)
        available = max(0, MAX_TEXT - self.characters)
        if len(value) > available:
            value = value[:available]
            self.truncate(f'Extraction reached the {MAX_TEXT:,}-character limit. Split the document before importing.')
        self.characters += len(value)
        return value

    def block(self, ref, text):
        text = self.text(text)
        if text.strip():
            self.result['blocks'].append(dict(ref=str(ref), text=text))

    def table(self, name, source_rows):
        """First nonempty row is a header; all later source rows keep their refs."""
        table = dict(name=str(name), headers=[], rows=[], truncated=False)
        self.active_table = table
        original_headers = None
        try:
            for ref, raw in source_rows:
                self.scanned_rows += 1
                if self.scanned_rows > MAX_SCAN_ROWS:
                    self.truncate('Extraction reached the scanned-row limit. Split the workbook or remove unused rows.')
                    break
                raw = list(raw)
                if len(raw) > MAX_COLUMNS:
                    raw = raw[:MAX_COLUMNS]
                    self.truncate(f'Only the first {MAX_COLUMNS} columns were extracted.')
                values = [_value(v) for v in raw]
                while values and (values[-1] is None or values[-1] == ''):
                    values.pop()
                if not any(v is not None and _text(v).strip() for v in values):
                    continue
                if original_headers is None:
                    original_headers = [_text(v).strip() for v in values]
                    used = set()
                    for index, text in enumerate(original_headers):
                        base = text or f'Column {index + 1}'
                        header, count = base, 1
                        while header in used:
                            count += 1
                            header = f'{base} ({count})'
                        used.add(header)
                        table['headers'].append(self.text(header))
                    self.result['tables'].append(table)
                    self.block(ref, ' | '.join(_text(v) for v in values))
                    continue
                if [_text(v).strip() for v in values] == original_headers:
                    continue
                if self.rows >= MAX_ROWS:
                    self.truncate(f'Only the first {MAX_ROWS:,} data rows were extracted. Split the document before importing.')
                    break
                while len(table['headers']) < len(values):
                    table['headers'].append(f'Column {len(table["headers"]) + 1}')
                converted = [self.text(v) if isinstance(v, str) else v for v in values]
                table['rows'].append(dict(ref=str(ref), values=converted))
                self.rows += 1
                self.block(ref, ' | '.join(_text(v) for v in values))
                if self.characters >= MAX_TEXT:
                    break
            for row in table['rows']:
                row['values'] += [None] * (len(table['headers']) - len(row['values']))
            return table if original_headers is not None else None
        finally:
            self.active_table = None


def _archive(content, required):
    """Validate before handing ZIPs to readers; never extract entries to disk."""
    try:
        archive = zipfile.ZipFile(io.BytesIO(content))
        entries = archive.infolist()
        if len(entries) > 2500:
            raise _ExtractionError('Document archive has too many entries.')
        total = 0
        for item in entries:
            normalized = item.filename.replace('\\', '/')
            if normalized.startswith('/') or '..' in normalized.split('/'):
                raise _ExtractionError('Document archive contains an unsafe entry path.')
            if item.flag_bits & 1:
                raise _ExtractionError('Password-protected documents are not supported. Upload an unlocked copy.')
            total += item.file_size
            if item.file_size > MAX_ENTRY_BYTES or total > MAX_ARCHIVE_BYTES:
                raise _ExtractionError('Expanded document is too large. Split it into smaller documents.')
            if item.file_size > 1024 * 1024 and item.file_size > max(item.compress_size, 1) * 300:
                raise _ExtractionError('Document archive has an unsafe compression ratio.')
        if not all(name in archive.namelist() for name in required):
            raise _ExtractionError('Document contents do not match its file extension.')
        # Reject entity declarations before any XML parser or workbook reader runs.
        for item in entries:
            if item.filename.lower().endswith(('.xml', '.rels')):
                xml = archive.read(item)
                declarations = xml.upper().replace(b'\x00', b'')
                if b'<!DOCTYPE' in declarations or b'<!ENTITY' in declarations:
                    raise _ExtractionError('XML entity declarations are not allowed in planning documents.')
        return archive
    except (zipfile.BadZipFile, RuntimeError, EOFError, OSError) as exc:
        raise _ExtractionError('The document archive is damaged, encrypted or unsupported.') from exc


def _xlsx(content, output):
    from openpyxl import load_workbook
    archive = _archive(content, ['[Content_Types].xml', 'xl/workbook.xml'])
    with archive:
        missing_cache = False
        for name in archive.namelist():
            if name.startswith('xl/worksheets/') and name.endswith('.xml'):
                root = ET.fromstring(archive.read(name))
                for cell in root.iter('{http://schemas.openxmlformats.org/spreadsheetml/2006/main}c'):
                    formula = cell.find('{http://schemas.openxmlformats.org/spreadsheetml/2006/main}f')
                    value = cell.find('{http://schemas.openxmlformats.org/spreadsheetml/2006/main}v')
                    if formula is not None and (value is None or value.text is None):
                        missing_cache = True
                        break
        if missing_cache:
            output.warn('Some formulas have no cached result and are blank in extraction. Recalculate and save the workbook in Excel if those values are needed. Formulas were not executed.')
    book = load_workbook(io.BytesIO(content), read_only=True, data_only=True, keep_links=False)
    try:
        for sheet in book.worksheets:
            if output.rows >= MAX_ROWS or output.characters >= MAX_TEXT:
                output.truncate('Additional workbook sheets were not extracted because an extraction limit was reached.')
                break
            if (sheet.max_column or 0) > MAX_COLUMNS:
                output.truncate(f'Sheet {sheet.title}: only the first {MAX_COLUMNS} columns were extracted.')
            rows = ((f'{sheet.title}!R{n}', values) for n, values in enumerate(sheet.iter_rows(values_only=True, max_col=min(sheet.max_column or MAX_COLUMNS, MAX_COLUMNS)), 1))
            table = output.table(sheet.title, rows)
            if table is not None and (sheet.max_column or 0) > MAX_COLUMNS:
                table['truncated'] = True
    finally:
        book.close()


def _xlsb(content, output):
    try:
        from pyxlsb import open_workbook
    except ImportError as exc:
        raise _ExtractionError('XLSB support is not installed. Save the workbook as .xlsx, or install pyxlsb on the server.') from exc
    archive = _archive(content, ['[Content_Types].xml', 'xl/workbook.bin'])
    archive.close()
    # pyxlsb accepts paths in supported releases; the private temp file is deleted.
    with tempfile.NamedTemporaryFile(suffix='.xlsb') as source:
        source.write(content)
        source.flush()
        with open_workbook(source.name) as book:
            for name in book.sheets:
                if output.rows >= MAX_ROWS or output.characters >= MAX_TEXT:
                    output.truncate('Additional workbook sheets were not extracted because an extraction limit was reached.')
                    break
                with book.get_sheet(name) as sheet:
                    def rows():
                        for row in sheet.rows():
                            if not row:
                                continue
                            count = min(max(cell.c for cell in row) + 1, MAX_COLUMNS)
                            values = [None] * count
                            for cell in row:
                                if cell.c < MAX_COLUMNS:
                                    values[cell.c] = cell.v
                                elif cell.v is not None and _text(cell.v).strip():
                                    output.truncate(f'Sheet {name}: only the first {MAX_COLUMNS} columns were extracted.')
                            yield f'{name}!R{row[0].r + 1}', values
                    output.table(name, rows())
    output.warn('XLSB date serials are preserved as numbers because binary cell formatting does not establish dates reliably. Specify date interpretation during review.')


def _xls(content, output):
    try:
        import xlrd
    except ImportError as exc:
        raise _ExtractionError('XLS support is not installed. Save the workbook as .xlsx, or install xlrd on the server.') from exc
    if not content.startswith(b'\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1'):
        raise _ExtractionError('Document contents do not match its XLS extension. Export a regular .xlsx or .csv copy.')
    book = xlrd.open_workbook(file_contents=content, on_demand=True)
    try:
        for name in book.sheet_names():
            if output.rows >= MAX_ROWS or output.characters >= MAX_TEXT:
                output.truncate('Additional workbook sheets were not extracted because an extraction limit was reached.')
                break
            sheet = book.sheet_by_name(name)
            if sheet.ncols > MAX_COLUMNS:
                output.truncate(f'Sheet {name}: only the first {MAX_COLUMNS} columns were extracted.')
            def rows():
                for index in range(sheet.nrows):
                    values = []
                    for column in range(min(sheet.ncols, MAX_COLUMNS)):
                        cell = sheet.cell(index, column)
                        value = cell.value
                        if cell.ctype in {xlrd.XL_CELL_EMPTY, xlrd.XL_CELL_BLANK}:
                            value = None
                        elif cell.ctype == xlrd.XL_CELL_BOOLEAN:
                            value = bool(value)
                        elif cell.ctype == xlrd.XL_CELL_ERROR:
                            value = None
                            output.warn('Workbook error cells were extracted as unknown values. Correct the errors in Excel and re-upload if needed.')
                        elif cell.ctype == xlrd.XL_CELL_DATE:
                            try:
                                value = xlrd.xldate_as_datetime(value, book.datemode)
                            except (ValueError, OverflowError):
                                output.warn('Some XLS date serials could not be converted; review their raw numbers.')
                        values.append(value)
                    yield f'{name}!R{index + 1}', values
            table = output.table(name, rows())
            if table is not None and sheet.ncols > MAX_COLUMNS:
                table['truncated'] = True
            book.unload_sheet(name)
    finally:
        book.release_resources()


def _decode(content, output):
    if content.startswith((b'\xff\xfe', b'\xfe\xff')):
        text = content.decode('utf-16')
    else:
        try:
            text = content.decode('utf-8-sig')
        except UnicodeDecodeError:
            text = content.decode('cp1252')
            output.warn('Text was decoded using Windows-1252; verify accented names and units during review.')
    if '\x00' in text:
        raise _ExtractionError('This file is not a supported text document. Export it as UTF-8 CSV or text.')
    return text


def _csv(content, output, suffix):
    text = _decode(content, output)
    delimiter = '\t' if suffix == '.tsv' else ','
    if suffix == '.csv':
        try:
            delimiter = csv.Sniffer().sniff(text[:8192], delimiters=',;\t|').delimiter
        except csv.Error:
            pass
    reader = csv.reader(io.StringIO(text, newline=''), delimiter=delimiter, strict=True)
    try:
        def rows():
            previous_line = 0
            for row in reader:
                ref = f'R{previous_line + 1}'
                previous_line = reader.line_num
                yield ref, row
        output.table('Data', rows())
    except csv.Error as exc:
        raise _ExtractionError('CSV has malformed or excessively long fields. Export a regular UTF-8 CSV and retry.') from exc


def _docx(content, output):
    namespace = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
    with _archive(content, ['[Content_Types].xml', 'word/document.xml']) as archive:
        document = ET.fromstring(archive.read('word/document.xml'))
    body = document.find(namespace + 'body')
    if body is None:
        raise _ExtractionError('The Word document has no readable body.')
    paragraph_count, table_count = 0, 0
    def paragraph_text(node):
        pieces = []
        for part in node.iter():
            if part.tag == namespace + 't':
                pieces.append(part.text or '')
            elif part.tag == namespace + 'tab':
                pieces.append('\t')
            elif part.tag in {namespace + 'br', namespace + 'cr'}:
                pieces.append('\n')
        return ''.join(pieces)
    for element in body:
        if output.characters >= MAX_TEXT or output.rows >= MAX_ROWS:
            output.truncate('Additional Word content was not extracted because an extraction limit was reached.')
            break
        if element.tag == namespace + 'p':
            paragraph_count += 1
            output.block(f'P{paragraph_count}', paragraph_text(element))
        elif element.tag == namespace + 'tbl':
            table_count += 1
            name = f'Table {table_count}'
            def rows():
                for number, row in enumerate(element.findall(namespace + 'tr'), 1):
                    values = ['\n'.join(paragraph_text(p) for p in cell.findall(namespace + 'p')) for cell in row.findall(namespace + 'tc')]
                    yield f'{name}!R{number}', values
            output.table(name, rows())
    output.warn('Word references identify body paragraphs and tables. Embedded attachments, drawings, headers, footers and external links are not imported.')


def _pdf(content, output):
    try:
        from pypdf import PdfReader, apply_configuration
    except ImportError as exc:
        raise _ExtractionError('PDF extraction is not installed on this server. Install pypdf 6.21 or newer, or upload an Excel/Word/text version.') from exc
    if not content.lstrip().startswith(b'%PDF-'):
        raise _ExtractionError('Document contents do not match its PDF extension.')
    with apply_configuration(
        maximum_declared_stream_length=MAX_PDF_STREAM,
        array_based_stream_maximum_output_length=MAX_PDF_STREAM,
        zlib_maximum_output_length=MAX_PDF_STREAM,
        lzw_maximum_output_length=MAX_PDF_STREAM,
        run_length_maximum_output_length=MAX_PDF_STREAM,
        stream_decoding_work_maximum_length=MAX_PDF_STREAM * 3,
        stream_parsing_work_maximum_count=500000,
        page_tree_maximum_entries=10000,
        page_tree_maximum_page_entries=100000,
        xform_maximum_invocations_per_extraction=1000,
    ):
        reader = PdfReader(io.BytesIO(content), strict=False, root_object_recovery_limit=1000, xref_stream_maximum_entries=100000)
        if reader.is_encrypted:
            raise _ExtractionError('Password-protected PDFs are not supported. Upload an unlocked copy.')
        count = len(reader.pages)
        if count > MAX_PAGES:
            output.truncate(f'Only the first {MAX_PAGES} PDF pages were extracted. Split the document before importing.')
        image_only = []
        for index in range(min(count, MAX_PAGES)):
            if output.characters >= MAX_TEXT:
                output.truncate('Additional PDF pages were not extracted because the text limit was reached.')
                break
            page = reader.pages[index]
            text = page.extract_text() or ''
            if text.strip():
                output.block(f'Page {index + 1}', text)
            else:
                image_only.append(index + 1)
        if image_only:
            output.result['needs_ocr'] = True
            output.warn('PDF pages without readable text need OCR or a configured vision-capable AI service: ' + ', '.join(map(str, image_only[:20])) + (', …' if len(image_only) > 20 else '') + '.')
        if not output.result['blocks']:
            output.warn('No PDF text was extracted. This may be a scan or an empty document; local extraction cannot interpret it.')

def _image(content, output, suffix):
    try:
        from PIL import Image
    except ImportError as exc:
        raise _ExtractionError('Image validation is not installed. Install Pillow, or upload a PDF/Word/Excel document.') from exc
    if suffix == '.png' and not content.startswith(b'\x89PNG\r\n\x1a\n'):
        raise _ExtractionError('Document contents do not match its PNG extension.')
    if suffix in {'.jpg', '.jpeg'} and not content.startswith(b'\xff\xd8\xff'):
        raise _ExtractionError('Document contents do not match its JPEG extension.')
    try:
        with Image.open(io.BytesIO(content)) as image:
            if image.format not in ({'PNG'} if suffix == '.png' else {'JPEG'}):
                raise _ExtractionError('Image contents do not match the file extension.')
            if not 0 < image.width * image.height <= 40_000_000:
                raise _ExtractionError('Image dimensions exceed the 40-megapixel limit.')
            image.verify()
    except _ExtractionError:
        raise
    except Exception as exc:
        raise _ExtractionError('The image is damaged or unsupported. Export a new PNG or JPEG and retry.') from exc
    output.result['needs_ocr'] = True
    output.warn('Image documents require OCR or a configured vision-capable AI service. No local text was inferred.')


def extract_document(filename: str, content: bytes) -> dict:
    """Extract bounded observations; raise user-safe ValueError for invalid input."""
    if not isinstance(filename, str) or not filename.strip() or len(filename) > 240:
        raise _ExtractionError('Provide a filename up to 240 characters.')
    if not isinstance(content, bytes) or not content:
        raise _ExtractionError('The uploaded document is empty or invalid.')
    if len(content) > MAX_BYTES:
        raise _ExtractionError('Documents must be 8 MB or smaller. Split the file before uploading.')
    suffix = Path(filename).suffix.lower()
    if suffix not in SUPPORTED:
        raise _ExtractionError('Unsupported document format. Use .xlsx, .xlsm, .xlsb, .xls, .csv, .tsv, .docx, .pdf, .txt, .md, .png or .jpg. Convert legacy .doc files to .docx first.')
    output = _Output(suffix[1:])
    try:
        if suffix in {'.xlsx', '.xlsm'}:
            _xlsx(content, output)
        elif suffix == '.xlsb':
            _xlsb(content, output)
        elif suffix == '.xls':
            _xls(content, output)
        elif suffix in {'.csv', '.tsv'}:
            _csv(content, output, suffix)
        elif suffix in {'.txt', '.md'}:
            for index, line in enumerate(_decode(content, output).splitlines(), 1):
                if output.characters >= MAX_TEXT:
                    output.truncate('Additional text was not extracted because the text limit was reached.')
                    break
                output.block(f'L{index}', line)
        elif suffix == '.docx':
            _docx(content, output)
        elif suffix == '.pdf':
            _pdf(content, output)
        else:
            _image(content, output, suffix)
    except _ExtractionError:
        raise
    except Exception as exc:
        # Reader internals can contain raw document values; do not expose those.
        raise _ExtractionError('This document could not be read. It may be damaged, encrypted or in an unsupported format. Export a new copy and retry.') from exc
    return output.result
