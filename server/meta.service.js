import { config, validateMetaConfig } from './config.js';

const cache = new Map();

const BUSINESS_EDGES = [
  { edge: 'owned_ad_accounts', relationship: 'OWNED' },
  { edge: 'client_ad_accounts', relationship: 'CLIENT' },
];

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
    last4: matches?.at(-1) || null,
    fundingSourceId: account.funding_source ? String(account.funding_source) : null,
  };
}

function flattenExtraData(value, path = '', output = []) {
  if (value === null || value === undefined) return output;

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) ||
        (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try {
        return flattenExtraData(JSON.parse(trimmed), path, output);
      } catch {
        // Keep the original scalar when a string only looks like JSON.
      }
    }
    output.push({ path, key: path.split('.').at(-1) || '', value });
    return output;
  }

  if (typeof value !== 'object') {
    output.push({ path, key: path.split('.').at(-1) || '', value });
    return output;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => flattenExtraData(item, `${path}[${index}]`, output));
    return output;
  }

  for (const [key, item] of Object.entries(value)) {
    flattenExtraData(item, path ? `${path}.${key}` : key, output);
  }

  return output;
}

function extractLast4FromText(value) {
  const text = String(value || '');
  const masked = text.match(/(?:\*|•|x|X|\.){2,}\s*(\d{4})\b/);
  if (masked) return masked[1];

  const labelled = text.match(/(?:last\s*4|last\s*four|ending(?:\s+in)?|termina(?:do)?\s+en|ultimos?\s*4)[^0-9]{0,12}(\d{4})\b/i);
  return labelled?.[1] || null;
}

function paymentBrandFromText(value) {
  const text = String(value || '');
  if (/master\s*card|mastercard/i.test(text)) return 'Mastercard';
  if (/visa/i.test(text)) return 'Visa';
  if (/american\s*express|amex/i.test(text)) return 'American Express';
  if (/discover/i.test(text)) return 'Discover';
  if (/diners/i.test(text)) return 'Diners';
  return null;
}

function firstEntry(entries, matcher) {
  return entries.find((entry) => matcher(entry.path.toLowerCase(), entry.key.toLowerCase(), entry.value));
}

/**
 * Extract transaction-scoped payment metadata from the billing activity itself.
 *
 * IMPORTANT: funding_source_details on the Ad Account describes the account's current/default
 * payment method. It must never be presented as the card used by a historical transaction.
 * We only use it when the activity explicitly references the same funding_source id; otherwise
 * the transaction payment method remains unavailable instead of showing a false card.
 */
export function extractTransactionPaymentInfo(extraData, accountPayment = {}) {
  const extra = parseJson(extraData);
  const entries = flattenExtraData(extra);

  const last4Entry = firstEntry(entries, (path, key, value) => {
    if (/(last[_\s-]?(?:four|4)|last4|card.*last|card.*ending|digits.*last)/i.test(`${path}.${key}`)) {
      return /\d{4}/.test(String(value || ''));
    }
    return false;
  });

  const paymentEntry = firstEntry(entries, (path, key, value) => {
    const text = String(value || '').trim();
    const paymentPath = /(payment.*method|payment.*instrument|funding.*source.*detail|card.*display|display.*string|card.*brand|card.*type|payment.*source)/i.test(`${path}.${key}`);
    const paymentText = Boolean(paymentBrandFromText(text) && extractLast4FromText(text));
    return (paymentPath || paymentText) && typeof value !== 'object' && text.length > 0;
  });

  let last4 = last4Entry ? (String(last4Entry.value).match(/\d{4}/g)?.at(-1) || null) : null;
  if (!last4 && paymentEntry) last4 = extractLast4FromText(paymentEntry.value);

  const brand = paymentEntry ? paymentBrandFromText(paymentEntry.value) : null;
  let paymentMethod = null;
  let paymentMethodSource = null;

  if (paymentEntry || last4) {
    const rawDisplay = paymentEntry ? String(paymentEntry.value).trim() : '';
    if (brand && last4) paymentMethod = `${brand} ****${last4}`;
    else if (rawDisplay && rawDisplay.length <= 120 && !/^\d+$/.test(rawDisplay)) paymentMethod = rawDisplay;
    else if (last4) paymentMethod = `Tarjeta ****${last4}`;
    paymentMethodSource = 'TRANSACTION_EXTRA_DATA';
  }

  const fundingSourceEntry = firstEntry(entries, (path, key, value) =>
    /(funding[_\s-]?source(?:_id)?|payment[_\s-]?source[_\s-]?id|payment[_\s-]?method[_\s-]?id)/i.test(`${path}.${key}`) &&
    value !== null && value !== undefined
  );

  const transactionFundingSourceId = fundingSourceEntry ? String(fundingSourceEntry.value) : null;
  if (!paymentMethod && transactionFundingSourceId && accountPayment.fundingSourceId &&
      transactionFundingSourceId === String(accountPayment.fundingSourceId)) {
    paymentMethod = accountPayment.display && accountPayment.display !== 'No disponible'
      ? accountPayment.display
      : null;
    last4 = last4 || accountPayment.last4 || null;
    paymentMethodSource = paymentMethod ? 'TRANSACTION_FUNDING_SOURCE_MATCH' : null;
  }

  const statusEntry = firstEntry(entries, (path, key) =>
    /(^|\.)(payment[_\s-]?status|transaction[_\s-]?status|billing[_\s-]?status|status)$/i.test(`${path}.${key}`)
  );
  const invoiceEntry = firstEntry(entries, (path, key) =>
    /(invoice.*id|invoice.*number|vat.*invoice|tax.*invoice)/i.test(`${path}.${key}`)
  );

  const resolvedPaymentMethodSource = paymentMethodSource || 'UNAVAILABLE';
  if (resolvedPaymentMethodSource === 'UNAVAILABLE') {
    paymentMethod = null;
    last4 = null;
  }

  return {
    payment_method: paymentMethod,
    last4,
    payment_method_source: resolvedPaymentMethodSource,
    payment_status: statusEntry ? String(statusEntry.value) : null,
    invoice_id: invoiceEntry ? String(invoiceEntry.value) : null,
    transaction_funding_source_id: transactionFundingSourceId,
    account_default_payment_method: accountPayment.display && accountPayment.display !== 'No disponible'
      ? accountPayment.display
      : null,
    account_default_last4: accountPayment.last4 || null,
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
    const parsed = parseJson(body);
    const metaMessage = parsed?.error?.message;
    const metaCode = parsed?.error?.code;
    const error = new Error(
      metaMessage
        ? `Meta Graph API: ${metaMessage}${metaCode ? ` (code ${metaCode})` : ''}`
        : `Meta Graph API respondió HTTP ${response.status}.`,
    );
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

async function fetchBusinessInfo(businessId) {
  const url = `https://graph.facebook.com/${config.metaGraphVersion}/${businessId}` +
    `?fields=${encodeURIComponent('id,name')}`;
  return graphGet(url);
}

async function fetchAccountsForBusinessEdge(businessId, edge, relationship) {
  const fields = [
    'id',
    'account_id',
    'name',
    'currency',
    'timezone_name',
    'funding_source',
    'funding_source_details',
    'business',
  ].join(',');

  const url = `https://graph.facebook.com/${config.metaGraphVersion}/${businessId}/${edge}` +
    `?fields=${encodeURIComponent(fields)}&limit=500`;

  const accounts = await fetchAllPages(url);
  return accounts.map((account) => ({
    ...account,
    business_id: businessId,
    relationship,
  }));
}

function choosePrimaryMembership(memberships) {
  return memberships.find((item) => item.relationship === 'OWNED') || memberships[0] || null;
}

function addMembership(current, businessId, relationship) {
  if (!businessId) return;

  const membershipKey = String(businessId);
  const existingMembership = current.business_memberships.find(
    (item) => item.business_id === membershipKey,
  );

  if (!existingMembership) {
    current.business_memberships.push({
      business_id: membershipKey,
      relationship,
    });
  } else if (relationship === 'OWNED') {
    // Ownership is authoritative over CLIENT when the same Business appears
    // through more than one relationship.
    existingMembership.relationship = 'OWNED';
  }
}

function accountOwnerBusinessId(account) {
  if (!account?.business) return null;
  if (typeof account.business === 'string' || typeof account.business === 'number') {
    return String(account.business);
  }
  return account.business.id ? String(account.business.id) : null;
}

function mergeAccount(accountsById, account, configuredBusinessIds) {
  const accountId = String(account.account_id || account.id);
  const current = accountsById.get(accountId) || {
    ...account,
    account_id: accountId,
    business_memberships: [],
  };

  // Relationship through the Business edge used to discover the account.
  addMembership(current, account.business_id, account.relationship);

  // Meta AdAccount exposes its owning Business in the `business` field.
  // This matters when an account is discovered as CLIENT through ByAds but is
  // actually owned by another configured Business Manager (e.g. GlobalCom).
  const ownerBusinessId = accountOwnerBusinessId(account);
  if (ownerBusinessId && configuredBusinessIds.has(ownerBusinessId)) {
    addMembership(current, ownerBusinessId, 'OWNED');
    current.owner_business_id = ownerBusinessId;
  }

  // Prefer non-empty account metadata without discarding richer data already loaded.
  for (const key of [
    'id',
    'name',
    'currency',
    'timezone_name',
    'funding_source',
    'funding_source_details',
    'business',
  ]) {
    if (!current[key] && account[key]) current[key] = account[key];
  }

  current.business_memberships.sort((a, b) =>
    a.business_id.localeCompare(b.business_id) || a.relationship.localeCompare(b.relationship)
  );
  current.business_ids = current.business_memberships.map((item) => item.business_id);
  const primary = choosePrimaryMembership(current.business_memberships);
  current.business_id = primary?.business_id || null;
  current.business_relationship = primary?.relationship || null;

  accountsById.set(accountId, current);
}

async function fetchAccounts() {
  const accountsById = new Map();
  const errors = [];
  const businesses = [];
  const configuredBusinessIds = new Set(config.metaBusinessIds.map(String));

  for (const businessId of config.metaBusinessIds) {
    const business = {
      business_id: businessId,
      name: null,
      accessible: false,
      accounts_complete: false,
      owned_accessible: false,
      client_accessible: false,
      owned_accounts: 0,
      client_accounts: 0,
      unique_accounts: 0,
      edge_owned_accounts: 0,
      edge_client_accounts: 0,
      inferred_owned_accounts: 0,
      errors: [],
    };

    try {
      const info = await fetchBusinessInfo(businessId);
      business.name = info.name || null;
    } catch (error) {
      const item = {
        business_id: businessId,
        edge: 'business',
        message: error.message,
        details: error.details || null,
      };
      business.errors.push(item);
      errors.push(item);
    }

    const accountIdsForBusiness = new Set();

    for (const definition of BUSINESS_EDGES) {
      try {
        const accounts = await fetchAccountsForBusinessEdge(
          businessId,
          definition.edge,
          definition.relationship,
        );

        business.accessible = true;
        if (definition.relationship === 'OWNED') {
          business.owned_accessible = true;
          business.edge_owned_accounts = accounts.length;
        }
        if (definition.relationship === 'CLIENT') {
          business.client_accessible = true;
          business.edge_client_accounts = accounts.length;
        }

        for (const account of accounts) {
          const accountId = String(account.account_id || account.id);
          accountIdsForBusiness.add(accountId);
          mergeAccount(accountsById, account, configuredBusinessIds);
        }
      } catch (error) {
        const item = {
          business_id: businessId,
          edge: definition.edge,
          message: error.message,
          details: error.details || null,
        };
        business.errors.push(item);
        errors.push(item);
      }
    }

    business.accounts_complete = business.owned_accessible && business.client_accessible;
    business.edge_unique_accounts = accountIdsForBusiness.size;
    businesses.push(business);
  }

  const accounts = [...accountsById.values()];

  // Recalculate each configured Business from the resolved account memberships.
  // This supplements the direct Business edges with the AdAccount.business owner
  // field, so an account discovered as CLIENT can still be attributed to its
  // actual owning Business when that owner is one of META_BUSINESS_IDS.
  for (const business of businesses) {
    const owned = new Set();
    const client = new Set();
    const all = new Set();

    for (const account of accounts) {
      for (const membership of account.business_memberships || []) {
        if (String(membership.business_id) !== String(business.business_id)) continue;
        all.add(String(account.account_id));
        if (membership.relationship === 'OWNED') owned.add(String(account.account_id));
        if (membership.relationship === 'CLIENT') client.add(String(account.account_id));
      }
    }

    business.owned_accounts = owned.size;
    business.client_accounts = client.size;
    business.unique_accounts = all.size;
    business.inferred_owned_accounts = Math.max(0, owned.size - business.edge_owned_accounts);
  }

  return {
    accounts,
    businesses,
    errors,
  };
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
  const accountPayment = paymentInfo(account);
  const paymentChanged = activities.some((row) =>
    row.event_type === 'add_funding_source' || row.event_type === 'remove_funding_source'
  );
  const memberships = account.business_memberships || [];
  const businessIds = account.business_ids || memberships.map((item) => item.business_id);
  const primary = choosePrimaryMembership(memberships);

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
      const transactionPayment = extractTransactionPaymentInfo({
        ...extra,
        _translated_event_type: row.translated_event_type || null,
        _object_name: row.object_name || null,
      }, accountPayment);

      if (!byDay.has(key)) {
        byDay.set(key, {
          date,
          business_id: primary?.business_id || account.business_id || null,
          business_ids: [...businessIds],
          business_memberships: memberships.map((item) => ({ ...item })),
          owner_business_id: account.owner_business_id || null,
          account_id: accountId,
          account_name: accountName,
          currency,
          charged: 0,
          payment_method: 'No disponible',
          last4: 'No disponibles',
          account_default_payment_method: transactionPayment.account_default_payment_method,
          account_default_last4: transactionPayment.account_default_last4,
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
        payment_method: transactionPayment.payment_method,
        last4: transactionPayment.last4,
        payment_method_source: transactionPayment.payment_method_source,
        payment_status: transactionPayment.payment_status || 'PAID',
        invoice_id: transactionPayment.invoice_id,
        transaction_funding_source_id: transactionPayment.transaction_funding_source_id,
        account_default_payment_method: transactionPayment.account_default_payment_method,
        account_default_last4: transactionPayment.account_default_last4,
        activity: {
          event_type: row.event_type,
          translated_event_type: row.translated_event_type || null,
          object_id: row.object_id || null,
          object_name: row.object_name || null,
          extra_data: extra,
        },
      });
    });

  for (const item of byDay.values()) {
    const methods = [...new Set(item.transactions.map((tx) => tx.payment_method).filter(Boolean))];
    const last4Values = [...new Set(item.transactions.map((tx) => tx.last4).filter(Boolean))];
    item.payment_method = methods.length === 1 ? methods[0] : methods.length > 1 ? 'Varios (ver detalle)' : 'No disponible';
    item.last4 = last4Values.length === 1 ? last4Values[0] : last4Values.length > 1 ? 'Varios' : 'No disponibles';
  }

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
    const rowBusinessIds = row.business_ids?.length
      ? row.business_ids
      : (row.business_id ? [row.business_id] : []);
    rowBusinessIds.forEach((businessId) => businessIds.add(String(businessId)));
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

export async function getMetaBusinessStatus() {
  validateMetaConfig();
  const result = await fetchAccounts();
  return {
    ok: result.businesses.some((business) => business.accessible),
    configured: config.metaBusinessIds.length,
    accessible: result.businesses.filter((business) => business.accessible).length,
    unique_accounts: result.accounts.length,
    businesses: result.businesses,
    errors: result.errors,
    generated_at: new Date().toISOString(),
  };
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
    const error = new Error('Ninguno de los Business Manager configurados devolvió cuentas publicitarias propias o cliente.');
    error.status = 404;
    error.details = accountResult.errors.length ? JSON.stringify(accountResult.errors) : undefined;
    throw error;
  }

  const rows = [];
  const errors = accountResult.errors.map((item) => ({
    business_id: item.business_id,
    edge: item.edge,
    account_id: null,
    account_name: null,
    message: item.message,
  }));

  // Accounts shared by multiple Business IDs are intentionally queried once.
  // Their membership list is attached to each row so filters can still identify
  // every Business without duplicating financial amounts.
  for (const account of accounts) {
    try {
      const activities = await fetchAccountActivities(account, period.key);
      rows.push(...buildRowsFromActivities(account, activities, period.key));
    } catch (error) {
      errors.push({
        business_id: account.business_id || null,
        business_ids: account.business_ids || [],
        edge: 'activities',
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
      business_ids: account.business_ids || [],
      business_memberships: account.business_memberships || [],
      owner_business_id: account.owner_business_id || null,
      account_id: account.account_id,
      name: account.name || account.account_id,
      currency: account.currency || 'UNKNOWN',
      timezone_name: account.timezone_name || null,
    })),
    businesses: accountResult.businesses,
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
