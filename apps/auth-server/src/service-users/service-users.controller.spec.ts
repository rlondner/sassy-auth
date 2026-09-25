import { Test, TestingModule } from '@nestjs/testing';
import { Request } from 'express';
import { ServiceUsersController } from './service-users.controller';
import { ServiceUsersService } from './service-users.service';
import { ServiceTokenGuard } from './service-token.guard';

function reqWith(appId: number): Request {
  return { serviceApp: { appId, appPublicId: `app-${appId}` } } as unknown as Request;
}

describe('ServiceUsersController', () => {
  let controller: ServiceUsersController;
  const mockService = { assignRole: jest.fn(), removeRole: jest.fn() };

  beforeEach(async () => {
    // ServiceTokenGuard carries real DI dependencies (TokenService,
    // SqidService) that this narrow unit test has no reason to wire up —
    // its own behavior is already covered by service-token.guard.spec.ts.
    // overrideGuard swaps in a no-op so module.compile() doesn't try to
    // resolve those dependencies.
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ServiceUsersController],
      providers: [{ provide: ServiceUsersService, useValue: mockService }],
    })
      .overrideGuard(ServiceTokenGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = module.get(ServiceUsersController);
    jest.clearAllMocks();
  });

  it('assignRole delegates to the service with the calling app id from the request', async () => {
    mockService.assignRole.mockResolvedValue(undefined);
    await controller.assignRole(reqWith(7), 'usr1', 'role1');
    expect(mockService.assignRole).toHaveBeenCalledWith(7, 'usr1', 'role1');
  });

  it('removeRole delegates to the service with the calling app id from the request', async () => {
    mockService.removeRole.mockResolvedValue(undefined);
    await controller.removeRole(reqWith(7), 'usr1', 'role1');
    expect(mockService.removeRole).toHaveBeenCalledWith(7, 'usr1', 'role1');
  });
});
