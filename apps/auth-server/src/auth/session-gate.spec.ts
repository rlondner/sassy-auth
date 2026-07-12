import { evaluateSessionGate } from './session-gate';

function dbWith(user: { status: string } | null) {
  return { saUser: { findUnique: jest.fn().mockResolvedValue(user) } };
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

  it('blocks (fail closed) when no SaUser exists', async () => {
    const res = await evaluateSessionGate(dbWith(null), 'ba-unknown');
    expect(res).toEqual({ allowed: false, status: null });
  });
});
