"""Public extraction contracts: real document bytes, provenance and hard bounds."""
import io
import json
import unittest
import zipfile
from datetime import datetime
from unittest.mock import patch

from openpyxl import Workbook
from reportlab.pdfgen import canvas
from backend.document_extract import extract_document, MAX_BYTES


def workbook_bytes(rows, title='Planning'):
    book = Workbook()
    sheet = book.active
    sheet.title = title
    for row in rows:
        sheet.append(row)
    out = io.BytesIO()
    book.save(out)
    return out.getvalue()


def docx_bytes(body):
    xml = ('<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + body + '</w:body></w:document>').encode()
    out = io.BytesIO()
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as archive:
        archive.writestr('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>')
        archive.writestr('word/document.xml', xml)
    return out.getvalue()


def pdf_bytes(pages):
    out = io.BytesIO()
    pdf = canvas.Canvas(out)
    for text in pages:
        if text:
            pdf.drawString(50, 750, text)
        pdf.showPage()
    pdf.save()
    return out.getvalue()


class DocumentExtractionTests(unittest.TestCase):
    def test_excel_preserves_zero_unknown_dates_and_source_rows(self):
        result = extract_document('lineup.XLSX', workbook_bytes([
            ['Vessel', 'Quantity', 'ETA', 'Unreported'],
            ['MV Atlas', 0, datetime(2026, 11, 12, 14, 30), None],
            ['Vessel', 'Quantity', 'ETA', 'Unreported'],
            ['MV Jorf', 12000.5, None, None],
        ]))
        self.assertEqual(result['format'], 'xlsx')
        self.assertEqual(len(result['tables']), 1)
        table = result['tables'][0]
        self.assertEqual(table['headers'], ['Vessel', 'Quantity', 'ETA', 'Unreported'])
        self.assertEqual([r['ref'] for r in table['rows']], ['Planning!R2', 'Planning!R4'])
        self.assertEqual(table['rows'][0]['values'], ['MV Atlas', 0, '2026-11-12T14:30:00', None])
        self.assertIsNone(table['rows'][1]['values'][2])
        self.assertFalse(result['truncated'])
        self.assertFalse(result['needs_ocr'])
        json.dumps(result, allow_nan=False)

    def test_excel_formula_without_cached_result_is_unknown_not_executed(self):
        result = extract_document('formulas.xlsm', workbook_bytes([
            ['Vessel', 'Quantity'], ['MV Atlas', '=10000+2000'],
        ]))
        self.assertIsNone(result['tables'][0]['rows'][0]['values'][1])
        self.assertTrue(any('no cached result' in w for w in result['warnings']))

    def test_csv_semicolon_utf8_multiline_and_exact_physical_refs(self):
        data = '\ufeffNavire;Quantité;Notes\r\nMV Jorf;0;"attente\nposte 2"\r\nMV Atlas;;\r\n'
        result = extract_document('daily.csv', data.encode('utf-8'))
        table = result['tables'][0]
        self.assertEqual(table['headers'], ['Navire', 'Quantité', 'Notes'])
        self.assertEqual([r['ref'] for r in table['rows']], ['R2', 'R4'])
        self.assertEqual(table['rows'][0]['values'], ['MV Jorf', '0', 'attente\nposte 2'])
        self.assertEqual(table['rows'][1]['values'][1:], [None, None])

    def test_tsv_duplicate_and_empty_headers_have_unique_column_names(self):
        result = extract_document('data.tsv', b'Vessel\t\tVessel\nA\t1\tB\n')
        self.assertEqual(result['tables'][0]['headers'], ['Vessel', 'Column 2', 'Vessel (2)'])

    def test_word_body_order_and_table_references_survive(self):
        data = docx_bytes('''<w:p><w:r><w:t>Daily lineup for Example Harbor</w:t></w:r></w:p>
          <w:tbl><w:tr><w:tc><w:p><w:r><w:t>Vessel</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Berth</w:t></w:r></w:p></w:tc></w:tr>
          <w:tr><w:tc><w:p><w:r><w:t>MV Atlas</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>B2</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
          <w:p><w:r><w:t>Loader maintenance until 14:00</w:t></w:r></w:p>''')
        result = extract_document('schedule.docx', data)
        self.assertEqual([b['ref'] for b in result['blocks']], ['P1', 'Table 1!R1', 'Table 1!R2', 'P2'])
        self.assertEqual(result['tables'][0]['rows'][0]['values'], ['MV Atlas', 'B2'])
        self.assertIn('Loader maintenance', result['blocks'][-1]['text'])

    def test_pdf_page_text_and_scanned_page_requirement(self):
        result = extract_document('schedule.pdf', pdf_bytes(['MV Atlas berth B2, 12 November 2026', '']))
        self.assertEqual(result['blocks'][0]['ref'], 'Page 1')
        self.assertIn('MV Atlas', result['blocks'][0]['text'])
        self.assertTrue(result['needs_ocr'])
        self.assertTrue(any('2' in w and 'OCR' in w for w in result['warnings']))
        self.assertFalse(result['truncated'])

    def test_encrypted_pdf_is_rejected(self):
        from pypdf import PdfReader, PdfWriter
        writer = PdfWriter()
        writer.add_page(PdfReader(io.BytesIO(pdf_bytes(['Private schedule']))).pages[0])
        writer.encrypt('private')
        out = io.BytesIO()
        writer.write(out)
        with self.assertRaisesRegex(ValueError, 'Password-protected'):
            extract_document('protected.pdf', out.getvalue())

    def test_page_row_and_text_limits_are_explicit(self):
        with patch('backend.document_extract.MAX_PAGES', 2):
            result = extract_document('long.pdf', pdf_bytes(['One', 'Two', 'Three']))
        self.assertEqual([b['ref'] for b in result['blocks']], ['Page 1', 'Page 2'])
        self.assertTrue(result['truncated'])
        with patch('backend.document_extract.MAX_ROWS', 2):
            result = extract_document('many.csv', b'Vessel,Quantity\nA,1\nB,2\nC,3\n')
        self.assertEqual(len(result['tables'][0]['rows']), 2)
        self.assertTrue(result['truncated'])
        with patch('backend.document_extract.MAX_TEXT', 20):
            result = extract_document('long.txt', b'1234567890\nABCDEFGHIJKLMNO\nmore')
        self.assertLessEqual(sum(len(b['text']) for b in result['blocks']), 20)
        self.assertTrue(result['truncated'])

    def test_pdf_decompression_and_csv_syntax_limits_fail_safely(self):
        with patch('backend.document_extract.MAX_PDF_STREAM', 1024):
            with self.assertRaises(ValueError):
                extract_document('large-stream.pdf', pdf_bytes(['Vessel ' * 5000]))
        with self.assertRaisesRegex(ValueError, 'CSV'):
            extract_document('broken.csv', b'Vessel,Notes\nAtlas,"unfinished quotation')

    def test_completed_selected_table_is_distinct_from_later_truncation(self):
        book = Workbook()
        first = book.active
        first.title = 'Selected lineup'
        first.append(['Vessel', 'Quantity'])
        first.append(['MV Atlas', 1000])
        second = book.create_sheet('Later history')
        second.append(['Vessel', 'Quantity'])
        second.append(['MV Jorf', 2000])
        second.append(['MV Other', 3000])
        out = io.BytesIO()
        book.save(out)
        with patch('backend.document_extract.MAX_ROWS', 2):
            result = extract_document('multiple.xlsx', out.getvalue())
        self.assertTrue(result['truncated'])
        self.assertFalse(result['tables'][0]['truncated'])
        self.assertTrue(result['tables'][1]['truncated'])
        self.assertEqual(result['tables'][0]['rows'][0]['values'], ['MV Atlas', 1000])
        with patch('backend.document_extract.MAX_COLUMNS', 1):
            result = extract_document('columns.xlsx', out.getvalue())
        self.assertTrue(result['tables'][0]['truncated'])
        self.assertTrue(result['truncated'])

    def test_utf16_text_preserves_line_refs_without_inferred_values(self):
        data = 'Situation journalière\n\nMV Atlas arrive demain'.encode('utf-16')
        result = extract_document('notes.txt', data)
        self.assertEqual([b['ref'] for b in result['blocks']], ['L1', 'L3'])
        self.assertEqual(result['tables'], [])
        self.assertIn('demain', result['blocks'][-1]['text'])

    def test_image_requires_ocr_and_malformed_image_is_rejected(self):
        from PIL import Image
        out = io.BytesIO()
        Image.new('RGB', (30, 30), color='white').save(out, format='PNG')
        result = extract_document('scan.png', out.getvalue())
        self.assertTrue(result['needs_ocr'])
        self.assertEqual(result['blocks'], [])
        with self.assertRaises(ValueError):
            extract_document('scan.png', out.getvalue()[:30])

    def test_unsafe_or_mismatched_archives_and_entity_declarations_rejected(self):
        with self.assertRaisesRegex(ValueError, 'match its file extension'):
            extract_document('not-word.docx', workbook_bytes([['Vessel'], ['Atlas']]))
        for name, value in [('../outside.xml', b'x'), ('word/evil.xml', b'<!DOCTYPE x [<!ENTITY x "secret">]><x>&x;</x>'), ('word/_rels/document.xml.rels', '<!DOCTYPE x [<!ENTITY x "secret">]><x>&x;</x>'.encode('utf-16')), ('word/large.xml', b'x' * (2 * 1024 * 1024))]:
            original = zipfile.ZipFile(io.BytesIO(docx_bytes('<w:p/>')))
            out = io.BytesIO()
            with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as archive:
                for item in original.infolist():
                    archive.writestr(item.filename, original.read(item))
                archive.writestr(name, value)
            with self.assertRaises(ValueError):
                extract_document('unsafe.docx', out.getvalue())

    def test_empty_oversized_legacy_and_fake_files_have_safe_errors(self):
        for filename, data in [('empty.csv', b''), ('old.doc', b'old word'), ('fake.xlsx', b'not a workbook'), ('fake.pdf', b'not a pdf'), ('large.csv', b'x' * (MAX_BYTES + 1))]:
            with self.subTest(filename=filename), self.assertRaises(ValueError):
                extract_document(filename, data)


if __name__ == '__main__':
    unittest.main()
