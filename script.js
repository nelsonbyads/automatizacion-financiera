// ============================================================
// META - FACTURACION MENSUAL POR DIA (NODE.JS VERSION)
// Salida limpia:
// Cuenta
// Account ID
// Cobros de Meta
// Cantidad de cobros
// Metodo de pago actual
// Ultimos 4 actuales
// Cambio metodo este mes
// Transacciones
// Total facturado del dia
// ============================================================

const fs = require('fs');
const path = require('path');

// ============================================================
// CARGAR ENTORNO (.env)
// ============================================================
function loadEnv() {
    const envPath = path.resolve(process.cwd(), '.env');
    if (fs.existsSync(envPath)) {
        const content = fs.readFileSync(envPath, 'utf8');
        content.split('\n').forEach(line => {
            const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
            if (match) {
                const key = match[1];
                let value = match[2] || '';
                if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
                if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
                process.env[key] = value.trim();
            }
        });
    }
}
loadEnv();

// ============================================================
// CONFIGURACION
// ============================================================
const token = process.env.META_ACCESS_TOKEN || 'EAA0TPQg11kMBO10qFH901UUVgbLyDmV9drUkEfZA3BNsQOZBUd9Uqiu1dSjRzvE1jeJZBJjkXSqg2hhuSBKzk87lXn8bvWB2c6UmjFdeETxTu7UQHMsd9xfZBZBRmPzvQ5G84lJywc93LDgojF5GuFsFRBatdHyf5HGOeLibrvgKSaA9jWbfRFlK5cCNoEOUu';
const businessId = process.env.BUSINESS_ID || '487572709507485';
const graphVersion = process.env.GRAPH_VERSION || 'v25.0';
const reportMonth = process.env.REPORT_MONTH || '2026-08';

if (!token) {
    console.error("Error: META_ACCESS_TOKEN está vacío.");
    process.exit(1);
}

if (!businessId) {
    console.error("Error: BUSINESS_ID está vacío.");
    process.exit(1);
}

if (!reportMonth || !/^\d{4}-\d{2}$/.test(reportMonth)) {
    console.error("Error: REPORT_MONTH debe tener formato YYYY-MM. Ejemplo: 2026-08");
    process.exit(1);
}

let accounts = [];

// ============================================================
// RANGO DEL MES
// ============================================================
const [year, month] = reportMonth.split("-").map(Number);

const nextMonthDate = new Date(
    Date.UTC(year, month, 1)
);

const nextYear = nextMonthDate.getUTCFullYear();

const nextMonth = String(
    nextMonthDate.getUTCMonth() + 1
).padStart(2, "0");

const since = `${reportMonth}-01T00:00:00-05:00`;
const until = `${nextYear}-${nextMonth}-01T00:00:00-05:00`;

// ============================================================
// RESULTADOS
// ============================================================
let billingRows = [];
let errors = [];

// ============================================================
// UTILIDADES
// ============================================================
function parseJson(value) {
    try {
        if (!value) {
            return {};
        }
        if (typeof value === "object") {
            return value;
        }
        return JSON.parse(value);
    } catch (e) {
        return {};
    }
}

// ------------------------------------------------------------
// NORMALIZAR IMPORTE
// ------------------------------------------------------------
function normalizeAmount(raw, currency) {
    const value = Number(raw || 0);

    if (currency === "USD") {
        return value / 100;
    }

    if (currency === "COP") {
        return value;
    }

    return value;
}

// ------------------------------------------------------------
// FORMATO MONEDA
// ------------------------------------------------------------
function formatMoney(value, currency) {
    if (currency === "COP") {
        return "COP " +
            new Intl.NumberFormat(
                "es-CO",
                {
                    minimumFractionDigits: 0,
                    maximumFractionDigits: 0
                }
            ).format(Math.round(value));
    }

    if (currency === "USD") {
        return "USD " +
            new Intl.NumberFormat(
                "en-US",
                {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2
                }
            ).format(value);
    }

    return `${currency} ${value}`;
}

// ------------------------------------------------------------
// CONVERTIR event_time A DIA LOCAL
// ------------------------------------------------------------
function getLocalDate(eventTime, timezone) {
    const date = new Date(eventTime);

    const parts = new Intl.DateTimeFormat(
        "en-CA",
        {
            timeZone: timezone || "America/Bogota",
            year: "numeric",
            month: "2-digit",
            day: "2-digit"
        }
    ).formatToParts(date);

    const values = {};
    parts.forEach(part => {
        values[part.type] = part.value;
    });

    return `${values.year}-${values.month}-${values.day}`;
}

// ------------------------------------------------------------
// INFORMACION DE METODO DE PAGO
// ------------------------------------------------------------
function getPaymentInfo(account) {
    const details = parseJson(account.funding_source_details);
    const display = details.display_string || "No disponible";

    let last4 = null;
    const matches = String(display).match(/\d{4}/g);

    if (matches && matches.length) {
        last4 = matches[matches.length - 1];
    }

    return {
        display: display,
        last4: last4 || "No disponibles"
    };
}

// ============================================================
// REQUEST PAGINADA DE ACTIVITIES
// ============================================================
function fetchActivities(url, collected, callback) {
    fetch(url, {
        method: "GET",
        headers: {
            "Authorization": `Bearer ${token}`
        }
    })
    .then(async (response) => {
        if (!response.ok) {
            const errText = await response.text();
            callback(collected, `HTTP ${response.status}: ${errText}`);
            return;
        }
        return response.json();
    })
    .then((json) => {
        if (!json) return;
        collected.push(...(json.data || []));

        if (json.paging && json.paging.next) {
            fetchActivities(json.paging.next, collected, callback);
        } else {
            callback(collected, null);
        }
    })
    .catch((error) => {
        callback(collected, String(error));
    });
}

// ============================================================
// PROCESAR UNA CUENTA
// ============================================================
function processAccount(account, callback) {
    const accountId = account.account_id;
    const accountName = account.name || accountId;
    const accountCurrency = account.currency || "UNKNOWN";
    const timezone = account.timezone_name || "America/Bogota";
    const payment = getPaymentInfo(account);

    const fields = [
        "event_time",
        "event_type",
        "translated_event_type",
        "extra_data",
        "object_id",
        "object_name"
    ].join(",");

    const url = `https://graph.facebook.com/${graphVersion}/${account.id}/activities` +
        `?fields=${encodeURIComponent(fields)}` +
        `&category=BUDGET` +
        `&since=${encodeURIComponent(since)}` +
        `&until=${encodeURIComponent(until)}` +
        `&limit=500`;

    fetchActivities(
        url,
        [],
        function(activities, error) {
            if (error) {
                errors.push({
                    account_id: accountId,
                    account_name: accountName,
                    error: error
                });
                callback();
                return;
            }

            const paymentChanged = activities.some(row =>
                row.event_type === "add_funding_source" ||
                row.event_type === "remove_funding_source"
            );

            const byDay = {};

            activities
                .filter(row => row.event_type === "ad_account_billing_charge")
                .forEach(row => {
                    const extra = parseJson(row.extra_data);
                    const day = getLocalDate(row.event_time, timezone);

                    if (!day.startsWith(reportMonth)) {
                        return;
                    }

                    const currency = extra.currency || accountCurrency;
                    const amount = normalizeAmount(extra.new_value, currency);
                    const key = `${day}|${currency}`;

                    if (!byDay[key]) {
                        byDay[key] = {
                            date: day,
                            account_id: accountId,
                            account_name: accountName,
                            currency: currency,
                            charged: 0,
                            payment_method: payment.display,
                            last4: payment.last4,
                            payment_changed: paymentChanged,
                            transactions: []
                        };
                    }

                    byDay[key].charged += amount;
                    byDay[key].transactions.push({
                        transaction_id: extra.transaction_id || "No disponible",
                        amount: amount,
                        currency: currency,
                        event_time: row.event_time
                    });
                });

            Object.values(byDay).forEach(row => {
                billingRows.push(row);
            });

            callback();
        }
    );
}

// ============================================================
// PROCESAR CUENTAS SECUENCIALMENTE
// ============================================================
function processNext(index) {
    if (index >= accounts.length) {
        buildReport();
        return;
    }

    console.log(`Procesando cuenta [${index + 1}/${accounts.length}]: ${accounts[index].name || accounts[index].account_id}...`);

    processAccount(
        accounts[index],
        function() {
            setTimeout(
                function() {
                    processNext(index + 1);
                },
                150
            );
        }
    );
}

// ============================================================
// CONSTRUIR REPORTE
// ============================================================
function buildReport() {
    billingRows.sort(function(a, b) {
        if (a.date !== b.date) {
            return a.date.localeCompare(b.date);
        }
        return a.account_name.localeCompare(b.account_name);
    });

    const days = [...new Set(billingRows.map(row => row.date))].sort();
    let report = "";

    days.forEach(day => {
        report += `============================================================\n${day}\n============================================================\n\n`;

        const rows = billingRows.filter(row => row.date === day);

        rows.forEach(row => {
            report += `Cuenta: ${row.account_name}\nAccount ID: ${row.account_id}\n\n`;
            report += `Cobros de Meta:             ${formatMoney(row.charged, row.currency)}\n`;
            report += `Cantidad de cobros:         ${row.transactions.length}\n`;
            report += `Método de pago actual:      ${row.payment_method}\n`;
            report += `Últimos 4 actuales:         ${row.last4}\n`;
            report += `Cambió método este mes:     ${row.payment_changed ? "Sí" : "No"}\n`;
            report += `Transacciones:\n`;

            row.transactions.forEach(tx => {
                report += `- transaction_id ${tx.transaction_id} | ${formatMoney(tx.amount, tx.currency)} | ${tx.event_time}\n`;
            });

            report += "\n";
        });

        const totals = {};
        rows.forEach(row => {
            if (!totals[row.currency]) {
                totals[row.currency] = 0;
            }
            totals[row.currency] += row.charged;
        });

        report += `TOTAL FACTURADO DEL DÍA:\n`;
        Object.keys(totals).sort().forEach(currency => {
            report += `${formatMoney(totals[currency], currency)}\n`;
        });

        report += "\n\n";
    });

    console.log("\n===== FACTURACION META =====\n");
    console.log(report.trim());

    // Guardar reporte localmente en un archivo
    try {
        const reportFileName = `report_${reportMonth}.txt`;
        fs.writeFileSync(reportFileName, report.trim(), 'utf8');
        console.log(`\n[Info] Reporte guardado exitosamente en: ${reportFileName}`);
    } catch (e) {
        console.error('No se pudo guardar el reporte en un archivo:', e.message);
    }

    if (errors.length) {
        console.error("CUENTAS CON ERROR:", errors);
    }
}

// ============================================================
// INICIAR PROCESO
// ============================================================
async function start() {
    const accountsUrl = `https://graph.facebook.com/${graphVersion}/${businessId}/owned_ad_accounts?fields=id,account_id,name,currency,timezone_name,funding_source,funding_source_details&limit=500`;
    
    console.log(`Iniciando consulta para el Business ID: ${businessId}...`);
    try {
        const response = await fetch(accountsUrl, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) {
            const errText = await response.text();
            console.error("ERROR owned_ad_accounts:", errText);
            throw new Error("No fue posible obtener las cuentas del Business.");
        }

        const json = await response.json();
        accounts = json.data || [];

        if (!accounts.length) {
            throw new Error("El Business no devolvió cuentas publicitarias.");
        }

        console.log(`Cuentas obtenidas: ${accounts.length}. Procesando secuencialmente...`);
        processNext(0);

    } catch (error) {
        console.error("Error al iniciar el script:", error.message);
        process.exit(1);
    }
}

start();