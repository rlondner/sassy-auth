import { Test, TestingModule } from '@nestjs/testing';
import { MeController } from './me.controller';
import { MeService } from './me.service';

jest.mock('../auth/auth.config', () => ({
  auth: { api: { getSession: jest.fn() } },
}));

const mockMeService = { getMyPermissions: jest.fn() };

function makeReq(baUserId = 'ba-caller') {
  return { betterAuthUser: { id: baUserId } } as unknown as import('express').Request;
}

describe('MeController', () => {
  let controller: MeController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [MeController],
      providers: [{ provide: MeService, useValue: mockMeService }],
    }).compile();
    controller = module.get(MeController);
    jest.clearAllMocks();
  });

  describe('permissions', () => {
    it('forwards caller id to MeService.getMyPermissions', async () => {
      mockMeService.getMyPermissions.mockResolvedValue({ permissions: ['platform.users.manage'] });
      const result = await controller.permissions(makeReq('ba-1'));
      expect(mockMeService.getMyPermissions).toHaveBeenCalledWith('ba-1');
      expect(result.permissions).toEqual(['platform.users.manage']);
    });
  });
});
