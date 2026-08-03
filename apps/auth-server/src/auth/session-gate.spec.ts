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

  it('allows a recently created user even if no SaUser exists', async () => {
    const db = {
      saUser: { findUnique: jest.fn().mockResolvedValue(null) },
      user: { findUnique: jest.fn().mockResolvedValue({ createdAt: new Date() }) },
    };
    const res = await evaluateSessionGate(db, 'ba-recent');
    expect(res).toEqual({ allowed: true, status: null });
  });

  it('blocks a user created long ago if no SaUser exists', async () => {
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    const db = {
      saUser: { findUnique: jest.fn().mockResolvedValue(null) },
      user: { findUnique: jest.fn().mockResolvedValue({ createdAt: tenMinutesAgo }) },
    };
    const res = await evaluateSessionGate(db, 'ba-old');
    expect(res).toEqual({ allowed: false, status: null });
  });
});
