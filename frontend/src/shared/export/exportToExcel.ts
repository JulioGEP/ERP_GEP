import { utils, writeFile } from 'xlsx';
import { postJson } from '../../api/client';

type ExportToExcelOptions = {
  rows: ReadonlyArray<ReadonlyArray<string | number | boolean | Date | null | undefined>>;
  fileName: string;
  sheetName?: string;
  auditEvent?: {
    action: string;
    entityType?: string;
    details?: Record<string, unknown>;
  };
};

export function exportToExcel({ rows, fileName, sheetName = 'Datos', auditEvent }: ExportToExcelOptions): void {
  const normalizedRows = rows.map((row) => row.map((cell) => (cell ?? '') as string | number | boolean | Date));
  const worksheet = utils.aoa_to_sheet(normalizedRows);
  const workbook = utils.book_new();
  utils.book_append_sheet(workbook, worksheet, sheetName);
  writeFile(workbook, fileName);

  if (auditEvent?.action) {
    const payload = {
      action: auditEvent.action,
      entityType: auditEvent.entityType ?? 'reporting',
      details: {
        fileName,
        sheetName,
        rowCount: normalizedRows.length,
        ...(auditEvent.details ?? {}),
      },
    };

    void postJson('/audit-events', payload).catch((error) => {
      console.warn('[exportToExcel] Failed to log audit event', error);
    });
  }
}
