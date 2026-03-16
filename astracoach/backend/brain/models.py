"""
Astra OS — Company Brain Data Models
=====================================
All dataclasses that flow through the system.
Every insight, commitment, relationship, task, and alert
lives here — clean, typed, Firestore-serializable.
"""

from __future__ import annotations

import time
import uuid
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional


# ─────────────────────────────────────────────────────────────────────────────
# Enums
# ─────────────────────────────────────────────────────────────────────────────

class InsightType(str, Enum):
    COMMITMENT    = "commitment"      # "I'll send the report by Friday"
    RISK          = "risk"            # Customer tone went negative
    DECISION      = "decision"        # "We agreed to move forward with X"
    ACTION_ITEM   = "action_item"     # "John needs to fix the bug"
    OPPORTUNITY   = "opportunity"     # "They mentioned needing Y"
    RELATIONSHIP  = "relationship"    # Any notable relationship signal


class InsightSource(str, Enum):
    EMAIL    = "email"
    MEETING  = "meeting"
    CALENDAR = "calendar"
    MANUAL   = "manual"              # Founder told Astra directly


class InsightStatus(str, Enum):
    ACTIVE    = "active"
    RESOLVED  = "resolved"
    DISMISSED = "dismissed"
    EXPIRED   = "expired"


class TaskStatus(str, Enum):
    PENDING     = "pending"
    IN_PROGRESS = "in_progress"
    BLOCKED     = "blocked"
    DONE        = "done"


class TaskPriority(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    URGENT = "urgent"


class AlertSeverity(str, Enum):
    LOW      = "low"
    MEDIUM   = "medium"
    HIGH     = "high"
    CRITICAL = "critical"


class AlertStatus(str, Enum):
    PENDING   = "pending"     # Generated, not yet shown
    SURFACED  = "surfaced"    # Shown to founder
    DISMISSED = "dismissed"   # Founder said "not important"
    RESOLVED  = "resolved"    # Underlying issue fixed


class ToneTrend(str, Enum):
    POSITIVE  = "positive"
    NEUTRAL   = "neutral"
    NEGATIVE  = "negative"
    DECLINING = "declining"   # Was positive, going negative


# ─────────────────────────────────────────────────────────────────────────────
# Core: Insight
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class Insight:
    """
    The atomic unit of the Company Brain.

    Every email thread, every meeting exchange, every decision
    becomes one or more Insights. Insights are embedded with
    text-embedding-004 and stored in Firestore for vector search.
    """
    founder_id:   str
    type:         InsightType
    source:       InsightSource
    content:      str            # Human-readable summary of the insight
    raw_context:  str            # Original text it was extracted from
    parties:      list[str]      # Email addresses / names involved

    id:           str   = field(default_factory=lambda: str(uuid.uuid4()))
    status:       InsightStatus = InsightStatus.ACTIVE
    due_date:     Optional[str] = None          # ISO date string "2025-06-15"
    source_ref:   Optional[str] = None          # Email ID, meeting session ID, etc.
    created_at:   float = field(default_factory=time.time)
    updated_at:   float = field(default_factory=time.time)
    embedding:    Optional[list[float]] = None  # text-embedding-004 vector (768-dim)
    metadata:     dict  = field(default_factory=dict)

    def to_firestore(self) -> dict:
        """Serialize for Firestore storage (excludes raw embedding — stored separately)."""
        return {
            "id":           self.id,
            "founder_id":   self.founder_id,
            "type":         self.type.value,
            "source":       self.source.value,
            "content":      self.content,
            "raw_context":  self.raw_context[:2000],  # cap at 2k chars
            "parties":      self.parties,
            "status":       self.status.value,
            "due_date":     self.due_date,
            "source_ref":   self.source_ref,
            "created_at":   self.created_at,
            "updated_at":   self.updated_at,
            "metadata":     self.metadata,
        }

    @classmethod
    def from_firestore(cls, data: dict) -> "Insight":
        return cls(
            id          = data["id"],
            founder_id  = data["founder_id"],
            type        = InsightType(data["type"]),
            source      = InsightSource(data["source"]),
            content     = data["content"],
            raw_context = data.get("raw_context", ""),
            parties     = data.get("parties", []),
            status      = InsightStatus(data.get("status", "active")),
            due_date    = data.get("due_date"),
            source_ref  = data.get("source_ref"),
            created_at  = data.get("created_at", time.time()),
            updated_at  = data.get("updated_at", time.time()),
            metadata    = data.get("metadata", {}),
        )


# ─────────────────────────────────────────────────────────────────────────────
# Relationship Profile
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class RelationshipProfile:
    """
    Tracks the health of the founder's relationship with a key contact.

    Built incrementally from email threads and meeting mentions.
    Health score 1.0 = excellent, 0.0 = critical risk.
    """
    founder_id:          str
    contact_email:       str

    name:                str   = ""
    health_score:        float = 0.75     # 0.0 → 1.0
    tone_trend:          ToneTrend = ToneTrend.NEUTRAL
    last_contact_at:     float = 0.0      # Unix timestamp
    avg_response_hours:  float = 24.0     # their avg reply time
    interaction_count:   int   = 0
    open_commitments:    int   = 0        # unresolved commitments to them
    recent_signals:      list[str] = field(default_factory=list)  # last 5 notable events
    last_updated:        float = field(default_factory=time.time)

    def to_firestore(self) -> dict:
        return {
            "founder_id":         self.founder_id,
            "contact_email":      self.contact_email,
            "name":               self.name,
            "health_score":       self.health_score,
            "tone_trend":         self.tone_trend.value,
            "last_contact_at":    self.last_contact_at,
            "avg_response_hours": self.avg_response_hours,
            "interaction_count":  self.interaction_count,
            "open_commitments":   self.open_commitments,
            "recent_signals":     self.recent_signals[-10:],
            "last_updated":       self.last_updated,
        }

    @classmethod
    def from_firestore(cls, data: dict) -> "RelationshipProfile":
        return cls(
            founder_id         = data["founder_id"],
            contact_email      = data["contact_email"],
            name               = data.get("name", ""),
            health_score       = data.get("health_score", 0.75),
            tone_trend         = ToneTrend(data.get("tone_trend", "neutral")),
            last_contact_at    = data.get("last_contact_at", 0.0),
            avg_response_hours = data.get("avg_response_hours", 24.0),
            interaction_count  = data.get("interaction_count", 0),
            open_commitments   = data.get("open_commitments", 0),
            recent_signals     = data.get("recent_signals", []),
            last_updated       = data.get("last_updated", time.time()),
        )


# ─────────────────────────────────────────────────────────────────────────────
# Task
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class Task:
    """
    A concrete action item assigned to a team member.
    Created from Insights (commitments, action items).
    """
    founder_id:        str
    title:             str
    description:       str

    id:                str   = field(default_factory=lambda: str(uuid.uuid4()))
    assignee:          str   = ""          # name or email of the person responsible
    due_date:          Optional[str] = None
    status:            TaskStatus = TaskStatus.PENDING
    priority:          str   = "medium"    # "low" | "medium" | "high" | "urgent"
    tags:              list[str] = field(default_factory=list)  # e.g. ["frontend", "backend"]
    completed_at:      Optional[float] = None
    comments:          list[dict] = field(default_factory=list)  # [{text, author, created_at}]
    source_insight_id: Optional[str] = None    # which Insight created this
    created_at:        float = field(default_factory=time.time)
    updated_at:        float = field(default_factory=time.time)
    notes:             str   = ""

    def to_firestore(self) -> dict:
        return {
            "id":                self.id,
            "founder_id":        self.founder_id,
            "title":             self.title,
            "description":       self.description,
            "assignee":          self.assignee,
            "due_date":          self.due_date,
            "status":            self.status.value,
            "priority":          self.priority,
            "tags":              self.tags,
            "completed_at":      self.completed_at,
            "comments":          self.comments,
            "source_insight_id": self.source_insight_id,
            "created_at":        self.created_at,
            "updated_at":        self.updated_at,
            "notes":             self.notes,
        }

    @classmethod
    def from_firestore(cls, data: dict) -> "Task":
        return cls(
            id                = data["id"],
            founder_id        = data["founder_id"],
            title             = data["title"],
            description       = data.get("description", ""),
            assignee          = data.get("assignee", ""),
            due_date          = data.get("due_date"),
            status            = TaskStatus(data.get("status", "pending")),
            priority          = data.get("priority", "medium"),
            tags              = data.get("tags", []),
            completed_at      = data.get("completed_at"),
            comments          = data.get("comments", []),
            source_insight_id = data.get("source_insight_id"),
            created_at        = data.get("created_at", time.time()),
            updated_at        = data.get("updated_at", time.time()),
            notes             = data.get("notes", ""),
        )


# ─────────────────────────────────────────────────────────────────────────────
# Alert
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class Alert:
    """
    A proactive signal surfaced to the founder by the Risk Monitor agent.

    Alerts are generated when the brain detects a pattern that needs
    attention — overdue commitments, declining relationships, blocked tasks.
    They are surfaced via Gemini Live proactive audio.
    """
    founder_id:          str
    title:               str
    message:             str            # Full message spoken to founder
    severity:            AlertSeverity

    id:                  str   = field(default_factory=lambda: str(uuid.uuid4()))
    status:              AlertStatus = AlertStatus.PENDING
    related_insight_ids: list[str] = field(default_factory=list)
    related_contact:     Optional[str] = None
    created_at:          float = field(default_factory=time.time)
    surfaced_at:         Optional[float] = None
    resolved_at:         Optional[float] = None

    def to_firestore(self) -> dict:
        return {
            "id":                  self.id,
            "founder_id":          self.founder_id,
            "title":               self.title,
            "message":             self.message,
            "severity":            self.severity.value,
            "status":              self.status.value,
            "related_insight_ids": self.related_insight_ids,
            "related_contact":     self.related_contact,
            "created_at":          self.created_at,
            "surfaced_at":         self.surfaced_at,
            "resolved_at":         self.resolved_at,
        }

    @classmethod
    def from_firestore(cls, data: dict) -> "Alert":
        return cls(
            id                  = data["id"],
            founder_id          = data["founder_id"],
            title               = data["title"],
            message             = data["message"],
            severity            = AlertSeverity(data.get("severity", "medium")),
            status              = AlertStatus(data.get("status", "pending")),
            related_insight_ids = data.get("related_insight_ids", []),
            related_contact     = data.get("related_contact"),
            created_at          = data.get("created_at", time.time()),
            surfaced_at         = data.get("surfaced_at"),
            resolved_at         = data.get("resolved_at"),
        )


# ─────────────────────────────────────────────────────────────────────────────
# Email Message (transient — not persisted, used during extraction)
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class EmailMessage:
    """
    A parsed Gmail message. Used by EmailScanner, not stored directly.
    Insights extracted from it ARE stored.
    """
    message_id:  str
    thread_id:   str
    sender:      str           # "Name <email@domain.com>"
    sender_email: str          # just the email
    subject:     str
    body:        str           # plain text body
    date:        str           # RFC 2822 date string
    timestamp:   float         # Unix timestamp
    is_unread:   bool = False
    labels:      list[str] = field(default_factory=list)


# ─────────────────────────────────────────────────────────────────────────────
# Founder Profile
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class FounderProfile:
    """
    The founder's profile stored in Firestore.
    Contains their team, preferences, and company context.
    """
    founder_id:       str
    name:             str
    email:            str
    company_name:     str = ""
    company_context:  str = ""        # Brief description of the business
    team_members:     list[dict] = field(default_factory=list)  # [{name, role, email}]
    gmail_token_path: str = ""
    timezone:         str = "UTC"
    created_at:       float = field(default_factory=time.time)
    last_active:      float = field(default_factory=time.time)

    def to_firestore(self) -> dict:
        return {
            "founder_id":      self.founder_id,
            "name":            self.name,
            "email":           self.email,
            "company_name":    self.company_name,
            "company_context": self.company_context,
            "team_members":    self.team_members,
            "timezone":        self.timezone,
            "created_at":      self.created_at,
            "last_active":     self.last_active,
        }

    @classmethod
    def from_firestore(cls, data: dict) -> "FounderProfile":
        return cls(
            founder_id      = data["founder_id"],
            name            = data["name"],
            email           = data.get("email", ""),
            company_name    = data.get("company_name", ""),
            company_context = data.get("company_context", ""),
            team_members    = data.get("team_members", []),
            timezone        = data.get("timezone", "UTC"),
            created_at      = data.get("created_at", time.time()),
            last_active     = data.get("last_active", time.time()),
        )


# ─────────────────────────────────────────────────────────────────────────────
# Email Routing Models
# ─────────────────────────────────────────────────────────────────────────────

class EmailCategory(str, Enum):
    SALES = "sales"
    SUPPORT = "support"
    ENGINEERING = "engineering"
    PARTNERSHIPS = "partnerships"
    HR = "hr"
    FINANCE = "finance"
    PERSONAL = "personal"
    SPAM = "spam"


class EmailUrgency(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


@dataclass
class Team:
    founder_id: str
    name: str
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    members: list[dict] = field(default_factory=list)  # [{name, email, role}]
    color: str = "#4f7dff"
    email_alias: str = ""
    created_at: float = field(default_factory=time.time)

    def to_firestore(self) -> dict:
        return {
            "id": self.id, "founder_id": self.founder_id,
            "name": self.name, "members": self.members,
            "color": self.color, "email_alias": self.email_alias,
            "created_at": self.created_at,
        }

    @classmethod
    def from_firestore(cls, data: dict) -> "Team":
        return cls(
            id=data["id"], founder_id=data["founder_id"],
            name=data["name"], members=data.get("members", []),
            color=data.get("color", "#4f7dff"),
            email_alias=data.get("email_alias", ""),
            created_at=data.get("created_at", time.time()),
        )


@dataclass
class RoutingRule:
    founder_id: str
    name: str
    team_id: str
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    conditions: dict = field(default_factory=dict)  # {category, keywords, sender_domains}
    priority: int = 10
    enabled: bool = True
    auto_assign_to: str = ""  # specific member email or "" for round-robin
    created_at: float = field(default_factory=time.time)

    def to_firestore(self) -> dict:
        return {
            "id": self.id, "founder_id": self.founder_id,
            "name": self.name, "team_id": self.team_id,
            "conditions": self.conditions, "priority": self.priority,
            "enabled": self.enabled, "auto_assign_to": self.auto_assign_to,
            "created_at": self.created_at,
        }

    @classmethod
    def from_firestore(cls, data: dict) -> "RoutingRule":
        return cls(
            id=data["id"], founder_id=data["founder_id"],
            name=data["name"], team_id=data["team_id"],
            conditions=data.get("conditions", {}),
            priority=data.get("priority", 10),
            enabled=data.get("enabled", True),
            auto_assign_to=data.get("auto_assign_to", ""),
            created_at=data.get("created_at", time.time()),
        )


@dataclass
class RoutedEmail:
    founder_id: str
    email_id: str
    sender: str
    sender_email: str
    subject: str
    snippet: str
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    category: str = "personal"
    confidence: float = 0.0
    urgency: str = "medium"
    sentiment: str = "neutral"
    routed_to_team: str = ""
    routed_to_team_name: str = ""
    assigned_to: str = ""
    status: str = "new"  # new|assigned|in_progress|resolved|archived
    routing_method: str = "ai"  # ai|rule|manual
    routed_at: float = field(default_factory=time.time)
    resolved_at: Optional[float] = None

    def to_firestore(self) -> dict:
        return {
            "id": self.id, "founder_id": self.founder_id,
            "email_id": self.email_id, "sender": self.sender,
            "sender_email": self.sender_email, "subject": self.subject,
            "snippet": self.snippet, "category": self.category,
            "confidence": self.confidence, "urgency": self.urgency,
            "sentiment": self.sentiment,
            "routed_to_team": self.routed_to_team,
            "routed_to_team_name": self.routed_to_team_name,
            "assigned_to": self.assigned_to, "status": self.status,
            "routing_method": self.routing_method,
            "routed_at": self.routed_at, "resolved_at": self.resolved_at,
        }

    @classmethod
    def from_firestore(cls, data: dict) -> "RoutedEmail":
        return cls(
            id=data["id"],
            founder_id=data["founder_id"],
            email_id=data["email_id"],
            sender=data["sender"],
            sender_email=data["sender_email"],
            subject=data["subject"],
            snippet=data["snippet"],
            category=data.get("category", "personal"),
            confidence=data.get("confidence", 0.0),
            urgency=data.get("urgency", "medium"),
            sentiment=data.get("sentiment", "neutral"),
            routed_to_team=data.get("routed_to_team", ""),
            routed_to_team_name=data.get("routed_to_team_name", ""),
            assigned_to=data.get("assigned_to", ""),
            status=data.get("status", "new"),
            routing_method=data.get("routing_method", "ai"),
            routed_at=data.get("routed_at", time.time()),
            resolved_at=data.get("resolved_at"),
        )
