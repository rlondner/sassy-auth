import { Test, TestingModule } from '@nestjs/testing';
import { AppsController } from './apps.controller';
import { AppsService } from './apps.service';

jest.mock('../auth/auth.config', () => ({
  auth: { api: { getSession: jest.fn() } },
}));

const mockAppsService = {
  listApps: jest.fn(),
  createApp: jest.fn(),
  updateApp: jest.fn(),
  deleteApp: jest.fn(),
  rotateClientSecret: jest.fn(),
};

function makeReq(baUserId = 'ba-caller') {
  return { betterAuthUser: { id: baUserId } } as unknown as import('express').Request;
}

describe('AppsController', () => {
  let controller: AppsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AppsController],
      providers: [{ provide: AppsService, useValue: mockAppsService }],
    }).compile();
    controller = module.get(AppsController);
    jest.clearAllMocks();
  });

  describe('list', () => {
    it('forwards caller id and query to AppsService.listApps', async () => {
      mockAppsService.listApps.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 25 });
      const result = await controller.list(makeReq('ba-1'), { page: 2, pageSize: 10 });
      expect(mockAppsService.listApps).toHaveBeenCalledWith('ba-1', { page: 2, pageSize: 10 });
      expect(result).toEqual({ items: [], total: 0, page: 1, pageSize: 25 });
    });
  });

  describe('create', () => {
    it('forwards caller id and DTO to AppsService.createApp', async () => {
      mockAppsService.createApp.mockResolvedValue({ publicId: 'sq_1', name: 'X', url: 'https://x', isPlatform: false });
      const dto = { name: 'X', url: 'https://x' };
      const result = await controller.create(makeReq('ba-2'), dto);
      expect(mockAppsService.createApp).toHaveBeenCalledWith('ba-2', dto);
      expect(result.publicId).toBe('sq_1');
    });
  });

  describe('update', () => {
    it('forwards caller id, publicId, and DTO to AppsService.updateApp', async () => {
      mockAppsService.updateApp.mockResolvedValue({ publicId: 'sq_1', name: 'Y', url: 'https://y', isPlatform: false });
      const dto = { name: 'Y' };
      const result = await controller.update(makeReq('ba-3'), 'sq_1', dto);
      expect(mockAppsService.updateApp).toHaveBeenCalledWith('ba-3', 'sq_1', dto);
      expect(result.name).toBe('Y');
    });
  });

  describe('remove', () => {
    it('forwards caller id and publicId to AppsService.deleteApp', async () => {
      mockAppsService.deleteApp.mockResolvedValue(undefined);
      await controller.remove(makeReq('ba-4'), 'sq_1');
      expect(mockAppsService.deleteApp).toHaveBeenCalledWith('ba-4', 'sq_1');
    });
  });

  describe('rotateClientSecret', () => {
    it('forwards caller id and publicId to AppsService.rotateClientSecret', async () => {
      mockAppsService.rotateClientSecret.mockResolvedValue({ clientSecret: 'plaintext-secret' });
      const result = await controller.rotateClientSecret(makeReq('ba-5'), 'sq_1');
      expect(mockAppsService.rotateClientSecret).toHaveBeenCalledWith('ba-5', 'sq_1');
      expect(result).toEqual({ clientSecret: 'plaintext-secret' });
    });
  });
});
