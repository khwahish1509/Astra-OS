"""
Astra OS — Background Agents
==============================
Two long-running background agents that run on a schedule:

1. EmailScannerAgent
   - Polls Gmail every N minutes
   - Extracts insights (commitments, risks, decisions, action items)
   - Updates relationship health scores
   - Embeds each insight with text-embedding-004 and stores in Firestore

2. RiskMonitorAgent
   - Runs every N minutes after the email scan
   - Checks for overdue commitments
   - Detects declining relationship health
   - Detects blocked tasks
   - Creates Alert objects and stores them in Firestore
   - Optionally triggers proactive voice via Gemini Live

Both agents use Gemini 2.0 Flash for fast, cheap inference.
"""

from __future__ import annotations

import asyncio
import json
import re
import time
from datetime import datetime, date
from typing import TYPE_CHECKING

import google.genai as genai
from google.genai import types as genai_types

if TYPE_CHECKING:
    from brain.store import CompanyBrainStore
    from brain.embeddings import EmbeddingPipeline
    from integrations.gmail_client import GmailClient
    from integrations.calendar_client import CalendarClient

from brain.models import (
    Alert, AlertSeverity, AlertStatus,
    Insight, InsightSource, InsightStatus, InsightType,
    RelationshipProfile, Task, TaskStatus, ToneTrend,
)


EXTRACTION_MODEL = "gemini-2.0-flash"
FALLBACK_MODEL   = "gemini-2.5-flash"


# ─────────────────────────────────────────────────────────────────────────────
# Email Scanner Agent
# ─────────────────────────────────────────────────────────────────────────────

class EmailScannerAgent:
    """
    Scans recent Gmail messages and extracts structured insights into
    the Company Brain using Gemini for extraction + text-embedding-004 for storage.

    Runs in the background on a configurable interval.
    Thread-safe — uses asyncio primitives only.
    """

    def __init__(
        self,
        store:        "CompanyBrainStore",
        embeddings:   "EmbeddingPipeline",
        gmail:        "GmailClient",
        api_key:      str,
        founder_id:   str,
        scan_interval_minutes: int = 15,
    ):
        self._store       = store
        self._embeddings  = embeddings
        self._gmail       = gmail
        self._api_key     = api_key
        self._founder_id  = founder_id
        self._interval    = scan_interval_minutes * 60
        self._client      = genai.Client(api_key=api_key)
        self._running     = False
        self._task: asyncio.Task | None = None

    # ── Lifecycle ─────────────────────────────────────────────────────────

    def start(self) -> None:
        """Start the background scan loop."""
        if not self._running:
            self._running = True
            self._task = asyncio.create_task(self._scan_loop())
            print(f"[EmailScanner] 🚀 Started (interval={self._interval}s)")

    async def stop(self) -> None:
        """Gracefully stop the scan loop."""
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        print("[EmailScanner] 🛑 Stopped")

    async def run_once(self, hours_back: int = 24) -> int:
        """Run a single scan pass. Returns number of insights extracted."""
        return await self._scan(hours_back=hours_back)

    # ── Main loop ─────────────────────────────────────────────────────────

    async def _scan_loop(self) -> None:
        """Run scan every interval. First scan covers last 24h; subsequent scans cover 1h."""
        first_run = True
        while self._running:
            try:
                hours = 24 if first_run else 1
                n = await self._scan(hours_back=hours)
                print(f"[EmailScanner] ✅ Scan complete — {n} insights extracted")
                first_run = False
            except Exception as e:
                print(f"[EmailScanner] ❌ Scan failed: {e}")
            await asyncio.sleep(self._interval)

    async def _scan(self, hours_back: int = 1) -> int:
        """Core scan: fetch emails → extract insights → embed → store."""
        emails = await self._gmail.get_recent_emails(
            hours_back=hours_back, max_results=50
        )
        if not emails:
            return 0

        print(f"[EmailScanner] 📧 Scanning {len(emails)} emails...")

        # Fetch founder profile for context
        profile = await self._store.get_founder(self._founder_id)
        company_context = profile.company_context if profile else ""
        my_email = profile.email if profile else ""

        total_insights = 0
        for email in emails:
            try:
                insights = await self._extract_insights(email, company_context, my_email)
                if insights:
                    # Embed all insights concurrently
                    texts = [i.content + " " + i.raw_context[:300] for i in insights]
                    embeddings = await self._embeddings.embed_batch(texts)

                    for insight, embedding in zip(insights, embeddings):
                        insight.embedding = embedding
                        await self._store.add_insight(insight)

                    total_insights += len(insights)

                    # Update relationship health for the sender
                    await self._update_relationship(email, insights)

            except Exception as e:
                print(f"[EmailScanner] ⚠️  Error processing email {email.message_id}: {e}")

        return total_insights

    async def _extract_insights(self, email, company_context: str, my_email: str) -> list[Insight]:
        """Use Gemini to extract structured insights from a single email."""
        prompt = f"""You are an AI assistant helping a founder track their business commitments, risks, and relationships.

Company context: {company_context or "A startup/SMB"}

Analyze this email and extract ALL significant business insights.

EMAIL:
From: {email.sender}
Subject: {email.subject}
Date: {email.date}
Body:
{email.body[:3000]}

---

Extract insights in this EXACT JSON format (array of objects):
[
  {{
    "type": "commitment|risk|decision|action_item|opportunity|relationship",
    "content": "Clear 1-2 sentence description of the insight",
    "parties": ["email1@example.com"],
    "due_date": "YYYY-MM-DD or null",
    "metadata": {{}}
  }}
]

Types:
- commitment: A promise or obligation made by the founder (e.g. "I will send the report by Friday")
- risk: A potential threat to the business or relationship (e.g. customer sounds frustrated)
- decision: An agreed-upon course of action
- action_item: A task assigned to someone on the team
- opportunity: A business opportunity mentioned
- relationship: A significant relationship signal (introductions, praise, complaints)

Only extract genuinely important business signals. If none, return [].
Respond ONLY with the JSON array."""

        raw = await self._call_gemini(prompt)
        if not raw:
            return []

        try:
            # Strip markdown code fences if present
            clean = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw.strip())
            data = json.loads(clean)
            if not isinstance(data, list):
                return []
        except json.JSONDecodeError:
            return []

        insights = []
        for item in data:
            try:
                itype = InsightType(item.get("type", ""))
            except ValueError:
                continue

            insight = Insight(
                founder_id  = self._founder_id,
                type        = itype,
                source      = InsightSource.EMAIL,
                content     = item.get("content", ""),
                raw_context = f"From: {email.sender}\nSubject: {email.subject}\n{email.body[:500]}",
                parties     = item.get("parties", [email.sender_email]),
                due_date    = item.get("due_date"),
                source_ref  = email.message_id,
                metadata    = item.get("metadata", {}),
            )
            if insight.content:
                insights.append(insight)

        return insights

    async def _update_relationship(self, email, insights: list[Insight]) -> None:
        """Update or create a RelationshipProfile for the email sender."""
        contact_email = email.sender_email
        if not contact_email:
            return

        profile = await self._store.get_relationship(self._founder_id, contact_email)
        if not profile:
            profile = RelationshipProfile(
                founder_id    = self._founder_id,
                contact_email = contact_email,
                name          = email.sender.split("<")[0].strip(),
            )

        # Update interaction stats
        profile.interaction_count += 1
        profile.last_contact_at = email.timestamp
        profile.last_updated = time.time()

        # Detect tone from risk/relationship insights
        risk_signals = [i for i in insights if i.type in (InsightType.RISK, InsightType.RELATIONSHIP)]
        if risk_signals:
            signal_texts = "; ".join(i.content for i in risk_signals[:3])
            profile.recent_signals.append(signal_texts)

            # Simple heuristic: if we extracted a risk insight, health nudges down
            profile.health_score = max(0.0, profile.health_score - 0.05 * len(risk_signals))
            profile.tone_trend   = ToneTrend.DECLINING if profile.health_score < 0.5 else profile.tone_trend
        else:
            # Positive interaction nudges health up slightly
            profile.health_score = min(1.0, profile.health_score + 0.02)

        # Count open commitments to this contact
        commitments = [i for i in insights if i.type == InsightType.COMMITMENT and contact_email in i.parties]
        profile.open_commitments += len(commitments)

        await self._store.save_relationship(profile)

    async def _call_gemini(self, prompt: str) -> str | None:
        """Call Gemini for text extraction with model fallback."""
        for model in [EXTRACTION_MODEL, FALLBACK_MODEL]:
            try:
                response = await asyncio.to_thread(
                    self._client.models.generate_content,
                    model=model,
                    contents=prompt,
                    config=genai_types.GenerateContentConfig(
                        temperature=0.1,
                        max_output_tokens=2048,
                    ),
                )
                return response.text
            except Exception as e:
                if "429" in str(e) or "RESOURCE_EXHAUSTED" in str(e):
                    await asyncio.sleep(5)
                    continue
                print(f"[EmailScanner] ❌ Gemini call failed ({model}): {e}")
                return None
        return None


# ─────────────────────────────────────────────────────────────────────────────
# Risk Monitor Agent
# ─────────────────────────────────────────────────────────────────────────────

class RiskMonitorAgent:
    """
    Proactively monitors the Company Brain for risks and generates alerts.

    Checks:
      1. Overdue commitments (due date passed, still ACTIVE)
      2. At-risk relationships (health score < threshold)
      3. Blocked tasks
      4. Silent contacts (high-value contact hasn't replied in N days)

    Alerts are stored in Firestore and surfaced via the voice coordinator.
    """

    def __init__(
        self,
        store:       "CompanyBrainStore",
        api_key:     str,
        founder_id:  str,
        check_interval_minutes: int = 30,
    ):
        self._store    = store
        self._api_key  = api_key
        self._founder_id = founder_id
        self._interval = check_interval_minutes * 60
        self._client   = genai.Client(api_key=api_key)
        self._running  = False
        self._task: asyncio.Task | None = None

    # ── Lifecycle ─────────────────────────────────────────────────────────

    def start(self) -> None:
        if not self._running:
            self._running = True
            self._task = asyncio.create_task(self._monitor_loop())
            print(f"[RiskMonitor] 🚀 Started (interval={self._interval}s)")

    async def stop(self) -> None:
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        print("[RiskMonitor] 🛑 Stopped")

    async def run_once(self) -> int:
        """Run a single monitoring pass. Returns number of new alerts created."""
        return await self._monitor()

    # ── Main loop ─────────────────────────────────────────────────────────

    async def _monitor_loop(self) -> None:
        while self._running:
            try:
                n = await self._monitor()
                if n > 0:
                    print(f"[RiskMonitor] 🚨 {n} new alerts generated")
            except Exception as e:
                print(f"[RiskMonitor] ❌ Monitor pass failed: {e}")
            await asyncio.sleep(self._interval)

    async def _monitor(self) -> int:
        """Run all checks and generate alerts. Returns number of new alerts."""
        alerts_created = 0

        # Run all checks concurrently
        results = await asyncio.gather(
            self._check_overdue_commitments(),
            self._check_at_risk_relationships(),
            self._check_blocked_tasks(),
            return_exceptions=True,
        )

        for result in results:
            if isinstance(result, int):
                alerts_created += result
            elif isinstance(result, Exception):
                print(f"[RiskMonitor] ⚠️  Check failed: {result}")

        return alerts_created

    async def _check_overdue_commitments(self) -> int:
        """Create HIGH alerts for overdue commitments."""
        overdue = await self._store.get_overdue_commitments(self._founder_id)
        if not overdue:
            return 0

        created = 0
        for insight in overdue:
            parties_str = ", ".join(insight.parties[:2])
            alert = Alert(
                founder_id  = self._founder_id,
                title       = f"Overdue commitment to {parties_str}",
                message     = (
                    f"You have an overdue commitment: '{insight.content}'. "
                    f"It was due {insight.due_date}. "
                    f"Involved: {parties_str}. "
                    f"Consider reaching out or updating your timeline."
                ),
                severity            = AlertSeverity.HIGH,
                related_insight_ids = [insight.id],
                related_contact     = insight.parties[0] if insight.parties else None,
            )
            await self._store.add_alert(alert)
            created += 1

        return created

    async def _check_at_risk_relationships(self) -> int:
        """Create MEDIUM/HIGH alerts for declining relationships."""
        at_risk = await self._store.get_at_risk_relationships(
            self._founder_id, threshold=0.4
        )
        if not at_risk:
            return 0

        created = 0
        for profile in at_risk:
            severity = (
                AlertSeverity.HIGH if profile.health_score < 0.25
                else AlertSeverity.MEDIUM
            )
            name_or_email = profile.name or profile.contact_email
            alert = Alert(
                founder_id  = self._founder_id,
                title       = f"Relationship at risk: {name_or_email}",
                message     = (
                    f"Your relationship with {name_or_email} needs attention. "
                    f"Health score: {profile.health_score:.0%}. "
                    f"Trend: {profile.tone_trend.value}. "
                    f"Open commitments: {profile.open_commitments}. "
                    + (f"Recent signals: {'; '.join(profile.recent_signals[-2:])}." if profile.recent_signals else "")
                ),
                severity        = severity,
                related_contact = profile.contact_email,
            )
            await self._store.add_alert(alert)
            created += 1

        return created

    async def _check_blocked_tasks(self) -> int:
        """Create MEDIUM alerts for tasks that have been blocked too long."""
        tasks = await self._store.get_open_tasks(self._founder_id)
        blocked = [t for t in tasks if t.status == TaskStatus.BLOCKED]
        if not blocked:
            return 0

        created = 0
        for task in blocked:
            # Only alert if blocked for more than 24h
            blocked_hours = (time.time() - task.updated_at) / 3600
            if blocked_hours < 24:
                continue

            alert = Alert(
                founder_id  = self._founder_id,
                title       = f"Task blocked: {task.title}",
                message     = (
                    f"Task '{task.title}' assigned to {task.assignee or 'unknown'} "
                    f"has been blocked for {int(blocked_hours)} hours. "
                    + (f"Notes: {task.notes}" if task.notes else "Consider checking in.")
                ),
                severity            = AlertSeverity.MEDIUM,
                related_insight_ids = [task.source_insight_id] if task.source_insight_id else [],
            )
            await self._store.add_alert(alert)
            created += 1

        return created
