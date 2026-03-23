"""
Astra OS — RAG Email Memory System
====================================
Production-grade semantic email search and memory engine.

Turns Astra from a scoring engine into a knowledge engine that
understands the founder's entire email history.

Architecture:
  - Embedding: Gemini text-embedding-004 (768d, free tier 1500 RPM)
  - Vector DB: Firestore Vector Search (zero new infra)
  - Chunking: Email-aware splitting (subject + sender + body, ~400 tokens)
  - Hybrid Search: Firestore vector KNN + metadata filtering
  - Re-ranking: Gemini Flash for relevance scoring on top-K results

Pipeline:
  1. Initial Sync: Embed last N months of emails on first auth
  2. Incremental Sync: Embed new emails each scan cycle
  3. Sent Email Indexing: Separate index for voice-matched drafting
  4. Semantic Search: Query → embed → KNN → re-rank → generate answer

Collections:
  email_embeddings/{message_id}  — embedded inbox emails
  sent_embeddings/{message_id}   — embedded sent emails (for style matching)
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import re
import time
from dataclasses import dataclass, field
from typing import Optional, TYPE_CHECKING

import google.genai as genai
from google.genai import types as genai_types

if TYPE_CHECKING:
    from brain.store import CompanyBrainStore
    from brain.embeddings import EmbeddingPipeline
    from brain.models import EmailMessage

from google.cloud.firestore_v1.vector import Vector
from google.cloud.firestore_v1.base_vector_query import DistanceMeasure


# ─────────────────────────────────────────────────────────────────────────────
# Constants
# ─────────────────────────────────────────────────────────────────────────────

EMBEDDING_MODEL = "text-embedding-004"
EMBEDDING_DIMS = 768
RERANK_MODEL = "gemini-2.0-flash"

COL_EMAIL_EMBEDDINGS = "email_embeddings"
COL_SENT_EMBEDDINGS = "sent_embeddings"
COL_EMBED_STATE = "email_embed_state"

# Chunking config
MAX_CHUNK_TOKENS = 400       # ~400 tokens per chunk
MAX_BODY_CHARS = 3000        # Truncate body to this for embedding
BATCH_SIZE = 20              # Concurrent embeddings per batch (1500 RPM / 20 = 75 batches/min safe)
RATE_LIMIT_DELAY = 0.02      # 20ms between batches — aggressive but within 1500 RPM


# ─────────────────────────────────────────────────────────────────────────────
# Data Models
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class EmailEmbeddingDoc:
    """A single email's embedding record stored in Firestore."""
    message_id: str
    thread_id: str
    sender: str
    sender_email: str
    subject: str
    snippet: str              # First ~200 chars of body
    date: str
    timestamp: float
    embedding: list[float] = field(default_factory=list)
    chunk_text: str = ""      # The text that was embedded
    is_sent: bool = False     # True if this is a sent email
    recipient_email: str = "" # For sent emails: who was this sent to
    embedded_at: float = field(default_factory=time.time)

    def to_firestore(self) -> dict:
        data = {
            "message_id": self.message_id,
            "thread_id": self.thread_id,
            "sender": self.sender,
            "sender_email": self.sender_email,
            "subject": self.subject,
            "snippet": self.snippet,
            "date": self.date,
            "timestamp": self.timestamp,
            "chunk_text": self.chunk_text,
            "is_sent": self.is_sent,
            "recipient_email": self.recipient_email,
            "embedded_at": self.embedded_at,
        }
        if self.embedding and any(v != 0.0 for v in self.embedding):
            data["embedding"] = Vector(self.embedding)
        return data

    @classmethod
    def from_firestore(cls, data: dict) -> "EmailEmbeddingDoc":
        embedding = data.get("embedding", [])
        if hasattr(embedding, "value"):
            embedding = list(embedding.value)
        elif isinstance(embedding, (list, tuple)):
            embedding = list(embedding)
        else:
            embedding = []

        return cls(
            message_id=data.get("message_id", ""),
            thread_id=data.get("thread_id", ""),
            sender=data.get("sender", ""),
            sender_email=data.get("sender_email", ""),
            subject=data.get("subject", ""),
            snippet=data.get("snippet", ""),
            date=data.get("date", ""),
            timestamp=data.get("timestamp", 0),
            embedding=embedding,
            chunk_text=data.get("chunk_text", ""),
            is_sent=data.get("is_sent", False),
            recipient_email=data.get("recipient_email", ""),
            embedded_at=data.get("embedded_at", 0),
        )


@dataclass
class SearchResult:
    """A single search result with relevance score."""
    message_id: str
    thread_id: str
    sender: str
    sender_email: str
    subject: str
    snippet: str
    date: str
    timestamp: float
    chunk_text: str
    distance: float = 0.0     # Vector distance (lower = more similar)
    rerank_score: float = 0.0 # Gemini re-rank score (higher = more relevant)
    is_sent: bool = False

    def to_dict(self) -> dict:
        return {
            "message_id": self.message_id,
            "thread_id": self.thread_id,
            "sender": self.sender,
            "sender_email": self.sender_email,
            "subject": self.subject,
            "snippet": self.snippet,
            "date": self.date,
            "chunk_text": self.chunk_text,
            "distance": round(self.distance, 4),
            "relevance_score": round(self.rerank_score, 2),
            "is_sent": self.is_sent,
        }


# ─────────────────────────────────────────────────────────────────────────────
# Email Chunker — email-aware text preparation for embedding
# ─────────────────────────────────────────────────────────────────────────────

class EmailChunker:
    """
    Prepares email text for embedding.

    Strategy: Combine subject + sender context + body into a single
    semantically rich chunk. This outperforms naive body-only embedding
    because subject lines carry high information density.

    Format:
      "From: {sender} ({email})
       Subject: {subject}
       {body_truncated}"
    """

    @staticmethod
    def chunk_email(
        sender: str,
        sender_email: str,
        subject: str,
        body: str,
        max_chars: int = MAX_BODY_CHARS,
    ) -> str:
        """Create an embedding-ready chunk from email fields."""
        # Clean body: strip signatures, quoted text, excessive whitespace
        clean_body = EmailChunker._clean_body(body)

        # Truncate body to fit token budget
        if len(clean_body) > max_chars:
            clean_body = clean_body[:max_chars] + "..."

        # Compose the chunk with structured context
        chunk = f"From: {sender} ({sender_email})\nSubject: {subject}\n{clean_body}"
        return chunk.strip()

    @staticmethod
    def chunk_sent_email(
        recipient: str,
        recipient_email: str,
        subject: str,
        body: str,
        max_chars: int = MAX_BODY_CHARS,
    ) -> str:
        """Create an embedding-ready chunk for a sent email (for style matching)."""
        clean_body = EmailChunker._clean_body(body)
        if len(clean_body) > max_chars:
            clean_body = clean_body[:max_chars] + "..."

        chunk = f"To: {recipient} ({recipient_email})\nSubject: {subject}\n{clean_body}"
        return chunk.strip()

    @staticmethod
    def _clean_body(body: str) -> str:
        """Remove noise from email body: signatures, quoted text, HTML artifacts."""
        if not body:
            return ""

        text = body

        # Remove common signature separators and everything after
        sig_patterns = [
            r"\n--\s*\n.*",           # "-- " signature separator
            r"\nSent from my .*",     # Mobile signatures
            r"\nGet Outlook for .*",  # Outlook mobile
            r"\n_{3,}.*",             # "___" separator
        ]
        for pattern in sig_patterns:
            text = re.sub(pattern, "", text, flags=re.DOTALL)

        # Remove quoted replies (lines starting with >)
        lines = text.split("\n")
        clean_lines = []
        for line in lines:
            if line.strip().startswith(">"):
                continue
            # Stop at "On ... wrote:" patterns (quoted reply header)
            if re.match(r"^On .+ wrote:$", line.strip()):
                break
            clean_lines.append(line)

        text = "\n".join(clean_lines)

        # Collapse multiple newlines/spaces
        text = re.sub(r"\n{3,}", "\n\n", text)
        text = re.sub(r"  +", " ", text)

        return text.strip()


# ─────────────────────────────────────────────────────────────────────────────
# Email Memory Store — embedding + storage + retrieval
# ─────────────────────────────────────────────────────────────────────────────

class EmailMemoryStore:
    """
    Core RAG memory for email history.

    Handles:
      1. Embedding emails with Gemini text-embedding-004
      2. Storing vectors in Firestore with metadata
      3. Semantic search via Firestore vector KNN
      4. Re-ranking results with Gemini Flash
      5. Answer generation from retrieved context
    """

    def __init__(
        self,
        store: "CompanyBrainStore",
        embeddings: "EmbeddingPipeline",
        api_key: str,
        founder_id: str,
    ):
        self._store = store
        self._embeddings = embeddings
        self._api_key = api_key
        self._founder_id = founder_id
        self._client = genai.Client(api_key=api_key)
        self._chunker = EmailChunker()

        # Stats
        self._total_embedded = 0
        self._total_sent_embedded = 0
        self._last_sync_time: float = 0

    # ── Embedding Pipeline ─────────────────────────────────────────────────

    async def embed_emails(
        self,
        emails: list[dict],
        is_sent: bool = False,
    ) -> int:
        """
        Embed a batch of emails and store in Firestore.

        Args:
            emails: List of email dicts with keys:
                message_id, thread_id, sender, sender_email,
                subject, body, date, timestamp
                For sent emails also: to_email, to_name
            is_sent: Whether these are sent emails (stored separately)

        Returns:
            Number of emails successfully embedded.
        """
        collection_name = COL_SENT_EMBEDDINGS if is_sent else COL_EMAIL_EMBEDDINGS
        db = self._store._db
        embedded_count = 0

        # Filter out already-embedded emails using batch existence check
        # Much faster than checking one-by-one for large mailboxes
        valid_emails = [e for e in emails if e.get("message_id")]
        if not valid_emails:
            return 0

        # Batch check existence (Firestore getAll supports up to 500 docs)
        new_emails = []
        for i in range(0, len(valid_emails), 500):
            batch_check = valid_emails[i:i + 500]
            refs = [db.collection(collection_name).document(e["message_id"]) for e in batch_check]
            docs = await asyncio.to_thread(lambda r=refs: db.get_all(r))
            existing_ids = {d.id for d in docs if d.exists}
            new_emails.extend(e for e in batch_check if e["message_id"] not in existing_ids)

        if not new_emails:
            return 0

        print(f"[EmailMemory] Embedding {len(new_emails)} {'sent' if is_sent else 'inbox'} emails...")

        # Process in batches
        for i in range(0, len(new_emails), BATCH_SIZE):
            batch = new_emails[i:i + BATCH_SIZE]

            # Prepare chunks
            chunks = []
            for email in batch:
                if is_sent:
                    chunk = self._chunker.chunk_sent_email(
                        recipient=email.get("to_name", email.get("to_email", "")),
                        recipient_email=email.get("to_email", ""),
                        subject=email.get("subject", ""),
                        body=email.get("body", ""),
                    )
                else:
                    chunk = self._chunker.chunk_email(
                        sender=email.get("sender", ""),
                        sender_email=email.get("sender_email", ""),
                        subject=email.get("subject", ""),
                        body=email.get("body", ""),
                    )
                chunks.append(chunk)

            # Batch embed
            try:
                vectors = await self._embeddings.embed_batch(chunks)
            except Exception as e:
                print(f"[EmailMemory] Embedding batch failed: {e}")
                continue

            # Store in Firestore
            fb = db.batch()
            for email, chunk, vector in zip(batch, chunks, vectors):
                doc = EmailEmbeddingDoc(
                    message_id=email.get("message_id", ""),
                    thread_id=email.get("thread_id", ""),
                    sender=email.get("sender", ""),
                    sender_email=email.get("sender_email", ""),
                    subject=email.get("subject", ""),
                    snippet=(email.get("body", "") or "")[:200],
                    date=email.get("date", ""),
                    timestamp=email.get("timestamp", 0),
                    embedding=vector,
                    chunk_text=chunk,
                    is_sent=is_sent,
                    recipient_email=email.get("to_email", ""),
                )
                ref = db.collection(collection_name).document(doc.message_id)
                fb.set(ref, doc.to_firestore())

            try:
                await asyncio.to_thread(fb.commit)
                embedded_count += len(batch)
            except Exception as e:
                print(f"[EmailMemory] Firestore batch write failed: {e}")

            # Rate limit safety
            if i + BATCH_SIZE < len(new_emails):
                await asyncio.sleep(RATE_LIMIT_DELAY)

        # Update stats
        if is_sent:
            self._total_sent_embedded += embedded_count
        else:
            self._total_embedded += embedded_count
        self._last_sync_time = time.time()

        print(f"[EmailMemory] Embedded {embedded_count}/{len(new_emails)} emails")
        return embedded_count

    async def get_embed_stats(self) -> dict:
        """Get embedding pipeline statistics."""
        db = self._store._db

        # Count embedded documents
        try:
            inbox_docs = await asyncio.to_thread(
                lambda: len(list(
                    db.collection(COL_EMAIL_EMBEDDINGS).limit(1000).stream()
                ))
            )
            sent_docs = await asyncio.to_thread(
                lambda: len(list(
                    db.collection(COL_SENT_EMBEDDINGS).limit(1000).stream()
                ))
            )
        except Exception:
            inbox_docs = self._total_embedded
            sent_docs = self._total_sent_embedded

        return {
            "inbox_embedded": inbox_docs,
            "sent_embedded": sent_docs,
            "total_embedded": inbox_docs + sent_docs,
            "last_sync": self._last_sync_time,
            "session_inbox_embedded": self._total_embedded,
            "session_sent_embedded": self._total_sent_embedded,
        }

    # ── Semantic Search ────────────────────────────────────────────────────

    async def search(
        self,
        query: str,
        top_k: int = 20,
        rerank_top: int = 5,
        include_sent: bool = False,
        sender_filter: str = "",
        min_timestamp: float = 0,
    ) -> list[SearchResult]:
        """
        Semantic search across email history.

        Pipeline:
          1. Embed query with text-embedding-004
          2. Firestore vector KNN (top_k results)
          3. Re-rank with Gemini Flash (top rerank_top)

        Args:
            query: Natural language search query
            top_k: Number of candidates from vector search
            rerank_top: Number of final results after re-ranking
            include_sent: Also search sent emails
            sender_filter: Filter to specific sender email
            min_timestamp: Only return emails after this timestamp

        Returns:
            List of SearchResult objects, sorted by relevance
        """
        # Step 1: Embed the query
        try:
            query_vector = await self._embeddings.embed_query(query)
        except Exception as e:
            print(f"[EmailMemory] Query embedding failed: {e}")
            return []

        # Step 2: Vector KNN search
        candidates = await self._vector_search(
            query_vector=query_vector,
            collection=COL_EMAIL_EMBEDDINGS,
            top_k=top_k,
            sender_filter=sender_filter,
            min_timestamp=min_timestamp,
        )

        # Optionally search sent emails too
        if include_sent:
            sent_candidates = await self._vector_search(
                query_vector=query_vector,
                collection=COL_SENT_EMBEDDINGS,
                top_k=top_k // 2,
            )
            candidates.extend(sent_candidates)

        if not candidates:
            return []

        # Step 3: Re-rank with Gemini
        reranked = await self._rerank(query, candidates, top_n=rerank_top)
        return reranked

    async def search_sent_to_recipient(
        self,
        recipient_email: str,
        query: str = "",
        top_k: int = 10,
    ) -> list[SearchResult]:
        """
        Search sent emails to a specific recipient.
        Used by the voice-matched draft engine for style extraction.

        If query is provided, does semantic search filtered by recipient.
        If query is empty, returns most recent sent emails to recipient.
        """
        db = self._store._db

        if query:
            # Semantic search filtered by recipient
            try:
                query_vector = await self._embeddings.embed_query(query)
            except Exception:
                return []

            return await self._vector_search(
                query_vector=query_vector,
                collection=COL_SENT_EMBEDDINGS,
                top_k=top_k,
                sender_filter=recipient_email,  # recipient is stored in sender_email for sent
            )
        else:
            # Recency-based search for this recipient
            try:
                docs = await asyncio.to_thread(
                    lambda: list(
                        db.collection(COL_SENT_EMBEDDINGS)
                        .where("recipient_email", "==", recipient_email.lower())
                        .order_by("timestamp", direction="DESCENDING")
                        .limit(top_k)
                        .stream()
                    )
                )
                results = []
                for doc in docs:
                    data = doc.to_dict()
                    emb = EmailEmbeddingDoc.from_firestore(data)
                    results.append(SearchResult(
                        message_id=emb.message_id,
                        thread_id=emb.thread_id,
                        sender=emb.sender,
                        sender_email=emb.sender_email,
                        subject=emb.subject,
                        snippet=emb.snippet,
                        date=emb.date,
                        timestamp=emb.timestamp,
                        chunk_text=emb.chunk_text,
                        is_sent=True,
                    ))
                return results
            except Exception as e:
                print(f"[EmailMemory] Sent search failed: {e}")
                return []

    async def _vector_search(
        self,
        query_vector: list[float],
        collection: str,
        top_k: int = 20,
        sender_filter: str = "",
        min_timestamp: float = 0,
    ) -> list[SearchResult]:
        """Execute Firestore vector KNN search."""
        db = self._store._db

        try:
            col_ref = db.collection(collection)

            # Build query with optional filters
            # Note: Firestore vector search with filters requires composite indexes
            if sender_filter:
                col_ref = col_ref.where("sender_email", "==", sender_filter.lower())
            if min_timestamp > 0:
                col_ref = col_ref.where("timestamp", ">=", min_timestamp)

            docs = await asyncio.to_thread(
                lambda: list(
                    col_ref.find_nearest(
                        vector_field="embedding",
                        query_vector=Vector(query_vector),
                        distance_measure=DistanceMeasure.COSINE,
                        limit=top_k,
                        distance_result_field="vector_distance",
                    ).stream()
                )
            )

            results = []
            for doc in docs:
                data = doc.to_dict()
                distance = data.pop("vector_distance", 1.0)
                emb = EmailEmbeddingDoc.from_firestore(data)

                results.append(SearchResult(
                    message_id=emb.message_id,
                    thread_id=emb.thread_id,
                    sender=emb.sender,
                    sender_email=emb.sender_email,
                    subject=emb.subject,
                    snippet=emb.snippet,
                    date=emb.date,
                    timestamp=emb.timestamp,
                    chunk_text=emb.chunk_text,
                    distance=float(distance),
                    is_sent=emb.is_sent,
                ))

            return results

        except Exception as e:
            print(f"[EmailMemory] Vector search failed on {collection}: {e}")
            # Fallback: recency query
            try:
                docs = await asyncio.to_thread(
                    lambda: list(
                        db.collection(collection)
                        .order_by("timestamp", direction="DESCENDING")
                        .limit(top_k)
                        .stream()
                    )
                )
                return [
                    SearchResult(
                        message_id=d.to_dict().get("message_id", ""),
                        thread_id=d.to_dict().get("thread_id", ""),
                        sender=d.to_dict().get("sender", ""),
                        sender_email=d.to_dict().get("sender_email", ""),
                        subject=d.to_dict().get("subject", ""),
                        snippet=d.to_dict().get("snippet", ""),
                        date=d.to_dict().get("date", ""),
                        timestamp=d.to_dict().get("timestamp", 0),
                        chunk_text=d.to_dict().get("chunk_text", ""),
                        distance=1.0,
                        is_sent=d.to_dict().get("is_sent", False),
                    )
                    for d in docs
                ]
            except Exception as e2:
                print(f"[EmailMemory] Fallback search also failed: {e2}")
                return []

    # ── Re-ranking with Gemini ─────────────────────────────────────────────

    async def _rerank(
        self,
        query: str,
        candidates: list[SearchResult],
        top_n: int = 5,
    ) -> list[SearchResult]:
        """
        Re-rank search candidates using Gemini Flash.

        Sends the query + candidate chunks to Gemini and asks it to
        score relevance 0-10 for each. This dramatically improves
        precision over raw vector distance alone.
        """
        if len(candidates) <= top_n:
            # Not enough candidates to warrant re-ranking
            candidates.sort(key=lambda c: c.distance)
            return candidates

        # Build re-ranking prompt
        candidate_text = ""
        for i, c in enumerate(candidates):
            candidate_text += f"\n[{i}] From: {c.sender} ({c.sender_email})\n"
            candidate_text += f"    Subject: {c.subject}\n"
            candidate_text += f"    Date: {c.date}\n"
            candidate_text += f"    Content: {c.chunk_text[:300]}\n"

        prompt = f"""You are a relevance scoring engine. Given a search query and email candidates,
score each candidate's relevance to the query from 0 (irrelevant) to 10 (perfect match).

QUERY: "{query}"

CANDIDATES:{candidate_text}

Return a JSON array of objects with "index" and "score" fields, sorted by score descending.
Only include the top {top_n} most relevant results.
Return ONLY valid JSON, no explanation.

Example: [{{"index": 2, "score": 9}}, {{"index": 0, "score": 7}}]"""

        try:
            response = await asyncio.to_thread(
                self._client.models.generate_content,
                model=RERANK_MODEL,
                contents=prompt,
                config=genai_types.GenerateContentConfig(
                    temperature=0.0,
                    max_output_tokens=1024,
                ),
            )
            raw = (response.text or "").strip()
            raw = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw).strip()
            rankings = json.loads(raw)

            # Apply scores and sort
            scored = []
            for rank in rankings[:top_n]:
                idx = rank.get("index", 0)
                score = rank.get("score", 0)
                if 0 <= idx < len(candidates):
                    candidates[idx].rerank_score = float(score)
                    scored.append(candidates[idx])

            scored.sort(key=lambda c: c.rerank_score, reverse=True)
            return scored

        except Exception as e:
            print(f"[EmailMemory] Re-ranking failed: {e}")
            # Fallback: return by distance
            candidates.sort(key=lambda c: c.distance)
            return candidates[:top_n]

    # ── Answer Generation ──────────────────────────────────────────────────

    async def generate_answer(
        self,
        query: str,
        results: list[SearchResult],
        founder_context: str = "",
    ) -> dict:
        """
        Generate a natural language answer from search results.

        Returns:
            {
                "answer": "Natural language answer with context",
                "sources": [{"subject", "sender", "date", "message_id"}],
                "confidence": 0.0-1.0
            }
        """
        if not results:
            return {
                "answer": "I couldn't find any relevant emails matching your query.",
                "sources": [],
                "confidence": 0.0,
            }

        # Build context from results
        context = ""
        sources = []
        for i, r in enumerate(results):
            context += f"\n--- Email {i + 1} ---\n"
            context += f"From: {r.sender} ({r.sender_email})\n"
            context += f"Subject: {r.subject}\n"
            context += f"Date: {r.date}\n"
            context += f"Content:\n{r.chunk_text}\n"
            sources.append({
                "subject": r.subject,
                "sender": r.sender,
                "sender_email": r.sender_email,
                "date": r.date,
                "message_id": r.message_id,
            })

        prompt = f"""You are Astra, an AI Chief of Staff helping a startup founder.
{f"Founder context: {founder_context}" if founder_context else ""}

Based on the following emails from the founder's inbox, answer their question.
Be specific, cite which email you're referencing, and be concise.

QUESTION: "{query}"

EMAIL CONTEXT:{context}

Rules:
- Answer directly and concisely
- Reference specific emails by sender name and subject when relevant
- If the answer isn't clearly in the emails, say so honestly
- Use the founder's perspective (you're their assistant)
- Keep it under 3 paragraphs"""

        try:
            response = await asyncio.to_thread(
                self._client.models.generate_content,
                model=RERANK_MODEL,
                contents=prompt,
                config=genai_types.GenerateContentConfig(
                    temperature=0.3,
                    max_output_tokens=2048,
                ),
            )
            answer = (response.text or "").strip()

            # Estimate confidence from re-rank scores
            if results:
                avg_score = sum(r.rerank_score for r in results) / len(results)
                confidence = min(1.0, avg_score / 10.0)
            else:
                confidence = 0.3

            return {
                "answer": answer,
                "sources": sources,
                "confidence": round(confidence, 2),
            }

        except Exception as e:
            print(f"[EmailMemory] Answer generation failed: {e}")
            return {
                "answer": f"I found {len(results)} relevant emails but couldn't generate a summary. "
                          f"Top result: \"{results[0].subject}\" from {results[0].sender}.",
                "sources": sources,
                "confidence": 0.2,
            }

    # ── Full Search Pipeline ───────────────────────────────────────────────

    async def search_and_answer(
        self,
        query: str,
        top_k: int = 20,
        rerank_top: int = 5,
        include_sent: bool = True,
        founder_context: str = "",
    ) -> dict:
        """
        Complete search pipeline: query → embed → search → rerank → answer.

        This is the main entry point for natural language email search.

        Returns:
            {
                "query": str,
                "answer": str,
                "sources": list[dict],
                "results": list[dict],  # Raw search results
                "confidence": float,
                "search_time_ms": int,
            }
        """
        start = time.time()

        # Search
        results = await self.search(
            query=query,
            top_k=top_k,
            rerank_top=rerank_top,
            include_sent=include_sent,
        )

        # Generate answer
        answer_data = await self.generate_answer(
            query=query,
            results=results,
            founder_context=founder_context,
        )

        elapsed_ms = int((time.time() - start) * 1000)

        return {
            "query": query,
            "answer": answer_data["answer"],
            "sources": answer_data["sources"],
            "results": [r.to_dict() for r in results],
            "confidence": answer_data["confidence"],
            "search_time_ms": elapsed_ms,
        }
