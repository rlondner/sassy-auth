import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { ServiceTokenGuard } from './service-token.guard';
import { TokenService } from '../token/token.service';
import { SqidService } from '../common/sqid/sqid.service';

function contextWith(headers: Record<string, string>): ExecutionContext {
  const request: Record<string, unknown> = { headers };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('ServiceTokenGuard', () => {
  const mockTokenService = { verifyServiceAccessToken: jest.fn() };
  const mockSqidService = { decode: jest.fn((s: string) => parseInt(s.replace('app-', ''), 10)) };
  let guard: ServiceTokenGuard;

  beforeEach(() => {
    jest.clearAllMocks();
    guard = new ServiceTokenGuard(
      mockTokenService as unknown as TokenService,
      mockSqidService as unknown as SqidService,
    );
  });

  it('rejects a missing Authorization header', async () => {
    const ctx = contextWith({});
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a non-Bearer scheme', async () => {
    const ctx = contextWith({ authorization: 'Basic abc' });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a token that fails verification (e.g. a user access token)', async () => {
    mockTokenService.verifyServiceAccessToken.mockImplementation(() => {
      throw new Error('Not a service access token');
    });
    const ctx = contextWith({ authorization: 'Bearer user.jwt.token' });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a valid service token missing roles:write', async () => {
    mockTokenService.verifyServiceAccessToken.mockReturnValue({ azp: 'app-9', scope: '' });
    const ctx = contextWith({ authorization: 'Bearer service.jwt.token' });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('accepts a valid service token with roles:write and attaches serviceApp', async () => {
    mockTokenService.verifyServiceAccessToken.mockReturnValue({ azp: 'app-9', scope: 'roles:write' });
    const request: Record<string, unknown> = { headers: { authorization: 'Bearer service.jwt.token' } };
    const ctx = { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(request.serviceApp).toEqual({ appId: 9, appPublicId: 'app-9' });
  });
});
