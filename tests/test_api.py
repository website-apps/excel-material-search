import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app import create_app, BASE
from test_support import connect_sqlite
from test_excel_index import workbook_bytes


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
