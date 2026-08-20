import ExcelJS from 'exceljs';

const HEADER_FILL = '1E293B';
const HEADER_FONT = 'FFFFFF';
const ACCENT_FILL = '0F766E';
const ACCENT_LIGHT = 'CCFBF1';
const INPUT_GREEN = '008000';
const STATIC_GRAY = '666666';
const REVIEW_ORANGE = 'F59E0B';
const ERROR_FILL = 'FEE2E2';

function applyHeaderStyle(row, fill = HEADER_FILL) {
  row.height = 24;
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: HEADER_FONT } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  });
}

function formatMoneyCell(cell, currency) {
  if (currency === 'COP') {
    cell.numFmt = '#,##0;[Red](#,##0);-';
  } else {
    cell.numFmt = '#,##0.00;[Red](#,##0.00);-';
  }
}

function businessIdsForRow(row) {
  if (row.business_ids?.length) return row.business_ids.map(String);
  return row.business_id ? [String(row.business_id)] : [];
}

function businessRelationshipsForRow(row) {
  if (row.business_memberships?.length) {
    return row.business_memberships
      .map((item) => `${item.business_id}:${item.relationship}`)
      .join('; ');
  }
  return '';
}

function flattenTransactions(rows) {
  return rows.flatMap((row) => {
    const transactions = row.transactions?.length ? row.transactions : [{
      transaction_id: 'No disponible',
      amount: row.charged,
      currency: row.currency,
      event_time: null,
    }];

    return transactions.map((tx) => {
      const paymentMethodSource = tx.payment_method_source || 'UNAVAILABLE';
      const paymentMethodVerified = paymentMethodSource !== 'UNAVAILABLE';
      return {
      date: row.date,
      event_time: tx.event_time || '',
      business_ids: businessIdsForRow(row).join(', '),
      business_relationships: businessRelationshipsForRow(row),
      account_name: row.account_name,
      account_id: row.account_id,
      currency: tx.currency || row.currency,
      amount: Number(tx.amount || 0),
      trm_rate: tx.trm_rate ?? row.trm_rate ?? null,
      estimated_cop: tx.estimated_cop ?? null,
      effective_spread_percent: tx.effective_spread_percent ?? row.effective_spread_percent ?? null,
      effective_rate_estimate: tx.effective_rate_estimate ?? row.effective_rate_estimate ?? null,
      projected_cop: tx.projected_cop ?? null,
      projected_cop_min: tx.projected_cop_min ?? null,
      projected_cop_max: tx.projected_cop_max ?? null,
      trm_source: tx.trm_source ?? row.trm_source ?? '',
      payment_method: paymentMethodVerified ? (tx.payment_method || '') : '',
      last4: paymentMethodVerified ? (tx.last4 || '') : '',
      payment_method_source: paymentMethodSource,
      payment_status: tx.payment_status || '',
      invoice_id: tx.invoice_id || '',
      account_default_payment_method: tx.account_default_payment_method || row.account_default_payment_method || '',
      account_default_last4: tx.account_default_last4 || row.account_default_last4 || '',
      transaction_id: tx.transaction_id,
      payment_changed: row.payment_changed ? 'Sí' : 'No',
      source: 'META',
      reconciliation_status: tx.reconciliation_status || '',
      observation: tx.reconciliation_observation || '',
    };
    });
  });
}

function addBusinessWorksheet(workbook, report) {
  const sheet = workbook.addWorksheet('Business Meta', {
    views: [{ state: 'frozen', ySplit: 1 }],
    properties: { defaultRowHeight: 20 },
  });

  sheet.columns = [
    { header: 'Business ID', key: 'business_id', width: 24 },
    { header: 'Nombre', key: 'name', width: 34 },
    { header: 'Accesible', key: 'accessible', width: 14 },
    { header: 'Cuentas propias', key: 'owned_accounts', width: 18 },
    { header: 'Cuentas cliente', key: 'client_accounts', width: 18 },
    { header: 'Cuentas únicas', key: 'unique_accounts', width: 18 },
    { header: 'Última sincronización', key: 'last_synced_at', width: 26 },
    { header: 'Último error', key: 'last_error', width: 60 },
  ];

  applyHeaderStyle(sheet.getRow(1));
  sheet.autoFilter = { from: 'A1', to: 'H1' };

  for (const business of report.businesses || []) {
    const row = sheet.addRow({
      business_id: business.business_id,
      name: business.name || '',
      accessible: business.accessible === false ? 'No' : 'Sí',
      owned_accounts: business.owned_accounts || 0,
      client_accounts: business.client_accounts || 0,
      unique_accounts: business.unique_accounts || 0,
      last_synced_at: business.last_synced_at || '',
      last_error: business.last_error || '',
    });

    row.alignment = { vertical: 'top', wrapText: true };
    if (business.accessible === false || business.last_error) {
      row.getCell('C').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ERROR_FILL } };
      row.getCell('H').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ERROR_FILL } };
    }
  }
}

function addTrmWorksheet(workbook, report) {
  const sheet = workbook.addWorksheet('TRM', {
    views: [{ state: 'frozen', ySplit: 1 }],
    properties: { defaultRowHeight: 20 },
  });

  sheet.columns = [
    { header: 'Fecha', key: 'date', width: 14 },
    { header: 'TRM COP/USD', key: 'rate', width: 18 },
    { header: 'Fuente', key: 'source', width: 34 },
    { header: 'Consultado', key: 'retrieved_at', width: 27 },
    { header: 'URL fuente', key: 'source_url', width: 62 },
  ];

  applyHeaderStyle(sheet.getRow(1));
  sheet.autoFilter = { from: 'A1', to: 'E1' };

  const sourceUrls = {
    SUPERFINANCIERA_DATOS_ABIERTOS: 'https://www.datos.gov.co/resource/32sa-8pi3.json',
    DOLARAPI_SUPERFINANCIERA: 'https://co.dolarapi.com/v1/trm',
  };

  for (const item of report.trm?.rates || []) {
    const row = sheet.addRow({
      date: item.date,
      rate: Number(item.rate || 0),
      source: item.source || '',
      retrieved_at: item.retrieved_at || '',
      source_url: sourceUrls[item.source] || '',
    });
    row.getCell('B').numFmt = '#,##0.0000';
    row.getCell('B').font = { color: { argb: INPUT_GREEN } };
    row.alignment = { vertical: 'middle' };
  }
}

export async function buildChargesWorkbook(report) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Meta Finance Hub';
  workbook.created = new Date();
  workbook.modified = new Date();
  workbook.properties.date1904 = false;

  const detail = workbook.addWorksheet('Cobros', {
    views: [{ state: 'frozen', ySplit: 1 }],
    properties: { defaultRowHeight: 20 },
  });

  detail.columns = [
    { header: 'Fecha', key: 'date', width: 14 },
    { header: 'Fecha y hora Meta', key: 'event_time', width: 27 },
    { header: 'Business IDs', key: 'business_ids', width: 34 },
    { header: 'Relación Business', key: 'business_relationships', width: 38 },
    { header: 'Cuenta publicitaria', key: 'account_name', width: 34 },
    { header: 'Account ID', key: 'account_id', width: 20 },
    { header: 'Moneda', key: 'currency', width: 12 },
    { header: 'Valor cobrado', key: 'amount', width: 18 },
    { header: 'TRM oficial COP/USD', key: 'trm_rate', width: 20 },
    { header: 'COP referencia TRM', key: 'estimated_cop', width: 20 },
    { header: 'Spread estimado %', key: 'effective_spread_percent', width: 18 },
    { header: 'Tasa proyectada COP/USD', key: 'effective_rate_estimate', width: 24 },
    { header: 'COP proyectado liquidación', key: 'projected_cop', width: 25 },
    { header: 'COP rango mínimo', key: 'projected_cop_min', width: 20 },
    { header: 'COP rango máximo', key: 'projected_cop_max', width: 20 },
    { header: 'Fuente TRM', key: 'trm_source', width: 32 },
    { header: 'Método pago transacción', key: 'payment_method', width: 30 },
    { header: 'Últimos 4 transacción', key: 'last4', width: 20 },
    { header: 'Fuente método pago', key: 'payment_method_source', width: 30 },
    { header: 'Estado pago Meta', key: 'payment_status', width: 18 },
    { header: 'Identificador factura IVA', key: 'invoice_id', width: 28 },
    { header: 'Método predeterminado cuenta', key: 'account_default_payment_method', width: 32 },
    { header: 'Últimos 4 predeterminado', key: 'account_default_last4', width: 22 },
    { header: 'Transaction ID', key: 'transaction_id', width: 32 },
    { header: 'Cambio de método', key: 'payment_changed', width: 18 },
    { header: 'Origen', key: 'source', width: 12 },
    { header: 'Estado conciliación', key: 'reconciliation_status', width: 22 },
    { header: 'Observación', key: 'observation', width: 30 },
  ];

  applyHeaderStyle(detail.getRow(1));
  detail.autoFilter = { from: 'A1', to: 'AB1' };
  detail.views = [{ state: 'frozen', ySplit: 1 }];

  const transactions = flattenTransactions(report.rows);
  transactions.forEach((item) => {
    const row = detail.addRow(item);
    row.alignment = { vertical: 'middle' };

    row.getCell('A').numFmt = 'yyyy-mm-dd';
    row.getCell('H').font = { color: { argb: INPUT_GREEN } };
    formatMoneyCell(row.getCell('H'), item.currency);
    row.getCell('I').numFmt = '#,##0.0000';
    formatMoneyCell(row.getCell('J'), 'COP');
    row.getCell('K').numFmt = '0.0000%';
    if (item.effective_spread_percent != null) row.getCell('K').value = Number(item.effective_spread_percent) / 100;
    row.getCell('L').numFmt = '#,##0.0000';
    formatMoneyCell(row.getCell('M'), 'COP');
    formatMoneyCell(row.getCell('N'), 'COP');
    formatMoneyCell(row.getCell('O'), 'COP');
    // Transaction-scoped payment data is authoritative only when Meta ties it to the billing activity.
    if (item.payment_method_source === 'UNAVAILABLE') {
      row.getCell('Q').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FEF3C7' } };
      row.getCell('S').font = { bold: true, color: { argb: REVIEW_ORANGE } };
    } else {
      row.getCell('Q').font = { color: { argb: INPUT_GREEN } };
      row.getCell('R').font = { color: { argb: INPUT_GREEN } };
    }
    row.getCell('V').font = { color: { argb: STATIC_GRAY } };
    row.getCell('W').font = { color: { argb: STATIC_GRAY } };
    row.getCell('Z').font = { color: { argb: STATIC_GRAY } };
    row.getCell('AA').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ACCENT_LIGHT } };
    row.getCell('AB').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ACCENT_LIGHT } };

    if (item.payment_changed === 'Sí') {
      row.getCell('Y').font = { bold: true, color: { argb: REVIEW_ORANGE } };
    }
  });

  const summary = workbook.addWorksheet('Resumen', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  summary.columns = [
    { width: 30 },
    { width: 22 },
    { width: 22 },
  ];

  summary.mergeCells('A1:C1');
  summary.getCell('A1').value = `Auditoría de cobros Meta - ${report.period}`;
  summary.getCell('A1').font = { bold: true, size: 16, color: { argb: HEADER_FONT } };
  summary.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ACCENT_FILL } };
  summary.getCell('A1').alignment = { horizontal: 'left', vertical: 'middle' };
  summary.getRow(1).height = 28;

  summary.addRow([]);
  summary.addRow(['Indicador', 'Valor', 'Unidad']);
  applyHeaderStyle(summary.getRow(3));

  summary.addRow(['Business con cobros', report.summary.businesses || 0, 'business']);
  summary.addRow(['Business configurados', report.summary.configured_businesses ?? report.businesses?.length ?? 0, 'business']);
  summary.addRow(['Business accesibles', report.summary.accessible_businesses ?? (report.businesses || []).filter((item) => item.accessible !== false).length, 'business']);
  summary.addRow(['Cuentas auditadas', report.summary.accounts, 'cuentas']);
  summary.addRow(['Transacciones', report.summary.transactions, 'transacciones']);
  summary.addRow(['Cambios de método', report.summary.payment_changes, 'registros']);
  const estimatedRow = summary.addRow(['USD referencia con TRM', Number(report.summary.estimated_cop_from_usd || 0), 'COP referencia']);
  formatMoneyCell(estimatedRow.getCell(2), 'COP');
  const projectedRow = summary.addRow(['USD proyectado con spread', Number(report.summary.projected_cop_from_usd || 0), 'COP proyectado']);
  formatMoneyCell(projectedRow.getCell(2), 'COP');
  summary.addRow(['Spread estimado liquidación', Number(report.summary.effective_spread_percent || 0) / 100, '%']);
  summary.getCell(`B${summary.rowCount}`).numFmt = '0.0000%';
  summary.addRow(['Rango spread mínimo', Number(report.summary.effective_spread_min_percent || 0) / 100, '%']);
  summary.getCell(`B${summary.rowCount}`).numFmt = '0.0000%';
  summary.addRow(['Rango spread máximo', Number(report.summary.effective_spread_max_percent || 0) / 100, '%']);
  summary.getCell(`B${summary.rowCount}`).numFmt = '0.0000%';
  summary.addRow(['Días con TRM almacenada', report.trm?.covered_days || 0, 'días']);

  const currencies = Object.keys(report.summary.totals).sort();
  currencies.forEach((currency) => {
    const rowNumber = summary.rowCount + 1;
    const formula = `SUMIF(Cobros!$G:$G,"${currency}",Cobros!$H:$H)`;
    const row = summary.addRow([
      `Total ${currency}`,
      { formula, result: Number(report.summary.totals[currency] || 0) },
      currency,
    ]);
    formatMoneyCell(row.getCell(2), currency);
    row.getCell(2).font = { bold: true };
    summary.getCell(`A${rowNumber}`).font = { bold: true };
  });

  summary.addRow([]);
  summary.addRow(['Generado', report.generated_at, 'UTC']);
  summary.addRow(['Origen', report.source === 'database' ? 'PostgreSQL (sincronizado desde Meta)' : 'Meta Graph API', '']);
  summary.addRow(['Registros con error', report.errors?.length || 0, 'registros']);
  summary.addRow(['Fuente TRM histórica', 'Superintendencia Financiera / Datos Abiertos Colombia', 'https://www.datos.gov.co/resource/32sa-8pi3.json']);
  summary.addRow(['Respaldo TRM vigente', 'DolarAPI / Superintendencia Financiera', 'https://co.dolarapi.com/v1/trm']);

  summary.eachRow((row, rowNumber) => {
    if (rowNumber > 3) row.alignment = { vertical: 'middle' };
  });

  addBusinessWorksheet(workbook, report);
  addTrmWorksheet(workbook, report);

  return workbook.xlsx.writeBuffer();
}
