import io
import tempfile
import unittest
from pathlib import Path

from openpyxl import Workbook

from test_support import connect_sqlite
import backend.excel_index as excel_module
import backend.spec_archive as archive_module
excel_module.connect_database = connect_sqlite
archive_module.connect_database = connect_sqlite

from backend.excel_index import ExcelIndexStore
from backend.spec_archive import ArchiveStore


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

    def test_archive_migrates_existing_excel_records_on_startup(self) -> None:
        indexed = self.excel_index.index_workbook("parts.xlsx", self._workbook_payload())
        restarted = ArchiveStore(self.archive.db_file, self.archive.storage_dir, self.excel_index)

        documents = restarted.list_documents(kind="bom")
        self.assertEqual(len(documents), 1)
        self.assertEqual(documents[0]["original_name"], indexed["original_name"])


if __name__ == "__main__":
    unittest.main()
