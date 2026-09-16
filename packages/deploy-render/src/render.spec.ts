import {
  findServiceIdByName,
  setEnvVars,
  getEnvVars,
  mergeEnvVars,
  syncManagedEnvVars,
  getLatestDeployStatus,
  waitForLiveDeploy,
  triggerDeploy,
  getDeployStatus,
  waitForDeploy,
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

describe('getEnvVars', () => {
  it('parses the [{envVar: {key, value}}] response shape', async () => {
    const fetchFn = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        { envVar: { key: 'NODE_ENV', value: 'production' } },
        { envVar: { key: 'RESEND_API_KEY', value: 'resend-secret' } },
      ],
    } as Response);
    await expect(getEnvVars(cfg, 'srv-2', fetchFn)).resolves.toEqual([
      { key: 'NODE_ENV', value: 'production' },
      { key: 'RESEND_API_KEY', value: 'resend-secret' },
    ]);
    expect(fetchFn).toHaveBeenCalledWith(
      'https://api.render.com/v1/services/srv-2/env-vars',
      expect.objectContaining({ headers: expect.anything() }),
    );
  });

  it('throws on a non-ok response', async () => {
    const fetchFn = jest.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' } as Response);
    await expect(getEnvVars(cfg, 'srv-2', fetchFn)).rejects.toThrow(/500/);
  });
});

describe('mergeEnvVars', () => {
  it('lets desired override an existing key with the same name', () => {
    const result = mergeEnvVars(
      [{ key: 'FOO', value: 'old' }],
      [{ key: 'FOO', value: 'new' }],
    );
    expect(result).toEqual([{ key: 'FOO', value: 'new' }]);
  });

  it('preserves a key only present in existing', () => {
    const result = mergeEnvVars(
      [{ key: 'RESEND_API_KEY', value: 'resend-secret' }],
      [{ key: 'DATABASE_URL', value: 'postgres://...' }],
    );
    expect(result).toEqual(
      expect.arrayContaining([
        { key: 'RESEND_API_KEY', value: 'resend-secret' },
        { key: 'DATABASE_URL', value: 'postgres://...' },
      ]),
    );
    expect(result).toHaveLength(2);
  });

  it('adds a key only present in desired', () => {
    const result = mergeEnvVars([], [{ key: 'DATABASE_URL', value: 'postgres://...' }]);
    expect(result).toEqual([{ key: 'DATABASE_URL', value: 'postgres://...' }]);
  });

  it('handles empty existing and empty desired', () => {
    expect(mergeEnvVars([], [])).toEqual([]);
    expect(mergeEnvVars([{ key: 'FOO', value: 'bar' }], [])).toEqual([{ key: 'FOO', value: 'bar' }]);
  });
});

describe('syncManagedEnvVars', () => {
  it('fetches existing env vars, merges desired on top, and PUTs the merged set', async () => {
    const fetchFn = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { envVar: { key: 'RESEND_API_KEY', value: 'resend-secret' } },
          { envVar: { key: 'DATABASE_URL', value: 'old-url' } },
        ],
      } as Response)
      .mockResolvedValueOnce({ ok: true, status: 200 } as Response);

    await syncManagedEnvVars(cfg, 'srv-2', [{ key: 'DATABASE_URL', value: 'new-url' }], fetchFn);

    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(fetchFn).toHaveBeenNthCalledWith(
      1,
      'https://api.render.com/v1/services/srv-2/env-vars',
      expect.objectContaining({ headers: expect.anything() }),
    );
    expect(fetchFn).toHaveBeenNthCalledWith(
      2,
      'https://api.render.com/v1/services/srv-2/env-vars',
      expect.objectContaining({ method: 'PUT' }),
    );
    const putBody = JSON.parse((fetchFn.mock.calls[1][1] as { body: string }).body);
    expect(putBody).toEqual(
      expect.arrayContaining([
        { key: 'RESEND_API_KEY', value: 'resend-secret' },
        { key: 'DATABASE_URL', value: 'new-url' },
      ]),
    );
    expect(putBody).toHaveLength(2);
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

  it('treats pre_deploy_failed as a terminal failure', async () => {
    const fetchFn = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ deploy: { id: 'd1', status: 'pre_deploy_failed' } }],
    } as Response);
    const sleepFn = jest.fn().mockResolvedValue(undefined);

    await expect(waitForLiveDeploy(cfg, 'srv-2', fetchFn, sleepFn, 1, 5)).rejects.toThrow(/pre_deploy_failed/);
    expect(sleepFn).not.toHaveBeenCalled();
  });
});

describe('triggerDeploy', () => {
  it('POSTs to the deploys endpoint and returns the created deploy', async () => {
    const fetchFn = jest
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ id: 'd9', status: 'created' }) } as Response);
    await expect(triggerDeploy(cfg, 'srv-2', fetchFn)).resolves.toEqual({ id: 'd9', status: 'created' });
    expect(fetchFn).toHaveBeenCalledWith(
      'https://api.render.com/v1/services/srv-2/deploys',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('throws on a non-ok response', async () => {
    const fetchFn = jest.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' } as Response);
    await expect(triggerDeploy(cfg, 'srv-2', fetchFn)).rejects.toThrow(/500/);
  });
});

describe('waitForDeploy', () => {
  it('polls the specific deploy id, ignoring other deploys on the service', async () => {
    const fetchFn = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'd9', status: 'update_in_progress' }) } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'd9', status: 'live' }) } as Response);
    const sleepFn = jest.fn().mockResolvedValue(undefined);

    await waitForDeploy(cfg, 'srv-2', 'd9', fetchFn, sleepFn, 1, 5);

    expect(fetchFn).toHaveBeenCalledWith(
      'https://api.render.com/v1/services/srv-2/deploys/d9',
      expect.objectContaining({ headers: expect.anything() }),
    );
    expect(sleepFn).toHaveBeenCalledTimes(1);
  });

  it('throws when the specific deploy reaches a terminal failure status', async () => {
    const fetchFn = jest
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ id: 'd9', status: 'pre_deploy_failed' }) } as Response);
    const sleepFn = jest.fn().mockResolvedValue(undefined);

    await expect(waitForDeploy(cfg, 'srv-2', 'd9', fetchFn, sleepFn, 1, 5)).rejects.toThrow(/pre_deploy_failed/);
  });
});

describe('getDeployStatus', () => {
  it('throws on a non-ok response', async () => {
    const fetchFn = jest.fn().mockResolvedValue({ ok: false, status: 404, text: async () => 'not found' } as Response);
    await expect(getDeployStatus(cfg, 'srv-2', 'd9', fetchFn)).rejects.toThrow(/404/);
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
