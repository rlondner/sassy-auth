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
