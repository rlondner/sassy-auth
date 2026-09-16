#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { ensureSecrets } from './secrets';
import { ensureNeonDatabase, type NeonConfig } from './neon';
import {
  findServiceIdByName,
  syncManagedEnvVars,
  triggerDeploy,
  waitForDeploy,
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

async function withServiceContext<T>(serviceName: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`[${serviceName}] ${message}`);
  }
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
    projectName: 'sassy-auth',
    databaseName: 'sassyauth',
    roleName: 'sassyauth_owner',
    // Only required when NEON_API_KEY is an organization API key.
    orgId: process.env.NEON_ORG_ID || undefined,
    // Matches the Render services' region (see render.yaml) — keeps the app and its
    // database in the same region instead of Neon's own default.
    regionId: 'aws-us-east-2',
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
      '## New secrets generated',
      'These are now stored as GitHub Environment secrets (production) and were not printed anywhere — GitHub secrets are write-only after creation, so there is no way to view them again through this pipeline.',
      '',
      ...secretsResult.generated.map((s) => `- \`${s.name}\``),
      '',
      'If any of these need rotating in the future, delete the secret from the repo\'s "production" Environment on GitHub and re-run this workflow — it will generate and store a fresh value automatically (this invalidates existing JWTs/sessions for the RSA keypair and BETTER_AUTH_SECRET respectively; see DEPLOYMENT.md).',
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

  // Assumes execution via ts-node from src/ (the "deploy" script) — three levels up reaches the
  // repo root; would need adjustment if ever run from a compiled dist/ build.
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

  await withServiceContext('sassy-auth-server', () =>
    syncManagedEnvVars(renderCfg, authServerId, toRenderEnvVars(authServerValues)),
  );
  await withServiceContext('sassy-auth-admin', () =>
    syncManagedEnvVars(renderCfg, adminId, toRenderEnvVars(adminValues)),
  );

  // Syncing env vars above does NOT itself trigger a new deploy. Relying on the push's own
  // autoDeploy would race this sync — that deploy can start (and fail its preDeployCommand,
  // e.g. `prisma migrate deploy` with no DATABASE_URL yet) before the sync above completes.
  // Trigger fresh deploys now, after secrets are in place, and wait on those specific deploys.
  const authServerDeploy = await withServiceContext('sassy-auth-server', () =>
    triggerDeploy(renderCfg, authServerId),
  );
  const adminDeploy = await withServiceContext('sassy-auth-admin', () => triggerDeploy(renderCfg, adminId));

  // Waited in parallel, not sequentially — each can take up to ~10 minutes, and this job
  // has a fixed overall timeout (see deploy-render.yml) shared with the db:seed waits below.
  await Promise.all([
    withServiceContext('sassy-auth-server', () => waitForDeploy(renderCfg, authServerId, authServerDeploy.id)),
    withServiceContext('sassy-auth-admin', () => waitForDeploy(renderCfg, adminId, adminDeploy.id)),
  ]);

  await withServiceContext('sassy-auth-server', async () => {
    const job = await startJob(renderCfg, authServerId, 'pnpm --filter @sassy-auth/db db:seed');
    await waitForJobCompletion(renderCfg, authServerId, job.id);
  });

  // Runs after db:seed so the platform app/org/Platform Super Admin role it
  // creates already exist — vibecast-migration.ts only provisions the
  // vibecast app, org, and admin. Both jobs are idempotent, so re-running
  // them on every deploy is safe.
  await withServiceContext('sassy-auth-server', async () => {
    const job = await startJob(renderCfg, authServerId, 'pnpm --filter @sassy-auth/db db:seed:vibecast');
    await waitForJobCompletion(renderCfg, authServerId, job.id);
  });

  console.log('Render deployment automation complete.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
