"""Standalone document archive, using platform-owned PostgreSQL and files."""
import os
from pathlib import Path

from flask import Flask, jsonify, request, send_from_directory
from werkzeug.exceptions import HTTPException
from werkzeug.middleware.proxy_fix import ProxyFix

from backend.app_admins import AppAdminStore
from backend.database import connect_database
from backend.excel_index import ExcelIndexStore
from backend.spec_archive import ArchiveStore
from backend.routes import register_routes

BASE = "/apps/excel-material-search"


def create_app(storage=None, admin_config=None, secret=None):
    storage = Path(storage or os.environ.get("APP_STORAGE_PATH", "/app-data"))
    app = Flask(__name__, static_folder=None)
    app.secret_key = secret or os.environ["APP_SESSION_SECRET"]
    app.config.update(SESSION_COOKIE_NAME="app_excel-material-search_session",
                      SESSION_COOKIE_PATH=BASE + "/", SESSION_COOKIE_HTTPONLY=True,
                      SESSION_COOKIE_SAMESITE="Lax", MAX_CONTENT_LENGTH=256 * 1024 * 1024)
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_host=1, x_proto=1)
    excel_index = ExcelIndexStore(storage / "archive.sqlite3", storage)
    archive = ArchiveStore(storage / "archive.sqlite3", storage, excel_index)
    admins = AppAdminStore(Path(admin_config or "/app-config/app-admins.json"))
    register_routes(app, excel_index, archive, admins)

    @app.errorhandler(HTTPException)
    def api_error(error):
        if not request.path.startswith(BASE + "/api/"):
            return error
        message = {
            413: "单次上传内容不能超过 256 MB，请分批上传",
            500: "资料服务处理失败，请稍后重试；如仍失败，请联系管理员查看服务日志",
        }.get(error.code, error.description)
        response = error.get_response()
        response.data = app.json.dumps({"error": message})
        response.content_type = "application/json"
        return response

    @app.get("/health")
    def health():
        try:
            with connect_database(None, "archive") as connection:
                connection.execute("SELECT 1 FROM archive_documents LIMIT 1").fetchone()
            if not storage.is_dir():
                raise RuntimeError("document storage unavailable")
            return jsonify({"status": "ok"})
        except Exception:
            return jsonify({"status": "unavailable"}), 503

    @app.get(BASE)
    @app.get(BASE + "/")
    @app.get(BASE + "/admin-login")
    def page():
        return send_from_directory("frontend/dist", "index.html")

    @app.get(BASE + "/assets/<path:filename>")
    def assets(filename):
        return send_from_directory("frontend/dist/assets", filename)

    return app
