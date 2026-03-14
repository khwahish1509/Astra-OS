"""
Astra OS — Agent Tool Definitions
===================================
Every capability exposed to the ADK agents lives here as a plain async
function.  ADK wraps them automatically via FunctionTool.

Tool groups:
  Memory / Insights   — search, retrieve, update insights from the Brain
  Relationships       — get health scores, at-risk contacts
  Tasks               — list open tasks, mark done
  Alerts              — get pending alerts, dismiss
  Gmail               — read emails, send / reply
  Calendar            — upcoming events, meeting context
  Company Context     — founder profile, team roster
"""

from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from brain.store import CompanyBrainStore
    from brain.embeddings import EmbeddingPipeline
    from integrations.gmail_client import GmailClient
    from integrations.calendar_client import CalendarClient

from brain.models import InsightStatus, InsightType, TaskStatus


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
    ):
        self.store      = store
        self.embeddings = embeddings
        self.gmail      = gmail
        self.calendar   = calendar
        self.founder_id = founder_id


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
        events = await deps.calendar.get_upcoming_events(days_ahead=days_ahead)
        return [e.to_dict() for e in events]

    async def get_todays_schedule() -> list[dict]:
        """
        Return today's calendar events.

        Returns:
            List of today's events sorted by start time
        """
        events = await deps.calendar.get_todays_events()
        return [e.to_dict() for e in events]

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

    # ── Company Context ───────────────────────────────────────────────────

    async def get_company_context() -> dict:
        """
        Return the founder's company profile and team roster.

        Returns:
            Dict with company_name, context summary, team_members list
        """
        profile = await deps.store.get_founder(deps.founder_id)
        if not profile:
            return {"error": "Founder profile not found"}
        return {
            "name":            profile.name,
            "company_name":    profile.company_name,
            "company_context": profile.company_context,
            "team_members":    profile.team_members,
            "timezone":        profile.timezone,
        }

    async def get_brain_summary() -> dict:
        """
        Return a high-level summary of the current state of the Company Brain:
        counts of active insights, at-risk relationships, open tasks, and pending alerts.

        Returns:
            Summary dict with counts and top-level signals
        """
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

        return {
            "total_active_insights":   len(active_insights),
            "insight_breakdown":       type_counts,
            "overdue_commitments":     len(overdue),
            "at_risk_relationships":   len(at_risk),
            "open_tasks":              len(open_tasks),
            "pending_alerts":          len(pending_alerts),
        }

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
        # Tasks
        "get_open_tasks":           get_open_tasks,
        "mark_task_done":           mark_task_done,
        "mark_task_blocked":        mark_task_blocked,
        # Alerts
        "get_pending_alerts":       get_pending_alerts,
        "dismiss_alert":            dismiss_alert,
        "mark_alert_surfaced":      mark_alert_surfaced,
        # Gmail
        "get_recent_emails":        get_recent_emails,
        "get_email_thread":         get_email_thread,
        "send_email":               send_email,
        "reply_to_email":           reply_to_email,
        # Calendar
        "get_upcoming_meetings":    get_upcoming_meetings,
        "get_todays_schedule":      get_todays_schedule,
        "get_meeting_with_contact": get_meeting_with_contact,
        # Company
        "get_company_context":      get_company_context,
        "get_brain_summary":        get_brain_summary,
    }
