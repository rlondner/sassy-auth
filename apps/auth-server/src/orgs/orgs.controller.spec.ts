import { Test, TestingModule } from '@nestjs/testing';
import { OrgsController } from './orgs.controller';
import { OrgsService } from './orgs.service';

jest.mock('../auth/auth.config', () => ({
  auth: { api: { getSession: jest.fn() } },
}));

const mockOrgsService = {
  listOrgs: jest.fn(),
  getOrg: jest.fn(),
  createOrg: jest.fn(),
  updateOrg: jest.fn(),
  deleteOrg: jest.fn(),
};

function makeReq(baUserId = 'ba-caller') {
  return { betterAuthUser: { id: baUserId } } as unknown as import('express').Request;
}

describe('OrgsController', () => {
  let controller: OrgsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [OrgsController],
      providers: [{ provide: OrgsService, useValue: mockOrgsService }],
    }).compile();
    controller = module.get(OrgsController);
    jest.clearAllMocks();
  });

  describe('list', () => {
    it('forwards caller id and query to OrgsService.listOrgs', async () => {
      mockOrgsService.listOrgs.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 25 });
      const result = await controller.list(makeReq('ba-1'), { page: 2, pageSize: 10 });
      expect(mockOrgsService.listOrgs).toHaveBeenCalledWith('ba-1', { page: 2, pageSize: 10 });
      expect(result).toEqual({ items: [], total: 0, page: 1, pageSize: 25 });
    });
  });

  describe('get', () => {
    it('forwards caller id and publicId to OrgsService.getOrg', async () => {
      mockOrgsService.getOrg.mockResolvedValue({ publicId: 'sq_1', name: 'O' });
      const result = await controller.get(makeReq('ba-1'), 'sq_1');
      expect(mockOrgsService.getOrg).toHaveBeenCalledWith('ba-1', 'sq_1');
      expect(result.publicId).toBe('sq_1');
    });
  });

  describe('create', () => {
    it('forwards caller id and DTO to OrgsService.createOrg', async () => {
      const dto = { name: 'O', appId: 'sq_app_1' };
      mockOrgsService.createOrg.mockResolvedValue({ publicId: 'sq_2', name: 'O' });
      const result = await controller.create(makeReq('ba-2'), dto);
      expect(mockOrgsService.createOrg).toHaveBeenCalledWith('ba-2', dto);
      expect(result.publicId).toBe('sq_2');
    });
  });

  describe('update', () => {
    it('forwards caller id, publicId, and DTO to OrgsService.updateOrg', async () => {
      const dto = { name: 'Renamed' };
      mockOrgsService.updateOrg.mockResolvedValue({ publicId: 'sq_2', name: 'Renamed' });
      const result = await controller.update(makeReq('ba-3'), 'sq_2', dto);
      expect(mockOrgsService.updateOrg).toHaveBeenCalledWith('ba-3', 'sq_2', dto);
      expect(result.name).toBe('Renamed');
    });
  });

  describe('remove', () => {
    it('forwards caller id and publicId to OrgsService.deleteOrg', async () => {
      mockOrgsService.deleteOrg.mockResolvedValue(undefined);
      await controller.remove(makeReq('ba-4'), 'sq_2');
      expect(mockOrgsService.deleteOrg).toHaveBeenCalledWith('ba-4', 'sq_2');
    });
  });
});
