#!/usr/bin/env bash
# One-time, idempotent Google Cloud setup for KiranaAI.
#
# Layout (decided 18 Oct 2026, replaces Cloud SQL / asia-south1 in PRD §13.1):
#   - Postgres 16 on an Always Free e2-micro VM (us-central1-a, pd-standard 20 GB).
#   - Cloud Run in us-central1, reaching the VM's internal IP through Direct VPC egress.
#   - The VM has an external IP only while Postgres is installed; it is removed afterwards.
#
# Usage (Git Bash):  bash deploy/gcp-setup.sh
set -euo pipefail

PROJECT="${PROJECT:-orbi-kirana-hack}"
REGION="${REGION:-us-central1}"
ZONE="${ZONE:-us-central1-a}"
BILLING_ACCOUNT="${BILLING_ACCOUNT:-018805-3BD3A8-EA2BBE}"
VM="${VM:-kiranaai-db}"
DB_NAME="${DB_NAME:-kiranaai}"
DB_USER="${DB_USER:-kiranaai}"
SA_NAME="kiranaai-run"
SA="$SA_NAME@$PROJECT.iam.gserviceaccount.com"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

g() { gcloud --project "$PROJECT" --quiet "$@"; }
# gcloud on Windows is a native program: hand it Windows paths when running under Git Bash.
fpath() { if command -v cygpath >/dev/null 2>&1; then cygpath -w "$1"; else printf %s "$1"; fi; }
log() { printf '\n==> %s\n' "$*"; }

log "APIs"
g services enable run.googleapis.com compute.googleapis.com cloudbuild.googleapis.com \
  artifactregistry.googleapis.com secretmanager.googleapis.com generativelanguage.googleapis.com \
  billingbudgets.googleapis.com cloudresourcemanager.googleapis.com

log "Secrets"
ensure_secret() { # name, value-producing command
  local name="$1"; shift
  if g secrets describe "$name" >/dev/null 2>&1; then echo "secret $name exists"; return; fi
  "$@" | tr -d '\r\n' | g secrets create "$name" --replication-policy=automatic --data-file=-
  echo "secret $name created"
}
gemini_key_from_env() {
  [ -f "$ROOT/.env" ] || { echo "no .env with GEMINI_API_KEY" >&2; exit 1; }
  grep -E '^GEMINI_API_KEY=' "$ROOT/.env" | head -1 | cut -d= -f2-
}
ensure_secret db-password openssl rand -hex 24
ensure_secret admin-passcode openssl rand -hex 6
ensure_secret gemini-api-key gemini_key_from_env

log "Service account $SA"
g iam service-accounts describe "$SA" >/dev/null 2>&1 ||
  g iam service-accounts create "$SA_NAME" --display-name="KiranaAI Cloud Run"
g projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:$SA" \
  --role=roles/secretmanager.secretAccessor --condition=None >/dev/null
# `gcloud run deploy --source` builds with the default compute service account.
PROJECT_NUMBER="$(g projects describe "$PROJECT" --format='value(projectNumber)')"
g projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:$PROJECT_NUMBER-compute@developer.gserviceaccount.com" \
  --role=roles/run.builder --condition=None >/dev/null

log "Firewall: Postgres from the VPC only"
g compute firewall-rules describe kiranaai-allow-pg >/dev/null 2>&1 ||
  g compute firewall-rules create kiranaai-allow-pg --network=default --direction=INGRESS \
    --allow=tcp:5432 --source-ranges=10.128.0.0/9 --target-tags=kiranaai-db

log "Postgres VM $VM"
if g compute instances describe "$VM" --zone "$ZONE" >/dev/null 2>&1; then
  echo "VM exists"
else
  DB_PASSWORD="$(g secrets versions access latest --secret=db-password)"
  META="$(mktemp)"; printf '%s' "$DB_PASSWORD" > "$META"
  g compute instances create "$VM" --zone "$ZONE" --machine-type=e2-micro \
    --image-family=debian-12 --image-project=debian-cloud \
    --boot-disk-type=pd-standard --boot-disk-size=20GB \
    --tags=kiranaai-db --no-service-account --no-scopes \
    --metadata=db-name="$DB_NAME",db-user="$DB_USER" \
    --metadata-from-file=startup-script="$(fpath "$ROOT/deploy/vm-startup.sh")",db-password="$(fpath "$META")"
  rm -f "$META"
fi

log "Waiting for Postgres on the VM (first boot takes ~3 min)"
for i in $(seq 1 90); do
  if g compute instances get-serial-port-output "$VM" --zone "$ZONE" 2>/dev/null | grep -q KIRANAAI_DB_READY; then
    echo "ready"; break
  fi
  [ "$i" = 90 ] && { echo "timed out waiting for KIRANAAI_DB_READY" >&2; exit 1; }
  sleep 10
done

log "Removing the password from metadata and the VM's external IP"
g compute instances remove-metadata "$VM" --zone "$ZONE" --keys=db-password || true
if g compute instances describe "$VM" --zone "$ZONE" --format='value(networkInterfaces[0].accessConfigs[0].name)' | grep -q .; then
  g compute instances delete-access-config "$VM" --zone "$ZONE" \
    --access-config-name="$(g compute instances describe "$VM" --zone "$ZONE" --format='value(networkInterfaces[0].accessConfigs[0].name)')"
fi
echo "DB_HOST=$(g compute instances describe "$VM" --zone "$ZONE" --format='value(networkInterfaces[0].networkIP)')"

log "Budget alert"
if gcloud billing budgets list --billing-account="$BILLING_ACCOUNT" --format='value(displayName)' | grep -qx 'kiranaai-hack'; then
  echo "budget exists"
else
  gcloud billing budgets create --billing-account="$BILLING_ACCOUNT" --display-name=kiranaai-hack \
    --budget-amount=1000INR --filter-projects="projects/$PROJECT" \
    --threshold-rule=percent=0.5 --threshold-rule=percent=0.9 --threshold-rule=percent=1.0
fi

log "Done"
