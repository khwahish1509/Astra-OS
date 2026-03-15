"""
Astra OS — Google Calendar Integration (Enhanced)
===================================================
Full read/write Calendar API + automatic Google Meet link creation.

Capabilities:
  - List upcoming events
  - Get today's schedule
  - Find events with specific contacts
  - CREATE events with automatic Google Meet links
  - Quick schedule: "schedule a call with X tomorrow at 3pm"

Scopes used:
  calendar (full) — read + create + modify events
"""

import asyncio
from datetime import datetime, timedelta, timezone
from typing import Optional

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
import os
import uuid


# Full combined scopes
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

MAX_RESULTS = 20


class CalendarEvent:
    """Parsed representation of a Google Calendar event."""

    __slots__ = (
        "event_id", "title", "start_dt", "end_dt",
        "attendees", "description", "location",
        "is_organizer", "conference_link",
    )

    def __init__(self, event_id, title, start_dt, end_dt, attendees,
                 description="", location="", is_organizer=False, conference_link=""):
        self.event_id        = event_id
        self.title           = title
        self.start_dt        = start_dt
        self.end_dt          = end_dt
        self.attendees       = attendees
        self.description     = description
        self.location        = location
        self.is_organizer    = is_organizer
        self.conference_link = conference_link

    @property
    def duration_minutes(self) -> int:
        return int((self.end_dt - self.start_dt).total_seconds() / 60)

    @property
    def starts_in_minutes(self) -> int:
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


class CalendarClient:
    """Async Google Calendar API client with read/write + Meet creation."""

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
        """Fresh service per call to avoid connection pool issues."""
        creds = self._get_credentials()
        return build("calendar", "v3", credentials=creds, cache_discovery=False)

    # ── Read ──────────────────────────────────────────────────────────────────

    async def get_upcoming_events(self, days_ahead: int = 7, max_results: int = MAX_RESULTS) -> list[CalendarEvent]:
        now = datetime.utcnow().replace(tzinfo=timezone.utc)
        time_min = now.isoformat()
        time_max = (now + timedelta(days=days_ahead)).isoformat()

        def _fetch():
            service = self._build_service()
            result = service.events().list(
                calendarId="primary", timeMin=time_min, timeMax=time_max,
                maxResults=max_results, singleEvents=True, orderBy="startTime",
            ).execute()
            return result.get("items", [])

        try:
            raw_events = await asyncio.to_thread(_fetch)
        except Exception as e:
            print(f"[Calendar] ❌ list events failed: {e}")
            return []

        return [ev for item in raw_events if (ev := self._parse_event(item))]

    async def get_todays_events(self) -> list[CalendarEvent]:
        return await self.get_upcoming_events(days_ahead=1)

    async def get_event(self, event_id: str) -> Optional[CalendarEvent]:
        def _fetch():
            service = self._build_service()
            return service.events().get(calendarId="primary", eventId=event_id).execute()
        try:
            item = await asyncio.to_thread(_fetch)
            return self._parse_event(item)
        except Exception as e:
            print(f"[Calendar] ❌ get event {event_id} failed: {e}")
            return None

    async def get_meeting_context(self, event_id: str) -> Optional[dict]:
        event = await self.get_event(event_id)
        if not event:
            return None
        return {
            "title": event.title, "attendees": event.attendees,
            "description": event.description, "duration_min": event.duration_minutes,
            "location": event.location, "video_link": event.conference_link,
            "starts_in": f"{event.starts_in_minutes} minutes",
        }

    async def get_events_with_contact(self, contact_email: str, days_back: int = 30, days_ahead: int = 7) -> list[CalendarEvent]:
        now = datetime.utcnow().replace(tzinfo=timezone.utc)
        time_min = (now - timedelta(days=days_back)).isoformat()
        time_max = (now + timedelta(days=days_ahead)).isoformat()

        def _fetch():
            service = self._build_service()
            result = service.events().list(
                calendarId="primary", timeMin=time_min, timeMax=time_max,
                maxResults=50, singleEvents=True, orderBy="startTime",
                q=contact_email,
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

    # ── Write — Create Events with Google Meet ────────────────────────────────

    async def create_event(
        self,
        title: str,
        start_time: str,
        duration_minutes: int = 30,
        attendees: list[str] = None,
        description: str = "",
        add_meet: bool = True,
    ) -> Optional[dict]:
        """
        Create a calendar event.

        Args:
            title: Event title
            start_time: ISO 8601 datetime string (e.g. "2025-03-16T15:00:00+05:30")
            duration_minutes: Duration in minutes (default 30)
            attendees: List of email addresses to invite
            description: Optional event description
            add_meet: If True, auto-create a Google Meet link

        Returns:
            Dict with event_id, link, meet_link, or None on failure
        """
        start_dt = datetime.fromisoformat(start_time)
        end_dt = start_dt + timedelta(minutes=duration_minutes)

        event_body = {
            "summary": title,
            "description": description,
            "start": {"dateTime": start_dt.isoformat(), "timeZone": "UTC"},
            "end": {"dateTime": end_dt.isoformat(), "timeZone": "UTC"},
        }

        if attendees:
            event_body["attendees"] = [{"email": e} for e in attendees]

        if add_meet:
            event_body["conferenceData"] = {
                "createRequest": {
                    "requestId": str(uuid.uuid4()),
                    "conferenceSolutionKey": {"type": "hangoutsMeet"},
                }
            }

        def _create():
            service = self._build_service()
            return service.events().insert(
                calendarId="primary",
                body=event_body,
                conferenceDataVersion=1 if add_meet else 0,
                sendUpdates="all",
            ).execute()

        try:
            result = await asyncio.to_thread(_create)
            meet_link = ""
            for ep in result.get("conferenceData", {}).get("entryPoints", []):
                if ep.get("entryPointType") == "video":
                    meet_link = ep.get("uri", "")
                    break

            print(f"[Calendar] ✅ Event created: {title} ({meet_link or 'no meet'})")
            return {
                "event_id": result["id"],
                "link": result.get("htmlLink", ""),
                "meet_link": meet_link,
                "title": title,
                "start": start_dt.isoformat(),
                "attendees": attendees or [],
            }
        except Exception as e:
            print(f"[Calendar] ❌ create event failed: {e}")
            return None

    async def quick_add(self, text: str) -> Optional[dict]:
        """
        Create an event using natural language.
        Google parses: "Lunch with Sarah tomorrow at noon"
        """
        def _create():
            service = self._build_service()
            return service.events().quickAdd(
                calendarId="primary", text=text
            ).execute()

        try:
            result = await asyncio.to_thread(_create)
            return {
                "event_id": result["id"],
                "link": result.get("htmlLink", ""),
                "title": result.get("summary", text),
            }
        except Exception as e:
            print(f"[Calendar] ❌ quick add failed: {e}")
            return None

    # ── Parsing ───────────────────────────────────────────────────────────────

    def _parse_event(self, item: dict) -> Optional[CalendarEvent]:
        try:
            title    = item.get("summary", "(no title)")
            event_id = item["id"]
            start_dt = self._parse_datetime(item.get("start", {}))
            end_dt   = self._parse_datetime(item.get("end", {}))
            if not start_dt or not end_dt:
                return None

            attendees = []
            for att in item.get("attendees", []):
                email = att.get("email", "")
                if email and not att.get("self", False):
                    attendees.append(email)

            conference_link = ""
            for ep in item.get("conferenceData", {}).get("entryPoints", []):
                if ep.get("entryPointType") == "video":
                    conference_link = ep.get("uri", "")
                    break

            organizer_email = item.get("organizer", {}).get("email", "")
            creator_email = item.get("creator", {}).get("email", "")

            return CalendarEvent(
                event_id=event_id, title=title, start_dt=start_dt, end_dt=end_dt,
                attendees=attendees, description=item.get("description", ""),
                location=item.get("location", ""),
                is_organizer=(organizer_email == creator_email),
                conference_link=conference_link,
            )
        except Exception as e:
            print(f"[Calendar] ⚠️  parse event failed: {e}")
            return None

    def _parse_datetime(self, dt_obj: dict) -> Optional[datetime]:
        if "dateTime" in dt_obj:
            try:
                return datetime.fromisoformat(dt_obj["dateTime"])
            except ValueError:
                return None
        elif "date" in dt_obj:
            try:
                return datetime.fromisoformat(dt_obj["date"]).replace(tzinfo=timezone.utc)
            except ValueError:
                return None
        return None
