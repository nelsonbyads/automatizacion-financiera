import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarDays,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  CreditCard,
  Database,
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
      const matchesSearch = !term ||
        String(row.business_id || '').toLowerCase().includes(term) ||
        row.account_name.toLowerCase().includes(term) ||
        String(row.account_id).toLowerCase().includes(term) ||
        row.transactions?.some((tx) => String(tx.transaction_id).toLowerCase().includes(term));
      const matchesCurrency = currency === 'ALL' || row.currency === currency;
      const matchesBusiness = business === 'ALL' || String(row.business_id || '') === business;
      return matchesSearch && matchesCurrency && matchesBusiness;
    });
  }, [report, search, currency, business]);

  const availableBusinesses = useMemo(() => {
    const ids = new Set((report?.rows || []).map((row) => String(row.business_id || '')).filter(Boolean));
    return [...ids].sort();
  }, [report]);

  const filteredSummary = useMemo(() => {
    const totals = {};
    const accounts = new Set();
    let transactions = 0;
    let paymentChanges = 0;

    filteredRows.forEach((row) => {
      totals[row.currency] = (totals[row.currency] || 0) + Number(row.charged || 0);
      accounts.add(row.account_id);
      transactions += row.transactions?.length || 0;
      if (row.payment_changed) paymentChanges += 1;
    });

    return { totals, accounts: accounts.size, transactions, paymentChanges };
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

  async function loadReport() {
    setLoading(true);
    setError('');
    setSuccess('');
    setExpanded({});

    try {
      const params = new URLSearchParams({ year: String(year), month: String(month) });
      const response = await fetch(`${API_BASE}/api/meta/stored?${params.toString()}`);
      const body = await readJsonResponse(response, 'No fue posible consultar los datos almacenados.');
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
      setSuccess(
        `Sincronización completada: ${sync?.records_received ?? 0} recibidas, ` +
        `${sync?.records_created ?? 0} nuevas, ${sync?.records_updated ?? 0} actualizadas` +
        `${sync?.records_failed ? ` y ${sync.records_failed} con error` : ''}.`
      );
    } catch (syncError) {
      setError(syncError.message);
    } finally {
      setSyncing(false);
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
              <select value={year} onChange={(event) => changePeriod(setYear, event.target.value)} disabled={loading || syncing}>
                {years.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>
            <label>
              <span>MES</span>
              <select value={month} onChange={(event) => changePeriod(setMonth, event.target.value)} disabled={loading || syncing}>
                {MONTHS.map((name, index) => <option key={name} value={index + 1}>{name}</option>)}
              </select>
            </label>
            <button className="button button-primary" onClick={loadReport} disabled={loading || syncing}>
              {loading ? <LoaderCircle className="spin" size={17} /> : <Database size={17} />}
              {loading ? 'Consultando...' : 'Consultar'}
            </button>
            <button className="button button-ghost" onClick={syncMeta} disabled={loading || syncing} title="Consultar Meta y guardar/actualizar las transacciones en PostgreSQL">
              {syncing ? <LoaderCircle className="spin" size={17} /> : <RefreshCw size={17} />}
              {syncing ? 'Sincronizando...' : 'Sincronizar Meta'}
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
              <MetricCard icon={FileSpreadsheet} label="Transacciones" value={filteredSummary.transactions} helper="Cargos individuales" tone="success" />
              <MetricCard icon={AlertTriangle} label="Cambios de método" value={filteredSummary.paymentChanges} helper="Registros con alerta" tone="warning" />
            </section>

            <section className="filters panel">
              <div className="search-box">
                <Search size={17} />
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar Business ID, cuenta, Account ID o Transaction ID..." />
              </div>
              <select value={business} onChange={(event) => setBusiness(event.target.value)}>
                <option value="ALL">Todos los Business</option>
                {availableBusinesses.map((id) => <option key={id} value={id}>{id}</option>)}
              </select>
              <select value={currency} onChange={(event) => setCurrency(event.target.value)}>
                <option value="ALL">Todas las monedas</option>
                <option value="COP">COP</option>
                <option value="USD">USD</option>
              </select>
              <span className="record-count">{filteredRows.length} registros · {filteredSummary.accounts} cuentas</span>
            </section>

            {report.errors.length > 0 && (
              <section className="warning-box">
                <AlertTriangle size={18} />
                <span>{report.errors.length} cuenta(s) no pudieron procesarse completamente. El Excel incluye los datos disponibles del período.</span>
              </section>
            )}

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
                      <th>Business ID</th>
                      <th>Cuenta publicitaria</th>
                      <th>Moneda</th>
                      <th>Total cobrado</th>
                      <th>Cobros</th>
                      <th>Método de pago</th>
                      <th>Últimos 4</th>
                      <th>Cambio</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.length === 0 ? (
                      <tr><td colSpan="10" className="no-results">No hay registros para los filtros seleccionados.</td></tr>
                    ) : filteredRows.map((row) => {
                      const key = `${row.date}-${row.business_id || 'business'}-${row.account_id}-${row.currency}`;
                      const isOpen = Boolean(expanded[key]);
                      return (
                        <React.Fragment key={key}>
                          <tr className="data-row" onClick={() => toggleRow(key)}>
                            <td>{row.date}</td>
                            <td>{row.business_id || 'No disponible'}</td>
                            <td><strong>{row.account_name}</strong><span>ID {row.account_id}</span></td>
                            <td><span className="currency-pill">{row.currency}</span></td>
                            <td className="amount">{formatMoney(row.charged, row.currency)}</td>
                            <td>{row.transactions?.length || 0}</td>
                            <td>{row.payment_method}</td>
                            <td>{row.last4}</td>
                            <td>{row.payment_changed ? <span className="badge badge-warning">Sí</span> : <span className="badge badge-ok">No</span>}</td>
                            <td>{isOpen ? <ChevronUp size={17} /> : <ChevronDown size={17} />}</td>
                          </tr>
                          {isOpen && (
                            <tr className="detail-row">
                              <td colSpan="10">
                                <div className="transaction-box">
                                  <div className="transaction-title"><CreditCard size={16} /> Transacciones</div>
                                  <table className="transaction-table">
                                    <thead><tr><th>Transaction ID</th><th>Valor</th><th>Fecha y hora Meta</th></tr></thead>
                                    <tbody>
                                      {(row.transactions || []).map((tx, index) => (
                                        <tr key={`${tx.transaction_id}-${index}`}>
                                          <td>{tx.transaction_id}</td>
                                          <td>{formatMoney(tx.amount, tx.currency)}</td>
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
