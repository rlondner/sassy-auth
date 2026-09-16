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
