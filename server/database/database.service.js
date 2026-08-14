import { prisma } from './prisma.js';

export async function getDatabaseHealth() {
  const startedAt = Date.now();
  await prisma.$queryRaw`SELECT 1`;

  const [accounts, transactions, syncRuns] = await Promise.all([
    prisma.metaAdAccount.count(),
    prisma.metaTransaction.count(),
    prisma.syncRun.count(),
  ]);

  return {
    ok: true,
    service: 'postgresql',
    responseTimeMs: Date.now() - startedAt,
    counts: {
      metaAdAccounts: accounts,
      metaTransactions: transactions,
      syncRuns,
    },
  };
}
