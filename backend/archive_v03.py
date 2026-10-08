"""V0.3 API compatibility on the existing archive store and administrator sessions."""
from datetime import datetime, timezone
from functools import wraps
import os

from flask import Blueprint, jsonify, request, send_file, session

from backend.archive_ai import ArchiveAIError, ask_documents
from backend.excel_index import ExcelIndexError
from backend.spec_archive import ArchiveError


def register_archive_v03(app, archive, admins, prefix="/apps/excel-material-search/api/v03"):
    api = Blueprint("archive_v03", __name__, url_prefix=prefix)

    def admin_only(function):
        @wraps(function)
        def guarded(*args, **kwargs):
            username = session.get("app_admin_username:excel-material-search")
            token = session.get("app_admin_username:excel-material-search:token")
            if not isinstance(username, str) or not admins.validate_session("excel-material-search", username, token):
                return jsonify(error="需要管理员登录"), 401
            return function(*args, **kwargs)
        return guarded

    def client_file(document):
        return {**document, "ext": document["extension"], "content_index_status": document["status"],
                "vendor": document["vendor"] or "—", "note": document["note"] or "—"}

    def uploaded_file(limit):
        uploaded = request.files.get("file")
        if uploaded is None or not uploaded.filename:
            raise ArchiveError("请选择要上传的文件")
        payload = uploaded.stream.read(limit + 1)
        if len(payload) > limit:
            raise ArchiveError(f"文件不能超过 {limit // (1024 * 1024)} MB")
        return uploaded.filename, payload

    @api.errorhandler(ArchiveError)
    @api.errorhandler(ExcelIndexError)
    def invalid_file(error):
        return jsonify(error=str(error)), 422

    @api.get("/files")
    def files():
        filters = {name: request.args.get(name, "") for name in ("kind", "category", "vendor", "board_code", "main_chip")}
        documents = archive.list_documents(query=request.args.get("q", ""), sort_order=request.args.get("sort", "newest"), **filters)
        return jsonify(files=[client_file(document) for document in documents])

    @api.post("/files/analyze")
    @admin_only
    def analyze():
        name, payload = uploaded_file(20 * 1024 * 1024)
        return analysis_response(archive.analyze_upload(name, payload))

    def analysis_response(result):
        metadata = dict(result["metadata"])
        metadata["intro"] = metadata.get("note", "")
        return jsonify(**{**result, "metadata": metadata}, extractedChars=result["extracted_chars"],
                       model=os.getenv("SPEC_ARCHIVE_AI_MODEL", "gpt-5.6-terra"))

    @api.post("/files/<int:document_id>/analyze")
    @admin_only
    def analyze_existing(document_id):
        result = archive.analyze_document(document_id)
        if result is None:
            return jsonify(error="未找到器件手册"), 404
        return analysis_response(result)

    @api.post("/files")
    @admin_only
    def upload():
        name, payload = uploaded_file(100 * 1024 * 1024)
        kind = request.form.get("kind", "manual")
        modified = ""
        if kind == "bom" and request.form.get("file_modified_at"):
            try:
                modified = datetime.fromtimestamp(float(request.form["file_modified_at"]) / 1000, timezone.utc).isoformat()
            except (ValueError, OverflowError, OSError):
                return jsonify(error="文件修改时间无效"), 400
        metadata = {field: request.form.get(field, "") for field in ("title", "category", "package", "vendor", "remark", "note")}
        document = archive.upload_document(name, payload, kind=kind, metadata=metadata, file_modified_at=modified)
        return jsonify(file=client_file(document)), 201

    @api.post("/files/reindex")
    @admin_only
    def reindex():
        return jsonify(ok=True, indexed=archive.reindex())

    @api.put("/files/<int:document_id>")
    @admin_only
    def update(document_id):
        body = request.get_json(silent=True)
        if not isinstance(body, dict):
            return jsonify(error="请提交有效的文档信息"), 400
        row = archive.document_path(document_id)
        if row is None:
            return jsonify(error="未找到文件"), 404
        allowed = ("board_type", "main_chip", "board_name") if row[0]["kind"] == "bom" else ("title", "category", "package", "vendor", "remark", "note")
        if any(field in body and not isinstance(body[field], str) for field in allowed):
            return jsonify(error="文档信息必须为文本"), 400
        document = archive.update_document(document_id, {key: body[key] for key in allowed if key in body})
        return jsonify(file=client_file(document))

    @api.delete("/files/<int:document_id>")
    @admin_only
    def delete(document_id):
        if archive.delete_document(document_id) is None:
            return jsonify(error="未找到文件"), 404
        return jsonify(ok=True)

    @api.get("/files/<int:document_id>/bom-preview")
    def workbook(document_id):
        row = archive.document_path(document_id)
        if row is None or row[0]["kind"] != "bom":
            return jsonify(error="未找到 BOM"), 404
        try:
            return jsonify(archive.preview_workbook(document_id))
        except Exception:
            return jsonify(error="无法读取 BOM 工作簿"), 422

    def original(document_id, attachment):
        item = archive.document_path(document_id)
        if item is None or not item[1].is_file():
            return jsonify(error="未找到文件"), 404
        row, path = item
        response = send_file(path, mimetype="application/octet-stream" if attachment else row["mime_type"],
                             as_attachment=attachment, download_name=row["original_name"])
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response

    @api.get("/files/<int:document_id>/download")
    def download(document_id):
        return original(document_id, True)

    @api.get("/files/<int:document_id>/preview")
    def preview(document_id):
        return original(document_id, False)

    @api.post("/ask")
    def ask():
        body = request.get_json(silent=True)
        question = body.get("question") if isinstance(body, dict) else None
        if not isinstance(question, str) or not question.strip():
            return jsonify(error="请输入问题"), 400
        if len(question) > 8000:
            return jsonify(error="问题不能超过 8000 字"), 400
        try:
            return jsonify(ask_documents(archive, question.strip()))
        except ArchiveAIError as error:
            return jsonify(error=str(error)), 502 if os.getenv("SPEC_ARCHIVE_AI_API_KEY") else 503

    app.register_blueprint(api)
