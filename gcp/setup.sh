#!/usr/bin/env bash
# One-time GCP setup for Cloud Run deployment — see docs/gcp-deployment.md §1-2.
# Idempotent: safe to re-run after a partial failure.
#
# Usage: gcp/setup.sh <PROJECT_ID> <REGION> [GITHUB_REPO] [--configure-github]
#   PROJECT_ID         existing GCP project to configure
#   REGION             e.g. us-east4
#   GITHUB_REPO        owner/repo trusted by Workload Identity Federation (default: rlondner/sassy-auth)
#   --configure-github also create the "gcp-production" GitHub Environment and its
#                       variables via `gh` (requires gh to be authenticated)
set -euo pipefail

# Retry a `gcloud ... describe` right after a `create` — IAM/WIF resources can take
# a few seconds to become visible to describe calls after creation succeeds.
retry_describe() {
  local tries=0
  until "$@" >/dev/null 2>&1; do
    tries=$((tries + 1))
    if [ "$tries" -ge 10 ]; then
      echo "!! Timed out waiting for resource to become visible: $*" >&2
      return 1
    fi
    sleep 3
  done
}

PROJECT_ID="${1:?Usage: gcp/setup.sh <PROJECT_ID> <REGION> [GITHUB_REPO] [--configure-github]}"
REGION="${2:?Usage: gcp/setup.sh <PROJECT_ID> <REGION> [GITHUB_REPO] [--configure-github]}"

if [[ "$PROJECT_ID" =~ ^[0-9]+$ ]]; then
  # A project *number* was passed instead of the project ID string — resolve it,
  # since gcloud rejects --project=<number> on several of the commands below.
  resolved="$(gcloud projects list --filter="projectNumber=${PROJECT_ID}" --format='value(projectId)')"
  if [ -z "$resolved" ]; then
    echo "!! Could not resolve project number $PROJECT_ID to a project ID. Pass the project ID instead." >&2
    exit 1
  fi
  echo "==> Resolved project number $PROJECT_ID to project ID $resolved"
  PROJECT_ID="$resolved"
fi
GITHUB_REPO="rlondner/sassy-auth"
CONFIGURE_GITHUB=0
for arg in "${@:3}"; do
  case "$arg" in
    --configure-github) CONFIGURE_GITHUB=1 ;;
    */*) GITHUB_REPO="$arg" ;;
  esac
done

REPO_NAME="sassy-auth"
POOL_ID="github-pool"
PROVIDER_ID="github-provider"
DEPLOYER_SA="sassy-auth-deployer"
DEPLOYER_SA_EMAIL="${DEPLOYER_SA}@${PROJECT_ID}.iam.gserviceaccount.com"

echo "==> Project: $PROJECT_ID  Region: $REGION  GitHub repo: $GITHUB_REPO"
# Pass --project explicitly on every call below instead of relying on
# `gcloud config set project` — an ambient CLOUDSDK_CORE_PROJECT env var or a
# core/project property already set to a project *number* silently overrides it.

echo "==> Enabling required APIs"
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  iamcredentials.googleapis.com \
  --project="$PROJECT_ID" --quiet

PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
RUNTIME_SA_EMAIL="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

echo "==> Artifact Registry repo: $REPO_NAME"
if ! gcloud artifacts repositories describe "$REPO_NAME" --location="$REGION" --project="$PROJECT_ID" >/dev/null 2>&1; then
  gcloud artifacts repositories create "$REPO_NAME" \
    --repository-format=docker --location="$REGION" --project="$PROJECT_ID" \
    --description="sassy-auth Cloud Run images"
else
  echo "    already exists"
fi

echo "==> Workload Identity Federation pool: $POOL_ID"
if ! gcloud iam workload-identity-pools describe "$POOL_ID" --location=global --project="$PROJECT_ID" >/dev/null 2>&1; then
  gcloud iam workload-identity-pools create "$POOL_ID" \
    --location=global --display-name="GitHub Actions" --project="$PROJECT_ID"
  retry_describe gcloud iam workload-identity-pools describe "$POOL_ID" --location=global --project="$PROJECT_ID"
else
  echo "    already exists"
fi
POOL_RESOURCE="$(gcloud iam workload-identity-pools describe "$POOL_ID" --location=global --project="$PROJECT_ID" --format='value(name)')"

echo "==> Workload Identity Federation provider: $PROVIDER_ID"
if ! gcloud iam workload-identity-pools providers describe "$PROVIDER_ID" \
    --location=global --workload-identity-pool="$POOL_ID" --project="$PROJECT_ID" >/dev/null 2>&1; then
  gcloud iam workload-identity-pools providers create-oidc "$PROVIDER_ID" \
    --location=global --workload-identity-pool="$POOL_ID" --project="$PROJECT_ID" \
    --issuer-uri="https://token.actions.githubusercontent.com" \
    --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
    --attribute-condition="assertion.repository=='${GITHUB_REPO}'"
  retry_describe gcloud iam workload-identity-pools providers describe "$PROVIDER_ID" \
    --location=global --workload-identity-pool="$POOL_ID" --project="$PROJECT_ID"
else
  echo "    already exists"
fi
PROVIDER_RESOURCE="$(gcloud iam workload-identity-pools providers describe "$PROVIDER_ID" \
  --location=global --workload-identity-pool="$POOL_ID" --project="$PROJECT_ID" --format='value(name)')"

echo "==> Deployer service account: $DEPLOYER_SA_EMAIL"
if ! gcloud iam service-accounts describe "$DEPLOYER_SA_EMAIL" --project="$PROJECT_ID" >/dev/null 2>&1; then
  gcloud iam service-accounts create "$DEPLOYER_SA" --display-name="sassy-auth GitHub Actions deployer" --project="$PROJECT_ID"
else
  echo "    already exists"
fi

echo "==> Granting deployer roles"
for role in roles/run.admin roles/artifactregistry.writer roles/secretmanager.secretAccessor; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:${DEPLOYER_SA_EMAIL}" --role="$role" --condition=None --quiet >/dev/null
done

echo "==> Allowing deployer to act as the Cloud Run runtime service account ($RUNTIME_SA_EMAIL)"
gcloud iam service-accounts add-iam-policy-binding "$RUNTIME_SA_EMAIL" \
  --member="serviceAccount:${DEPLOYER_SA_EMAIL}" --role="roles/iam.serviceAccountUser" --project="$PROJECT_ID" --quiet >/dev/null

echo "==> Granting runtime service account Secret Manager access"
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${RUNTIME_SA_EMAIL}" --role="roles/secretmanager.secretAccessor" \
  --condition=None --quiet >/dev/null

echo "==> Binding deployer SA to GitHub Actions via Workload Identity Federation"
gcloud iam service-accounts add-iam-policy-binding "$DEPLOYER_SA_EMAIL" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/${POOL_RESOURCE}/attribute.repository/${GITHUB_REPO}" \
  --project="$PROJECT_ID" --quiet >/dev/null

echo "==> Ensuring Secret Manager placeholders exist (fill real values from Render — see docs/gcp-deployment.md §2)"
SECRETS=(
  DATABASE_URL RSA_PRIVATE_KEY RSA_PUBLIC_KEY BETTER_AUTH_SECRET SEED_ADMIN_PASSWORD
  RESEND_API_KEY TURNSTILE_SECRET_KEY
  GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET
  MICROSOFT_CLIENT_ID MICROSOFT_CLIENT_SECRET MICROSOFT_TENANT_ID
)
for secret in "${SECRETS[@]}"; do
  if ! gcloud secrets describe "$secret" --project="$PROJECT_ID" >/dev/null 2>&1; then
    gcloud secrets create "$secret" --replication-policy=automatic --project="$PROJECT_ID" >/dev/null
    printf 'CHANGEME' | gcloud secrets versions add "$secret" --data-file=- --project="$PROJECT_ID" >/dev/null
    echo "    created $secret (placeholder value — replace with the real Render value)"
  else
    echo "    $secret already exists"
  fi
done

echo
echo "==> Done. GitHub Environment \"gcp-production\" variables:"
echo "    GCP_PROJECT_ID              = $PROJECT_ID"
echo "    GCP_REGION                  = $REGION"
echo "    GCP_WIF_PROVIDER            = $PROVIDER_RESOURCE"
echo "    GCP_SERVICE_ACCOUNT         = $DEPLOYER_SA_EMAIL"
echo "    NEXT_PUBLIC_TURNSTILE_SITE_KEY = <copy from Render>"

if [ "$CONFIGURE_GITHUB" -eq 1 ]; then
  if ! command -v gh >/dev/null 2>&1; then
    echo "!! --configure-github was passed but gh is not installed; set the variables above manually."
    exit 0
  fi
  echo
  echo "==> Creating GitHub Environment gcp-production and setting variables via gh"
  gh api --method PUT "repos/${GITHUB_REPO}/environments/gcp-production" >/dev/null
  gh variable set GCP_PROJECT_ID --env gcp-production --repo "$GITHUB_REPO" --body "$PROJECT_ID"
  gh variable set GCP_REGION --env gcp-production --repo "$GITHUB_REPO" --body "$REGION"
  gh variable set GCP_WIF_PROVIDER --env gcp-production --repo "$GITHUB_REPO" --body "$PROVIDER_RESOURCE"
  gh variable set GCP_SERVICE_ACCOUNT --env gcp-production --repo "$GITHUB_REPO" --body "$DEPLOYER_SA_EMAIL"
  echo "    NEXT_PUBLIC_TURNSTILE_SITE_KEY was NOT set — run:"
  echo "    gh variable set NEXT_PUBLIC_TURNSTILE_SITE_KEY --env gcp-production --repo $GITHUB_REPO --body <value>"
fi
