"""
Astra OS — Gmail Integration
==============================
Clean async wrapper around the Gmail API v1.

Auth: OAuth 2.0 with offline access.
      First run opens a browser → stores token in token.json.
      Subsequent runs use the stored (auto-refreshed) token.

Scopes used:
  gmail.readonly  — read emails + threads
  gmail.send      — send drafted replies
  gmail.modify    — mark as read, add labels

Usage:
    client = GmailClient("credentials.json", "gmail_token.json")
    emails = await client.get_recent_emails(hours_back=24)
    await client.send_email("user@example.com", "Subject", "Body text")
"""

import asyncio
import base64
import os
import re
import ssl
from datetime import datetime, timedelta
from email.mime.text import MIMEText
from email.utils import parseaddr
from typing import Optional

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build

from brain.models import EmailMessage


SCOPES = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/gmail.modify",
]

# Retry config for SSL / transient failures
MAX_RETRIES = 3
RETRY_DELAY = 2   # seconds between retries


class GmailClient:
    """
    Async Gmail API client.

    All network I/O runs in a thread pool so it never blocks
    the FastAPI / asyncio event loop.

    Builds a FRESH API service for each call to avoid httplib2
    SSL connection pool corruption on Python 3.14.
    """

    def __init__(self, credentials_path: str, token_path: str):
        self._credentials_path = credentials_path
        self._token_path = token_path
        self._creds: Optional[Credentials] = None

    # ── Auth ──────────────────────────────────────────────────────────────────

    def _get_credentials(self) -> Credentials:
        """Load or refresh OAuth credentials. Opens browser on first run."""
        if self._creds and self._creds.valid:
            return self._creds

        creds = None
        if os.path.exists(self._token_path):
            creds = Credentials.from_authorized_user_file(self._token_path, SCOPES)

        if not creds or not creds.valid:
            if creds and creds.expired and creds.refresh_token:
                creds.refresh(Request())
            else:
                flow = InstalledAppFlow.from_client_secrets_file(
                    self._credentials_path, SCOPES
                )
                creds = flow.run_local_server(port=0)

            with open(self._token_path, "w") as f:
                f.write(creds.to_json())

        self._creds = creds
        return creds

    def _build_service(self):
        """Build a FRESH Gmail service — avoids stale SSL connections."""
        creds = self._get_credentials()
        return build("gmail", "v1", credentials=creds, cache_discovery=False)

    def is_authenticated(self) -> bool:
        """Check if valid credentials exist without triggering a browser flow."""
        if not os.path.exists(self._token_path):
            return False
        try:
            creds = Credentials.from_authorized_user_file(self._token_path, SCOPES)
            return creds.valid or (creds.expired and bool(creds.refresh_token))
        except Exception:
            return False

    # ── Retry helper ─────────────────────────────────────────────────────────

    async def _retry_call(self, fn, label: str = "API call"):
        """
        Run a sync function in a thread with SSL/transient error retry.
        Builds a fresh service on each retry to avoid stale connections.
        """
        last_error = None
        for attempt in range(1, MAX_RETRIES + 1):
            try:
                return await asyncio.to_thread(fn)
            except (ssl.SSLError, OSError, ConnectionError, TimeoutError) as e:
                last_error = e
                if attempt < MAX_RETRIES:
                    wait = RETRY_DELAY * attempt
                    print(f"[Gmail] ⚠️  {label} attempt {attempt} failed: {e} — retrying in {wait}s")
                    await asyncio.sleep(wait)
                else:
                    print(f"[Gmail] ❌ {label} failed after {MAX_RETRIES} attempts: {e}")
            except Exception as e:
                print(f"[Gmail] ❌ {label} failed: {e}")
                return None
        return None

    # ── Read ──────────────────────────────────────────────────────────────────

    async def get_recent_emails(
        self,
        hours_back: int = 24,
        max_results: int = 30,
        exclude_promotions: bool = True,
    ) -> list[EmailMessage]:
        """
        Fetch emails received in the last N hours.
        Excludes promotional/social categories by default.
        Returns parsed EmailMessage objects, newest first.
        """
        after_ts = int((datetime.utcnow() - timedelta(hours=hours_back)).timestamp())
        query = f"after:{after_ts} -from:me"
        if exclude_promotions:
            query += " -category:promotions -category:social"

        def _fetch():
            service = self._build_service()
            result = service.users().messages().list(
                userId="me", q=query, maxResults=max_results
            ).execute()
            return result.get("messages", [])

        message_refs = await self._retry_call(_fetch, "list messages")
        if not message_refs:
            return []

        # Fetch sequentially with fresh connections to avoid SSL pool corruption
        emails = []
        for ref in message_refs:
            email = await self._fetch_message(ref["id"])
            if email:
                emails.append(email)

        return emails

    async def get_thread(self, thread_id: str) -> list[EmailMessage]:
        """Fetch all messages in a thread."""
        def _fetch():
            service = self._build_service()
            thread = service.users().threads().get(
                userId="me", id=thread_id, format="full"
            ).execute()
            return thread.get("messages", [])

        try:
            raw_messages = await asyncio.to_thread(_fetch)
        except Exception as e:
            print(f"[Gmail] ❌ get thread {thread_id} failed: {e}")
            return []

        emails = []
        for msg_data in raw_messages:
            email = self._parse_message_data(msg_data)
            if email:
                emails.append(email)
        return emails

    async def _fetch_message(self, message_id: str) -> Optional[EmailMessage]:
        """Fetch and parse a single message by ID with SSL retry."""
        def _get():
            service = self._build_service()
            return service.users().messages().get(
                userId="me", id=message_id, format="full"
            ).execute()

        msg_data = await self._retry_call(_get, f"fetch message {message_id}")
        if msg_data:
            return self._parse_message_data(msg_data)
        return None

    # ── Send ──────────────────────────────────────────────────────────────────

    async def send_email(self, to: str, subject: str, body: str) -> bool:
        """Send a plain-text email. Returns True on success."""
        message = MIMEText(body, "plain")
        message["to"] = to
        message["subject"] = subject

        raw = base64.urlsafe_b64encode(message.as_bytes()).decode()

        def _send():
            service = self._build_service()
            service.users().messages().send(
                userId="me", body={"raw": raw}
            ).execute()

        try:
            await asyncio.to_thread(_send)
            print(f"[Gmail] ✅ Email sent to {to}: {subject}")
            return True
        except Exception as e:
            print(f"[Gmail] ❌ send failed: {e}")
            return False

    async def reply_to_thread(
        self, thread_id: str, to: str, subject: str, body: str
    ) -> bool:
        """Send a reply within an existing thread."""
        message = MIMEText(body, "plain")
        message["to"] = to
        message["subject"] = f"Re: {subject}" if not subject.startswith("Re:") else subject
        message["In-Reply-To"] = thread_id
        message["References"] = thread_id

        raw = base64.urlsafe_b64encode(message.as_bytes()).decode()

        def _send():
            service = self._build_service()
            service.users().messages().send(
                userId="me",
                body={"raw": raw, "threadId": thread_id}
            ).execute()

        try:
            await asyncio.to_thread(_send)
            return True
        except Exception as e:
            print(f"[Gmail] ❌ reply to thread {thread_id} failed: {e}")
            return False

    # ── Parsing ───────────────────────────────────────────────────────────────

    def _parse_message_data(self, msg_data: dict) -> Optional[EmailMessage]:
        """Parse a raw Gmail API message into an EmailMessage."""
        try:
            headers = {
                h["name"]: h["value"]
                for h in msg_data.get("payload", {}).get("headers", [])
            }

            sender_raw   = headers.get("From", "")
            _, sender_email = parseaddr(sender_raw)
            subject      = headers.get("Subject", "(no subject)")
            date_str     = headers.get("Date", "")
            labels       = msg_data.get("labelIds", [])

            body = self._extract_body(msg_data.get("payload", {}))

            # Parse timestamp from internalDate (milliseconds)
            internal_date = msg_data.get("internalDate", "0")
            timestamp = int(internal_date) / 1000.0

            return EmailMessage(
                message_id   = msg_data["id"],
                thread_id    = msg_data.get("threadId", ""),
                sender       = sender_raw,
                sender_email = sender_email,
                subject      = subject,
                body         = body,
                date         = date_str,
                timestamp    = timestamp,
                is_unread    = "UNREAD" in labels,
                labels       = labels,
            )

        except Exception as e:
            print(f"[Gmail] ⚠️  parse message failed: {e}")
            return None

    def _extract_body(self, payload: dict) -> str:
        """
        Recursively extract plain-text body from a Gmail message payload.
        Handles both simple messages and multipart (text/plain preferred).
        """
        mime_type = payload.get("mimeType", "")

        # Direct text/plain part
        if mime_type == "text/plain":
            data = payload.get("body", {}).get("data", "")
            if data:
                return base64.urlsafe_b64decode(data).decode("utf-8", errors="replace")

        # Multipart: recurse into parts
        if "parts" in payload:
            # Prefer text/plain over text/html
            for part in payload["parts"]:
                if part.get("mimeType") == "text/plain":
                    text = self._extract_body(part)
                    if text:
                        return text
            # Fall back to any text part
            for part in payload["parts"]:
                text = self._extract_body(part)
                if text:
                    return text

        # Fallback: HTML → strip tags
        if mime_type == "text/html":
            data = payload.get("body", {}).get("data", "")
            if data:
                html = base64.urlsafe_b64decode(data).decode("utf-8", errors="replace")
                return re.sub(r"<[^>]+>", " ", html).strip()

        return ""
