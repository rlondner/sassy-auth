import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { BetterAuthGuard } from './better-auth.guard';

// Mock auth module so tests don't require a real DB.
jest.mock('./auth.config', () => ({
  auth: {
    api: {
      getSession: jest.fn(),
    },
  },
}));

import { auth } from './auth.config';

const mockGetSession = auth.api.getSession as unknown as jest.Mock;

function makeContext(headers: Record<string, string> = {}): ExecutionContext {
  const request = { headers };
  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
}

describe('BetterAuthGuard', () => {
  let guard: BetterAuthGuard;

  beforeEach(() => {
    guard = new BetterAuthGuard();
    jest.clearAllMocks();
  });

  it('returns true and attaches user when session is valid', async () => {
    const fakeUser = { id: 'ba-user-id', email: 'test@example.com' };
    mockGetSession.mockResolvedValue({ user: fakeUser, session: {} });

    const ctx = makeContext({ cookie: 'better-auth.session_token=abc' });
    const request = ctx.switchToHttp().getRequest() as Record<string, unknown>;

    const result = await guard.canActivate(ctx);

    expect(result).toBe(true);
    expect(request['betterAuthUser']).toEqual(fakeUser);
  });

  it('throws UnauthorizedException when session is null', async () => {
    mockGetSession.mockResolvedValue(null);

    await expect(guard.canActivate(makeContext())).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('throws UnauthorizedException when getSession rejects', async () => {
    mockGetSession.mockRejectedValue(new Error('db error'));

    await expect(guard.canActivate(makeContext())).rejects.toThrow(
      UnauthorizedException,
    );
  });
});
