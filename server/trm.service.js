import { config } from './config.js';
import { prisma } from './database/prisma.js';

const BASE_CURRENCY = 'USD';
const QUOTE_CURRENCY = 'COP';
const OFFICIAL_SOURCE = 'SUPERFINANCIERA_DATOS_ABIERTOS';
const CURRENT_FALLBACK_SOURCE = 'DOLARAPI_SUPERFINANCIERA';

function validatePeriod(year, month) {
  const parsedYear = Number(year);
  const parsedMonth = Number(month);

  if (!Number.isInteger(parsedYear) || parsedYear < 1991 || parsedYear > 2100) {
    const error = new Error('El año debe ser un valor válido entre 1991 y 2100.');
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

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function parseFloatingDate(value) {
  const raw = String(value || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const date = new Date(`${raw}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function addUtcDays(date, days) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function maxDate(a, b) {
  return a.getTime() >= b.getTime() ? a : b;
}

function minDate(a, b) {
  return a.getTime() <= b.getTime() ? a : b;
}

function todayBogota() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());

  const byType = Object.fromEntries(parts.map((item) => [item.type, item.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...(options.headers || {}),
      },
    });

    const text = await response.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }

    if (!response.ok) {
      const error = new Error(`Servicio de TRM respondió HTTP ${response.status}.`);
      error.status = 502;
      error.details = text.slice(0, 1000);
      throw error;
    }

    if (body === null) {
      const error = new Error('El servicio de TRM devolvió una respuesta JSON inválida.');
      error.status = 502;
      throw error;
    }

    return body;
  } catch (error) {
    if (error.name === 'AbortError') {
      const timeoutError = new Error('El servicio de TRM agotó el tiempo de respuesta.');
      timeoutError.status = 504;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function expandOfficialRows(rows, year, month) {
  const periodStart = new Date(Date.UTC(year, month - 1, 1));
  const periodEnd = new Date(Date.UTC(year, month, 0));
  const rates = new Map();

  for (const row of rows || []) {
    const rate = Number(row.valor);
    const validFrom = parseFloatingDate(row.vigenciadesde);
    const validTo = parseFloatingDate(row.vigenciahasta || row.vigenciadesde);

    if (!Number.isFinite(rate) || rate <= 0 || !validFrom || !validTo) continue;

    let cursor = maxDate(validFrom, periodStart);
    const last = minDate(validTo, periodEnd);

    while (cursor.getTime() <= last.getTime()) {
      const date = isoDate(cursor);
      rates.set(date, {
        date,
        rate,
        source: OFFICIAL_SOURCE,
        source_url: config.trmHistoricalUrl,
        raw_data: row,
      });
      cursor = addUtcDays(cursor, 1);
    }
  }

  return rates;
}

async function fetchOfficialMonth(year, month) {
  const period = validatePeriod(year, month);
  const firstDate = `${period.key}-01`;
  const lastDay = new Date(Date.UTC(period.year, period.month, 0)).getUTCDate();
  const lastDate = `${period.key}-${String(lastDay).padStart(2, '0')}`;

  const url = new URL(config.trmHistoricalUrl);
  url.searchParams.set('$select', 'valor,unidad,vigenciadesde,vigenciahasta');
  url.searchParams.set(
    '$where',
    `vigenciadesde <= '${lastDate}T23:59:59.999' AND vigenciahasta >= '${firstDate}T00:00:00.000'`,
  );
  url.searchParams.set('$order', 'vigenciadesde ASC');
  url.searchParams.set('$limit', '100');

  const headers = {};
  if (config.socrataAppToken) headers['X-App-Token'] = config.socrataAppToken;

  const rows = await fetchJson(url, { headers });
  if (!Array.isArray(rows)) {
    const error = new Error('La fuente oficial de TRM no devolvió una lista de registros.');
    error.status = 502;
    throw error;
  }

  return expandOfficialRows(rows, period.year, period.month);
}

async function fetchCurrentFallback() {
  const body = await fetchJson(config.trmCurrentUrl);
  const rate = Number(body?.valor);
  if (!Number.isFinite(rate) || rate <= 0) {
    const error = new Error('DolarAPI no devolvió una TRM válida.');
    error.status = 502;
    throw error;
  }

  const date = todayBogota();
  return {
    date,
    rate,
    source: CURRENT_FALLBACK_SOURCE,
    source_url: config.trmCurrentUrl,
    raw_data: body,
  };
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

export async function getLatestTrmSync(year, month) {
  const period = validatePeriod(year, month);
  const run = await prisma.syncRun.findFirst({
    where: {
      source: 'TRM',
      year: period.year,
      month: period.month,
    },
    orderBy: { startedAt: 'desc' },
  });
  return serializeSyncRun(run);
}

export async function getStoredTrmRates(year, month) {
  const period = validatePeriod(year, month);
  const { from, to } = dateRange(period.year, period.month);
  return prisma.exchangeRate.findMany({
    where: {
      rateDate: { gte: from, lt: to },
      baseCurrency: BASE_CURRENCY,
      quoteCurrency: QUOTE_CURRENCY,
    },
    orderBy: { rateDate: 'asc' },
  });
}

export async function getStoredTrmStatus(year, month) {
  const period = validatePeriod(year, month);
  const [rates, latestSync] = await Promise.all([
    getStoredTrmRates(period.year, period.month),
    getLatestTrmSync(period.year, period.month),
  ]);

  const sourceCounts = rates.reduce((acc, item) => {
    acc[item.source] = (acc[item.source] || 0) + 1;
    return acc;
  }, {});

  return {
    ok: true,
    period: period.key,
    base_currency: BASE_CURRENCY,
    quote_currency: QUOTE_CURRENCY,
    covered_days: rates.length,
    first_date: rates[0] ? isoDate(rates[0].rateDate) : null,
    last_date: rates.at(-1) ? isoDate(rates.at(-1).rateDate) : null,
    source_counts: sourceCounts,
    latest_sync: latestSync,
    rates: rates.map((item) => ({
      date: isoDate(item.rateDate),
      rate: Number(item.rate),
      source: item.source,
      retrieved_at: item.retrievedAt.toISOString(),
    })),
  };
}

export async function syncTrmMonth(year, month) {
  const period = validatePeriod(year, month);
  const syncRun = await prisma.syncRun.create({
    data: {
      source: 'TRM',
      year: period.year,
      month: period.month,
      status: 'RUNNING',
    },
  });

  let created = 0;
  let updated = 0;
  let failed = 0;
  const errors = [];

  try {
    let rates = new Map();

    try {
      rates = await fetchOfficialMonth(period.year, period.month);
    } catch (error) {
      errors.push(`Fuente oficial: ${error.message}`);
    }

    const today = todayBogota();
    if (today.startsWith(`${period.key}-`) && !rates.has(today)) {
      try {
        const fallback = await fetchCurrentFallback();
        rates.set(fallback.date, fallback);
      } catch (error) {
        errors.push(`DolarAPI: ${error.message}`);
      }
    }

    if (rates.size === 0) {
      const error = new Error(
        errors.length
          ? `No fue posible obtener TRM para ${period.key}. ${errors.join(' | ')}`
          : `No se encontraron valores TRM para ${period.key}.`,
      );
      error.status = 502;
      throw error;
    }

    const now = new Date();
    for (const item of rates.values()) {
      try {
        const rateDate = new Date(`${item.date}T00:00:00.000Z`);
        const where = {
          rateDate_baseCurrency_quoteCurrency: {
            rateDate,
            baseCurrency: BASE_CURRENCY,
            quoteCurrency: QUOTE_CURRENCY,
          },
        };

        const existing = await prisma.exchangeRate.findUnique({
          where,
          select: { id: true },
        });

        await prisma.exchangeRate.upsert({
          where,
          create: {
            rateDate,
            baseCurrency: BASE_CURRENCY,
            quoteCurrency: QUOTE_CURRENCY,
            rate: item.rate,
            source: item.source,
            sourceUrl: item.source_url,
            retrievedAt: now,
            rawData: item.raw_data,
          },
          update: {
            rate: item.rate,
            source: item.source,
            sourceUrl: item.source_url,
            retrievedAt: now,
            rawData: item.raw_data,
          },
        });

        if (existing) updated += 1;
        else created += 1;
      } catch (error) {
        failed += 1;
        errors.push(`${item.date}: ${error.message}`);
      }
    }

    const status = failed > 0 || errors.length > 0 ? 'PARTIAL' : 'SUCCESS';
    await prisma.syncRun.update({
      where: { id: syncRun.id },
      data: {
        status,
        finishedAt: new Date(),
        recordsReceived: rates.size,
        recordsCreated: created,
        recordsUpdated: updated,
        recordsFailed: failed,
        error: errors.length ? errors.join('\n') : null,
      },
    });

    return getStoredTrmStatus(period.year, period.month);
  } catch (error) {
    await prisma.syncRun.update({
      where: { id: syncRun.id },
      data: {
        status: 'FAILED',
        finishedAt: new Date(),
        recordsReceived: created + updated + failed,
        recordsCreated: created,
        recordsUpdated: updated,
        recordsFailed: failed,
        error: error.message,
      },
    }).catch(() => {});
    throw error;
  }
}

export async function getStoredTrmMap(year, month) {
  const rates = await getStoredTrmRates(year, month);
  return new Map(rates.map((item) => [isoDate(item.rateDate), {
    rate: Number(item.rate),
    source: item.source,
    retrieved_at: item.retrievedAt.toISOString(),
  }]));
}
