# Meta Finance Hub

Portal interno para consultar cobros mensuales de cuentas publicitarias de Meta, revisar el detalle financiero y exportar la información a XLSX. Esta versión incorpora la base de infraestructura para persistencia histórica con PostgreSQL + Prisma.

## Arquitectura actual

```text
React / Vite
    |
    v
Node.js / Express
    |----------> Meta Graph API
    |
    +----------> Prisma -> PostgreSQL (Docker)
```

En esta fase la consulta de cobros sigue viniendo directamente de Meta. PostgreSQL ya queda creado y conectado; la persistencia de las transacciones se implementará en la siguiente fase.

## Requisitos

- Node.js 18+
- npm
- Docker Desktop con Docker Compose
- Token y Business ID de Meta con los permisos requeridos

## Configuración inicial

```bash
npm install
cp .env.example .env
```

Configura `.env` con tus valores reales. Nunca subas `.env` a Git.

Variables principales:

```env
PORT=3001
FRONTEND_ORIGIN=http://localhost:5173

META_ACCESS_TOKEN=tu_token
META_BUSINESS_ID=tu_business_id
META_GRAPH_VERSION=v25.0
META_CACHE_TTL_SECONDS=300

POSTGRES_USER=finance_user
POSTGRES_PASSWORD=tu_clave_local
POSTGRES_DB=finance_db
POSTGRES_PORT=5432
DATABASE_URL=postgresql://finance_user:tu_clave_local@localhost:5432/finance_db?schema=public
```

`POSTGRES_PASSWORD` y la contraseña incluida en `DATABASE_URL` deben coincidir.

## PostgreSQL con Docker

Levantar únicamente PostgreSQL:

```bash
npm run db:up
```

Verificar el contenedor:

```bash
npm run db:status
```

Ver logs:

```bash
npm run db:logs
```

Detener los contenedores conservando el volumen de datos:

```bash
npm run db:down
```

> No uses `docker compose down -v` salvo que quieras eliminar también la base de datos local.

## Prisma

Generar Prisma Client:

```bash
npm run prisma:generate
```

La migración inicial ya está incluida en `prisma/migrations`. Para aplicarla en la base local:

```bash
npm run db:migrate:deploy
```

Para futuros cambios de esquema durante desarrollo:

```bash
npm run db:migrate -- --name nombre_del_cambio
npm run prisma:generate
```

Abrir Prisma Studio:

```bash
npm run db:studio
```

## Ejecutar aplicación

```bash
npm run dev
```

- Frontend: `http://localhost:5173`
- API: `http://localhost:3001`
- Health API: `http://localhost:3001/api/health`
- Health PostgreSQL: `http://localhost:3001/api/db/health`
- Estado seguro Meta: `http://localhost:3001/api/meta/config-status`

## Tablas de esta fase

### `meta_ad_accounts`
Catálogo de cuentas publicitarias de Meta.

### `meta_transactions`
Base para almacenar cada cobro individual, método de pago y estado futuro de conciliación.

Estados de conciliación preparados:

- `PENDING`
- `MATCHED`
- `UNMATCHED`
- `AMOUNT_DIFFERENCE`
- `MANUAL_REVIEW`

### `sync_runs`
Auditoría de cada sincronización por fuente, año y mes, incluyendo registros recibidos, creados, actualizados y fallidos.

## Endpoints Meta existentes

```text
GET /api/meta/charges?year=2026&month=8
GET /api/meta/charges/summary?year=2026&month=8
GET /api/meta/charges/export?year=2026&month=8
```

## Seguridad

- `.env` está ignorado por Git.
- El token de Meta solo se usa en backend.
- Los endpoints de diagnóstico no exponen el token ni la `DATABASE_URL`.
- No versionar reportes financieros ni XLSX generados.

## Próxima fase

Persistir los resultados de Meta mediante `upsert`, registrar cada sincronización en `sync_runs` y cambiar el flujo a:

```text
Meta -> sincronizar -> PostgreSQL -> consultar -> React / XLSX
```

## Fase 3 - Sincronizacion Meta -> PostgreSQL

El portal separa ahora dos acciones:

- **Consultar**: lee exclusivamente la informacion almacenada en PostgreSQL.
- **Sincronizar Meta**: consulta Meta Graph API, guarda/actualiza cuentas y transacciones mediante Prisma y registra una ejecucion en `sync_runs`.

### Endpoints de persistencia

```text
GET  /api/meta/stored?year=2026&month=8
POST /api/meta/sync
GET  /api/meta/sync/status?year=2026&month=8
GET  /api/meta/stored/export?year=2026&month=8
```

Body de sincronizacion:

```json
{
  "year": 2026,
  "month": 8
}
```

La sincronizacion usa `upsert` para evitar duplicar una misma transaccion al sincronizar repetidamente el mismo periodo. Cada ejecucion queda registrada en `sync_runs` con cantidades recibidas, creadas, actualizadas y fallidas.

## Varios Business Manager de Meta

Configura uno o varios Business ID separados por coma:

```env
META_BUSINESS_IDS=123456789012345,987654321098765
```

El backend consulta `owned_ad_accounts` de cada Business configurado, consolida las cuentas por `account_id` y guarda el `Business ID` de origen en PostgreSQL. `META_BUSINESS_ID` sigue funcionando como compatibilidad para instalaciones anteriores, pero `META_BUSINESS_IDS` tiene prioridad.

Después de cambiar la lista debes reiniciar `npm run dev` y volver a ejecutar **Sincronizar Meta** para completar el Business ID en los registros existentes.
