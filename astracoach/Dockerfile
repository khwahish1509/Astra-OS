# ─────────────────────────────────────────────────────────
# AstraCoach — Multi-stage Dockerfile
# Stage 1: Build React frontend
# Stage 2: Python FastAPI backend (serves frontend as static)
# Deployed on Google Cloud Run
# ─────────────────────────────────────────────────────────

# ── Stage 1: Frontend build ──────────────────────────────
FROM node:20-alpine AS frontend

WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci --silent

COPY frontend/ ./

# Inject Cloud Run service URL at build time
ARG VITE_BACKEND_URL=""
ENV VITE_BACKEND_URL=${VITE_BACKEND_URL}

RUN npm run build
# Output: /app/frontend/dist/

# ── Stage 2: Python backend ──────────────────────────────
FROM python:3.11-slim

WORKDIR /app

# System deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential curl \
    && rm -rf /var/lib/apt/lists/*

# Python deps
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# App source
COPY backend/ ./

# Copy built frontend into ./static
COPY --from=frontend /app/frontend/dist ./static

# Non-root user for security
RUN useradd --create-home --shell /bin/bash appuser
USER appuser

# Cloud Run required env
ENV PORT=8080
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1

EXPOSE 8080

# Healthcheck for Cloud Run
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:8080/health || exit 1

CMD ["python", "main.py"]
