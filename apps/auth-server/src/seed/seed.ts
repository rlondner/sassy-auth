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
    const created = await prisma.saApp.create({
      data: {
        publicId: 'placeholder',
        name: 'SassyAuth',
        url: process.env.BETTER_AUTH_URL ?? 'http://localhost:3000',
        isPlatform: true,
      },
    });
    const publicId = sqids.encode([created.id]);
    platformApp = await prisma.saApp.update({
      where: { id: created.id },
      data: { publicId },
    });
    console.log(`Created platform app: id=${platformApp.id}, publicId=${platformApp.publicId}`);
  } else {
    console.log(`Platform app already exists: publicId=${platformApp.publicId}`);
  }

  // 2. Platform org
  let platformOrg = await prisma.saOrg.findFirst({ where: { isPlatform: true } });

  if (!platformOrg) {
    const created = await prisma.saOrg.create({
      data: {
        publicId: 'placeholder',
        name: 'Platform',
        appId: platformApp.id,
        isPlatform: true,
      },
    });
    const publicId = sqids.encode([created.id]);
    platformOrg = await prisma.saOrg.update({
      where: { id: created.id },
      data: { publicId },
    });
    console.log(`Created platform org: id=${platformOrg.id}, publicId=${platformOrg.publicId}`);
  } else {
    console.log(`Platform org already exists: publicId=${platformOrg.publicId}`);
  }

  // 3. Platform permissions (immutable — create if absent, never update)
  for (const name of PLATFORM_PERMISSIONS) {
    const existing = await prisma.saPermission.findUnique({ where: { name } });
    if (!existing) {
      const created = await prisma.saPermission.create({
        data: {
          publicId: 'placeholder',
          name,
          appId: platformApp.id,
        },
      });
      const publicId = sqids.encode([created.id]);
      await prisma.saPermission.update({
        where: { id: created.id },
        data: { publicId },
      });
      console.log(`Created permission: ${name}`);
    }
  }

  console.log('Seed complete.');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
