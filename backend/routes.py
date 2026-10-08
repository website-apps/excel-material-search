from pathlib import Path
from time import monotonic
from flask import jsonify, request, session, send_file
from backend.excel_index import ExcelIndexError
from backend.spec_archive import ArchiveError

MAX_EXCEL_FILE_SIZE_BYTES = 50 * 1024 * 1024
MAX_ARCHIVE_FILE_SIZE_BYTES = 100 * 1024 * 1024
APP_ADMIN_LOGIN_MAX_FAILURES = 5
APP_ADMIN_LOGIN_WINDOW_SECONDS = 300
EXCEL_MATERIAL_APP_SLUG = 'excel-material-search'

def register_routes(app, excel_index, archive_store, app_admins):
    app_admin_login_failures = {}

    def public_excel_file(indexed_file: dict[str, object], metadata: dict[str, object]) -> dict[str, object]:
        return {
            "id": indexed_file["id"],
            "file_name": indexed_file["original_name"],
            "status": indexed_file["status"],
            "sheet_count": indexed_file["sheet_count"],
            "indexed_cell_count": indexed_file["indexed_cell_count"],
            "error": indexed_file.get("error"),
            "created_at": indexed_file["created_at"],
            "board_code": metadata.get("board_code", ""),
            "main_chip": metadata.get("main_chip", ""),
        }

    def app_admin_session_key(app_slug: str) -> str:
        return f"app_admin_username:{app_slug}"

    def app_admin_access_state(app_slug: str) -> dict[str, object]:
        username = session.get(app_admin_session_key(app_slug))
        token = session.get(f"{app_admin_session_key(app_slug)}:token")
        authenticated = bool(
            isinstance(username, str)
            and app_admins.validate_session(app_slug, username, token)
        )
        return {
            "authenticated": authenticated,
            "role": "admin" if authenticated else "user",
            "username": username if authenticated else None,
        }

    def require_app_admin(app_slug: str):
        access_state = app_admin_access_state(app_slug)
        if not access_state["authenticated"]:
            return jsonify({"error": "application administrator login required"}), 401
        return None

    @app.post("/apps/<app_slug>/api/admin/login")
    def app_admin_login(app_slug: str):
        payload = request.get_json(silent=True)
        if not isinstance(payload, dict):
            return jsonify({"error": "JSON object is required"}), 400
        raw_username = payload.get("username")
        password = payload.get("password")
        if not isinstance(raw_username, str) or not isinstance(password, str):
            return jsonify({"error": "username and password must be strings"}), 400
        username = raw_username.strip()
        if not username:
            return jsonify({"error": "username is required"}), 400

        failure_key = (request.remote_addr or "unknown", app_slug, username)
        now = monotonic()
        recent_failures = [
            timestamp
            for timestamp in app_admin_login_failures.get(failure_key, [])
            if now - timestamp < APP_ADMIN_LOGIN_WINDOW_SECONDS
        ]
        app_admin_login_failures[failure_key] = recent_failures
        if len(recent_failures) >= APP_ADMIN_LOGIN_MAX_FAILURES:
            return jsonify({"error": "too many login attempts; try again later"}), 429

        if not app_admins.authenticate(app_slug, username, password):
            recent_failures.append(now)
            return jsonify({"error": "invalid application administrator credentials"}), 401

        app_admin_login_failures.pop(failure_key, None)
        token = app_admins.session_token(app_slug, username)
        if token is None:
            return jsonify({"error": "application administrator is unavailable"}), 401
        session[app_admin_session_key(app_slug)] = username
        session[f"{app_admin_session_key(app_slug)}:token"] = token
        return jsonify({"authenticated": True, "role": "admin", "username": username})

    @app.post("/apps/<app_slug>/api/admin/logout")
    def app_admin_logout(app_slug: str):
        session.pop(app_admin_session_key(app_slug), None)
        session.pop(f"{app_admin_session_key(app_slug)}:token", None)
        return jsonify({"authenticated": False, "role": "user", "username": None})

    @app.get("/apps/<app_slug>/api/admin/session")
    def app_admin_session(app_slug: str):
        return jsonify(app_admin_access_state(app_slug))

    @app.get("/apps/excel-material-search/api/files")
    def list_excel_files():
        error_response = require_app_admin(EXCEL_MATERIAL_APP_SLUG)
        if error_response is not None:
            return error_response
        metadata = archive_store.bom_file_metadata()
        return jsonify({"files": [public_excel_file(item, metadata.get(item["id"], {})) for item in excel_index.list_files()]})

    @app.delete("/apps/excel-material-search/api/files")
    def delete_excel_files():
        error_response = require_app_admin(EXCEL_MATERIAL_APP_SLUG)
        if error_response is not None:
            return error_response
        payload = request.get_json(silent=True) or {}
        file_ids = payload.get("file_ids")
        if (
            not isinstance(file_ids, list)
            or not file_ids
            or any(
                isinstance(file_id, bool)
                or not isinstance(file_id, int)
                or file_id <= 0
                for file_id in file_ids
            )
        ):
            return jsonify({"error": "file_ids must be a non-empty list of integers"}), 400

        deleted_files = excel_index.delete_files(file_ids)
        if deleted_files is None:
            return jsonify({"error": "one or more Excel files were not found"}), 404
        return jsonify(
            {
                "files": [
                    {
                        "id": deleted_file["id"],
                        "file_name": deleted_file["original_name"],
                    }
                    for deleted_file in deleted_files
                ]
            }
        )

    @app.delete("/apps/excel-material-search/api/files/<int:file_id>")
    def delete_excel_file(file_id: int):
        error_response = require_app_admin(EXCEL_MATERIAL_APP_SLUG)
        if error_response is not None:
            return error_response
        deleted_file = excel_index.delete_file(file_id)
        if deleted_file is None:
            return jsonify({"error": "Excel file not found"}), 404
        return jsonify(
            {
                "file": {
                    "id": deleted_file["id"],
                    "file_name": deleted_file["original_name"],
                }
            }
        )

    @app.post("/apps/excel-material-search/api/files")
    def upload_excel_files():
        error_response = require_app_admin(EXCEL_MATERIAL_APP_SLUG)
        if error_response is not None:
            return error_response
        uploads = request.files.getlist("files") or request.files.getlist("file")
        uploads = [upload for upload in uploads if upload.filename]
        if not uploads:
            return jsonify({"error": "at least one Excel file is required"}), 400

        results: list[dict[str, object]] = []
        ready_count = 0
        for upload in uploads:
            original_name = Path(upload.filename or "").name
            payload = upload.read()
            if len(payload) > MAX_EXCEL_FILE_SIZE_BYTES:
                results.append(
                    {
                        "file_name": original_name,
                        "status": "failed",
                        "error": "Excel file is too large",
                    }
                )
                continue

            try:
                indexed_file = excel_index.index_workbook(original_name, payload)
                document = archive_store.register_excel_file(indexed_file)
            except ExcelIndexError as exc:
                results.append(
                    {
                        "file_name": original_name,
                        "status": "failed",
                        "error": str(exc),
                    }
                )
                continue

            ready_count += 1
            results.append(public_excel_file(indexed_file, document))

        response_status = 201 if ready_count else 400
        return jsonify({"files": results}), response_status

    @app.post("/apps/excel-material-search/api/query")
    def query_excel_files():
        payload = request.get_json(silent=True) or {}
        query = str(payload.get("query", "")).strip()
        if not query:
            return jsonify({"error": "query is required"}), 400

        kind = str(payload.get("kind", "bom")).strip() or "bom"
        if kind not in {"manual", "bom"}:
            return jsonify({"error": "kind must be manual or bom"}), 400
        try:
            return jsonify(archive_store.query_documents(query, kind=kind))
        except ArchiveError as exc:
            return jsonify({"error": str(exc)}), 400

    @app.get("/apps/excel-material-search/api/documents")
    def list_archive_documents():
        requested_kind = str(request.args.get("kind", ""))
        access_state = app_admin_access_state(EXCEL_MATERIAL_APP_SLUG)
        if requested_kind == "bom" and not access_state["authenticated"]:
            return jsonify({"error": "application administrator login required"}), 401
        visible_kind = requested_kind or ("" if access_state["authenticated"] else "manual")
        return jsonify(
            {
                "documents": archive_store.list_documents(
                    query=str(request.args.get("q", "")),
                    kind=visible_kind,
                    category=str(request.args.get("category", "")),
                    vendor=str(request.args.get("vendor", "")),
                    board_code=str(request.args.get("board_code", "")),
                    main_chip=str(request.args.get("main_chip", "")),
                )
            }
        )

    @app.post("/apps/excel-material-search/api/documents")
    def upload_archive_documents():
        error_response = require_app_admin(EXCEL_MATERIAL_APP_SLUG)
        if error_response is not None:
            return error_response
        uploads = request.files.getlist("files") or request.files.getlist("file")
        uploads = [upload for upload in uploads if upload.filename]
        if not uploads:
            return jsonify({"error": "at least one document is required"}), 400

        kind = str(request.form.get("kind", "manual")).strip() or "manual"
        metadata = {
            "title": request.form.get("title", ""),
            "category": request.form.get("category", ""),
            "package": request.form.get("package", ""),
            "vendor": request.form.get("vendor", ""),
            "remark": request.form.get("remark", ""),
            "note": request.form.get("note", ""),
        }
        results: list[dict[str, object]] = []
        for upload in uploads:
            original_name = Path(upload.filename or "").name
            payload = upload.read()
            if len(payload) > MAX_ARCHIVE_FILE_SIZE_BYTES:
                results.append(
                    {
                        "original_name": original_name,
                        "status": "failed",
                        "error": "document file is too large",
                    }
                )
                continue
            try:
                document = archive_store.upload_document(
                    original_name,
                    payload,
                    kind=kind,
                    metadata=metadata,
                    file_modified_at=str(request.form.get("file_modified_at", "")),
                )
            except (ArchiveError, ExcelIndexError) as exc:
                results.append(
                    {
                        "original_name": original_name,
                        "status": "failed",
                        "error": str(exc),
                    }
                )
                continue
            results.append(document)
        response_status = 201 if any(item.get("id") for item in results) else 400
        return jsonify({"documents": results}), response_status

    @app.put("/apps/excel-material-search/api/documents/<int:document_id>")
    def update_archive_document(document_id: int):
        error_response = require_app_admin(EXCEL_MATERIAL_APP_SLUG)
        if error_response is not None:
            return error_response
        payload = request.get_json(silent=True)
        if not isinstance(payload, dict):
            return jsonify({"error": "JSON object is required"}), 400
        try:
            document = archive_store.update_document(document_id, payload)
        except ArchiveError as exc:
            return jsonify({"error": str(exc)}), 400
        if document is None:
            return jsonify({"error": "document not found"}), 404
        return jsonify({"document": document})

    @app.delete("/apps/excel-material-search/api/documents")
    def delete_archive_documents():
        error_response = require_app_admin(EXCEL_MATERIAL_APP_SLUG)
        if error_response is not None:
            return error_response
        payload = request.get_json(silent=True) or {}
        document_ids = payload.get("document_ids")
        if (
            not isinstance(document_ids, list)
            or not document_ids
            or any(isinstance(document_id, bool) or not isinstance(document_id, int) or document_id <= 0 for document_id in document_ids)
        ):
            return jsonify({"error": "document_ids must be a non-empty list of integers"}), 400
        deleted = []
        for document_id in sorted(set(document_ids)):
            document = archive_store.delete_document(document_id)
            if document is None:
                return jsonify({"error": "one or more documents were not found"}), 404
            deleted.append({"id": document["id"], "original_name": document["original_name"]})
        return jsonify({"documents": deleted})

    @app.delete("/apps/excel-material-search/api/documents/<int:document_id>")
    def delete_archive_document(document_id: int):
        error_response = require_app_admin(EXCEL_MATERIAL_APP_SLUG)
        if error_response is not None:
            return error_response
        document = archive_store.delete_document(document_id)
        if document is None:
            return jsonify({"error": "document not found"}), 404
        return jsonify({"document": {"id": document["id"], "original_name": document["original_name"]}})

    @app.post("/apps/excel-material-search/api/documents/reindex")
    def reindex_archive_documents():
        error_response = require_app_admin(EXCEL_MATERIAL_APP_SLUG)
        if error_response is not None:
            return error_response
        try:
            indexed = archive_store.reindex()
        except ArchiveError as exc:
            return jsonify({"error": str(exc)}), 422
        return jsonify({"ok": True, "indexed": indexed})

    @app.get("/apps/excel-material-search/api/documents/<int:document_id>/download")
    def download_archive_document(document_id: int):
        resolved = archive_store.document_path(document_id)
        if resolved is None:
            return jsonify({"error": "document not found"}), 404
        row, path = resolved
        if row["kind"] == "bom":
            error_response = require_app_admin(EXCEL_MATERIAL_APP_SLUG)
            if error_response is not None:
                return error_response
        if not path.exists():
            return jsonify({"error": "document file is missing"}), 404
        response = send_file(
            path,
            as_attachment=True,
            download_name=row["original_name"],
            mimetype=row["mime_type"],
        )
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response

    @app.get("/apps/excel-material-search/api/documents/<int:document_id>/preview")
    def preview_archive_document(document_id: int):
        resolved = archive_store.document_path(document_id)
        if resolved is None:
            return jsonify({"error": "document not found"}), 404
        row, path = resolved
        if row["kind"] == "bom":
            error_response = require_app_admin(EXCEL_MATERIAL_APP_SLUG)
            if error_response is not None:
                return error_response
        if not path.exists():
            return jsonify({"error": "document file is missing"}), 404
        response = send_file(path, as_attachment=False, mimetype=row["mime_type"])
        response.headers["Content-Disposition"] = "inline"
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response

    @app.get("/apps/excel-material-search/api/documents/<int:document_id>/workbook-preview")
    def preview_archive_workbook(document_id: int):
        error_response = require_app_admin(EXCEL_MATERIAL_APP_SLUG)
        if error_response is not None:
            return error_response
        try:
            return jsonify(archive_store.preview_workbook(document_id))
        except ArchiveError as exc:
            return jsonify({"error": str(exc)}), 422
