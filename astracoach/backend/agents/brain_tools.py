"""
Astra OS — Agent Tool Definitions
===================================
Every capability exposed to the ADK agents lives here as a plain async
function.  ADK wraps them automatically via FunctionTool.

Tool groups:
  Memory / Insights   — search, retrieve, update insights from the Brain
  Relationships       — get health scores, at-risk contacts
  Brain Tasks         — list open tasks, mark done (internal brain tasks)
  Alerts              — get pending alerts, dismiss
  Gmail               — read, search, send, reply (parallel fetching)
  Calendar            — upcoming events, create events with Google Meet
  Google Drive        — search, list, create docs
  Google Tasks        — list, create, complete tasks (personal to-dos)
  Google Contacts     — search, lookup contacts by email
  Company Context     — founder profile, team roster
"""

from __future__ import annotations

import asyncio
import os
import time as _time
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from brain.store import CompanyBrainStore
    from brain.embeddings import EmbeddingPipeline
    from integrations.gmail_client import GmailClient
    from integrations.calendar_client import CalendarClient
    from integrations.drive_client import DriveClient
    from integrations.tasks_client import TasksClient
    from integrations.contacts_client import ContactsClient

from brain.models import InsightStatus, InsightType, TaskStatus


# ─────────────────────────────────────────────────────────────────────────────
# TTL Cache — reduces Firestore/API round-trips for frequently called tools
# ─────────────────────────────────────────────────────────────────────────────

class _TTLCache:
    """Simple async-aware TTL cache. Thread-safe for single event loop."""

    def __init__(self, default_ttl: float = 30.0):
        self._store: dict[str, tuple[float, Any]] = {}
        self._default_ttl = default_ttl

    def get(self, key: str) -> Any | None:
        entry = self._store.get(key)
        if entry and _time.monotonic() < entry[0]:
            return entry[1]
        self._store.pop(key, None)
        return None

    def put(self, key: str, value: Any, ttl: float | None = None):
        self._store[key] = (_time.monotonic() + (ttl or self._default_ttl), value)

    def invalidate(self, prefix: str = ""):
        if not prefix:
            self._store.clear()
        else:
            keys = [k for k in self._store if k.startswith(prefix)]
            for k in keys:
                del self._store[k]


# ─────────────────────────────────────────────────────────────────────────────
# Dependency injection container
# ─────────────────────────────────────────────────────────────────────────────

class ToolDeps:
    """
    Holds all live service clients.
    Created once at startup, injected into every tool via closure.
    """
    def __init__(
        self,
        store:      "CompanyBrainStore",
        embeddings: "EmbeddingPipeline",
        gmail:      "GmailClient",
        calendar:   "CalendarClient",
        founder_id: str,
        drive:          "DriveClient"    = None,
        tasks:          "TasksClient"    = None,
        contacts:       "ContactsClient" = None,
        memory_service = None,  # ADK BaseMemoryService for long-term recall
        app_name:  str = "AstraAgent",
    ):
        self.store      = store
        self.embeddings = embeddings
        self.gmail      = gmail
        self.calendar   = calendar
        self.founder_id = founder_id
        self.drive      = drive
        self.tasks      = tasks
        self.contacts   = contacts
        self.memory_service = memory_service
        self.app_name   = app_name
        self.cache      = _TTLCache(default_ttl=45.0)  # 45s cache for read-heavy tools


# ─────────────────────────────────────────────────────────────────────────────
# Tool factory — returns a dict of {name: async_fn} ready for FunctionTool
# ─────────────────────────────────────────────────────────────────────────────

def build_tools(deps: ToolDeps) -> dict:
    """
    Build all tool functions bound to the provided service dependencies.
    Returns a dict mapping tool name → coroutine function.
    """

    # ── Memory / Insights ─────────────────────────────────────────────────

    async def search_memory(query: str, limit: int = 8) -> list[dict]:
        """
        Semantically search the Company Brain for insights related to a query.

        Args:
            query: Natural language search string (e.g. 'overdue commitments to investors')
            limit: Max number of results to return (default 8)

        Returns:
            List of insight dicts with id, type, content, parties, due_date, status
        """
        vec = await deps.embeddings.embed_query(query)
        insights = await deps.store.search_insights_semantic(vec, deps.founder_id, limit=limit)
        return [
            {
                "id":       i.id,
                "type":     i.type.value,
                "content":  i.content,
                "parties":  i.parties,
                "due_date": i.due_date,
                "status":   i.status.value,
                "source":   i.source.value,
            }
            for i in insights
        ]

    async def get_active_commitments(limit: int = 20) -> list[dict]:
        """
        List all active commitments the founder has made.

        Args:
            limit: Max number to return

        Returns:
            List of commitment insight dicts
        """
        insights = await deps.store.get_active_insights(
            deps.founder_id, insight_type=InsightType.COMMITMENT, limit=limit
        )
        return [
            {
                "id":       i.id,
                "content":  i.content,
                "parties":  i.parties,
                "due_date": i.due_date,
                "source":   i.source.value,
            }
            for i in insights
        ]

    async def get_overdue_commitments() -> list[dict]:
        """
        Return all active commitments whose due date has already passed.
        These are the highest-priority items for the founder to address.

        Returns:
            List of overdue commitment dicts
        """
        insights = await deps.store.get_overdue_commitments(deps.founder_id)
        return [
            {
                "id":       i.id,
                "content":  i.content,
                "parties":  i.parties,
                "due_date": i.due_date,
            }
            for i in insights
        ]

    async def get_active_risks(limit: int = 15) -> list[dict]:
        """
        Return all active risk signals detected by the brain.

        Returns:
            List of risk insight dicts with content and affected parties
        """
        insights = await deps.store.get_active_insights(
            deps.founder_id, insight_type=InsightType.RISK, limit=limit
        )
        return [
            {
                "id":       i.id,
                "content":  i.content,
                "parties":  i.parties,
                "created_at": i.created_at,
            }
            for i in insights
        ]

    async def resolve_insight(insight_id: str) -> dict:
        """
        Mark an insight as resolved (commitment met, risk addressed, etc.).

        Args:
            insight_id: The ID of the insight to resolve

        Returns:
            {"ok": true} on success
        """
        await deps.store.update_insight_status(insight_id, InsightStatus.RESOLVED)
        deps.cache.invalidate("brain_summary")
        return {"ok": True}

    async def dismiss_insight(insight_id: str) -> dict:
        """
        Dismiss an insight as not relevant (false positive, etc.).

        Args:
            insight_id: The ID of the insight to dismiss

        Returns:
            {"ok": true} on success
        """
        await deps.store.update_insight_status(insight_id, InsightStatus.DISMISSED)
        deps.cache.invalidate("brain_summary")
        return {"ok": True}

    # ── Relationships ─────────────────────────────────────────────────────

    async def get_relationship_health(contact_email: str) -> dict:
        """
        Get the relationship health score and signals for a specific contact.

        Args:
            contact_email: Email address of the contact

        Returns:
            Dict with health_score (0-1), tone_trend, open_commitments, recent_signals
            or {"not_found": true} if no data exists yet
        """
        profile = await deps.store.get_relationship(deps.founder_id, contact_email)
        if not profile:
            return {"not_found": True, "contact_email": contact_email}
        return {
            "contact_email":      profile.contact_email,
            "name":               profile.name,
            "health_score":       profile.health_score,
            "tone_trend":         profile.tone_trend.value,
            "last_contact_at":    profile.last_contact_at,
            "avg_response_hours": profile.avg_response_hours,
            "open_commitments":   profile.open_commitments,
            "recent_signals":     profile.recent_signals[-5:],
        }

    async def get_at_risk_relationships(threshold: float = 0.4) -> list[dict]:
        """
        Return all relationships with health score below the threshold.
        A score below 0.4 is considered at risk.

        Args:
            threshold: Health score cutoff (default 0.4)

        Returns:
            List of at-risk relationship profiles sorted by health score ascending
        """
        profiles = await deps.store.get_at_risk_relationships(deps.founder_id, threshold)
        return [
            {
                "contact_email":    p.contact_email,
                "name":             p.name,
                "health_score":     p.health_score,
                "tone_trend":       p.tone_trend.value,
                "open_commitments": p.open_commitments,
                "recent_signals":   p.recent_signals[-3:],
            }
            for p in profiles
        ]

    async def get_all_relationships() -> list[dict]:
        """
        Return all tracked relationships, sorted by health score (worst first).

        Returns:
            List of relationship profile dicts
        """
        profiles = await deps.store.get_all_relationships(deps.founder_id)
        return [
            {
                "contact_email":  p.contact_email,
                "name":           p.name,
                "health_score":   p.health_score,
                "tone_trend":     p.tone_trend.value,
                "interaction_count": p.interaction_count,
            }
            for p in profiles
        ]

    # ── Tasks ─────────────────────────────────────────────────────────────

    async def get_open_tasks() -> list[dict]:
        """
        Return all open (pending or in-progress) tasks.

        Returns:
            List of task dicts with title, assignee, due_date, status
        """
        tasks = await deps.store.get_open_tasks(deps.founder_id)
        return [
            {
                "id":       t.id,
                "title":    t.title,
                "assignee": t.assignee,
                "due_date": t.due_date,
                "status":   t.status.value,
                "notes":    t.notes,
            }
            for t in tasks
        ]

    async def mark_task_done(task_id: str) -> dict:
        """
        Mark a task as completed.

        Args:
            task_id: The ID of the task to mark done

        Returns:
            {"ok": true}
        """
        await deps.store.update_task_status(task_id, TaskStatus.DONE)
        return {"ok": True}

    async def mark_task_blocked(task_id: str, notes: str = "") -> dict:
        """
        Mark a task as blocked.

        Args:
            task_id: The ID of the task
            notes: Optional explanation of what's blocking it

        Returns:
            {"ok": true}
        """
        await deps.store.update_task_status(task_id, TaskStatus.BLOCKED)
        return {"ok": True}

    # ── Alerts ────────────────────────────────────────────────────────────

    async def get_pending_alerts(min_severity: str = "medium") -> list[dict]:
        """
        Get all pending (unsurfaced) alerts above the given severity.

        Args:
            min_severity: Minimum severity level: "low", "medium", "high", "critical"

        Returns:
            List of alert dicts with title, message, severity
        """
        from brain.models import AlertSeverity
        sev_map = {
            "low": AlertSeverity.LOW,
            "medium": AlertSeverity.MEDIUM,
            "high": AlertSeverity.HIGH,
            "critical": AlertSeverity.CRITICAL,
        }
        sev = sev_map.get(min_severity.lower(), AlertSeverity.MEDIUM)
        alerts = await deps.store.get_pending_alerts(deps.founder_id, min_severity=sev)
        return [
            {
                "id":              a.id,
                "title":           a.title,
                "message":         a.message,
                "severity":        a.severity.value,
                "related_contact": a.related_contact,
            }
            for a in alerts
        ]

    async def dismiss_alert(alert_id: str) -> dict:
        """
        Dismiss an alert (founder said it's not important).

        Args:
            alert_id: ID of the alert to dismiss

        Returns:
            {"ok": true}
        """
        await deps.store.dismiss_alert(alert_id)
        return {"ok": True}

    async def mark_alert_surfaced(alert_id: str) -> dict:
        """
        Mark an alert as having been surfaced to the founder.

        Args:
            alert_id: ID of the alert

        Returns:
            {"ok": true}
        """
        await deps.store.mark_alert_surfaced(alert_id)
        return {"ok": True}

    # ── Gmail ─────────────────────────────────────────────────────────────

    async def get_recent_emails(hours_back: int = 24, max_results: int = 20) -> list[dict]:
        """
        Fetch recent emails from the last N hours (excludes promotions/social).

        Args:
            hours_back: How many hours back to search (default 24)
            max_results: Maximum emails to return (default 20)

        Returns:
            List of email dicts with sender, subject, body preview, timestamp
        """
        emails = await deps.gmail.get_recent_emails(
            hours_back=hours_back, max_results=max_results
        )
        return [
            {
                "message_id":   e.message_id,
                "thread_id":    e.thread_id,
                "sender":       e.sender,
                "sender_email": e.sender_email,
                "subject":      e.subject,
                "body":         e.body[:800],   # truncate for context window
                "timestamp":    e.timestamp,
                "is_unread":    e.is_unread,
            }
            for e in emails
        ]

    async def get_email_thread(thread_id: str) -> list[dict]:
        """
        Fetch all messages in an email thread.

        Args:
            thread_id: Gmail thread ID

        Returns:
            List of email messages in the thread, oldest first
        """
        emails = await deps.gmail.get_thread(thread_id)
        return [
            {
                "message_id":   e.message_id,
                "sender":       e.sender,
                "sender_email": e.sender_email,
                "subject":      e.subject,
                "body":         e.body[:1000],
                "timestamp":    e.timestamp,
            }
            for e in emails
        ]

    async def send_email(to: str, subject: str, body: str) -> dict:
        """
        Send an email on behalf of the founder.

        Args:
            to: Recipient email address
            subject: Email subject line
            body: Plain text email body

        Returns:
            {"ok": true} on success, {"ok": false, "error": "..."} on failure
        """
        success = await deps.gmail.send_email(to, subject, body)
        return {"ok": success}

    async def reply_to_email(
        thread_id: str, to: str, subject: str, body: str
    ) -> dict:
        """
        Send a reply within an existing email thread.

        Args:
            thread_id: Gmail thread ID to reply within
            to: Recipient email address
            subject: Original subject (Re: prefix added automatically)
            body: Plain text reply body

        Returns:
            {"ok": true} on success
        """
        success = await deps.gmail.reply_to_thread(thread_id, to, subject, body)
        return {"ok": success}

    # ── Calendar ──────────────────────────────────────────────────────────

    async def get_upcoming_meetings(days_ahead: int = 3) -> list[dict]:
        """
        Fetch upcoming calendar events for the next N days.

        Args:
            days_ahead: How many days ahead to look (default 3)

        Returns:
            List of event dicts with title, attendees, start time, duration
        """
        cache_key = f"upcoming_meetings:{days_ahead}"
        cached = deps.cache.get(cache_key)
        if cached is not None:
            return cached
        events = await deps.calendar.get_upcoming_events(days_ahead=days_ahead)
        result = [e.to_dict() for e in events]
        deps.cache.put(cache_key, result, ttl=120)
        return result

    async def get_todays_schedule() -> list[dict]:
        """
        Return today's calendar events.

        Returns:
            List of today's events sorted by start time
        """
        cached = deps.cache.get("todays_schedule")
        if cached is not None:
            return cached
        events = await deps.calendar.get_todays_events()
        result = [e.to_dict() for e in events]
        deps.cache.put("todays_schedule", result, ttl=120)  # 2 min cache
        return result

    async def get_meeting_with_contact(contact_email: str) -> list[dict]:
        """
        Find recent and upcoming meetings involving a specific person.

        Args:
            contact_email: Email of the person to look up

        Returns:
            List of calendar events where this person is an attendee
        """
        events = await deps.calendar.get_events_with_contact(contact_email)
        return [e.to_dict() for e in events]

    # ── Gmail — Enhanced ──────────────────────────────────────────────────

    async def search_emails(query: str, max_results: int = 15) -> list[dict]:
        """
        Search emails using Gmail's powerful query syntax.
        Supports: from:person, to:person, subject:keyword, has:attachment,
        is:unread, label:important, newer_than:2d, etc.

        Args:
            query: Gmail search query (e.g. 'from:investor subject:term sheet')
            max_results: Max emails to return

        Returns:
            List of email dicts with sender, subject, body preview
        """
        emails = await deps.gmail.search_emails(query=query, max_results=max_results)
        return [
            {
                "message_id":   e.message_id,
                "thread_id":    e.thread_id,
                "sender":       e.sender,
                "sender_email": e.sender_email,
                "subject":      e.subject,
                "body":         e.body[:800],
                "timestamp":    e.timestamp,
                "is_unread":    e.is_unread,
            }
            for e in emails
        ]

    async def get_emails_from_sender(sender_email: str, max_results: int = 10) -> list[dict]:
        """
        Fetch recent emails from a specific sender.

        Args:
            sender_email: Email address of the sender
            max_results: Max emails to return

        Returns:
            List of email dicts from this sender
        """
        emails = await deps.gmail.get_emails_from_sender(
            sender_email=sender_email, max_results=max_results
        )
        return [
            {
                "message_id":   e.message_id,
                "thread_id":    e.thread_id,
                "sender":       e.sender,
                "subject":      e.subject,
                "body":         e.body[:800],
                "timestamp":    e.timestamp,
                "is_unread":    e.is_unread,
            }
            for e in emails
        ]

    async def get_unread_email_count() -> dict:
        """
        Get the count of unread emails in inbox. Fast — no message fetch.

        Returns:
            {"unread_count": int}
        """
        cached = deps.cache.get("unread_count")
        if cached is not None:
            return cached
        count = await deps.gmail.get_unread_count()
        result = {"unread_count": count}
        deps.cache.put("unread_count", result, ttl=60)
        return result

    # ── Calendar — Create Events with Meet ─────────────────────────────────

    async def create_calendar_event(
        title: str,
        start_time: str,
        duration_minutes: int = 30,
        attendees: str = "",
        description: str = "",
        add_meet: bool = True,
    ) -> dict:
        """
        Create a new calendar event, optionally with a Google Meet link.

        Args:
            title: Event title (e.g. "Investor call with Sequoia")
            start_time: ISO 8601 datetime (e.g. "2025-03-20T15:00:00+05:30")
            duration_minutes: Duration in minutes (default 30)
            attendees: Comma-separated email addresses to invite
            description: Optional event description
            add_meet: Auto-create Google Meet link (default True)

        Returns:
            Dict with event_id, link, meet_link, or error
        """
        attendee_list = [e.strip() for e in attendees.split(",") if e.strip()] if attendees else []
        result = await deps.calendar.create_event(
            title=title,
            start_time=start_time,
            duration_minutes=duration_minutes,
            attendees=attendee_list,
            description=description,
            add_meet=add_meet,
        )
        if result:
            deps.cache.invalidate("todays_schedule")
            deps.cache.invalidate("upcoming_meetings")
            return result
        return {"error": "Failed to create event"}

    async def quick_schedule(text: str) -> dict:
        """
        Create an event using natural language. Google parses the text.
        Examples: "Lunch with Sarah tomorrow at noon", "Team standup Monday 9am"

        Args:
            text: Natural language event description

        Returns:
            Dict with event_id and link, or error
        """
        result = await deps.calendar.quick_add(text=text)
        if result:
            return result
        return {"error": "Failed to quick-schedule event"}

    # ── Google Drive ───────────────────────────────────────────────────────

    async def search_drive(query: str, max_results: int = 10) -> list[dict]:
        """
        Search Google Drive files by name or content.
        Uses full-text search across all accessible files.

        Args:
            query: Search string (e.g. "pitch deck", "Q4 financials")
            max_results: Max files to return

        Returns:
            List of file dicts with name, type, link, modified date
        """
        if not deps.drive:
            return [{"error": "Drive integration not configured"}]
        files = await deps.drive.search_files(query=query, max_results=max_results)
        return [f.to_dict() for f in files]

    async def list_recent_drive_files(max_results: int = 15) -> list[dict]:
        """
        List recently modified files in Google Drive.

        Args:
            max_results: Max files to return

        Returns:
            List of file dicts sorted by last modified
        """
        if not deps.drive:
            return [{"error": "Drive integration not configured"}]
        files = await deps.drive.list_recent_files(max_results=max_results)
        return [f.to_dict() for f in files]

    async def search_drive_by_type(file_type: str, max_results: int = 10) -> list[dict]:
        """
        Search Drive files by type.

        Args:
            file_type: One of: doc, sheet, slides, pdf, folder, image
            max_results: Max files to return

        Returns:
            List of matching file dicts
        """
        if not deps.drive:
            return [{"error": "Drive integration not configured"}]
        files = await deps.drive.search_by_type(file_type=file_type, max_results=max_results)
        return [f.to_dict() for f in files]

    async def get_drive_file_info(file_id: str) -> dict:
        """
        Get detailed metadata for a specific Drive file.

        Args:
            file_id: Google Drive file ID

        Returns:
            File metadata dict with name, type, link, size, owners
        """
        if not deps.drive:
            return {"error": "Drive integration not configured"}
        result = await deps.drive.get_file_info(file_id=file_id)
        return result or {"error": "File not found"}

    async def create_google_doc(title: str) -> dict:
        """
        Create a new blank Google Doc in Drive.

        Args:
            title: Document title

        Returns:
            Dict with file_id, link, name
        """
        if not deps.drive:
            return {"error": "Drive integration not configured"}
        result = await deps.drive.create_doc(title=title)
        return result or {"error": "Failed to create document"}

    # ── Google Tasks ───────────────────────────────────────────────────────

    async def list_google_tasks(show_completed: bool = False) -> list[dict]:
        """
        List tasks from Google Tasks (primary task list).
        These are the founder's personal to-do items managed in Google Tasks.

        Args:
            show_completed: If True, include completed tasks too

        Returns:
            List of task dicts with title, notes, status, due date
        """
        if not deps.tasks:
            return [{"error": "Tasks integration not configured"}]
        tasks = await deps.tasks.get_tasks(show_completed=show_completed)
        return [t.to_dict() for t in tasks]

    async def create_google_task(
        title: str,
        notes: str = "",
        due: str = "",
    ) -> dict:
        """
        Create a new task in Google Tasks.

        Args:
            title: Task title (e.g. "Follow up with investor")
            notes: Optional description or context
            due: Optional due date (RFC 3339 format, e.g. "2025-03-20T00:00:00Z")

        Returns:
            Created task dict or error
        """
        if not deps.tasks:
            return {"error": "Tasks integration not configured"}
        task = await deps.tasks.create_task(title=title, notes=notes, due=due)
        return task.to_dict() if task else {"error": "Failed to create task"}

    async def complete_google_task(task_id: str) -> dict:
        """
        Mark a Google Task as completed.

        Args:
            task_id: The task ID to complete

        Returns:
            {"ok": true} on success
        """
        if not deps.tasks:
            return {"error": "Tasks integration not configured"}
        success = await deps.tasks.complete_task(task_id=task_id)
        return {"ok": success}

    async def get_google_task_lists() -> list[dict]:
        """
        List all task lists (e.g. "My Tasks", "Work", "Personal").

        Returns:
            List of task list dicts with id and title
        """
        if not deps.tasks:
            return [{"error": "Tasks integration not configured"}]
        task_lists = await deps.tasks.get_task_lists()
        return [tl.to_dict() for tl in task_lists]

    # ── Google Contacts ────────────────────────────────────────────────────

    async def search_contacts(query: str, max_results: int = 10) -> list[dict]:
        """
        Search Google Contacts by name, email, or phone number.
        Useful for looking up investor emails, team member info, etc.

        Args:
            query: Search string (e.g. "John Smith", "sequoia", "+1555")
            max_results: Max results to return

        Returns:
            List of contact dicts with name, emails, phones, organization
        """
        if not deps.contacts:
            return [{"error": "Contacts integration not configured"}]
        contacts = await deps.contacts.search_contacts(query=query, max_results=max_results)
        return [c.to_dict() for c in contacts]

    async def get_contact_info(email: str) -> dict:
        """
        Look up a contact by their email address.
        Returns name, organization, phone numbers, and other details.

        Args:
            email: Email address to look up

        Returns:
            Contact dict or not_found
        """
        if not deps.contacts:
            return {"error": "Contacts integration not configured"}
        contact = await deps.contacts.get_contact_by_email(email=email)
        if contact:
            return contact.to_dict()
        return {"not_found": True, "email": email}

    async def list_all_contacts(max_results: int = 50) -> list[dict]:
        """
        List all contacts, sorted by most recently updated.

        Args:
            max_results: Max contacts to return

        Returns:
            List of contact dicts
        """
        if not deps.contacts:
            return [{"error": "Contacts integration not configured"}]
        contacts = await deps.contacts.list_contacts(max_results=max_results)
        return [c.to_dict() for c in contacts]

    # ── Long-Term Memory (ADK Memory Service) ────────────────────────────

    async def recall_memory(query: str) -> list[dict]:
        """
        Search long-term memory for past conversations, facts, and episodes
        related to a query. Use this when the user says things like:
        "what did we discuss last time?", "do you remember...?",
        "what did I say about...?"

        Args:
            query: Natural language search (e.g. "investor meetings", "hiring plans")

        Returns:
            List of memory entries with content and timestamps
        """
        if not deps.memory_service:
            return [{"info": "Long-term memory not configured"}]
        try:
            from google.adk.memory.base_memory_service import SearchMemoryResponse
            response = await deps.memory_service.search_memory(
                app_name=deps.app_name, user_id=deps.founder_id, query=query
            )
            results = []
            for entry in (response.memories or []):
                text = ""
                if entry.content and entry.content.parts:
                    text = " ".join(
                        p.text for p in entry.content.parts if hasattr(p, "text") and p.text
                    )
                results.append({
                    "content": text[:600],
                    "author": getattr(entry, "author", ""),
                    "timestamp": getattr(entry, "timestamp", ""),
                })
            return results if results else [{"info": "No matching memories found"}]
        except Exception as e:
            return [{"error": f"Memory search failed: {e}"}]

    async def save_memory_note(note: str, category: str = "general") -> dict:
        """
        Explicitly save a fact or note to long-term memory.
        Use when the user says "remember this", "note that down",
        or shares important information worth persisting.

        Args:
            note: The fact or note to remember (e.g. "Series A target is $5M")
            category: One of: preference, personal, business, contact, goal, general

        Returns:
            {"ok": true} on success
        """
        if not deps.memory_service:
            return {"error": "Long-term memory not configured"}
        try:
            import time, hashlib
            from datetime import datetime, timezone
            db = deps.memory_service._get_db()
            user_key = f"{deps.app_name}__{deps.founder_id}".replace("/", "_").replace(" ", "_")
            facts_ref = (
                db.collection(deps.memory_service.MEMORIES_COLLECTION)
                .document(user_key)
                .collection(deps.memory_service.FACTS_SUBCOLLECTION)
            )
            fact_hash = hashlib.md5(note.encode()).hexdigest()[:12]
            doc_ref = facts_ref.document(fact_hash)
            await asyncio.to_thread(doc_ref.set, {
                "fact": note,
                "category": category,
                "source_session": "voice_explicit",
                "timestamp": time.time(),
                "ts_human": datetime.now(timezone.utc).isoformat(),
            })
            deps.cache.invalidate("known_facts")  # invalidate facts cache
            return {"ok": True, "saved": note[:100]}
        except Exception as e:
            return {"error": f"Failed to save note: {e}"}

    async def get_past_conversations(topic: str = "", limit: int = 5) -> list[dict]:
        """
        Retrieve recent conversation episode summaries from memory.
        Shows what was discussed in past sessions including decisions,
        action items, and topics.

        Args:
            topic: Optional topic filter (e.g. "fundraising", "hiring")
            limit: Max episodes to return (default 5)

        Returns:
            List of episode dicts with summary, topics, decisions, action_items
        """
        if not deps.memory_service:
            return [{"info": "Long-term memory not configured"}]
        try:
            import re as _re
            db = deps.memory_service._get_db()
            user_key = f"{deps.app_name}__{deps.founder_id}".replace("/", "_").replace(" ", "_")
            episodes_ref = (
                db.collection(deps.memory_service.MEMORIES_COLLECTION)
                .document(user_key)
                .collection(deps.memory_service.EPISODES_SUBCOLLECTION)
            )
            docs = await asyncio.to_thread(
                lambda: list(
                    episodes_ref
                    .order_by("timestamp", direction="DESCENDING")
                    .limit(limit * 3)  # fetch extra for filtering
                    .stream()
                )
            )

            results = []
            topic_words = set(_re.findall(r"[A-Za-z]+", topic.lower())) if topic else set()

            for doc in docs:
                data = doc.to_dict()
                if topic_words:
                    searchable = " ".join([
                        data.get("summary", ""),
                        " ".join(data.get("topics", [])),
                    ]).lower()
                    episode_words = set(_re.findall(r"[A-Za-z]+", searchable))
                    if not (topic_words & episode_words):
                        continue

                results.append({
                    "date": data.get("ts_human", "")[:10],
                    "summary": data.get("summary", ""),
                    "topics": data.get("topics", []),
                    "decisions": data.get("decisions", []),
                    "action_items": data.get("action_items", []),
                    "people_mentioned": data.get("people_mentioned", []),
                    "mood": data.get("mood", ""),
                })
                if len(results) >= limit:
                    break

            return results if results else [{"info": "No past conversations found"}]
        except Exception as e:
            return [{"error": f"Failed to retrieve episodes: {e}"}]

    async def get_known_facts() -> list[dict]:
        """
        Retrieve all known facts and preferences about the founder
        from long-term memory. Useful for understanding what Astra
        already knows about the user.

        Returns:
            List of fact dicts with fact text and category
        """
        if not deps.memory_service:
            return [{"info": "Long-term memory not configured"}]
        cached = deps.cache.get("known_facts")
        if cached is not None:
            return cached
        try:
            db = deps.memory_service._get_db()
            user_key = f"{deps.app_name}__{deps.founder_id}".replace("/", "_").replace(" ", "_")
            facts_ref = (
                db.collection(deps.memory_service.MEMORIES_COLLECTION)
                .document(user_key)
                .collection(deps.memory_service.FACTS_SUBCOLLECTION)
            )
            docs = await asyncio.to_thread(
                lambda: list(facts_ref.order_by("timestamp", direction="DESCENDING").limit(30).stream())
            )
            results = []
            for doc in docs:
                data = doc.to_dict()
                results.append({
                    "fact": data.get("fact", ""),
                    "category": data.get("category", "general"),
                    "when": data.get("ts_human", "")[:10],
                })
            result = results if results else [{"info": "No facts stored yet"}]
            deps.cache.put("known_facts", result, ttl=90)
            return result
        except Exception as e:
            return [{"error": f"Failed to retrieve facts: {e}"}]

    # ── Company Context ───────────────────────────────────────────────────

    async def get_company_context() -> dict:
        """
        Return the founder's company profile and team roster.

        Returns:
            Dict with company_name, context summary, team_members list
        """
        cached = deps.cache.get("company_context")
        if cached is not None:
            return cached
        profile = await deps.store.get_founder(deps.founder_id)
        if not profile:
            return {"error": "Founder profile not found"}
        result = {
            "name":            profile.name,
            "company_name":    profile.company_name,
            "company_context": profile.company_context,
            "team_members":    profile.team_members,
            "timezone":        profile.timezone,
        }
        deps.cache.put("company_context", result, ttl=300)  # 5 min — rarely changes
        return result

    async def get_brain_summary() -> dict:
        """
        Return a high-level summary of the current state of the Company Brain:
        counts of active insights, at-risk relationships, open tasks, and pending alerts.

        Returns:
            Summary dict with counts and top-level signals
        """
        cached = deps.cache.get("brain_summary")
        if cached is not None:
            return cached

        active_insights, at_risk, open_tasks, pending_alerts = await asyncio.gather(
            deps.store.get_active_insights(deps.founder_id, limit=100),
            deps.store.get_at_risk_relationships(deps.founder_id, threshold=0.5),
            deps.store.get_open_tasks(deps.founder_id),
            deps.store.get_pending_alerts(deps.founder_id),
        )

        overdue = await deps.store.get_overdue_commitments(deps.founder_id)

        type_counts: dict[str, int] = {}
        for i in active_insights:
            type_counts[i.type.value] = type_counts.get(i.type.value, 0) + 1

        result = {
            "total_active_insights":   len(active_insights),
            "insight_breakdown":       type_counts,
            "overdue_commitments":     len(overdue),
            "at_risk_relationships":   len(at_risk),
            "open_tasks":              len(open_tasks),
            "pending_alerts":          len(pending_alerts),
        }
        deps.cache.put("brain_summary", result, ttl=60)
        return result

    async def create_task(
        title: str,
        assignee: str = "",
        due_date: str = "",
        description: str = "",
        notes: str = "",
    ) -> dict:
        """
        Create a new task in the Company Brain and optionally assign it to a team member.
        Use when the founder says things like "assign X to Priya" or "create a task for...".

        Args:
            title: Task title (e.g. "Deliver website design assets")
            assignee: Name or email of person responsible (optional)
            due_date: Due date in ISO format e.g. "2026-03-20" (optional)
            description: Detailed description of what needs to be done
            notes: Additional context or notes

        Returns:
            Dict with task id, title, assignee, status
        """
        from brain.models import Task as BrainTask
        task = BrainTask(
            founder_id=deps.founder_id,
            title=title,
            description=description,
            assignee=assignee,
            due_date=due_date or None,
            notes=notes,
        )
        task_id = await deps.store.add_task(task)
        return {
            "ok": True,
            "task_id": task_id,
            "title": title,
            "assignee": assignee or "(unassigned)",
            "due_date": due_date or "(no due date)",
            "status": "pending",
        }

    async def update_task(
        task_id: str,
        status: str = "",
        assignee: str = "",
        notes: str = "",
    ) -> dict:
        """
        Update an existing task's status, assignee, or notes.
        Status options: pending, in_progress, blocked, done

        Args:
            task_id: The ID of the task to update
            status: New status (pending/in_progress/blocked/done)
            assignee: New assignee name or email
            notes: Additional notes to append

        Returns:
            {"ok": true}
        """
        if status:
            status_enum = TaskStatus(status.lower())
            await deps.store.update_task_status(task_id, status_enum)
        return {"ok": True, "task_id": task_id, "updated": True}

    async def get_team_tasks(assignee: str = "") -> list[dict]:
        """
        Get tasks filtered by assignee. If no assignee given, returns all open tasks
        grouped by person. Use when founder asks "what does Raj have?" or "show team tasks".

        Args:
            assignee: Optional name/email to filter by

        Returns:
            List of task dicts with title, assignee, due_date, status
        """
        tasks = await deps.store.get_open_tasks(deps.founder_id)
        if assignee:
            assignee_lower = assignee.lower()
            tasks = [t for t in tasks if assignee_lower in (t.assignee or "").lower()]
        return [
            {
                "id": t.id,
                "title": t.title,
                "assignee": t.assignee or "(unassigned)",
                "due_date": t.due_date or "(no due date)",
                "status": t.status.value,
                "notes": t.notes,
            }
            for t in tasks
        ]

    async def get_sales_pipeline() -> dict:
        """
        Get a CRM-style sales pipeline overview built from relationship data.
        Shows contacts grouped by deal stage based on relationship health and
        interaction patterns. Use when founder asks about deals, pipeline, sales.

        Returns:
            Dict with pipeline stages and contacts in each
        """
        profiles = await deps.store.get_all_relationships(deps.founder_id)
        pipeline = {
            "hot_leads": [],       # health > 0.7, recent contact
            "warm_prospects": [],  # health 0.4-0.7
            "at_risk": [],         # health < 0.4
            "total_contacts": len(profiles),
        }
        import time as _t
        now = _t.time()
        for p in profiles:
            entry = {
                "name": p.name or p.contact_email,
                "email": p.contact_email,
                "health_score": round(p.health_score * 100),
                "tone": p.tone_trend.value,
                "last_contact_days": round((now - p.last_contact_at) / 86400) if p.last_contact_at else None,
                "open_commitments": p.open_commitments,
            }
            if p.health_score >= 0.7:
                pipeline["hot_leads"].append(entry)
            elif p.health_score >= 0.4:
                pipeline["warm_prospects"].append(entry)
            else:
                pipeline["at_risk"].append(entry)
        return pipeline

    async def get_meeting_prep(contact_email: str = "", meeting_title: str = "") -> dict:
        """
        Prepare a comprehensive briefing for an upcoming meeting.
        Combines relationship health, email history, open commitments,
        and past conversations for a specific contact or meeting.
        Use when founder says "prep me for my call with X" or "what should I know before the meeting?".

        Args:
            contact_email: Email of the person they're meeting with
            meeting_title: Title of the meeting (used to find attendees if no email given)

        Returns:
            Dict with relationship summary, recent emails, open commitments, talking points
        """
        prep = {
            "contact": contact_email or meeting_title,
            "relationship": None,
            "recent_emails": [],
            "open_commitments": [],
            "suggested_talking_points": [],
        }

        # Get relationship data
        if contact_email:
            profile = await deps.store.get_relationship(deps.founder_id, contact_email)
            if profile:
                prep["relationship"] = {
                    "name": profile.name,
                    "health_score": round(profile.health_score * 100),
                    "tone_trend": profile.tone_trend.value,
                    "open_commitments": profile.open_commitments,
                    "recent_signals": profile.recent_signals[-3:],
                }

            # Get recent emails from this person
            try:
                emails = await deps.gmail.get_emails_from_sender(
                    sender_email=contact_email, max_results=5
                )
                prep["recent_emails"] = [
                    {"subject": e.subject, "date": e.timestamp, "preview": e.body[:200]}
                    for e in emails
                ]
            except Exception:
                pass

        # Get related commitments
        try:
            commitments = await deps.store.get_active_insights(
                deps.founder_id, insight_type=InsightType.COMMITMENT, limit=20
            )
            if contact_email:
                commitments = [c for c in commitments if contact_email.lower() in " ".join(c.parties).lower()]
            prep["open_commitments"] = [
                {"content": c.content, "due_date": c.due_date, "parties": c.parties}
                for c in commitments[:5]
            ]
        except Exception:
            pass

        # Generate talking points
        points = []
        if prep["relationship"] and prep["relationship"]["health_score"] < 50:
            points.append("Relationship health is below 50% — prioritise rebuilding trust")
        if prep["open_commitments"]:
            overdue = [c for c in prep["open_commitments"] if c.get("due_date")]
            if overdue:
                points.append(f"You have {len(overdue)} open commitments with this person")
        if prep["recent_emails"]:
            points.append(f"Last email exchange: {prep['recent_emails'][0].get('subject', 'N/A')}")
        prep["suggested_talking_points"] = points

        return prep

    async def get_weekly_digest() -> dict:
        """
        Generate a comprehensive weekly digest covering all brain activity.
        Use when founder says "give me the weekly briefing" or "weekly update".

        Returns:
            Dict with email stats, commitment status, relationship health, task progress, alerts
        """
        import time as _t
        now = _t.time()
        week_ago = now - (7 * 86400)

        # Gather all data in parallel
        insights, at_risk, tasks, alerts, overdue = await asyncio.gather(
            deps.store.get_active_insights(deps.founder_id, limit=100),
            deps.store.get_at_risk_relationships(deps.founder_id, threshold=0.5),
            deps.store.get_open_tasks(deps.founder_id),
            deps.store.get_pending_alerts(deps.founder_id),
            deps.store.get_overdue_commitments(deps.founder_id),
        )

        # Count recent insights by type
        recent = [i for i in insights if i.created_at >= week_ago]
        type_counts = {}
        for i in recent:
            type_counts[i.type.value] = type_counts.get(i.type.value, 0) + 1

        # Task stats
        done_tasks = [t for t in tasks if t.status == TaskStatus.DONE]
        blocked_tasks = [t for t in tasks if t.status == TaskStatus.BLOCKED]
        pending_tasks = [t for t in tasks if t.status in (TaskStatus.PENDING, TaskStatus.IN_PROGRESS)]

        return {
            "period": "Last 7 days",
            "insights_this_week": len(recent),
            "insight_breakdown": type_counts,
            "overdue_commitments": len(overdue),
            "at_risk_relationships": [
                {"name": p.name or p.contact_email, "health": round(p.health_score * 100)}
                for p in at_risk[:5]
            ],
            "tasks": {
                "open": len(pending_tasks),
                "blocked": len(blocked_tasks),
                "completed_this_period": len(done_tasks),
            },
            "pending_alerts": len(alerts),
            "top_alerts": [
                {"title": a.title, "severity": a.severity.value}
                for a in alerts[:3]
            ],
        }

    # ── Enhanced Task Tools ────────────────────────────────────────────────

    async def get_all_team_tasks(assignee: str = "") -> dict:
        """Get all tasks. If assignee is specified, filter by that team member's name."""
        all_tasks = await deps.store.get_all_tasks(deps.founder_id)
        if assignee:
            all_tasks = [t for t in all_tasks if assignee.lower() in t.assignee.lower()]
        by_status = {}
        for t in all_tasks:
            s = t.status.value if hasattr(t.status, 'value') else t.status
            by_status.setdefault(s, []).append(t.to_firestore())
        return {
            "total": len(all_tasks),
            "by_status": by_status,
        }

    async def update_task_priority(task_id: str, priority: str) -> dict:
        """Update a task's priority. Priority must be: low, medium, high, or urgent."""
        await deps.store.update_task(task_id, {"priority": priority})
        return {"ok": True, "task_id": task_id, "new_priority": priority}

    async def add_comment_to_task(task_id: str, comment: str) -> dict:
        """Add a comment or update note to a task."""
        await deps.store.add_task_comment(task_id, comment, "Astra")
        return {"ok": True, "task_id": task_id}

    async def reassign_task(task_id: str, new_assignee: str) -> dict:
        """Reassign a task to a different team member."""
        await deps.store.update_task(task_id, {"assignee": new_assignee})
        return {"ok": True, "task_id": task_id, "new_assignee": new_assignee}

    # ── Email Routing Tools ────────────────────────────────────────────────

    async def classify_and_route_email(sender: str, subject: str, snippet: str, sender_email: str = "") -> dict:
        """Classify an incoming email and route it to the appropriate team (Sales, Support, Engineering, etc). Call this when the founder mentions a customer email or asks to route an email."""
        import aiohttp
        backend = os.environ.get("BACKEND_URL", "http://localhost:8000")
        async with aiohttp.ClientSession() as session:
            async with session.post(f"{backend}/brain/emails/classify", json={
                "sender": sender, "subject": subject, "snippet": snippet,
                "sender_email": sender_email or sender,
            }) as resp:
                return await resp.json()

    async def get_routed_emails(team_name: str = "", limit: int = 20) -> dict:
        """Get recently routed emails, optionally filtered by team name."""
        emails = await deps.store.get_routed_emails(deps.founder_id, limit)
        if team_name:
            emails = [e for e in emails if team_name.lower() in e.routed_to_team_name.lower()]
        return {
            "total": len(emails),
            "emails": [e.to_firestore() for e in emails],
        }

    async def create_routing_rule_voice(
        rule_name: str,
        team_name: str,
        category: str = "",
        keywords: str = "",
        sender_domains: str = ""
    ) -> dict:
        """Create an email routing rule by voice. Example: 'Route all demo requests to Sales team'.
        category: sales|support|engineering|partnerships|personal
        keywords: comma-separated keywords to match (e.g. 'demo,pricing,trial')
        sender_domains: comma-separated domains (e.g. 'acme.com,bigco.org')
        """
        teams = await deps.store.get_teams(deps.founder_id)
        matched = next((t for t in teams if team_name.lower() in t.name.lower()), None)
        if not matched:
            return {"error": f"Team '{team_name}' not found. Available: {[t.name for t in teams]}"}

        from brain.models import RoutingRule
        conditions = {}
        if category:
            conditions["category"] = category
        if keywords:
            conditions["keywords"] = [k.strip() for k in keywords.split(",")]
        if sender_domains:
            conditions["sender_domains"] = [d.strip() for d in sender_domains.split(",")]

        rule = RoutingRule(
            founder_id=deps.founder_id, name=rule_name,
            team_id=matched.id, conditions=conditions,
        )
        await deps.store.add_routing_rule(rule)
        return {"ok": True, "rule_id": rule.id, "rule_name": rule_name, "team": matched.name}

    async def get_email_routing_summary() -> dict:
        """Get a summary of email routing activity — how many emails routed to each team, recent activity."""
        emails = await deps.store.get_routed_emails(deps.founder_id, 100)
        by_team = {}
        by_category = {}
        for e in emails:
            tn = e.routed_to_team_name or "Unrouted"
            by_team[tn] = by_team.get(tn, 0) + 1
            by_category[e.category] = by_category.get(e.category, 0) + 1
        return {
            "total_routed": len(emails),
            "by_team": by_team,
            "by_category": by_category,
            "recent": [e.to_firestore() for e in emails[:5]],
        }

    async def create_team_voice(team_name: str, members: str = "", color: str = "#4f7dff") -> dict:
        """Create a new team for email routing and task assignment. members is comma-separated names or emails."""
        from brain.models import Team
        member_list = []
        if members:
            for m in members.split(","):
                m = m.strip()
                member_list.append({"name": m, "email": "", "role": "member"})
        team = Team(founder_id=deps.founder_id, name=team_name, members=member_list, color=color)
        await deps.store.add_team(team)
        return {"ok": True, "team_id": team.id, "team_name": team_name, "members": member_list}

    # ── Return all tools as a name → function mapping ─────────────────────

    return {
        # Memory
        "search_memory":            search_memory,
        "get_active_commitments":   get_active_commitments,
        "get_overdue_commitments":  get_overdue_commitments,
        "get_active_risks":         get_active_risks,
        "resolve_insight":          resolve_insight,
        "dismiss_insight":          dismiss_insight,
        # Relationships
        "get_relationship_health":  get_relationship_health,
        "get_at_risk_relationships": get_at_risk_relationships,
        "get_all_relationships":    get_all_relationships,
        # Brain Tasks (internal team tasks)
        "get_open_tasks":           get_open_tasks,
        "create_task":              create_task,
        "update_task":              update_task,
        "get_team_tasks":           get_team_tasks,
        "mark_task_done":           mark_task_done,
        "mark_task_blocked":        mark_task_blocked,
        # Enhanced Tasks
        "get_all_team_tasks":       get_all_team_tasks,
        "update_task_priority":     update_task_priority,
        "add_comment_to_task":      add_comment_to_task,
        "reassign_task":            reassign_task,
        # Alerts
        "get_pending_alerts":       get_pending_alerts,
        "dismiss_alert":            dismiss_alert,
        "mark_alert_surfaced":      mark_alert_surfaced,
        # Gmail
        "get_recent_emails":        get_recent_emails,
        "get_email_thread":         get_email_thread,
        "send_email":               send_email,
        "reply_to_email":           reply_to_email,
        "search_emails":            search_emails,
        "get_emails_from_sender":   get_emails_from_sender,
        "get_unread_email_count":   get_unread_email_count,
        # Calendar
        "get_upcoming_meetings":    get_upcoming_meetings,
        "get_todays_schedule":      get_todays_schedule,
        "get_meeting_with_contact": get_meeting_with_contact,
        "create_calendar_event":    create_calendar_event,
        "quick_schedule":           quick_schedule,
        # Google Drive
        "search_drive":             search_drive,
        "list_recent_drive_files":  list_recent_drive_files,
        "search_drive_by_type":     search_drive_by_type,
        "get_drive_file_info":      get_drive_file_info,
        "create_google_doc":        create_google_doc,
        # Google Tasks
        "list_google_tasks":        list_google_tasks,
        "create_google_task":       create_google_task,
        "complete_google_task":     complete_google_task,
        "get_google_task_lists":    get_google_task_lists,
        # Google Contacts
        "search_contacts":          search_contacts,
        "get_contact_info":         get_contact_info,
        "list_all_contacts":        list_all_contacts,
        # Long-Term Memory
        "recall_memory":            recall_memory,
        "save_memory_note":         save_memory_note,
        "get_past_conversations":   get_past_conversations,
        "get_known_facts":          get_known_facts,
        # Company
        "get_company_context":      get_company_context,
        "get_brain_summary":        get_brain_summary,
        # CRM / Pipeline
        "get_sales_pipeline":       get_sales_pipeline,
        # Meeting Prep
        "get_meeting_prep":         get_meeting_prep,
        # Weekly Digest
        "get_weekly_digest":        get_weekly_digest,
        # Email Routing
        "classify_and_route_email": classify_and_route_email,
        "get_routed_emails":        get_routed_emails,
        "create_routing_rule_voice": create_routing_rule_voice,
        "get_email_routing_summary": get_email_routing_summary,
        "create_team_voice":        create_team_voice,
    }
