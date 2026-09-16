import { secretExists, setAndVerifySecret, type GithubConfig } from './githubSecrets';
import type { FetchLike } from './types';

const NEON_API_BASE = 'https://console.neon.tech/api/v2';

export interface NeonConfig {
  apiKey: string;
  projectName: string;
  databaseName: string;
  roleName: string;
  // Required when apiKey is a Neon organization API key — the Neon API
  // rejects GET/POST /projects with "org_id is required" otherwise.
  // Personal API keys don't need this.
  orgId?: string;
  // Neon region id (e.g. "aws-us-east-2"). Only applied when creating a new project —
  // Neon defaults to its own region (historically Oregon) otherwise, which is unlikely to
  // match the Render services' region and adds cross-region latency to every query.
  regionId?: string;
  // When set, ensureNeonDatabase provisions/targets a branch with this name (created off
  // the project's default branch on first use, copy-on-write) instead of the default
  // branch itself. Used for staging — an independent branch of the production database.
  branchName?: string;
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
  const url = cfg.orgId
    ? `${NEON_API_BASE}/projects?org_id=${encodeURIComponent(cfg.orgId)}`
    : `${NEON_API_BASE}/projects`;
  const res = await fetchFn(url, { headers: neonHeaders(cfg.apiKey) });
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
    body: JSON.stringify({
      project: {
        name: cfg.projectName,
        ...(cfg.orgId ? { org_id: cfg.orgId } : {}),
        ...(cfg.regionId ? { region_id: cfg.regionId } : {}),
        // Without this, Neon provisions its own defaults (a "neondb" database owned by
        // "neondb_owner") instead of the names this pipeline expects.
        branch: { database_name: cfg.databaseName, role_name: cfg.roleName },
      },
    }),
  });
  if (!res.ok) {
    throw new Error(`Neon API error creating project: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as { project: NeonProject };
  return body.project;
}

interface NeonBranch {
  id: string;
  name: string;
  default: boolean;
}

async function listBranches(cfg: NeonConfig, projectId: string, fetchFn: FetchLike): Promise<NeonBranch[]> {
  const res = await fetchFn(`${NEON_API_BASE}/projects/${projectId}/branches`, {
    headers: neonHeaders(cfg.apiKey),
  });
  if (!res.ok) {
    throw new Error(`Neon API error listing branches: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as { branches: NeonBranch[] };
  return body.branches;
}

async function getDefaultBranchId(cfg: NeonConfig, projectId: string, fetchFn: FetchLike): Promise<string> {
  const branches = await listBranches(cfg, projectId, fetchFn);
  const branch = branches.find((b) => b.default) ?? branches[0];
  if (!branch) {
    throw new Error(`Neon project ${projectId} has no branches`);
  }
  return branch.id;
}

async function findBranchByName(
  cfg: NeonConfig,
  projectId: string,
  name: string,
  fetchFn: FetchLike,
): Promise<NeonBranch | undefined> {
  const branches = await listBranches(cfg, projectId, fetchFn);
  return branches.find((b) => b.name === name);
}

// Copy-on-write: the new branch starts with the parent's roles/databases already present
// (including whatever ensureRole/ensureDatabase already created on it), so the caller's
// subsequent ensureRole/ensureDatabase calls are expected to be no-ops on a fresh branch.
async function createBranch(
  cfg: NeonConfig,
  projectId: string,
  parentBranchId: string,
  name: string,
  fetchFn: FetchLike,
): Promise<NeonBranch> {
  const res = await fetchFn(`${NEON_API_BASE}/projects/${projectId}/branches`, {
    method: 'POST',
    headers: neonHeaders(cfg.apiKey),
    body: JSON.stringify({ branch: { parent_id: parentBranchId, name } }),
  });
  if (!res.ok) {
    throw new Error(`Neon API error creating branch: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as { branch: NeonBranch };
  return body.branch;
}

// Handles a project that already existed (found, not created) and so may predate this
// pipeline's expected database_name/role_name — e.g. one set up manually, or created before
// createProject started passing a `branch` spec. A freshly created project already has both,
// making these calls no-ops.
async function ensureRole(
  cfg: NeonConfig,
  projectId: string,
  branchId: string,
  fetchFn: FetchLike,
): Promise<void> {
  const res = await fetchFn(`${NEON_API_BASE}/projects/${projectId}/branches/${branchId}/roles`, {
    headers: neonHeaders(cfg.apiKey),
  });
  if (!res.ok) {
    throw new Error(`Neon API error listing roles: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as { roles: Array<{ name: string }> };
  if (body.roles.some((r) => r.name === cfg.roleName)) return;

  const createRes = await fetchFn(`${NEON_API_BASE}/projects/${projectId}/branches/${branchId}/roles`, {
    method: 'POST',
    headers: neonHeaders(cfg.apiKey),
    body: JSON.stringify({ role: { name: cfg.roleName } }),
  });
  if (!createRes.ok) {
    throw new Error(`Neon API error creating role: ${createRes.status} ${await createRes.text()}`);
  }
}

async function ensureDatabase(
  cfg: NeonConfig,
  projectId: string,
  branchId: string,
  fetchFn: FetchLike,
): Promise<void> {
  const res = await fetchFn(`${NEON_API_BASE}/projects/${projectId}/branches/${branchId}/databases`, {
    headers: neonHeaders(cfg.apiKey),
  });
  if (!res.ok) {
    throw new Error(`Neon API error listing databases: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as { databases: Array<{ name: string }> };
  if (body.databases.some((d) => d.name === cfg.databaseName)) return;

  const createRes = await fetchFn(`${NEON_API_BASE}/projects/${projectId}/branches/${branchId}/databases`, {
    method: 'POST',
    headers: neonHeaders(cfg.apiKey),
    // owner_name must already exist — call ensureRole before ensureDatabase.
    body: JSON.stringify({ database: { name: cfg.databaseName, owner_name: cfg.roleName } }),
  });
  if (!createRes.ok) {
    throw new Error(`Neon API error creating database: ${createRes.status} ${await createRes.text()}`);
  }
}

export async function getPooledConnectionUri(
  cfg: NeonConfig,
  projectId: string,
  branchId: string,
  fetchFn: FetchLike = fetch,
): Promise<string> {
  // branch_id is explicit, not left to Neon's default-branch fallback: the staging branch
  // has a role/database with the same names as production's (branching copies them), so
  // without this the wrong branch's connection could be resolved.
  const url =
    `${NEON_API_BASE}/projects/${projectId}/connection_uri` +
    `?database_name=${encodeURIComponent(cfg.databaseName)}` +
    `&role_name=${encodeURIComponent(cfg.roleName)}` +
    `&branch_id=${encodeURIComponent(branchId)}&pooled=true`;
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

  const defaultBranchId = await getDefaultBranchId(neonCfg, project.id, fetchFn);
  const branchId = neonCfg.branchName
    ? (
        (await findBranchByName(neonCfg, project.id, neonCfg.branchName, fetchFn)) ??
        (await createBranch(neonCfg, project.id, defaultBranchId, neonCfg.branchName, fetchFn))
      ).id
    : defaultBranchId;

  await ensureRole(neonCfg, project.id, branchId, fetchFn);
  await ensureDatabase(neonCfg, project.id, branchId, fetchFn);

  const uri = await getPooledConnectionUri(neonCfg, project.id, branchId, fetchFn);
  await setAndVerifySecret(githubCfg, 'DATABASE_URL', uri, fetchFn);
  return { created: true, databaseUrl: uri };
}
