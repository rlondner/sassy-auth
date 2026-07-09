import { prisma } from '../packages/db/dist/index.js';
const total = await prisma.saApp.count();
const platform = await prisma.saApp.findFirst({ where: { isPlatform: true } });
const e2eOrphans = await prisma.saApp.count({ where: { name: { contains: 'e2e' } } });
console.log(JSON.stringify({ total, platformId: platform?.id, platformPublicId: platform?.publicId, e2eOrphans }, null, 2));
await prisma.$disconnect();
