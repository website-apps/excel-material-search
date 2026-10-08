import io
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from openpyxl import Workbook
from pypdf import PdfWriter
from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject

from test_support import connect_sqlite
import backend.excel_index as excel_module
import backend.spec_archive as archive_module
excel_module.connect_database = connect_sqlite
archive_module.connect_database = connect_sqlite

from backend.excel_index import ExcelIndexStore
from backend.spec_archive import ArchiveError, ArchiveStore, parse_bom_filename


def malformed_unicode_pdf_bytes() -> bytes:
    writer = PdfWriter()
    page = writer.add_blank_page(width=300, height=300)
    cmap = DecodedStreamObject()
    cmap.set_data(b"""/CIDInit /ProcSet findresource begin
12 dict begin begincmap
/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def
/CMapName /BrokenUnicode def /CMapType 2 def
1 begincodespacerange <00> <FF> endcodespacerange
4 beginbfchar
<41> <00570050004D0033003400300031>
<42> <D800>
<43> <0000>
<44> <00200076006F006C0074006100670065>
endbfchar endcmap CMapName currentdict /CMap defineresource pop end end""")
    font = DictionaryObject({
        NameObject("/Type"): NameObject("/Font"),
        NameObject("/Subtype"): NameObject("/Type1"),
        NameObject("/BaseFont"): NameObject("/Helvetica"),
        NameObject("/ToUnicode"): writer._add_object(cmap),
    })
    page[NameObject("/Resources")] = DictionaryObject({
        NameObject("/Font"): DictionaryObject({NameObject("/F1"): writer._add_object(font)}),
    })
    content = DecodedStreamObject()
    content.set_data(b"BT /F1 12 Tf 10 100 Td (ABCD) Tj ET")
    page[NameObject("/Contents")] = writer._add_object(content)
    output = io.BytesIO()
    writer.write(output)
    return output.getvalue()


class SpecArchiveStoreTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tempdir = tempfile.TemporaryDirectory()
        self.addCleanup(self.tempdir.cleanup)
        root = Path(self.tempdir.name)
        self.excel_index = ExcelIndexStore(root / "archive.sqlite3", root / "files")
        self.archive = ArchiveStore(root / "archive.sqlite3", root / "files", self.excel_index)

    def _workbook_payload(self) -> bytes:
        workbook = Workbook()
        sheet = workbook.active
        sheet.title = "Parts"
        sheet.append(["Part Number", "Description"])
        sheet.append(["WPM3401", "Power regulator"])
        output = io.BytesIO()
        workbook.save(output)
        return output.getvalue()

    def test_manual_documents_are_searchable_and_deduplicated(self) -> None:
        first = self.archive.upload_document(
            "regulator.txt",
            b"WPM3401 input voltage 10V",
            kind="manual",
            metadata={"title": "WPM3401", "vendor": "TI"},
        )
        duplicate = self.archive.upload_document(
            "same-content.md",
            b"WPM3401 input voltage 10V",
            kind="manual",
        )

        self.assertEqual(first["id"], duplicate["id"])
        matches = self.archive.query_documents("input voltage", kind="manual")["matches"]
        self.assertEqual(len(matches), 1)
        self.assertEqual(matches[0]["title"], "WPM3401")

        updated = self.archive.update_document(first["id"], {"category": "电源管理"})
        self.assertEqual(updated["category"], "电源管理")

    def test_existing_excel_index_can_be_registered_as_bom_and_previewed(self) -> None:
        indexed = self.excel_index.index_workbook(
            "RD_X2000_DEMO_V1.0.xlsx",
            self._workbook_payload(),
        )
        document = self.archive.register_excel_file(indexed)

        self.assertEqual(document["kind"], "bom")
        self.assertEqual(document["board_code"], "RD")
        self.assertEqual(document["main_chip"], "X2000")
        self.assertEqual(self.archive.query_documents("WPM3401", kind="bom")["matches"][0]["sheet_name"], "Parts")
        preview = self.archive.preview_workbook(document["id"])
        self.assertEqual(preview["sheets"][0]["rows"][1][0], "WPM3401")

        self.archive.delete_document(document["id"])
        self.assertEqual(self.excel_index.search("WPM3401"), [])
        self.assertEqual(self.archive.list_documents(kind="bom"), [])

    def test_manual_upload_sanitizes_extracted_text_and_preserves_original(self) -> None:
        extracted = "WPM3401 中文 µΩ 😀 \ud83d\ude00 \ud800 broken \udfff\x00 voltage"
        expected = "WPM3401 中文 µΩ 😀 😀 � broken �� voltage"
        original = b"original PDF bytes"
        with patch("backend.spec_archive._extract_document_text", return_value=extracted):
            document = self.archive.upload_document("manual.pdf", original, kind="manual")

        self.assertEqual(document["status"], "ready")
        self.assertEqual(self.archive._get_row(document["id"])["content_text"], expected)
        matches = self.archive.query_documents("WPM3401 voltage", kind="manual")["matches"]
        self.assertEqual(matches[0]["document_id"], document["id"])
        with self.archive._connect() as connection:
            indexed = connection.execute("SELECT content FROM archive_documents_fts").fetchone()[0]
        self.assertIn(expected, indexed)
        self.assertEqual(self.archive.document_path(document["id"])[1].read_bytes(), original)

    def test_manual_reindex_sanitizes_extracted_text(self) -> None:
        document = self.archive.upload_document("manual.txt", b"old content", kind="manual")
        with patch("backend.spec_archive._extract_document_text", return_value="WPM3401 \ud800\x00 voltage"):
            self.assertEqual(self.archive.reindex(), 1)

        self.assertEqual(self.archive._get_row(document["id"])["content_text"], "WPM3401 �� voltage")
        matches = self.archive.query_documents("WPM3401 voltage", kind="manual")["matches"]
        self.assertEqual(matches[0]["document_id"], document["id"])

    def test_text_upload_replaces_nul_without_changing_valid_unicode(self) -> None:
        original = "中文 µΩ 😀\x00 WPM3401".encode("utf-8")
        document = self.archive.upload_document("manual.txt", original, kind="manual")

        self.assertEqual(self.archive._get_row(document["id"])["content_text"], "中文 µΩ 😀� WPM3401")
        self.assertEqual(self.archive.document_path(document["id"])[1].read_bytes(), original)

    def test_archive_migrates_existing_excel_records_on_startup(self) -> None:
        indexed = self.excel_index.index_workbook("parts.xlsx", self._workbook_payload())
        restarted = ArchiveStore(self.archive.db_file, self.archive.storage_dir, self.excel_index)

        documents = restarted.list_documents(kind="bom")
        self.assertEqual(len(documents), 1)
        self.assertEqual(documents[0]["original_name"], indexed["original_name"])

    def test_db_filename_recognizes_board_chip_and_version(self) -> None:
        for filename, chip, board_name in (
            ("DB_X3000A_MACAW_DVP&TPC_V1.0 Components List.xlsx", "X3000A", "DB_X3000A_MACAW_DVP&TPC_V1.0"),
            ("DB_X2600_COD_V1.1_Components_List.xlsx", "X2600", "DB_X2600_COD_V1.1"),
            ("db_x1000_bi_v1.0.xlsx", "X1000", "db_x1000_bi_v1.0"),
        ):
            with self.subTest(filename=filename):
                self.assertEqual(parse_bom_filename(filename), {
                    "board_code": "DB", "board_type": "验证板", "main_chip": chip, "board_name": board_name,
                })
        self.assertEqual(parse_bom_filename("CUSTOM_X2000_DEMO.xlsx")["board_code"], "")

    def test_main_chip_catalog_persists_and_merges_bom_models(self) -> None:
        self.assertEqual(self.archive.add_main_chip(" am62a7-q1 "), {"name": "AM62A7-Q1", "bom_count": 0})
        self.assertIsNone(self.archive.add_main_chip("AM62A7-Q1"))
        self.archive.upload_document("DB_X2600_TEST_V1.0.xlsx", self._workbook_payload(), kind="bom")
        self.assertIsNone(self.archive.add_main_chip("x2600"))
        manual = self.archive.upload_document("manual.txt", b"manual", kind="manual")
        self.archive.update_document(manual["id"], {"main_chip": "MANUAL-ONLY"})
        restarted = ArchiveStore(self.archive.db_file, self.archive.storage_dir, self.excel_index)
        self.assertEqual(restarted.list_main_chips(), [
            {"name": "AM62A7-Q1", "bom_count": 0}, {"name": "X2600", "bom_count": 1},
        ])
        with self.assertRaisesRegex(ArchiveError, "已被 BOM 使用"):
            restarted.delete_main_chip("X2600")
        self.assertTrue(restarted.delete_main_chip("am62a7-q1"))
        self.assertFalse(restarted.delete_main_chip("AM62A7-Q1"))
        self.assertEqual(restarted.list_main_chips(), [{"name": "X2600", "bom_count": 1}])

    def test_main_chip_catalog_counts_follow_document_edits_and_deletion(self) -> None:
        self.archive.add_main_chip("X4000")
        bom = self.archive.upload_document("DB_X2600_TEST.xlsx", self._workbook_payload(), kind="bom")
        self.archive.update_document(bom["id"], {"main_chip": "x4000"})
        self.assertEqual(self.archive.list_main_chips(), [{"name": "X4000", "bom_count": 1}])
        with self.assertRaisesRegex(ArchiveError, "已被 BOM 使用"):
            self.archive.delete_main_chip("X4000")
        self.archive.delete_document(bom["id"])
        self.assertEqual(self.archive.list_main_chips(), [{"name": "X4000", "bom_count": 0}])
        self.assertTrue(self.archive.delete_main_chip("X4000"))

    def test_main_chip_names_are_validated_without_truncation(self) -> None:
        for name in ("", " ", "X 4000", "X\n4000", "<script>", "X" * 81, None):
            with self.subTest(name=name), self.assertRaises(ArchiveError):
                self.archive.add_main_chip(name)
        self.assertEqual(self.archive.list_main_chips(), [])
        self.assertEqual(self.archive.add_main_chip("STM32H7/V2.1+PRO")['name'], "STM32H7/V2.1+PRO")

    def test_time_sort_uses_bom_modification_time_and_manual_upload_time(self) -> None:
        records = [
            ("bom", "2026-10-08T09:00:00+08:00", "2026-10-01T00:00:00Z"),
            ("bom", "2026-10-08T00:30:00Z", "2026-10-07T00:00:00Z"),
            ("bom", "", "2026-10-08T00:45:00Z"),
            ("bom", "invalid", "2026-10-08T00:40:00Z"),
            ("manual", "2026-10-09T00:00:00Z", "2026-10-06T00:00:00Z"),
            ("manual", "2026-10-01T00:00:00Z", "2026-10-07T00:00:00Z"),
            ("manual", "", "2026-10-07T00:00:00Z"),
        ]
        ids = []
        for index, (kind, modified, created) in enumerate(records):
            document = self.archive.upload_document(f"time-{index}.txt", f"record {index}".encode(), kind="manual")
            ids.append(document["id"])
            with self.archive._connect() as connection:
                connection.execute(
                    "UPDATE archive_documents SET kind = ?, file_modified_at = ?, created_at = ? WHERE id = ?",
                    (kind, modified, created, document["id"]),
                )
        for kind, expected in (("bom", [ids[0], ids[2], ids[3], ids[1]]), ("manual", [ids[6], ids[5], ids[4]])):
            with self.subTest(kind=kind):
                self.assertEqual([row["id"] for row in self.archive.list_documents(kind=kind)], expected)
                self.assertEqual([row["id"] for row in self.archive.list_documents(kind=kind, sort_order="oldest")], expected[::-1])


if __name__ == "__main__":
    unittest.main()
