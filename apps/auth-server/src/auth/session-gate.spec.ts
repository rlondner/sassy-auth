import { evaluateSessionGate } from './session-gate';

function dbWith(
  saUser: { status: string } | null,
  user: { createdAt: Date } | null = null,
) {
  return {
    saUser: { findUnique: jest.fn().mockResolvedValue(saUser) },
    user: { findUnique: jest.fn().mockResolvedValue(user) },
  };
}

describe('evaluateSessionGate', () => {
  it('allows an active user', async () => {
    const res = await evaluateSessionGate(dbWith({ status: 'active' }), 'ba-1');
    expect(res).toEqual({ allowed: true, status: 'active' });
  });

  it('blocks a pending user', async () => {
    const res = await evaluateSessionGate(dbWith({ status: 'pending' }), 'ba-1');
    expect(res).toEqual({ allowed: false, status: 'pending' });
  });

  it('blocks an inactive user', async () => {
    const res = await evaluateSessionGate(dbWith({ status: 'inactive' }), 'ba-1');
    expect(res).toEqual({ allowed: false, status: 'inactive' });
  });

  it('allows session creation if SaUser is missing but BetterAuth user is newly created', async () => {
    const res = await evaluateSessionGate(
      dbWith(null, { createdAt: new Date() }),
      'ba-new',
    );
    expect(res).toEqual({ allowed: true, status: null });
  });

  it('blocks session creation if SaUser is missing and BetterAuth user is stale', async () => {
    const res = await evaluateSessionGate(
      dbWith(null, { createdAt: new Date(Date.now() - 40 * 1000) }),
      'ba-stale',
    );
    expect(res).toEqual({ allowed: false, status: null });
  });

  it('blocks (fail closed) when no SaUser or BetterAuth user exists', async () => {
    const res = await evaluateSessionGate(dbWith(null, null), 'ba-unknown');
    expect(res).toEqual({ allowed: false, status: null });
  });
});
