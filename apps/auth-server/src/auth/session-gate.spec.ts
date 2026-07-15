import { evaluateSessionGate, type GateClient } from './session-gate';

describe('evaluateSessionGate', () => {
  const mockDb = (status: string | null): GateClient => ({
    saUser: {
      findUnique: jest.fn().mockResolvedValue(status ? { status } : null),
    },
  });

  it('allows an active user', async () => {
    const res = await evaluateSessionGate(mockDb('active'), 'uid');
    expect(res).toEqual({ allowed: true, status: 'active' });
  });

  it('blocks a pending user', async () => {
    const res = await evaluateSessionGate(mockDb('pending'), 'uid');
    expect(res).toEqual({ allowed: false, status: 'pending' });
  });

  it('blocks an inactive user', async () => {
    const res = await evaluateSessionGate(mockDb('inactive'), 'uid');
    expect(res).toEqual({ allowed: false, status: 'inactive' });
  });

  it('blocks (fail closed) when no SaUser exists', async () => {
    const res = await evaluateSessionGate(mockDb(null), 'uid');
    expect(res).toEqual({ allowed: false, status: null });
  });

  it('allows bypass when SKIP_SESSION_GATE is true', async () => {
    process.env.SKIP_SESSION_GATE = 'true';
    try {
      const res = await evaluateSessionGate(mockDb(null), 'uid');
      expect(res).toEqual({ allowed: true, status: 'active' });
    } finally {
      delete process.env.SKIP_SESSION_GATE;
    }
  });
});
