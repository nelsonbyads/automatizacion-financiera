import { config, validateMetaConfig } from './config.js';

const cache = new Map();

function parseJson(value) {
  try {
    if (!value) return {};
    if (typeof value === 'object') return value;
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function normalizeAmount(raw, currency) {
  const value = Number(raw || 0);
  return currency === 'USD' ? value / 100 : value;
}

function localDate(eventTime, timezone = 'America/Bogota') {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(eventTime));

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function paymentInfo(account) {
  const details = parseJson(account.funding_source_details);
  const display = details.display_string || 'No disponible';
  const matches = String(display).match(/\d{4}/g);

  return {
    display,
    last4: matches?.at(-1) || 'No disponibles',
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

function periodRange(periodKey) {
  const [year, month] = periodKey.split('-').map(Number);
  const nextMonthDate = new Date(Date.UTC(year, month, 1));
  const nextYear = nextMonthDate.getUTCFullYear();
  const nextMonth = String(nextMonthDate.getUTCMonth() + 1).padStart(2, '0');

  return {
    since: `${periodKey}-01T00:00:00-05:00`,
    until: `${nextYear}-${nextMonth}-01T00:00:00-05:00`,
  };
}

async function graphGet(url) {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${config.metaAccessToken}`,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    const error = new Error(`Meta Graph API respondió HTTP ${response.status}.`);
    error.status = response.status >= 500 ? 502 : 400;
    error.details = body;
    throw error;
  }

  return response.json();
}

async function fetchAllPages(initialUrl) {
  const items = [];
  let nextUrl = initialUrl;

  while (nextUrl) {
    const json = await graphGet(nextUrl);
    items.push(...(json.data || []));
    nextUrl = json.paging?.next || null;
  }

  return items;
}

async function fetchAccountsForBusiness(businessId) {
  const fields = [
    'id',
    'account_id',
    'name',
    'currency',
    'timezone_name',
    'funding_source',
    'funding_source_details',
  ].join(',');

  const url = `https://graph.facebook.com/${config.metaGraphVersion}/${businessId}/owned_ad_accounts` +
    `?fields=${encodeURIComponent(fields)}&limit=500`;

  const accounts = await fetchAllPages(url);
  return accounts.map((account) => ({ ...account, business_id: businessId }));
}

async function fetchAccounts() {
  const accountsById = new Map();
  const errors = [];

  for (const businessId of config.metaBusinessIds) {
    try {
      const accounts = await fetchAccountsForBusiness(businessId);
      for (const account of accounts) {
        const accountId = String(account.account_id || account.id);
        if (!accountsById.has(accountId)) {
          accountsById.set(accountId, account);
        }
      }
    } catch (error) {
      errors.push({
        business_id: businessId,
        message: error.message,
        details: error.details || null,
      });
    }
  }

  return { accounts: [...accountsById.values()], errors };
}

async function fetchAccountActivities(account, periodKey) {
  const { since, until } = periodRange(periodKey);
  const fields = [
    'event_time',
    'event_type',
    'translated_event_type',
    'extra_data',
    'object_id',
    'object_name',
  ].join(',');

  const url = `https://graph.facebook.com/${config.metaGraphVersion}/${account.id}/activities` +
    `?fields=${encodeURIComponent(fields)}` +
    '&category=BUDGET' +
    `&since=${encodeURIComponent(since)}` +
    `&until=${encodeURIComponent(until)}` +
    '&limit=500';

  return fetchAllPages(url);
}

export function buildRowsFromActivities(account, activities, periodKey) {
  const accountId = account.account_id;
  const accountName = account.name || accountId;
  const accountCurrency = account.currency || 'UNKNOWN';
  const timezone = account.timezone_name || 'America/Bogota';
  const payment = paymentInfo(account);
  const paymentChanged = activities.some((row) =>
    row.event_type === 'add_funding_source' || row.event_type === 'remove_funding_source'
  );

  const byDay = new Map();

  activities
    .filter((row) => row.event_type === 'ad_account_billing_charge')
    .forEach((row) => {
      const extra = parseJson(row.extra_data);
      const date = localDate(row.event_time, timezone);
      if (!date.startsWith(periodKey)) return;

      const currency = extra.currency || accountCurrency;
      const amount = normalizeAmount(extra.new_value, currency);
      const key = `${date}|${currency}`;

      if (!byDay.has(key)) {
        byDay.set(key, {
          date,
          business_id: account.business_id || null,
          account_id: accountId,
          account_name: accountName,
          currency,
          charged: 0,
          payment_method: payment.display,
          last4: payment.last4,
          payment_changed: paymentChanged,
          transactions: [],
        });
      }

      const item = byDay.get(key);
      item.charged += amount;
      item.transactions.push({
        transaction_id: extra.transaction_id || 'No disponible',
        amount,
        currency,
        event_time: row.event_time,
      });
    });

  return [...byDay.values()];
}

export function buildSummary(rows) {
  const totals = {};
  const accountIds = new Set();
  const businessIds = new Set();
  let transactions = 0;
  let paymentChanges = 0;

  for (const row of rows) {
    totals[row.currency] = (totals[row.currency] || 0) + Number(row.charged || 0);
    accountIds.add(row.account_id);
    if (row.business_id) businessIds.add(row.business_id);
    transactions += row.transactions?.length || 0;
    if (row.payment_changed) paymentChanges += 1;
  }

  return {
    businesses: businessIds.size,
    accounts: accountIds.size,
    transactions,
    payment_changes: paymentChanges,
    totals,
  };
}

function getCached(periodKey) {
  const entry = cache.get(periodKey);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(periodKey);
    return null;
  }
  return entry.value;
}

function setCached(periodKey, value) {
  if (!config.cacheTtlSeconds) return;
  cache.set(periodKey, {
    value,
    expiresAt: Date.now() + config.cacheTtlSeconds * 1000,
  });
}

export async function getMonthlyCharges(year, month, { forceRefresh = false } = {}) {
  validateMetaConfig();
  const period = validatePeriod(year, month);

  if (!forceRefresh) {
    const cached = getCached(period.key);
    if (cached) return { ...cached, cached: true };
  }

  const accountResult = await fetchAccounts();
  const accounts = accountResult.accounts;
  if (!accounts.length) {
    const error = new Error('Ninguno de los Business Manager configurados devolvió cuentas publicitarias.');
    error.status = 404;
    error.details = accountResult.errors.length ? JSON.stringify(accountResult.errors) : undefined;
    throw error;
  }

  const rows = [];
  const errors = accountResult.errors.map((item) => ({
    business_id: item.business_id,
    account_id: null,
    account_name: null,
    message: item.message,
  }));

  for (const account of accounts) {
    try {
      const activities = await fetchAccountActivities(account, period.key);
      rows.push(...buildRowsFromActivities(account, activities, period.key));
    } catch (error) {
      errors.push({
        business_id: account.business_id || null,
        account_id: account.account_id,
        account_name: account.name || account.account_id,
        message: error.message,
      });
    }
  }

  rows.sort((a, b) =>
    a.date.localeCompare(b.date) || a.account_name.localeCompare(b.account_name)
  );

  const value = {
    period: period.key,
    rows,
    accounts: accounts.map((account) => ({
      id: account.id || null,
      business_id: account.business_id || null,
      account_id: account.account_id,
      name: account.name || account.account_id,
      currency: account.currency || 'UNKNOWN',
      timezone_name: account.timezone_name || null,
    })),
    summary: buildSummary(rows),
    errors,
    generated_at: new Date().toISOString(),
    cached: false,
    source: 'meta',
  };

  setCached(period.key, value);
  return value;
}

export function clearMetaCache() {
  cache.clear();
}
