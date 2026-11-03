#!/usr/bin/env bash
# One-time setup of an External HTTPS Load Balancer in front of the two Cloud
# Run services, needed because the org's Domain Restricted Sharing policy
# (constraints/iam.allowedPolicyMemberDomains) blocks `allUsers` as an IAM
# principal, so `gcloud run deploy --allow-unauthenticated` can never make the
# services public. The LB invokes Cloud Run via its own service agent instead
# of allUsers, so it isn't subject to that policy.
#
# Covers steps 1-6 of the plan (reserve IP, serverless NEGs, backend services,
# URL map + managed cert, target-https-proxy + forwarding rule, lock down
# Cloud Run ingress and grant the LB's service agent invoker). DNS cutover
# (pointing auth.milissai.com / auth-api.milissai.com at the reserved IP) and
# updating docs/gcp-deployment.md §4 are deliberately NOT done here.
#
# Idempotent: safe to re-run after a partial failure.
#
# Usage: gcp/setup-lb.sh <PROJECT_ID> <REGION>
#   PROJECT_ID   existing GCP project (e.g. sassy-auth-prd)
#   REGION       region the Cloud Run services run in (e.g. us-east4)
set -euo pipefail

PROJECT_ID="${1:?Usage: gcp/setup-lb.sh <PROJECT_ID> <REGION>}"
REGION="${2:?Usage: gcp/setup-lb.sh <PROJECT_ID> <REGION>}"

if [[ "$PROJECT_ID" =~ ^[0-9]+$ ]]; then
  resolved="$(gcloud projects list --filter="projectNumber=${PROJECT_ID}" --format='value(projectId)')"
  if [ -z "$resolved" ]; then
    echo "!! Could not resolve project number $PROJECT_ID to a project ID. Pass the project ID instead." >&2
    exit 1
  fi
  echo "==> Resolved project number $PROJECT_ID to project ID $resolved"
  PROJECT_ID="$resolved"
fi

IP_NAME="sassy-auth-lb-ip"
AUTH_API_HOST="auth-api.milissai.com"
ADMIN_HOST="auth.milissai.com"
CERT_NAME="sassy-auth-cert"
URL_MAP_NAME="sassy-auth-url-map"
PROXY_NAME="sassy-auth-https-proxy"
FWD_RULE_NAME="sassy-auth-https-forwarding-rule"

SERVER_SERVICE="sassy-auth-server"
ADMIN_SERVICE="sassy-auth-admin"
SERVER_NEG="${SERVER_SERVICE}-neg"
ADMIN_NEG="${ADMIN_SERVICE}-neg"
SERVER_BACKEND="${SERVER_SERVICE}-backend"
ADMIN_BACKEND="${ADMIN_SERVICE}-backend"

PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
LB_INVOKER_SA="service-${PROJECT_NUMBER}@serverless-robot-prod.iam.gserviceaccount.com"

echo "==> Project: $PROJECT_ID  Region: $REGION"

echo "==> Enabling Compute Engine API"
gcloud services enable compute.googleapis.com --project="$PROJECT_ID" --quiet

# ── 1. Static external IP ──────────────────────────────────────────────────
echo "==> Reserving global static IP: $IP_NAME"
if ! gcloud compute addresses describe "$IP_NAME" --global --project="$PROJECT_ID" >/dev/null 2>&1; then
  gcloud compute addresses create "$IP_NAME" --global --ip-version=IPV4 --project="$PROJECT_ID"
else
  echo "    already exists"
fi
LB_IP="$(gcloud compute addresses describe "$IP_NAME" --global --project="$PROJECT_ID" --format='value(address)')"

# ── 2. Serverless NEGs ────────────────────────────────────────────────────
echo "==> Serverless NEG: $SERVER_NEG"
if ! gcloud compute network-endpoint-groups describe "$SERVER_NEG" --region="$REGION" --project="$PROJECT_ID" >/dev/null 2>&1; then
  gcloud compute network-endpoint-groups create "$SERVER_NEG" \
    --region="$REGION" --network-endpoint-type=serverless \
    --cloud-run-service="$SERVER_SERVICE" --project="$PROJECT_ID"
else
  echo "    already exists"
fi

echo "==> Serverless NEG: $ADMIN_NEG"
if ! gcloud compute network-endpoint-groups describe "$ADMIN_NEG" --region="$REGION" --project="$PROJECT_ID" >/dev/null 2>&1; then
  gcloud compute network-endpoint-groups create "$ADMIN_NEG" \
    --region="$REGION" --network-endpoint-type=serverless \
    --cloud-run-service="$ADMIN_SERVICE" --project="$PROJECT_ID"
else
  echo "    already exists"
fi

# ── 3. Backend services ─────────────────────────────────────────────────────
echo "==> Backend service: $SERVER_BACKEND"
if ! gcloud compute backend-services describe "$SERVER_BACKEND" --global --project="$PROJECT_ID" >/dev/null 2>&1; then
  gcloud compute backend-services create "$SERVER_BACKEND" \
    --global --load-balancing-scheme=EXTERNAL_MANAGED --project="$PROJECT_ID"
  gcloud compute backend-services add-backend "$SERVER_BACKEND" \
    --global --network-endpoint-group="$SERVER_NEG" --network-endpoint-group-region="$REGION" --project="$PROJECT_ID"
else
  echo "    already exists"
fi

echo "==> Backend service: $ADMIN_BACKEND"
if ! gcloud compute backend-services describe "$ADMIN_BACKEND" --global --project="$PROJECT_ID" >/dev/null 2>&1; then
  gcloud compute backend-services create "$ADMIN_BACKEND" \
    --global --load-balancing-scheme=EXTERNAL_MANAGED --project="$PROJECT_ID"
  gcloud compute backend-services add-backend "$ADMIN_BACKEND" \
    --global --network-endpoint-group="$ADMIN_NEG" --network-endpoint-group-region="$REGION" --project="$PROJECT_ID"
else
  echo "    already exists"
fi
1
# ── 4. URL map + managed SSL cert ──────────────────────────────────────────
echo "==> URL map: $URL_MAP_NAME"
if ! gcloud compute url-maps describe "$URL_MAP_NAME" --project="$PROJECT_ID" >/dev/null 2>&1; then
  gcloud compute url-maps create "$URL_MAP_NAME" --default-service="$ADMIN_BACKEND" --project="$PROJECT_ID"
  gcloud compute url-maps add-path-matcher "$URL_MAP_NAME" \
    --path-matcher-name=sassy-auth-matcher \
    --default-service="$ADMIN_BACKEND" \
    --new-hosts="$AUTH_API_HOST" \
    --backend-service-path-rules="/*=${SERVER_BACKEND}" \
    --project="$PROJECT_ID"
  gcloud compute url-maps add-path-matcher "$URL_MAP_NAME" \
    --path-matcher-name=sassy-auth-admin-matcher \
    --default-service="$ADMIN_BACKEND" \
    --new-hosts="$ADMIN_HOST" \
    --backend-service-path-rules="/*=${ADMIN_BACKEND}" \
    --project="$PROJECT_ID"
else
  echo "    already exists"
fi

echo "==> Managed SSL certificate: $CERT_NAME (for $AUTH_API_HOST, $ADMIN_HOST)"
if ! gcloud compute ssl-certificates describe "$CERT_NAME" --global --project="$PROJECT_ID" >/dev/null 2>&1; then
  gcloud compute ssl-certificates create "$CERT_NAME" \
    --domains="${AUTH_API_HOST},${ADMIN_HOST}" --global --project="$PROJECT_ID"
  echo "    created — provisioning can take 15-60 min and requires DNS to point at $LB_IP first"
else
  echo "    already exists"
fi

# ── 5. Target HTTPS proxy + global forwarding rule ─────────────────────────
echo "==> Target HTTPS proxy: $PROXY_NAME"
if ! gcloud compute target-https-proxies describe "$PROXY_NAME" --global --project="$PROJECT_ID" >/dev/null 2>&1; then
  gcloud compute target-https-proxies create "$PROXY_NAME" \
    --url-map="$URL_MAP_NAME" --ssl-certificates="$CERT_NAME" --project="$PROJECT_ID"
else
  echo "    already exists"
fi

echo "==> Global forwarding rule: $FWD_RULE_NAME"
if ! gcloud compute forwarding-rules describe "$FWD_RULE_NAME" --global --project="$PROJECT_ID" >/dev/null 2>&1; then
  gcloud compute forwarding-rules create "$FWD_RULE_NAME" \
    --global --target-https-proxy="$PROXY_NAME" \
    --address="$IP_NAME" --ports=443 --project="$PROJECT_ID"
else
  echo "    already exists"
fi

# ── 6. Lock down Cloud Run ingress, grant the LB's service agent invoker ───
echo "==> Restricting Cloud Run ingress to internal-and-cloud-load-balancing"
for svc in "$SERVER_SERVICE" "$ADMIN_SERVICE"; do
  gcloud run services update "$svc" --region="$REGION" --ingress=internal-and-cloud-load-balancing --project="$PROJECT_ID" --quiet
  gcloud run services add-iam-policy-binding "$svc" --region="$REGION" \
    --member="serviceAccount:${LB_INVOKER_SA}" --role=roles/run.invoker --project="$PROJECT_ID" --quiet >/dev/null
done

echo
echo "==> Done. Point DNS A-records at the load balancer's static IP:"
echo "    $AUTH_API_HOST  ->  $LB_IP"
echo "    $ADMIN_HOST     ->  $LB_IP"
echo
echo "    The managed SSL cert ($CERT_NAME) only finishes provisioning once DNS"
echo "    resolves to this IP — check status with:"
echo "    gcloud compute ssl-certificates describe $CERT_NAME --global --project=$PROJECT_ID --format='value(managed.status)'"
echo
echo "    docs/gcp-deployment.md §4 still describes the old per-service domain-mapping"
echo "    cutover and needs updating to this load-balancer IP approach."
