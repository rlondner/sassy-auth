import { Test, TestingModule } from '@nestjs/testing';
import { PermissionsController } from './permissions.controller';
import { PermissionsService } from './permissions.service';

jest.mock('../auth/auth.config', () => ({
  auth: { api: { getSession: jest.fn() } },
}));

const mockPermissionsService = {
  listPermissions: jest.fn(),
  getPermission: jest.fn(),
  createPermission: jest.fn(),
  updatePermission: jest.fn(),
  deletePermission: jest.fn(),
};

function makeReq(baUserId = 'ba-caller') {
  return { betterAuthUser: { id: baUserId } } as unknown as import('express').Request;
}

describe('PermissionsController', () => {
  let controller: PermissionsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PermissionsController],
      providers: [{ provide: PermissionsService, useValue: mockPermissionsService }],
    }).compile();
    controller = module.get(PermissionsController);
    jest.clearAllMocks();
  });

  describe('list', () => {
    it('forwards caller id and query to PermissionsService.listPermissions', async () => {
      mockPermissionsService.listPermissions.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 25 });
      await controller.list(makeReq('ba-1'), { page: 1, pageSize: 25 });
      expect(mockPermissionsService.listPermissions).toHaveBeenCalledWith('ba-1', { page: 1, pageSize: 25 });
    });
  });

  describe('get', () => {
    it('forwards caller id and publicId to PermissionsService.getPermission', async () => {
      mockPermissionsService.getPermission.mockResolvedValue({ publicId: 'sq_1', name: 'a.b' });
      const result = await controller.get(makeReq('ba-1'), 'sq_1');
      expect(mockPermissionsService.getPermission).toHaveBeenCalledWith('ba-1', 'sq_1');
      expect(result.publicId).toBe('sq_1');
    });
  });

  describe('create', () => {
    it('forwards caller id and DTO to PermissionsService.createPermission', async () => {
      const dto = { name: 'a.b', appId: 'sq_app_1' };
      mockPermissionsService.createPermission.mockResolvedValue({ publicId: 'sq_2', name: 'a.b' });
      const result = await controller.create(makeReq('ba-2'), dto);
      expect(mockPermissionsService.createPermission).toHaveBeenCalledWith('ba-2', dto);
      expect(result.publicId).toBe('sq_2');
    });
  });

  describe('update', () => {
    it('forwards caller id, publicId, and DTO to PermissionsService.updatePermission', async () => {
      const dto = { name: 'a.c' };
      mockPermissionsService.updatePermission.mockResolvedValue({ publicId: 'sq_2', name: 'a.c' });
      await controller.update(makeReq('ba-3'), 'sq_2', dto);
      expect(mockPermissionsService.updatePermission).toHaveBeenCalledWith('ba-3', 'sq_2', dto);
    });
  });

  describe('remove', () => {
    it('forwards caller id and publicId to PermissionsService.deletePermission', async () => {
      mockPermissionsService.deletePermission.mockResolvedValue(undefined);
      await controller.remove(makeReq('ba-4'), 'sq_2');
      expect(mockPermissionsService.deletePermission).toHaveBeenCalledWith('ba-4', 'sq_2');
    });
  });
});
