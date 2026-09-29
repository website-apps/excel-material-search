from __future__ import annotations

import hmac
import json
import secrets
from pathlib import Path


class AppAdminConfigError(ValueError):
    """Raised when the application administrator configuration is invalid."""


class AppAdminStore:
    def __init__(self, config_file: Path) -> None:
        self.config_file = config_file
        self._credentials = self._load_credentials()
        self._session_tokens = {
            (app_slug, username): secrets.token_urlsafe(32)
            for app_slug, credentials in self._credentials.items()
            for username in credentials
        }

    def authenticate(self, app_slug: str, username: str, password: str) -> bool:
        expected_password = self._credentials.get(app_slug, {}).get(username)
        if expected_password is None:
            return False
        return hmac.compare_digest(expected_password, password)

    def has_admin(self, app_slug: str, username: str) -> bool:
        return username in self._credentials.get(app_slug, {})

    def session_token(self, app_slug: str, username: str) -> str | None:
        return self._session_tokens.get((app_slug, username))

    def validate_session(self, app_slug: str, username: str, token: object) -> bool:
        expected_token = self.session_token(app_slug, username)
        if expected_token is None or not isinstance(token, str) or not token:
            return False
        return hmac.compare_digest(expected_token, token)

    def _load_credentials(self) -> dict[str, dict[str, str]]:
        if not self.config_file.exists():
            return {}

        try:
            payload = json.loads(self.config_file.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            raise AppAdminConfigError(f"invalid JSON in {self.config_file}: {exc}") from exc

        if not isinstance(payload, dict) or not isinstance(
            payload.get("applications"), dict
        ):
            raise AppAdminConfigError("applications must be an object")

        credentials_by_app: dict[str, dict[str, str]] = {}
        for raw_app_slug, raw_application in payload["applications"].items():
            if not isinstance(raw_app_slug, str) or not raw_app_slug.strip():
                raise AppAdminConfigError("application slug must be a non-empty string")
            if not isinstance(raw_application, dict):
                raise AppAdminConfigError(f"application {raw_app_slug} must be an object")
            app_slug = raw_app_slug.strip()
            if app_slug in credentials_by_app:
                raise AppAdminConfigError(f"duplicate application slug {app_slug}")
            raw_admins = raw_application.get("admins", [])
            if not isinstance(raw_admins, list):
                raise AppAdminConfigError(f"admins for {raw_app_slug} must be a list")

            credentials: dict[str, str] = {}
            for raw_admin in raw_admins:
                if not isinstance(raw_admin, dict):
                    raise AppAdminConfigError(
                        f"administrator entry for {raw_app_slug} must be an object"
                    )
                username = raw_admin.get("username")
                password = raw_admin.get("password")
                if not isinstance(username, str) or not username.strip():
                    raise AppAdminConfigError("administrator username must be non-empty")
                if not isinstance(password, str) or not password:
                    raise AppAdminConfigError("administrator must have a non-empty password")
                username = username.strip()
                if username in credentials:
                    raise AppAdminConfigError(
                        f"duplicate username {username} for {raw_app_slug}"
                    )
                credentials[username] = password

            credentials_by_app[app_slug] = credentials

        return credentials_by_app
