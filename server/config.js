import fs from 'node:fs';
import path from 'node:path';

const envState = {
  loaded: false,
  path: '',
};

function loadEnvFile() {
  const envPath = path.resolve(process.cwd(), '.env');
  envState.path = envPath;

  if (!fs.existsSync(envPath)) return;

  const content = fs.readFileSync(envPath, 'utf8').replace(/^\uFEFF/, '');

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const separator = line.indexOf('=');
    if (separator < 1) continue;

    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    // En desarrollo local, el archivo .env es la fuente de verdad del proyecto.
    // Esto evita que una variable vieja definida en Windows/terminal reemplace
    // accidentalmente el token escrito en el .env actual.
    process.env[key] = value;
  }

  envState.loaded = true;
}

loadEnvFile();

const metaBusinessIds = (
  process.env.META_BUSINESS_IDS ||
  process.env.META_BUSINESS_ID ||
  process.env.BUSINESS_ID ||
  ''
)
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

export const config = {
  port: Number(process.env.PORT || 3001),
  frontendOrigin: process.env.FRONTEND_ORIGIN || 'http://localhost:5173',
  metaAccessToken: (process.env.META_ACCESS_TOKEN || '').trim(),
  metaBusinessIds: [...new Set(metaBusinessIds)],
  metaGraphVersion: (process.env.META_GRAPH_VERSION || process.env.GRAPH_VERSION || 'v25.0').trim(),
  cacheTtlSeconds: Math.max(0, Number(process.env.META_CACHE_TTL_SECONDS || 300)),
  databaseUrl: (process.env.DATABASE_URL || '').trim(),
  trmHistoricalUrl: (
    process.env.TRM_HISTORICAL_URL ||
    'https://www.datos.gov.co/resource/32sa-8pi3.json'
  ).trim(),
  trmCurrentUrl: (process.env.TRM_CURRENT_URL || 'https://co.dolarapi.com/v1/trm').trim(),
  socrataAppToken: (process.env.SOCRATA_APP_TOKEN || '').trim(),
  usdCopEffectiveSpreadPercent: Number(process.env.USD_COP_EFFECTIVE_SPREAD_PERCENT || 0.48),
  usdCopEffectiveSpreadMinPercent: Number(process.env.USD_COP_EFFECTIVE_SPREAD_MIN_PERCENT || 0.44),
  usdCopEffectiveSpreadMaxPercent: Number(process.env.USD_COP_EFFECTIVE_SPREAD_MAX_PERCENT || 0.52),
};

export function getSafeMetaConfigStatus() {
  return {
    envFileLoaded: envState.loaded,
    tokenConfigured: Boolean(config.metaAccessToken),
    tokenLength: config.metaAccessToken.length,
    tokenHasWhitespace: /\s/.test(config.metaAccessToken),
    businessIdsConfigured: config.metaBusinessIds.length > 0,
    businessIdsCount: config.metaBusinessIds.length,
    graphVersion: config.metaGraphVersion,
  };
}

export function getSafeDatabaseConfigStatus() {
  return {
    databaseConfigured: Boolean(config.databaseUrl),
  };
}

export function getSafeTrmConfigStatus() {
  return {
    historicalSourceConfigured: Boolean(config.trmHistoricalUrl),
    currentFallbackConfigured: Boolean(config.trmCurrentUrl),
    socrataAppTokenConfigured: Boolean(config.socrataAppToken),
    effectiveSpreadPercent: config.usdCopEffectiveSpreadPercent,
    effectiveSpreadMinPercent: config.usdCopEffectiveSpreadMinPercent,
    effectiveSpreadMaxPercent: config.usdCopEffectiveSpreadMaxPercent,
  };
}

export function validateDatabaseConfig() {
  if (!config.databaseUrl) {
    const error = new Error('Falta la variable de entorno DATABASE_URL');
    error.code = 'DATABASE_CONFIG_MISSING';
    error.status = 503;
    throw error;
  }
}

export function validateMetaConfig() {
  const missing = [];
  if (!config.metaAccessToken) missing.push('META_ACCESS_TOKEN');
  if (!config.metaBusinessIds.length) missing.push('META_BUSINESS_IDS');

  if (missing.length) {
    const error = new Error(`Faltan variables de entorno: ${missing.join(', ')}`);
    error.code = 'META_CONFIG_MISSING';
    throw error;
  }
}
