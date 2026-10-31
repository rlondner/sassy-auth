# GCP (Cloud Run) deployment — parallel to Render

Render stays live. Nothing here runs on push; `.github/workflows/deploy-gcp.yml`
is `workflow_dispatch` only and never touches DNS or Render. Both stacks point at
the **same Neon database** and use the **same public domains**, so the cutover is
a DNS change.

## 1. One-time GCP setup

Run `gcp/setup.sh <PROJECT_ID> <REGION> [GITHUB_REPO] [--configure-github]` against an
existing GCP project (e.g. `gcp/setup.sh my-project us-east4 rlondner/sassy-auth --configure-github`).
It's idempotent — safe to re-run after a partial failure. It:

1. Enables `run`, `artifactregistry`, `secretmanager`, `iamcredentials`.
2. Creates the Artifact Registry Docker repo `sassy-auth` in `REGION`.
3. Creates a Workload Identity Federation pool/provider trusting `GITHUB_REPO`, and a
   deployer service account (`sassy-auth-deployer`) with: Cloud Run Admin, Artifact
   Registry Writer, Secret Manager Secret Accessor, and Service Account User on the
   Cloud Run runtime service account (the project's default compute SA, since the
   workflow doesn't set `--service-account`). Grants that runtime SA Secret Manager
   Secret Accessor too.
4. Creates placeholder Secret Manager secrets (value `CHANGEME`) for everything listed
   in step 2 below, so you only need to add real versions, not create the secrets.
5. Prints the values for the GitHub Environment `gcp-production` **variables**:
   `GCP_PROJECT_ID`, `GCP_REGION`, `GCP_WIF_PROVIDER`, `GCP_SERVICE_ACCOUNT`,
   `NEXT_PUBLIC_TURNSTILE_SITE_KEY`. Pass `--configure-github` to also create the
   environment and set the first four via `gh` (requires an authenticated `gh` CLI);
   `NEXT_PUBLIC_TURNSTILE_SITE_KEY` is always left for you to set by hand.

## 2. Secrets — copy the *current* Render values

`gcp/setup.sh` already created these in Secret Manager with a `CHANGEME` placeholder
version. Add the real versions, taking values from the Render dashboard (Environment
tab) — GitHub secrets are write-only, so Render is the source:

`DATABASE_URL`, `RSA_PRIVATE_KEY`, `RSA_PUBLIC_KEY`, `BETTER_AUTH_SECRET`,
`SEED_ADMIN_PASSWORD`, `RESEND_API_KEY`, `TURNSTILE_SECRET_KEY`, and the
`GOOGLE_*` / `MICROSOFT_*` secrets (leave the placeholder if unused):

```
printf '<value>' | gcloud secrets versions add DATABASE_URL --data-file=-
```

**Do not generate new RSA keys or `BETTER_AUTH_SECRET`**: reusing them keeps issued
JWTs and existing sessions valid across the cutover.

Non-secret env vars live in `gcp/env.*.yaml` and mirror `render.yaml` — keep the two in sync
while both exist.

## 3. Deploy and smoke-test (Render still live)

Run **Actions → Deploy to GCP → Run workflow**. It builds both images, runs
migrations and seeds as Cloud Run Jobs (idempotent against the shared DB), and
deploys both services.

Check the `*.run.app` URLs: `GET <auth-server-url>/.well-known/oauth-authorization-server`
should return JSON, and the admin should serve `/login`. A full sign-in will **not** work
on `run.app` hosts (cookies/CORS/issuer are pinned to the production domains), so the
real login test happens right after cutover; rollback is a DNS revert.

## 4. Cutover (manual)

1. Lower the DNS TTL on `auth.milissai.com` and `auth-api.milissai.com` a day ahead.
2. Map domains to the Cloud Run services (`gcloud beta run domain-mappings create
   --service sassy-auth-server --domain auth-api.milissai.com`, same for admin) and
   note the DNS records Google asks for. Wait for certificate provisioning.
3. Change the DNS records from Render's CNAME targets to Google's.
4. Verify: admin login, an OAuth authorize round-trip, social sign-in, email sending.
5. Rollback if broken: point DNS back at Render.

## 5. Retire Render (manual, after a soak period)

1. Disable the Render deploy: delete or disable `deploy-render.yml` (and staging if applicable),
   and switch `deploy-gcp.yml`'s trigger to `push: branches: [master]`.
2. Suspend then delete the Render services; remove custom domains there.
3. Remove `render.yaml`, `render.staging.yaml`, `packages/deploy-render`, and the Render
   sections of `DEPLOYMENT.md`.

## Known gaps

- Staging is not ported; it keeps deploying to Render.
- `deploy-render` auto-generated secrets and provisioned Neon; here both are manual one-offs.
