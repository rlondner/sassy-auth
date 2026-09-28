import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ServiceUsersService } from './service-users.service';

jest.mock('@sassy-auth/db', () => ({
  prisma: {
    saUser: { findUnique: jest.fn() },
    saRole: { findUnique: jest.fn() },
    saUserRole: { create: jest.fn(), delete: jest.fn() },
  },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const mockPrisma = require('@sassy-auth/db').prisma as {
  saUser: { findUnique: jest.Mock };
  saRole: { findUnique: jest.Mock };
  saUserRole: { create: jest.Mock; delete: jest.Mock };
};

const CALLING_APP_ID = 7;
const OTHER_APP_ID = 99;

function makeUser(orgAppId: number) {
  return { id: 1, publicId: 'usr1', org: { appId: orgAppId } };
}
function makeRole(appId: number, isSystem = false) {
  return { id: 5, publicId: 'role1', appId, permissions: [{ permission: { isSystem } }] };
}

describe('ServiceUsersService', () => {
  let service: ServiceUsersService;

  beforeEach(() => {
    service = new ServiceUsersService();
    jest.clearAllMocks();
  });

  describe('assignRole', () => {
    it('creates the SaUserRole link when user and role both belong to the calling app', async () => {
      mockPrisma.saUser.findUnique.mockResolvedValue(makeUser(CALLING_APP_ID));
      mockPrisma.saRole.findUnique.mockResolvedValue(makeRole(CALLING_APP_ID));
      mockPrisma.saUserRole.create.mockResolvedValue(undefined);

      await expect(service.assignRole(CALLING_APP_ID, 'usr1', 'role1')).resolves.toBeUndefined();
      expect(mockPrisma.saUserRole.create).toHaveBeenCalledWith({ data: { userId: 1, roleId: 5 } });
    });

    it('is idempotent when the role is already assigned (Prisma P2002)', async () => {
      mockPrisma.saUser.findUnique.mockResolvedValue(makeUser(CALLING_APP_ID));
      mockPrisma.saRole.findUnique.mockResolvedValue(makeRole(CALLING_APP_ID));
      mockPrisma.saUserRole.create.mockImplementationOnce(() => {
        const err = new Error('Unique constraint failed');
        (err as Error & { code?: string }).code = 'P2002';
        return Promise.reject(err);
      });

      await expect(service.assignRole(CALLING_APP_ID, 'usr1', 'role1')).resolves.toBeUndefined();
    });

    it('re-throws unexpected errors', async () => {
      mockPrisma.saUser.findUnique.mockResolvedValue(makeUser(CALLING_APP_ID));
      mockPrisma.saRole.findUnique.mockResolvedValue(makeRole(CALLING_APP_ID));
      mockPrisma.saUserRole.create.mockRejectedValue(new Error('DB timeout'));

      await expect(service.assignRole(CALLING_APP_ID, 'usr1', 'role1')).rejects.toThrow('DB timeout');
    });

    it('404s when the user does not exist', async () => {
      mockPrisma.saUser.findUnique.mockResolvedValue(null);
      await expect(service.assignRole(CALLING_APP_ID, 'missing', 'role1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('404s when the user belongs to a different app', async () => {
      mockPrisma.saUser.findUnique.mockResolvedValue(makeUser(OTHER_APP_ID));
      await expect(service.assignRole(CALLING_APP_ID, 'usr1', 'role1')).rejects.toBeInstanceOf(NotFoundException);
      expect(mockPrisma.saUserRole.create).not.toHaveBeenCalled();
    });

    it('404s when the role does not exist', async () => {
      mockPrisma.saUser.findUnique.mockResolvedValue(makeUser(CALLING_APP_ID));
      mockPrisma.saRole.findUnique.mockResolvedValue(null);
      await expect(service.assignRole(CALLING_APP_ID, 'usr1', 'missing')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('404s when the role belongs to a different app', async () => {
      mockPrisma.saUser.findUnique.mockResolvedValue(makeUser(CALLING_APP_ID));
      mockPrisma.saRole.findUnique.mockResolvedValue(makeRole(OTHER_APP_ID));
      await expect(service.assignRole(CALLING_APP_ID, 'usr1', 'role1')).rejects.toBeInstanceOf(NotFoundException);
      expect(mockPrisma.saUserRole.create).not.toHaveBeenCalled();
    });

    it('rejects a role carrying a system permission regardless of app match', async () => {
      mockPrisma.saUser.findUnique.mockResolvedValue(makeUser(CALLING_APP_ID));
      mockPrisma.saRole.findUnique.mockResolvedValue(makeRole(CALLING_APP_ID, true));
      await expect(service.assignRole(CALLING_APP_ID, 'usr1', 'role1')).rejects.toBeInstanceOf(ForbiddenException);
      expect(mockPrisma.saUserRole.create).not.toHaveBeenCalled();
    });

    it('allows assigning a role with no permissions at all', async () => {
      mockPrisma.saUser.findUnique.mockResolvedValue(makeUser(CALLING_APP_ID));
      mockPrisma.saRole.findUnique.mockResolvedValue({ id: 5, publicId: 'role1', appId: CALLING_APP_ID, permissions: [] });
      mockPrisma.saUserRole.create.mockResolvedValue(undefined);

      await expect(service.assignRole(CALLING_APP_ID, 'usr1', 'role1')).resolves.toBeUndefined();
      expect(mockPrisma.saUserRole.create).toHaveBeenCalledWith({ data: { userId: 1, roleId: 5 } });
    });
  });

  describe('removeRole', () => {
    it('deletes the SaUserRole link when user and role both belong to the calling app', async () => {
      mockPrisma.saUser.findUnique.mockResolvedValue(makeUser(CALLING_APP_ID));
      mockPrisma.saRole.findUnique.mockResolvedValue(makeRole(CALLING_APP_ID));
      mockPrisma.saUserRole.delete.mockResolvedValue(undefined);

      await expect(service.removeRole(CALLING_APP_ID, 'usr1', 'role1')).resolves.toBeUndefined();
      expect(mockPrisma.saUserRole.delete).toHaveBeenCalledWith({
        where: { userId_roleId: { userId: 1, roleId: 5 } },
      });
    });

    it('is idempotent when the role is not currently assigned (Prisma P2025)', async () => {
      mockPrisma.saUser.findUnique.mockResolvedValue(makeUser(CALLING_APP_ID));
      mockPrisma.saRole.findUnique.mockResolvedValue(makeRole(CALLING_APP_ID));
      mockPrisma.saUserRole.delete.mockImplementationOnce(() => {
        const err = new Error('Record not found');
        (err as Error & { code?: string }).code = 'P2025';
        return Promise.reject(err);
      });

      await expect(service.removeRole(CALLING_APP_ID, 'usr1', 'role1')).resolves.toBeUndefined();
    });

    it('404s when the role belongs to a different app', async () => {
      mockPrisma.saUser.findUnique.mockResolvedValue(makeUser(CALLING_APP_ID));
      mockPrisma.saRole.findUnique.mockResolvedValue(makeRole(OTHER_APP_ID));
      await expect(service.removeRole(CALLING_APP_ID, 'usr1', 'role1')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
