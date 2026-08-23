import { recordFederationEvent } from './record-federation-event';

function makeDeps() {
  const created: unknown[] = [];
  const emitted: { severity: string; attributes: Record<string, unknown> }[] = [];
  return {
    created,
    emitted,
    deps: {
      db: { saAuditEvent: { create: async (args: { data: unknown }) => { created.push(args.data); } } },
      emit: (severity: string, attributes: Record<string, unknown>) => { emitted.push({ severity, attributes }); },
      logger: { warn: jest.fn() },
    },
  };
}

describe('recordFederationEvent', () => {
  it('writes the durable row with the real reason', async () => {
    const { deps, created } = makeDeps();
    await recordFederationEvent(deps, {
      type: 'social.signin.rejected',
      provider: 'google',
      reason: 'no_sauser_for_verified_email',
      email: 'alice@acme.com',
      providerSub: 'sub-123',
      appPublicId: 'qp31',
    });
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      type: 'social.signin.rejected',
      provider: 'google',
      reason: 'no_sauser_for_verified_email',
      email: 'alice@acme.com',
      providerSub: 'sub-123',
    });
  });

  it('keeps email and provider sub out of telemetry', async () => {
    const { deps, emitted } = makeDeps();
    await recordFederationEvent(deps, {
      type: 'social.signin.ok',
      provider: 'google',
      email: 'alice@acme.com',
      providerSub: 'sub-123',
      saUserPublicId: 'UkLW',
      appPublicId: 'qp31',
    });
    const serialized = JSON.stringify(emitted);
    expect(serialized).not.toContain('alice@acme.com');
    expect(serialized).not.toContain('sub-123');
    expect(emitted[0].attributes['auth.provider']).toBe('google');
    expect(emitted[0].attributes['user.public_id']).toBe('UkLW');
  });

  it('emits WARN for expected rejections and ERROR for unexpected failures', async () => {
    const { deps, emitted } = makeDeps();
    await recordFederationEvent(deps, { type: 'social.signin.rejected', provider: 'google', reason: 'email_unverified' });
    await recordFederationEvent(deps, { type: 'social.signin.rejected', provider: 'google', reason: 'provider_error', unexpected: true });
    expect(emitted[0].severity).toBe('WARN');
    expect(emitted[1].severity).toBe('ERROR');
  });

  it('never throws when the audit write fails', async () => {
    const { deps, emitted } = makeDeps();
    deps.db.saAuditEvent.create = async () => { throw new Error('db down'); };
    await expect(
      recordFederationEvent(deps, { type: 'social.signin.ok', provider: 'google' }),
    ).resolves.toBeUndefined();
    expect(deps.logger.warn).toHaveBeenCalled();
    expect(emitted).toHaveLength(1); // telemetry still emitted
  });
});
