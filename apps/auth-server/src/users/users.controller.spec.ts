import { Test, TestingModule } from '@nestjs/testing';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

jest.mock('../auth/auth.config', () => ({
  auth: { api: { getSession: jest.fn() } },
}));

const mockUsersService = {
  listUsers: jest.fn(),
  getUser: jest.fn(),
  createUser: jest.fn(),
  updateUser: jest.fn(),
  deleteUser: jest.fn(),
  getUserRoles: jest.fn(),
  getEffectivePermissions: jest.fn(),
  getUserDirectPermissions: jest.fn(),
  setUserRoles: jest.fn(),
  setUserDirectPermissions: jest.fn(),
  assignRole: jest.fn(),
  removeRole: jest.fn(),
  resendInvitation: jest.fn(),
};

function makeReq(baUserId = 'ba-caller') {
  return { betterAuthUser: { id: baUserId } } as unknown as import('express').Request;
}

describe('UsersController', () => {
  let controller: UsersController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [{ provide: UsersService, useValue: mockUsersService }],
    }).compile();
    controller = module.get(UsersController);
    jest.clearAllMocks();
  });

  describe('list', () => {
    it('forwards caller id and orgId/appId filter to UsersService.listUsers', async () => {
      mockUsersService.listUsers.mockResolvedValue([]);
      await controller.list(makeReq('ba-1'), 'org-1', 'app-1');
      expect(mockUsersService.listUsers).toHaveBeenCalledWith('ba-1', {
        orgPublicId: 'org-1',
        appPublicId: 'app-1',
      });
    });

    it('forwards undefined filter when no query', async () => {
      mockUsersService.listUsers.mockResolvedValue([]);
      await controller.list(makeReq('ba-1'));
      expect(mockUsersService.listUsers).toHaveBeenCalledWith('ba-1', {
        orgPublicId: undefined,
        appPublicId: undefined,
      });
    });
  });

  describe('get', () => {
    it('forwards caller id and id to UsersService.getUser', async () => {
      mockUsersService.getUser.mockResolvedValue({ id: 'usr-1' });
      await controller.get(makeReq('ba-1'), 'usr-1');
      expect(mockUsersService.getUser).toHaveBeenCalledWith('ba-1', 'usr-1');
    });
  });

  describe('create', () => {
    it('forwards caller id and DTO to UsersService.createUser', async () => {
      const dto = { firstName: 'A', lastName: 'B', email: 'a@b.io', orgId: 'org-1' };
      mockUsersService.createUser.mockResolvedValue({ user: { id: 'usr-1' }, inviteUrl: 'x' });
      await controller.create(makeReq('ba-2'), dto);
      expect(mockUsersService.createUser).toHaveBeenCalledWith('ba-2', dto);
    });
  });

  describe('update', () => {
    it('forwards caller id, id, and DTO to UsersService.updateUser', async () => {
      const dto = { firstName: 'C' };
      mockUsersService.updateUser.mockResolvedValue({ id: 'usr-1', firstName: 'C' });
      await controller.update(makeReq('ba-3'), 'usr-1', dto);
      expect(mockUsersService.updateUser).toHaveBeenCalledWith('ba-3', 'usr-1', dto);
    });
  });

  describe('remove', () => {
    it('forwards caller id and id to UsersService.deleteUser', async () => {
      mockUsersService.deleteUser.mockResolvedValue(undefined);
      await controller.remove(makeReq('ba-4'), 'usr-1');
      expect(mockUsersService.deleteUser).toHaveBeenCalledWith('ba-4', 'usr-1');
    });
  });

  describe('getRoles', () => {
    it('forwards caller id and id to UsersService.getUserRoles', async () => {
      mockUsersService.getUserRoles.mockResolvedValue([]);
      await controller.getRoles(makeReq('ba-5'), 'usr-1');
      expect(mockUsersService.getUserRoles).toHaveBeenCalledWith('ba-5', 'usr-1');
    });
  });

  describe('effectivePermissions', () => {
    it('forwards caller id and id to UsersService.getEffectivePermissions', async () => {
      mockUsersService.getEffectivePermissions.mockResolvedValue({ userId: 'usr-1', permissions: [] });
      await controller.effectivePermissions(makeReq('ba-6'), 'usr-1');
      expect(mockUsersService.getEffectivePermissions).toHaveBeenCalledWith('ba-6', 'usr-1');
    });
  });

  describe('assignRole', () => {
    it('forwards caller id, id, and DTO to UsersService.assignRole', async () => {
      const dto = { roleId: 'role-1' };
      mockUsersService.assignRole.mockResolvedValue(undefined);
      await controller.assignRole(makeReq('ba-7'), 'usr-1', dto);
      expect(mockUsersService.assignRole).toHaveBeenCalledWith('ba-7', 'usr-1', dto);
    });
  });

  describe('removeRole', () => {
    it('forwards caller id, user id, and role id to UsersService.removeRole', async () => {
      mockUsersService.removeRole.mockResolvedValue(undefined);
      await controller.removeRole(makeReq('ba-8'), 'usr-1', 'role-1');
      expect(mockUsersService.removeRole).toHaveBeenCalledWith('ba-8', 'usr-1', 'role-1');
    });
  });

  describe('resendInvitation', () => {
    it('forwards caller id and id to UsersService.resendInvitation', async () => {
      mockUsersService.resendInvitation.mockResolvedValue({ inviteUrl: 'x' });
      await controller.resendInvitation(makeReq('ba-9'), 'usr-1');
      expect(mockUsersService.resendInvitation).toHaveBeenCalledWith('ba-9', 'usr-1');
    });
  });

  describe('setRoles', () => {
    it('forwards caller id, user id, and roleIds to UsersService.setUserRoles', async () => {
      mockUsersService.setUserRoles.mockResolvedValue(undefined);
      await controller.setRoles(makeReq('ba-7'), 'usr-1', { roleIds: ['rA', 'rB'] });
      expect(mockUsersService.setUserRoles).toHaveBeenCalledWith('ba-7', 'usr-1', ['rA', 'rB']);
    });
  });

  describe('getDirectPermissions', () => {
    it('forwards caller id and user id to UsersService.getUserDirectPermissions', async () => {
      mockUsersService.getUserDirectPermissions.mockResolvedValue([{ id: 'pA', name: 'apps.read', appId: '' }]);
      await controller.getDirectPermissions(makeReq('ba-8'), 'usr-1');
      expect(mockUsersService.getUserDirectPermissions).toHaveBeenCalledWith('ba-8', 'usr-1');
    });
  });

  describe('setDirectPermissions', () => {
    it('forwards caller id, user id, and permissionIds to UsersService.setUserDirectPermissions', async () => {
      mockUsersService.setUserDirectPermissions.mockResolvedValue(undefined);
      await controller.setDirectPermissions(makeReq('ba-9'), 'usr-1', { permissionIds: ['pA'] });
      expect(mockUsersService.setUserDirectPermissions).toHaveBeenCalledWith('ba-9', 'usr-1', ['pA']);
    });
  });
});
