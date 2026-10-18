#!/usr/bin/env bash
# Build from source and deploy the single KiranaAI container to Cloud Run.
#
# Scale-to-zero by decision (18 Oct 2026): min 0 / max 1 instance, request-based CPU.
# max 1 because Beckn waiters and the agent rate limiter live in memory.
# Background jobs run off requests too (see apps/server/src/lib/ticker.ts).
# Gemini goes through Vertex AI as the service account (GEMINI_VERTEX=1, billed to the project). The API-key secret
# stays mounted as a fallback: `gcloud run services update kiranaai --update-env-vars GEMINI_VERTEX=0`.
#
# Usage (Git Bash):  bash deploy/gcp-deploy.sh
set -euo pipefail

PROJECT="${PROJECT:-orbi-kirana-hack}"
REGION="${REGION:-us-central1}"
ZONE="${ZONE:-us-central1-a}"
SERVICE="${SERVICE:-kiranaai}"
VM="${VM:-kiranaai-db}"
SA="kiranaai-run@$PROJECT.iam.gserviceaccount.com"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

DB_HOST="$(gcloud --project "$PROJECT" compute instances describe "$VM" --zone "$ZONE" \
  --format='value(networkInterfaces[0].networkIP)')"
[ -n "$DB_HOST" ] || { echo "DB VM $VM not found; run deploy/gcp-setup.sh" >&2; exit 1; }

cd "$ROOT"
gcloud --project "$PROJECT" run deploy "$SERVICE" --source . --region "$REGION" --quiet \
  --service-account "$SA" \
  --network default --subnet default --vpc-egress private-ranges-only \
  --min-instances 0 --max-instances 1 --cpu 1 --memory 512Mi --concurrency 80 \
  --allow-unauthenticated \
  --startup-probe "httpGet.path=/health,initialDelaySeconds=0,periodSeconds=2,failureThreshold=15,timeoutSeconds=2" \
  --set-secrets DB_PASSWORD=db-password:latest,ADMIN_PASSCODE=admin-passcode:latest,GEMINI_API_KEY=gemini-api-key:latest \
  --set-env-vars "DB_HOST=$DB_HOST,DB_PORT=5432,DB_NAME=kiranaai,DB_USER=kiranaai,SELF_BASE_URL=http://127.0.0.1:8080,GEMINI_VERTEX=1,GOOGLE_CLOUD_PROJECT=$PROJECT,GEMINI_LOCATION=global,GEMINI_LIVE_LOCATION=$REGION,GEMINI_MODEL=gemini-3.5-flash-lite,GEMINI_LIVE_MODEL=gemini-3.8-live,GEMINI_TRANSCRIBE_MODEL=gemini-3.5-transcribe-live-preview,OFFER_WINDOW_SECONDS=45"

URL="$(gcloud --project "$PROJECT" run services describe "$SERVICE" --region "$REGION" --format='value(status.url)')"
echo "URL: $URL"
curl -s "$URL/health"; echo
