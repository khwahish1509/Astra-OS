"""
Astra OS — Company Brain Store
================================
Firestore-backed store for all insights, relationships, tasks, and alerts.
Uses Firestore vector search (find_nearest) for semantic similarity queries.

Collections:
  brain_insights/{id}          — commitments, risks, decisions, action items
  brain_relationships/{email}  — relationship health per contact
  brain_tasks/{id}             — assigned tasks and their status
  brain_alerts/{id}            — proactive alerts for the founder
  brain_founders/{founder_id}  — founder profile

Vector Search:
  Insights are stored with a 768-dim embedding field.
  Queried via find_nearest() for semantic matching.

Setup required (run once):
  gcloud firestore indexes composite create \
    --collection-group=brain_insights \
    --query-scope=COLLECTION \
    --field-config=vector-config='{"dimension":"768","flat":"{}"}',field-path=embedding
"""

import asyncio
import time
from typing import Optional

from google.cloud import firestore
from google.cloud.firestore_v1.base_query import FieldFilter
from google.cloud.firestore_v1.vector import Vector
from google.cloud.firestore_v1.base_vector_query import DistanceMeasure

from .models import (
    Alert, AlertStatus, AlertSeverity,
    Insight, InsightStatus, InsightType,
    RelationshipProfile, Task, TaskStatus,
    FounderProfile,
)


# ─────────────────────────────────────────────────────────────────────────────
# Collection names
# ─────────────────────────────────────────────────────────────────────────────

COL_INSIGHTS      = "brain_insights"
COL_RELATIONSHIPS = "brain_relationships"
COL_TASKS         = "brain_tasks"
COL_ALERTS        = "brain_alerts"
COL_FOUNDERS      = "brain_founders"


class CompanyBrainStore:
    """
    The central memory of Astra OS.

    All agents read from and write to this store.
    Thread-safe for concurrent background agents.
    """

    def __init__(self, project_id: str):
        self._db = firestore.Client(project=project_id)
        print(f"[BrainStore] 🧠 Firestore connected (project={project_id})")

    # ── Helpers ───────────────────────────────────────────────────────────────

    def _run(self, fn):
        """Run a sync Firestore call in a thread pool to stay async-friendly."""
        return asyncio.to_thread(fn)

    # ── Founder Profile ───────────────────────────────────────────────────────

    async def get_founder(self, founder_id: str) -> Optional[FounderProfile]:
        doc = await self._run(
            lambda: self._db.collection(COL_FOUNDERS).document(founder_id).get()
        )
        if not doc.exists:
            return None
        return FounderProfile.from_firestore(doc.to_dict())

    async def save_founder(self, profile: FounderProfile) -> None:
        await self._run(
            lambda: self._db.collection(COL_FOUNDERS)
                             .document(profile.founder_id)
                             .set(profile.to_firestore())
        )

    # ── Insights ──────────────────────────────────────────────────────────────

    async def add_insight(self, insight: Insight) -> str:
        """Store an insight. If it has an embedding, stores it as a Firestore Vector."""
        data = insight.to_firestore()
        if insight.embedding and any(v != 0.0 for v in insight.embedding):
            data["embedding"] = Vector(insight.embedding)

        await self._run(
            lambda: self._db.collection(COL_INSIGHTS)
                             .document(insight.id)
                             .set(data)
        )
        return insight.id

    async def get_insight(self, insight_id: str) -> Optional[Insight]:
        doc = await self._run(
            lambda: self._db.collection(COL_INSIGHTS).document(insight_id).get()
        )
        if not doc.exists:
            return None
        return Insight.from_firestore(doc.to_dict())

    async def update_insight_status(self, insight_id: str, status: InsightStatus) -> None:
        await self._run(
            lambda: self._db.collection(COL_INSIGHTS)
                             .document(insight_id)
                             .update({"status": status.value, "updated_at": time.time()})
        )

    async def get_active_insights(
        self,
        founder_id: str,
        insight_type: Optional[InsightType] = None,
        limit: int = 50,
    ) -> list[Insight]:
        """Get active insights, optionally filtered by type. Filters in Python to avoid composite indexes."""
        def _query():
            return list(
                self._db.collection(COL_INSIGHTS)
                        .where(filter=FieldFilter("founder_id", "==", founder_id))
                        .limit(200)
                        .stream()
            )

        docs = await self._run(_query)
        insights = [Insight.from_firestore(d.to_dict()) for d in docs]

        # Filter in Python — avoids needing composite indexes
        results = [i for i in insights if i.status == InsightStatus.ACTIVE]
        if insight_type:
            results = [i for i in results if i.type == insight_type]

        # Sort by created_at descending
        results.sort(key=lambda i: i.created_at or 0, reverse=True)
        return results[:limit]

    async def search_insights_semantic(
        self,
        query_embedding: list[float],
        founder_id: str,
        limit: int = 10,
    ) -> list[Insight]:
        """
        Find semantically similar insights using Firestore vector search.
        Requires the composite vector index to be created (see setup.sh).
        """
        try:
            def _search():
                collection = self._db.collection(COL_INSIGHTS)
                results = collection.find_nearest(
                    vector_field="embedding",
                    query_vector=Vector(query_embedding),
                    distance_measure=DistanceMeasure.COSINE,
                    limit=limit,
                    distance_result_field="vector_distance",
                ).stream()
                # Filter to only this founder's insights
                return [
                    doc for doc in results
                    if doc.to_dict().get("founder_id") == founder_id
                ]

            docs = await self._run(_search)
            return [Insight.from_firestore(d.to_dict()) for d in docs]

        except Exception as e:
            print(f"[BrainStore] ⚠️  Vector search failed ({e}) — falling back to recency query")
            return await self.get_active_insights(founder_id, limit=limit)

    async def get_overdue_commitments(self, founder_id: str) -> list[Insight]:
        """
        Find ACTIVE commitments whose due_date has passed.
        These are the #1 risk signal Astra monitors.
        """
        from datetime import date

        today = date.today().isoformat()

        # Single-field query, filter everything else in Python
        active = await self.get_active_insights(founder_id, insight_type=InsightType.COMMITMENT)

        overdue = [
            i for i in active
            if i.due_date and i.due_date <= today
        ]
        return overdue

    # ── Relationships ─────────────────────────────────────────────────────────

    async def get_relationship(
        self, founder_id: str, contact_email: str
    ) -> Optional[RelationshipProfile]:
        doc_id = f"{founder_id}_{contact_email.replace('@', '_at_').replace('.', '_')}"
        doc = await self._run(
            lambda: self._db.collection(COL_RELATIONSHIPS).document(doc_id).get()
        )
        if not doc.exists:
            return None
        return RelationshipProfile.from_firestore(doc.to_dict())

    async def save_relationship(self, profile: RelationshipProfile) -> None:
        doc_id = (
            f"{profile.founder_id}_"
            f"{profile.contact_email.replace('@', '_at_').replace('.', '_')}"
        )
        await self._run(
            lambda: self._db.collection(COL_RELATIONSHIPS)
                             .document(doc_id)
                             .set(profile.to_firestore())
        )

    async def get_at_risk_relationships(
        self, founder_id: str, threshold: float = 0.4
    ) -> list[RelationshipProfile]:
        """Get relationships with health score below threshold."""
        all_rels = await self.get_all_relationships(founder_id)
        return [p for p in all_rels if p.health_score <= threshold]

    async def get_all_relationships(self, founder_id: str) -> list[RelationshipProfile]:
        def _query():
            return list(
                self._db.collection(COL_RELATIONSHIPS)
                        .where(filter=FieldFilter("founder_id", "==", founder_id))
                        .limit(50)
                        .stream()
            )
        docs = await self._run(_query)
        profiles = [RelationshipProfile.from_firestore(d.to_dict()) for d in docs]
        profiles.sort(key=lambda p: p.health_score)
        return profiles

    # ── Tasks ─────────────────────────────────────────────────────────────────

    async def add_task(self, task: Task) -> str:
        await self._run(
            lambda: self._db.collection(COL_TASKS)
                             .document(task.id)
                             .set(task.to_firestore())
        )
        return task.id

    async def update_task_status(self, task_id: str, status: TaskStatus) -> None:
        await self._run(
            lambda: self._db.collection(COL_TASKS)
                             .document(task_id)
                             .update({"status": status.value, "updated_at": time.time()})
        )

    async def get_open_tasks(self, founder_id: str) -> list[Task]:
        def _query():
            return list(
                self._db.collection(COL_TASKS)
                        .where(filter=FieldFilter("founder_id", "==", founder_id))
                        .limit(100)
                        .stream()
            )
        docs = await self._run(_query)
        tasks = [Task.from_firestore(d.to_dict()) for d in docs]
        # Filter to open tasks in Python
        open_statuses = {TaskStatus.PENDING, TaskStatus.IN_PROGRESS, TaskStatus.BLOCKED}
        tasks = [t for t in tasks if t.status in open_statuses]
        tasks.sort(key=lambda t: t.created_at or 0, reverse=True)
        return tasks[:30]

    # ── Alerts ────────────────────────────────────────────────────────────────

    async def add_alert(self, alert: Alert) -> str:
        await self._run(
            lambda: self._db.collection(COL_ALERTS)
                             .document(alert.id)
                             .set(alert.to_firestore())
        )
        return alert.id

    async def get_pending_alerts(
        self, founder_id: str, min_severity: AlertSeverity = AlertSeverity.MEDIUM
    ) -> list[Alert]:
        """Get unsurfaced alerts above the severity threshold, highest severity first."""
        severity_order = {
            AlertSeverity.LOW.value:      0,
            AlertSeverity.MEDIUM.value:   1,
            AlertSeverity.HIGH.value:     2,
            AlertSeverity.CRITICAL.value: 3,
        }
        min_level = severity_order[min_severity.value]

        def _query():
            return list(
                self._db.collection(COL_ALERTS)
                        .where(filter=FieldFilter("founder_id", "==", founder_id))
                        .limit(50)
                        .stream()
            )

        docs = await self._run(_query)
        alerts = [Alert.from_firestore(d.to_dict()) for d in docs]
        # Filter to pending + severity in Python
        results = [
            a for a in alerts
            if a.status == AlertStatus.PENDING
            and severity_order.get(a.severity.value, 0) >= min_level
        ]
        results.sort(key=lambda a: a.created_at or 0, reverse=True)
        return results[:20]

    async def mark_alert_surfaced(self, alert_id: str) -> None:
        await self._run(
            lambda: self._db.collection(COL_ALERTS)
                             .document(alert_id)
                             .update({"status": AlertStatus.SURFACED.value, "surfaced_at": time.time()})
        )

    async def dismiss_alert(self, alert_id: str) -> None:
        await self._run(
            lambda: self._db.collection(COL_ALERTS)
                             .document(alert_id)
                             .update({"status": AlertStatus.DISMISSED.value})
        )
