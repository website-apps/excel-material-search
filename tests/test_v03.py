import io
import json
import unittest
from pathlib import Path
from unittest.mock import patch

from test_api import ApplicationTests
from test_excel_index import workbook_bytes
from test_spec_archive import malformed_unicode_pdf_bytes


class V03Tests(unittest.TestCase):
    setUp = ApplicationTests.setUp
    login = ApplicationTests.login

    def upload(self, name="TI-buck.txt", payload=b"ABC123 output current 3A input voltage 5V", **fields):
        return self.client.post(self.api + "/v03/files", data={"file": (io.BytesIO(payload), name), **fields})

    def test_manual_flow_public_read_and_admin_mutations(self):
        self.assertEqual(self.upload().status_code, 401)
        self.login()
        result = self.upload(category="DC-DC", vendor="TI", package="QFN")
        self.assertEqual(result.status_code, 201)
        file = result.json["file"]
        path = self.api + f"/v03/files/{file['id']}"
        self.assertEqual(file["ext"], "txt")
        self.assertEqual(file["content_index_status"], "ready")
        visitor = self.app.test_client()
        for suffix in ("/download", "/preview"):
            with visitor.get(path + suffix) as response:
                self.assertEqual(response.status_code, 200)
                self.assertIn(b"ABC123", response.data)
        search = self.api + "/v03/files?kind=manual&category=DC-DC&vendor=TI&q=ABC123+输出电流"
        self.assertEqual(len(visitor.get(search).json["files"]), 1)
        self.assertEqual(visitor.get(search + "+9A").json["files"], [])
        self.assertEqual(visitor.put(path, json={"title": "bad"}).status_code, 401)
        self.assertEqual(visitor.delete(path).status_code, 401)
        self.assertEqual(self.client.put(path, json={"category": "LDO", "vendor": ""}).json["file"]["category"], "LDO")
        self.assertEqual(self.client.post(self.api + "/v03/files/reindex").json["indexed"], 1)
        self.assertEqual(self.client.delete(path).status_code, 200)
        self.assertEqual(visitor.get(path + "/download").status_code, 404)

    def test_bom_original_filters_edit_preview_and_modification_time(self):
        self.login()
        result = self.upload("RD_X2000_DEMO_V1.0.xlsx", workbook_bytes(), kind="bom", file_modified_at="1700000000000")
        self.assertEqual(result.status_code, 201)
        file = result.json["file"]
        self.assertTrue(file["file_modified_at"].startswith("2023-11-14"))
        path = self.api + f"/v03/files/{file['id']}"
        visitor = self.app.test_client()
        self.assertEqual(len(visitor.get(self.api + "/v03/files?kind=bom&board_code=RD&main_chip=X2000").json["files"]), 1)
        self.assertEqual(visitor.get(self.api + "/v03/files?board_code=__other__").json["files"], [])
        self.assertTrue(visitor.get(path + "/bom-preview").json["sheets"])
        with visitor.get(path + "/download") as response:
            self.assertEqual(response.status_code, 200)
        updated = self.client.put(path, json={"board_type": "其他", "main_chip": "", "board_name": "Custom"})
        self.assertEqual(updated.json["file"]["board_code"], "")
        self.assertEqual(len(visitor.get(self.api + "/v03/files?kind=bom&board_code=__other__&main_chip=__other__").json["files"]), 1)
        updated = self.client.put(path, json={"board_type": "产品板", "main_chip": "x3000"})
        self.assertEqual(updated.json["file"]["main_chip"], "X3000")

    def test_db_board_upload_filter_edit_and_reindex(self):
        self.login()
        file = self.upload("DB_X2000_DEMO_V1.0.xlsx", workbook_bytes(), kind="bom").json["file"]
        self.assertEqual((file["board_code"], file["board_type"], file["main_chip"]), ("DB", "验证板", "X2000"))
        path = self.api + f"/v03/files/{file['id']}"
        visitor = self.app.test_client()
        self.assertEqual(visitor.get(self.api + "/v03/files?kind=bom&board_code=DB&main_chip=X2000").json["files"][0]["id"], file["id"])
        self.assertEqual(visitor.get(self.api + "/v03/files?kind=bom&board_code=__other__").json["files"], [])
        self.assertEqual(self.client.put(path, json={"main_chip": "x2600"}).json["file"]["board_code"], "DB")
        self.client.put(path, json={"board_type": "产品板"})
        updated = self.client.put(path, json={"board_type": "验证板", "board_name": "Custom DB board"}).json["file"]
        self.assertEqual(updated["board_code"], "DB")
        self.assertEqual(updated["main_chip"], "X2600")
        self.client.post(self.api + "/v03/files/reindex")
        listed = visitor.get(self.api + "/v03/files?kind=bom&board_code=DB&main_chip=X2600").json["files"]
        self.assertEqual(listed[0]["board_name"], "Custom DB board")

    def test_time_sort_defaults_newest_and_supports_oldest_with_filters(self):
        self.login()
        old = self.upload("old.txt", b"old ABC123", category="LDO").json["file"]
        new = self.upload("new.txt", b"new ABC123", category="LDO").json["file"]
        self.upload("other.txt", b"other ABC123", category="DC-DC")
        url = self.api + "/v03/files?kind=manual&category=LDO&q=ABC123"
        visitor = self.app.test_client()
        self.assertEqual([file["id"] for file in visitor.get(url).json["files"]], [new["id"], old["id"]])
        self.assertEqual([file["id"] for file in visitor.get(url + "&sort=oldest").json["files"]], [old["id"], new["id"]])
        self.assertEqual(visitor.get(url + "&sort=invalid").status_code, 422)

    @patch.dict("os.environ", {"SPEC_ARCHIVE_AI_API_KEY": ""})
    def test_analyze_does_not_store_files_and_keeps_fallback(self):
        self.login()
        response = self.client.post(self.api + "/v03/files/analyze", data={"file": (io.BytesIO(b"spec"), "TI-buck.txt")})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json["metadata"]["category"], "电源管理")
        self.assertEqual(response.json["extractedChars"], 4)
        self.assertEqual(self.client.get(self.api + "/v03/files").json["files"], [])
        file = self.upload().json["file"]
        response = self.client.post(self.api + f"/v03/files/{file['id']}/analyze")
        self.assertEqual(response.json["metadata"]["vendor"], "TI")

    def test_invalid_pdf_unicode_is_safe_and_original_preserved(self):
        self.login()
        original = malformed_unicode_pdf_bytes()
        file = self.upload("test.pdf", original).json["file"]
        with self.client.get(self.api + f"/v03/files/{file['id']}/download") as response:
            self.assertEqual(response.data, original)

    @patch.dict("os.environ", {"SPEC_ARCHIVE_AI_API_KEY": ""})
    def test_ai_missing_configuration_and_bad_question(self):
        self.assertEqual(self.client.post(self.api + "/v03/ask", json={"question": ""}).status_code, 400)
        self.assertEqual(self.client.post(self.api + "/v03/ask", json={"question": "ABC123"}).status_code, 503)

    @patch.dict("os.environ", {"SPEC_ARCHIVE_AI_API_KEY": "test-only", "SPEC_ARCHIVE_AI_MODEL": "test-model"})
    def test_ai_uses_document_content_and_returns_sources(self):
        self.login()
        file = self.upload(title="ABC123").json["file"]
        self.client.post(self.api + "/admin/logout")
        response = io.BytesIO(json.dumps({"output_text": "输出电流为 3 A。"}).encode())
        with patch("backend.archive_ai.urlopen", return_value=response) as call:
            result = self.client.post(self.api + "/v03/ask", json={"question": "ABC123 带载能力"})
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json["sources"][0]["id"], file["id"])
        body = json.loads(call.call_args.args[0].data)
        self.assertIn("output current 3A", body["input"][0]["content"][0]["text"])
        self.assertEqual(result.json["model"], "test-model")
        with patch("backend.archive_ai.urlopen", side_effect=TimeoutError):
            result = self.client.post(self.api + "/v03/ask", json={"question": "ABC123"})
        self.assertEqual(result.status_code, 502)
        self.assertTrue(result.is_json)

    def test_invalid_request_and_session_revocation(self):
        self.login()
        self.assertEqual(self.client.post(self.api + "/v03/files").status_code, 422)
        self.assertEqual(self.upload("bad.xlsx", b"broken", kind="bom").status_code, 422)
        self.assertEqual(self.upload(kind="invalid").status_code, 422)
        file = self.upload().json["file"]
        self.assertEqual(self.client.put(self.api + f"/v03/files/{file['id']}", json=[]).status_code, 400)
        self.client.post(self.api + "/admin/logout")
        self.assertEqual(self.client.post(self.api + "/v03/files/reindex").status_code, 401)

    def test_legacy_xls_upload_preview_search_and_original_download(self):
        self.login()
        payload = (Path(__file__).parent / "fixtures/legacy-bom.xls").read_bytes()
        result = self.upload("PD_X2000_LEGACY.xls", payload, kind="bom")
        self.assertEqual(result.status_code, 201)
        file = result.json["file"]
        path = self.api + f"/v03/files/{file['id']}"
        sheets = self.client.get(path + "/bom-preview").json["sheets"]
        self.assertEqual(sheets[0]["rows"][1][0], "ABC123")
        self.assertEqual(len(self.client.get(self.api + "/v03/files?kind=bom&q=ABC123").json["files"]), 1)
        with self.client.get(path + "/download") as response:
            self.assertEqual(response.data, payload)

    @patch.dict("os.environ", {"SPEC_ARCHIVE_AI_API_KEY": "test-only"})
    def test_ai_returns_only_final_answer_and_rejects_truncation(self):
        payload = {"status": "completed", "output": [
            {"type": "reasoning", "content": [{"type": "output_text", "text": "private model planning"}]},
            {"type": "message", "content": [{"type": "output_text", "text": "无法从现有资料确认。"}]}
        ]}
        with patch("backend.archive_ai.urlopen", return_value=io.BytesIO(json.dumps(payload).encode())):
            result = self.client.post(self.api + "/v03/ask", json={"question": "ABC123"})
        self.assertEqual(result.json["answer"], "无法从现有资料确认。")
        self.assertNotIn("private model planning", result.get_data(as_text=True))
        payload["status"] = "incomplete"
        with patch("backend.archive_ai.urlopen", return_value=io.BytesIO(json.dumps(payload).encode())):
            result = self.client.post(self.api + "/v03/ask", json={"question": "ABC123"})
        self.assertEqual(result.status_code, 502)
