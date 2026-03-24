"""
Astra OS — Background Agents v2.0
===================================
Three agent components running in the background:

1. EmailScannerAgent (v2.0 — UPGRADED)
   - Two-layer intelligence: Rules Engine (8-pass scoring) + Gemini AI
   - Deduplication: never re-processes the same email
   - Thread depth analysis, sent mail tracking, auto-learning contacts
   - Urgency detection, attachment + keyword detection, noise filtering
   - Pipeline stages: New → Triaged → Action Required → Done
   - Draft reply generation for high-priority emails
   - Health monitoring with failure alerts
   - Insight extraction + relationship health tracking

2. RiskMonitorAgent
   - Overdue commitments, declining relationships, blocked tasks
   - Creates Alert objects in Firestore

Both use Gemini 2.0 Flash for inference.
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

from agents.email_intelligence import (
    EmailScoringEngine, EmailAIClassifier, EmailDeduplicator,
    ScannerHealthMonitor, EmailIntelligencePipeline, ContactDatabase,
    ScoredEmail, EmailPriority, PipelineStage,
)


EXTRACTION_MODEL = "gemini-2.0-flash"
FALLBACK_MODEL   = "gemini-2.5-flash"


# ─────────────────────────────────────────────────────────────────────────────
# Email Scanner Agent v2.0 — Full Intelligence Pipeline
# ─────────────────────────────────────────────────────────────────────────────

class EmailScannerAgent:
    """
    Enterprise-grade email scanner with two-layer intelligence.

    Layer 1: 8-pass rules engine (instant, free, handles ~85%)
    Layer 2: Gemini AI classification (fast, ~$1/month, handles ~15%)

    Also extracts business insights and updates relationship health.
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

        # ── Intelligence Pipeline Components ──────────────────────────────
        self._contacts = ContactDatabase()
        self._contacts.load_defaults()

        self._scoring = EmailScoringEngine(
            contacts=self._contacts,
            founder_email="",  # Set after loading founder profile
        )

        self._ai_classifier = EmailAIClassifier(
            api_key=api_key,
            founder_context="",  # Set after loading founder profile
        )

        self._dedup = EmailDeduplicator(
            store=store,
            founder_id=founder_id,
        )

        self._health = ScannerHealthMonitor(alert_threshold=3)

        self._pipeline = EmailIntelligencePipeline(
            scoring_engine=self._scoring,
            ai_classifier=self._ai_classifier,
            deduplicator=self._dedup,
            health_monitor=self._health,
            store=store,
            founder_id=founder_id,
        )

        self._initialized = False
        self._scan_lock = asyncio.Lock()  # Prevent concurrent scans

        # ── Incremental sync via History API ──────────────────────────────
        self._last_history_id = None
        self._full_scan_interval = 6 * 3600  # Full scan every 6 hours
        self._fast_interval = 60  # History check every 60 seconds
        self._last_full_scan = 0

    # ── Public accessors ──────────────────────────────────────────────────

    @property
    def pipeline(self) -> EmailIntelligencePipeline:
        return self._pipeline

    @property
    def health(self) -> ScannerHealthMonitor:
        return self._health

    @property
    def contacts(self) -> ContactDatabase:
        return self._contacts

    # ── Lifecycle ─────────────────────────────────────────────────────────

    def start(self) -> None:
        """Start the background scan loop."""
        if not self._running:
            self._running = True
            self._task = asyncio.create_task(self._scan_loop())
            print(f"[EmailScanner] 🚀 Started v2.0 (interval={self._interval}s)")

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

    async def run_once(self, hours_back: int = 24, max_fetch: int = 500) -> dict:
        """Run a single scan pass. Returns summary of results. Locked to prevent concurrent scans."""
        if self._scan_lock.locked():
            print("[EmailScanner] ⚠️ Scan already in progress — skipping duplicate request")
            return {"emails_fetched": 0, "emails_scored": 0, "insights_extracted": 0, "status": "already_running"}
        async with self._scan_lock:
            return await self._scan(hours_back=hours_back, max_fetch=max_fetch)

    # ── Initialization (one-time setup) ───────────────────────────────────

    async def _initialize(self) -> None:
        """One-time initialization: load founder profile, learn contacts, load dedup state."""
        if self._initialized:
            return

        print("[EmailScanner] 🔧 Initializing intelligence pipeline...")

        # Load founder profile
        profile = await self._store.get_founder(self._founder_id)
        if profile:
            self._scoring._founder_email = profile.email
            self._ai_classifier._founder_context = (
                f"Company: {profile.company_name}. "
                f"Context: {profile.company_context}. "
                f"Founder: {profile.name} ({profile.email})"
            )

        # Load existing relationships into contact database
        try:
            relationships = await self._store.get_all_relationships(self._founder_id)
            for rel in relationships:
                tier = 1 if rel.health_score >= 0.8 else (2 if rel.health_score >= 0.5 else 3)
                self._contacts.add_contact(rel.contact_email, tier, rel.name)
            print(f"[EmailScanner] Loaded {len(relationships)} contacts from CRM")
        except Exception as e:
            print(f"[EmailScanner] ⚠️ Failed to load relationships: {e}")

        # Load contact config from Firestore (if saved)
        try:
            db = self._store._db
            doc = await asyncio.to_thread(
                lambda: db.collection("email_config").document(self._founder_id).get()
            )
            if doc.exists:
                self._contacts.load_from_config(doc.to_dict())
                print("[EmailScanner] Loaded contact config from Firestore")
        except Exception as e:
            print(f"[EmailScanner] ⚠️ Contact config load failed: {e}")

        # Learn from sent items (who does the founder communicate with?)
        try:
            sent = await self._gmail.get_sent_emails(hours_back=720, max_results=100)
            self._scoring.learn_from_sent_items(sent)
            print(f"[EmailScanner] Learned from {len(sent)} sent emails "
                  f"({len(self._scoring._founder_replied_threads)} threads, "
                  f"{len(self._scoring._founder_replied_contacts)} contacts)")
        except Exception as e:
            print(f"[EmailScanner] ⚠️ Sent mail learning failed: {e}")

        # Load dedup state
        await self._dedup.load()

        self._initialized = True
        print("[EmailScanner] ✅ Intelligence pipeline initialized")

    # ── Main loop ─────────────────────────────────────────────────────────

    async def _scan_loop(self) -> None:
        """Run fast incremental sync every 60 seconds, full scan every 6 hours."""
        first_run = True
        while self._running:
            try:
                if self._scan_lock.locked():
                    await asyncio.sleep(self._fast_interval)
                    continue

                async with self._scan_lock:
                    now = time.time()
                    needs_full = first_run or (now - self._last_full_scan > self._full_scan_interval)

                    if needs_full:
                        hours = 87600 if first_run else 6
                        max_emails = 10000 if first_run else 1000
                        result = await self._scan(hours_back=hours, max_fetch=max_emails)
                        # Get initial history ID after full scan
                        try:
                            profile = await self._gmail.get_profile()
                            self._last_history_id = str(profile.get("historyId", ""))
                            print(f"[EmailScanner] 📌 History ID set: {self._last_history_id}")
                        except Exception as e:
                            print(f"[EmailScanner] ⚠️ Failed to get historyId: {e}")
                        self._last_full_scan = now
                        first_run = False
                        print(f"[EmailScanner] ✅ Full scan: {result.get('emails_scored', 0)} scored")
                    elif self._last_history_id:
                        # Fast incremental sync via History API
                        result = await self._fast_sync()
                        if result.get("new_emails", 0) > 0:
                            print(f"[EmailScanner] ⚡ Fast sync: {result['new_emails']} new emails")
            except Exception as e:
                self._health.record_failure(str(e))
                print(f"[EmailScanner] ❌ Error: {e}")
            await asyncio.sleep(self._fast_interval)

    async def _scan(self, hours_back: int = 1, max_fetch: int = 200) -> dict:
        """
        Full intelligence scan with INCREMENTAL BATCH PROCESSING.

        Instead of fetching all emails then processing all at once, this:
          1. Fetches all email IDs from Gmail (fast — just message refs)
          2. Processes emails in batches of BATCH_SIZE
          3. Each batch: fetch details → score → save to Firestore → UI updates live
          4. Skips already-processed emails via dedup

        This means the UI sees new emails appearing progressively during a large scan.
        """
        BATCH_SIZE = 100  # Process 100 emails at a time for progressive UI updates

        await self._initialize()

        # 1. Fetch emails — paginated, fetches all matching emails
        emails = await self._gmail.get_recent_emails(
            hours_back=hours_back, max_results=max_fetch, exclude_promotions=False
        )
        if not emails:
            self._health.record_success(0)
            return {"emails_fetched": 0, "emails_scored": 0, "insights_extracted": 0}

        total_fetched = len(emails)
        print(f"[EmailScanner] 📧 Fetched {total_fetched} emails, processing in batches of {BATCH_SIZE}...")

        # 2. Process in batches — each batch gets scored and saved immediately
        total_scored = 0
        total_insights = 0
        priority_counts = {"critical": 0, "urgent": 0, "important": 0, "notable": 0, "low": 0, "noise": 0}

        for batch_idx in range(0, total_fetched, BATCH_SIZE):
            batch = emails[batch_idx:batch_idx + BATCH_SIZE]
            batch_num = batch_idx // BATCH_SIZE + 1
            total_batches = (total_fetched + BATCH_SIZE - 1) // BATCH_SIZE

            print(f"[EmailScanner] 📦 Batch {batch_num}/{total_batches} — {len(batch)} emails...")

            # 2a. Fetch enrichment data for THIS batch only (not all 5000)
            batch_thread_ids = list({e.thread_id for e in batch if e.thread_id})
            batch_message_ids = [e.message_id for e in batch]

            try:
                thread_meta, msg_meta = await asyncio.gather(
                    self._gmail.get_thread_metadata(batch_thread_ids),
                    self._gmail.get_message_metadata(batch_message_ids),
                )
            except Exception as e:
                print(f"[EmailScanner] ⚠️ Metadata fetch failed for batch {batch_num}: {e}")
                thread_meta, msg_meta = {}, {}

            thread_depths = {tid: meta.get("depth", 1) for tid, meta in thread_meta.items()}
            attachment_map = {mid: meta.get("has_attachment", False) for mid, meta in msg_meta.items()}
            cc_map = {mid: meta.get("cc_emails", []) for mid, meta in msg_meta.items()}
            importance_map = {mid: meta.get("importance", False) for mid, meta in msg_meta.items()}

            # 2b. Score + classify + save to Firestore (UI sees these immediately)
            try:
                scored_batch = await self._pipeline.process_emails(
                    batch,
                    thread_depths=thread_depths,
                    attachment_map=attachment_map,
                    cc_map=cc_map,
                    importance_map=importance_map,
                )
            except Exception as e:
                print(f"[EmailScanner] ⚠️ Pipeline failed for batch {batch_num}: {e}")
                scored_batch = []

            total_scored += len(scored_batch)

            # Count priorities
            for s in scored_batch:
                pname = s.priority.value if hasattr(s.priority, 'value') else str(s.priority)
                if pname in priority_counts:
                    priority_counts[pname] += 1

            # 2c. Extract insights from important emails in this batch
            for scored in scored_batch:
                if scored.priority in (EmailPriority.NOISE, EmailPriority.LOW):
                    continue
                try:
                    original = next((e for e in batch if e.message_id == scored.message_id), None)
                    if original:
                        insights = await self._extract_insights(original)
                        if insights:
                            texts = [i.content + " " + i.raw_context[:300] for i in insights]
                            embeddings = await self._embeddings.embed_batch(texts)
                            for insight, embedding in zip(insights, embeddings):
                                insight.embedding = embedding
                                await self._store.add_insight(insight)
                            total_insights += len(insights)
                            await self._update_relationship(original, insights)
                except Exception as e:
                    print(f"[EmailScanner] ⚠️ Insight extraction failed: {e}")

            print(f"[EmailScanner] ✅ Batch {batch_num}/{total_batches} done — "
                  f"{len(scored_batch)} scored ({total_scored} total so far)")

        # 3. Save contact config for persistence
        await self._save_contact_config()

        print(f"[EmailScanner] 🏁 Full scan complete — {total_fetched} fetched, {total_scored} scored, {total_insights} insights")
        return {
            "emails_fetched": total_fetched,
            "emails_scored": total_scored,
            "insights_extracted": total_insights,
            "by_priority": priority_counts,
        }

    async def _fast_sync(self) -> dict:
        """Use Gmail History API for near-real-time email detection."""
        await self._initialize()

        try:
            new_emails, new_history_id = await self._gmail.get_new_emails_since(self._last_history_id)
            self._last_history_id = new_history_id
        except Exception as e:
            # historyId expired — need full resync
            if "404" in str(e) or "historyId" in str(e).lower():
                print("[EmailScanner] ⚠️ History ID expired — scheduling full resync")
                self._last_full_scan = 0  # Force full scan next loop
            else:
                print(f"[EmailScanner] ⚠️ Fast sync failed: {e}")
            return {"new_emails": 0}

        if not new_emails:
            return {"new_emails": 0}

        # Process new emails through the intelligence pipeline
        batch_thread_ids = list({e.thread_id for e in new_emails if e.thread_id})
        batch_message_ids = [e.message_id for e in new_emails]

        try:
            thread_meta, msg_meta = await asyncio.gather(
                self._gmail.get_thread_metadata(batch_thread_ids),
                self._gmail.get_message_metadata(batch_message_ids),
            )
        except:
            thread_meta, msg_meta = {}, {}

        thread_depths = {tid: meta.get("depth", 1) for tid, meta in thread_meta.items()}
        attachment_map = {mid: meta.get("has_attachment", False) for mid, meta in msg_meta.items()}
        cc_map = {mid: meta.get("cc_emails", []) for mid, meta in msg_meta.items()}
        importance_map = {mid: meta.get("importance", False) for mid, meta in msg_meta.items()}

        scored = await self._pipeline.process_emails(
            new_emails,
            thread_depths=thread_depths,
            attachment_map=attachment_map,
            cc_map=cc_map,
            importance_map=importance_map,
        )

        return {"new_emails": len(scored), "history_id": new_history_id}

    async def _save_contact_config(self) -> None:
        """Persist contact database config to Firestore."""
        try:
            db = self._store._db
            config = self._contacts.to_config()
            await asyncio.to_thread(
                lambda: db.collection("email_config").document(self._founder_id).set(config)
            )
        except Exception as e:
            print(f"[EmailScanner] ⚠️ Contact config save failed: {e}")

    async def _create_scanner_alert(self, error: str) -> None:
        """Create a CRITICAL alert when scanner fails repeatedly."""
        alert = Alert(
            founder_id=self._founder_id,
            title="Email Scanner Down",
            message=f"Email scanning has failed {self._health._consecutive_failures} times. "
                    f"Last error: {error[:200]}. Emails may be missed.",
            severity=AlertSeverity.CRITICAL,
        )
        await self._store.add_alert(alert)

    async def _extract_insights(self, email, company_context: str = "") -> list[Insight]:
        """Use Gemini to extract structured insights from a single email."""
        if not company_context:
            profile = await self._store.get_founder(self._founder_id)
            company_context = profile.company_context if profile else ""

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
- commitment: A promise or obligation made (e.g. "I will send the report by Friday")
- risk: A potential threat to the business or relationship
- decision: An agreed-upon course of action
- action_item: A task assigned to someone
- opportunity: A business opportunity mentioned
- relationship: A significant relationship signal

Only extract genuinely important business signals. If none, return [].
Respond ONLY with the JSON array."""

        raw = await self._call_gemini(prompt)
        if not raw:
            return []

        try:
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
                founder_id=self._founder_id,
                type=itype,
                source=InsightSource.EMAIL,
                content=item.get("content", ""),
                raw_context=f"From: {email.sender}\nSubject: {email.subject}\n{email.body[:500]}",
                parties=item.get("parties", [email.sender_email]),
                due_date=item.get("due_date"),
                source_ref=email.message_id,
                metadata=item.get("metadata", {}),
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
                founder_id=self._founder_id,
                contact_email=contact_email,
                name=email.sender.split("<")[0].strip(),
            )

        profile.interaction_count += 1
        profile.last_contact_at = email.timestamp
        profile.last_updated = time.time()

        risk_signals = [i for i in insights if i.type in (InsightType.RISK, InsightType.RELATIONSHIP)]
        if risk_signals:
            signal_texts = "; ".join(i.content for i in risk_signals[:3])
            profile.recent_signals.append(signal_texts)
            profile.health_score = max(0.0, profile.health_score - 0.05 * len(risk_signals))
            profile.tone_trend = ToneTrend.DECLINING if profile.health_score < 0.5 else profile.tone_trend
        else:
            profile.health_score = min(1.0, profile.health_score + 0.02)

        commitments = [i for i in insights if i.type == InsightType.COMMITMENT and contact_email in i.parties]
        profile.open_commitments += len(commitments)

        # Auto-learn this contact into the intelligence database
        tier = 1 if profile.health_score >= 0.8 else (2 if profile.health_score >= 0.5 else 3)
        self._contacts.add_contact(contact_email, tier, profile.name)

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
