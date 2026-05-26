import { prisma } from '@sassy-auth/db';
import Sqids from 'sqids';

const sqids = new Sqids({
  alphabet: process.env.SQIDS_ALPHABET || undefined,
  minLength: 4,
});

const PLATFORM_PERMISSIONS = [
  'platform.orgs.manage',
  'platform.apps.manage',
  'platform.users.manage',
  'platform.permissions.manage',
  'org.users.manage',
  'org.permissions.manage',
] as const;

async function main() {
  console.log('Seeding platform data...');

  // 1. Platform app
  let platformApp = await prisma.saApp.findFirst({ where: { isPlatform: true } });

  if (!platformApp) {
    platformApp = await prisma.$transaction(async (tx) => {
      const created = await tx.saApp.create({
        data: {
          publicId: 'placeholder',
          name: 'SassyAuth',
          url: process.env.BETTER_AUTH_URL ?? 'http://localhost:3000',
          isPlatform: true,
        },
      });
      const publicId = sqids.encode([created.id]);
      return tx.saApp.update({
        where: { id: created.id },
        data: { publicId },
      });
    });
    console.log(`Created platform app: id=${platformApp.id}, publicId=${platformApp.publicId}`);
  } else {
    console.log(`Platform app already exists: publicId=${platformApp.publicId}`);
  }

  // 2. Platform org
  let platformOrg = await prisma.saOrg.findFirst({ where: { isPlatform: true } });

  if (!platformOrg) {
    platformOrg = await prisma.$transaction(async (tx) => {
      const created = await tx.saOrg.create({
        data: {
          publicId: 'placeholder',
          name: 'Platform',
          appId: platformApp!.id,
          isPlatform: true,
        },
      });
      const publicId = sqids.encode([created.id]);
      return tx.saOrg.update({
        where: { id: created.id },
        data: { publicId },
      });
    });
    console.log(`Created platform org: id=${platformOrg.id}, publicId=${platformOrg.publicId}`);
  } else {
    console.log(`Platform org already exists: publicId=${platformOrg.publicId}`);
  }

  // 3. Platform permissions (immutable — create if absent, never update)
  for (const name of PLATFORM_PERMISSIONS) {
    const existing = await prisma.saPermission.findUnique({ where: { name } });
    if (!existing) {
      await prisma.$transaction(async (tx) => {
        const c = await tx.saPermission.create({
          data: { publicId: 'placeholder', name, appId: platformApp!.id },
        });
        const publicId = sqids.encode([c.id]);
        return tx.saPermission.update({ where: { id: c.id }, data: { publicId } });
      });
      console.log(`Created permission: ${name}`);
    }
  }

  console.log('Seed complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
