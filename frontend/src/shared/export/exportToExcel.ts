import { utils, writeFile } from 'xlsx';
import { postJson } from '../../api/client';

type ExcelCellStyle = {
  font?: {
    bold?: boolean;
    color?: { rgb: string };
  };
  fill?: {
    patternType?: string;
    fgColor?: { rgb: string };
  };
};

type ExportFormattingOptions = {
  currencyColumns?: number[];
  percentColumns?: number[];
  sumColumns?: number[];
  headerStyle?: ExcelCellStyle;
  alternateRowStyles?: [ExcelCellStyle, ExcelCellStyle];
  sumRowStyle?: ExcelCellStyle;
};

type ExportToExcelOptions = {
  rows: ReadonlyArray<ReadonlyArray<string | number | boolean | Date | null | undefined>>;
  fileName: string;
  sheetName?: string;
  formatting?: ExportFormattingOptions;
  auditEvent?: {
    action: string;
    entityType?: string;
    details?: Record<string, unknown>;
  };
};

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const normalized = value.replace(/\./g, '').replace(',', '.').trim();
    const parsed = Number.parseFloat(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function exportToExcel({
  rows,
  fileName,
  sheetName = 'Datos',
  formatting,
  auditEvent,
}: ExportToExcelOptions): void {
  const normalizedRows = rows.map((row) => row.map((cell) => (cell ?? '') as string | number | boolean | Date));
  const hasSumRow = Boolean(formatting?.sumColumns?.length);

  if (hasSumRow) {
    const width = normalizedRows[0]?.length ?? 0;
    const sumRow = Array<string | number>(width).fill('');
    for (const col of formatting?.sumColumns ?? []) {
      let total = 0;
      for (let rowIdx = 1; rowIdx < normalizedRows.length; rowIdx += 1) {
        const numeric = toNumber(normalizedRows[rowIdx]?.[col]);
        if (numeric !== null) total += numeric;
      }
      sumRow[col] = total;
    }
    normalizedRows.push(sumRow);
  }

  const worksheet = utils.aoa_to_sheet(normalizedRows);
  const ref = worksheet['!ref'];
  const range = ref ? utils.decode_range(ref) : null;

  if (range) {
    const currencyFormat = '#,##0.00 [$€-es-ES]';
    const percentFormat = '0.00%';

    const isDataRow = (rowIdx: number): boolean => {
      if (rowIdx === 0) return false;
      if (hasSumRow && rowIdx === range.e.r) return false;
      return true;
    };

    for (let rowIdx = range.s.r; rowIdx <= range.e.r; rowIdx += 1) {
      for (let colIdx = range.s.c; colIdx <= range.e.c; colIdx += 1) {
        const addr = utils.encode_cell({ r: rowIdx, c: colIdx });
        const cell = worksheet[addr];
        if (!cell) continue;

        const numericValue = toNumber(cell.v);
        if (numericValue !== null) {
          if (formatting?.currencyColumns?.includes(colIdx)) {
            cell.t = 'n';
            cell.v = numericValue;
            cell.z = currencyFormat;
          }
          if (formatting?.percentColumns?.includes(colIdx)) {
            cell.t = 'n';
            cell.v = numericValue / 100;
            cell.z = percentFormat;
          }
        }

        if (rowIdx === 0 && formatting?.headerStyle) {
          cell.s = formatting.headerStyle;
        } else if (isDataRow(rowIdx) && formatting?.alternateRowStyles) {
          const styleIndex = (rowIdx - 1) % 2;
          cell.s = formatting.alternateRowStyles[styleIndex];
        } else if (hasSumRow && rowIdx === range.e.r && formatting?.sumRowStyle) {
          cell.s = formatting.sumRowStyle;
        }
      }
    }
  }

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
