import type { FetchLike } from './types';

const RENDER_API_BASE = 'https://api.render.com/v1';

export interface RenderConfig {
  apiKey: string;
}

export interface RenderEnvVar {
  key: string;
  value: string;
}

function renderHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
}

// limit=20 is Render's default page size; assumes fewer than 20 services share this name across the account.
export async function findServiceIdByName(
  cfg: RenderConfig,
  name: string,
  fetchFn: FetchLike = fetch,
): Promise<string> {
  const res = await fetchFn(`${RENDER_API_BASE}/services?name=${encodeURIComponent(name)}&limit=20`, {
    headers: renderHeaders(cfg.apiKey),
  });
  if (!res.ok) {
    throw new Error(`Render API error listing services: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as Array<{ service: { id: string; name: string } }>;
  const match = body.find((entry) => entry.service.name === name);
  if (!match) {
    throw new Error(`No Render service found named "${name}"`);
  }
  return match.service.id;
}

// Replaces the service's entire env var set (PUT semantics) — pass the full desired set, not a diff.
export async function setEnvVars(
  cfg: RenderConfig,
  serviceId: string,
  envVars: RenderEnvVar[],
  fetchFn: FetchLike = fetch,
): Promise<void> {
  const res = await fetchFn(`${RENDER_API_BASE}/services/${serviceId}/env-vars`, {
    method: 'PUT',
    headers: renderHeaders(cfg.apiKey),
    body: JSON.stringify(envVars),
  });
  if (!res.ok) {
    throw new Error(`Render API error setting env vars for ${serviceId}: ${res.status} ${await res.text()}`);
  }
}

export async function getEnvVars(
  cfg: RenderConfig,
  serviceId: string,
  fetchFn: FetchLike = fetch,
): Promise<RenderEnvVar[]> {
  const res = await fetchFn(`${RENDER_API_BASE}/services/${serviceId}/env-vars`, {
    headers: renderHeaders(cfg.apiKey),
  });
  if (!res.ok) {
    throw new Error(`Render API error fetching env vars for ${serviceId}: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as Array<{ envVar: RenderEnvVar }>;
  return body.map((entry) => entry.envVar);
}

// Desired values win on key collision; anything already set on Render that isn't in
// `desired` is preserved (e.g. optional social-login/email secrets an operator set by
// hand in the Render dashboard, which this pipeline doesn't manage).
export function mergeEnvVars(existing: RenderEnvVar[], desired: RenderEnvVar[]): RenderEnvVar[] {
  const merged = new Map<string, string>();
  for (const envVar of existing) merged.set(envVar.key, envVar.value);
  for (const envVar of desired) merged.set(envVar.key, envVar.value);
  return Array.from(merged.entries()).map(([key, value]) => ({ key, value }));
}

// Fetches the service's current env vars, merges `desired` on top, and replaces the full
// set via setEnvVars's PUT semantics — without this, setEnvVars alone would silently wipe
// any env var this pipeline doesn't explicitly manage.
export async function syncManagedEnvVars(
  cfg: RenderConfig,
  serviceId: string,
  desired: RenderEnvVar[],
  fetchFn: FetchLike = fetch,
): Promise<void> {
  const existing = await getEnvVars(cfg, serviceId, fetchFn);
  await setEnvVars(cfg, serviceId, mergeEnvVars(existing, desired), fetchFn);
}

interface RenderDeploy {
  id: string;
  status: string;
}

export async function getLatestDeployStatus(
  cfg: RenderConfig,
  serviceId: string,
  fetchFn: FetchLike = fetch,
): Promise<RenderDeploy> {
  const res = await fetchFn(`${RENDER_API_BASE}/services/${serviceId}/deploys?limit=1`, {
    headers: renderHeaders(cfg.apiKey),
  });
  if (!res.ok) {
    throw new Error(`Render API error fetching deploys for ${serviceId}: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as Array<{ deploy: RenderDeploy }>;
  if (body.length === 0) {
    throw new Error(`No deploys found for service ${serviceId}`);
  }
  return body[0].deploy;
}

const TERMINAL_DEPLOY_FAILURE_STATUSES = new Set([
  'build_failed',
  'update_failed',
  'pre_deploy_failed',
  'canceled',
  'deactivated',
]);

// Env var updates (setEnvVars/syncManagedEnvVars) do NOT themselves trigger a new deploy —
// use this to kick one off explicitly rather than relying on Render's autoDeploy-on-push,
// which races the env var sync and typically starts (and fails) before secrets land.
export async function triggerDeploy(
  cfg: RenderConfig,
  serviceId: string,
  fetchFn: FetchLike = fetch,
): Promise<RenderDeploy> {
  const res = await fetchFn(`${RENDER_API_BASE}/services/${serviceId}/deploys`, {
    method: 'POST',
    headers: renderHeaders(cfg.apiKey),
    body: JSON.stringify({}),
  });
  if (!res.ok) {
    throw new Error(`Render API error triggering deploy for ${serviceId}: ${res.status} ${await res.text()}`);
  }
  const text = await res.text();
  // Render's create-deploy endpoint responds with an empty body on success — fall back to
  // the service's now-latest deploy, which is the one this call just created.
  if (!text) {
    return getLatestDeployStatus(cfg, serviceId, fetchFn);
  }
  return JSON.parse(text) as RenderDeploy;
}

export async function getDeployStatus(
  cfg: RenderConfig,
  serviceId: string,
  deployId: string,
  fetchFn: FetchLike = fetch,
): Promise<RenderDeploy> {
  const res = await fetchFn(`${RENDER_API_BASE}/services/${serviceId}/deploys/${deployId}`, {
    headers: renderHeaders(cfg.apiKey),
  });
  if (!res.ok) {
    throw new Error(`Render API error fetching deploy ${deployId} for ${serviceId}: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as RenderDeploy;
}

// Polls one specific deploy by id, not just "whatever is latest" — a concurrent autoDeploy
// (or another manually triggered deploy) can otherwise become the "latest" deploy mid-poll
// and mask the outcome of the one this call actually cares about.
export async function waitForDeploy(
  cfg: RenderConfig,
  serviceId: string,
  deployId: string,
  fetchFn: FetchLike = fetch,
  sleepFn: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  pollIntervalMs = 15_000,
  maxAttempts = 40,
): Promise<void> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const deploy = await getDeployStatus(cfg, serviceId, deployId, fetchFn);
    if (deploy.status === 'live') return;
    if (TERMINAL_DEPLOY_FAILURE_STATUSES.has(deploy.status)) {
      throw new Error(`Render deploy ${deploy.id} for service ${serviceId} ended with status "${deploy.status}"`);
    }
    await sleepFn(pollIntervalMs);
  }
  throw new Error(`Timed out waiting for deploy ${deployId} on service ${serviceId} to go live`);
}

export async function waitForLiveDeploy(
  cfg: RenderConfig,
  serviceId: string,
  fetchFn: FetchLike = fetch,
  sleepFn: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  pollIntervalMs = 15_000,
  maxAttempts = 40,
): Promise<void> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const deploy = await getLatestDeployStatus(cfg, serviceId, fetchFn);
    if (deploy.status === 'live') return;
    if (TERMINAL_DEPLOY_FAILURE_STATUSES.has(deploy.status)) {
      throw new Error(`Render deploy ${deploy.id} for service ${serviceId} ended with status "${deploy.status}"`);
    }
    await sleepFn(pollIntervalMs);
  }
  throw new Error(`Timed out waiting for service ${serviceId} to reach a live deploy`);
}

interface RenderJob {
  id: string;
  status: string;
}

export async function startJob(
  cfg: RenderConfig,
  serviceId: string,
  startCommand: string,
  fetchFn: FetchLike = fetch,
): Promise<RenderJob> {
  const res = await fetchFn(`${RENDER_API_BASE}/services/${serviceId}/jobs`, {
    method: 'POST',
    headers: renderHeaders(cfg.apiKey),
    body: JSON.stringify({ startCommand }),
  });
  if (!res.ok) {
    throw new Error(`Render API error starting job on ${serviceId}: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as RenderJob;
}

const TERMINAL_JOB_FAILURE_STATUSES = new Set(['failed', 'canceled']);

export async function waitForJobCompletion(
  cfg: RenderConfig,
  serviceId: string,
  jobId: string,
  fetchFn: FetchLike = fetch,
  sleepFn: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  pollIntervalMs = 10_000,
  maxAttempts = 60,
): Promise<RenderJob> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const res = await fetchFn(`${RENDER_API_BASE}/services/${serviceId}/jobs/${jobId}`, {
      headers: renderHeaders(cfg.apiKey),
    });
    if (!res.ok) {
      throw new Error(`Render API error polling job ${jobId}: ${res.status} ${await res.text()}`);
    }
    const job = (await res.json()) as RenderJob;
    if (job.status === 'succeeded') return job;
    if (TERMINAL_JOB_FAILURE_STATUSES.has(job.status)) {
      throw new Error(`Render job ${jobId} on ${serviceId} ended with status "${job.status}"`);
    }
    await sleepFn(pollIntervalMs);
  }
  throw new Error(`Timed out waiting for job ${jobId} on ${serviceId} to complete`);
}
