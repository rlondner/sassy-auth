import { Test, TestingModule } from '@nestjs/testing';
import { MeController } from './me.controller';
import { MeService } from './me.service';

jest.mock('../auth/auth.config', () => ({
  auth: { api: { getSession: jest.fn() } },
}));

const mockMeService = {
  getMyPermissions: jest.fn(),
  getOutstandingConsent: jest.fn(),
  recordMyConsent: jest.fn(),
};

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

  describe('consent', () => {
    it('GET /me/consent returns outstanding documents from MeService', async () => {
      mockMeService.getOutstandingConsent.mockResolvedValue({
        outstanding: [{ documentType: 'terms', url: 'https://a.example.com/terms' }],
      });
      const result = await controller.getOutstandingConsent(makeReq('ba-1'), { appPublicId: 'sq_1' });
      expect(mockMeService.getOutstandingConsent).toHaveBeenCalledWith('ba-1', 'sq_1', 'unknown');
      expect(result).toEqual({ outstanding: [{ documentType: 'terms', url: 'https://a.example.com/terms' }] });
    });

    it('POST /me/consent calls MeService.recordMyConsent', async () => {
      mockMeService.recordMyConsent.mockResolvedValue(undefined);
      await controller.recordConsent(makeReq('ba-1'), { appPublicId: 'sq_1', accepted: ['terms'] });
      expect(mockMeService.recordMyConsent).toHaveBeenCalledWith('ba-1', 'sq_1', 'unknown', ['terms']);
    });
  });
});
