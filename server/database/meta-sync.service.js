import { prisma } from './prisma.js';
import { buildSummary, getMonthlyCharges } from '../meta.service.js';
import { getStoredTrmMap, getStoredTrmStatus, syncTrmMonth } from '../trm.service.js';
import { config } from '../config.js';


function getUsdCopProjection(amount, rateInfo) {
  if (!rateInfo) return null;

  const trmRate = Number(rateInfo.rate);
  const numericAmount = Number(amount);
  if (!Number.isFinite(trmRate) || trmRate <= 0 || !Number.isFinite(numericAmount)) return null;

  const spreadPercent = Number.isFinite(config.usdCopEffectiveSpreadPercent)
    ? config.usdCopEffectiveSpreadPercent
    : 0.48;
  const minSpreadPercent = Number.isFinite(config.usdCopEffectiveSpreadMinPercent)
    ? config.usdCopEffectiveSpreadMinPercent
    : spreadPercent;
  const maxSpreadPercent = Number.isFinite(config.usdCopEffectiveSpreadMaxPercent)
    ? config.usdCopEffectiveSpreadMaxPercent
    : spreadPercent;

  const minSpread = Math.min(minSpreadPercent, maxSpreadPercent);
  const maxSpread = Math.max(minSpreadPercent, maxSpreadPercent);
  const referenceCop = numericAmount * trmRate;
  const projectedRate = trmRate * (1 + spreadPercent / 100);
  const projectedCop = numericAmount * projectedRate;
  const projectedRateMin = trmRate * (1 + minSpread / 100);
  const projectedRateMax = trmRate * (1 + maxSpread / 100);

  return {
    trmRate,
    referenceCop,
    spreadPercent,
    projectedRate,
    projectedCop,
    projectedRateMin,
    projectedRateMax,
    projectedCopMin: numericAmount * projectedRateMin,
    projectedCopMax: numericAmount * projectedRateMax,
  };
}

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

function serializeBusiness(business) {
  const memberships = business.accounts || [];
  return {
    business_id: business.metaBusinessId,
    name: business.name || null,
    active: business.active,
    accessible: business.accessible,
    owned_accounts: memberships.filter((item) => item.relationship === 'OWNED').length,
    client_accounts: memberships.filter((item) => item.relationship === 'CLIENT').length,
    unique_accounts: new Set(memberships.map((item) => item.metaAccountId)).size,
    last_error: business.lastError || null,
    last_synced_at: business.lastSyncedAt?.toISOString() || null,
  };
}

function accountMemberships(account) {
  return (account.businesses || [])
    .map((membership) => ({
      business_id: membership.metaBusinessId,
      relationship: membership.relationship,
    }))
    .sort((a, b) => a.business_id.localeCompare(b.business_id));
}

function verifiedTransactionPayment(transaction) {
  const source = transaction.paymentMethodSource || transaction.payment_method_source || 'UNAVAILABLE';
  const rawPaymentMethod = transaction.paymentMethod ?? transaction.payment_method ?? null;
  const rawLastFour = transaction.lastFour ?? transaction.last4 ?? null;
  const verified = source !== 'UNAVAILABLE';

  return {
    source,
    verified,
    paymentMethod: verified ? rawPaymentMethod : null,
    lastFour: verified ? rawLastFour : null,
    discardedPaymentMethod: !verified ? rawPaymentMethod : null,
    discardedLastFour: !verified ? rawLastFour : null,
  };
}


function collectObjectPaths(value, prefix = '', output = []) {
  if (value === null || value === undefined) return output;
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectObjectPaths(item, `${prefix}[${index}]`, output));
    return output;
  }
  if (typeof value !== 'object') {
    if (prefix) output.push(prefix);
    return output;
  }
  for (const [key, item] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (item && typeof item === 'object') collectObjectPaths(item, path, output);
    else output.push(path);
  }
  return output;
}

const PAYMENT_DEBUG_EXTRA_KEYS = ['type', 'action', 'currency', 'new_value', 'transaction_id'];
const SENSITIVE_DEBUG_KEY = /(access[_-]?token|token|password|passwd|secret|authorization|api[_-]?key|client[_-]?secret)/i;

function sanitizeDebugValue(value, key = '', depth = 0) {
  if (SENSITIVE_DEBUG_KEY.test(key)) return '[REDACTED]';
  if (depth > 5) return '[MAX_DEPTH]';
  if (value === null || value === undefined) return value;

  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => sanitizeDebugValue(item, key, depth + 1));
  }

  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, childValue]) => [
        childKey,
        sanitizeDebugValue(childValue, childKey, depth + 1),
      ])
    );
  }

  if (typeof value === 'string' && value.length > 1000) {
    return `${value.slice(0, 1000)}...[TRUNCATED]`;
  }

  return value;
}

function buildSafePaymentExtraData(extraData) {
  if (!extraData || typeof extraData !== 'object') return null;

  const safe = {};
  for (const key of PAYMENT_DEBUG_EXTRA_KEYS) {
    if (Object.prototype.hasOwnProperty.call(extraData, key)) {
      safe[key] = sanitizeDebugValue(extraData[key], key);
    }
  }
  return safe;
}

export async function getStoredTransactionPaymentDetail(transactionId) {
  const normalized = String(transactionId || '').trim();
  if (!normalized) {
    const error = new Error('Transaction ID es obligatorio.');
    error.status = 400;
    throw error;
  }

  const transactions = await prisma.metaTransaction.findMany({
    where: { metaTransactionId: normalized },
    include: { account: true },
    orderBy: { eventTime: 'asc' },
  });

  return {
    ok: true,
    transaction_id: normalized,
    matches: transactions.map((transaction) => {
      const raw = transaction.rawData || {};
      const activity = raw?.transaction?.activity || null;
      const activityExtra = activity?.extra_data || null;
      const payment = verifiedTransactionPayment(transaction);
      return {
        account_id: transaction.metaAccountId,
        account_name: transaction.accountName,
        event_time: transaction.eventTime?.toISOString() || null,
        amount: Number(transaction.amount),
        currency: transaction.currency,
        payment_method: payment.paymentMethod,
        last4: payment.lastFour,
        payment_method_source: payment.source,
        payment_method_verified: payment.verified,
        unverified_legacy_payment_method: payment.discardedPaymentMethod,
        unverified_legacy_last4: payment.discardedLastFour,
        payment_status: transaction.paymentStatus || null,
        invoice_id: transaction.invoiceId || null,
        account_default_payment_method: transaction.accountDefaultPaymentMethod || null,
        account_default_last4: transaction.accountDefaultLastFour || null,
        activity_event_type: activity?.event_type || null,
        activity_translated_event_type: activity?.translated_event_type || null,
        activity_object_name: activity?.object_name || null,
        activity_extra_keys: activityExtra ? collectObjectPaths(activityExtra) : [],
        activity_extra_data: buildSafePaymentExtraData(activityExtra),
      };
    }),
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

  const [transactions, businesses, trmMap, trmStatus] = await Promise.all([
    prisma.metaTransaction.findMany({
      where: {
        transactionDate: {
          gte: from,
          lt: to,
        },
      },
      include: {
        account: {
          include: {
            businesses: true,
          },
        },
      },
      orderBy: [
        { transactionDate: 'asc' },
        { accountName: 'asc' },
        { eventTime: 'asc' },
      ],
    }),
    prisma.metaBusiness.findMany({
      where: { active: true },
      include: { accounts: true },
      orderBy: { metaBusinessId: 'asc' },
    }),
    getStoredTrmMap(period.year, period.month),
    getStoredTrmStatus(period.year, period.month),
  ]);

  const grouped = new Map();

  for (const transaction of transactions) {
    const date = transaction.transactionDate.toISOString().slice(0, 10);
    // Business membership is deliberately NOT part of this key. One ad account can
    // belong to several Business Managers, but its financial charge must be counted once.
    const key = `${date}|${transaction.metaAccountId}|${transaction.currency}`;
    const memberships = accountMemberships(transaction.account);
    const businessIds = memberships.map((item) => item.business_id);
    const rateInfo = transaction.currency === 'USD' ? trmMap.get(date) : null;
    const amount = Number(transaction.amount);
    const projection = transaction.currency === 'USD' ? getUsdCopProjection(amount, rateInfo) : null;
    const estimatedCop = projection?.referenceCop ?? null;
    const projectedCop = projection?.projectedCop ?? null;

    if (!grouped.has(key)) {
      grouped.set(key, {
        date,
        business_id: transaction.metaBusinessId || transaction.account.metaBusinessId || businessIds[0] || null,
        business_ids: businessIds,
        business_memberships: memberships,
        account_id: transaction.metaAccountId,
        account_name: transaction.accountName,
        currency: transaction.currency,
        charged: 0,
        trm_rate: rateInfo?.rate ?? null,
        trm_source: rateInfo?.source ?? null,
        estimated_cop: transaction.currency === 'USD' ? 0 : null,
        effective_spread_percent: projection?.spreadPercent ?? null,
        effective_rate_estimate: projection?.projectedRate ?? null,
        projected_cop: transaction.currency === 'USD' ? 0 : null,
        projected_cop_min: transaction.currency === 'USD' ? 0 : null,
        projected_cop_max: transaction.currency === 'USD' ? 0 : null,
        payment_method: 'No disponible',
        last4: 'No disponibles',
        account_default_payment_method: transaction.accountDefaultPaymentMethod || null,
        account_default_last4: transaction.accountDefaultLastFour || null,
        payment_changed: false,
        transactions: [],
      });
    }

    const row = grouped.get(key);
    row.charged += amount;
    if (estimatedCop !== null) row.estimated_cop += estimatedCop;
    if (projectedCop !== null) row.projected_cop += projectedCop;
    if (projection) {
      row.projected_cop_min += projection.projectedCopMin;
      row.projected_cop_max += projection.projectedCopMax;
      row.effective_spread_percent = projection.spreadPercent;
      row.effective_rate_estimate = projection.projectedRate;
    }
    if (!row.trm_rate && rateInfo) {
      row.trm_rate = rateInfo.rate;
      row.trm_source = rateInfo.source;
    }
    row.payment_changed = row.payment_changed || transaction.paymentMethodChanged;
    row.account_default_payment_method = row.account_default_payment_method || transaction.accountDefaultPaymentMethod || null;
    row.account_default_last4 = row.account_default_last4 || transaction.accountDefaultLastFour || null;
    const payment = verifiedTransactionPayment(transaction);
    row.transactions.push({
      transaction_id: transaction.metaTransactionId || 'No disponible',
      amount,
      currency: transaction.currency,
      event_time: transaction.eventTime.toISOString(),
      payment_method: payment.paymentMethod,
      last4: payment.lastFour,
      payment_method_source: payment.source,
      payment_method_verified: payment.verified,
      payment_status: transaction.paymentStatus || null,
      invoice_id: transaction.invoiceId || null,
      account_default_payment_method: transaction.accountDefaultPaymentMethod || null,
      account_default_last4: transaction.accountDefaultLastFour || null,
      trm_rate: rateInfo?.rate ?? null,
      trm_source: rateInfo?.source ?? null,
      estimated_cop: estimatedCop,
      effective_spread_percent: projection?.spreadPercent ?? null,
      effective_rate_estimate: projection?.projectedRate ?? null,
      projected_cop: projection?.projectedCop ?? null,
      projected_cop_min: projection?.projectedCopMin ?? null,
      projected_cop_max: projection?.projectedCopMax ?? null,
      reconciliation_status: transaction.reconciliationStatus,
      reconciliation_observation: transaction.reconciliationObservation || '',
    });
  }

  for (const row of grouped.values()) {
    const methods = [...new Set(row.transactions.map((tx) => tx.payment_method).filter(Boolean))];
    const last4Values = [...new Set(row.transactions.map((tx) => tx.last4).filter(Boolean))];
    row.payment_method = methods.length === 1 ? methods[0] : methods.length > 1 ? 'Varios (ver detalle)' : 'No disponible';
    row.last4 = last4Values.length === 1 ? last4Values[0] : last4Values.length > 1 ? 'Varios' : 'No disponibles';
  }

  const rows = [...grouped.values()];
  const latestSync = await getLatestMetaSync(period.year, period.month);
  const serializedBusinesses = businesses.map(serializeBusiness);
  const estimatedCopFromUsd = rows
    .filter((row) => row.currency === 'USD')
    .reduce((total, row) => total + Number(row.estimated_cop || 0), 0);
  const projectedCopFromUsd = rows
    .filter((row) => row.currency === 'USD')
    .reduce((total, row) => total + Number(row.projected_cop || 0), 0);

  return {
    period: period.key,
    rows,
    businesses: serializedBusinesses,
    summary: {
      ...buildSummary(rows),
      estimated_cop_from_usd: estimatedCopFromUsd,
      projected_cop_from_usd: projectedCopFromUsd,
      effective_spread_percent: config.usdCopEffectiveSpreadPercent,
      effective_spread_min_percent: config.usdCopEffectiveSpreadMinPercent,
      effective_spread_max_percent: config.usdCopEffectiveSpreadMaxPercent,
      configured_businesses: serializedBusinesses.length,
      accessible_businesses: serializedBusinesses.filter((item) => item.accessible).length,
    },
    trm: trmStatus,
    errors: serializedBusinesses
      .filter((item) => item.last_error)
      .map((item) => ({
        business_id: item.business_id,
        message: item.last_error,
      })),
    generated_at: new Date().toISOString(),
    source: 'database',
    latest_sync: latestSync,
  };
}

async function persistBusinessesAndAccounts(metaReport, now) {
  const configuredIds = (metaReport.businesses || []).map((item) => String(item.business_id));

  if (configuredIds.length) {
    await prisma.metaBusiness.updateMany({
      where: { metaBusinessId: { notIn: configuredIds } },
      data: { active: false },
    });
  }

  for (const business of metaReport.businesses || []) {
    const lastError = business.errors?.length
      ? business.errors.map((item) => `${item.edge}: ${item.message}`).join('\n')
      : null;

    await prisma.metaBusiness.upsert({
      where: { metaBusinessId: String(business.business_id) },
      create: {
        metaBusinessId: String(business.business_id),
        name: business.name || null,
        active: true,
        accessible: Boolean(business.accessible),
        lastError,
        lastSyncedAt: now,
      },
      update: {
        name: business.name || null,
        active: true,
        accessible: Boolean(business.accessible),
        lastError,
        lastSyncedAt: now,
      },
    });
  }

  for (const account of metaReport.accounts || []) {
    const memberships = account.business_memberships || [];
    const primary = memberships.find((item) => item.relationship === 'OWNED') || memberships[0] || null;

    await prisma.metaAdAccount.upsert({
      where: { metaAccountId: String(account.account_id) },
      create: {
        metaAccountId: String(account.account_id),
        metaObjectId: account.id ? String(account.id) : null,
        metaBusinessId: primary?.business_id ? String(primary.business_id) : null,
        name: account.name || String(account.account_id),
        currency: account.currency || 'UNKNOWN',
        timezoneName: account.timezone_name || null,
        active: true,
        lastSyncedAt: now,
      },
      update: {
        metaObjectId: account.id ? String(account.id) : null,
        metaBusinessId: primary?.business_id ? String(primary.business_id) : null,
        name: account.name || String(account.account_id),
        currency: account.currency || 'UNKNOWN',
        timezoneName: account.timezone_name || null,
        active: true,
        lastSyncedAt: now,
      },
    });
  }

  // If both account edges were read successfully we can safely rebuild the complete
  // mapping for that Business. With a partial Meta response we only upsert what we know,
  // preserving prior relationships that might belong to the edge that failed.
  for (const business of metaReport.businesses || []) {
    if (!business.accessible) continue;

    const businessId = String(business.business_id);
    if (business.accounts_complete) {
      await prisma.metaBusinessAccount.deleteMany({
        where: { metaBusinessId: businessId },
      });
    }

    for (const account of metaReport.accounts || []) {
      const membership = (account.business_memberships || []).find(
        (item) => String(item.business_id) === businessId,
      );
      if (!membership) continue;

      await prisma.metaBusinessAccount.upsert({
        where: {
          metaBusinessId_metaAccountId: {
            metaBusinessId: businessId,
            metaAccountId: String(account.account_id),
          },
        },
        create: {
          metaBusinessId: businessId,
          metaAccountId: String(account.account_id),
          relationship: membership.relationship,
          lastSyncedAt: now,
        },
        update: {
          relationship: membership.relationship,
          lastSyncedAt: now,
        },
      });
    }
  }
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

    await persistBusinessesAndAccounts(metaReport, now);

    const accountsById = new Map(
      (metaReport.accounts || []).map((account) => [String(account.account_id), account]),
    );

    for (const row of metaReport.rows) {
      const accountId = String(row.account_id);
      const accountMeta = accountsById.get(accountId);
      const memberships = row.business_memberships || accountMeta?.business_memberships || [];
      const primary = memberships.find((item) => item.relationship === 'OWNED') || memberships[0] || null;

      if (!accountMeta) {
        await prisma.metaAdAccount.upsert({
          where: { metaAccountId: accountId },
          create: {
            metaAccountId: accountId,
            metaBusinessId: primary?.business_id ? String(primary.business_id) : null,
            name: row.account_name || accountId,
            currency: row.currency || 'UNKNOWN',
            active: true,
            lastSyncedAt: now,
          },
          update: {
            metaBusinessId: primary?.business_id ? String(primary.business_id) : null,
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

          const payment = verifiedTransactionPayment(transaction);
          const data = {
            metaAccountId: accountId,
            metaTransactionId: transactionId,
            // Kept for backwards compatibility. The authoritative Business mapping
            // now lives in meta_business_accounts and can contain several IDs.
            metaBusinessId: primary?.business_id ? String(primary.business_id) : null,
            accountName: row.account_name || accountId,
            transactionDate,
            eventTime,
            currency: transaction.currency || row.currency || 'UNKNOWN',
            amount: Number(transaction.amount || 0),
            paymentMethod: payment.paymentMethod,
            lastFour: payment.lastFour,
            paymentMethodSource: payment.source,
            paymentStatus: transaction.payment_status || null,
            invoiceId: transaction.invoice_id || null,
            accountDefaultPaymentMethod: transaction.account_default_payment_method || row.account_default_payment_method || null,
            accountDefaultLastFour: transaction.account_default_last4 || row.account_default_last4 || null,
            paymentMethodChanged: Boolean(row.payment_changed),
            rawData: {
              source: 'META',
              period: period.key,
              row: {
                date: row.date,
                business_id: primary?.business_id || null,
                business_ids: row.business_ids || memberships.map((item) => item.business_id),
                business_memberships: memberships,
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
      ...metaReport.errors.map((item) => {
        const target = item.account_id
          ? `Cuenta ${item.account_id}`
          : `Business ${item.business_id || 'desconocido'}${item.edge ? ` (${item.edge})` : ''}`;
        return `${target}: ${item.message}`;
      }),
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

    let trmSyncError = null;
    try {
      await syncTrmMonth(period.year, period.month);
    } catch (error) {
      trmSyncError = error.message;
      console.warn('[SYNC TRM]', error.message);
    }

    const storedReport = await getStoredMonthlyCharges(period.year, period.month);
    return {
      ok: status !== 'FAILED',
      sync: storedReport.latest_sync,
      trm_sync: storedReport.trm?.latest_sync || null,
      trm_sync_error: trmSyncError,
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
