"""
Astra OS — Google Calendar Integration
========================================
Async wrapper around the Google Calendar API v3.

Auth: shares the same OAuth 2.0 credentials as Gmail (stored in token.json).
      If the token already includes calendar scope it will work immediately.
      Otherwise re-authenticate to add the scope.

Scopes used:
  calendar.readonly  — read events, attendees, descriptions

Usage:
    client = CalendarClient("credentials.json", "gmail_token.json")
    events = await client.get_upcoming_events(days_ahead=7)
    context = await client.get_meeting_context(event_id="abc123")
"""

import asyncio
from datetime import datetime, timedelta, timezone
from typing import Optional

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build


SCOPES = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/calendar.readonly",
]

MAX_RESULTS = 20


class CalendarEvent:
    """Parsed representation of a Google Calendar event."""

    __slots__ = (
        "event_id", "title", "start_dt", "end_dt",
        "attendees", "description", "location",
        "is_organizer", "conference_link",
    )

    def __init__(
        self,
        event_id: str,
        title: str,
        start_dt: datetime,
        end_dt: datetime,
        attendees: list[str],
        description: str = "",
        location: str = "",
        is_organizer: bool = False,
        conference_link: str = "",
    ):
        self.event_id       = event_id
        self.title          = title
        self.start_dt       = start_dt
        self.end_dt         = end_dt
        self.attendees      = attendees           # list of email addresses
        self.description    = description
        self.location       = location
        self.is_organizer   = is_organizer
        self.conference_link = conference_link

    @property
    def duration_minutes(self) -> int:
        return int((self.end_dt - self.start_dt).total_seconds() / 60)

    @property
    def starts_in_minutes(self) -> int:
        """Minutes until the event starts (negative if already started)."""
        now = datetime.now(tz=timezone.utc)
        start = self.start_dt.replace(tzinfo=timezone.utc) if self.start_dt.tzinfo is None else self.start_dt
        return int((start - now).total_seconds() / 60)

    def to_dict(self) -> dict:
        return {
            "event_id":        self.event_id,
            "title":           self.title,
            "start":           self.start_dt.isoformat(),
            "end":             self.end_dt.isoformat(),
            "attendees":       self.attendees,
            "description":     self.description[:500],
            "location":        self.location,
            "is_organizer":    self.is_organizer,
            "conference_link": self.conference_link,
            "duration_min":    self.duration_minutes,
        }

    def __repr__(self) -> str:
        return f"<CalendarEvent '{self.title}' @ {self.start_dt.isoformat()} ({len(self.attendees)} attendees)>"


class CalendarClient:
    """
    Async Google Calendar API client.

    All network I/O runs in a thread pool so it never blocks
    the FastAPI / asyncio event loop.
    """

    def __init__(self, credentials_path: str, token_path: str):
        self._credentials_path = credentials_path
        self._token_path       = token_path
        self._service          = None

    # ── Auth ──────────────────────────────────────────────────────────────────

    def _get_credentials(self) -> Credentials:
        """Load or refresh OAuth credentials. Opens browser on first run."""
        import os
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

        return creds

    def _build_service(self):
        if self._service is None:
            creds = self._get_credentials()
            self._service = build(
                "calendar", "v3", credentials=creds, cache_discovery=False
            )
        return self._service

    # ── Read ──────────────────────────────────────────────────────────────────

    async def get_upcoming_events(
        self,
        days_ahead: int = 7,
        max_results: int = MAX_RESULTS,
    ) -> list[CalendarEvent]:
        """
        Fetch events from now until days_ahead days from now.
        Returns events sorted by start time, ascending.
        """
        now      = datetime.utcnow().replace(tzinfo=timezone.utc)
        time_min = now.isoformat()
        time_max = (now + timedelta(days=days_ahead)).isoformat()

        def _fetch():
            service = self._build_service()
            result = service.events().list(
                calendarId="primary",
                timeMin=time_min,
                timeMax=time_max,
                maxResults=max_results,
                singleEvents=True,
                orderBy="startTime",
            ).execute()
            return result.get("items", [])

        try:
            raw_events = await asyncio.to_thread(_fetch)
        except Exception as e:
            print(f"[Calendar] ❌ list events failed: {e}")
            return []

        events = []
        for item in raw_events:
            event = self._parse_event(item)
            if event:
                events.append(event)

        return events

    async def get_todays_events(self) -> list[CalendarEvent]:
        """Convenience method: fetch all events for today."""
        return await self.get_upcoming_events(days_ahead=1)

    async def get_event(self, event_id: str) -> Optional[CalendarEvent]:
        """Fetch a single event by ID."""
        def _fetch():
            service = self._build_service()
            return service.events().get(
                calendarId="primary", eventId=event_id
            ).execute()

        try:
            item = await asyncio.to_thread(_fetch)
            return self._parse_event(item)
        except Exception as e:
            print(f"[Calendar] ❌ get event {event_id} failed: {e}")
            return None

    async def get_meeting_context(self, event_id: str) -> Optional[dict]:
        """
        Return enriched context about a meeting — useful for the brain
        to understand who will be on the call and what's expected.
        """
        event = await self.get_event(event_id)
        if not event:
            return None

        return {
            "title":        event.title,
            "attendees":    event.attendees,
            "description":  event.description,
            "duration_min": event.duration_minutes,
            "location":     event.location,
            "video_link":   event.conference_link,
            "starts_in":    f"{event.starts_in_minutes} minutes",
        }

    async def get_events_with_contact(
        self, contact_email: str, days_back: int = 30, days_ahead: int = 7
    ) -> list[CalendarEvent]:
        """
        Find past and upcoming meetings involving a specific contact.
        Useful for relationship context.
        """
        now = datetime.utcnow().replace(tzinfo=timezone.utc)
        time_min = (now - timedelta(days=days_back)).isoformat()
        time_max = (now + timedelta(days=days_ahead)).isoformat()

        def _fetch():
            service = self._build_service()
            result = service.events().list(
                calendarId="primary",
                timeMin=time_min,
                timeMax=time_max,
                maxResults=50,
                singleEvents=True,
                orderBy="startTime",
                q=contact_email,   # Google's search parameter
            ).execute()
            return result.get("items", [])

        try:
            raw_events = await asyncio.to_thread(_fetch)
        except Exception as e:
            print(f"[Calendar] ❌ events-with-contact search failed: {e}")
            return []

        events = []
        for item in raw_events:
            event = self._parse_event(item)
            if event and contact_email.lower() in [a.lower() for a in event.attendees]:
                events.append(event)

        return events

    # ── Parsing ───────────────────────────────────────────────────────────────

    def _parse_event(self, item: dict) -> Optional[CalendarEvent]:
        """Parse a raw Calendar API event dict into a CalendarEvent."""
        try:
            title    = item.get("summary", "(no title)")
            event_id = item["id"]

            # Parse start/end — can be dateTime or date (all-day)
            start_dt = self._parse_datetime(item.get("start", {}))
            end_dt   = self._parse_datetime(item.get("end", {}))
            if not start_dt or not end_dt:
                return None

            # Attendees — extract emails, exclude calendar owner
            attendees = []
            creator_email = item.get("creator", {}).get("email", "")
            organizer_email = item.get("organizer", {}).get("email", "")

            for att in item.get("attendees", []):
                email = att.get("email", "")
                if email and not att.get("self", False):
                    attendees.append(email)

            # Conference / video link (Google Meet, Zoom, etc.)
            conference_link = ""
            entry_points = (
                item.get("conferenceData", {})
                    .get("entryPoints", [])
            )
            for ep in entry_points:
                if ep.get("entryPointType") == "video":
                    conference_link = ep.get("uri", "")
                    break

            return CalendarEvent(
                event_id        = event_id,
                title           = title,
                start_dt        = start_dt,
                end_dt          = end_dt,
                attendees       = attendees,
                description     = item.get("description", ""),
                location        = item.get("location", ""),
                is_organizer    = (organizer_email == creator_email),
                conference_link = conference_link,
            )

        except Exception as e:
            print(f"[Calendar] ⚠️  parse event failed: {e}")
            return None

    def _parse_datetime(self, dt_obj: dict) -> Optional[datetime]:
        """Handle both dateTime and date (all-day) event formats."""
        if "dateTime" in dt_obj:
            raw = dt_obj["dateTime"]
            # Handle timezone offset like +05:30
            try:
                return datetime.fromisoformat(raw)
            except ValueError:
                return None
        elif "date" in dt_obj:
            # All-day event — treat as midnight UTC
            try:
                return datetime.fromisoformat(dt_obj["date"]).replace(
                    tzinfo=timezone.utc
                )
            except ValueError:
                return None
        return None
