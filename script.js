import { buildChargesWorkbook } from './server/excel.service.js';
import { getMonthlyCharges } from './server/meta.service.js';
import fs from 'node:fs/promises';

const reportMonth = process.env.REPORT_MONTH || new Date().toISOString().slice(0, 7);
const [year, month] = reportMonth.split('-').map(Number);

if (!/^\d{4}-\d{2}$/.test(reportMonth)) {
  console.error('REPORT_MONTH debe tener formato YYYY-MM. Ejemplo: 2026-08');
  process.exit(1);
}

try {
  const report = await getMonthlyCharges(year, month, { forceRefresh: true });
  const buffer = await buildChargesWorkbook(report);
  const fileName = `meta-cobros-${report.period}.xlsx`;
  await fs.writeFile(fileName, Buffer.from(buffer));
  console.log(`Reporte generado: ${fileName}`);
  console.log(`Transacciones: ${report.summary.transactions}`);
  console.log(`Cuentas: ${report.summary.accounts}`);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
