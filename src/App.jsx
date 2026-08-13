import React, { useState, useMemo } from 'react';
import { 
  Search, 
  Calendar, 
  DollarSign, 
  CreditCard, 
  AlertTriangle, 
  TrendingUp, 
  Plus, 
  ChevronDown, 
  ChevronUp, 
  Upload, 
  X, 
  FileText, 
  CheckCircle2, 
  Info,
  Layers,
  ArrowUpDown
} from 'lucide-react';

// ============================================================
// DATOS DEMO PRE-CARGADOS
// ============================================================
const MOCK_DATA = [
  {
    date: "2026-08-12",
    account_id: "487572709507485",
    account_name: "Campañas Conversiones Latam",
    currency: "COP",
    charged: 4850000,
    payment_method: "Mastercard *5512",
    last4: "5512",
    payment_changed: false,
    transactions: [
      { transaction_id: "2784918239401", amount: 2425000, currency: "COP", event_time: "2026-08-12T08:15:32-05:00" },
      { transaction_id: "2784920938492", amount: 2425000, currency: "COP", event_time: "2026-08-12T14:45:10-05:00" }
    ]
  },
  {
    date: "2026-08-12",
    account_id: "1928374650192",
    account_name: "Remarketing - Tráfico Web",
    currency: "COP",
    charged: 1850000,
    payment_method: "Visa •••• 9845",
    last4: "9845",
    payment_changed: true,
    transactions: [
      { transaction_id: "2784958293847", amount: 1850000, currency: "COP", event_time: "2026-08-12T10:30:00-05:00" }
    ]
  },
  {
    date: "2026-08-11",
    account_id: "487572709507485",
    account_name: "Campañas Conversiones Latam",
    currency: "COP",
    charged: 2425000,
    payment_method: "Mastercard *5512",
    last4: "5512",
    payment_changed: false,
    transactions: [
      { transaction_id: "2784819283471", amount: 2425000, currency: "COP", event_time: "2026-08-11T12:05:14-05:00" }
    ]
  },
  {
    date: "2026-08-11",
    account_id: "9081726354091",
    account_name: "Shopify US - Prospecting",
    currency: "USD",
    charged: 450.50,
    payment_method: "Visa **** 4422",
    last4: "4422",
    payment_changed: false,
    transactions: [
      { transaction_id: "2784839482934", amount: 200.00, currency: "USD", event_time: "2026-08-11T09:00:22-05:00" },
      { transaction_id: "2784848293847", amount: 250.50, currency: "USD", event_time: "2026-08-11T16:18:55-05:00" }
    ]
  },
  {
    date: "2026-08-10",
    account_id: "9081726354091",
    account_name: "Shopify US - Prospecting",
    currency: "USD",
    charged: 120.00,
    payment_method: "Visa **** 4422",
    last4: "4422",
    payment_changed: false,
    transactions: [
      { transaction_id: "2784729384729", amount: 120.00, currency: "USD", event_time: "2026-08-10T11:42:00-05:00" }
    ]
  }
];

// ============================================================
// FORMATEADORES DE MONEDA
// ============================================================
function formatMoney(value, currency) {
  if (currency === "COP") {
    return "COP " + new Intl.NumberFormat("es-CO", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(Math.round(value));
  }

  if (currency === "USD") {
    return "USD " + new Intl.NumberFormat("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(value);
  }

  return `${currency} ${value.toFixed(2)}`;
}

export default function App() {
  const [data, setData] = useState(MOCK_DATA);
  const [search, setSearch] = useState('');
  const [filterCurrency, setFilterCurrency] = useState('ALL');
  const [filterChanged, setFilterChanged] = useState('ALL');
  const [selectedDate, setSelectedDate] = useState('ALL');
  
  // Importer state
  const [showImporter, setShowImporter] = useState(false);
  const [pasteData, setPasteData] = useState('');
  const [importStatus, setImportStatus] = useState({ type: '', msg: '' });
  
  // Expandable rows state
  const [expandedRows, setExpandedRows] = useState({});

  // ============================================================
  // PARSER DE REPORTE DE TEXTO Y JSON
  // ============================================================
  const handleImport = () => {
    if (!pasteData.trim()) {
      setImportStatus({ type: 'error', msg: 'El cuadro de texto está vacío.' });
      return;
    }

    try {
      // 1. Intentar parsear como JSON directo (si el usuario pegó el JSON)
      if (pasteData.trim().startsWith('[') || pasteData.trim().startsWith('{')) {
        const parsed = JSON.parse(pasteData);
        const validated = Array.isArray(parsed) ? parsed : [parsed];
        
        // Validación mínima
        if (validated.length > 0 && validated[0].account_id && validated[0].date) {
          setData(validated);
          setImportStatus({ type: 'success', msg: `¡Éxito! Se importaron ${validated.length} registros desde JSON.` });
          setTimeout(() => {
            setShowImporter(false);
            setPasteData('');
            setImportStatus({ type: '', msg: '' });
          }, 1500);
          return;
        }
      }

      // 2. Intentar parsear como reporte de texto estructurado de script.js
      const lines = pasteData.split('\n');
      const rows = [];
      let currentDay = null;
      let currentAccount = null;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();

        // Detectar cambio de día
        // Formatos: === 2026-08-12 === o simplemente 2026-08-12 sobre líneas rodeadas de "="
        if (line.startsWith('===') && line.replace(/=/g, '').trim().match(/^\d{4}-\d{2}-\d{2}$/)) {
          currentDay = line.replace(/=/g, '').trim();
          continue;
        } else if (line.match(/^\d{4}-\d{2}-\d{2}$/)) {
          currentDay = line;
          continue;
        }

        if (line.startsWith('Cuenta:')) {
          currentAccount = {
            date: currentDay,
            account_name: line.replace('Cuenta:', '').trim(),
            transactions: []
          };
          rows.push(currentAccount);
          continue;
        }

        if (currentAccount) {
          if (line.startsWith('Account ID:')) {
            currentAccount.account_id = line.replace('Account ID:', '').trim();
          } else if (line.startsWith('Cobros de Meta:')) {
            const clean = line.replace('Cobros de Meta:', '').trim();
            const currencyMatch = clean.match(/^(COP|USD|[A-Z]{3})\s*(.*)$/);
            currentAccount.currency = currencyMatch ? currencyMatch[1] : 'COP';
            
            let numStr = currencyMatch ? currencyMatch[2] : clean;
            numStr = numStr.replace(/\./g, '').replace(/,/g, '.').replace(/\s/g, '');
            currentAccount.charged = parseFloat(numStr) || 0;
          } else if (line.startsWith('Método de pago actual:')) {
            currentAccount.payment_method = line.replace('Método de pago actual:', '').trim();
          } else if (line.startsWith('Últimos 4 actuales:')) {
            currentAccount.last4 = line.replace('Últimos 4 actuales:', '').trim();
          } else if (line.startsWith('Cambió método este mes:')) {
            currentAccount.payment_changed = line.replace('Cambió método este mes:', '').trim().toLowerCase() === 'sí';
          } else if (line.startsWith('- transaction_id')) {
            const parts = line.replace('- transaction_id', '').split('|');
            if (parts.length >= 2) {
              const id = parts[0].trim();
              const amountStr = parts[1].trim();
              const dateStr = parts[2] ? parts[2].trim() : '';
              const currencyMatch = amountStr.match(/^(COP|USD|[A-Z]{3})\s*(.*)$/);
              const currency = currencyMatch ? currencyMatch[1] : currentAccount.currency;
              
              let numStr = currencyMatch ? currencyMatch[2] : amountStr;
              numStr = numStr.replace(/\./g, '').replace(/,/g, '.').replace(/\s/g, '');
              currentAccount.transactions.push({
                transaction_id: id,
                amount: parseFloat(numStr) || 0,
                currency: currency,
                event_time: dateStr
              });
            }
          }
        }
      }

      const filteredRows = rows.filter(r => r.date && r.account_id);
      
      if (filteredRows.length > 0) {
        setData(filteredRows);
        setImportStatus({ type: 'success', msg: `¡Éxito! Se importaron ${filteredRows.length} registros desde el Reporte.` });
        setTimeout(() => {
          setShowImporter(false);
          setPasteData('');
          setImportStatus({ type: '', msg: '' });
        }, 1500);
      } else {
        throw new Error("No se detectó ningún patrón de fecha o cuenta válido en el reporte de texto.");
      }

    } catch (e) {
      setImportStatus({ type: 'error', msg: `Error de importación: ${e.message}` });
    }
  };

  const toggleRow = (key) => {
    setExpandedRows(prev => ({
      ...prev,
      [key]: !prev[key]
    }));
  };

  // ============================================================
  // FILTRADO Y MÉTODOS DE BÚSQUEDA
  // ============================================================
  const filteredData = useMemo(() => {
    return data.filter(item => {
      const matchSearch = 
        item.account_name.toLowerCase().includes(search.toLowerCase()) ||
        item.account_id.includes(search);
      
      const matchCurrency = filterCurrency === 'ALL' || item.currency === filterCurrency;
      const matchChanged = filterChanged === 'ALL' || 
        (filterChanged === 'YES' && item.payment_changed) ||
        (filterChanged === 'NO' && !item.payment_changed);

      const matchDate = selectedDate === 'ALL' || item.date === selectedDate;

      return matchSearch && matchCurrency && matchChanged && matchDate;
    });
  }, [data, search, filterCurrency, filterChanged, selectedDate]);

  // Lista de fechas únicas para el dropdown
  const uniqueDates = useMemo(() => {
    return ['ALL', ...new Set(data.map(item => item.date))].sort();
  }, [data]);

  // ============================================================
  // CÁLCULO DE MÉTRICAS GLOBALES
  // ============================================================
  const metrics = useMemo(() => {
    let copSpent = 0;
    let usdSpent = 0;
    let totalTransactions = 0;
    let methodChangesCount = 0;
    const activeAccounts = new Set();

    filteredData.forEach(item => {
      if (item.currency === 'COP') {
        copSpent += item.charged;
      } else if (item.currency === 'USD') {
        usdSpent += item.charged;
      }
      totalTransactions += item.transactions?.length || 0;
      if (item.payment_changed) {
        methodChangesCount++;
      }
      activeAccounts.add(item.account_id);
    });

    return {
      copSpent,
      usdSpent,
      totalTransactions,
      methodChangesCount,
      activeAccountsCount: activeAccounts.size
    };
  }, [filteredData]);

  // Distribución del gasto por cuenta
  const accountDistribution = useMemo(() => {
    const distribution = {};
    let grandTotalCop = 0;

    filteredData.forEach(item => {
      if (item.currency === 'COP') {
        distribution[item.account_name] = (distribution[item.account_name] || 0) + item.charged;
        grandTotalCop += item.charged;
      }
    });

    return Object.keys(distribution).map(name => ({
      name,
      total: distribution[name],
      percentage: grandTotalCop > 0 ? (distribution[name] / grandTotalCop) * 100 : 0
    })).sort((a, b) => b.total - a.total);
  }, [filteredData]);

  return (
    <div className="app-container">
      {/* ============================================================
         HEADER
         ============================================================ */}
      <header className="app-header">
        <div className="logo-container">
          <div className="logo-icon">
            <Layers className="text-primary" size={20} />
          </div>
          <div>
            <h2 style={{ fontSize: '18px', lineHeight: 1.2 }}>Meta Finance Hub</h2>
            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Plataforma de Auditoría Publicitaria</span>
          </div>
        </div>

        <div className="header-actions">
          <button className="btn-primary" onClick={() => setShowImporter(!showImporter)}>
            <Upload size={16} />
            {showImporter ? "Cerrar Panel" : "Importar Reporte"}
          </button>
        </div>
      </header>

      {/* ============================================================
         MAIN DASHBOARD
         ============================================================ */}
      <main className="main-content">
        
        {/* ============================================================
           SECCIÓN DE IMPORTACIÓN (PLEGABLE)
           ============================================================ */}
        {showImporter && (
          <section className="card-glass importer-section">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ fontSize: '18px' }} className="text-gradient">Importar Datos de script.js</h3>
              <button 
                onClick={() => setShowImporter(false)}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
              >
                <X size={20} />
              </button>
            </div>
            
            <div className="paste-wrapper">
              <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                Pega el archivo de salida <code>report_YYYY-MM.txt</code> o la estructura JSON para poblar los gráficos de forma dinámica:
              </label>
              <textarea 
                className="paste-textarea" 
                placeholder="Pega el contenido del reporte aquí..."
                value={pasteData}
                onChange={(e) => setPasteData(e.target.value)}
              />
            </div>

            {importStatus.msg && (
              <div style={{ 
                padding: '12px', 
                borderRadius: 'var(--radius-sm)', 
                fontSize: '13px',
                display: 'flex',
                align-items: 'center',
                gap: '8px',
                background: importStatus.type === 'success' ? 'var(--success-glow)' : 'var(--danger-glow)',
                color: importStatus.type === 'success' ? 'var(--success)' : 'var(--danger)'
              }}>
                <Info size={16} />
                {importStatus.msg}
              </div>
            )}

            <button className="btn-primary" onClick={handleImport}>
              <CheckCircle2 size={16} />
              Procesar y Visualizar
            </button>
          </section>
        )}

        {/* ============================================================
           TARJETAS DE MÉTRICAS
           ============================================================ */}
        <section className="metrics-grid">
          <div className="card-glass metric-card">
            <div className="metric-icon-box metric-cyan">
              <DollarSign size={24} />
            </div>
            <div className="metric-info">
              <span className="metric-label">Facturado COP</span>
              <span className="metric-value">{formatMoney(metrics.copSpent, 'COP')}</span>
              <span className="metric-subtext">Moneda Nacional</span>
            </div>
          </div>

          <div className="card-glass metric-card">
            <div className="metric-icon-box metric-indigo">
              <DollarSign size={24} />
            </div>
            <div className="metric-info">
              <span className="metric-label">Facturado USD</span>
              <span className="metric-value">{formatMoney(metrics.usdSpent, 'USD')}</span>
              <span className="metric-subtext">Moneda Extranjera</span>
            </div>
          </div>

          <div className="card-glass metric-card">
            <div className="metric-icon-box metric-warning">
              <AlertTriangle size={24} />
            </div>
            <div className="metric-info">
              <span className="metric-label">Cambios Método Pago</span>
              <span className="metric-value" style={{ color: metrics.methodChangesCount > 0 ? 'var(--warning)' : 'var(--text-primary)' }}>
                {metrics.methodChangesCount}
              </span>
              <span className="metric-subtext">Alertas de Finanzas</span>
            </div>
          </div>

          <div className="card-glass metric-card">
            <div className="metric-icon-box metric-success">
              <TrendingUp size={24} />
            </div>
            <div className="metric-info">
              <span className="metric-label">Cuentas Auditadas</span>
              <span className="metric-value">{metrics.activeAccountsCount}</span>
              <span className="metric-subtext">Cuentas publicitarias del Business</span>
            </div>
          </div>
        </section>

        {/* ============================================================
           SECCIÓN DE CONTROLES Y FILTROS
           ============================================================ */}
        <section className="card-glass controls-bar">
          <div className="search-wrapper">
            <Search className="search-icon" />
            <input 
              type="text" 
              className="search-input" 
              placeholder="Buscar por nombre de cuenta o ID..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="filters-wrapper">
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: '600' }}>MONEDA</span>
              <select className="filter-select" value={filterCurrency} onChange={(e) => setFilterCurrency(e.target.value)}>
                <option value="ALL">Todas las monedas</option>
                <option value="COP">COP (Pesos Colombianos)</option>
                <option value="USD">USD (Dólares)</option>
              </select>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: '600' }}>FECHA</span>
              <select className="filter-select" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)}>
                {uniqueDates.map(date => (
                  <option key={date} value={date}>{date === 'ALL' ? 'Todas las fechas' : date}</option>
                ))}
              </select>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: '600' }}>ALERTA METODO</span>
              <select className="filter-select" value={filterChanged} onChange={(e) => setFilterChanged(e.target.value)}>
                <option value="ALL">Todos los estados</option>
                <option value="YES">Método cambiado</option>
                <option value="NO">Sin cambios</option>
              </select>
            </div>
          </div>
        </section>

        {/* ============================================================
           TABLA DE AUDITORÍA Y GRÁFICO DISTRIBUCIÓN
           ============================================================ */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '32px', alignItems: 'start' }}>
          
          {/* TABLA PRINCIPAL DE FACTURACIÓN */}
          <div className="card-glass table-section" style={{ gridColumn: 'span 2' }}>
            <div className="table-header-block">
              <h3 style={{ fontSize: '18px' }} className="text-gradient">Registros de Facturación por Día</h3>
              <span className="badge badge-pill">Mostrando {filteredData.length} registros</span>
            </div>
            
            <div className="table-responsive">
              <table className="finance-table">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Cuenta Publicitaria</th>
                    <th>Total Facturado</th>
                    <th>Nº Cobros</th>
                    <th>Método de Pago</th>
                    <th>Cambio de Método</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredData.length === 0 ? (
                    <tr>
                      <td colSpan="7" style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
                        <Info style={{ marginBottom: '8px', opacity: 0.5 }} size={32} />
                        <p>No se encontraron registros de facturación con los filtros actuales.</p>
                      </td>
                    </tr>
                  ) : (
                    filteredData.map((row, idx) => {
                      const rowKey = `${row.date}-${row.account_id}-${row.currency}`;
                      const isExpanded = !!expandedRows[rowKey];

                      return (
                        <React.Fragment key={rowKey}>
                          {/* Fila principal */}
                          <tr className={`main-row ${isExpanded ? 'expanded' : ''}`} onClick={() => toggleRow(rowKey)}>
                            <td style={{ fontWeight: 600 }}>{row.date}</td>
                            <td>
                              <div style={{ display: 'flex', flexDirection: 'column' }}>
                                <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{row.account_name}</span>
                                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>ID: {row.account_id}</span>
                              </div>
                            </td>
                            <td style={{ fontWeight: 700, color: 'var(--accent-cyan)' }}>
                              {formatMoney(row.charged, row.currency)}
                            </td>
                            <td>
                              <span className="badge badge-pill">{row.transactions?.length || 0} cobros</span>
                            </td>
                            <td>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <CreditCard size={14} className="text-muted" />
                                <span>{row.payment_method}</span>
                              </div>
                            </td>
                            <td>
                              {row.payment_changed ? (
                                <span className="badge badge-warning">
                                  <AlertTriangle size={12} />
                                  Cambió
                                </span>
                              ) : (
                                <span className="badge badge-success">
                                  No
                                </span>
                              )}
                            </td>
                            <td>
                              {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                            </td>
                          </tr>

                          {/* Fila expandible con transacciones */}
                          {isExpanded && (
                            <tr>
                              <td colSpan="7" className="expanded-row-cell">
                                <div className="expanded-container">
                                  <div className="transactions-list-title">
                                    <CreditCard size={16} />
                                    Detalle de Transacciones (Cobros en Meta)
                                  </div>
                                  <table className="transactions-subtable">
                                    <thead>
                                      <tr>
                                        <th>ID de Transacción</th>
                                        <th>Importe de Cobro</th>
                                        <th>Fecha y Hora del Evento (Meta)</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {row.transactions && row.transactions.length > 0 ? (
                                        row.transactions.map((tx, txIdx) => (
                                          <tr key={txIdx}>
                                            <td>{tx.transaction_id}</td>
                                            <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                                              {formatMoney(tx.amount, tx.currency)}
                                            </td>
                                            <td>{tx.event_time}</td>
                                          </tr>
                                        ))
                                      ) : (
                                        <tr>
                                          <td colSpan="3" style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                                            No hay registros de transacciones individuales disponibles.
                                          </td>
                                        </tr>
                                      )}
                                    </tbody>
                                  </table>
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* DISTRIBUCIÓN DE GASTO EN COP */}
          <div className="card-glass" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <h3 style={{ fontSize: '18px' }} className="text-gradient">Distribución Gasto (COP)</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {accountDistribution.length === 0 ? (
                <p style={{ color: 'var(--text-muted)', fontSize: '14px', textAlign: 'center', padding: '20px' }}>
                  No hay datos en Pesos Colombianos para graficar.
                </p>
              ) : (
                accountDistribution.map((item, idx) => (
                  <div key={idx} style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                      <span style={{ fontWeight: 500, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '200px' }}>
                        {item.name}
                      </span>
                      <span style={{ fontWeight: 600 }}>{formatMoney(item.total, 'COP')} ({item.percentage.toFixed(1)}%)</span>
                    </div>
                    {/* Barra de progreso */}
                    <div style={{ width: '100%', height: '8px', background: 'rgba(255, 255, 255, 0.05)', borderRadius: 'var(--radius-full)', overflow: 'hidden' }}>
                      <div style={{ 
                        width: `${item.percentage}%`, 
                        height: '100%', 
                        background: 'linear-gradient(90deg, var(--accent-indigo), var(--accent-cyan))',
                        borderRadius: 'var(--radius-full)'
                      }} />
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

        </div>

      </main>
    </div>
  );
}
