#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# Astra OS — One-time Setup Script
# ──────────────────────────────────────────────────────────────────────────────
# Run this ONCE before starting the server for the first time.
# Prerequisites: gcloud CLI installed and authenticated.
#
# Usage:
#   chmod +x setup.sh
#   ./setup.sh
# ──────────────────────────────────────────────────────────────────────────────

set -e

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║        Astra OS — Setup                  ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# ── 1. Load .env ──────────────────────────────────────────────────────────────

if [ ! -f backend/.env ]; then
  echo "❌  backend/.env not found."
  echo "    Copy backend/.env.example to backend/.env and fill in your values."
  exit 1
fi

export $(grep -v '^#' backend/.env | xargs)

if [ -z "$FIRESTORE_PROJECT_ID" ]; then
  echo "❌  FIRESTORE_PROJECT_ID is not set in backend/.env"
  exit 1
fi

echo "✅  Loaded .env (project: $FIRESTORE_PROJECT_ID)"

# ── 2. Set gcloud quota project ───────────────────────────────────────────────

echo ""
echo "→ Setting gcloud quota project..."
gcloud auth application-default set-quota-project "$FIRESTORE_PROJECT_ID" 2>/dev/null || \
  echo "   ⚠️  Could not set quota project — run: gcloud auth application-default login"

# ── 3. Enable required Google APIs ───────────────────────────────────────────

echo ""
echo "→ Enabling Google APIs..."
gcloud services enable firestore.googleapis.com \
                       gmail.googleapis.com \
                       calendar-json.googleapis.com \
                       aiplatform.googleapis.com \
  --project="$FIRESTORE_PROJECT_ID" 2>/dev/null || \
  echo "   ⚠️  Could not enable APIs automatically — enable them manually in GCP Console"

# ── 4. Create Firestore vector index (for semantic search) ────────────────────

echo ""
echo "→ Creating Firestore vector index for brain_insights..."
echo "  (This may take a few minutes on first run)"

gcloud firestore indexes composite create \
  --project="$FIRESTORE_PROJECT_ID" \
  --collection-group=brain_insights \
  --query-scope=COLLECTION \
  --field-config=vector-config='{"dimension":"768","flat":"{}"}',field-path=embedding \
  2>/dev/null && echo "  ✅  Vector index created" || \
  echo "  ℹ️   Vector index may already exist (that's OK)"

# ── 5. Install Python dependencies ───────────────────────────────────────────

echo ""
echo "→ Installing Python dependencies..."
cd backend
pip install -r requirements.txt --quiet
cd ..
echo "  ✅  Dependencies installed"

# ── 6. Done ───────────────────────────────────────────────────────────────────

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║  ✅  Setup complete!                      ║"
echo "╠══════════════════════════════════════════╣"
echo "║                                          ║"
echo "║  Next steps:                             ║"
echo "║  1. Add credentials.json to backend/     ║"
echo "║  2. cd backend && python main.py         ║"
echo "║  3. Visit http://localhost:8000/auth/gmail║"
echo "║     to connect your Gmail account        ║"
echo "║  4. Visit http://localhost:8000/onboard  ║"
echo "║     to set up your founder profile       ║"
echo "║  5. Open the frontend and start talking  ║"
echo "║     to Astra! 🎙️                          ║"
echo "╚══════════════════════════════════════════╝"
echo ""
