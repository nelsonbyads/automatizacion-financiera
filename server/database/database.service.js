import { prisma } from './prisma.js';

export async function getDatabaseHealth() {
  const startedAt = Date.now();
  await prisma.$queryRaw`SELECT 1`;

  const [businesses, businessAccounts, accounts, transactions, exchangeRates, syncRuns] = await Promise.all([
    prisma.metaBusiness.count(),
    prisma.metaBusinessAccount.count(),
    prisma.metaAdAccount.count(),
    prisma.metaTransaction.count(),
    prisma.exchangeRate.count(),
    prisma.syncRun.count(),
  ]);

  return {
    ok: true,
    service: 'postgresql',
    responseTimeMs: Date.now() - startedAt,
    counts: {
      metaBusinesses: businesses,
      metaBusinessAccounts: businessAccounts,
      metaAdAccounts: accounts,
      metaTransactions: transactions,
      exchangeRates,
      syncRuns,
    },
  };
}
