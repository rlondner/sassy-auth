/**
 * Verifies the post-migration state for the org.permissions.manage drop.
 * Runs against an already-migrated DB and asserts:
 *   - org.permissions.manage is gone
 *   - org.roles.manage exists with isSystem = true
 *   - platform.roles.manage exists with isSystem = false
 *
 * This is a forward-only assertion of the contract Migration 2 delivers.
 * It does NOT run the migration itself; the test harness migrates the DB
 * before any spec runs (see test/matrix/harness.ts and the scenario
 * factories).
 */
import 'dotenv/config';
import { prisma } from '@sassy-auth/db';

describe('migration 20260618220100: drop org.permissions.manage', () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('removed org.permissions.manage', async () => {
    const obsolete = await prisma.saPermission.findUnique({ where: { name: 'org.permissions.manage' } });
    expect(obsolete).toBeNull();
  });

  it('added org.roles.manage with isSystem=true', async () => {
    const orgRoles = await prisma.saPermission.findUnique({ where: { name: 'org.roles.manage' } });
    expect(orgRoles).not.toBeNull();
    expect(orgRoles!.isSystem).toBe(true);
  });

  it('added platform.roles.manage with isSystem=false', async () => {
    const platformRoles = await prisma.saPermission.findUnique({ where: { name: 'platform.roles.manage' } });
    expect(platformRoles).not.toBeNull();
    expect(platformRoles!.isSystem).toBe(false);
  });

  it('Platform Super Admin role includes platform.roles.manage', async () => {
    const superRole = await prisma.saRole.findFirst({
      where: { name: 'Platform Super Admin' },
      include: { permissions: { include: { permission: true } } },
    });
    expect(superRole).not.toBeNull();
    const permNames = superRole!.permissions.map((rp: any) => rp.permission.name);
    expect(permNames).toContain('platform.roles.manage');
  });
});
