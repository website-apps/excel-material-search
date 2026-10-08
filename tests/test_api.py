import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app import create_app, BASE
from test_support import connect_sqlite
from test_excel_index import workbook_bytes
from test_spec_archive import malformed_unicode_pdf_bytes


class ApplicationTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        root = Path(self.directory.name)
        config = root / "admins.json"
        config.write_text(json.dumps({"applications": {"excel-material-search": {"admins": [{"username": "tester", "password": "test-only-password"}]}}}))
        for module in ("backend.excel_index", "backend.spec_archive"):
            patcher = patch(module + ".connect_database", connect_sqlite)
            patcher.start()
            self.addCleanup(patcher.stop)
        self.app = create_app(root / "files", config, "test-only-secret")
        self.client = self.app.test_client()
        self.api = BASE + "/api"

    def login(self):
        response = self.client.post(self.api + "/admin/login", json={"username": "tester", "password": "test-only-password"})
        self.assertEqual(response.status_code, 200)
        self.assertIn("Path=" + BASE + "/", response.headers["Set-Cookie"])
        self.assertIn("app_excel-material-search_session=", response.headers["Set-Cookie"])
        self.assertTrue(self.client.get(self.api + "/admin/session").json["authenticated"])

    def test_bom_permissions_upload_query_preview_download_delete(self):
        self.assertEqual(self.client.get(self.api + "/files").status_code, 401)
        self.assertEqual(self.client.get(self.api + "/documents?kind=bom").status_code, 401)
        self.login()
        response = self.client.post(self.api + "/files", data={"files": (io.BytesIO(workbook_bytes()), "demo.xlsx")})
        self.assertEqual(response.status_code, 201)
        docs = self.client.get(self.api + "/documents?kind=bom").json["documents"]
        document_id = docs[0]["id"]
        prefix = self.api + f"/documents/{document_id}"
        for suffix in ("/preview", "/download", "/workbook-preview"):
            with self.client.get(prefix + suffix) as response:
                self.assertEqual(response.status_code, 200)
        visitor = self.app.test_client()
        self.assertEqual(visitor.get(prefix + "/download").status_code, 401)
        self.assertTrue(visitor.post(self.api + "/query", json={"kind": "bom", "query": "WPM3401"}).json["matches"])
        self.assertEqual(self.client.delete(prefix).status_code, 200)
        self.assertEqual(self.client.get(self.api + "/files").json["files"], [])

    def test_manual_public_read_admin_edit_and_logout(self):
        self.login()
        response = self.client.post(self.api + "/documents", data={"files": (io.BytesIO(b"part specifications"), "manual.txt"), "kind": "manual"})
        self.assertEqual(response.status_code, 201)
        doc = response.json["documents"][0]
        prefix = self.api + f"/documents/{doc['id']}"
        self.assertEqual(self.client.put(prefix, json={"title": "Updated"}).json["document"]["title"], "Updated")
        self.client.post(self.api + "/admin/logout")
        self.assertEqual(self.client.delete(prefix).status_code, 401)
        self.assertEqual(len(self.client.get(self.api + "/documents").json["documents"]), 1)
        with self.client.get(prefix + "/preview") as response:
            self.assertEqual(response.data, b"part specifications")

    def test_bad_login_is_rejected_and_rate_limited(self):
        for attempt in range(6):
            response = self.client.post(self.api + "/admin/login", json={"username": "tester", "password": "wrong"})
            self.assertEqual(response.status_code, 401 if attempt < 5 else 429)

    def test_manual_upload_with_invalid_extracted_unicode_remains_searchable(self):
        self.login()
        original = malformed_unicode_pdf_bytes()
        response = self.client.post(self.api + "/documents", data={"files": (io.BytesIO(original), "manual.pdf"), "kind": "manual"})
        self.assertEqual(response.status_code, 201)
        document = response.json["documents"][0]
        matches = self.client.post(self.api + "/query", json={"kind": "manual", "query": "WPM3401 voltage"}).json["matches"]
        self.assertEqual(matches[0]["document_id"], document["id"])
        with self.client.get(self.api + f"/documents/{document['id']}/download") as response:
            self.assertEqual(response.data, original)

    def test_unexpected_upload_failure_returns_json_without_exception_details(self):
        self.login()
        with patch("backend.spec_archive.ArchiveStore.upload_document", side_effect=RuntimeError("private database details")):
            with self.assertLogs(self.app.logger, level="ERROR") as logs:
                response = self.client.post(self.api + "/documents", data={"files": (io.BytesIO(b"manual"), "manual.txt")})
        self.assertEqual(response.status_code, 500)
        self.assertTrue(response.is_json)
        self.assertTrue(response.json["error"])
        self.assertNotIn("private database details", response.get_data(as_text=True))
        self.assertIn("private database details", "\n".join(logs.output))

    def test_oversized_upload_returns_json(self):
        self.login()
        self.app.config["MAX_CONTENT_LENGTH"] = 64
        response = self.client.post(self.api + "/documents", data={"files": (io.BytesIO(b"x" * 128), "manual.txt")})
        self.assertEqual(response.status_code, 413)
        self.assertTrue(response.is_json)
        self.assertTrue(response.json["error"])

    def test_api_http_errors_preserve_status_and_headers(self):
        response = self.client.get(self.api + "/missing")
        self.assertEqual(response.status_code, 404)
        self.assertTrue(response.is_json)
        response = self.client.patch(self.api + "/documents")
        self.assertEqual(response.status_code, 405)
        self.assertTrue(response.is_json)
        self.assertIn("POST", response.headers["Allow"])
        response = self.client.get(BASE + "/missing-page")
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.mimetype, "text/html")
