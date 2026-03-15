"""
Astra OS — Google Drive Integration
=====================================
Async wrapper around the Google Drive API v3.

Capabilities:
  - List recent files
  - Search files by name, type, or content
  - Get file metadata and sharing links
  - List files shared with specific people
  - Create new Google Docs/Sheets/Slides

Scopes used:
  drive.readonly — read file metadata and content
  drive.file    — create/edit files created by this app
"""

import asyncio
import os
from datetime import datetime, timezone
from typing import Optional

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build


# Combined scopes — shared token file with Gmail/Calendar
SCOPES = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/calendar",
    "https://www.googleapis.com/auth/drive.readonly",
    "https://www.googleapis.com/auth/drive.file",
    "https://www.googleapis.com/auth/contacts.readonly",
    "https://www.googleapis.com/auth/tasks",
]


class DriveFile:
    """Parsed representation of a Google Drive file."""

    __slots__ = (
        "file_id", "name", "mime_type", "web_link", "icon_link",
        "size_bytes", "modified_at", "owners", "shared", "starred",
    )

    def __init__(self, file_id, name, mime_type, web_link="", icon_link="",
                 size_bytes=0, modified_at="", owners=None, shared=False, starred=False):
        self.file_id     = file_id
        self.name        = name
        self.mime_type    = mime_type
        self.web_link    = web_link
        self.icon_link   = icon_link
        self.size_bytes  = size_bytes
        self.modified_at = modified_at
        self.owners      = owners or []
        self.shared      = shared
        self.starred     = starred

    def to_dict(self) -> dict:
        # Friendly type mapping
        type_map = {
            "application/vnd.google-apps.document": "Google Doc",
            "application/vnd.google-apps.spreadsheet": "Google Sheet",
            "application/vnd.google-apps.presentation": "Google Slides",
            "application/vnd.google-apps.folder": "Folder",
            "application/pdf": "PDF",
        }
        friendly_type = type_map.get(self.mime_type, self.mime_type.split("/")[-1])
        size_mb = round(self.size_bytes / (1024 * 1024), 2) if self.size_bytes else None

        return {
            "file_id":     self.file_id,
            "name":        self.name,
            "type":        friendly_type,
            "link":        self.web_link,
            "size_mb":     size_mb,
            "modified_at": self.modified_at,
            "owners":      self.owners,
            "shared":      self.shared,
            "starred":     self.starred,
        }


class DriveClient:
    """Async Google Drive API client."""

    FIELDS = "files(id, name, mimeType, webViewLink, iconLink, size, modifiedTime, owners, shared, starred)"

    def __init__(self, credentials_path: str, token_path: str):
        self._credentials_path = credentials_path
        self._token_path       = token_path

    def _get_credentials(self) -> Credentials:
        creds = None
        if os.path.exists(self._token_path):
            creds = Credentials.from_authorized_user_file(self._token_path, SCOPES)
        if not creds or not creds.valid:
            if creds and creds.expired and creds.refresh_token:
                creds.refresh(Request())
            else:
                flow = InstalledAppFlow.from_client_secrets_file(self._credentials_path, SCOPES)
                creds = flow.run_local_server(port=0)
            with open(self._token_path, "w") as f:
                f.write(creds.to_json())
        return creds

    def _build_service(self):
        creds = self._get_credentials()
        return build("drive", "v3", credentials=creds, cache_discovery=False)

    # ── List / Search ─────────────────────────────────────────────────────────

    async def list_recent_files(self, max_results: int = 15) -> list[DriveFile]:
        """List recently modified files."""
        def _fetch():
            service = self._build_service()
            result = service.files().list(
                pageSize=max_results,
                orderBy="modifiedTime desc",
                fields=self.FIELDS,
                q="trashed = false",
            ).execute()
            return result.get("files", [])

        try:
            raw = await asyncio.to_thread(_fetch)
            return [self._parse_file(f) for f in raw if f]
        except Exception as e:
            print(f"[Drive] ❌ list files failed: {e}")
            return []

    async def search_files(self, query: str, max_results: int = 15) -> list[DriveFile]:
        """
        Search files by name or content.
        Uses Drive's fullText search — searches both names and document content.
        """
        # Escape single quotes in query
        safe_q = query.replace("'", "\\'")
        drive_query = f"fullText contains '{safe_q}' and trashed = false"

        def _fetch():
            service = self._build_service()
            result = service.files().list(
                pageSize=max_results,
                fields=self.FIELDS,
                q=drive_query,
            ).execute()
            return result.get("files", [])

        try:
            raw = await asyncio.to_thread(_fetch)
            return [self._parse_file(f) for f in raw if f]
        except Exception as e:
            print(f"[Drive] ❌ search files failed: {e}")
            return []

    async def search_by_type(self, file_type: str, max_results: int = 10) -> list[DriveFile]:
        """
        Search by Google Workspace type.
        Accepts: doc, sheet, slides, pdf, folder, image
        """
        type_map = {
            "doc":    "application/vnd.google-apps.document",
            "sheet":  "application/vnd.google-apps.spreadsheet",
            "slides": "application/vnd.google-apps.presentation",
            "pdf":    "application/pdf",
            "folder": "application/vnd.google-apps.folder",
            "image":  "image/",
        }
        mime = type_map.get(file_type.lower())
        if not mime:
            return []

        if mime.endswith("/"):
            q = f"mimeType contains '{mime}' and trashed = false"
        else:
            q = f"mimeType = '{mime}' and trashed = false"

        def _fetch():
            service = self._build_service()
            result = service.files().list(
                pageSize=max_results,
                orderBy="modifiedTime desc",
                fields=self.FIELDS,
                q=q,
            ).execute()
            return result.get("files", [])

        try:
            raw = await asyncio.to_thread(_fetch)
            return [self._parse_file(f) for f in raw if f]
        except Exception as e:
            print(f"[Drive] ❌ search by type failed: {e}")
            return []

    async def get_file_info(self, file_id: str) -> Optional[dict]:
        """Get metadata for a specific file."""
        def _fetch():
            service = self._build_service()
            return service.files().get(
                fileId=file_id,
                fields="id, name, mimeType, webViewLink, size, modifiedTime, owners, shared, starred, description"
            ).execute()

        try:
            raw = await asyncio.to_thread(_fetch)
            f = self._parse_file(raw)
            result = f.to_dict()
            result["description"] = raw.get("description", "")
            return result
        except Exception as e:
            print(f"[Drive] ❌ get file info failed: {e}")
            return None

    async def create_doc(self, title: str) -> Optional[dict]:
        """Create a new blank Google Doc and return its ID and link."""
        def _create():
            service = self._build_service()
            file_metadata = {
                "name": title,
                "mimeType": "application/vnd.google-apps.document",
            }
            f = service.files().create(body=file_metadata, fields="id, webViewLink").execute()
            return f

        try:
            result = await asyncio.to_thread(_create)
            return {"file_id": result["id"], "link": result.get("webViewLink", ""), "name": title}
        except Exception as e:
            print(f"[Drive] ❌ create doc failed: {e}")
            return None

    # ── Parsing ───────────────────────────────────────────────────────────────

    def _parse_file(self, raw: dict) -> DriveFile:
        owners = [o.get("emailAddress", "") for o in raw.get("owners", [])]
        return DriveFile(
            file_id     = raw.get("id", ""),
            name        = raw.get("name", ""),
            mime_type   = raw.get("mimeType", ""),
            web_link    = raw.get("webViewLink", ""),
            icon_link   = raw.get("iconLink", ""),
            size_bytes  = int(raw.get("size", 0) or 0),
            modified_at = raw.get("modifiedTime", ""),
            owners      = owners,
            shared      = raw.get("shared", False),
            starred     = raw.get("starred", False),
        )
