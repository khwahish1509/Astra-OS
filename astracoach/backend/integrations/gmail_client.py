"""
Astra OS — Gmail Integration (Enhanced)
=========================================
High-performance async wrapper around the Gmail API v1.

Improvements over v1:
  - Batch message fetching (parallel with semaphore control)
  - Smart body extraction (handles nested multipart, quoted-printable, base64)
  - Proper token refresh with expiry checking
  - Label-aware filtering (INBOX, IMPORTANT, STARRED)
  - Search by sender, subject, label
  - Snippet preview without full body fetch (fast mode)

Auth: OAuth 2.0 with offline access.
      First run opens a browser → stores token in token.json.

Scopes used:
  gmail.readonly  — read emails + threads
  gmail.send      — send drafted replies
  gmail.modify    — mark as read, add labels
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


# Combined scopes — shared token file with Calendar/Drive/Tasks/Contacts
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

MAX_RETRIES = 3
RETRY_DELAY = 1.5
MAX_CONCURRENT_FETCHES = 15  # parallel message fetches


class GmailClient:
    """
    High-performance async Gmail API client.

    All network I/O runs in a thread pool via asyncio.to_thread().
    Builds a FRESH API service for each call to avoid httplib2
    SSL connection pool corruption on Python 3.13+.
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
            try:
                creds = Credentials.from_authorized_user_file(self._token_path, SCOPES)
            except Exception as e:
                print(f"[Gmail] ⚠️  Token file corrupt: {e}")
                creds = None

        if not creds or not creds.valid:
            if creds and creds.expired and creds.refresh_token:
                try:
                    creds.refresh(Request())
                except Exception as e:
                    print(f"[Gmail] ⚠️  Token refresh failed: {e} — re-authenticating")
                    creds = None

            if not creds or not creds.valid:
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
        """Check if valid credentials exist (checks expiry too)."""
        if not os.path.exists(self._token_path):
            return False
        try:
            creds = Credentials.from_authorized_user_file(self._token_path, SCOPES)
            if creds.valid:
                return True
            if creds.expired and creds.refresh_token:
                creds.refresh(Request())
                return creds.valid
            return False
        except Exception:
            return False

    # ── Retry helper ─────────────────────────────────────────────────────────

    async def _retry_call(self, fn, label: str = "API call"):
        """Run a sync function in a thread with retry on transient errors."""
        last_error = None
        for attempt in range(1, MAX_RETRIES + 1):
            try:
                return await asyncio.to_thread(fn)
            except (ssl.SSLError, OSError, ConnectionError, TimeoutError) as e:
                last_error = e
                if attempt < MAX_RETRIES:
                    wait = RETRY_DELAY * attempt
                    print(f"[Gmail] ⚠️  {label} attempt {attempt}/{MAX_RETRIES}: {e} — retrying in {wait}s")
                    await asyncio.sleep(wait)
                else:
                    print(f"[Gmail] ❌ {label} failed after {MAX_RETRIES} attempts: {e}")
            except Exception as e:
                print(f"[Gmail] ❌ {label} failed: {e}")
                raise
        return None

    # ── Read — Enhanced ──────────────────────────────────────────────────────

    async def get_recent_emails(
        self,
        hours_back: int = 24,
        max_results: int = 500,
        exclude_promotions: bool = False,
        unread_only: bool = False,
    ) -> list[EmailMessage]:
        """
        Fetch emails received in the last N hours.
        Uses PAGINATED listing to get ALL matching emails (not just one page).
        Uses parallel fetching with semaphore control for speed.

        Args:
            hours_back: How far back to look (87600 = ~10 years = all emails)
            max_results: Maximum emails to return (default 500, set higher for full sync)
            exclude_promotions: If True, skip promo/social/updates categories
            unread_only: If True, only fetch unread emails
        """
        after_ts = int((datetime.utcnow() - timedelta(hours=hours_back)).timestamp())
        query = f"after:{after_ts}"
        if exclude_promotions:
            query += " -category:promotions -category:social -category:updates"
        if unread_only:
            query += " is:unread"

        # ── Paginated listing — fetch ALL message IDs ──
        all_message_refs = []
        page_token = None
        page_size = min(max_results, 500)  # Gmail API max per page is 500

        while len(all_message_refs) < max_results:
            remaining = max_results - len(all_message_refs)
            batch = min(remaining, page_size)

            def _fetch_page(pt=page_token, bs=batch):
                service = self._build_service()
                kwargs = {"userId": "me", "q": query, "maxResults": bs}
                if pt:
                    kwargs["pageToken"] = pt
                result = service.users().messages().list(**kwargs).execute()
                return result

            result = await self._retry_call(_fetch_page, f"list messages (page {len(all_message_refs) // page_size + 1})")
            if not result:
                break

            refs = result.get("messages", [])
            all_message_refs.extend(refs)
            page_token = result.get("nextPageToken")

            if not page_token or not refs:
                break  # No more pages

        if not all_message_refs:
            print(f"[Gmail] No messages found for query: {query}")
            return []

        print(f"[Gmail] Found {len(all_message_refs)} messages, fetching details...")

        # ── Parallel fetch with semaphore ──
        semaphore = asyncio.Semaphore(MAX_CONCURRENT_FETCHES)
        emails = []
        failed = 0

        async def _fetch_one(ref):
            nonlocal failed
            async with semaphore:
                email = await self._fetch_message(ref["id"])
                if email:
                    emails.append(email)
                else:
                    failed += 1

        # Process in batches of 100 to show progress
        for i in range(0, len(all_message_refs), 100):
            batch = all_message_refs[i:i + 100]
            await asyncio.gather(*[_fetch_one(ref) for ref in batch])
            if len(all_message_refs) > 100:
                print(f"[Gmail] Progress: {min(i + 100, len(all_message_refs))}/{len(all_message_refs)} fetched ({len(emails)} ok, {failed} failed)")

        # Sort by timestamp, newest first
        emails.sort(key=lambda e: e.timestamp, reverse=True)
        print(f"[Gmail] ✅ Retrieved {len(emails)} emails (query covered {hours_back}h back)")
        return emails

    async def get_emails_from_sender(
        self,
        sender_email: str,
        max_results: int = 10,
    ) -> list[EmailMessage]:
        """Fetch recent emails from a specific sender."""
        query = f"from:{sender_email}"

        def _fetch():
            service = self._build_service()
            result = service.users().messages().list(
                userId="me", q=query, maxResults=max_results
            ).execute()
            return result.get("messages", [])

        message_refs = await self._retry_call(_fetch, f"emails from {sender_email}")
        if not message_refs:
            return []

        semaphore = asyncio.Semaphore(MAX_CONCURRENT_FETCHES)
        emails = []

        async def _fetch_one(ref):
            async with semaphore:
                email = await self._fetch_message(ref["id"])
                if email:
                    emails.append(email)

        await asyncio.gather(*[_fetch_one(ref) for ref in message_refs])
        emails.sort(key=lambda e: e.timestamp, reverse=True)
        return emails

    async def search_emails(
        self,
        query: str,
        max_results: int = 15,
    ) -> list[EmailMessage]:
        """
        Search emails using Gmail's powerful query syntax.
        Supports: from:, to:, subject:, has:attachment, is:unread, label:, etc.
        """
        def _fetch():
            service = self._build_service()
            result = service.users().messages().list(
                userId="me", q=query, maxResults=max_results
            ).execute()
            return result.get("messages", [])

        message_refs = await self._retry_call(_fetch, f"search: {query[:50]}")
        if not message_refs:
            return []

        semaphore = asyncio.Semaphore(MAX_CONCURRENT_FETCHES)
        emails = []

        async def _fetch_one(ref):
            async with semaphore:
                email = await self._fetch_message(ref["id"])
                if email:
                    emails.append(email)

        await asyncio.gather(*[_fetch_one(ref) for ref in message_refs])
        emails.sort(key=lambda e: e.timestamp, reverse=True)
        return emails

    async def get_unread_count(self) -> int:
        """Get count of unread emails in inbox (fast — no message fetch)."""
        def _count():
            service = self._build_service()
            result = service.users().messages().list(
                userId="me", q="is:unread in:inbox", maxResults=1
            ).execute()
            return result.get("resultSizeEstimate", 0)

        count = await self._retry_call(_count, "unread count")
        return count or 0

    async def get_thread(self, thread_id: str) -> list[EmailMessage]:
        """Fetch all messages in a thread."""
        def _fetch():
            service = self._build_service()
            thread = service.users().threads().get(
                userId="me", id=thread_id, format="full"
            ).execute()
            return thread.get("messages", [])

        try:
            raw_messages = await self._retry_call(_fetch, f"thread {thread_id}")
            if not raw_messages:
                return []
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

        msg_data = await self._retry_call(_get, f"msg:{message_id[:8]}")
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
            await self._retry_call(_send, f"send to {to}")
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
            await self._retry_call(_send, f"reply thread {thread_id[:8]}")
            return True
        except Exception as e:
            print(f"[Gmail] ❌ reply to thread {thread_id} failed: {e}")
            return False

    # ── Intelligence Helpers (for EmailIntelligencePipeline) ─────────────────

    async def get_sent_emails(
        self, hours_back: int = 720, max_results: int = 100
    ) -> list[dict]:
        """
        Fetch founder's sent emails to learn who they communicate with.
        Returns lightweight dicts: {thread_id, to_email, subject, timestamp}
        Used by EmailScoringEngine.learn_from_sent_items()
        """
        after_ts = int((datetime.utcnow() - timedelta(hours=hours_back)).timestamp())
        query = f"in:sent after:{after_ts}"

        def _fetch():
            service = self._build_service()
            result = service.users().messages().list(
                userId="me", q=query, maxResults=max_results
            ).execute()
            return result.get("messages", [])

        message_refs = await self._retry_call(_fetch, "sent items")
        if not message_refs:
            return []

        semaphore = asyncio.Semaphore(MAX_CONCURRENT_FETCHES)
        results = []

        async def _fetch_one(ref):
            async with semaphore:
                def _get():
                    service = self._build_service()
                    return service.users().messages().get(
                        userId="me", id=ref["id"], format="metadata",
                        metadataHeaders=["To", "Subject"]
                    ).execute()
                msg = await self._retry_call(_get, f"sent:{ref['id'][:8]}")
                if msg:
                    headers = {
                        h["name"].lower(): h["value"]
                        for h in msg.get("payload", {}).get("headers", [])
                    }
                    _, to_email = parseaddr(headers.get("to", ""))
                    results.append({
                        "thread_id": msg.get("threadId", ""),
                        "to_email": to_email,
                        "subject": headers.get("subject", ""),
                        "timestamp": int(msg.get("internalDate", "0")) / 1000.0,
                    })

        await asyncio.gather(*[_fetch_one(ref) for ref in message_refs])
        print(f"[Gmail] ✅ Retrieved {len(results)} sent emails for contact learning")
        return results

    async def get_thread_metadata(self, thread_ids: list[str]) -> dict[str, dict]:
        """
        Fetch thread metadata for multiple threads (depth, participants).
        Returns: {thread_id: {depth: int, participants: [email], has_founder: bool}}
        """
        semaphore = asyncio.Semaphore(MAX_CONCURRENT_FETCHES)
        results = {}

        async def _fetch_one(tid):
            async with semaphore:
                def _get():
                    service = self._build_service()
                    thread = service.users().threads().get(
                        userId="me", id=tid, format="metadata",
                        metadataHeaders=["From", "To", "Cc"]
                    ).execute()
                    return thread
                try:
                    thread = await self._retry_call(_get, f"thread_meta:{tid[:8]}")
                    if thread:
                        messages = thread.get("messages", [])
                        participants = set()
                        for msg in messages:
                            for h in msg.get("payload", {}).get("headers", []):
                                if h["name"].lower() in ("from", "to", "cc"):
                                    for addr in h["value"].split(","):
                                        _, email = parseaddr(addr.strip())
                                        if email:
                                            participants.add(email.lower())
                        results[tid] = {
                            "depth": len(messages),
                            "participants": list(participants),
                        }
                except Exception:
                    results[tid] = {"depth": 1, "participants": []}

        await asyncio.gather(*[_fetch_one(tid) for tid in thread_ids])
        return results

    async def get_message_metadata(self, message_ids: list[str]) -> dict[str, dict]:
        """
        Fetch lightweight metadata for messages: CC list, attachment info, importance flag.
        Returns: {message_id: {cc_emails: [], has_attachment: bool, importance: bool}}
        """
        semaphore = asyncio.Semaphore(MAX_CONCURRENT_FETCHES)
        results = {}

        async def _fetch_one(mid):
            async with semaphore:
                def _get():
                    service = self._build_service()
                    return service.users().messages().get(
                        userId="me", id=mid, format="metadata",
                        metadataHeaders=["Cc", "Importance", "X-Priority"]
                    ).execute()
                try:
                    msg = await self._retry_call(_get, f"meta:{mid[:8]}")
                    if msg:
                        headers = {
                            h["name"].lower(): h["value"]
                            for h in msg.get("payload", {}).get("headers", [])
                        }
                        # Extract CC emails
                        cc_raw = headers.get("cc", "")
                        cc_emails = []
                        if cc_raw:
                            for addr in cc_raw.split(","):
                                _, email = parseaddr(addr.strip())
                                if email:
                                    cc_emails.append(email.lower())

                        # Check attachments (any part with a filename)
                        has_attachment = self._check_attachments(msg.get("payload", {}))

                        # Check importance flag
                        importance = headers.get("importance", "").lower()
                        x_priority = headers.get("x-priority", "")
                        is_important = importance == "high" or x_priority in ("1", "2")

                        results[mid] = {
                            "cc_emails": cc_emails,
                            "has_attachment": has_attachment,
                            "importance": is_important,
                        }
                except Exception:
                    results[mid] = {"cc_emails": [], "has_attachment": False, "importance": False}

        await asyncio.gather(*[_fetch_one(mid) for mid in message_ids])
        return results

    def _check_attachments(self, payload: dict) -> bool:
        """Recursively check if a message has attachments."""
        if payload.get("filename"):
            return True
        for part in payload.get("parts", []):
            if part.get("filename"):
                return True
            if self._check_attachments(part):
                return True
        return False

    # ── Parsing ───────────────────────────────────────────────────────────────

    def _parse_message_data(self, msg_data: dict) -> Optional[EmailMessage]:
        """Parse a raw Gmail API message into an EmailMessage."""
        try:
            headers = {
                h["name"].lower(): h["value"]
                for h in msg_data.get("payload", {}).get("headers", [])
            }

            sender_raw   = headers.get("from", "")
            _, sender_email = parseaddr(sender_raw)
            # Clean up sender name
            sender_name = sender_raw.split("<")[0].strip().strip('"').strip("'")
            subject      = headers.get("subject", "(no subject)")
            date_str     = headers.get("date", "")
            labels       = msg_data.get("labelIds", [])

            body = self._extract_body(msg_data.get("payload", {}))

            # Use snippet as fallback if body extraction fails
            if not body.strip():
                body = msg_data.get("snippet", "")

            # Parse timestamp from internalDate (milliseconds)
            internal_date = msg_data.get("internalDate", "0")
            timestamp = int(internal_date) / 1000.0

            return EmailMessage(
                message_id   = msg_data["id"],
                thread_id    = msg_data.get("threadId", ""),
                sender       = sender_name if sender_name else sender_email,
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

    async def get_profile(self) -> dict:
        """Get Gmail profile including current historyId."""
        def _fetch():
            service = self._build_service()
            return service.users().getProfile(userId="me").execute()
        result = await self._retry_call(_fetch, "profile")
        return result or {}

    async def get_new_emails_since(self, history_id: str) -> tuple[list[EmailMessage], str]:
        """
        Use Gmail History API to fetch only NEW emails since a historyId.
        Returns (new_emails, new_history_id).
        Much faster than re-querying — perfect for real-time sync.
        """
        all_message_ids = set()
        page_token = None
        new_history_id = history_id

        while True:
            def _fetch(pt=page_token, hid=history_id):
                service = self._build_service()
                kwargs = {"userId": "me", "startHistoryId": hid, "historyTypes": ["messageAdded"]}
                if pt:
                    kwargs["pageToken"] = pt
                return service.users().history().list(**kwargs).execute()

            result = await self._retry_call(_fetch, f"history since {history_id}")
            if not result:
                break

            new_history_id = str(result.get("historyId", history_id))

            for history_record in result.get("history", []):
                for msg_added in history_record.get("messagesAdded", []):
                    msg = msg_added.get("message", {})
                    if msg.get("id"):
                        labels = msg.get("labelIds", [])
                        # Only inbox messages
                        if "INBOX" in labels:
                            all_message_ids.add(msg["id"])

            page_token = result.get("nextPageToken")
            if not page_token:
                break

        if not all_message_ids:
            return [], new_history_id

        # Fetch full message details
        semaphore = asyncio.Semaphore(MAX_CONCURRENT_FETCHES)
        emails = []

        async def _fetch_one(mid):
            async with semaphore:
                email = await self._fetch_message(mid)
                if email:
                    emails.append(email)

        await asyncio.gather(*[_fetch_one(mid) for mid in all_message_ids])
        emails.sort(key=lambda e: e.timestamp, reverse=True)
        print(f"[Gmail] ✅ History sync: {len(emails)} new emails since historyId {history_id}")
        return emails, new_history_id

    def _extract_body(self, payload: dict) -> str:
        """
        Recursively extract plain-text body from a Gmail message payload.
        Handles nested multipart, quoted-printable, base64.
        """
        mime_type = payload.get("mimeType", "")

        # Direct text/plain part
        if mime_type == "text/plain":
            data = payload.get("body", {}).get("data", "")
            if data:
                try:
                    return base64.urlsafe_b64decode(data).decode("utf-8", errors="replace")
                except Exception:
                    return ""

        # Multipart: recurse into parts
        if "parts" in payload:
            # Prefer text/plain over text/html
            for part in payload["parts"]:
                if part.get("mimeType") == "text/plain":
                    text = self._extract_body(part)
                    if text:
                        return text
            # Recurse into nested multipart
            for part in payload["parts"]:
                if part.get("mimeType", "").startswith("multipart/"):
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
                try:
                    html = base64.urlsafe_b64decode(data).decode("utf-8", errors="replace")
                    # Clean HTML: remove scripts, styles, then strip tags
                    html = re.sub(r"<(script|style)[^>]*>.*?</\1>", "", html, flags=re.DOTALL)
                    html = re.sub(r"<br\s*/?>", "\n", html, flags=re.IGNORECASE)
                    html = re.sub(r"<[^>]+>", " ", html)
                    html = re.sub(r"\s+", " ", html).strip()
                    return html
                except Exception:
                    return ""

        return ""
