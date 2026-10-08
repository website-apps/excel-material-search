import io
import json
import unittest
from unittest.mock import patch

from backend.archive_metadata import analyze_metadata, infer_filename_metadata
from backend.archive_search import query_matches, score_document


class ArchiveMetadataTests(unittest.TestCase):
    def test_filename_inference_matches_reference_rules(self):
        item = infer_filename_metadata("TI-TPS5430-QFN.pdf")
        self.assertEqual(item["category"], "电源管理")
        self.assertEqual(item["vendor"], "TI")
        self.assertEqual(item["package"], "QFN")
        self.assertEqual(infer_filename_metadata("unknown.pdf")["category"], "")

    @patch.dict("os.environ", {"SPEC_ARCHIVE_AI_API_KEY": ""})
    def test_missing_ai_keeps_filename_fallback(self):
        result = analyze_metadata("stm32.txt", "Microcontroller")
        self.assertEqual(result["metadata"]["category"], "单片机/微控制器")
        self.assertIn("warning", result)

    @patch.dict("os.environ", {"SPEC_ARCHIVE_AI_API_KEY": "test-only"})
    def test_ai_metadata_uses_content_and_validates_categories(self):
        output = {"title": "ABC123", "category": "DC-DC", "package": "qfn 16", "vendor": "TI", "intro": ["5 V", "3 A"]}
        response = io.BytesIO(json.dumps({"output": [{"content": [{"type": "output_text", "text": json.dumps(output)}]}]}).encode())
        with patch("backend.archive_metadata.urlopen", return_value=response) as call:
            result = analyze_metadata("original.pdf", "ABC123 output voltage 5V")
        self.assertEqual(result["metadata"]["note"], "5 V, 3 A")
        self.assertEqual(result["metadata"]["package"], "QFN-16")
        self.assertIn("ABC123 output voltage", json.loads(call.call_args.args[0].data)["input"][1]["content"])

    @patch.dict("os.environ", {"SPEC_ARCHIVE_AI_API_KEY": "test-only"})
    def test_ai_failure_and_invalid_category_do_not_erase_fallback(self):
        with patch("backend.archive_metadata.urlopen", side_effect=TimeoutError):
            self.assertIn("warning", analyze_metadata("buck.txt", "text"))
        response = io.BytesIO(json.dumps({"output_text": '{"category":"invented"}'}).encode())
        with patch("backend.archive_metadata.urlopen", return_value=response):
            self.assertEqual(analyze_metadata("buck.txt", "text")["metadata"]["category"], "电源管理")

    def test_search_requires_all_keywords_and_translates_chinese(self):
        self.assertTrue(query_matches("abc output current 3a", "ABC，输出电流"))
        self.assertFalse(query_matches("abc output current 3a", "ABC 5v"))
        self.assertGreater(score_document("abc output current 3a", "ABC 带载能力"), 0)
