import { utils, writeFile } from 'xlsx';

type ExportToExcelOptions = {
  rows: ReadonlyArray<ReadonlyArray<string | number | boolean | Date | null | undefined>>;
  fileName: string;
  sheetName?: string;
};

export function exportToExcel({ rows, fileName, sheetName = 'Datos' }: ExportToExcelOptions): void {
  const normalizedRows = rows.map((row) => row.map((cell) => (cell ?? '') as string | number | boolean | Date));
  const worksheet = utils.aoa_to_sheet(normalizedRows);
  const workbook = utils.book_new();
  utils.book_append_sheet(workbook, worksheet, sheetName);
  writeFile(workbook, fileName);
}
