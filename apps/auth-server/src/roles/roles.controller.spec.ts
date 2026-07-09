import { Test, TestingModule } from '@nestjs/testing';
import { RolesController } from './roles.controller';
import { RolesService } from './roles.service';

jest.mock('../auth/auth.config', () => ({
  auth: { api: { getSession: jest.fn() } },
}));

const mockRolesService = {
  listRoles: jest.fn(),
  getRole: jest.fn(),
  createRole: jest.fn(),
  updateRole: jest.fn(),
  deleteRole: jest.fn(),
};

function makeReq(baUserId = 'ba-caller') {
  return { betterAuthUser: { id: baUserId } } as unknown as import('express').Request;
}

describe('RolesController', () => {
  let controller: RolesController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [RolesController],
      providers: [{ provide: RolesService, useValue: mockRolesService }],
    }).compile();
    controller = module.get(RolesController);
    jest.clearAllMocks();
  });

  describe('list', () => {
    it('forwards caller id and query to RolesService.listRoles', async () => {
      mockRolesService.listRoles.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 25 });
      const result = await controller.list(makeReq('ba-1'), { page: 2, pageSize: 10 });
      expect(mockRolesService.listRoles).toHaveBeenCalledWith('ba-1', { page: 2, pageSize: 10 });
      expect(result.total).toBe(0);
    });
  });

  describe('get', () => {
    it('forwards caller id and publicId to RolesService.getRole', async () => {
      mockRolesService.getRole.mockResolvedValue({ publicId: 'sq_1', name: 'R' });
      const result = await controller.get(makeReq('ba-1'), 'sq_1');
      expect(mockRolesService.getRole).toHaveBeenCalledWith('ba-1', 'sq_1');
      expect(result.publicId).toBe('sq_1');
    });
  });

  describe('create', () => {
    it('forwards caller id and DTO to RolesService.createRole', async () => {
      const dto = { name: 'R', appId: 'sq_app_1', permissionIds: [] };
      mockRolesService.createRole.mockResolvedValue({ publicId: 'sq_2', name: 'R' });
      const result = await controller.create(makeReq('ba-2'), dto);
      expect(mockRolesService.createRole).toHaveBeenCalledWith('ba-2', dto);
      expect(result.publicId).toBe('sq_2');
    });
  });

  describe('update', () => {
    it('forwards caller id, publicId, and DTO to RolesService.updateRole', async () => {
      const dto = { name: 'Renamed' };
      mockRolesService.updateRole.mockResolvedValue({ publicId: 'sq_2', name: 'Renamed' });
      const result = await controller.update(makeReq('ba-3'), 'sq_2', dto);
      expect(mockRolesService.updateRole).toHaveBeenCalledWith('ba-3', 'sq_2', dto);
      expect(result.name).toBe('Renamed');
    });
  });

  describe('remove', () => {
    it('forwards caller id and publicId to RolesService.deleteRole', async () => {
      mockRolesService.deleteRole.mockResolvedValue(undefined);
      await controller.remove(makeReq('ba-4'), 'sq_2');
      expect(mockRolesService.deleteRole).toHaveBeenCalledWith('ba-4', 'sq_2');
    });
  });
});
