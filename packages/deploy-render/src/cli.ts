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

interface DeployTarget {
  githubEnvironment: string;
  // Blueprint file this target's static env var values are read from. Production and
  // staging live in separate Render accounts (each with its own RENDER_API_KEY, scoped
  // per GitHub Environment), so each has its own blueprint file — a single file listing
  // both would let a Blueprint apply in one account see the other account's services.
  renderYamlFile: string;
  renderGroupName: string;
  authServerName: string;
  adminName: string;
  // Neon branch to provision/target — undefined means the project's default (production)
  // branch. Both targets share the same Neon project; staging is a branch of it, not a
  // separate project.
  neonBranchName?: string;
}

const DEPLOY_TARGETS: Record<string, DeployTarget> = {
  production: {
    githubEnvironment: 'production',
    renderYamlFile: 'render.yaml',
    renderGroupName: 'sassy-auth-production',
    authServerName: 'sassy-auth-server',
    adminName: 'sassy-auth-admin',
  },
  staging: {
    githubEnvironment: 'staging',
    renderYamlFile: 'render.staging.yaml',
    renderGroupName: 'sassy-auth-staging',
    authServerName: 'sassy-auth-server-staging',
    adminName: 'sassy-auth-admin-staging',
    neonBranchName: 'staging',
  },
};

function resolveDeployTarget(): DeployTarget {
  const name = process.env.DEPLOY_TARGET || 'production';
  const target = DEPLOY_TARGETS[name];
  if (!target) {
    throw new Error(`Unknown DEPLOY_TARGET "${name}" — expected one of: ${Object.keys(DEPLOY_TARGETS).join(', ')}`);
  }
  return target;
}

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
  const target = resolveDeployTarget();

  const [owner, repo] = requireEnv('GITHUB_REPOSITORY').split('/');
  const githubCfg: GithubConfig = {
    owner,
    repo,
    environment: target.githubEnvironment,
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
    branchName: target.neonBranchName,
  };
  const renderCfg: RenderConfig = { apiKey: requireEnv('RENDER_API_KEY') };

  if (dryRun) {
    console.log(
      `Dry run (${target.githubEnvironment}): would ensure secrets, provision Neon, sync Render env vars for ` +
        `${target.authServerName}/${target.adminName}, wait for a live deploy, and trigger the seed job.`,
    );
    return;
  }

  const secretsResult = await ensureSecrets(githubCfg);
  if (secretsResult.generated.length > 0) {
    writeJobSummary([
      '## New secrets generated',
      `These are now stored as GitHub Environment secrets (${target.githubEnvironment}) and were not printed anywhere — GitHub secrets are write-only after creation, so there is no way to view them again through this pipeline.`,
      '',
      ...secretsResult.generated.map((s) => `- \`${s.name}\``),
      '',
      `If any of these need rotating in the future, delete the secret from the repo's "${target.githubEnvironment}" Environment on GitHub and re-run this workflow — it will generate and store a fresh value automatically (this invalidates existing JWTs/sessions for the RSA keypair and BETTER_AUTH_SECRET respectively; see DEPLOYMENT.md).`,
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
  const renderYamlPath = path.resolve(__dirname, '../../../', target.renderYamlFile);
  const doc = parseRenderYaml(fs.readFileSync(renderYamlPath, 'utf8'));
  const groupValues = staticGroupValues(doc, target.renderGroupName);

  const authServerValues: Record<string, string> = {
    ...groupValues,
    ...staticServiceValues(doc, target.authServerName),
    RSA_PRIVATE_KEY: secretValues.RSA_PRIVATE_KEY,
    RSA_PUBLIC_KEY: secretValues.RSA_PUBLIC_KEY,
    BETTER_AUTH_SECRET: secretValues.BETTER_AUTH_SECRET,
    SEED_ADMIN_PASSWORD: secretValues.SEED_ADMIN_PASSWORD,
    DATABASE_URL: secretValues.DATABASE_URL,
  };
  const adminValues: Record<string, string> = {
    ...groupValues,
    ...staticServiceValues(doc, target.adminName),
    RSA_PRIVATE_KEY: secretValues.RSA_PRIVATE_KEY,
    RSA_PUBLIC_KEY: secretValues.RSA_PUBLIC_KEY,
    BETTER_AUTH_SECRET: secretValues.BETTER_AUTH_SECRET,
    DATABASE_URL: secretValues.DATABASE_URL,
  };

  const authServerId = await findServiceIdByName(renderCfg, target.authServerName);
  const adminId = await findServiceIdByName(renderCfg, target.adminName);

  await withServiceContext(target.authServerName, () =>
    syncManagedEnvVars(renderCfg, authServerId, toRenderEnvVars(authServerValues)),
  );
  await withServiceContext(target.adminName, () =>
    syncManagedEnvVars(renderCfg, adminId, toRenderEnvVars(adminValues)),
  );

  // Syncing env vars above does NOT itself trigger a new deploy. Relying on the push's own
  // autoDeploy would race this sync — that deploy can start (and fail its preDeployCommand,
  // e.g. `prisma migrate deploy` with no DATABASE_URL yet) before the sync above completes.
  // Trigger fresh deploys now, after secrets are in place, and wait on those specific deploys.
  const authServerDeploy = await withServiceContext(target.authServerName, () =>
    triggerDeploy(renderCfg, authServerId),
  );
  const adminDeploy = await withServiceContext(target.adminName, () => triggerDeploy(renderCfg, adminId));

  // Waited in parallel, not sequentially — each can take up to ~10 minutes, and this job
  // has a fixed overall timeout (see deploy-render.yml) shared with the db:seed waits below.
  await Promise.all([
    withServiceContext(target.authServerName, () => waitForDeploy(renderCfg, authServerId, authServerDeploy.id)),
    withServiceContext(target.adminName, () => waitForDeploy(renderCfg, adminId, adminDeploy.id)),
  ]);

  await withServiceContext(target.authServerName, async () => {
    const job = await startJob(renderCfg, authServerId, 'pnpm --filter @sassy-auth/db db:seed');
    await waitForJobCompletion(renderCfg, authServerId, job.id);
  });

  // Runs after db:seed so the platform app/org/Platform Super Admin role it
  // creates already exist — vibecast-migration.ts only provisions the
  // vibecast app, org, and admin. Both jobs are idempotent, so re-running
  // them on every deploy is safe.
  await withServiceContext(target.authServerName, async () => {
    const job = await startJob(renderCfg, authServerId, 'pnpm --filter @sassy-auth/db db:seed:vibecast');
    await waitForJobCompletion(renderCfg, authServerId, job.id);
  });

  console.log(`Render deployment automation complete (${target.githubEnvironment}).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
