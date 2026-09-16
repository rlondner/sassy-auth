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
  it('POSTs the project name and branch database/role names, and returns the created project', async () => {
    const fetchFn = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ project: { id: 'p3', name: 'sassy-auth-production' } }),
    } as Response);
    await expect(createProject(neonCfg, fetchFn)).resolves.toEqual({ id: 'p3', name: 'sassy-auth-production' });
    const body = JSON.parse(fetchFn.mock.calls[0][1].body);
    expect(body).toEqual({
      project: {
        name: 'sassy-auth-production',
        branch: { database_name: 'sassyauth', role_name: 'sassyauth_owner' },
      },
    });
  });
});

describe('org-scoped API keys', () => {
  const orgCfg: NeonConfig = { ...neonCfg, orgId: 'org-123' };

  it('findProjectByName includes org_id as a query param', async () => {
    const fetchFn = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ projects: [] }) } as Response);
    await findProjectByName(orgCfg, fetchFn);
    const calledUrl = fetchFn.mock.calls[0][0] as string;
    expect(calledUrl).toContain('org_id=org-123');
  });

  it('createProject includes org_id in the request body', async () => {
    const fetchFn = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ project: { id: 'p3', name: 'sassy-auth-production' } }),
    } as Response);
    await createProject(orgCfg, fetchFn);
    const body = JSON.parse(fetchFn.mock.calls[0][1].body);
    expect(body).toEqual({
      project: {
        name: 'sassy-auth-production',
        org_id: 'org-123',
        branch: { database_name: 'sassyauth', role_name: 'sassyauth_owner' },
      },
    });
  });
});

describe('createProject with a region', () => {
  it('includes region_id in the request body when configured', async () => {
    const regionCfg: NeonConfig = { ...neonCfg, regionId: 'aws-us-east-2' };
    const fetchFn = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ project: { id: 'p3', name: 'sassy-auth-production' } }),
    } as Response);
    await createProject(regionCfg, fetchFn);
    const body = JSON.parse(fetchFn.mock.calls[0][1].body);
    expect(body).toEqual({
      project: {
        name: 'sassy-auth-production',
        region_id: 'aws-us-east-2',
        branch: { database_name: 'sassyauth', role_name: 'sassyauth_owner' },
      },
    });
  });

  it('omits region_id when not configured', async () => {
    const fetchFn = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ project: { id: 'p3', name: 'sassy-auth-production' } }),
    } as Response);
    await createProject(neonCfg, fetchFn);
    const body = JSON.parse(fetchFn.mock.calls[0][1].body);
    expect(body.project).not.toHaveProperty('region_id');
  });

  it('omits org_id when not configured', async () => {
    const fetchFn = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ projects: [] }) } as Response);
    await findProjectByName(neonCfg, fetchFn);
    const calledUrl = fetchFn.mock.calls[0][0] as string;
    expect(calledUrl).not.toContain('org_id');
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

  it('creates a project (with its branch/role/database already named correctly) and stores the pooled URI when DATABASE_URL is missing', async () => {
    jest.spyOn(githubSecrets, 'secretExists').mockResolvedValue(false);
    const setSpy = jest.spyOn(githubSecrets, 'setAndVerifySecret').mockResolvedValue(undefined);
    const fetchFn = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ projects: [] }) } as Response) // findProjectByName
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ project: { id: 'p9', name: 'sassy-auth-production' } }),
      } as Response) // createProject
      .mockResolvedValueOnce({ ok: true, json: async () => ({ branches: [{ id: 'br1', default: true }] }) } as Response) // getDefaultBranchId
      .mockResolvedValueOnce({ ok: true, json: async () => ({ roles: [{ name: 'sassyauth_owner' }] }) } as Response) // ensureRole: already exists
      .mockResolvedValueOnce({ ok: true, json: async () => ({ databases: [{ name: 'sassyauth' }] }) } as Response) // ensureDatabase: already exists
      .mockResolvedValueOnce({ ok: true, json: async () => ({ uri: 'postgresql://pooled-uri' }) } as Response); // getPooledConnectionUri

    const result = await ensureNeonDatabase(neonCfg, githubCfg, fetchFn);

    expect(result).toEqual({ created: true, databaseUrl: 'postgresql://pooled-uri' });
    expect(setSpy).toHaveBeenCalledWith(githubCfg, 'DATABASE_URL', 'postgresql://pooled-uri', fetchFn);
    expect(fetchFn).toHaveBeenCalledTimes(6);
  });

  it('creates the role and database on an existing project that predates this pipeline (the manual-setup case)', async () => {
    jest.spyOn(githubSecrets, 'secretExists').mockResolvedValue(false);
    jest.spyOn(githubSecrets, 'setAndVerifySecret').mockResolvedValue(undefined);
    const fetchFn = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ projects: [{ id: 'p2', name: 'sassy-auth-production' }] }),
      } as Response) // findProjectByName: found, no createProject call follows
      .mockResolvedValueOnce({ ok: true, json: async () => ({ branches: [{ id: 'br1', default: true }] }) } as Response) // getDefaultBranchId
      .mockResolvedValueOnce({ ok: true, json: async () => ({ roles: [{ name: 'neondb_owner' }] }) } as Response) // ensureRole: missing
      .mockResolvedValueOnce({ ok: true, status: 201 } as Response) // ensureRole: create
      .mockResolvedValueOnce({ ok: true, json: async () => ({ databases: [{ name: 'neondb' }] }) } as Response) // ensureDatabase: missing
      .mockResolvedValueOnce({ ok: true, status: 201 } as Response) // ensureDatabase: create
      .mockResolvedValueOnce({ ok: true, json: async () => ({ uri: 'postgresql://pooled-uri' }) } as Response); // getPooledConnectionUri

    const result = await ensureNeonDatabase(neonCfg, githubCfg, fetchFn);

    expect(result).toEqual({ created: true, databaseUrl: 'postgresql://pooled-uri' });
    expect(fetchFn).toHaveBeenNthCalledWith(
      4,
      'https://console.neon.tech/api/v2/projects/p2/branches/br1/roles',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(JSON.parse(fetchFn.mock.calls[3][1].body)).toEqual({ role: { name: 'sassyauth_owner' } });
    expect(fetchFn).toHaveBeenNthCalledWith(
      6,
      'https://console.neon.tech/api/v2/projects/p2/branches/br1/databases',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(JSON.parse(fetchFn.mock.calls[5][1].body)).toEqual({
      database: { name: 'sassyauth', owner_name: 'sassyauth_owner' },
    });
  });

  it('throws when the project has no branches', async () => {
    jest.spyOn(githubSecrets, 'secretExists').mockResolvedValue(false);
    const fetchFn = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ projects: [{ id: 'p2', name: 'sassy-auth-production' }] }) } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ branches: [] }) } as Response);

    await expect(ensureNeonDatabase(neonCfg, githubCfg, fetchFn)).rejects.toThrow(/no branches/);
  });
});
