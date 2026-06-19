import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PermissionsService } from './permissions.service';

jest.mock('@sassy-auth/db', () => ({
  prisma: {
    saPermission: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    saApp: { findUnique: jest.fn() },
    saRolePermission: { count: jest.fn(), groupBy: jest.fn() },
    saUserPermission: { count: jest.fn(), groupBy: jest.fn() },
    $transaction: jest.fn(async (cb: (tx: unknown) => unknown) => {
      const txStub = {
        saPermission: {
          create: jest.fn().mockResolvedValue({ id: 42, name: 'apps.read', appId: 1, publicId: 'placeholder' }),
          update: jest.fn().mockResolvedValue({
            id: 42, publicId: 'sq_42', name: 'apps.read', appId: 1,
            app: { publicId: 'sq_app1', name: 'Customer Portal' },
          }),
        },
      };
      return cb(txStub);
    }),
  },
}));

jest.mock('../common/permissions/check-permission', () => ({
  checkPermission: jest.fn().mockResolvedValue(undefined),
}));

import { prisma } from '@sassy-auth/db';
import { checkPermission } from '../common/permissions/check-permission';

const mocks = prisma as unknown as {
  saPermission: Record<string, jest.Mock>;
  saApp: Record<string, jest.Mock>;
  saRolePermission: Record<string, jest.Mock>;
  saUserPermission: Record<string, jest.Mock>;
};

function makeService() {
  return new PermissionsService(
    { encode: (id: number) => `sq_${id}` } as never,
    { getWinstonLogger: () => ({ info: jest.fn() }) } as never,
  );
}

describe('PermissionsService', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('listPermissions', () => {
    it('uses default empty-object for q when called with no second arg', async () => {
      mocks.saPermission.findMany.mockResolvedValue([]);
      mocks.saPermission.count.mockResolvedValue(0);
      const result = await makeService().listPermissions('ba-caller');
      expect(result.items).toEqual([]);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(25);
    });

    it('returns empty roleGroups/userGroups when there are no permissions', async () => {
      mocks.saPermission.findMany.mockResolvedValue([]);
      mocks.saPermission.count.mockResolvedValue(0);
      const result = await makeService().listPermissions('ba-caller', {});
      expect(result.items).toEqual([]);
      expect(result.total).toBe(0);
    });

    it('returns rows with roleCount/userCount and respects q + appId filters', async () => {
      mocks.saApp.findUnique.mockResolvedValue({ id: 5, publicId: 'sq_app5' });
      mocks.saPermission.findMany.mockResolvedValue([
        { id: 1, publicId: 'sq_p1', name: 'apps.read', app: { publicId: 'sq_app5', name: 'Portal' } },
        { id: 2, publicId: 'sq_p2', name: 'apps.write', app: { publicId: 'sq_app5', name: 'Portal' } },
      ]);
      mocks.saPermission.count.mockResolvedValue(2);
      mocks.saRolePermission.groupBy.mockResolvedValue([{ permissionId: 1, _count: { _all: 3 } }]);
      mocks.saUserPermission.groupBy.mockResolvedValue([{ permissionId: 2, _count: { _all: 1 } }]);

      const result = await makeService().listPermissions('ba-caller', { q: 'apps', appId: 'sq_app5', page: 1, pageSize: 25 });

      expect(checkPermission).toHaveBeenCalledWith('ba-caller', 'platform.permissions.manage');
      expect(mocks.saPermission.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { appId: 5, name: { contains: 'apps', mode: 'insensitive' } } }),
      );
      expect(result.items).toEqual([
        { publicId: 'sq_p1', name: 'apps.read', app: { publicId: 'sq_app5', name: 'Portal' }, roleCount: 3, userCount: 0 },
        { publicId: 'sq_p2', name: 'apps.write', app: { publicId: 'sq_app5', name: 'Portal' }, roleCount: 0, userCount: 1 },
      ]);
      expect(result.total).toBe(2);
    });

    it('throws NotFound when appId filter does not match an app', async () => {
      mocks.saApp.findUnique.mockResolvedValue(null);
      await expect(makeService().listPermissions('ba-caller', { appId: 'bogus' })).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('getPermission', () => {
    it('returns the row with top-50 roles and users + full counts', async () => {
      mocks.saPermission.findUnique.mockResolvedValue({
        id: 7, publicId: 'sq_p7', name: 'apps.write',
        app: { publicId: 'sq_app1', name: 'Portal' },
        roles: [{ role: { publicId: 'sq_r1', name: 'Editor', app: { name: 'Portal' } } }],
        users: [{ user: { publicId: 'sq_u1', firstName: 'Alice', lastName: 'Smith', betterAuthUser: { email: 'alice@example.com' } } }],
      });
      mocks.saRolePermission.count.mockResolvedValue(1);
      mocks.saUserPermission.count.mockResolvedValue(1);

      const result = await makeService().getPermission('ba-caller', 'sq_p7');

      expect(result.publicId).toBe('sq_p7');
      expect(result.roleCount).toBe(1);
      expect(result.userCount).toBe(1);
      expect(result.roles).toEqual([{ publicId: 'sq_r1', name: 'Editor', appName: 'Portal' }]);
      expect(result.users).toEqual([{ publicId: 'sq_u1', email: 'alice@example.com', firstName: 'Alice', lastName: 'Smith' }]);
    });

    it('throws NotFound when the permission does not exist', async () => {
      mocks.saPermission.findUnique.mockResolvedValue(null);
      await expect(makeService().getPermission('ba-caller', 'missing')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('createPermission', () => {
    it('rejects unknown appId with NotFound', async () => {
      mocks.saApp.findUnique.mockResolvedValue(null);
      await expect(makeService().createPermission('ba-caller', { name: 'apps.read', appId: 'bad' })).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns the new row with zero counts on success', async () => {
      mocks.saApp.findUnique.mockResolvedValue({ id: 1, publicId: 'sq_app1' });
      const result = await makeService().createPermission('ba-caller', { name: 'apps.read', appId: 'sq_app1' });
      expect(result).toEqual({
        publicId: 'sq_42', name: 'apps.read',
        app: { publicId: 'sq_app1', name: 'Customer Portal' },
        roleCount: 0, userCount: 0,
      });
    });

    it('translates Prisma P2002 to ConflictException', async () => {
      mocks.saApp.findUnique.mockResolvedValue({ id: 1, publicId: 'sq_app1' });
      (prisma.$transaction as jest.Mock).mockRejectedValue({ code: 'P2002' });
      await expect(makeService().createPermission('ba-caller', { name: 'apps.read', appId: 'sq_app1' })).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('updatePermission', () => {
    it('throws NotFoundException when permission does not exist', async () => {
      mocks.saPermission.findUnique.mockResolvedValue(null);
      await expect(makeService().updatePermission('ba-caller', 'missing', { name: 'apps.new' })).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects when name starts with platform. (Forbidden)', async () => {
      mocks.saPermission.findUnique.mockResolvedValue({ id: 1, publicId: 'sq_p1', name: 'platform.users.manage', appId: 1 });
      await expect(makeService().updatePermission('ba-caller', 'sq_p1', { name: 'platform.users.manage.x' })).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects when isSystem is true (Forbidden)', async () => {
      mocks.saPermission.findUnique.mockResolvedValue({
        id: 1, publicId: 'sq_p1', name: 'org.users.manage', appId: 1, isSystem: true,
      });
      await expect(
        makeService().updatePermission('ba-caller', 'sq_p1', { name: 'org.users.manage.x' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects empty patch with BadRequest', async () => {
      mocks.saPermission.findUnique.mockResolvedValue({ id: 1, publicId: 'sq_p1', name: 'apps.read', appId: 1 });
      await expect(makeService().updatePermission('ba-caller', 'sq_p1', {})).rejects.toBeInstanceOf(BadRequestException);
    });

    it('happy path updates and returns the row', async () => {
      mocks.saPermission.findUnique.mockResolvedValue({ id: 1, publicId: 'sq_p1', name: 'apps.read', appId: 1 });
      mocks.saPermission.update.mockResolvedValue({
        publicId: 'sq_p1', name: 'apps.list', app: { publicId: 'sq_app1', name: 'Portal' },
      });
      mocks.saRolePermission.count.mockResolvedValue(0);
      mocks.saUserPermission.count.mockResolvedValue(0);
      const result = await makeService().updatePermission('ba-caller', 'sq_p1', { name: 'apps.list' });
      expect(result.name).toBe('apps.list');
    });
  });

  describe('deletePermission', () => {
    it('throws NotFoundException when permission does not exist', async () => {
      mocks.saPermission.findUnique.mockResolvedValue(null);
      await expect(makeService().deletePermission('ba-caller', 'missing')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects platform.* with Forbidden', async () => {
      mocks.saPermission.findUnique.mockResolvedValue({ id: 1, publicId: 'sq_p1', name: 'platform.users.manage' });
      await expect(makeService().deletePermission('ba-caller', 'sq_p1')).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects deleting isSystem with Forbidden', async () => {
      mocks.saPermission.findUnique.mockResolvedValue({
        id: 1, publicId: 'sq_p1', name: 'org.users.manage', appId: 1, isSystem: true,
      });
      await expect(
        makeService().deletePermission('ba-caller', 'sq_p1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('translates Prisma P2003 to ConflictException with a useful message', async () => {
      mocks.saPermission.findUnique.mockResolvedValue({ id: 1, publicId: 'sq_p1', name: 'apps.read' });
      mocks.saRolePermission.count.mockResolvedValue(2);
      mocks.saUserPermission.count.mockResolvedValue(3);
      mocks.saPermission.delete.mockRejectedValue({ code: 'P2003' });
      const promise = makeService().deletePermission('ba-caller', 'sq_p1');
      await expect(promise).rejects.toBeInstanceOf(ConflictException);
      await expect(promise).rejects.toMatchObject({ message: expect.stringContaining('2 roles') });
    });

    it('happy path deletes', async () => {
      mocks.saPermission.findUnique.mockResolvedValue({ id: 1, publicId: 'sq_p1', name: 'apps.read' });
      mocks.saPermission.delete.mockResolvedValue(undefined);
      await expect(makeService().deletePermission('ba-caller', 'sq_p1')).resolves.toBeUndefined();
    });

    it('re-throws unexpected errors from prisma.delete', async () => {
      mocks.saPermission.findUnique.mockResolvedValue({ id: 1, publicId: 'sq_p1', name: 'apps.read' });
      mocks.saPermission.delete.mockRejectedValueOnce(new Error('DB timeout'));
      await expect(makeService().deletePermission('ba-caller', 'sq_p1')).rejects.toThrow('DB timeout');
    });
  });

  describe('createPermission re-throw non-P2002 error', () => {
    it('re-throws unexpected transaction errors', async () => {
      mocks.saApp.findUnique.mockResolvedValue({ id: 1, publicId: 'sq_app1' });
      (prisma.$transaction as jest.Mock).mockRejectedValueOnce(new Error('Network failure'));
      await expect(makeService().createPermission('ba-caller', { name: 'apps.read', appId: 'sq_app1' })).rejects.toThrow('Network failure');
    });
  });

  describe('updatePermission ConflictException P2002', () => {
    it('translates P2002 to ConflictException', async () => {
      mocks.saPermission.findUnique.mockResolvedValue({ id: 1, publicId: 'sq_p1', name: 'apps.read', appId: 1 });
      mocks.saPermission.update.mockRejectedValueOnce({ code: 'P2002' });
      await expect(makeService().updatePermission('ba-caller', 'sq_p1', { name: 'apps.list' })).rejects.toBeInstanceOf(ConflictException);
    });

    it('re-throws unexpected errors from prisma.update', async () => {
      mocks.saPermission.findUnique.mockResolvedValue({ id: 1, publicId: 'sq_p1', name: 'apps.read', appId: 1 });
      mocks.saPermission.update.mockRejectedValueOnce(new Error('DB timeout'));
      await expect(makeService().updatePermission('ba-caller', 'sq_p1', { name: 'apps.list' })).rejects.toThrow('DB timeout');
    });
  });
});
