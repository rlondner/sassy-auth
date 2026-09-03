import 'dotenv/config';
import { prisma } from '@sassy-auth/db';
import Sqids from 'sqids';
import { generatePendingPublicId } from '../common/pending-public-id';

const sqids = new Sqids({
  alphabet: process.env.SQIDS_ALPHABET || undefined,
  minLength: 4,
});

const APP_NAME = 'vibecast';

const RESOURCES = ['content', 'connection', 'member', 'settings'] as const;
const BASE_ACTIONS = ['read', 'write', 'delete'] as const;
// approve only applies to content, per the vibecast permission model.
const RESOURCE_ACTIONS: Record<(typeof RESOURCES)[number], readonly string[]> = {
  content: [...BASE_ACTIONS, 'approve'],
  connection: BASE_ACTIONS,
  member: BASE_ACTIONS,
  settings: BASE_ACTIONS,
};

// Scoped app/org-level settings permissions, outside the resource.action combination matrix.
const EXTRA_PERMISSIONS = [
  'vibecast.app.settings.write',
  'vibecast.app.settings.read',
  'vibecast.org.settings.write',
  'vibecast.org.settings.read',
] as const;

const VIBECAST_PERMISSIONS: readonly string[] = [
  ...RESOURCES.flatMap((resource) =>
    RESOURCE_ACTIONS[resource].map((action) => `${APP_NAME}.${resource}.${action}`),
  ),
  ...EXTRA_PERMISSIONS,
];

async function main() {
  const app = await prisma.saApp.findUnique({ where: { name: APP_NAME } });
  if (!app) {
    throw new Error(
      `App "${APP_NAME}" not found. Create the vibecast SaApp before seeding its permissions.`,
    );
  }

  console.log(`Seeding ${VIBECAST_PERMISSIONS.length} vibecast permission(s)...`);

  for (const name of VIBECAST_PERMISSIONS) {
    const existing = await prisma.saPermission.findUnique({ where: { name } });
    if (existing) {
      console.log(`Permission already exists: ${name}`);
      continue;
    }
    await prisma.$transaction(async (tx) => {
      const created = await tx.saPermission.create({
        data: { publicId: generatePendingPublicId(), name, appId: app.id },
      });
      return tx.saPermission.update({
        where: { id: created.id },
        data: { publicId: sqids.encode([created.id]) },
      });
    });
    console.log(`Created permission: ${name}`);
  }

  console.log('Vibecast permission seed complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
