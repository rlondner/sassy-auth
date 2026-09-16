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

const TERMINAL_DEPLOY_FAILURE_STATUSES = new Set(['build_failed', 'update_failed', 'canceled', 'deactivated']);

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
