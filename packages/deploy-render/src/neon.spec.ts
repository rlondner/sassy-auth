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
    const setSpy = jest.spyOn(githubSecrets, 'setAndVerifySecret').mockResolvedValue(undefined);
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
