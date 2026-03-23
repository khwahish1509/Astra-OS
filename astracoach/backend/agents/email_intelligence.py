"""
Astra OS — Email Intelligence Engine
======================================
Production-grade two-layer email classification and scoring system.

Layer 1: Rules Engine (~85% of emails, instant, free)
  8-pass scoring system (0-10 scale):
    Pass 1 — Contact Tier Matching (domain + email lookup)
    Pass 2 — VIP Name Matching (named contacts from CRM)
    Pass 3 — Subject Keyword Scan (deal triggers, action words)
    Pass 4 — Noise Filtering (newsletters, noreply, calendar noise)
    Pass 5 — Business Logic Rules (founder-specific escalation)
    Pass 6 — Thread Depth Analysis (active conversations boost)
    Pass 7 — Urgency Language Detection (deadline/ASAP signals)
    Pass 8 — Signal Boosters (attachments+keywords, CC count, importance flag)

Layer 2: Gemini AI (~15% of emails, ~$1/month)
  For unknown senders / ambiguous content:
    - Category classification (sales, support, engineering, etc.)
    - Urgency assessment
    - Sentiment analysis
    - Draft reply generation
    - Action recommendation
    - Executive 2-line briefing

Design principles:
  - False positives are annoying; false negatives lose deals
  - If unsure, SURFACE the email (never suppress)
  - Auto-learn from founder behavior (replies, meetings, CCs)
  - Thread-aware: conversations with depth matter more than one-offs
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional, TYPE_CHECKING

import google.genai as genai
from google.genai import types as genai_types

if TYPE_CHECKING:
    from brain.store import CompanyBrainStore
    from brain.models import EmailMessage


# ─────────────────────────────────────────────────────────────────────────────
# Enums & Constants
# ─────────────────────────────────────────────────────────────────────────────

class EmailPriority(str, Enum):
    """Final priority label after scoring."""
    CRITICAL = "critical"   # Score 9-10 — drop everything
    URGENT   = "urgent"     # Score 7-8  — respond today
    IMPORTANT = "important" # Score 5-6  — respond within 48h
    NOTABLE  = "notable"    # Score 3-4  — worth reading
    LOW      = "low"        # Score 1-2  — skim or ignore
    NOISE    = "noise"      # Score 0    — auto-archive


class EmailCategory(str, Enum):
    INVESTOR     = "investor"
    CUSTOMER     = "customer"
    PARTNER      = "partner"
    VENDOR       = "vendor"
    INTERNAL     = "internal"
    LEGAL        = "legal"
    HIRING       = "hiring"
    SALES        = "sales"
    SUPPORT      = "support"
    ENGINEERING  = "engineering"
    PERSONAL     = "personal"
    MARKETING    = "marketing"
    NEWSLETTER   = "newsletter"
    CALENDAR     = "calendar"
    NOTIFICATION = "notification"
    UNKNOWN      = "unknown"


class ActionType(str, Enum):
    """Recommended action for the founder."""
    RESPOND_NOW     = "respond_now"      # Reply immediately
    RESPOND_TODAY   = "respond_today"    # Reply within the day
    REVIEW          = "review"           # Read and decide
    DELEGATE        = "delegate"         # Forward to team member
    SCHEDULE        = "schedule"         # Schedule a meeting
    FILE            = "file"             # File for reference
    ARCHIVE         = "archive"          # No action needed
    FOLLOW_UP       = "follow_up"        # Follow up later


class PipelineStage(str, Enum):
    """Email processing pipeline stages."""
    NEW        = "new"          # Just arrived, not yet triaged
    TRIAGED    = "triaged"      # Scored and classified
    ACTION_REQ = "action_required"  # Needs founder attention
    DELEGATED  = "delegated"    # Assigned to team member
    SCHEDULED  = "scheduled"    # Follow-up scheduled
    REPLIED    = "replied"      # Founder has responded
    DONE       = "done"         # Resolved, no further action
    ARCHIVED   = "archived"     # Low priority, filed away


# ─────────────────────────────────────────────────────────────────────────────
# Scoring Breakdown — detailed audit trail for every email
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class ScoringBreakdown:
    """Detailed audit trail showing exactly why an email got its score."""
    base_score: float = 0.0
    contact_tier_score: float = 0.0
    contact_tier_reason: str = ""
    vip_match_score: float = 0.0
    vip_match_reason: str = ""
    keyword_score: float = 0.0
    keyword_matches: list[str] = field(default_factory=list)
    noise_penalty: float = 0.0
    noise_reason: str = ""
    business_logic_score: float = 0.0
    business_logic_reason: str = ""
    thread_depth_score: float = 0.0
    thread_depth_reason: str = ""
    urgency_score: float = 0.0
    urgency_matches: list[str] = field(default_factory=list)
    signal_booster_score: float = 0.0
    signal_booster_reasons: list[str] = field(default_factory=list)
    founder_replied_boost: float = 0.0
    final_score: float = 0.0
    passes_fired: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "final_score": round(self.final_score, 1),
            "contact_tier": {"score": self.contact_tier_score, "reason": self.contact_tier_reason},
            "vip_match": {"score": self.vip_match_score, "reason": self.vip_match_reason},
            "keywords": {"score": self.keyword_score, "matches": self.keyword_matches},
            "noise": {"penalty": self.noise_penalty, "reason": self.noise_reason},
            "business_logic": {"score": self.business_logic_score, "reason": self.business_logic_reason},
            "thread_depth": {"score": self.thread_depth_score, "reason": self.thread_depth_reason},
            "urgency": {"score": self.urgency_score, "matches": self.urgency_matches},
            "signal_boosters": {"score": self.signal_booster_score, "reasons": self.signal_booster_reasons},
            "founder_replied": self.founder_replied_boost,
            "passes_fired": self.passes_fired,
        }


# ─────────────────────────────────────────────────────────────────────────────
# Scored Email — the output of the intelligence pipeline
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class ScoredEmail:
    """An email that has been scored, classified, and triaged."""
    # Original email data
    message_id: str
    thread_id: str
    sender: str
    sender_email: str
    subject: str
    body: str
    snippet: str
    date: str
    timestamp: float

    # Scoring results
    score: float = 0.0
    priority: EmailPriority = EmailPriority.LOW
    category: EmailCategory = EmailCategory.UNKNOWN
    action: ActionType = ActionType.REVIEW
    pipeline_stage: PipelineStage = PipelineStage.NEW

    # AI-generated fields
    briefing: str = ""              # 2-3 sentence executive summary
    strategic_context: str = ""     # Why this email matters
    draft_reply: str = ""           # Suggested response
    sentiment: str = "neutral"      # positive/negative/neutral/urgent

    # Metadata
    has_attachment: bool = False
    thread_depth: int = 1
    is_unread: bool = False
    founder_in_thread: bool = False
    cc_vip_count: int = 0
    scoring_breakdown: Optional[ScoringBreakdown] = None

    # Pipeline tracking
    delegated_to: str = ""
    delegated_to_team: str = ""
    notes: str = ""
    processed_at: float = field(default_factory=time.time)
    scored_by: str = "rules"        # "rules" or "ai" or "rules+ai"

    def to_firestore(self) -> dict:
        return {
            "message_id": self.message_id,
            "thread_id": self.thread_id,
            "sender": self.sender,
            "sender_email": self.sender_email,
            "subject": self.subject,
            "snippet": self.snippet or self.body[:200],
            "date": self.date,
            "timestamp": self.timestamp,
            "score": round(self.score, 1),
            "priority": self.priority.value,
            "category": self.category.value,
            "action": self.action.value,
            "pipeline_stage": self.pipeline_stage.value,
            "briefing": self.briefing,
            "strategic_context": self.strategic_context,
            "draft_reply": self.draft_reply,
            "sentiment": self.sentiment,
            "has_attachment": self.has_attachment,
            "thread_depth": self.thread_depth,
            "is_unread": self.is_unread,
            "founder_in_thread": self.founder_in_thread,
            "cc_vip_count": self.cc_vip_count,
            "delegated_to": self.delegated_to,
            "delegated_to_team": self.delegated_to_team,
            "notes": self.notes,
            "processed_at": self.processed_at,
            "scored_by": self.scored_by,
            "scoring_breakdown": self.scoring_breakdown.to_dict() if self.scoring_breakdown else {},
        }

    @classmethod
    def from_firestore(cls, data: dict) -> "ScoredEmail":
        return cls(
            message_id=data["message_id"],
            thread_id=data.get("thread_id", ""),
            sender=data.get("sender", ""),
            sender_email=data.get("sender_email", ""),
            subject=data.get("subject", ""),
            body="",  # Don't store full body in Firestore
            snippet=data.get("snippet", ""),
            date=data.get("date", ""),
            timestamp=data.get("timestamp", 0),
            score=data.get("score", 0),
            priority=EmailPriority(data.get("priority", "low")),
            category=EmailCategory(data.get("category", "unknown")),
            action=ActionType(data.get("action", "review")),
            pipeline_stage=PipelineStage(data.get("pipeline_stage", "new")),
            briefing=data.get("briefing", ""),
            strategic_context=data.get("strategic_context", ""),
            draft_reply=data.get("draft_reply", ""),
            sentiment=data.get("sentiment", "neutral"),
            has_attachment=data.get("has_attachment", False),
            thread_depth=data.get("thread_depth", 1),
            is_unread=data.get("is_unread", False),
            founder_in_thread=data.get("founder_in_thread", False),
            cc_vip_count=data.get("cc_vip_count", 0),
            delegated_to=data.get("delegated_to", ""),
            delegated_to_team=data.get("delegated_to_team", ""),
            notes=data.get("notes", ""),
            processed_at=data.get("processed_at", 0),
            scored_by=data.get("scored_by", "rules"),
        )


# ─────────────────────────────────────────────────────────────────────────────
# Contact Database — auto-learning tiers
# ─────────────────────────────────────────────────────────────────────────────

class ContactDatabase:
    """
    Manages known contacts with tiered scoring.
    Auto-learns from founder behavior (sent emails, meetings, CCs).

    Tiers:
      TIER_1 (score 8): Key investors, top customers, board members
      TIER_2 (score 6): Active partners, vendors, advisors
      TIER_3 (score 4): Known contacts, team members
      AUTO   (score 5): Auto-learned from founder replies/meetings
    """

    def __init__(self):
        # Domain → tier mapping (domain-level)
        self._domain_tiers: dict[str, int] = {}
        # Email → (tier, name) mapping (individual contacts)
        self._contact_tiers: dict[str, tuple[int, str]] = {}
        # Auto-learned contacts (from sent items)
        self._auto_contacts: dict[str, float] = {}  # email → timestamp
        # Noise domains
        self._noise_domains: set[str] = set()
        # Noise sender patterns
        self._noise_senders: set[str] = set()

    def load_from_config(self, config: dict) -> None:
        """Load contact tiers from a config dict (stored in Firestore or .env)."""
        for domain, tier in config.get("domain_tiers", {}).items():
            self._domain_tiers[domain.lower()] = tier
        for email, info in config.get("contacts", {}).items():
            self._contact_tiers[email.lower()] = (info.get("tier", 3), info.get("name", ""))
        for domain in config.get("noise_domains", []):
            self._noise_domains.add(domain.lower())
        for sender in config.get("noise_senders", []):
            self._noise_senders.add(sender.lower())

    def load_defaults(self) -> None:
        """Load sensible default noise filters."""
        self._noise_domains = {
            # System notifications
            "noreply.github.com", "notify.linkedin.com", "email.monday.com",
            "notifications.google.com", "no-reply.accounts.google.com",
            "notifications.slack-edge.com", "email.calendly.com", "mailer-daemon.googlemail.com",
            # Newsletters & marketing
            "newsletter.substack.com", "updates.medium.com", "digest.producthunt.com",
            "news.ycombinator.com", "info.seekingalpha.com", "marketing.tech",
            # Entertainment / media
            "mailer.netflix.com", "email.disneyplus.com", "email.spotify.com",
            # Job boards / recruitment noise
            "thequickapply.com", "ziprecruiter.com", "messages.indeed.com",
            "email.glassdoor.com", "invitations.linkedin.com",
            # E-commerce / transactional
            "shipping@amazon.com", "auto-confirm@amazon.com",
            "email.ubereats.com", "info.doordash.com",
            # Social media
            "notification@facebookmail.com", "info@twitter.com", "noreply@youtube.com",
        }
        self._noise_senders = {
            "noreply@", "no-reply@", "notifications@", "marketing@",
            "newsletter@", "donotreply@", "do-not-reply@", "updates@",
            "mailer-daemon@", "postmaster@", "info@", "team@", "hello@",
            "support@", "billing@", "receipts@", "order@",
        }

    def get_tier(self, email: str, domain: str) -> tuple[int, str]:
        """
        Get the contact tier for an email/domain.
        Returns (tier_score, reason).
        0 = unknown, 1-3 = tiers, -1 = noise
        """
        email_lower = email.lower()
        domain_lower = domain.lower()

        # Check individual contact
        if email_lower in self._contact_tiers:
            tier, name = self._contact_tiers[email_lower]
            tier_scores = {1: 8, 2: 6, 3: 4}
            return (tier_scores.get(tier, 4), f"Known contact: {name} (Tier {tier})")

        # Check auto-learned contacts
        if email_lower in self._auto_contacts:
            return (5, "Auto-learned: founder has communicated with this contact")

        # Check domain tier
        if domain_lower in self._domain_tiers:
            tier = self._domain_tiers[domain_lower]
            tier_scores = {1: 8, 2: 6, 3: 4}
            return (tier_scores.get(tier, 4), f"Known domain: {domain_lower} (Tier {tier})")

        # Check noise
        if domain_lower in self._noise_domains:
            return (-1, f"Noise domain: {domain_lower}")
        for pattern in self._noise_senders:
            if email_lower.startswith(pattern):
                return (-1, f"Noise sender: {pattern}")

        return (0, "Unknown contact")

    def add_auto_contact(self, email: str) -> None:
        """Auto-learn a contact from founder behavior."""
        self._auto_contacts[email.lower()] = time.time()

    def add_contact(self, email: str, tier: int, name: str = "") -> None:
        """Manually add a contact."""
        self._contact_tiers[email.lower()] = (tier, name)

    def add_domain_tier(self, domain: str, tier: int) -> None:
        """Set tier for an entire domain."""
        self._domain_tiers[domain.lower()] = tier

    def to_config(self) -> dict:
        """Export as config dict for persistence."""
        return {
            "domain_tiers": dict(self._domain_tiers),
            "contacts": {
                email: {"tier": tier, "name": name}
                for email, (tier, name) in self._contact_tiers.items()
            },
            "auto_contacts": dict(self._auto_contacts),
            "noise_domains": list(self._noise_domains),
            "noise_senders": list(self._noise_senders),
        }


# ─────────────────────────────────────────────────────────────────────────────
# Keyword Banks
# ─────────────────────────────────────────────────────────────────────────────

# High-value subject/body keywords (each gets +1-3 points)
DEAL_KEYWORDS = {
    # Finance & Investment (score +3)
    "investment": 3, "investor": 3, "funding": 3, "capital": 3,
    "series a": 3, "series b": 3, "seed round": 3, "raise": 2,
    "valuation": 3, "term sheet": 3, "due diligence": 3,
    # Legal (score +3)
    "nda": 3, "contract": 2, "agreement": 2, "legal": 2,
    "signed": 2, "signature": 2, "loi": 3, "letter of intent": 3,
    # Sales & Deals (score +2)
    "proposal": 2, "rfp": 2, "quote": 2, "pricing": 2,
    "demo": 2, "pilot": 2, "poc": 2, "trial": 1,
    "partnership": 2, "strategic": 2, "acquisition": 3,
    # Urgency (score +2)
    "deadline": 2, "urgent": 2, "time-sensitive": 2, "expiring": 2,
    "final notice": 3, "last chance": 2,
    # Board & Governance (score +3)
    "board meeting": 3, "board report": 3, "shareholder": 3,
    "annual report": 2, "quarterly review": 2,
    # Product & Technical (score +1)
    "launch": 1, "release": 1, "api": 1, "integration": 1,
    "feature request": 1, "bug": 1, "outage": 2, "incident": 2,
}

# Urgency language patterns (detected in body)
URGENCY_PHRASES = [
    r"\basap\b", r"\burgent(ly)?\b", r"\bdeadline\b",
    r"\btime[- ]sensitive\b", r"\bby (end of|eod|cob|close of)\b",
    r"\bplease respond\b", r"\bneed(s?) (your |a )?confirmation\b",
    r"\baction required\b", r"\bimmediate(ly)?\b",
    r"\bcritical\b", r"\bpriority\b", r"\boverdue\b",
    r"\bescalat(e|ed|ing|ion)\b", r"\bblocking\b",
    r"\btoday\b", r"\btonigh?t\b", r"\btomorrow\b",
    r"\bsla\b", r"\bbreach\b",
    r"\bcannot wait\b", r"\bcan't wait\b",
    r"\brespond (asap|today|immediately)\b",
    r"\bfinal (warning|notice|reminder)\b",
]
URGENCY_PATTERNS = [re.compile(p, re.IGNORECASE) for p in URGENCY_PHRASES]

# Calendar noise subjects
CALENDAR_NOISE = [
    r"^accepted:", r"^declined:", r"^tentative:",
    r"^canceled:", r"^updated invitation:",
    r"^invitation:",  # calendar invites (auto-processed)
]
CALENDAR_NOISE_PATTERNS = [re.compile(p, re.IGNORECASE) for p in CALENDAR_NOISE]

# Newsletter / marketing noise
NEWSLETTER_PATTERNS = [
    r"\bunsubscribe\b", r"\bopt[- ]out\b", r"\bview in browser\b",
    r"\bemail preferences\b", r"\bmanage (your )?subscription\b",
    r"\bpowered by (mailchimp|sendgrid|hubspot|marketo)\b",
    r"\bfree trial\b", r"\bbuild your first\b",
    r"\bweekly digest\b", r"\bmonthly update\b",
    r"\bnewsletter\b",
]
NEWSLETTER_BODY_PATTERNS = [re.compile(p, re.IGNORECASE) for p in NEWSLETTER_PATTERNS]


# ─────────────────────────────────────────────────────────────────────────────
# Email Scoring Engine — Layer 1 (Rules)
# ─────────────────────────────────────────────────────────────────────────────

class EmailScoringEngine:
    """
    8-pass rules engine that scores every email 0-10.

    Designed to handle ~85% of emails without any AI calls.
    The remaining ~15% (unknown senders, ambiguous content) go to Layer 2.
    """

    def __init__(self, contacts: ContactDatabase, founder_email: str = ""):
        self._contacts = contacts
        self._founder_email = founder_email.lower()
        # Sent-item tracking: emails the founder has replied to
        self._founder_replied_threads: set[str] = set()
        self._founder_replied_contacts: set[str] = set()

    def learn_from_sent_items(self, sent_emails: list[dict]) -> None:
        """
        Ingest the founder's sent items to learn:
        1. Which threads they're active in
        2. Which contacts they communicate with
        """
        for email in sent_emails:
            thread_id = email.get("thread_id", "")
            if thread_id:
                self._founder_replied_threads.add(thread_id)
            to_email = email.get("to_email", "")
            if to_email:
                self._founder_replied_contacts.add(to_email.lower())
                self._contacts.add_auto_contact(to_email)

    def score(
        self,
        email: "EmailMessage",
        thread_depth: int = 1,
        has_attachment: bool = False,
        cc_emails: list[str] | None = None,
        importance_flag: bool = False,
    ) -> tuple[float, ScoringBreakdown]:
        """
        Score an email through all 8 passes.
        Returns (score, breakdown).
        """
        bd = ScoringBreakdown()
        score = 0.0

        domain = email.sender_email.split("@")[-1].lower() if "@" in email.sender_email else ""
        subject_lower = email.subject.lower()
        body_lower = (email.body or "").lower()[:5000]
        full_text = f"{subject_lower} {body_lower}"

        # ── Pass 1: Contact Tier Check ────────────────────────────────────
        tier_score, tier_reason = self._contacts.get_tier(email.sender_email, domain)
        if tier_score == -1:
            # Noise sender — heavy penalty but don't zero out yet
            bd.noise_penalty = -10
            bd.noise_reason = tier_reason
            bd.passes_fired.append("P1:noise_sender")
        elif tier_score > 0:
            bd.contact_tier_score = tier_score
            bd.contact_tier_reason = tier_reason
            score += tier_score
            bd.passes_fired.append(f"P1:contact_tier_{tier_score}")

        # ── Pass 2: VIP Name Matching ─────────────────────────────────────
        # Check if sender email is in the known VIP contacts
        if email.sender_email.lower() in self._contacts._contact_tiers:
            tier, name = self._contacts._contact_tiers[email.sender_email.lower()]
            if tier <= 1:
                bd.vip_match_score = 3
                bd.vip_match_reason = f"VIP contact: {name}"
                score += 3
                bd.passes_fired.append("P2:vip_match")

        # ── Pass 3: Subject + Body Keyword Scan ──────────────────────────
        keyword_total = 0
        for keyword, value in DEAL_KEYWORDS.items():
            if keyword in full_text:
                keyword_total += value
                bd.keyword_matches.append(f"{keyword}(+{value})")
        bd.keyword_score = min(keyword_total, 4)  # cap at 4
        score += bd.keyword_score
        if bd.keyword_matches:
            bd.passes_fired.append(f"P3:keywords({len(bd.keyword_matches)})")

        # ── Pass 4: Noise Filtering ───────────────────────────────────────
        # Calendar noise
        for pattern in CALENDAR_NOISE_PATTERNS:
            if pattern.search(email.subject):
                bd.noise_penalty = min(bd.noise_penalty, -5)
                bd.noise_reason = f"Calendar noise: {email.subject[:40]}"
                bd.passes_fired.append("P4:calendar_noise")
                break

        # Newsletter / marketing noise (check body)
        newsletter_signals = sum(1 for p in NEWSLETTER_BODY_PATTERNS if p.search(body_lower))
        if newsletter_signals >= 2:
            bd.noise_penalty = min(bd.noise_penalty, -4)
            bd.noise_reason = f"Newsletter detected ({newsletter_signals} signals)"
            bd.passes_fired.append("P4:newsletter_noise")

        # ── Pass 5: Business Logic Rules ──────────────────────────────────
        # Internal team emails mentioning customer names get boosted
        if domain == self._founder_email.split("@")[-1] if "@" in self._founder_email else "":
            bd.business_logic_score = 2
            bd.business_logic_reason = "Internal team email"
            score += 2
            bd.passes_fired.append("P5:internal_team")

        # Emails with "re:" in subject (active conversation) get a small boost
        if subject_lower.startswith("re:") or subject_lower.startswith("fwd:"):
            bd.business_logic_score += 1
            bd.business_logic_reason += " Active thread (Re:/Fwd:)"
            score += 1
            bd.passes_fired.append("P5:active_thread")

        # ── Pass 6: Thread Depth Analysis ─────────────────────────────────
        if thread_depth >= 3:
            depth_bonus = min(thread_depth - 2, 3)  # +1 per message depth, max +3
            bd.thread_depth_score = depth_bonus
            bd.thread_depth_reason = f"Thread depth {thread_depth} messages"
            score += depth_bonus
            bd.passes_fired.append(f"P6:thread_depth_{thread_depth}")

        # ── Pass 7: Urgency Language Detection ────────────────────────────
        urgency_matches = []
        for pattern in URGENCY_PATTERNS:
            match = pattern.search(full_text)
            if match:
                urgency_matches.append(match.group())
        if urgency_matches:
            urgency_bonus = min(len(urgency_matches), 3)  # max +3
            bd.urgency_score = urgency_bonus
            bd.urgency_matches = urgency_matches[:5]
            score += urgency_bonus
            bd.passes_fired.append(f"P7:urgency({len(urgency_matches)})")

        # ── Pass 8: Signal Boosters ───────────────────────────────────────
        booster_total = 0
        boosters = []

        # 8a: Founder replied to this thread → auto-important (+3)
        if email.thread_id in self._founder_replied_threads:
            bd.founder_replied_boost = 3
            score += 3
            boosters.append("Founder active in thread (+3)")
            bd.passes_fired.append("P8a:founder_replied")

        # 8b: Founder has communicated with this sender → known contact (+2)
        if email.sender_email.lower() in self._founder_replied_contacts:
            booster_total += 2
            boosters.append("Founder has communicated with sender (+2)")
            bd.passes_fired.append("P8b:founder_contact")

        # 8c: Multiple VIPs on CC → board-level or deal-critical (+2)
        if cc_emails:
            vip_cc = sum(
                1 for cc in cc_emails
                if self._contacts.get_tier(cc, cc.split("@")[-1] if "@" in cc else "")[0] >= 4
            )
            if vip_cc >= 2:
                booster_total += 2
                boosters.append(f"{vip_cc} VIPs on CC (+2)")
                bd.passes_fired.append(f"P8c:vip_cc_{vip_cc}")

        # 8d: Attachment + deal keyword → actionable document (+2)
        if has_attachment and bd.keyword_score > 0:
            booster_total += 2
            boosters.append("Attachment + deal keyword (+2)")
            bd.passes_fired.append("P8d:attachment_keyword")

        # 8e: Outlook/Gmail importance flag (+1)
        if importance_flag:
            booster_total += 1
            boosters.append("Importance flag set (+1)")
            bd.passes_fired.append("P8e:importance_flag")

        bd.signal_booster_score = booster_total
        bd.signal_booster_reasons = boosters
        score += booster_total

        # ── Apply noise penalty ──────────────────────────────────────────
        score += bd.noise_penalty

        # ── Clamp to 0-10 ────────────────────────────────────────────────
        bd.final_score = max(0.0, min(10.0, score))

        return bd.final_score, bd

    def needs_ai(self, score: float, bd: ScoringBreakdown) -> bool:
        """
        Decide if this email needs Layer 2 (Gemini AI) for classification.
        AI is needed when:
          - Unknown sender AND score is in the ambiguous range (2-6)
          - No passes fired except noise/keywords
        """
        is_unknown = bd.contact_tier_score == 0 and bd.vip_match_score == 0
        is_ambiguous = 1.5 < score < 6.5
        few_signals = len(bd.passes_fired) <= 2

        return is_unknown and (is_ambiguous or few_signals)


# ─────────────────────────────────────────────────────────────────────────────
# Email Classifier — Layer 2 (Gemini AI)
# ─────────────────────────────────────────────────────────────────────────────

class EmailAIClassifier:
    """
    Gemini-powered email classifier for the ~15% of emails
    that the rules engine can't confidently score.

    Returns: category, urgency, sentiment, briefing, draft reply,
    recommended action, and strategic context.
    """

    EXTRACTION_MODEL = "gemini-2.0-flash"
    FALLBACK_MODEL   = "gemini-2.5-flash"

    def __init__(self, api_key: str, founder_context: str = ""):
        self._client = genai.Client(api_key=api_key)
        self._founder_context = founder_context

    async def classify(
        self,
        email: "EmailMessage",
        existing_score: float = 0.0,
        existing_breakdown: ScoringBreakdown | None = None,
    ) -> dict:
        """
        Run Gemini AI on an email for deep classification.

        Returns dict with: category, urgency, sentiment, briefing,
        strategic_context, action, draft_reply, score_adjustment
        """
        rules_context = ""
        if existing_breakdown:
            fired = ", ".join(existing_breakdown.passes_fired) or "none"
            rules_context = f"\nRules engine score: {existing_score}/10 (passes: {fired})"

        prompt = f"""You are an AI executive assistant analyzing emails for a startup founder.
{f"Founder context: {self._founder_context}" if self._founder_context else ""}
{rules_context}

Analyze this email and return a JSON object:

EMAIL:
From: {email.sender} <{email.sender_email}>
Subject: {email.subject}
Date: {email.date}
Body:
{email.body[:4000]}

Return EXACTLY this JSON format:
{{
  "category": "investor|customer|partner|vendor|internal|legal|hiring|sales|support|engineering|personal|marketing|newsletter|calendar|notification|unknown",
  "urgency": "critical|high|medium|low|none",
  "sentiment": "positive|negative|neutral|urgent|frustrated",
  "briefing": "2-3 sentence executive briefing — what is this about and why does it matter",
  "strategic_context": "Why this email matters for the founder's business (1 sentence)",
  "action": "respond_now|respond_today|review|delegate|schedule|file|archive|follow_up",
  "draft_reply": "A professional draft reply if action is respond_now or respond_today, otherwise empty string",
  "score_adjustment": 0
}}

Rules:
- briefing should be concise, executive-level, no fluff
- draft_reply should be professional but warm, matching founder's voice
- score_adjustment: +1 to +3 if you think the rules engine underscored this, -1 to -3 if overscored
- If this is a newsletter/marketing/notification, set category accordingly and action to "archive"
- Be specific in strategic_context — name the business impact
- Return ONLY valid JSON"""

        for model in [self.EXTRACTION_MODEL, self.FALLBACK_MODEL]:
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
                raw = (response.text or "").strip()
                raw = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw).strip()
                data = json.loads(raw)

                # Validate required fields
                return {
                    "category": data.get("category", "unknown"),
                    "urgency": data.get("urgency", "medium"),
                    "sentiment": data.get("sentiment", "neutral"),
                    "briefing": data.get("briefing", ""),
                    "strategic_context": data.get("strategic_context", ""),
                    "action": data.get("action", "review"),
                    "draft_reply": data.get("draft_reply", ""),
                    "score_adjustment": data.get("score_adjustment", 0),
                }

            except json.JSONDecodeError:
                continue
            except Exception as e:
                if "429" in str(e) or "RESOURCE_EXHAUSTED" in str(e):
                    await asyncio.sleep(5)
                    continue
                print(f"[EmailAI] ❌ Classification failed ({model}): {e}")

        # Fallback: surface the email rather than dropping it
        return {
            "category": "unknown",
            "urgency": "medium",
            "sentiment": "neutral",
            "briefing": f"Email from {email.sender} about: {email.subject}",
            "strategic_context": "Could not classify — surfaced for manual review",
            "action": "review",
            "draft_reply": "",
            "score_adjustment": 0,
        }


# ─────────────────────────────────────────────────────────────────────────────
# Deduplication Tracker
# ─────────────────────────────────────────────────────────────────────────────

class EmailDeduplicator:
    """
    Tracks processed email IDs to avoid re-processing.
    Backed by Firestore for persistence across restarts.
    """

    COLLECTION = "email_processed_ids"

    def __init__(self, store: Optional["CompanyBrainStore"] = None, founder_id: str = ""):
        self._seen: set[str] = set()
        self._store = store
        self._founder_id = founder_id
        self._loaded = False

    async def load(self) -> None:
        """Load previously processed IDs from Firestore."""
        if self._store and not self._loaded:
            try:
                db = self._store._db
                docs = await asyncio.to_thread(
                    lambda: list(
                        db.collection(self.COLLECTION)
                        .document(self._founder_id)
                        .collection("ids")
                        .limit(50000)
                        .stream()
                    )
                )
                self._seen = {doc.id for doc in docs}
                self._loaded = True
                print(f"[Dedup] Loaded {len(self._seen)} processed email IDs")
            except Exception as e:
                print(f"[Dedup] ⚠️ Load failed: {e}")
                self._loaded = True  # Don't retry

    async def mark_processed(self, message_id: str) -> None:
        """Mark an email as processed."""
        self._seen.add(message_id)
        if self._store:
            try:
                db = self._store._db
                await asyncio.to_thread(
                    lambda: db.collection(self.COLLECTION)
                    .document(self._founder_id)
                    .collection("ids")
                    .document(message_id)
                    .set({"ts": time.time()})
                )
            except Exception as e:
                print(f"[Dedup] ⚠️ Mark failed: {e}")

    async def mark_batch(self, message_ids: list[str]) -> None:
        """Mark multiple emails as processed in a batch."""
        for mid in message_ids:
            self._seen.add(mid)
        if self._store and message_ids:
            try:
                db = self._store._db
                batch = db.batch()
                for mid in message_ids:
                    ref = (db.collection(self.COLLECTION)
                           .document(self._founder_id)
                           .collection("ids")
                           .document(mid))
                    batch.set(ref, {"ts": time.time()})
                await asyncio.to_thread(batch.commit)
            except Exception as e:
                print(f"[Dedup] ⚠️ Batch mark failed: {e}")

    def is_processed(self, message_id: str) -> bool:
        """Check if an email has already been processed."""
        return message_id in self._seen

    def filter_new(self, message_ids: list[str]) -> list[str]:
        """Return only unprocessed message IDs."""
        return [mid for mid in message_ids if mid not in self._seen]


# ─────────────────────────────────────────────────────────────────────────────
# Health Monitor
# ─────────────────────────────────────────────────────────────────────────────

class ScannerHealthMonitor:
    """
    Monitors the email scanner's health.
    Tracks consecutive failures and alerts if threshold exceeded.
    """

    def __init__(self, alert_threshold: int = 3):
        self._consecutive_failures = 0
        self._last_success: float = 0
        self._last_failure: float = 0
        self._total_scans = 0
        self._total_emails_processed = 0
        self._alert_threshold = alert_threshold
        self._alerts_sent = 0

    def record_success(self, emails_processed: int = 0) -> None:
        self._consecutive_failures = 0
        self._last_success = time.time()
        self._total_scans += 1
        self._total_emails_processed += emails_processed

    def record_failure(self, error: str = "") -> bool:
        """Record a failure. Returns True if alert threshold exceeded."""
        self._consecutive_failures += 1
        self._last_failure = time.time()
        self._total_scans += 1

        if self._consecutive_failures >= self._alert_threshold:
            self._alerts_sent += 1
            print(f"[ScannerHealth] 🚨 ALERT: {self._consecutive_failures} consecutive scan failures! "
                  f"Last error: {error}")
            return True
        return False

    def get_status(self) -> dict:
        return {
            "consecutive_failures": self._consecutive_failures,
            "last_success": self._last_success,
            "last_failure": self._last_failure,
            "total_scans": self._total_scans,
            "total_emails_processed": self._total_emails_processed,
            "alerts_sent": self._alerts_sent,
            "healthy": self._consecutive_failures < self._alert_threshold,
        }


# ─────────────────────────────────────────────────────────────────────────────
# Master Pipeline — ties everything together
# ─────────────────────────────────────────────────────────────────────────────

def score_to_priority(score: float) -> EmailPriority:
    """Convert a 0-10 score to a priority label."""
    if score >= 9:
        return EmailPriority.CRITICAL
    elif score >= 7:
        return EmailPriority.URGENT
    elif score >= 5:
        return EmailPriority.IMPORTANT
    elif score >= 3:
        return EmailPriority.NOTABLE
    elif score >= 1:
        return EmailPriority.LOW
    else:
        return EmailPriority.NOISE


def urgency_to_action(urgency: str, category: str) -> ActionType:
    """Map urgency + category to recommended action."""
    if urgency in ("critical",):
        return ActionType.RESPOND_NOW
    elif urgency in ("high",):
        return ActionType.RESPOND_TODAY
    elif category in ("newsletter", "notification", "calendar", "marketing"):
        return ActionType.ARCHIVE
    elif category in ("support", "engineering"):
        return ActionType.DELEGATE
    elif urgency in ("medium",):
        return ActionType.REVIEW
    else:
        return ActionType.FILE


class EmailIntelligencePipeline:
    """
    Master pipeline that orchestrates the full email intelligence flow.

    Usage:
        pipeline = EmailIntelligencePipeline(...)
        scored_emails = await pipeline.process_emails(raw_emails)
    """

    def __init__(
        self,
        scoring_engine: EmailScoringEngine,
        ai_classifier: EmailAIClassifier,
        deduplicator: EmailDeduplicator,
        health_monitor: ScannerHealthMonitor,
        store: Optional["CompanyBrainStore"] = None,
        founder_id: str = "",
    ):
        self.scoring = scoring_engine
        self.ai = ai_classifier
        self.dedup = deduplicator
        self.health = health_monitor
        self._store = store
        self._founder_id = founder_id

    async def process_emails(
        self,
        emails: list["EmailMessage"],
        thread_depths: dict[str, int] | None = None,
        attachment_map: dict[str, bool] | None = None,
        cc_map: dict[str, list[str]] | None = None,
        importance_map: dict[str, bool] | None = None,
    ) -> list[ScoredEmail]:
        """
        Process a batch of emails through the full intelligence pipeline.

        Steps:
          1. Dedup — skip already-processed emails
          2. Score — run 8-pass rules engine
          3. Classify — run Gemini AI on ambiguous emails
          4. Triage — assign priority, action, pipeline stage
          5. Store — persist scored emails in Firestore
          6. Mark — update dedup tracker

        Returns list of ScoredEmail objects.
        """
        thread_depths = thread_depths or {}
        attachment_map = attachment_map or {}
        cc_map = cc_map or {}
        importance_map = importance_map or {}

        # 1. Dedup
        await self.dedup.load()
        new_emails = [e for e in emails if not self.dedup.is_processed(e.message_id)]

        if not new_emails:
            print(f"[Pipeline] All {len(emails)} emails already processed — skipping")
            return []

        print(f"[Pipeline] Processing {len(new_emails)}/{len(emails)} new emails...")
        results: list[ScoredEmail] = []

        for email in new_emails:
            try:
                scored = await self._process_one(
                    email,
                    thread_depth=thread_depths.get(email.thread_id, 1),
                    has_attachment=attachment_map.get(email.message_id, False),
                    cc_emails=cc_map.get(email.message_id, []),
                    importance_flag=importance_map.get(email.message_id, False),
                )
                results.append(scored)
            except Exception as e:
                print(f"[Pipeline] ⚠️ Error processing {email.message_id}: {e}")
                # Still mark as processed to avoid retry loops
                await self.dedup.mark_processed(email.message_id)

        # 5. Batch store in Firestore
        if results and self._store:
            await self._store_scored_emails(results)

        # 6. Mark all as processed
        await self.dedup.mark_batch([e.message_id for e in new_emails])

        # Update health
        self.health.record_success(len(results))

        # Sort by score (highest first)
        results.sort(key=lambda e: e.score, reverse=True)

        print(f"[Pipeline] ✅ Processed {len(results)} emails — "
              f"CRITICAL: {sum(1 for e in results if e.priority == EmailPriority.CRITICAL)}, "
              f"URGENT: {sum(1 for e in results if e.priority == EmailPriority.URGENT)}, "
              f"IMPORTANT: {sum(1 for e in results if e.priority == EmailPriority.IMPORTANT)}, "
              f"NOISE: {sum(1 for e in results if e.priority == EmailPriority.NOISE)}")

        return results

    async def _process_one(
        self,
        email: "EmailMessage",
        thread_depth: int = 1,
        has_attachment: bool = False,
        cc_emails: list[str] | None = None,
        importance_flag: bool = False,
    ) -> ScoredEmail:
        """Process a single email through scoring + optional AI classification."""

        # 2. Score with rules engine
        score, breakdown = self.scoring.score(
            email,
            thread_depth=thread_depth,
            has_attachment=has_attachment,
            cc_emails=cc_emails,
            importance_flag=importance_flag,
        )

        # 3. AI classification for ambiguous emails
        ai_result = None
        scored_by = "rules"
        if self.scoring.needs_ai(score, breakdown):
            ai_result = await self.ai.classify(email, score, breakdown)
            scored_by = "rules+ai"

            # Apply AI score adjustment
            adjustment = ai_result.get("score_adjustment", 0)
            adjustment = max(-3, min(3, adjustment))  # clamp
            score = max(0, min(10, score + adjustment))

        # 4. Determine priority and action
        priority = score_to_priority(score)

        # Determine category — try AI first, then rules-based fallback
        category = EmailCategory.UNKNOWN
        if ai_result:
            try:
                category = EmailCategory(ai_result.get("category", "unknown"))
            except ValueError:
                category = EmailCategory.UNKNOWN

        # Rules-based category detection (for the ~85% that don't go through AI)
        if category == EmailCategory.UNKNOWN:
            category = self._classify_category_rules(email, breakdown)

        # Determine action
        action = ActionType.REVIEW
        if ai_result:
            try:
                action = ActionType(ai_result.get("action", "review"))
            except ValueError:
                action = urgency_to_action(
                    ai_result.get("urgency", "medium"),
                    ai_result.get("category", "unknown"),
                )

        # Rules-based action if still default REVIEW
        if action == ActionType.REVIEW:
            action = self._determine_action_rules(priority, category, email, breakdown)

        # Determine pipeline stage based on priority + category
        if priority in (EmailPriority.CRITICAL, EmailPriority.URGENT):
            pipeline_stage = PipelineStage.ACTION_REQ
        elif priority == EmailPriority.NOISE:
            pipeline_stage = PipelineStage.ARCHIVED
        elif category in (EmailCategory.NEWSLETTER, EmailCategory.MARKETING, EmailCategory.NOTIFICATION):
            pipeline_stage = PipelineStage.ARCHIVED
        else:
            pipeline_stage = PipelineStage.TRIAGED

        # Build the scored email
        scored = ScoredEmail(
            message_id=email.message_id,
            thread_id=email.thread_id,
            sender=email.sender,
            sender_email=email.sender_email,
            subject=email.subject,
            body=email.body,
            snippet=email.body[:200] if email.body else "",
            date=email.date,
            timestamp=email.timestamp,
            score=score,
            priority=priority,
            category=category,
            action=action,
            pipeline_stage=pipeline_stage,
            briefing=ai_result.get("briefing", "") if ai_result else "",
            strategic_context=ai_result.get("strategic_context", "") if ai_result else "",
            draft_reply=ai_result.get("draft_reply", "") if ai_result else "",
            sentiment=ai_result.get("sentiment", "neutral") if ai_result else "neutral",
            has_attachment=has_attachment,
            thread_depth=thread_depth,
            is_unread=email.is_unread,
            founder_in_thread=email.thread_id in self.scoring._founder_replied_threads,
            cc_vip_count=sum(
                1 for cc in (cc_emails or [])
                if self.scoring._contacts.get_tier(cc, cc.split("@")[-1] if "@" in cc else "")[0] >= 4
            ),
            scoring_breakdown=breakdown,
            scored_by=scored_by,
        )

        return scored

    def _classify_category_rules(self, email: "EmailMessage", bd: ScoringBreakdown) -> EmailCategory:
        """
        Rules-based category classification for emails that skip AI.
        Covers ~80% of common email types accurately.
        """
        sender = email.sender_email.lower() if email.sender_email else ""
        domain = sender.split("@")[-1] if "@" in sender else ""
        subject = (email.subject or "").lower()
        body = (email.body or "")[:3000].lower()
        full_text = f"{subject} {body}"

        # ── Calendar ──
        if any(kw in subject for kw in ["calendar event", "meeting invite", "rsvp", "invitation:", "you've been invited"]):
            return EmailCategory.CALENDAR
        if any(d in domain for d in ["calendar.google.com", "calendly.com", "cal.com"]):
            return EmailCategory.CALENDAR

        # ── Newsletter / Marketing ──
        if bd.noise_reason and "newsletter" in bd.noise_reason.lower():
            return EmailCategory.NEWSLETTER
        if any(kw in full_text for kw in ["unsubscribe", "email preferences", "manage subscription", "opt out"]):
            if any(kw in full_text for kw in ["weekly digest", "newsletter", "roundup", "this week in"]):
                return EmailCategory.NEWSLETTER
            return EmailCategory.MARKETING
        if any(d in domain for d in ["substack.com", "beehiiv.com", "mailchimp.com", "convertkit.com", "buttondown.email"]):
            return EmailCategory.NEWSLETTER

        # ── Notifications (automated systems) ──
        if any(p in sender for p in ["noreply@", "no-reply@", "notifications@", "notify@", "alert@", "mailer-daemon@"]):
            return EmailCategory.NOTIFICATION
        if any(d in domain for d in ["github.com", "gitlab.com", "jira.atlassian.com", "linear.app",
                                      "slack.com", "notion.so", "figma.com", "vercel.com"]):
            return EmailCategory.NOTIFICATION

        # ── Hiring / Recruitment ──
        if any(kw in full_text for kw in ["job opening", "job opportunity", "we're hiring", "job alert",
                                           "application status", "interview", "resume", "candidate",
                                           "recruitment", "recruiter", "hiring manager", "job application",
                                           "position at", "role at", "talent acquisition",
                                           "jobs hiring", "now hiring", "career"]):
            return EmailCategory.HIRING
        if any(d in domain for d in ["linkedin.com", "indeed.com", "glassdoor.com", "lever.co",
                                      "greenhouse.io", "workday.com", "thequickapply.com", "ziprecruiter.com"]):
            return EmailCategory.HIRING

        # ── Internal (same domain as founder) ──
        founder_domain = self.scoring._founder_email.split("@")[-1] if "@" in self.scoring._founder_email else ""
        if founder_domain and domain == founder_domain:
            return EmailCategory.INTERNAL

        # ── Sales (inbound pitches, cold outreach) ──
        if any(kw in full_text for kw in ["demo request", "free trial", "pricing plan", "schedule a call",
                                           "quick question", "reaching out", "saw your profile",
                                           "would love to connect", "partnership opportunity"]):
            return EmailCategory.SALES

        # ── Legal ──
        if any(kw in full_text for kw in ["terms of service", "privacy policy", "legal notice",
                                           "compliance", "nda", "agreement signed", "contract"]):
            return EmailCategory.LEGAL

        # ── Investor signals ──
        if any(kw in full_text for kw in ["term sheet", "due diligence", "cap table", "board meeting",
                                           "fundraising", "series a", "seed round", "valuation",
                                           "investor update", "pitch deck"]):
            return EmailCategory.INVESTOR

        # ── Customer signals ──
        if any(kw in full_text for kw in ["customer feedback", "feature request", "bug report",
                                           "support ticket", "churn", "renewal", "subscription",
                                           "onboarding", "getting started"]):
            return EmailCategory.CUSTOMER

        # ── Personal (common personal domains + known contacts) ──
        if domain in {"gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "icloud.com", "protonmail.com"}:
            # Only classify as personal if it's a known contact
            if sender in self.scoring._founder_replied_contacts:
                return EmailCategory.PERSONAL

        # ── Engineering (dev-related) ──
        if any(kw in full_text for kw in ["pull request", "merge request", "deployment", "ci/cd",
                                           "build failed", "test results", "code review"]):
            return EmailCategory.ENGINEERING

        return EmailCategory.UNKNOWN

    def _determine_action_rules(self, priority, category, email, bd) -> ActionType:
        """Rules-based action recommendation."""
        if priority in (EmailPriority.CRITICAL, EmailPriority.URGENT):
            return ActionType.RESPOND_NOW
        if category in (EmailCategory.NEWSLETTER, EmailCategory.MARKETING, EmailCategory.NOTIFICATION):
            return ActionType.ARCHIVE
        if category == EmailCategory.CALENDAR:
            return ActionType.REVIEW
        if category == EmailCategory.HIRING:
            return ActionType.FILE
        if priority == EmailPriority.NOISE:
            return ActionType.ARCHIVE
        if bd.founder_replied_boost > 0:
            return ActionType.RESPOND_TODAY
        if priority == EmailPriority.IMPORTANT:
            return ActionType.RESPOND_TODAY
        return ActionType.REVIEW

    async def _store_scored_emails(self, emails: list[ScoredEmail]) -> None:
        """Store scored emails in Firestore collection."""
        if not self._store:
            return
        try:
            db = self._store._db
            batch = db.batch()
            for email in emails:
                ref = db.collection("scored_emails").document(email.message_id)
                batch.set(ref, email.to_firestore())
            await asyncio.to_thread(batch.commit)
            print(f"[Pipeline] Stored {len(emails)} scored emails in Firestore")
        except Exception as e:
            print(f"[Pipeline] ⚠️ Store failed: {e}")

    async def get_pipeline_summary(self) -> dict:
        """Get a summary of the current email pipeline state."""
        if not self._store:
            return {"error": "No store configured"}
        try:
            db = self._store._db
            docs = await asyncio.to_thread(
                lambda: list(
                    db.collection("scored_emails")
                    .order_by("processed_at", direction="DESCENDING")
                    .limit(200)
                    .stream()
                )
            )
            emails = [ScoredEmail.from_firestore(d.to_dict()) for d in docs]

            by_priority = {}
            by_stage = {}
            by_category = {}
            for e in emails:
                by_priority[e.priority.value] = by_priority.get(e.priority.value, 0) + 1
                by_stage[e.pipeline_stage.value] = by_stage.get(e.pipeline_stage.value, 0) + 1
                by_category[e.category.value] = by_category.get(e.category.value, 0) + 1

            action_required = [e for e in emails if e.pipeline_stage == PipelineStage.ACTION_REQ]

            return {
                "total": len(emails),
                "by_priority": by_priority,
                "by_stage": by_stage,
                "by_category": by_category,
                "action_required": len(action_required),
                "action_required_emails": [e.to_firestore() for e in action_required[:10]],
                "health": self.health.get_status(),
            }
        except Exception as e:
            return {"error": str(e)}
