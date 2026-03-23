"""
Astra OS — Voice-Matched Draft Engine
=======================================
Production-grade email draft generator that matches the founder's
writing style per recipient.

How it works (same approach as Superhuman + Shortwave):
  1. Pull recent sent emails to this recipient from EmailMemoryStore
  2. Analyze writing style: formality, length, greeting/closing patterns
  3. Build a style fingerprint
  4. Few-shot prompt Gemini with style examples + current thread context
  5. Generate a draft that sounds like the founder, not like AI

Key insight: People write differently to different recipients.
The draft to an investor should sound different from a reply to
a teammate. Per-recipient style profiles handle this naturally.

Dependencies:
  - EmailMemoryStore (for searching sent emails)
  - Gemini 2.0 Flash (for draft generation)
"""

from __future__ import annotations

import asyncio
import json
import re
import time
from dataclasses import dataclass, field
from typing import Optional, TYPE_CHECKING

import google.genai as genai
from google.genai import types as genai_types

if TYPE_CHECKING:
    from agents.email_memory import EmailMemoryStore, SearchResult


# ─────────────────────────────────────────────────────────────────────────────
# Constants
# ─────────────────────────────────────────────────────────────────────────────

DRAFT_MODEL = "gemini-2.0-flash"
FALLBACK_MODEL = "gemini-2.5-flash"

# Style analysis
MIN_EMAILS_FOR_STYLE = 2     # Need at least 2 sent emails for style analysis
MAX_STYLE_EXAMPLES = 5       # Max examples to include in few-shot prompt
MAX_EXAMPLE_LENGTH = 600     # Truncate each example to this many chars


# ─────────────────────────────────────────────────────────────────────────────
# Data Models
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class StyleFingerprint:
    """
    A writing style profile extracted from sent emails.

    Captures: formality level, average length, greeting/closing patterns,
    common phrases, emoji usage, sentence structure.
    """
    recipient_email: str
    sample_count: int = 0     # How many emails analyzed
    avg_length_words: int = 0
    avg_sentence_length: float = 0.0
    formality: str = "neutral"  # formal / neutral / casual
    greeting_patterns: list[str] = field(default_factory=list)
    closing_patterns: list[str] = field(default_factory=list)
    uses_emoji: bool = False
    uses_exclamation: bool = False
    common_phrases: list[str] = field(default_factory=list)
    tone: str = "professional"  # professional / friendly / direct / warm
    analyzed_at: float = field(default_factory=time.time)

    def to_dict(self) -> dict:
        return {
            "recipient_email": self.recipient_email,
            "sample_count": self.sample_count,
            "avg_length_words": self.avg_length_words,
            "avg_sentence_length": round(self.avg_sentence_length, 1),
            "formality": self.formality,
            "greeting_patterns": self.greeting_patterns,
            "closing_patterns": self.closing_patterns,
            "uses_emoji": self.uses_emoji,
            "uses_exclamation": self.uses_exclamation,
            "common_phrases": self.common_phrases,
            "tone": self.tone,
        }

    def to_prompt_text(self) -> str:
        """Convert to human-readable style description for prompting."""
        parts = [
            f"Formality: {self.formality}",
            f"Tone: {self.tone}",
            f"Average email length: ~{self.avg_length_words} words",
            f"Average sentence length: ~{self.avg_sentence_length:.0f} words",
        ]
        if self.greeting_patterns:
            parts.append(f"Typical greetings: {', '.join(self.greeting_patterns[:3])}")
        if self.closing_patterns:
            parts.append(f"Typical closings: {', '.join(self.closing_patterns[:3])}")
        if self.uses_emoji:
            parts.append("Uses emojis occasionally")
        if self.uses_exclamation:
            parts.append("Uses exclamation marks for enthusiasm")
        if self.common_phrases:
            parts.append(f"Common phrases: {', '.join(self.common_phrases[:5])}")
        return "\n".join(parts)


@dataclass
class DraftResult:
    """The output of the draft generation pipeline."""
    draft_text: str
    style_fingerprint: Optional[StyleFingerprint] = None
    examples_used: int = 0
    model_used: str = ""
    generation_time_ms: int = 0
    confidence: float = 0.0   # 0-1, based on style match quality

    def to_dict(self) -> dict:
        return {
            "draft": self.draft_text,
            "style": self.style_fingerprint.to_dict() if self.style_fingerprint else None,
            "examples_used": self.examples_used,
            "model_used": self.model_used,
            "generation_time_ms": self.generation_time_ms,
            "confidence": round(self.confidence, 2),
        }


# ─────────────────────────────────────────────────────────────────────────────
# Style Analyzer — extracts writing patterns from sent emails
# ─────────────────────────────────────────────────────────────────────────────

class StyleAnalyzer:
    """
    Analyzes the founder's writing style from their sent emails.

    Extracts: formality, length, greetings, closings, emoji use,
    sentence structure, and common phrases.
    """

    # Greeting patterns to detect
    GREETING_PATTERNS = [
        (r"^hey\b", "Hey"),
        (r"^hi\b", "Hi"),
        (r"^hello\b", "Hello"),
        (r"^dear\b", "Dear"),
        (r"^good (morning|afternoon|evening)", "Good [time]"),
        (r"^thanks for", "Thanks for..."),
        (r"^hope (you're|this|all)", "Hope you're..."),
    ]

    # Closing patterns to detect
    CLOSING_PATTERNS = [
        (r"(best|best regards),?\s*$", "Best"),
        (r"(thanks|thank you),?\s*$", "Thanks"),
        (r"(cheers),?\s*$", "Cheers"),
        (r"(regards),?\s*$", "Regards"),
        (r"(talk soon),?\s*$", "Talk soon"),
        (r"(sent from|get outlook)", "[mobile signature]"),
        (r"(let me know|lmk)\s*[.!]?\s*$", "Let me know"),
    ]

    @staticmethod
    def analyze(sent_emails: list[dict]) -> StyleFingerprint:
        """
        Analyze a list of sent email bodies to extract style fingerprint.

        Args:
            sent_emails: List of dicts with at least "body" and "recipient_email" keys.
                         Can also have "chunk_text" from EmailMemoryStore results.

        Returns:
            StyleFingerprint with extracted patterns.
        """
        if not sent_emails:
            return StyleFingerprint(recipient_email="unknown")

        recipient = sent_emails[0].get("recipient_email", sent_emails[0].get("sender_email", "unknown"))
        bodies = []
        for email in sent_emails:
            body = email.get("body", "") or email.get("chunk_text", "")
            if body:
                bodies.append(body)

        if not bodies:
            return StyleFingerprint(recipient_email=recipient)

        # Analyze each body
        total_words = 0
        total_sentences = 0
        total_sentence_words = 0
        greetings_found: dict[str, int] = {}
        closings_found: dict[str, int] = {}
        emoji_count = 0
        exclamation_count = 0

        for body in bodies:
            # Clean body
            clean = body.strip()
            lines = clean.split("\n")

            # Word count
            words = clean.split()
            total_words += len(words)

            # Sentence analysis
            sentences = re.split(r"[.!?]+", clean)
            sentences = [s.strip() for s in sentences if s.strip()]
            total_sentences += len(sentences)
            for s in sentences:
                total_sentence_words += len(s.split())

            # Greeting detection (first 3 lines)
            first_lines = "\n".join(lines[:3]).lower()
            for pattern, label in StyleAnalyzer.GREETING_PATTERNS:
                if re.search(pattern, first_lines, re.MULTILINE):
                    greetings_found[label] = greetings_found.get(label, 0) + 1

            # Closing detection (last 5 lines)
            last_lines = "\n".join(lines[-5:]).lower()
            for pattern, label in StyleAnalyzer.CLOSING_PATTERNS:
                if re.search(pattern, last_lines, re.MULTILINE):
                    closings_found[label] = closings_found.get(label, 0) + 1

            # Emoji detection
            emoji_pattern = re.compile(
                "[\U0001F600-\U0001F64F\U0001F300-\U0001F5FF\U0001F680-\U0001F6FF"
                "\U0001F1E0-\U0001F1FF\U00002700-\U000027BF\U0001F900-\U0001F9FF]+",
                flags=re.UNICODE,
            )
            emoji_count += len(emoji_pattern.findall(clean))

            # Exclamation marks
            exclamation_count += clean.count("!")

        n = len(bodies)
        avg_words = total_words // n if n else 0
        avg_sentence_len = total_sentence_words / max(total_sentences, 1)

        # Determine formality
        formality = "neutral"
        top_greetings = sorted(greetings_found.keys())
        if any(g in ("Dear", "Hello") for g in top_greetings):
            formality = "formal"
        elif any(g in ("Hey",) for g in top_greetings):
            formality = "casual"

        # Determine tone
        tone = "professional"
        if emoji_count / max(n, 1) > 0.5:
            tone = "friendly"
        elif avg_words < 50:
            tone = "direct"
        elif exclamation_count / max(n, 1) > 1:
            tone = "warm"

        return StyleFingerprint(
            recipient_email=recipient,
            sample_count=n,
            avg_length_words=avg_words,
            avg_sentence_length=avg_sentence_len,
            formality=formality,
            greeting_patterns=sorted(greetings_found, key=greetings_found.get, reverse=True)[:3],
            closing_patterns=sorted(closings_found, key=closings_found.get, reverse=True)[:3],
            uses_emoji=emoji_count > 0,
            uses_exclamation=exclamation_count / max(n, 1) > 0.5,
            tone=tone,
        )


# ─────────────────────────────────────────────────────────────────────────────
# Voice-Matched Draft Engine — the core generator
# ─────────────────────────────────────────────────────────────────────────────

class VoiceMatchedDraftEngine:
    """
    Generates email drafts that match the founder's writing voice.

    Pipeline:
      1. Find similar past sent emails to this recipient
      2. Extract style fingerprint from those examples
      3. Build few-shot prompt with style + examples + context
      4. Generate voice-matched draft with Gemini

    Usage:
        engine = VoiceMatchedDraftEngine(
            email_memory=email_memory_store,
            api_key="...",
        )
        result = await engine.generate_draft(
            recipient_email="sarah@sequoia.com",
            recipient_name="Sarah",
            thread_subject="Re: Series A Follow-up",
            thread_body="Hi, wanted to follow up on our discussion...",
            instruction="Accept the meeting and suggest next Tuesday",
        )
    """

    def __init__(
        self,
        email_memory: "EmailMemoryStore",
        api_key: str,
        founder_name: str = "",
        founder_context: str = "",
    ):
        self._memory = email_memory
        self._client = genai.Client(api_key=api_key)
        self._founder_name = founder_name
        self._founder_context = founder_context

        # Style cache: recipient_email → (fingerprint, timestamp)
        self._style_cache: dict[str, tuple[StyleFingerprint, float]] = {}
        self._cache_ttl = 3600  # 1 hour cache

    async def generate_draft(
        self,
        recipient_email: str,
        recipient_name: str = "",
        thread_subject: str = "",
        thread_body: str = "",
        instruction: str = "",
        include_greeting: bool = True,
        include_closing: bool = True,
    ) -> DraftResult:
        """
        Generate a voice-matched email draft.

        Args:
            recipient_email: Who we're replying to
            recipient_name: Their display name
            thread_subject: Email thread subject
            thread_body: The email we're replying to (or thread context)
            instruction: What the founder wants to say/do
            include_greeting: Whether to include greeting line
            include_closing: Whether to include sign-off

        Returns:
            DraftResult with the generated draft and metadata
        """
        start = time.time()

        # Step 1: Get past sent emails to this recipient
        past_examples = await self._get_style_examples(recipient_email)

        # Step 2: Extract style fingerprint
        style = self._get_cached_style(recipient_email)
        if not style and past_examples:
            example_dicts = [
                {"body": ex.chunk_text, "recipient_email": recipient_email}
                for ex in past_examples
            ]
            style = StyleAnalyzer.analyze(example_dicts)
            self._cache_style(recipient_email, style)

        # Step 3: Build the prompt
        prompt = self._build_draft_prompt(
            style=style,
            examples=past_examples,
            recipient_email=recipient_email,
            recipient_name=recipient_name,
            thread_subject=thread_subject,
            thread_body=thread_body,
            instruction=instruction,
            include_greeting=include_greeting,
            include_closing=include_closing,
        )

        # Step 4: Generate draft
        draft_text = ""
        model_used = ""

        for model in [DRAFT_MODEL, FALLBACK_MODEL]:
            try:
                response = await asyncio.to_thread(
                    self._client.models.generate_content,
                    model=model,
                    contents=prompt,
                    config=genai_types.GenerateContentConfig(
                        temperature=0.4,  # Slightly creative but consistent
                        max_output_tokens=2048,
                    ),
                )
                draft_text = (response.text or "").strip()
                model_used = model

                # Clean up: remove markdown code blocks if present
                draft_text = re.sub(r"^```(?:\w+)?\s*|\s*```$", "", draft_text).strip()
                break

            except Exception as e:
                print(f"[VoiceDraft] Draft generation failed ({model}): {e}")
                if "429" in str(e) or "RESOURCE_EXHAUSTED" in str(e):
                    await asyncio.sleep(3)
                continue

        if not draft_text:
            draft_text = self._fallback_draft(
                recipient_name=recipient_name,
                thread_subject=thread_subject,
                instruction=instruction,
            )
            model_used = "fallback"

        elapsed_ms = int((time.time() - start) * 1000)

        # Confidence based on style data quality
        confidence = 0.3  # Base confidence (no style data)
        if style and style.sample_count >= MIN_EMAILS_FOR_STYLE:
            confidence = min(0.95, 0.5 + (style.sample_count * 0.05))

        return DraftResult(
            draft_text=draft_text,
            style_fingerprint=style,
            examples_used=len(past_examples),
            model_used=model_used,
            generation_time_ms=elapsed_ms,
            confidence=confidence,
        )

    async def get_style_profile(self, recipient_email: str) -> dict:
        """
        Get the style profile for a specific recipient.
        Useful for the frontend to show "writing style: casual, ~80 words".
        """
        style = self._get_cached_style(recipient_email)
        if style:
            return style.to_dict()

        # Fetch and analyze
        examples = await self._get_style_examples(recipient_email)
        if not examples:
            return {"recipient_email": recipient_email, "sample_count": 0, "message": "No sent emails found for this recipient"}

        example_dicts = [
            {"body": ex.chunk_text, "recipient_email": recipient_email}
            for ex in examples
        ]
        style = StyleAnalyzer.analyze(example_dicts)
        self._cache_style(recipient_email, style)
        return style.to_dict()

    # ── Internal Methods ───────────────────────────────────────────────────

    async def _get_style_examples(
        self,
        recipient_email: str,
    ) -> list["SearchResult"]:
        """Get past sent emails to this recipient for style analysis."""
        try:
            results = await self._memory.search_sent_to_recipient(
                recipient_email=recipient_email,
                top_k=MAX_STYLE_EXAMPLES,
            )
            return results
        except Exception as e:
            print(f"[VoiceDraft] Failed to fetch style examples: {e}")
            return []

    def _get_cached_style(self, recipient_email: str) -> Optional[StyleFingerprint]:
        """Get cached style fingerprint if still valid."""
        if recipient_email in self._style_cache:
            style, cached_at = self._style_cache[recipient_email]
            if time.time() - cached_at < self._cache_ttl:
                return style
        return None

    def _cache_style(self, recipient_email: str, style: StyleFingerprint) -> None:
        """Cache a style fingerprint."""
        self._style_cache[recipient_email] = (style, time.time())

    def _build_draft_prompt(
        self,
        style: Optional[StyleFingerprint],
        examples: list,
        recipient_email: str,
        recipient_name: str,
        thread_subject: str,
        thread_body: str,
        instruction: str,
        include_greeting: bool,
        include_closing: bool,
    ) -> str:
        """Build the complete few-shot draft generation prompt."""

        # Style section
        style_section = ""
        if style and style.sample_count >= MIN_EMAILS_FOR_STYLE:
            style_section = f"""
FOUNDER'S WRITING STYLE (for emails to {recipient_name or recipient_email}):
{style.to_prompt_text()}
"""
        else:
            style_section = """
WRITING STYLE: Professional but warm. Keep it concise and natural.
"""

        # Few-shot examples section
        examples_section = ""
        if examples:
            examples_section = "\nEXAMPLES OF HOW THE FOUNDER WRITES TO THIS PERSON:\n"
            for i, ex in enumerate(examples[:MAX_STYLE_EXAMPLES]):
                body = ex.chunk_text[:MAX_EXAMPLE_LENGTH]
                examples_section += f"\n--- Example {i + 1} (Re: {ex.subject}) ---\n{body}\n"

        # Founder context
        founder_section = ""
        if self._founder_name:
            founder_section = f"You are drafting an email on behalf of {self._founder_name}."
        if self._founder_context:
            founder_section += f"\n{self._founder_context}"

        prompt = f"""You are an AI email draft generator. Generate an email reply that perfectly
matches the founder's writing voice and style.

{founder_section}
{style_section}
{examples_section}

CURRENT EMAIL THREAD:
Subject: {thread_subject}
From: {recipient_name} ({recipient_email})
Body:
{thread_body[:2000]}

FOUNDER'S INSTRUCTION: {instruction or "Reply appropriately"}

RULES:
- Match the founder's exact writing style from the examples above
- Keep the same formality level, sentence length, and tone
- Use similar greetings and closings as shown in examples
- {"Include a greeting line" if include_greeting else "Skip the greeting — jump straight to content"}
- {"Include a sign-off/closing" if include_closing else "Skip the closing/sign-off"}
- Be concise — match the founder's typical email length (~{style.avg_length_words if style else 80} words)
- Sound human, not like AI — avoid phrases like "I hope this email finds you well"
- Address the specific content of the email being replied to
- If the instruction is vague, use professional judgment
- Do NOT include the subject line — just the email body
- Output ONLY the email text, nothing else"""

        return prompt

    @staticmethod
    def _fallback_draft(
        recipient_name: str,
        thread_subject: str,
        instruction: str,
    ) -> str:
        """Generate a basic draft when AI generation fails."""
        greeting = f"Hi {recipient_name}," if recipient_name else "Hi,"
        body = instruction if instruction else f"Thanks for your email about {thread_subject}."
        return f"{greeting}\n\n{body}\n\nBest"


# ─────────────────────────────────────────────────────────────────────────────
# Split Inbox Engine — auto-categorization into splits
# ─────────────────────────────────────────────────────────────────────────────

class SplitInboxEngine:
    """
    Categorizes scored emails into split inbox tabs.

    Split tabs:
      - action_required: Emails needing founder response
      - vip: Tier 1 + Tier 2 contacts
      - team: Internal domain emails
      - updates: Notifications, calendar, automated
      - newsletters: Newsletter + marketing category
      - done: Completed/archived emails

    Two-layer approach (same as scoring):
      1. Rules-based splits (~80%): Contact tiers, domains, categories
      2. Gemini classification (~20%): Ambiguous emails
      3. Auto-learning: Track manual moves, apply after 3 consistent moves

    The split is determined AFTER scoring, so we have full context.
    """

    # Split definitions
    SPLITS = [
        "action_required",
        "vip",
        "team",
        "updates",
        "newsletters",
        "done",
        "other",
    ]

    def __init__(self, founder_domain: str = ""):
        self._founder_domain = founder_domain.lower()
        # Manual move tracking: {message_id: split_name}
        self._manual_moves: dict[str, str] = {}
        # Learned rules: {sender_email: (split_name, confidence_count)}
        self._learned_splits: dict[str, tuple[str, int]] = {}
        self._learn_threshold = 3  # Auto-apply after 3 consistent moves

    def categorize_email(self, scored_email: dict) -> str:
        """
        Determine which split an email belongs to.

        Args:
            scored_email: A scored email dict (from ScoredEmail.to_firestore())

        Returns:
            Split name (one of SPLITS)
        """
        sender_email = scored_email.get("sender_email", "").lower()
        pipeline_stage = scored_email.get("pipeline_stage", "")
        priority = scored_email.get("priority", "")
        category = scored_email.get("category", "")
        score = scored_email.get("score", 0)

        # Check learned rules first
        if sender_email in self._learned_splits:
            learned_split, count = self._learned_splits[sender_email]
            if count >= self._learn_threshold:
                return learned_split

        # Rule 1: Done/archived emails
        if pipeline_stage in ("done", "archived", "replied"):
            return "done"

        # Rule 2: Action required (by pipeline stage or priority)
        if pipeline_stage == "action_required" or priority in ("critical", "urgent"):
            return "action_required"

        # Rule 3: Newsletter/marketing categories
        if category in ("newsletter", "marketing", "notification"):
            return "newsletters" if category != "notification" else "updates"

        # Rule 4: Calendar/notification categories
        if category in ("calendar",):
            return "updates"

        # Rule 5: VIP contacts (score >= 6 from contact tier)
        breakdown = scored_email.get("scoring_breakdown", {})
        contact_tier = breakdown.get("contact_tier", {}).get("score", 0) if isinstance(breakdown, dict) else 0
        if contact_tier >= 6:  # Tier 1 or Tier 2
            return "vip"

        # Rule 6: Internal team emails
        if self._founder_domain and sender_email.endswith(f"@{self._founder_domain}"):
            return "team"

        # Rule 7: High-score emails that aren't already categorized
        if score >= 5:
            return "vip"

        # Default
        return "other"

    def categorize_batch(self, scored_emails: list[dict]) -> dict[str, list[dict]]:
        """
        Categorize a batch of emails into splits.

        Returns:
            {split_name: [list of scored email dicts]}
        """
        splits: dict[str, list[dict]] = {s: [] for s in self.SPLITS}

        for email in scored_emails:
            split = self.categorize_email(email)
            email["split"] = split  # Annotate the email with its split
            splits[split].append(email)

        return splits

    def record_manual_move(self, message_id: str, sender_email: str, target_split: str) -> None:
        """
        Record a manual move (founder dragged email to different split).
        After 3 consistent moves from same sender, auto-learn the rule.
        """
        self._manual_moves[message_id] = target_split

        if sender_email:
            sender_lower = sender_email.lower()
            if sender_lower in self._learned_splits:
                current_split, count = self._learned_splits[sender_lower]
                if current_split == target_split:
                    self._learned_splits[sender_lower] = (target_split, count + 1)
                else:
                    # Reset if they moved to a different split
                    self._learned_splits[sender_lower] = (target_split, 1)
            else:
                self._learned_splits[sender_lower] = (target_split, 1)

    def get_learned_rules(self) -> dict:
        """Get all learned split rules."""
        return {
            email: {"split": split, "confidence": count, "auto_applied": count >= self._learn_threshold}
            for email, (split, count) in self._learned_splits.items()
        }

    def set_founder_domain(self, domain: str) -> None:
        """Set the founder's email domain for team detection."""
        self._founder_domain = domain.lower()
