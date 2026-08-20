# Meta Finance Hub

Módulo de auditoría financiera para consultar cobros de Meta Ads por mes, persistirlos en PostgreSQL y exportarlos a XLSX.

## Versión 3.2 - múltiples Meta Business correctamente relacionados

Esta versión amplía la sincronización para trabajar con varios `META_BUSINESS_IDS` sin duplicar cobros cuando una misma cuenta publicitaria está compartida entre Business Managers.

Por cada Business configurado se consultan dos relaciones de Meta:

- `/{BUSINESS_ID}/owned_ad_accounts`: cuentas propiedad del Business.
- `/{BUSINESS_ID}/client_ad_accounts`: cuentas de clientes/partners asignadas al Business.

El backend consolida las cuentas por `account_id`, consulta las actividades financieras una sola vez por cuenta y conserva en PostgreSQL todas las relaciones Business ↔ Ad Account.

## Arquitectura

```text
Meta Business 1 -- owned/client --┐
Meta Business 2 -- owned/client --+--> cuentas únicas --> activities --> Node/Express
Meta Business 3 -- owned/client --┘                                |
                                                                  Prisma
                                                                    |
                                                               PostgreSQL
                                                                    |
                                                             React / XLSX
```

## Configuración `.env`

Conserva tu token actual y configura los Business separados por coma:

```env
META_ACCESS_TOKEN=TU_TOKEN_META
META_BUSINESS_IDS=BUSINESS_ID_1,BUSINESS_ID_2,BUSINESS_ID_3
META_GRAPH_VERSION=v25.0
```

No subas `.env` a Git.

## Implementación sobre V6

1. Detén solamente Node/Vite con `Ctrl + C`. Docker puede seguir arriba.
2. Copia los archivos de este cambio sobre el proyecto actual.
3. **No reemplaces `.env`.**
4. Genera nuevamente Prisma Client:

```bash
npm run prisma:generate
```

5. Aplica la migración nueva:

```bash
npm run db:migrate:deploy
```

La migración crea:

- `meta_businesses`
- `meta_business_accounts`
- enum `MetaAccountRelationship` (`OWNED`, `CLIENT`)

También migra la relación histórica existente de V6 como `OWNED`. No elimina `meta_transactions` ni los cobros ya almacenados.

6. Levanta el proyecto:

```bash
npm run dev
```

## Verificación

### Configuración

```text
http://localhost:3001/api/meta/config-status
```

Debe mostrar el número correcto en `businessIdsCount`.

### Acceso y cuentas por Business

```text
http://localhost:3001/api/meta/businesses/status
```

Ejemplo esperado:

```json
{
  "ok": true,
  "configured": 3,
  "accessible": 3,
  "unique_accounts": 52,
  "businesses": [
    {
      "business_id": "...",
      "accessible": true,
      "owned_accounts": 39,
      "client_accounts": 0,
      "unique_accounts": 39,
      "errors": []
    }
  ]
}
```

Si un Business no tiene permisos, este endpoint indica cuál falló y el mensaje devuelto por Meta.

### PostgreSQL

```text
http://localhost:3001/api/db/health
```

Ahora incluye:

- `metaBusinesses`
- `metaBusinessAccounts`
- `metaAdAccounts`
- `metaTransactions`
- `syncRuns`

## Sincronización

Desde el portal presiona **Sincronizar Meta**.

La sincronización:

1. Recorre todos los `META_BUSINESS_IDS`.
2. Consulta cuentas `OWNED` y `CLIENT`.
3. Consolida cuentas compartidas por `account_id`.
4. Consulta los cobros una sola vez por cuenta.
5. Guarda todos los vínculos Business ↔ Ad Account.
6. Hace `upsert` de transacciones para evitar duplicados.

Una cuenta compartida puede aparecer asociada a varios Business en el filtro, pero en **Todos los Business** su valor se suma una sola vez.

## XLSX

El archivo contiene:

- `Cobros`: detalle financiero con todos los Business IDs asociados a la cuenta.
- `Resumen`: totales y cantidad de Business configurados/accesibles.
- `Business Meta`: estado de cada Business, cantidad de cuentas propias/cliente y último error.

## Endpoints principales

```text
GET  /api/health
GET  /api/db/health
GET  /api/meta/config-status
GET  /api/meta/businesses/status
GET  /api/meta/stored?year=2026&month=8
POST /api/meta/sync
GET  /api/meta/stored/export?year=2026&month=8
```

## ADPG-75 V8 - Resolucion del Business propietario

La sincronizacion consulta `owned_ad_accounts` y `client_ad_accounts` de cada Business configurado. Ademas solicita el campo `business` de cada Ad Account para resolver el Business propietario real.

Ejemplo: una cuenta encontrada en ByAds como CLIENT puede pertenecer realmente a GlobalCom. En ese caso se conserva la relacion completa:

- ByAds: CLIENT
- GlobalCom: OWNED

El cobro se consulta y almacena una sola vez; la cuenta puede filtrarse por cualquiera de sus Business relacionados sin duplicar el valor financiero.

El dashboard incluye una seccion **Business Meta configurados** para mostrar todos los IDs configurados, incluso cuando un Business no tenga cuentas/cobros durante el periodo.

No requiere una nueva migracion ni nuevas dependencias. Despues de copiar los cambios, reiniciar la aplicacion y ejecutar **Sincronizar Meta** para reconstruir las relaciones Business <-> Ad Account en PostgreSQL.

## Fase TRM USD/COP

La aplicación puede almacenar la TRM histórica USD/COP y calcular un valor estimado en pesos colombianos para cada cobro de Meta cuya moneda sea USD.

### Fuentes

- Histórico principal: dataset oficial de TRM suministrado por la Superintendencia Financiera de Colombia en Datos Abiertos Colombia (`32sa-8pi3`).
- Respaldo para la TRM vigente del día: DolarAPI Colombia `/v1/trm`, que publica la TRM oficial proveniente de la Superintendencia Financiera.

La fuente de respaldo no se usa para inventar histórico. Si falta una fecha histórica, el sistema la deja sin tasa para revisión.

### Flujo

1. `Sincronizar Meta` guarda los cobros y después intenta sincronizar la TRM del mes automáticamente.
2. `Sincronizar TRM` permite actualizar únicamente las tasas sin volver a consultar Meta.
3. PostgreSQL almacena una tasa USD/COP por fecha en `exchange_rates`.
4. Al consultar el período, cada transacción USD recibe `trm_rate` y `estimated_cop`.
5. El XLSX incluye las columnas `TRM COP/USD`, `COP estimado`, `Fuente TRM` y una hoja adicional `TRM`.

### Endpoints

```text
GET  /api/trm/config-status
GET  /api/trm/status?year=2026&month=8
POST /api/trm/sync
     body: { "year": 2026, "month": 8 }
```

### Variables opcionales

```env
TRM_HISTORICAL_URL=https://www.datos.gov.co/resource/32sa-8pi3.json
TRM_CURRENT_URL=https://co.dolarapi.com/v1/trm
SOCRATA_APP_TOKEN=
```

No es obligatorio definirlas para desarrollo local porque existen valores por defecto. `SOCRATA_APP_TOKEN` es opcional.


## V9.2 - Proyección de liquidación USD/COP

La TRM oficial se conserva como referencia. Para apoyar la conciliación, el reporte calcula además una tasa proyectada usando un spread configurable (0.48% por defecto) y un rango esperado (0.44%-0.52% por defecto). Esto es una aproximación; la tasa bancaria exacta se obtendrá al cruzar cada movimiento del extracto bancario contra su transacción Meta.

## V9.3 - Metodo de pago por transaccion

Correccion importante para conciliacion bancaria: el proyecto ya no asigna a los cobros historicos la tarjeta predeterminada actual de la cuenta publicitaria.

Para cada `ad_account_billing_charge` se intenta extraer el metodo de pago desde los datos propios de la actividad (`extra_data` y texto traducido de la actividad). Solo cuando la actividad referencia explicitamente el mismo `funding_source` de la cuenta se permite usar el detalle del funding source como metodo de esa transaccion.

Si Meta no entrega un metodo de pago vinculable a la transaccion, el sistema guarda `UNAVAILABLE` y muestra `No disponible` en lugar de atribuir una tarjeta potencialmente incorrecta.

Se guardan por transaccion:

- `payment_method`
- `last_four`
- `payment_method_source`
- `payment_status`
- `invoice_id`
- metodo predeterminado actual de la cuenta, solo como referencia separada

Endpoint local de diagnostico:

```text
GET /api/meta/transactions/{TRANSACTION_ID}/payment-debug
```

El endpoint no muestra el access token. Sirve para confirmar que metodo encontro el parser y que llaves devolvio Meta dentro de `extra_data` para una transaccion ya sincronizada.
