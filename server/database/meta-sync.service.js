import { prisma } from './prisma.js';
import { buildSummary, getMonthlyCharges } from '../meta.service.js';

function validatePeriod(year, month) {
  const parsedYear = Number(year);
  const parsedMonth = Number(month);

  if (!Number.isInteger(parsedYear) || parsedYear < 2020 || parsedYear > 2100) {
    const error = new Error('El año debe ser un valor válido entre 2020 y 2100.');
    error.status = 400;
    throw error;
  }

  if (!Number.isInteger(parsedMonth) || parsedMonth < 1 || parsedMonth > 12) {
    const error = new Error('El mes debe estar entre 1 y 12.');
    error.status = 400;
    throw error;
  }

  return {
    year: parsedYear,
    month: parsedMonth,
    key: `${parsedYear}-${String(parsedMonth).padStart(2, '0')}`,
  };
}

function dateRange(year, month) {
  return {
    from: new Date(Date.UTC(year, month - 1, 1)),
    to: new Date(Date.UTC(year, month, 1)),
  };
}

function normalizeTransactionId(value) {
  const transactionId = String(value || '').trim();
  return transactionId && transactionId !== 'No disponible' ? transactionId : 'No disponible';
}

function serializeSyncRun(run) {
  if (!run) return null;
  return {
    id: run.id,
    source: run.source,
    year: run.year,
    month: run.month,
    status: run.status,
    started_at: run.startedAt?.toISOString() || null,
    finished_at: run.finishedAt?.toISOString() || null,
    records_received: run.recordsReceived,
    records_created: run.recordsCreated,
    records_updated: run.recordsUpdated,
    records_failed: run.recordsFailed,
    error: run.error,
  };
}

export async function getLatestMetaSync(year, month) {
  const period = validatePeriod(year, month);
  const run = await prisma.syncRun.findFirst({
    where: {
      source: 'META',
      year: period.year,
      month: period.month,
    },
    orderBy: { startedAt: 'desc' },
  });

  return serializeSyncRun(run);
}

export async function getStoredMonthlyCharges(year, month) {
  const period = validatePeriod(year, month);
  const { from, to } = dateRange(period.year, period.month);

  const transactions = await prisma.metaTransaction.findMany({
    where: {
      transactionDate: {
        gte: from,
        lt: to,
      },
    },
    include: { account: true },
    orderBy: [
      { transactionDate: 'asc' },
      { accountName: 'asc' },
      { eventTime: 'asc' },
    ],
  });

  const grouped = new Map();

  for (const transaction of transactions) {
    const date = transaction.transactionDate.toISOString().slice(0, 10);
    const key = `${date}|${transaction.metaBusinessId || ''}|${transaction.metaAccountId}|${transaction.currency}`;

    if (!grouped.has(key)) {
      grouped.set(key, {
        date,
        business_id: transaction.metaBusinessId || transaction.account.metaBusinessId || null,
        account_id: transaction.metaAccountId,
        account_name: transaction.accountName,
        currency: transaction.currency,
        charged: 0,
        payment_method: transaction.paymentMethod || 'No disponible',
        last4: transaction.lastFour || 'No disponibles',
        payment_changed: false,
        transactions: [],
      });
    }

    const row = grouped.get(key);
    row.charged += Number(transaction.amount);
    row.payment_changed = row.payment_changed || transaction.paymentMethodChanged;
    row.payment_method = transaction.paymentMethod || row.payment_method;
    row.last4 = transaction.lastFour || row.last4;
    row.transactions.push({
      transaction_id: transaction.metaTransactionId || 'No disponible',
      amount: Number(transaction.amount),
      currency: transaction.currency,
      event_time: transaction.eventTime.toISOString(),
      reconciliation_status: transaction.reconciliationStatus,
      reconciliation_observation: transaction.reconciliationObservation || '',
    });
  }

  const rows = [...grouped.values()];
  const latestSync = await getLatestMetaSync(period.year, period.month);

  return {
    period: period.key,
    rows,
    summary: buildSummary(rows),
    errors: [],
    generated_at: new Date().toISOString(),
    source: 'database',
    latest_sync: latestSync,
  };
}

export async function syncMetaMonth(year, month) {
  const period = validatePeriod(year, month);
  const syncRun = await prisma.syncRun.create({
    data: {
      source: 'META',
      year: period.year,
      month: period.month,
      status: 'RUNNING',
    },
  });

  let received = 0;
  let created = 0;
  let updated = 0;
  let failed = 0;

  try {
    const metaReport = await getMonthlyCharges(period.year, period.month, { forceRefresh: true });
    received = metaReport.rows.reduce((total, row) => total + (row.transactions?.length || 0), 0);
    const now = new Date();

    const accountsById = new Map((metaReport.accounts || []).map((account) => [String(account.account_id), account]));

    for (const account of metaReport.accounts || []) {
      await prisma.metaAdAccount.upsert({
        where: { metaAccountId: String(account.account_id) },
        create: {
          metaAccountId: String(account.account_id),
          metaObjectId: account.id ? String(account.id) : null,
          metaBusinessId: account.business_id ? String(account.business_id) : null,
          name: account.name || String(account.account_id),
          currency: account.currency || 'UNKNOWN',
          timezoneName: account.timezone_name || null,
          active: true,
          lastSyncedAt: now,
        },
        update: {
          metaObjectId: account.id ? String(account.id) : null,
          metaBusinessId: account.business_id ? String(account.business_id) : null,
          name: account.name || String(account.account_id),
          currency: account.currency || 'UNKNOWN',
          timezoneName: account.timezone_name || null,
          active: true,
          lastSyncedAt: now,
        },
      });
    }

    for (const row of metaReport.rows) {
      const accountId = String(row.account_id);
      const accountMeta = accountsById.get(accountId);

      if (!accountMeta) {
        await prisma.metaAdAccount.upsert({
          where: { metaAccountId: accountId },
          create: {
            metaAccountId: accountId,
            metaBusinessId: row.business_id ? String(row.business_id) : null,
            name: row.account_name || accountId,
            currency: row.currency || 'UNKNOWN',
            active: true,
            lastSyncedAt: now,
          },
          update: {
            metaBusinessId: row.business_id ? String(row.business_id) : null,
            name: row.account_name || accountId,
            currency: row.currency || 'UNKNOWN',
            active: true,
            lastSyncedAt: now,
          },
        });
      }

      for (const transaction of row.transactions || []) {
        try {
          const eventTime = new Date(transaction.event_time);
          if (Number.isNaN(eventTime.getTime())) {
            throw new Error(`Fecha de evento inválida para la cuenta ${accountId}.`);
          }

          const transactionDate = new Date(`${row.date}T00:00:00.000Z`);
          const transactionId = normalizeTransactionId(transaction.transaction_id);
          const where = {
            metaAccountId_metaTransactionId_eventTime: {
              metaAccountId: accountId,
              metaTransactionId: transactionId,
              eventTime,
            },
          };

          const existing = await prisma.metaTransaction.findUnique({
            where,
            select: { id: true },
          });

          const data = {
            metaAccountId: accountId,
            metaTransactionId: transactionId,
            metaBusinessId: row.business_id ? String(row.business_id) : (accountMeta?.business_id ? String(accountMeta.business_id) : null),
            accountName: row.account_name || accountId,
            transactionDate,
            eventTime,
            currency: transaction.currency || row.currency || 'UNKNOWN',
            amount: Number(transaction.amount || 0),
            paymentMethod: row.payment_method || null,
            lastFour: row.last4 || null,
            paymentMethodChanged: Boolean(row.payment_changed),
            rawData: {
              source: 'META',
              period: period.key,
              row: {
                date: row.date,
                business_id: row.business_id || null,
                account_id: accountId,
                account_name: row.account_name,
                currency: row.currency,
              },
              transaction,
            },
            syncedAt: now,
          };

          await prisma.metaTransaction.upsert({
            where,
            create: data,
            update: data,
          });

          if (existing) updated += 1;
          else created += 1;
        } catch (error) {
          failed += 1;
          console.error('[SYNC META]', error.message);
        }
      }
    }

    const status = failed > 0 || metaReport.errors.length > 0 ? 'PARTIAL' : 'SUCCESS';
    const errorMessages = [
      ...metaReport.errors.map((item) => `${item.account_id}: ${item.message}`),
      failed > 0 ? `${failed} transacción(es) no pudieron almacenarse.` : null,
    ].filter(Boolean);

    await prisma.syncRun.update({
      where: { id: syncRun.id },
      data: {
        status,
        finishedAt: new Date(),
        recordsReceived: received,
        recordsCreated: created,
        recordsUpdated: updated,
        recordsFailed: failed,
        error: errorMessages.length ? errorMessages.join('\n') : null,
      },
    });

    const storedReport = await getStoredMonthlyCharges(period.year, period.month);
    return {
      ok: status !== 'FAILED',
      sync: storedReport.latest_sync,
      report: storedReport,
    };
  } catch (error) {
    await prisma.syncRun.update({
      where: { id: syncRun.id },
      data: {
        status: 'FAILED',
        finishedAt: new Date(),
        recordsReceived: received,
        recordsCreated: created,
        recordsUpdated: updated,
        recordsFailed: failed,
        error: error.message,
      },
    }).catch(() => {});

    throw error;
  }
}
