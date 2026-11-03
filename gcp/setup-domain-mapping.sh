#!/usr/bin/env bash
# Map a custom domain directly to a Cloud Run service, per docs/gcp-deployment.md §4
# (the native Cloud Run domain-mapping cutover, as opposed to the external-LB
# approach in setup-lb.sh — which turned out to be a dead end: an External
# Application Load Balancer cannot authenticate anonymous end users on Cloud
# Run's behalf, so it never bypasses the org's Domain Restricted Sharing policy
# blocking `allUsers`. Domain mapping doesn't change the IAM invoker
# requirement either — the service must still allow unauthenticated access,
# which requires an org policy exception. This script sets ingress back to
# public ("all") so the mapping can work once that exception exists.
#
# Idempotent: safe to re-run after a partial failure.
#
# Usage: gcp/setup-domain-mapping.sh <PROJECT_ID> <REGION> <SERVICE> <DOMAIN>
#   PROJECT_ID   existing GCP project (e.g. sassy-auth-prd)
#   REGION       region the Cloud Run service runs in (e.g. us-east4)
#   SERVICE      Cloud Run service name (e.g. sassy-auth-server)
#   DOMAIN       custom domain to map (e.g. api-stg.milissai.com)
set -euo pipefail

PROJECT_ID="${1:?Usage: gcp/setup-domain-mapping.sh <PROJECT_ID> <REGION> <SERVICE> <DOMAIN>}"
REGION="${2:?Usage: gcp/setup-domain-mapping.sh <PROJECT_ID> <REGION> <SERVICE> <DOMAIN>}"
SERVICE="${3:?Usage: gcp/setup-domain-mapping.sh <PROJECT_ID> <REGION> <SERVICE> <DOMAIN>}"
DOMAIN="${4:?Usage: gcp/setup-domain-mapping.sh <PROJECT_ID> <REGION> <SERVICE> <DOMAIN>}"

if [[ "$PROJECT_ID" =~ ^[0-9]+$ ]]; then
  resolved="$(gcloud projects list --filter="projectNumber=${PROJECT_ID}" --format='value(projectId)')"
  if [ -z "$resolved" ]; then
    echo "!! Could not resolve project number $PROJECT_ID to a project ID. Pass the project ID instead." >&2
    exit 1
  fi
  echo "==> Resolved project number $PROJECT_ID to project ID $resolved"
  PROJECT_ID="$resolved"
fi

echo "==> Project: $PROJECT_ID  Region: $REGION  Service: $SERVICE  Domain: $DOMAIN"

echo "==> Setting ingress back to public (all) — domain mapping needs the standard public path, not a load balancer"
gcloud run services update "$SERVICE" --region="$REGION" --ingress=all --project="$PROJECT_ID" --quiet

echo "==> Domain mapping: $DOMAIN -> $SERVICE"
if ! gcloud beta run domain-mappings describe --domain="$DOMAIN" --region="$REGION" --project="$PROJECT_ID" >/dev/null 2>&1; then
  gcloud beta run domain-mappings create --service="$SERVICE" --domain="$DOMAIN" --region="$REGION" --project="$PROJECT_ID"
else
  echo "    already exists"
fi

echo
echo "==> DNS records required for $DOMAIN (add these at your DNS provider):"
gcloud beta run domain-mappings describe --domain="$DOMAIN" --region="$REGION" --project="$PROJECT_ID" \
  --format="value(status.resourceRecords[].type, status.resourceRecords[].name, status.resourceRecords[].rrdata)" 2>&1

echo
if ! gcloud run services get-iam-policy "$SERVICE" --region="$REGION" --project="$PROJECT_ID" --format="value(bindings)" 2>/dev/null | grep -q "allUsers"; then
  echo "==> NOTE: $SERVICE does not grant allUsers:roles/run.invoker yet, so this domain"
  echo "    will 403 for anonymous requests until that binding exists. The org's Domain"
  echo "    Restricted Sharing policy blocks allUsers unless overridden at the project level"
  echo "    (see constraints/iam.allowedPolicyMemberDomains)."
fi
