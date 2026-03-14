"""
Astra OS — Embedding Pipeline
==============================
Wraps Google's text-embedding-004 model.

Two task types:
  RETRIEVAL_DOCUMENT — used when storing insights in Firestore
  RETRIEVAL_QUERY    — used when searching for similar insights

Dimensions: 768 (text-embedding-004 default)
All calls are async (wrapped with asyncio.to_thread to avoid blocking).
"""

import asyncio
import os
from typing import Optional

import google.genai as genai
from google.genai import types as genai_types


MODEL = "text-embedding-004"
DIMENSIONS = 768


class EmbeddingPipeline:
    """
    Async embedding pipeline using text-embedding-004.

    Usage:
        pipeline = EmbeddingPipeline(api_key="...")
        vector = await pipeline.embed_document("Customer John confirmed the deal")
        query_vec = await pipeline.embed_query("overdue commitments to John")
    """

    def __init__(self, api_key: str):
        self._client = genai.Client(api_key=api_key)

    async def embed_document(self, text: str) -> list[float]:
        """
        Embed text for STORAGE in Firestore.
        Use this when saving new insights.
        """
        return await self._embed(text, task_type="RETRIEVAL_DOCUMENT")

    async def embed_query(self, query: str) -> list[float]:
        """
        Embed a search query for RETRIEVAL from Firestore.
        Use this when finding semantically similar insights.
        """
        return await self._embed(query, task_type="RETRIEVAL_QUERY")

    async def embed_batch(self, texts: list[str]) -> list[list[float]]:
        """
        Embed multiple texts concurrently.
        Efficient for bulk insight storage after email/meeting scan.
        """
        tasks = [self.embed_document(t) for t in texts]
        return await asyncio.gather(*tasks)

    async def _embed(self, text: str, task_type: str) -> list[float]:
        """Core embedding call — runs in thread to avoid blocking event loop."""
        if not text or not text.strip():
            return [0.0] * DIMENSIONS

        # Truncate to avoid token limit (text-embedding-004 supports ~2048 tokens)
        truncated = text.strip()[:8000]

        try:
            response = await asyncio.to_thread(
                self._client.models.embed_content,
                model=MODEL,
                contents=truncated,
                config=genai_types.EmbedContentConfig(task_type=task_type),
            )
            return list(response.embeddings[0].values)

        except Exception as e:
            print(f"[Embeddings] ❌ embed failed ({task_type}): {e}")
            # Return zero vector on failure — insight is still stored,
            # just won't appear in semantic searches
            return [0.0] * DIMENSIONS
