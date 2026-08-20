import express from 'express';
import cors from 'cors';
import {
  config,
  getSafeDatabaseConfigStatus,
  getSafeMetaConfigStatus,
  getSafeTrmConfigStatus,
  validateDatabaseConfig,
} from './config.js';
import { disconnectPrisma } from './database/prisma.js';
import { getDatabaseHealth } from './database/database.service.js';
import { getLatestMetaSync, getStoredMonthlyCharges, getStoredTransactionPaymentDetail, syncMetaMonth } from './database/meta-sync.service.js';
import { buildChargesWorkbook } from './excel.service.js';
import { getMetaBusinessStatus, getMonthlyCharges } from './meta.service.js';
import { getStoredTrmStatus, syncTrmMonth } from './trm.service.js';

const app = express();

app.disable('x-powered-by');
app.use(cors({ origin: config.frontendOrigin }));
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'meta-finance-api',
    database: getSafeDatabaseConfigStatus(),
  });
});

app.get('/api/db/health', async (_req, res, next) => {
  try {
    validateDatabaseConfig();
    res.json(await getDatabaseHealth());
  } catch (error) {
    next(error);
  }
});

app.get('/api/meta/config-status', (_req, res) => {
  res.json({
    ok: true,
    ...getSafeMetaConfigStatus(),
  });
});

app.get('/api/trm/config-status', (_req, res) => {
  res.json({
    ok: true,
    ...getSafeTrmConfigStatus(),
  });
});

app.get('/api/trm/status', async (req, res, next) => {
  try {
    validateDatabaseConfig();
    res.json(await getStoredTrmStatus(req.query.year, req.query.month));
  } catch (error) {
    next(error);
  }
});

app.post('/api/trm/sync', async (req, res, next) => {
  try {
    validateDatabaseConfig();
    res.json(await syncTrmMonth(req.body?.year, req.body?.month));
  } catch (error) {
    next(error);
  }
});

app.get('/api/meta/businesses/status', async (_req, res, next) => {
  try {
    res.json(await getMetaBusinessStatus());
  } catch (error) {
    next(error);
  }
});


app.get('/api/meta/stored', async (req, res, next) => {
  try {
    validateDatabaseConfig();
    res.json(await getStoredMonthlyCharges(req.query.year, req.query.month));
  } catch (error) {
    next(error);
  }
});

app.get('/api/meta/transactions/:transactionId/payment-debug', async (req, res, next) => {
  try {
    validateDatabaseConfig();
    res.json(await getStoredTransactionPaymentDetail(req.params.transactionId));
  } catch (error) {
    next(error);
  }
});

app.get('/api/meta/sync/status', async (req, res, next) => {
  try {
    validateDatabaseConfig();
    res.json({
      ok: true,
      sync: await getLatestMetaSync(req.query.year, req.query.month),
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/meta/sync', async (req, res, next) => {
  try {
    validateDatabaseConfig();
    const result = await syncMetaMonth(req.body?.year, req.body?.month);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

app.get('/api/meta/stored/export', async (req, res, next) => {
  try {
    validateDatabaseConfig();
    const report = await getStoredMonthlyCharges(req.query.year, req.query.month);
    const buffer = await buildChargesWorkbook(report);
    const fileName = `meta-cobros-${report.period}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Length', buffer.byteLength);
    res.send(Buffer.from(buffer));
  } catch (error) {
    next(error);
  }
});

app.get('/api/meta/charges', async (req, res, next) => {
  try {
    const forceRefresh = req.query.refresh === 'true';
    const report = await getMonthlyCharges(req.query.year, req.query.month, { forceRefresh });
    res.json(report);
  } catch (error) {
    next(error);
  }
});

app.get('/api/meta/charges/summary', async (req, res, next) => {
  try {
    const report = await getMonthlyCharges(req.query.year, req.query.month);
    res.json({
      period: report.period,
      summary: report.summary,
      errors: report.errors,
      generated_at: report.generated_at,
      cached: report.cached,
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/meta/charges/export', async (req, res, next) => {
  try {
    const report = await getMonthlyCharges(req.query.year, req.query.month);
    const buffer = await buildChargesWorkbook(report);
    const fileName = `meta-cobros-${report.period}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Length', buffer.byteLength);
    res.send(Buffer.from(buffer));
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  const status = Number(error.status || 500);
  const body = {
    ok: false,
    error: error.message || 'Error interno del servidor',
  };

  if (process.env.NODE_ENV !== 'production' && error.details) {
    body.details = error.details;
  }

  console.error('[API]', error.message);
  res.status(status).json(body);
});

const server = app.listen(config.port, () => {
  console.log(`Meta Finance API disponible en http://localhost:${config.port}`);
  console.log('[META CONFIG]', getSafeMetaConfigStatus());
  console.log('[DATABASE CONFIG]', getSafeDatabaseConfigStatus());
});

async function shutdown(signal) {
  console.log(`\\n${signal}: cerrando API...`);
  server.close(async () => {
    try {
      await disconnectPrisma();
    } finally {
      process.exit(0);
    }
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
