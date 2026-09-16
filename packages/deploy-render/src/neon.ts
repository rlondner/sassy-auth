import { secretExists, setAndVerifySecret, type GithubConfig } from './githubSecrets';
import type { FetchLike } from './types';

const NEON_API_BASE = 'https://console.neon.tech/api/v2';

export interface NeonConfig {
  apiKey: string;
  projectName: string;
  databaseName: string;
  roleName: string;
}

interface NeonProject {
  id: string;
  name: string;
}

function neonHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
}

export async function findProjectByName(
  cfg: NeonConfig,
  fetchFn: FetchLike = fetch,
): Promise<NeonProject | undefined> {
  const res = await fetchFn(`${NEON_API_BASE}/projects`, { headers: neonHeaders(cfg.apiKey) });
  if (!res.ok) {
    throw new Error(`Neon API error listing projects: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as { projects: NeonProject[] };
  return body.projects.find((p) => p.name === cfg.projectName);
}

export async function createProject(cfg: NeonConfig, fetchFn: FetchLike = fetch): Promise<NeonProject> {
  const res = await fetchFn(`${NEON_API_BASE}/projects`, {
    method: 'POST',
    headers: neonHeaders(cfg.apiKey),
    body: JSON.stringify({ project: { name: cfg.projectName } }),
  });
  if (!res.ok) {
    throw new Error(`Neon API error creating project: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as { project: NeonProject };
  return body.project;
}

export async function getPooledConnectionUri(
  cfg: NeonConfig,
  projectId: string,
  fetchFn: FetchLike = fetch,
): Promise<string> {
  const url =
    `${NEON_API_BASE}/projects/${projectId}/connection_uri` +
    `?database_name=${encodeURIComponent(cfg.databaseName)}` +
    `&role_name=${encodeURIComponent(cfg.roleName)}&pooled=true`;
  const res = await fetchFn(url, { headers: neonHeaders(cfg.apiKey) });
  if (!res.ok) {
    throw new Error(`Neon API error fetching connection URI: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as { uri: string };
  return body.uri;
}

export async function ensureNeonDatabase(
  neonCfg: NeonConfig,
  githubCfg: GithubConfig,
  fetchFn: FetchLike = fetch,
): Promise<{ created: boolean; databaseUrl?: string }> {
  if (await secretExists(githubCfg, 'DATABASE_URL', fetchFn)) {
    return { created: false };
  }

  let project = await findProjectByName(neonCfg, fetchFn);
  if (!project) {
    project = await createProject(neonCfg, fetchFn);
  }

  const uri = await getPooledConnectionUri(neonCfg, project.id, fetchFn);
  await setAndVerifySecret(githubCfg, 'DATABASE_URL', uri, fetchFn);
  return { created: true, databaseUrl: uri };
}
