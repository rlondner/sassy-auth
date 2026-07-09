import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { RolesService } from './roles.service';

jest.mock('@sassy-auth/db', () => ({
  prisma: {
    saRole: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    saApp: { findUnique: jest.fn() },
    saPermission: { findMany: jest.fn() },
    saRolePermission: { count: jest.fn(), groupBy: jest.fn(), deleteMany: jest.fn(), createMany: jest.fn() },
    saUserRole: { count: jest.fn(), groupBy: jest.fn() },
    saUser: { findUnique: jest.fn() },
    $transaction: jest.fn(async (cb: (tx: unknown) => unknown) => {
      const txStub = {
        saRole: {
          create: jest.fn().mockResolvedValue({ id: 42, name: 'Admin', appId: 1, publicId: 'placeholder' }),
          update: jest.fn().mockResolvedValue({
            id: 42, publicId: 'sq_42', name: 'Admin', appId: 1,
            app: { publicId: 'sq_app1', name: 'Customer Portal' },
            permissions: [],
          }),
          findUnique: jest.fn().mockResolvedValue({
            id: 1, publicId: 'sq_r1', name: 'Editor',
            app: { publicId: 'sq_app1', name: 'Portal' },
            permissions: [{ permission: { publicId: 'sq_p1', name: 'apps.read' } }],
          }),
          delete: jest.fn().mockResolvedValue(undefined),
        },
        saRolePermission: {
          createMany: jest.fn().mockResolvedValue({ count: 0 }),
          deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
      };
      return cb(txStub);
    }),
  },
}));

jest.mock('../common/permissions/check-permission', () => ({
  checkPermission: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../common/permissions/check-permission-for-app', () => ({
  checkPermissionForApp: jest.fn().mockResolvedValue(undefined),
}));

import { prisma } from '@sassy-auth/db';
import { checkPermission } from '../common/permissions/check-permission';
import { checkPermissionForApp } from '../common/permissions/check-permission-for-app';

const mocks = prisma as unknown as {
  saRole: Record<string, jest.Mock>;
  saApp: Record<string, jest.Mock>;
  saPermission: Record<string, jest.Mock>;
  saRolePermission: Record<string, jest.Mock>;
  saUserRole: Record<string, jest.Mock>;
  saUser: Record<string, jest.Mock>;
};

function makeService() {
  return new RolesService(
    { encode: (id: number) => `sq_${id}` } as never,
    { getWinstonLogger: () => ({ info: jest.fn() }) } as never,
  );
}

describe('RolesService', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('listRoles', () => {
    it('uses default empty-object for q when called with no second arg', async () => {
      mocks.saUser.findUnique.mockResolvedValue({ org: { appId: 7 } });
      mocks.saRole.findMany.mockResolvedValue([]);
      mocks.saRole.count.mockResolvedValue(0);
      const result = await makeService().listRoles('ba-caller');
      expect(result.items).toEqual([]);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(25);
    });

    it('returns empty permGroups/userGroups when there are no roles', async () => {
      mocks.saUser.findUnique.mockResolvedValue({ org: { appId: 7 } });
      mocks.saRole.findMany.mockResolvedValue([]);
      mocks.saRole.count.mockResolvedValue(0);
      const result = await makeService().listRoles('ba-caller', {});
      expect(result.items).toEqual([]);
      expect(result.total).toBe(0);
    });

    it('returns rows with permissionCount/userCount and respects q + appId filters', async () => {
      mocks.saUser.findUnique.mockResolvedValue({ org: { appId: 7 } });
      mocks.saApp.findUnique.mockResolvedValue({ id: 5, publicId: 'sq_app5' });
      mocks.saRole.findMany.mockResolvedValue([
        { id: 1, publicId: 'sq_r1', name: 'Editor', app: { publicId: 'sq_app5', name: 'Portal' } },
        { id: 2, publicId: 'sq_r2', name: 'Viewer', app: { publicId: 'sq_app5', name: 'Portal' } },
      ]);
      mocks.saRole.count.mockResolvedValue(2);
      mocks.saRolePermission.groupBy.mockResolvedValue([{ roleId: 1, _count: { _all: 3 } }]);
      mocks.saUserRole.groupBy.mockResolvedValue([{ roleId: 2, _count: { _all: 4 } }]);

      const result = await makeService().listRoles('ba-caller', { q: 'Ed', appId: 'sq_app5', page: 1, pageSize: 25 });

      expect(checkPermissionForApp).toHaveBeenCalledWith(
        'ba-caller',
        ['platform.roles.manage', 'platform.users.manage', 'org.roles.manage'],
        { targetAppId: 5, callerAppId: 7 },
      );
      expect(mocks.saRole.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { appId: 5, name: { contains: 'Ed', mode: 'insensitive' } } }),
      );
      expect(result.items).toEqual([
        { publicId: 'sq_r1', name: 'Editor', app: { publicId: 'sq_app5', name: 'Portal' }, permissionCount: 3, userCount: 0 },
        { publicId: 'sq_r2', name: 'Viewer', app: { publicId: 'sq_app5', name: 'Portal' }, permissionCount: 0, userCount: 4 },
      ]);
      expect(result.total).toBe(2);
    });

    it('passes targetAppId: -1 when q.appId is not provided (forces cross-app to require platform.roles.manage)', async () => {
      mocks.saUser.findUnique.mockResolvedValue({ org: { appId: 7 } });
      mocks.saRole.findMany.mockResolvedValue([]);
      mocks.saRole.count.mockResolvedValue(0);

      await makeService().listRoles('ba-caller', {});

      expect(checkPermissionForApp).toHaveBeenCalledWith(
        'ba-caller',
        ['platform.roles.manage', 'platform.users.manage', 'org.roles.manage'],
        { targetAppId: -1, callerAppId: 7 },
      );
    });

    it('resolves the app id when q.appId is provided and forwards targetAppId + callerAppId', async () => {
      mocks.saUser.findUnique.mockResolvedValue({ org: { appId: 7 } });
      mocks.saApp.findUnique.mockResolvedValue({ id: 11, publicId: 'sq_app11' });
      mocks.saRole.findMany.mockResolvedValue([]);
      mocks.saRole.count.mockResolvedValue(0);

      await makeService().listRoles('ba-caller', { appId: 'sq_app11' });

      expect(checkPermissionForApp).toHaveBeenCalledWith(
        'ba-caller',
        ['platform.roles.manage', 'platform.users.manage', 'org.roles.manage'],
        { targetAppId: 11, callerAppId: 7 },
      );
    });

    it('throws NotFound when appId filter does not match an app', async () => {
      mocks.saUser.findUnique.mockResolvedValue({ org: { appId: 7 } });
      mocks.saApp.findUnique.mockResolvedValue(null);
      await expect(makeService().listRoles('ba-caller', { appId: 'bogus' })).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('getRole', () => {
    it('returns the row with permissions list + userCount and gates via checkPermissionForApp', async () => {
      mocks.saRole.findUnique.mockResolvedValue({
        id: 7, appId: 5, publicId: 'sq_r7', name: 'Editor',
        app: { publicId: 'sq_app1', name: 'Portal' },
        permissions: [
          { permission: { publicId: 'sq_p1', name: 'apps.read' } },
          { permission: { publicId: 'sq_p2', name: 'apps.write' } },
        ],
      });
      mocks.saUser.findUnique.mockResolvedValue({ org: { appId: 5 } });
      mocks.saUserRole.count.mockResolvedValue(3);

      const result = await makeService().getRole('ba-caller', 'sq_r7');

      expect(checkPermissionForApp).toHaveBeenCalledWith(
        'ba-caller',
        ['platform.roles.manage', 'platform.users.manage', 'org.roles.manage'],
        { targetAppId: 5, callerAppId: 5 },
      );
      expect(result.publicId).toBe('sq_r7');
      expect(result.userCount).toBe(3);
      expect(result.permissionCount).toBe(2);
      expect(result.permissions).toEqual([
        { publicId: 'sq_p1', name: 'apps.read' },
        { publicId: 'sq_p2', name: 'apps.write' },
      ]);
    });

    it('throws NotFound when the role does not exist', async () => {
      mocks.saRole.findUnique.mockResolvedValue(null);
      await expect(makeService().getRole('ba-caller', 'missing')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('createRole', () => {
    it('rejects unknown appId with NotFound', async () => {
      mocks.saApp.findUnique.mockResolvedValue(null);
      await expect(makeService().createRole('ba-caller', { name: 'Editor', appId: 'bad' })).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects when a permissionId belongs to a different app (BadRequest)', async () => {
      mocks.saApp.findUnique.mockResolvedValue({ id: 1, publicId: 'sq_app1' });
      mocks.saPermission.findMany.mockResolvedValue([
        { id: 10, publicId: 'sq_p_other', appId: 99 },
      ]);
      await expect(makeService().createRole('ba-caller', {
        name: 'Editor', appId: 'sq_app1', permissionIds: ['sq_p_other'],
      })).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects when a permissionId does not exist (NotFound)', async () => {
      mocks.saApp.findUnique.mockResolvedValue({ id: 1, publicId: 'sq_app1' });
      mocks.saPermission.findMany.mockResolvedValue([]);
      await expect(makeService().createRole('ba-caller', {
        name: 'Editor', appId: 'sq_app1', permissionIds: ['sq_missing'],
      })).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns the new row with permission list on success', async () => {
      mocks.saApp.findUnique.mockResolvedValue({ id: 1, publicId: 'sq_app1' });
      mocks.saPermission.findMany.mockResolvedValue([]);
      const result = await makeService().createRole('ba-caller', { name: 'Admin', appId: 'sq_app1' });
      expect(checkPermission).toHaveBeenCalledWith('ba-caller', 'platform.roles.manage');
      expect(result.publicId).toBe('sq_42');
      expect(result.name).toBe('Admin');
      expect(result.userCount).toBe(0);
    });

    it('translates Prisma P2002 to ConflictException', async () => {
      mocks.saApp.findUnique.mockResolvedValue({ id: 1, publicId: 'sq_app1' });
      mocks.saPermission.findMany.mockResolvedValue([]);
      (prisma.$transaction as jest.Mock).mockRejectedValueOnce({ code: 'P2002' });
      await expect(makeService().createRole('ba-caller', { name: 'Admin', appId: 'sq_app1' })).rejects.toBeInstanceOf(ConflictException);
    });

    describe('role name uniqueness is scoped per app', () => {
      // The DB enforces @@unique([appId, name]) on SaRole. These tests stand in
      // for that constraint at the unit-test layer by replaying what Prisma
      // would return: P2002 only when (appId, name) collides. Each expected
      // createRole call must queue one mockImplementationOnce to avoid leaking
      // into sibling tests.
      function queueUniqueScopedCreate(seen: Array<{ appId: number; name: string }>) {
        (prisma.$transaction as jest.Mock).mockImplementationOnce(async (cb: (tx: unknown) => unknown) => {
          const tx = {
            saRole: {
              create: jest.fn().mockImplementation(async ({ data }: { data: { appId: number; name: string } }) => {
                if (seen.some((r) => r.appId === data.appId && r.name === data.name)) {
                  throw { code: 'P2002' };
                }
                seen.push({ appId: data.appId, name: data.name });
                return { id: 100 + seen.length, name: data.name, appId: data.appId, publicId: 'placeholder' };
              }),
              update: jest.fn().mockImplementation(async ({ data }: { data: { publicId: string } }) => ({
                id: 100 + seen.length, publicId: data.publicId,
                name: seen[seen.length - 1].name, appId: seen[seen.length - 1].appId,
                app: { publicId: 'sq_app_x', name: 'App X' },
                permissions: [],
              })),
            },
            saRolePermission: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
          };
          return cb(tx);
        });
      }

      it('rejects a second create with the same name under the same app (ConflictException)', async () => {
        mocks.saApp.findUnique.mockResolvedValue({ id: 1, publicId: 'sq_app1' });
        mocks.saPermission.findMany.mockResolvedValue([]);
        const seen: Array<{ appId: number; name: string }> = [];
        queueUniqueScopedCreate(seen);
        queueUniqueScopedCreate(seen);

        const svc = makeService();
        const first = await svc.createRole('ba-caller', { name: 'Editor', appId: 'sq_app1' });
        expect(first.name).toBe('Editor');

        await expect(svc.createRole('ba-caller', { name: 'Editor', appId: 'sq_app1' }))
          .rejects.toBeInstanceOf(ConflictException);
      });

      it('allows the same name in two different apps', async () => {
        mocks.saApp.findUnique
          .mockResolvedValueOnce({ id: 1, publicId: 'sq_app1' })
          .mockResolvedValueOnce({ id: 2, publicId: 'sq_app2' });
        mocks.saPermission.findMany.mockResolvedValue([]);
        const seen: Array<{ appId: number; name: string }> = [];
        queueUniqueScopedCreate(seen);
        queueUniqueScopedCreate(seen);

        const svc = makeService();
        const inApp1 = await svc.createRole('ba-caller', { name: 'Editor', appId: 'sq_app1' });
        const inApp2 = await svc.createRole('ba-caller', { name: 'Editor', appId: 'sq_app2' });

        expect(inApp1.name).toBe('Editor');
        expect(inApp2.name).toBe('Editor');
      });
    });
  });

  describe('updateRole', () => {
    it('rejects empty patch with BadRequest', async () => {
      mocks.saRole.findUnique.mockResolvedValue({ id: 1, publicId: 'sq_r1', name: 'Editor', appId: 1 });
      await expect(makeService().updateRole('ba-caller', 'sq_r1', {})).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects when permissionIds reference a different app (BadRequest)', async () => {
      mocks.saRole.findUnique.mockResolvedValue({ id: 1, publicId: 'sq_r1', name: 'Editor', appId: 1 });
      mocks.saPermission.findMany.mockResolvedValue([
        { id: 10, publicId: 'sq_p_other', appId: 99 },
      ]);
      await expect(makeService().updateRole('ba-caller', 'sq_r1', { permissionIds: ['sq_p_other'] }))
        .rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws NotFoundException when role does not exist', async () => {
      mocks.saRole.findUnique.mockResolvedValue(null);
      await expect(makeService().updateRole('ba-caller', 'sq_r1', { name: 'Renamed' })).rejects.toBeInstanceOf(NotFoundException);
    });

    it('happy path updates name + replaces permissions', async () => {
      mocks.saRole.findUnique.mockResolvedValue({ id: 1, publicId: 'sq_r1', name: 'Editor', appId: 1 });
      mocks.saPermission.findMany.mockResolvedValue([{ id: 10, publicId: 'sq_p1', appId: 1 }]);
      mocks.saUserRole.count.mockResolvedValue(0);
      const result = await makeService().updateRole('ba-caller', 'sq_r1', { name: 'Editor v2', permissionIds: ['sq_p1'] });
      expect(checkPermission).toHaveBeenCalledWith('ba-caller', 'platform.roles.manage');
      expect(result.publicId).toBe('sq_r1');
      // The default txStub.saRole.findUnique returns one permission, ensuring map callback is exercised
      expect(result.permissions).toEqual([{ publicId: 'sq_p1', name: 'apps.read' }]);
    });

    it('updates permissionIds only (no name) — skips tx.saRole.update', async () => {
      mocks.saRole.findUnique.mockResolvedValue({ id: 1, publicId: 'sq_r1', name: 'Editor', appId: 1 });
      mocks.saPermission.findMany.mockResolvedValue([{ id: 10, publicId: 'sq_p1', appId: 1 }]);
      mocks.saUserRole.count.mockResolvedValue(2);
      const result = await makeService().updateRole('ba-caller', 'sq_r1', { permissionIds: ['sq_p1'] });
      expect(result.publicId).toBe('sq_r1');
    });

    it('translates P2002 to ConflictException in updateRole', async () => {
      mocks.saRole.findUnique.mockResolvedValue({ id: 1, publicId: 'sq_r1', name: 'Editor', appId: 1 });
      mocks.saPermission.findMany.mockResolvedValue([]);
      (prisma.$transaction as jest.Mock).mockRejectedValueOnce({ code: 'P2002' });
      await expect(makeService().updateRole('ba-caller', 'sq_r1', { name: 'Duplicate' })).rejects.toBeInstanceOf(ConflictException);
    });

    it('re-throws unexpected errors from the transaction', async () => {
      mocks.saRole.findUnique.mockResolvedValue({ id: 1, publicId: 'sq_r1', name: 'Editor', appId: 1 });
      mocks.saPermission.findMany.mockResolvedValue([]);
      (prisma.$transaction as jest.Mock).mockRejectedValueOnce(new Error('DB timeout'));
      await expect(makeService().updateRole('ba-caller', 'sq_r1', { name: 'new' })).rejects.toThrow('DB timeout');
    });
  });

  describe('createRole with non-empty permissionIds', () => {
    it('creates role and links permissions when permissionIds is provided (returns permissions in response)', async () => {
      mocks.saApp.findUnique.mockResolvedValue({ id: 1, publicId: 'sq_app1' });
      mocks.saPermission.findMany.mockResolvedValue([{ id: 10, publicId: 'sq_p1', appId: 1 }]);
      // Override $transaction to return a role WITH permissions so line 152 (map callback) is exercised
      (prisma.$transaction as jest.Mock).mockImplementationOnce(async (cb: (tx: unknown) => unknown) => {
        const txStub = {
          saRole: {
            create: jest.fn().mockResolvedValue({ id: 42, name: 'Editor', appId: 1, publicId: 'placeholder' }),
            update: jest.fn().mockResolvedValue({
              id: 42, publicId: 'sq_42', name: 'Editor', appId: 1,
              app: { publicId: 'sq_app1', name: 'Customer Portal' },
              permissions: [{ permission: { publicId: 'sq_p1', name: 'apps.read' } }],
            }),
          },
          saRolePermission: {
            createMany: jest.fn().mockResolvedValue({ count: 1 }),
            deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
          },
        };
        return cb(txStub);
      });
      const result = await makeService().createRole('ba-caller', {
        name: 'Editor', appId: 'sq_app1', permissionIds: ['sq_p1'],
      });
      expect(result.publicId).toBe('sq_42');
      expect(result.permissions).toEqual([{ publicId: 'sq_p1', name: 'apps.read' }]);
    });

    it('re-throws unexpected transaction errors', async () => {
      mocks.saApp.findUnique.mockResolvedValue({ id: 1, publicId: 'sq_app1' });
      mocks.saPermission.findMany.mockResolvedValue([]);
      (prisma.$transaction as jest.Mock).mockRejectedValueOnce(new Error('Network failure'));
      await expect(makeService().createRole('ba-caller', { name: 'Admin', appId: 'sq_app1' })).rejects.toThrow('Network failure');
    });
  });

  describe('deleteRole', () => {
    it('translates Prisma P2003 to ConflictException with userCount', async () => {
      mocks.saRole.findUnique.mockResolvedValue({ id: 1, publicId: 'sq_r1', name: 'Editor' });
      mocks.saUserRole.count.mockResolvedValue(3);
      (prisma.$transaction as jest.Mock).mockRejectedValueOnce({ code: 'P2003' });
      const promise = makeService().deleteRole('ba-caller', 'sq_r1');
      await expect(promise).rejects.toBeInstanceOf(ConflictException);
      await expect(promise).rejects.toMatchObject({ message: expect.stringContaining('3 users') });
    });

    it('happy path deletes', async () => {
      mocks.saRole.findUnique.mockResolvedValue({ id: 1, publicId: 'sq_r1', name: 'Editor' });
      await expect(makeService().deleteRole('ba-caller', 'sq_r1')).resolves.toBeUndefined();
      expect(checkPermission).toHaveBeenCalledWith('ba-caller', 'platform.roles.manage');
    });

    it('throws NotFound when the role does not exist', async () => {
      mocks.saRole.findUnique.mockResolvedValue(null);
      await expect(makeService().deleteRole('ba-caller', 'missing')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('re-throws unexpected errors from the transaction', async () => {
      mocks.saRole.findUnique.mockResolvedValue({ id: 1, publicId: 'sq_r1', name: 'Editor' });
      (prisma.$transaction as jest.Mock).mockRejectedValueOnce(new Error('Unexpected DB error'));
      await expect(makeService().deleteRole('ba-caller', 'sq_r1')).rejects.toThrow('Unexpected DB error');
    });
  });
});
