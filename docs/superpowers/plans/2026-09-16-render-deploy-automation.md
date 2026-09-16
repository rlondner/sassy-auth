# Render Deployment Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate manual secret entry and manual post-deploy seeding from the Render deployment of `sassy-auth-server` and `sassy-auth-admin`, driven by a GitHub Actions workflow on push to `master`.

**Architecture:** A new `packages/deploy-render` TypeScript package exposes four small, independently-testable modules (GitHub secrets, Neon provisioning, Render sync, secret generation) plus a `render.yaml` parser and a `cli.ts` entrypoint that wires them together. `render.yaml` remains the source of truth for service topology; the CLI reads it at runtime instead of duplicating its literal values.

**Tech Stack:** TypeScript, Jest + ts-jest (matches `packages/db`), native `fetch` (Node 24), `libsodium-wrappers` (GitHub secret encryption), `yaml` (render.yaml parsing), GitHub Actions, Render REST API v1, Neon REST API v2.

Design reference: `docs/superpowers/specs/2026-09-16-render-deploy-automation-design.md`

---

## File structure

```
packages/deploy-render/
  package.json
  tsconfig.json
  src/
    types.ts            # shared FetchLike type
    githubSecrets.ts     # check/set GitHub Environment secrets (sealed-box encryption)
    githubSecrets.spec.ts
    secrets.ts           # generate + ensureSecrets() orchestration
    secrets.spec.ts
    neon.ts               # find/create Neon project, fetch pooled URI, ensureNeonDatabase()
    neon.spec.ts
    render.ts             # Render service lookup, env var sync, deploy/job polling
    render.spec.ts
    renderYaml.ts          # parse render.yaml, extract literal (non-secret) values
    renderYaml.spec.ts
    cli.ts                # entrypoint wiring all stages, --dry-run flag
.github/workflows/
  deploy-render.yml
DEPLOYMENT.md              # updated to describe the automated flow + remaining one-time setup
```

Each `src/*.ts` file has one responsibility and takes an injectable `fetchFn`/`sleepFn` so tests never hit real networks.

---

### Task 1: Scaffold the `packages/deploy-render` package

**Files:**
- Create: `packages/deploy-render/package.json`
- Create: `packages/deploy-render/tsconfig.json`
- Create: `packages/deploy-render/src/types.ts`
- Test: `packages/deploy-render/src/types.spec.ts`

- [ ] **Step 1: Create the package manifest**

`packages/deploy-render/package.json`:

```json
{
  "name": "@sassy-auth/deploy-render",
  "version": "0.0.1",
  "private": true,
  "scripts": {
    "build": "tsc",
    "test": "jest",
    "deploy": "ts-node --transpile-only src/cli.ts"
  },
  "jest": {
    "moduleFileExtensions": ["js", "json", "ts"],
    "rootDir": ".",
    "testRegex": ".*\\.spec\\.ts$",
    "transform": {
      "^.+\\.(t|j)s$": "ts-jest"
    },
    "testEnvironment": "node"
  },
  "dependencies": {
    "libsodium-wrappers": "^0.7.13",
    "yaml": "^2.4.0"
  },
  "devDependencies": {
    "@types/jest": "^29.5.12",
    "@types/libsodium-wrappers": "^0.7.14",
    "@types/node": "^20.0.0",
    "jest": "^29.7.0",
    "ts-jest": "^29.1.4",
    "ts-node": "^10.9.2",
    "typescript": "^5.4.0"
  }
}
```

- [ ] **Step 2: Create the TypeScript config**

`packages/deploy-render/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
    "declaration": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src"],
  "exclude": ["dist", "node_modules"]
}
```

- [ ] **Step 3: Write the failing test for the shared type module**

`packages/deploy-render/src/types.spec.ts`:

```ts
import type { FetchLike } from './types';

describe('FetchLike', () => {
  it('accepts a function matching the global fetch signature', () => {
    const fn: FetchLike = async (_url, _init) => new Response('ok');
    expect(typeof fn).toBe('function');
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd packages/deploy-render && pnpm install && pnpm test`
Expected: FAIL — `Cannot find module './types'`

- [ ] **Step 5: Create the shared type**

`packages/deploy-render/src/types.ts`:

```ts
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd packages/deploy-render && pnpm test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/deploy-render
git commit -m "chore(deploy-render): scaffold package"
```

---

### Task 2: GitHub Environment secrets client

**Files:**
- Create: `packages/deploy-render/src/githubSecrets.ts`
- Test: `packages/deploy-render/src/githubSecrets.spec.ts`

- [ ] **Step 1: Write the failing tests**

`packages/deploy-render/src/githubSecrets.spec.ts`:

```ts
import { secretExists, setSecret, sealSecret, type GithubConfig } from './githubSecrets';

const cfg: GithubConfig = {
  owner: 'acme',
  repo: 'sassy-auth',
  environment: 'production',
  token: 'gh-token',
};

describe('secretExists', () => {
  it('returns false when GitHub responds 404', async () => {
    const fetchFn = jest.fn().mockResolvedValue({ status: 404, ok: false } as Response);
    await expect(secretExists(cfg, 'DATABASE_URL', fetchFn)).resolves.toBe(false);
    expect(fetchFn).toHaveBeenCalledWith(
      'https://api.github.com/repos/acme/sassy-auth/environments/production/secrets/DATABASE_URL',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer gh-token' }) }),
    );
  });

  it('returns true when GitHub responds 200', async () => {
    const fetchFn = jest.fn().mockResolvedValue({ status: 200, ok: true } as Response);
    await expect(secretExists(cfg, 'DATABASE_URL', fetchFn)).resolves.toBe(true);
  });

  it('throws on unexpected error status', async () => {
    const fetchFn = jest
      .fn()
      .mockResolvedValue({ status: 500, ok: false, text: async () => 'boom' } as Response);
    await expect(secretExists(cfg, 'DATABASE_URL', fetchFn)).rejects.toThrow(/500/);
  });
});

describe('sealSecret', () => {
  it('produces a non-empty base64 string', async () => {
    // A real Curve25519 public key, base64-encoded (test fixture, not a secret).
    const publicKey = 'CoLnKzljvQBrRKzO4CIfjbty8y+FVN7leGFF9DEbnzY=';
    const sealed = await sealSecret('hello-world', publicKey);
    expect(typeof sealed).toBe('string');
    expect(sealed.length).toBeGreaterThan(0);
  });
});

describe('setSecret', () => {
  it('fetches the environment public key then PUTs the encrypted value', async () => {
    const fetchFn = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ key_id: '123', key: 'CoLnKzljvQBrRKzO4CIfjbty8y+FVN7leGFF9DEbnzY=' }),
      } as Response)
      .mockResolvedValueOnce({ ok: true, status: 201, text: async () => '' } as Response);

    await setSecret(cfg, 'BETTER_AUTH_SECRET', 'super-secret-value', fetchFn);

    expect(fetchFn).toHaveBeenNthCalledWith(
      1,
      'https://api.github.com/repos/acme/sassy-auth/environments/production/secrets/public-key',
      expect.anything(),
    );
    const putCall = fetchFn.mock.calls[1];
    expect(putCall[0]).toBe(
      'https://api.github.com/repos/acme/sassy-auth/environments/production/secrets/BETTER_AUTH_SECRET',
    );
    expect(putCall[1].method).toBe('PUT');
    const body = JSON.parse(putCall[1].body);
    expect(body.key_id).toBe('123');
    expect(typeof body.encrypted_value).toBe('string');
  });

  it('throws when the PUT fails', async () => {
    const fetchFn = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ key_id: '123', key: 'CoLnKzljvQBrRKzO4CIfjbty8y+FVN7leGFF9DEbnzY=' }),
      } as Response)
      .mockResolvedValueOnce({ ok: false, status: 403, text: async () => 'forbidden' } as Response);

    await expect(setSecret(cfg, 'BETTER_AUTH_SECRET', 'value', fetchFn)).rejects.toThrow(/403/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/deploy-render && pnpm test githubSecrets`
Expected: FAIL — `Cannot find module './githubSecrets'`

- [ ] **Step 3: Implement the module**

`packages/deploy-render/src/githubSecrets.ts`:

```ts
import sodium from 'libsodium-wrappers';
import type { FetchLike } from './types';

export interface GithubConfig {
  owner: string;
  repo: string;
  environment: string;
  token: string;
}

interface EnvironmentPublicKey {
  key_id: string;
  key: string;
}

function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

function secretUrl(cfg: GithubConfig, name: string): string {
  return `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/environments/${cfg.environment}/secrets/${name}`;
}

export async function secretExists(
  cfg: GithubConfig,
  name: string,
  fetchFn: FetchLike = fetch,
): Promise<boolean> {
  const res = await fetchFn(secretUrl(cfg, name), { headers: authHeaders(cfg.token) });
  if (res.status === 404) return false;
  if (!res.ok) {
    throw new Error(`GitHub API error checking secret ${name}: ${res.status} ${await res.text()}`);
  }
  return true;
}

async function getEnvironmentPublicKey(
  cfg: GithubConfig,
  fetchFn: FetchLike,
): Promise<EnvironmentPublicKey> {
  const url = `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/environments/${cfg.environment}/secrets/public-key`;
  const res = await fetchFn(url, { headers: authHeaders(cfg.token) });
  if (!res.ok) {
    throw new Error(`GitHub API error fetching public key: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as EnvironmentPublicKey;
}

export async function sealSecret(value: string, publicKeyBase64: string): Promise<string> {
  await sodium.ready;
  const binKey = sodium.from_base64(publicKeyBase64, sodium.base64_variants.ORIGINAL);
  const binValue = sodium.from_string(value);
  const encrypted = sodium.crypto_box_seal(binValue, binKey);
  return sodium.to_base64(encrypted, sodium.base64_variants.ORIGINAL);
}

export async function setSecret(
  cfg: GithubConfig,
  name: string,
  value: string,
  fetchFn: FetchLike = fetch,
): Promise<void> {
  const publicKey = await getEnvironmentPublicKey(cfg, fetchFn);
  const encryptedValue = await sealSecret(value, publicKey.key);
  const res = await fetchFn(secretUrl(cfg, name), {
    method: 'PUT',
    headers: { ...authHeaders(cfg.token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ encrypted_value: encryptedValue, key_id: publicKey.key_id }),
  });
  if (!res.ok) {
    throw new Error(`GitHub API error setting secret ${name}: ${res.status} ${await res.text()}`);
  }
}

export async function setAndVerifySecret(
  cfg: GithubConfig,
  name: string,
  value: string,
  fetchFn: FetchLike = fetch,
): Promise<void> {
  await setSecret(cfg, name, value, fetchFn);
  if (!(await secretExists(cfg, name, fetchFn))) {
    throw new Error(`Secret ${name} was written to GitHub but does not read back as present`);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/deploy-render && pnpm test githubSecrets`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/deploy-render/src/githubSecrets.ts packages/deploy-render/src/githubSecrets.spec.ts
git commit -m "feat(deploy-render): add GitHub Environment secrets client"
```

---

### Task 3: Secret generation + `ensureSecrets()`

**Files:**
- Create: `packages/deploy-render/src/secrets.ts`
- Test: `packages/deploy-render/src/secrets.spec.ts`

- [ ] **Step 1: Write the failing tests**

`packages/deploy-render/src/secrets.spec.ts`:

```ts
import {
  generateRsaKeyPair,
  generateBetterAuthSecret,
  generateSeedAdminPassword,
  ensureSecrets,
} from './secrets';
import * as githubSecrets from './githubSecrets';
import type { GithubConfig } from './githubSecrets';

const cfg: GithubConfig = {
  owner: 'acme',
  repo: 'sassy-auth',
  environment: 'production',
  token: 'gh-token',
};

describe('generateRsaKeyPair', () => {
  it('returns base64-encoded PKCS8/SPKI PEM strings', () => {
    const { privateKey, publicKey } = generateRsaKeyPair();
    expect(Buffer.from(privateKey, 'base64').toString('utf8')).toContain('PRIVATE KEY');
    expect(Buffer.from(publicKey, 'base64').toString('utf8')).toContain('PUBLIC KEY');
  });
});

describe('generateBetterAuthSecret', () => {
  it('returns a 64-character hex string (32 random bytes)', () => {
    expect(generateBetterAuthSecret()).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('generateSeedAdminPassword', () => {
  it('returns a password at least 12 characters long', () => {
    expect(generateSeedAdminPassword().length).toBeGreaterThanOrEqual(12);
  });
});

describe('ensureSecrets', () => {
  afterEach(() => jest.restoreAllMocks());

  it('generates and stores every secret that does not already exist', async () => {
    jest.spyOn(githubSecrets, 'secretExists').mockResolvedValue(false);
    const setSpy = jest.spyOn(githubSecrets, 'setAndVerifySecret').mockResolvedValue(undefined);

    const result = await ensureSecrets(cfg, jest.fn());

    const generatedNames = result.generated.map((g) => g.name).sort();
    expect(generatedNames).toEqual(
      ['BETTER_AUTH_SECRET', 'RSA_PRIVATE_KEY', 'RSA_PUBLIC_KEY', 'SEED_ADMIN_PASSWORD'].sort(),
    );
    expect(setSpy).toHaveBeenCalledTimes(4);
  });

  it('skips secrets that already exist', async () => {
    jest.spyOn(githubSecrets, 'secretExists').mockResolvedValue(true);
    const setSpy = jest.spyOn(githubSecrets, 'setAndVerifySecret').mockResolvedValue(undefined);

    const result = await ensureSecrets(cfg, jest.fn());

    expect(result.generated).toEqual([]);
    expect(setSpy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/deploy-render && pnpm test secrets`
Expected: FAIL — `Cannot find module './secrets'`

- [ ] **Step 3: Implement the module**

`packages/deploy-render/src/secrets.ts`:

```ts
import crypto from 'node:crypto';
import { secretExists, setAndVerifySecret, type GithubConfig } from './githubSecrets';
import type { FetchLike } from './types';

export function generateRsaKeyPair(): { privateKey: string; publicKey: string } {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  return {
    privateKey: Buffer.from(privateKey.export({ type: 'pkcs8', format: 'pem' })).toString('base64'),
    publicKey: Buffer.from(publicKey.export({ type: 'spki', format: 'pem' })).toString('base64'),
  };
}

export function generateBetterAuthSecret(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function generateSeedAdminPassword(): string {
  // 24 random bytes as base64url is always >= PASSWORD_MIN_LENGTH (12, see
  // .env.example) with no ambiguous characters.
  return crypto.randomBytes(24).toString('base64url');
}

export interface GeneratedSecret {
  name: string;
  value: string;
}

export interface EnsureSecretsResult {
  generated: GeneratedSecret[];
}

export async function ensureSecrets(
  cfg: GithubConfig,
  fetchFn: FetchLike = fetch,
): Promise<EnsureSecretsResult> {
  const generated: GeneratedSecret[] = [];

  if (!(await secretExists(cfg, 'RSA_PRIVATE_KEY', fetchFn))) {
    const { privateKey, publicKey } = generateRsaKeyPair();
    await setAndVerifySecret(cfg, 'RSA_PRIVATE_KEY', privateKey, fetchFn);
    await setAndVerifySecret(cfg, 'RSA_PUBLIC_KEY', publicKey, fetchFn);
    generated.push({ name: 'RSA_PRIVATE_KEY', value: privateKey }, { name: 'RSA_PUBLIC_KEY', value: publicKey });
  }

  if (!(await secretExists(cfg, 'BETTER_AUTH_SECRET', fetchFn))) {
    const value = generateBetterAuthSecret();
    await setAndVerifySecret(cfg, 'BETTER_AUTH_SECRET', value, fetchFn);
    generated.push({ name: 'BETTER_AUTH_SECRET', value });
  }

  if (!(await secretExists(cfg, 'SEED_ADMIN_PASSWORD', fetchFn))) {
    const value = generateSeedAdminPassword();
    await setAndVerifySecret(cfg, 'SEED_ADMIN_PASSWORD', value, fetchFn);
    generated.push({ name: 'SEED_ADMIN_PASSWORD', value });
  }

  return { generated };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/deploy-render && pnpm test secrets`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/deploy-render/src/secrets.ts packages/deploy-render/src/secrets.spec.ts
git commit -m "feat(deploy-render): generate and persist missing production secrets"
```

---

### Task 4: Neon provisioning

**Files:**
- Create: `packages/deploy-render/src/neon.ts`
- Test: `packages/deploy-render/src/neon.spec.ts`

- [ ] **Step 1: Write the failing tests**

`packages/deploy-render/src/neon.spec.ts`:

```ts
import { findProjectByName, createProject, getPooledConnectionUri, ensureNeonDatabase } from './neon';
import * as githubSecrets from './githubSecrets';
import type { NeonConfig } from './neon';
import type { GithubConfig } from './githubSecrets';

const neonCfg: NeonConfig = {
  apiKey: 'neon-key',
  projectName: 'sassy-auth-production',
  databaseName: 'sassyauth',
  roleName: 'sassyauth_owner',
};
const githubCfg: GithubConfig = {
  owner: 'acme',
  repo: 'sassy-auth',
  environment: 'production',
  token: 'gh-token',
};

describe('findProjectByName', () => {
  it('returns the matching project', async () => {
    const fetchFn = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ projects: [{ id: 'p1', name: 'other' }, { id: 'p2', name: 'sassy-auth-production' }] }),
    } as Response);
    await expect(findProjectByName(neonCfg, fetchFn)).resolves.toEqual({ id: 'p2', name: 'sassy-auth-production' });
  });

  it('returns undefined when no project matches', async () => {
    const fetchFn = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ projects: [] }) } as Response);
    await expect(findProjectByName(neonCfg, fetchFn)).resolves.toBeUndefined();
  });
});

describe('createProject', () => {
  it('POSTs the project name and returns the created project', async () => {
    const fetchFn = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ project: { id: 'p3', name: 'sassy-auth-production' } }),
    } as Response);
    await expect(createProject(neonCfg, fetchFn)).resolves.toEqual({ id: 'p3', name: 'sassy-auth-production' });
    const body = JSON.parse(fetchFn.mock.calls[0][1].body);
    expect(body).toEqual({ project: { name: 'sassy-auth-production' } });
  });
});

describe('getPooledConnectionUri', () => {
  it('requests a pooled URI for the configured database and role', async () => {
    const fetchFn = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ uri: 'postgresql://user:pass@ep-xxx-pooler.neon.tech/sassyauth?sslmode=require' }),
    } as Response);
    const uri = await getPooledConnectionUri(neonCfg, 'p2', fetchFn);
    expect(uri).toContain('pooler');
    const calledUrl = fetchFn.mock.calls[0][0] as string;
    expect(calledUrl).toContain('pooled=true');
    expect(calledUrl).toContain('database_name=sassyauth');
  });
});

describe('ensureNeonDatabase', () => {
  afterEach(() => jest.restoreAllMocks());

  it('does nothing when DATABASE_URL already exists', async () => {
    jest.spyOn(githubSecrets, 'secretExists').mockResolvedValue(true);
    const result = await ensureNeonDatabase(neonCfg, githubCfg, jest.fn());
    expect(result).toEqual({ created: false });
  });

  it('creates a project and stores the pooled URI when DATABASE_URL is missing', async () => {
    jest.spyOn(githubSecrets, 'secretExists').mockResolvedValue(false);
    const setSpy = jest.spyOn(githubSecrets, 'setSecret').mockResolvedValue(undefined);
    const fetchFn = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ projects: [] }) } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ project: { id: 'p9', name: 'sassy-auth-production' } }) } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ uri: 'postgresql://pooled-uri' }) } as Response);

    const result = await ensureNeonDatabase(neonCfg, githubCfg, fetchFn);

    expect(result).toEqual({ created: true, databaseUrl: 'postgresql://pooled-uri' });
    expect(setSpy).toHaveBeenCalledWith(githubCfg, 'DATABASE_URL', 'postgresql://pooled-uri', fetchFn);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/deploy-render && pnpm test neon`
Expected: FAIL — `Cannot find module './neon'`

- [ ] **Step 3: Implement the module**

`packages/deploy-render/src/neon.ts`:

```ts
import { secretExists, setSecret, type GithubConfig } from './githubSecrets';
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
  await setSecret(githubCfg, 'DATABASE_URL', uri, fetchFn);
  return { created: true, databaseUrl: uri };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/deploy-render && pnpm test neon`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/deploy-render/src/neon.ts packages/deploy-render/src/neon.spec.ts
git commit -m "feat(deploy-render): provision Neon database via API"
```

---

### Task 5: Render service sync, deploy polling, and job triggering

**Files:**
- Create: `packages/deploy-render/src/render.ts`
- Test: `packages/deploy-render/src/render.spec.ts`

- [ ] **Step 1: Write the failing tests**

`packages/deploy-render/src/render.spec.ts`:

```ts
import {
  findServiceIdByName,
  setEnvVars,
  getLatestDeployStatus,
  waitForLiveDeploy,
  startJob,
  waitForJobCompletion,
  type RenderConfig,
} from './render';

const cfg: RenderConfig = { apiKey: 'render-key' };

describe('findServiceIdByName', () => {
  it('returns the id of the exactly-matching service', async () => {
    const fetchFn = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        { service: { id: 'srv-1', name: 'sassy-auth-admin' } },
        { service: { id: 'srv-2', name: 'sassy-auth-server' } },
      ],
    } as Response);
    await expect(findServiceIdByName(cfg, 'sassy-auth-server', fetchFn)).resolves.toBe('srv-2');
  });

  it('throws when no service matches', async () => {
    const fetchFn = jest.fn().mockResolvedValue({ ok: true, json: async () => [] } as Response);
    await expect(findServiceIdByName(cfg, 'missing', fetchFn)).rejects.toThrow(/No Render service/);
  });
});

describe('setEnvVars', () => {
  it('PUTs the full env var array to the service', async () => {
    const fetchFn = jest.fn().mockResolvedValue({ ok: true, status: 200 } as Response);
    await setEnvVars(cfg, 'srv-2', [{ key: 'NODE_ENV', value: 'production' }], fetchFn);
    expect(fetchFn).toHaveBeenCalledWith(
      'https://api.render.com/v1/services/srv-2/env-vars',
      expect.objectContaining({ method: 'PUT' }),
    );
  });

  it('throws on a non-ok response', async () => {
    const fetchFn = jest.fn().mockResolvedValue({ ok: false, status: 422, text: async () => 'bad' } as Response);
    await expect(setEnvVars(cfg, 'srv-2', [], fetchFn)).rejects.toThrow(/422/);
  });
});

describe('waitForLiveDeploy', () => {
  it('resolves once the latest deploy status is live', async () => {
    const fetchFn = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => [{ deploy: { id: 'd1', status: 'build_in_progress' } }] } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => [{ deploy: { id: 'd1', status: 'live' } }] } as Response);
    const sleepFn = jest.fn().mockResolvedValue(undefined);

    await waitForLiveDeploy(cfg, 'srv-2', fetchFn, sleepFn, 1, 5);

    expect(sleepFn).toHaveBeenCalledTimes(1);
  });

  it('throws when the deploy reaches a terminal failure status', async () => {
    const fetchFn = jest
      .fn()
      .mockResolvedValue({ ok: true, json: async () => [{ deploy: { id: 'd1', status: 'build_failed' } }] } as Response);
    const sleepFn = jest.fn().mockResolvedValue(undefined);

    await expect(waitForLiveDeploy(cfg, 'srv-2', fetchFn, sleepFn, 1, 5)).rejects.toThrow(/build_failed/);
  });

  it('throws after exceeding maxAttempts', async () => {
    const fetchFn = jest
      .fn()
      .mockResolvedValue({ ok: true, json: async () => [{ deploy: { id: 'd1', status: 'build_in_progress' } }] } as Response);
    const sleepFn = jest.fn().mockResolvedValue(undefined);

    await expect(waitForLiveDeploy(cfg, 'srv-2', fetchFn, sleepFn, 1, 2)).rejects.toThrow(/Timed out/);
  });
});

describe('startJob / waitForJobCompletion', () => {
  it('starts a job and returns it', async () => {
    const fetchFn = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'job-1', status: 'pending' }) } as Response);
    const job = await startJob(cfg, 'srv-2', 'pnpm run seed', fetchFn);
    expect(job).toEqual({ id: 'job-1', status: 'pending' });
    const body = JSON.parse(fetchFn.mock.calls[0][1].body);
    expect(body).toEqual({ startCommand: 'pnpm run seed' });
  });

  it('polls until the job succeeds', async () => {
    const fetchFn = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'job-1', status: 'running' }) } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'job-1', status: 'succeeded' }) } as Response);
    const sleepFn = jest.fn().mockResolvedValue(undefined);

    const job = await waitForJobCompletion(cfg, 'srv-2', 'job-1', fetchFn, sleepFn, 1, 5);

    expect(job.status).toBe('succeeded');
  });

  it('throws when the job fails', async () => {
    const fetchFn = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'job-1', status: 'failed' }) } as Response);
    const sleepFn = jest.fn().mockResolvedValue(undefined);

    await expect(waitForJobCompletion(cfg, 'srv-2', 'job-1', fetchFn, sleepFn, 1, 5)).rejects.toThrow(/failed/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/deploy-render && pnpm test render.spec`
Expected: FAIL — `Cannot find module './render'`

- [ ] **Step 3: Implement the module**

`packages/deploy-render/src/render.ts`:

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/deploy-render && pnpm test render.spec`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/deploy-render/src/render.ts packages/deploy-render/src/render.spec.ts
git commit -m "feat(deploy-render): sync env vars and drive deploy/job polling via Render API"
```

---

### Task 6: `render.yaml` parser for static (non-secret) values

**Files:**
- Create: `packages/deploy-render/src/renderYaml.ts`
- Test: `packages/deploy-render/src/renderYaml.spec.ts`

- [ ] **Step 1: Write the failing tests**

`packages/deploy-render/src/renderYaml.spec.ts`:

```ts
import { parseRenderYaml, staticGroupValues, staticServiceValues } from './renderYaml';

const FIXTURE = `
envVarGroups:
  - name: sassy-auth-production
    envVars:
      - key: DATABASE_URL
        sync: false
      - key: BETTER_AUTH_URL
        value: https://auth-api.milissai.com
      - key: NODE_ENV
        value: production

services:
  - type: web
    name: sassy-auth-server
    envVars:
      - fromGroup: sassy-auth-production
      - key: NODE_VERSION
        value: "24"
      - key: RESEND_API_KEY
        sync: false
  - type: web
    name: sassy-auth-admin
    envVars:
      - fromGroup: sassy-auth-production
      - key: PUBLIC_AUTH_SERVER_URL
        value: https://auth-api.milissai.com
`;

describe('parseRenderYaml + staticGroupValues', () => {
  it('extracts only literal-value entries from the named group', () => {
    const doc = parseRenderYaml(FIXTURE);
    expect(staticGroupValues(doc, 'sassy-auth-production')).toEqual({
      BETTER_AUTH_URL: 'https://auth-api.milissai.com',
      NODE_ENV: 'production',
    });
  });

  it('returns an empty object for an unknown group', () => {
    const doc = parseRenderYaml(FIXTURE);
    expect(staticGroupValues(doc, 'missing-group')).toEqual({});
  });
});

describe('staticServiceValues', () => {
  it('extracts only literal-value entries for the named service', () => {
    const doc = parseRenderYaml(FIXTURE);
    expect(staticServiceValues(doc, 'sassy-auth-server')).toEqual({ NODE_VERSION: '24' });
    expect(staticServiceValues(doc, 'sassy-auth-admin')).toEqual({
      PUBLIC_AUTH_SERVER_URL: 'https://auth-api.milissai.com',
    });
  });

  it('returns an empty object for an unknown service', () => {
    const doc = parseRenderYaml(FIXTURE);
    expect(staticServiceValues(doc, 'missing-service')).toEqual({});
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/deploy-render && pnpm test renderYaml`
Expected: FAIL — `Cannot find module './renderYaml'`

- [ ] **Step 3: Implement the module**

`packages/deploy-render/src/renderYaml.ts`:

```ts
import { parse } from 'yaml';

export interface RenderYamlEnvVar {
  key: string;
  value?: string;
  sync?: boolean;
  fromGroup?: string;
}

export interface RenderYamlService {
  name: string;
  envVars?: RenderYamlEnvVar[];
}

export interface RenderYamlDocument {
  envVarGroups?: Array<{ name: string; envVars: RenderYamlEnvVar[] }>;
  services: RenderYamlService[];
}

export function parseRenderYaml(contents: string): RenderYamlDocument {
  return parse(contents) as RenderYamlDocument;
}

function literalValues(envVars: RenderYamlEnvVar[] | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  for (const envVar of envVars ?? []) {
    if (typeof envVar.value === 'string') {
      result[envVar.key] = envVar.value;
    }
  }
  return result;
}

export function staticGroupValues(doc: RenderYamlDocument, groupName: string): Record<string, string> {
  const group = doc.envVarGroups?.find((g) => g.name === groupName);
  return literalValues(group?.envVars);
}

export function staticServiceValues(doc: RenderYamlDocument, serviceName: string): Record<string, string> {
  const service = doc.services.find((s) => s.name === serviceName);
  return literalValues(service?.envVars);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/deploy-render && pnpm test renderYaml`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/deploy-render/src/renderYaml.ts packages/deploy-render/src/renderYaml.spec.ts
git commit -m "feat(deploy-render): parse static env var values out of render.yaml"
```

---

### Task 7: CLI entrypoint

**Files:**
- Create: `packages/deploy-render/src/cli.ts`

This task wires the previous modules together. It has no dedicated unit test file — `main()` is a thin composition of already-tested functions plus `process.env`/`fs` access, which is exercised by manually running `--dry-run` (Step 3) rather than mocked in Jest.

- [ ] **Step 1: Implement the CLI**

`packages/deploy-render/src/cli.ts`:

```ts
#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { ensureSecrets } from './secrets';
import { ensureNeonDatabase, type NeonConfig } from './neon';
import {
  findServiceIdByName,
  setEnvVars,
  waitForLiveDeploy,
  startJob,
  waitForJobCompletion,
  type RenderConfig,
  type RenderEnvVar,
} from './render';
import { parseRenderYaml, staticGroupValues, staticServiceValues } from './renderYaml';
import type { GithubConfig } from './githubSecrets';

const REQUIRED_SECRET_ENV_VARS = [
  'RSA_PRIVATE_KEY',
  'RSA_PUBLIC_KEY',
  'BETTER_AUTH_SECRET',
  'SEED_ADMIN_PASSWORD',
  'DATABASE_URL',
] as const;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function writeJobSummary(lines: string[]): void {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) {
    console.log(lines.join('\n'));
    return;
  }
  fs.appendFileSync(summaryPath, lines.join('\n') + '\n');
}

function toRenderEnvVars(values: Record<string, string>): RenderEnvVar[] {
  return Object.entries(values).map(([key, value]) => ({ key, value }));
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');

  const [owner, repo] = requireEnv('GITHUB_REPOSITORY').split('/');
  const githubCfg: GithubConfig = {
    owner,
    repo,
    environment: 'production',
    token: requireEnv('DEPLOY_GITHUB_TOKEN'),
  };
  const neonCfg: NeonConfig = {
    apiKey: requireEnv('NEON_API_KEY'),
    projectName: 'sassy-auth-production',
    databaseName: 'sassyauth',
    roleName: 'sassyauth_owner',
  };
  const renderCfg: RenderConfig = { apiKey: requireEnv('RENDER_API_KEY') };

  if (dryRun) {
    console.log(
      'Dry run: would ensure secrets, provision Neon, sync Render env vars for ' +
        'sassy-auth-server/sassy-auth-admin, wait for a live deploy, and trigger the seed job.',
    );
    return;
  }

  const secretsResult = await ensureSecrets(githubCfg);
  if (secretsResult.generated.length > 0) {
    writeJobSummary([
      '## New secrets generated — save these now',
      'These are stored as GitHub Environment secrets and will not be shown again.',
      '',
      ...secretsResult.generated.map((s) => `- \`${s.name}\`: \`${s.value}\``),
    ]);
  }

  const neonResult = await ensureNeonDatabase(neonCfg, githubCfg);

  const secretValues: Record<string, string> = {};
  for (const name of REQUIRED_SECRET_ENV_VARS) {
    if (process.env[name]) secretValues[name] = process.env[name] as string;
  }
  for (const generated of secretsResult.generated) {
    secretValues[generated.name] = generated.value;
  }
  if (neonResult.databaseUrl) {
    secretValues.DATABASE_URL = neonResult.databaseUrl;
  }
  for (const name of REQUIRED_SECRET_ENV_VARS) {
    if (!secretValues[name]) {
      throw new Error(
        `Missing value for ${name}. It exists in GitHub secrets but wasn't exposed to this job — ` +
          `add it to the workflow's env: block.`,
      );
    }
  }

  const renderYamlPath = path.resolve(__dirname, '../../../render.yaml');
  const doc = parseRenderYaml(fs.readFileSync(renderYamlPath, 'utf8'));
  const groupValues = staticGroupValues(doc, 'sassy-auth-production');

  const authServerValues: Record<string, string> = {
    ...groupValues,
    ...staticServiceValues(doc, 'sassy-auth-server'),
    RSA_PRIVATE_KEY: secretValues.RSA_PRIVATE_KEY,
    RSA_PUBLIC_KEY: secretValues.RSA_PUBLIC_KEY,
    BETTER_AUTH_SECRET: secretValues.BETTER_AUTH_SECRET,
    SEED_ADMIN_PASSWORD: secretValues.SEED_ADMIN_PASSWORD,
    DATABASE_URL: secretValues.DATABASE_URL,
  };
  const adminValues: Record<string, string> = {
    ...groupValues,
    ...staticServiceValues(doc, 'sassy-auth-admin'),
    RSA_PRIVATE_KEY: secretValues.RSA_PRIVATE_KEY,
    RSA_PUBLIC_KEY: secretValues.RSA_PUBLIC_KEY,
    BETTER_AUTH_SECRET: secretValues.BETTER_AUTH_SECRET,
    DATABASE_URL: secretValues.DATABASE_URL,
  };

  const authServerId = await findServiceIdByName(renderCfg, 'sassy-auth-server');
  const adminId = await findServiceIdByName(renderCfg, 'sassy-auth-admin');

  await setEnvVars(renderCfg, authServerId, toRenderEnvVars(authServerValues));
  await setEnvVars(renderCfg, adminId, toRenderEnvVars(adminValues));

  await waitForLiveDeploy(renderCfg, authServerId);

  const job = await startJob(renderCfg, authServerId, 'pnpm --filter @sassy-auth/db db:seed');
  await waitForJobCompletion(renderCfg, authServerId, job.id);

  console.log('Render deployment automation complete.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Type-check the package**

Run: `cd packages/deploy-render && pnpm exec tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Exercise the dry-run path locally**

Run:

```bash
cd packages/deploy-render
GITHUB_REPOSITORY=acme/sassy-auth DEPLOY_GITHUB_TOKEN=x NEON_API_KEY=x RENDER_API_KEY=x \
  pnpm exec ts-node --transpile-only src/cli.ts --dry-run
```

Expected output: `Dry run: would ensure secrets, provision Neon, sync Render env vars for sassy-auth-server/sassy-auth-admin, wait for a live deploy, and trigger the seed job.`

- [ ] **Step 4: Run the full test suite for the package**

Run: `cd packages/deploy-render && pnpm test`
Expected: PASS (all suites from Tasks 2–6)

- [ ] **Step 5: Commit**

```bash
git add packages/deploy-render/src/cli.ts
git commit -m "feat(deploy-render): add CLI entrypoint wiring secrets, Neon, and Render sync"
```

---

### Task 8: GitHub Actions workflow

**Files:**
- Create: `.github/workflows/deploy-render.yml`

- [ ] **Step 1: Write the workflow**

`.github/workflows/deploy-render.yml`:

```yaml
name: Deploy to Render

on:
  push:
    branches: [master]
  workflow_dispatch: {}

permissions:
  contents: read

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 9

      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: pnpm

      - name: Install deploy-render dependencies
        working-directory: packages/deploy-render
        run: pnpm install --no-frozen-lockfile

      - name: Run deploy automation
        working-directory: packages/deploy-render
        run: pnpm deploy
        env:
          GITHUB_REPOSITORY: ${{ github.repository }}
          DEPLOY_GITHUB_TOKEN: ${{ secrets.GH_SECRETS_PAT }}
          RENDER_API_KEY: ${{ secrets.RENDER_API_KEY }}
          NEON_API_KEY: ${{ secrets.NEON_API_KEY }}
          RSA_PRIVATE_KEY: ${{ secrets.RSA_PRIVATE_KEY }}
          RSA_PUBLIC_KEY: ${{ secrets.RSA_PUBLIC_KEY }}
          BETTER_AUTH_SECRET: ${{ secrets.BETTER_AUTH_SECRET }}
          SEED_ADMIN_PASSWORD: ${{ secrets.SEED_ADMIN_PASSWORD }}
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
```

`GH_SECRETS_PAT` is a fine-grained personal access token scoped to this repo's "Environments" write permission — the default `secrets.GITHUB_TOKEN` cannot write Environment secrets. This is documented as one-time manual setup in Task 9.

- [ ] **Step 2: Validate the workflow YAML parses**

Run: `pnpm exec node -e "require('yaml').parse(require('fs').readFileSync('.github/workflows/deploy-render.yml', 'utf8')); console.log('ok')"`
Expected: `ok`

(If `yaml` isn't hoisted to the root `node_modules`, run this from `packages/deploy-render` instead with a relative path to the workflow file.)

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/deploy-render.yml
git commit -m "ci: add automated Render deployment workflow"
```

---

### Task 9: Update DEPLOYMENT.md

**Files:**
- Modify: `DEPLOYMENT.md`

- [ ] **Step 1: Replace the manual secret/seed sections with the automated flow**

Replace DEPLOYMENT.md §2 ("Generate secrets"), §3.1 step 4 (the manual `sync: false` variable table), and §3.4 ("First-time seed") with a new section describing the automated pipeline. Insert this new section immediately after the "Prerequisites" section (before the current "1. Neon database" section), and delete the superseded content from the sections named above:

```markdown
## One-time setup for automated deploys

Deploys are automated by `.github/workflows/deploy-render.yml`, which runs
`packages/deploy-render` on every push to `master`. It generates and stores
missing secrets, provisions the Neon database, syncs env vars to
`sassy-auth-server` and `sassy-auth-admin` via the Render API, and runs the
platform seed as a Render Job — no dashboard clicks required after this
one-time setup:

1. Create a [Render API key](https://api-docs.render.com/reference/authentication) and store it as the `RENDER_API_KEY` secret on this repo's `production` GitHub Environment.
2. Create a [Neon API key](https://neon.tech/docs/manage/api-keys) and store it as `NEON_API_KEY` on the same Environment.
3. Create a fine-grained GitHub PAT scoped to this repo with **Environments: write** permission, and store it as `GH_SECRETS_PAT` (the default `GITHUB_TOKEN` can't write Environment secrets).
4. Connect this repository to Render as a Blueprint once (**Render Dashboard → New → Blueprint**) — Render has no public API for this first-time connection. On this first sync, Render will prompt for the `sync: false` variables; leave them blank and push to `master` — the workflow fills them in on the next run.
5. Point DNS at the CNAME targets Render shows for each custom domain (see §3.2 below) — a one-time step per domain.

On the first workflow run, generated secrets (RSA keypair, `BETTER_AUTH_SECRET`,
`SEED_ADMIN_PASSWORD`) are printed once to the GitHub Actions run's job summary
with a "save this now" warning, since GitHub secrets can't be read back after
creation. Every subsequent push reuses the same stored secrets.

See `docs/superpowers/specs/2026-09-16-render-deploy-automation-design.md` for
the full design.
```

- [ ] **Step 2: Remove the now-superseded manual instructions**

In DEPLOYMENT.md §2 ("Generate secrets (one time)"), delete the two `node -e` command blocks and the `SEED_ADMIN_PASSWORD` paragraph, replacing the section body with:

```markdown
Secret generation is automated — see "One-time setup for automated deploys" above. This section is kept only as a reference for the values' shape, in case you need to generate one manually for local development (see §8).
```

In DEPLOYMENT.md §3.1, delete step 4 (the table of `sync: false` variables to enter manually) — the automation now populates them before Render's Blueprint sync builds the service.

In DEPLOYMENT.md §3.4 ("First-time seed"), delete the manual `pnpm --filter @sassy-auth/db db:seed` shell instructions and replace with:

```markdown
Seeding is automated as a Render Job triggered by the deploy workflow after every successful deploy of `sassy-auth-server`. `db:seed` is idempotent, so re-running it on every deploy is safe.
```

- [ ] **Step 3: Commit**

```bash
git add DEPLOYMENT.md
git commit -m "docs(deployment): describe the automated Render deploy pipeline"
```

---

## Self-review notes

- **Spec coverage:** `ensureSecrets` (Task 3), `ensureNeonDatabase` (Task 4), `syncRenderEnvVars`/deploy+job polling (Task 5), `render.yaml` as source of truth for topology (Task 6/7), GitHub Actions trigger on push to master (Task 8), resource-server excluded throughout (Tasks 7–9 only ever reference `sassy-auth-server`/`sassy-auth-admin`), one-time manual setup documented (Task 9). Dry-run mode covered in Task 7 Step 3.
- **Placeholder scan:** none found — every step has literal code/commands.
- **Type consistency:** `GeneratedSecret`/`EnsureSecretsResult` (Task 3) match their usage in `cli.ts` (Task 7); `RenderEnvVar`, `RenderConfig` (Task 5) match `cli.ts` imports; `NeonConfig`/`ensureNeonDatabase`'s `{ created, databaseUrl? }` return (Task 4) matches how `cli.ts` reads `neonResult.databaseUrl`.
- **Not covered by an automated test:** `cli.ts`'s `main()` itself (Task 7) — it's a thin composition of tested functions plus environment/filesystem wiring, exercised manually via `--dry-run`. A future task could extract an integration test with all dependencies mocked if this grows more logic.
