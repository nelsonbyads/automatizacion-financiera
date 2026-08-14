import ExcelJS from 'exceljs';

const HEADER_FILL = '1E293B';
const HEADER_FONT = 'FFFFFF';
const ACCENT_FILL = '0F766E';
const ACCENT_LIGHT = 'CCFBF1';
const INPUT_GREEN = '008000';
const STATIC_GRAY = '666666';
const REVIEW_ORANGE = 'F59E0B';

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

function flattenTransactions(rows) {
  return rows.flatMap((row) => {
    const transactions = row.transactions?.length ? row.transactions : [{
      transaction_id: 'No disponible',
      amount: row.charged,
      currency: row.currency,
      event_time: null,
    }];

    return transactions.map((tx) => ({
      date: row.date,
      event_time: tx.event_time || '',
      business_id: row.business_id || '',
      account_name: row.account_name,
      account_id: row.account_id,
      currency: tx.currency || row.currency,
      amount: Number(tx.amount || 0),
      payment_method: row.payment_method,
      last4: row.last4,
      transaction_id: tx.transaction_id,
      payment_changed: row.payment_changed ? 'Sí' : 'No',
      source: 'META',
      reconciliation_status: tx.reconciliation_status || '',
      observation: tx.reconciliation_observation || '',
    }));
  });
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
    { header: 'Business ID', key: 'business_id', width: 22 },
    { header: 'Cuenta publicitaria', key: 'account_name', width: 34 },
    { header: 'Account ID', key: 'account_id', width: 20 },
    { header: 'Moneda', key: 'currency', width: 12 },
    { header: 'Valor cobrado', key: 'amount', width: 18 },
    { header: 'Método de pago', key: 'payment_method', width: 32 },
    { header: 'Últimos 4', key: 'last4', width: 14 },
    { header: 'Transaction ID', key: 'transaction_id', width: 28 },
    { header: 'Cambio de método', key: 'payment_changed', width: 18 },
    { header: 'Origen', key: 'source', width: 12 },
    { header: 'Estado conciliación', key: 'reconciliation_status', width: 22 },
    { header: 'Observación', key: 'observation', width: 30 },
  ];

  applyHeaderStyle(detail.getRow(1));
  detail.autoFilter = { from: 'A1', to: 'N1' };
  detail.views = [{ state: 'frozen', ySplit: 1 }];

  const transactions = flattenTransactions(report.rows);
  transactions.forEach((item) => {
    const row = detail.addRow(item);
    row.alignment = { vertical: 'middle' };

    row.getCell('A').numFmt = 'yyyy-mm-dd';
    row.getCell('G').font = { color: { argb: INPUT_GREEN } };
    formatMoneyCell(row.getCell('G'), item.currency);

    row.getCell('L').font = { color: { argb: STATIC_GRAY } };
    row.getCell('M').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ACCENT_LIGHT } };
    row.getCell('N').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ACCENT_LIGHT } };

    if (item.payment_changed === 'Sí') {
      row.getCell('K').font = { bold: true, color: { argb: REVIEW_ORANGE } };
    }
  });

  const summary = workbook.addWorksheet('Resumen', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  summary.columns = [
    { width: 28 },
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

  summary.addRow(['Business auditados', report.summary.businesses || 0, 'business']);
  summary.addRow(['Cuentas auditadas', report.summary.accounts, 'cuentas']);
  summary.addRow(['Transacciones', report.summary.transactions, 'transacciones']);
  summary.addRow(['Cambios de método', report.summary.payment_changes, 'registros']);

  const currencies = Object.keys(report.summary.totals).sort();
  currencies.forEach((currency) => {
    const rowNumber = summary.rowCount + 1;
    const formula = `SUMIF(Cobros!$F:$F,"${currency}",Cobros!$G:$G)`;
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
  summary.addRow(['Registros con error', report.errors.length, 'cuentas']);

  summary.eachRow((row, rowNumber) => {
    if (rowNumber > 3) row.alignment = { vertical: 'middle' };
  });

  return workbook.xlsx.writeBuffer();
}
