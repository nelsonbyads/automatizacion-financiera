import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarDays,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  CreditCard,
  Database,
  DollarSign,
  Download,
  FileSpreadsheet,
  LoaderCircle,
  RefreshCw,
  Search,
  Server,
  WalletCards,
} from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL || '';
const MONTHS = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

function currentPeriod() {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

function formatMoney(value, currency) {
  try {
    return new Intl.NumberFormat(currency === 'COP' ? 'es-CO' : 'en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: currency === 'COP' ? 0 : 2,
    }).format(Number(value || 0));
  } catch {
    return `${currency || 'N/A'} ${Number(value || 0).toLocaleString('es-CO')}`;
  }
}

function formatDateTime(value) {
  if (!value) return 'No disponible';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('es-CO', {
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(date);
}

function rowBusinessIds(row) {
  if (row?.business_ids?.length) return row.business_ids.map(String);
  return row?.business_id ? [String(row.business_id)] : [];
}

function businessIdsLabel(row) {
  const ids = rowBusinessIds(row);
  return ids.length ? ids.join(', ') : 'No disponible';
}

function MetricCard({ icon: Icon, label, value, helper, tone = 'cyan' }) {
  return (
    <article className="metric-card panel">
      <div className={`metric-icon metric-${tone}`}><Icon size={22} /></div>
      <div>
        <span className="metric-label">{label}</span>
        <strong className="metric-value">{value}</strong>
        <span className="metric-helper">{helper}</span>
      </div>
    </article>
  );
}

export default function App() {
  const initial = currentPeriod();
  const [year, setYear] = useState(initial.year);
  const [month, setMonth] = useState(initial.month);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncingTrm, setSyncingTrm] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [search, setSearch] = useState('');
  const [currency, setCurrency] = useState('ALL');
  const [business, setBusiness] = useState('ALL');
  const [expanded, setExpanded] = useState({});

  const years = useMemo(() => {
    const current = new Date().getFullYear();
    return Array.from({ length: current - 2019 }, (_, index) => current - index);
  }, []);

  const filteredRows = useMemo(() => {
    const rows = report?.rows || [];
    const term = search.trim().toLowerCase();

    return rows.filter((row) => {
      const businessIds = rowBusinessIds(row);
      const matchesSearch = !term ||
        businessIds.some((id) => id.toLowerCase().includes(term)) ||
        row.account_name.toLowerCase().includes(term) ||
        String(row.account_id).toLowerCase().includes(term) ||
        row.transactions?.some((tx) => String(tx.transaction_id).toLowerCase().includes(term));
      const matchesCurrency = currency === 'ALL' || row.currency === currency;
      const matchesBusiness = business === 'ALL' || businessIds.includes(business);
      return matchesSearch && matchesCurrency && matchesBusiness;
    });
  }, [report, search, currency, business]);

  const availableBusinesses = useMemo(() => {
    const byId = new Map();

    for (const item of report?.businesses || []) {
      byId.set(String(item.business_id), item);
    }

    for (const row of report?.rows || []) {
      for (const id of rowBusinessIds(row)) {
        if (!byId.has(id)) byId.set(id, { business_id: id, accessible: true });
      }
    }

    return [...byId.values()].sort((a, b) =>
      String(a.business_id).localeCompare(String(b.business_id))
    );
  }, [report]);

  const inaccessibleBusinesses = useMemo(
    () => (report?.businesses || []).filter((item) => item.accessible === false || item.last_error),
    [report],
  );

  const filteredSummary = useMemo(() => {
    const totals = {};
    const accounts = new Set();
    let transactions = 0;
    let paymentChanges = 0;
    let estimatedCopFromUsd = 0;
    let projectedCopFromUsd = 0;

    filteredRows.forEach((row) => {
      totals[row.currency] = (totals[row.currency] || 0) + Number(row.charged || 0);
      accounts.add(row.account_id);
      transactions += row.transactions?.length || 0;
      if (row.payment_changed) paymentChanges += 1;
      if (row.currency === 'USD') {
        estimatedCopFromUsd += Number(row.estimated_cop || 0);
        projectedCopFromUsd += Number(row.projected_cop || 0);
      }
    });

    return { totals, accounts: accounts.size, transactions, paymentChanges, estimatedCopFromUsd, projectedCopFromUsd };
  }, [filteredRows]);

  async function readJsonResponse(response, fallbackMessage) {
    const text = await response.text();

    if (!text) {
      throw new Error('La API financiera no devolvió respuesta. Verifica que el backend esté ejecutándose en el puerto 3001.');
    }

    let body;
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error(`La API devolvió una respuesta no válida (HTTP ${response.status}).`);
    }

    if (!response.ok) {
      const detail = body.details ? ` Detalle: ${body.details}` : '';
      throw new Error(`${body.error || fallbackMessage}${detail}`);
    }

    return body;
  }

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function fetchStoredReportWithRetry(params, attempts = 2) {
    let lastError;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const response = await fetch(`${API_BASE}/api/meta/stored?${params.toString()}`);
        return await readJsonResponse(response, 'No fue posible consultar los datos almacenados.');
      } catch (error) {
        lastError = error;
        const message = String(error?.message || '');
        const retryable =
          message.includes('no devolvió respuesta') ||
          message.includes('Failed to fetch') ||
          message.includes('fetch failed') ||
          message.includes('NetworkError');

        if (attempt >= attempts || !retryable) throw error;
        await sleep(700);
      }
    }

    throw lastError;
  }

  async function loadReport() {
    setLoading(true);
    setError('');
    setSuccess('');
    setExpanded({});

    try {
      const params = new URLSearchParams({ year: String(year), month: String(month) });
      const body = await fetchStoredReportWithRetry(params);
      setReport(body);
    } catch (requestError) {
      setReport(null);
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }

  async function syncMeta() {
    setSyncing(true);
    setError('');
    setSuccess('');
    setExpanded({});

    try {
      const response = await fetch(`${API_BASE}/api/meta/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year, month }),
      });
      const body = await readJsonResponse(response, 'No fue posible sincronizar los cobros desde Meta.');
      setReport(body.report);

      const sync = body.sync;
      const businesses = body.report?.businesses || [];
      const accessible = businesses.filter((item) => item.accessible !== false).length;
      setSuccess(
        `Sincronización completada: ${sync?.records_received ?? 0} recibidas, ` +
        `${sync?.records_created ?? 0} nuevas, ${sync?.records_updated ?? 0} actualizadas` +
        `${sync?.records_failed ? ` y ${sync.records_failed} con error` : ''}. ` +
        `Business accesibles: ${accessible}/${businesses.length}. ` +
        (body.trm_sync_error
          ? `TRM pendiente: ${body.trm_sync_error}`
          : `TRM almacenada: ${body.report?.trm?.covered_days ?? 0} días.`)
      );
    } catch (syncError) {
      setError(syncError.message);
    } finally {
      setSyncing(false);
    }
  }

  async function syncTrm() {
    setSyncingTrm(true);
    setError('');
    setSuccess('');

    try {
      const response = await fetch(`${API_BASE}/api/trm/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year, month }),
      });
      const trm = await readJsonResponse(response, 'No fue posible sincronizar la TRM.');

      const params = new URLSearchParams({ year: String(year), month: String(month) });
      const reportResponse = await fetch(`${API_BASE}/api/meta/stored?${params.toString()}`);
      const updatedReport = await readJsonResponse(reportResponse, 'La TRM se guardó, pero no fue posible refrescar los cobros.');
      setReport(updatedReport);
      setSuccess(`TRM actualizada: ${trm.covered_days || 0} días disponibles para ${trm.period}.`);
    } catch (syncError) {
      setError(syncError.message);
    } finally {
      setSyncingTrm(false);
    }
  }

  async function downloadExcel() {
    setExporting(true);
    setError('');
    setSuccess('');

    try {
      const params = new URLSearchParams({ year: String(year), month: String(month) });
      const response = await fetch(`${API_BASE}/api/meta/stored/export?${params.toString()}`);

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || 'No fue posible generar el archivo XLSX.');
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `meta-cobros-${year}-${String(month).padStart(2, '0')}.xlsx`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (exportError) {
      setError(exportError.message);
    } finally {
      setExporting(false);
    }
  }

  function changePeriod(setter, value) {
    setter(Number(value));
    setReport(null);
    setError('');
    setSuccess('');
    setExpanded({});
    setBusiness('ALL');
  }

  function toggleRow(key) {
    setExpanded((current) => ({ ...current, [key]: !current[key] }));
  }

  const periodLabel = `${MONTHS[month - 1]} ${year}`;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark"><WalletCards size={22} /></div>
          <div>
            <strong>Meta Finance Hub</strong>
            <span>Auditoría mensual de cobros</span>
          </div>
        </div>
        <div className="api-status"><Server size={15} /> API financiera</div>
      </header>

      <main className="content">
        <section className="hero">
          <div>
            <span className="eyebrow">MÓDULO META ADS</span>
            <h1>Consulta y exporta los cobros del mes</h1>
            <p>Selecciona un período, consulta el histórico guardado en PostgreSQL o sincroniza Meta para actualizarlo y descargar el detalle en Excel.</p>
          </div>
        </section>

        <section className="period-panel panel">
          <div className="period-heading">
            <CalendarDays size={20} />
            <div>
              <strong>Período de consulta</strong>
              <span>Consultar lee PostgreSQL. Sincronizar Meta actualiza la base de datos.</span>
            </div>
          </div>

          <div className="period-controls">
            <label>
              <span>AÑO</span>
              <select value={year} onChange={(event) => changePeriod(setYear, event.target.value)} disabled={loading || syncing || syncingTrm}>
                {years.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>
            <label>
              <span>MES</span>
              <select value={month} onChange={(event) => changePeriod(setMonth, event.target.value)} disabled={loading || syncing || syncingTrm}>
                {MONTHS.map((name, index) => <option key={name} value={index + 1}>{name}</option>)}
              </select>
            </label>
            <button className="button button-primary" onClick={loadReport} disabled={loading || syncing || syncingTrm}>
              {loading ? <LoaderCircle className="spin" size={17} /> : <Database size={17} />}
              {loading ? 'Consultando...' : 'Consultar'}
            </button>
            <button className="button button-ghost" onClick={syncMeta} disabled={loading || syncing || syncingTrm} title="Consultar Meta y guardar/actualizar las transacciones en PostgreSQL">
              {syncing ? <LoaderCircle className="spin" size={17} /> : <RefreshCw size={17} />}
              {syncing ? 'Sincronizando...' : 'Sincronizar Meta'}
            </button>
            <button className="button button-ghost button-trm" onClick={syncTrm} disabled={loading || syncing || syncingTrm} title="Consultar la TRM histórica USD/COP y almacenarla en PostgreSQL">
              {syncingTrm ? <LoaderCircle className="spin" size={17} /> : <DollarSign size={17} />}
              {syncingTrm ? 'Sincronizando TRM...' : 'Sincronizar TRM'}
            </button>
          </div>
        </section>

        {error && (
          <section className="error-box">
            <AlertTriangle size={20} />
            <div><strong>No se pudo completar la consulta</strong><span>{error}</span></div>
          </section>
        )}

        {success && (
          <section className="success-box">
            <CheckCircle2 size={20} />
            <div><strong>Base de datos actualizada</strong><span>{success}</span></div>
          </section>
        )}

        {!report && !error && (
          <section className="empty-state panel">
            <FileSpreadsheet size={42} />
            <h2>Selecciona el mes que quieres auditar</h2>
            <p>Consulta PostgreSQL para ver datos ya sincronizados o usa “Sincronizar Meta” para guardar el período por primera vez.</p>
          </section>
        )}

        {report && (
          <>
            <section className="results-heading">
              <div>
                <span className="eyebrow">RESULTADO</span>
                <h2>{periodLabel}</h2>
                <p>{report.latest_sync?.finished_at ? `Datos almacenados en PostgreSQL · última sincronización ${formatDateTime(report.latest_sync.finished_at)}` : 'No existe una sincronización registrada para este período.'}</p>
              </div>
              <button className="button button-export" onClick={downloadExcel} disabled={loading || syncing || exporting || report.rows.length === 0}>
                {exporting ? <LoaderCircle className="spin" size={18} /> : <Download size={18} />}
                {exporting ? 'Generando...' : 'Descargar XLSX'}
              </button>
            </section>

            {report.rows.length === 0 && (
              <section className="warning-box">
                <AlertTriangle size={18} />
                <span>No hay cobros almacenados para {periodLabel}. Usa “Sincronizar Meta” para consultar Meta y guardar el período en PostgreSQL.</span>
              </section>
            )}

            <section className="metrics-grid">
              <MetricCard icon={CreditCard} label="Total COP" value={formatMoney(filteredSummary.totals.COP || 0, 'COP')} helper="Cobros del filtro actual" />
              <MetricCard icon={CreditCard} label="Total USD" value={formatMoney(filteredSummary.totals.USD || 0, 'USD')} helper="Cobros del filtro actual" tone="indigo" />
              <MetricCard icon={DollarSign} label="USD referencia en COP" value={formatMoney(filteredSummary.estimatedCopFromUsd || 0, 'COP')} helper="USD × TRM oficial" tone="trm" />
              <MetricCard icon={DollarSign} label="USD proyectado en COP" value={formatMoney(filteredSummary.projectedCopFromUsd || 0, 'COP')} helper={`TRM + ${Number(report.summary?.effective_spread_percent || 0).toFixed(2)}% spread`} tone="projection" />
              <MetricCard icon={FileSpreadsheet} label="Transacciones" value={filteredSummary.transactions} helper="Cargos individuales" tone="success" />
              <MetricCard icon={AlertTriangle} label="Cambios de método" value={filteredSummary.paymentChanges} helper="Registros con alerta" tone="warning" />
            </section>

            <section className="trm-overview panel">
              <div>
                <span className="eyebrow">TRM USD/COP</span>
                <strong>{report.trm?.covered_days || 0} días con tasa almacenada</strong>
                <span>Fuente histórica: Superintendencia Financiera · Datos Abiertos Colombia. La tasa proyectada agrega un spread configurable para aproximar la liquidación de la tarjeta; no reemplaza la tasa bancaria real.</span>
              </div>
              <div className="trm-overview-values">
                <span>Desde <b>{report.trm?.first_date || '—'}</b></span>
                <span>Hasta <b>{report.trm?.last_date || '—'}</b></span>
                <span>Spread <b>{Number(report.summary?.effective_spread_percent || 0).toFixed(2)}%</b></span>
                <span>Rango <b>{Number(report.summary?.effective_spread_min_percent || 0).toFixed(2)}%–{Number(report.summary?.effective_spread_max_percent || 0).toFixed(2)}%</b></span>
              </div>
            </section>

            <section className="business-overview panel">
              <div className="business-overview-heading">
                <div>
                  <h3>Business Meta configurados</h3>
                  <span>Los Business sin cuentas o cobros también se muestran aquí. Cobros consolidados solo lista Business relacionados con una cuenta que tenga movimientos.</span>
                </div>
                <span className="business-overview-count">{availableBusinesses.length} configurados</span>
              </div>

              <div className="business-overview-grid">
                {availableBusinesses.map((item) => (
                  <article className="business-overview-item" key={item.business_id}>
                    <div className="business-overview-top">
                      <div>
                        <strong>{item.name || 'Business Meta'}</strong>
                        <span>{item.business_id}</span>
                      </div>
                      <span className={`business-status ${item.accessible === false ? 'business-status-error' : 'business-status-ok'}`}>
                        {item.accessible === false ? 'Sin acceso' : 'Conectado'}
                      </span>
                    </div>
                    <div className="business-overview-stats">
                      <span><b>{item.owned_accounts ?? 0}</b> propias</span>
                      <span><b>{item.client_accounts ?? 0}</b> cliente</span>
                      <span><b>{item.unique_accounts ?? 0}</b> cuentas</span>
                    </div>
                  </article>
                ))}
              </div>
            </section>

            <section className="filters panel">
              <div className="search-box">
                <Search size={17} />
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar Business ID, cuenta, Account ID o Transaction ID..." />
              </div>
              <select value={business} onChange={(event) => setBusiness(event.target.value)}>
                <option value="ALL">Todos los Business</option>
                {availableBusinesses.map((item) => (
                  <option key={item.business_id} value={item.business_id}>
                    {item.business_id}{item.accessible === false ? ' · sin acceso' : ''}
                  </option>
                ))}
              </select>
              <select value={currency} onChange={(event) => setCurrency(event.target.value)}>
                <option value="ALL">Todas las monedas</option>
                <option value="COP">COP</option>
                <option value="USD">USD</option>
              </select>
              <span className="record-count">{filteredRows.length} registros · {filteredSummary.accounts} cuentas</span>
            </section>

            {inaccessibleBusinesses.length > 0 && (
              <section className="warning-box">
                <AlertTriangle size={18} />
                <span>
                  {inaccessibleBusinesses.length} Business tienen errores o acceso parcial. Revisa la hoja “Business Meta” del XLSX o el endpoint /api/meta/businesses/status para ver el detalle.
                </span>
              </section>
            )}

            <section className="warning-box">
              <AlertTriangle size={18} />
              <span>Una cuenta publicitaria compartida puede pertenecer a varios Business. “Todos los Business” contabiliza cada cobro una sola vez para evitar duplicar valores.</span>
            </section>

            <section className="warning-box payment-warning">
              <CreditCard size={18} />
              <span>La tarjeta predeterminada de una cuenta no se usa como tarjeta histórica del cobro. Si Meta no entrega un método vinculado a la transacción, se mostrará “No disponible” en lugar de atribuir una tarjeta incorrecta.</span>
            </section>

            <section className="table-card panel">
              <div className="table-title">
                <div>
                  <h3>Cobros consolidados</h3>
                  <span>Haz clic en una fila para ver las transacciones individuales.</span>
                </div>
              </div>

              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Fecha</th>
                      <th>Business IDs</th>
                      <th>Cuenta publicitaria</th>
                      <th>Moneda</th>
                      <th>Total cobrado</th>
                      <th>TRM oficial</th>
                      <th>Tasa proyectada</th>
                      <th>COP proyectado</th>
                      <th>Cobros</th>
                      <th>Método transacción</th>
                      <th>Últimos 4</th>
                      <th>Cambio</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.length === 0 ? (
                      <tr><td colSpan="13" className="no-results">No hay registros para los filtros seleccionados.</td></tr>
                    ) : filteredRows.map((row) => {
                      const key = `${row.date}-${row.account_id}-${row.currency}`;
                      const isOpen = Boolean(expanded[key]);
                      return (
                        <React.Fragment key={key}>
                          <tr className="data-row" onClick={() => toggleRow(key)}>
                            <td>{row.date}</td>
                            <td title={businessIdsLabel(row)}>{businessIdsLabel(row)}</td>
                            <td><strong>{row.account_name}</strong><span>ID {row.account_id}</span></td>
                            <td><span className="currency-pill">{row.currency}</span></td>
                            <td className="amount">{formatMoney(row.charged, row.currency)}</td>
                            <td className="trm-cell">{row.currency === 'USD' && row.trm_rate ? Number(row.trm_rate).toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 4 }) : '—'}</td>
                            <td className="projected-rate">{row.currency === 'USD' && row.effective_rate_estimate ? Number(row.effective_rate_estimate).toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 4 }) : '—'}</td>
                            <td className="projected-cop" title={row.currency === 'USD' && row.projected_cop_min != null ? `Rango esperado: ${formatMoney(row.projected_cop_min, 'COP')} a ${formatMoney(row.projected_cop_max, 'COP')}` : ''}>{row.currency === 'USD' && row.projected_cop != null ? formatMoney(row.projected_cop, 'COP') : '—'}</td>
                            <td>{row.transactions?.length || 0}</td>
                            <td title="Solo métodos vinculados a la transacción; no usa la tarjeta predeterminada como histórico.">{row.payment_method}</td>
                            <td>{row.last4}</td>
                            <td>{row.payment_changed ? <span className="badge badge-warning">Sí</span> : <span className="badge badge-ok">No</span>}</td>
                            <td>{isOpen ? <ChevronUp size={17} /> : <ChevronDown size={17} />}</td>
                          </tr>
                          {isOpen && (
                            <tr className="detail-row">
                              <td colSpan="13">
                                <div className="transaction-box">
                                  <div className="transaction-title"><CreditCard size={16} /> Transacciones</div>
                                  <table className="transaction-table">
                                    <thead><tr><th>Transaction ID</th><th>Valor</th><th>Tarjeta transacción</th><th>Últimos 4</th><th>Fuente método</th><th>Estado</th><th>Factura IVA</th><th>Predeterminado cuenta</th><th>TRM oficial</th><th>Tasa proyectada</th><th>COP proyectado</th><th>Rango esperado</th><th>Fecha y hora Meta</th></tr></thead>
                                    <tbody>
                                      {(row.transactions || []).map((tx, index) => (
                                        <tr key={`${tx.transaction_id}-${index}`}>
                                          <td>{tx.transaction_id}</td>
                                          <td>{formatMoney(tx.amount, tx.currency)}</td>
                                          <td>{tx.payment_method_source !== 'UNAVAILABLE' ? (tx.payment_method || 'No disponible') : 'No disponible'}</td>
                                          <td>{tx.payment_method_source !== 'UNAVAILABLE' ? (tx.last4 || '—') : '—'}</td>
                                          <td><span className={`payment-source ${tx.payment_method_source === 'UNAVAILABLE' ? 'payment-source-warning' : ''}`}>{tx.payment_method_source === 'TRANSACTION_EXTRA_DATA' ? 'Meta / transacción' : tx.payment_method_source === 'TRANSACTION_FUNDING_SOURCE_MATCH' ? 'Funding source exacto' : 'No disponible'}</span></td>
                                          <td>{tx.payment_status || 'PAID'}</td>
                                          <td>{tx.invoice_id || '—'}</td>
                                          <td title="Referencia actual de la cuenta, no necesariamente la tarjeta usada históricamente.">{tx.account_default_payment_method || '—'}</td>
                                          <td>{tx.currency === 'USD' && tx.trm_rate ? Number(tx.trm_rate).toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 4 }) : '—'}</td>
                                          <td className="projected-rate">{tx.currency === 'USD' && tx.effective_rate_estimate ? Number(tx.effective_rate_estimate).toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 4 }) : '—'}</td>
                                          <td className="projected-cop">{tx.currency === 'USD' && tx.projected_cop != null ? formatMoney(tx.projected_cop, 'COP') : '—'}</td>
                                          <td>{tx.currency === 'USD' && tx.projected_cop_min != null ? `${formatMoney(tx.projected_cop_min, 'COP')} – ${formatMoney(tx.projected_cop_max, 'COP')}` : '—'}</td>
                                          <td>{formatDateTime(tx.event_time)}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
