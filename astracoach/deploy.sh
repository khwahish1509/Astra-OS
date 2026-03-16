#!/bin/bash
# ─────────────────────────────────────────────────────────────────
# Astra OS — One-Command Deploy to Google Cloud Run
# ─────────────────────────────────────────────────────────────────
set -e

echo "🚀 Deploying Astra OS to Google Cloud Run..."
echo ""

# Check prerequisites
if ! command -v gcloud &> /dev/null; then
    echo "❌ gcloud CLI not found. Install: https://cloud.google.com/sdk/docs/install"
    exit 1
fi

PROJECT_ID=$(gcloud config get-value project 2>/dev/null)
if [ -z "$PROJECT_ID" ]; then
    echo "❌ No GCP project set. Run: gcloud config set project YOUR_PROJECT_ID"
    exit 1
fi

echo "📋 Project: $PROJECT_ID"
echo "📍 Region:  us-central1"
echo ""

# Enable required APIs
echo "🔧 Enabling Google Cloud APIs..."
gcloud services enable \
  cloudbuild.googleapis.com \
  run.googleapis.com \
  secretmanager.googleapis.com \
  artifactregistry.googleapis.com \
  firestore.googleapis.com \
  --quiet

# Create Artifact Registry repo (idempotent)
echo "📦 Setting up Artifact Registry..."
gcloud artifacts repositories create astracoach \
  --repository-format=docker \
  --location=us-central1 \
  --quiet 2>/dev/null || true

# Check if GOOGLE_API_KEY secret exists
if ! gcloud secrets describe GOOGLE_API_KEY --quiet 2>/dev/null; then
    echo ""
    echo "🔑 GOOGLE_API_KEY secret not found."
    echo "   Create it with:"
    echo "   echo -n 'your-key' | gcloud secrets create GOOGLE_API_KEY --data-file=-"
    echo ""
    read -p "Press Enter after creating the secret, or Ctrl+C to cancel..."
fi

# Grant Cloud Run service account access to secrets
echo "🔐 Configuring secret access..."
PROJECT_NUMBER=$(gcloud projects describe $PROJECT_ID --format='value(projectNumber)')
gcloud secrets add-iam-policy-binding GOOGLE_API_KEY \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor" \
  --quiet 2>/dev/null || true

# Deploy via Cloud Build
echo ""
echo "🏗️  Building and deploying (this takes 3-5 minutes)..."
gcloud builds submit --config cloudbuild.yaml .

echo ""
echo "✅ Deployment complete!"
echo ""
echo "🌐 Your app URL:"
gcloud run services describe astracoach --region=us-central1 --format='value(status.url)'
echo ""
