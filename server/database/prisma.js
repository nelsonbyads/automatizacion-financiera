import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis;

export const prisma = globalForPrisma.__metaFinancePrisma || new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.__metaFinancePrisma = prisma;
}

export async function disconnectPrisma() {
  await prisma.$disconnect();
}
