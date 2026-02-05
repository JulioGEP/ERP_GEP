// backend/functions/user_documents.ts
import { Prisma } from '@prisma/client';
import { getPrisma } from './_shared/prisma';
import { COMMON_HEADERS, errorResponse, preflightResponse, successResponse } from './_shared/response';
import {
  deleteUserDocumentFromGoogleDrive,
  uploadUserDocumentToGoogleDrive,
} from './_shared/googleDrive';

const ALLOWED_DOCUMENT_TYPES = new Map([
  ['curriculum_vitae', 'Curriculum Vitae'],
  ['personales', 'Personal'],
  ['certificados', 'Certificados'],
  ['gasto', 'Gasto'],
  ['parking_peaje_kilometraje', 'Parking / Peaje / Kilometraje'],
  ['dietas', 'Dietas'],
  ['otros', 'Otros'],
]);

type PayrollExpenseColumn = 'otros_gastos' | 'kilometrajes' | 'dietas';
type PayrollExtraField =
  | 'dietas'
  | 'kilometrajes'
  | 'pernocta'
  | 'nocturnidad'
  | 'festivo'
  | 'horas_extras'
  | 'otros_gastos';

const PAYROLL_EXTRA_FIELDS: PayrollExtraField[] = [
  'dietas',
  'kilometrajes',
  'pernocta',
  'nocturnidad',
  'festivo',
  'horas_extras',
  'otros_gastos',
];

type PayrollExpense = {
  amount: number;
  year: number;
  month: number;
  column: PayrollExpenseColumn;
};

function parsePath(path: string | undefined | null) {
  const normalized = String(path || '');
  const trimmed = normalized.replace(/^\/?\.netlify\/functions\//, '/');
  const segments = trimmed.split('/').filter(Boolean);
  const documentId = segments[1] && segments[0] === 'user_documents' ? segments[1] : null;
  return { documentId };
}

function toStringOrNull(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text.length ? text : null;
}

function decimalToNumber(value: unknown): number {
  if (value === null || value === undefined) {
    return 0;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (typeof (value as { toNumber?: () => number }).toNumber === 'function') {
    const parsed = (value as { toNumber: () => number }).toNumber();
    return Number.isFinite(parsed) ? parsed : 0;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function resolveDocumentType(value: unknown) {
  const defaultLabel = ALLOWED_DOCUMENT_TYPES.get('otros') ?? 'Otros';
  const key = toStringOrNull(value)?.toLowerCase();
  if (!key) {
    return { key: 'otros', label: defaultLabel };
  }
  const label = ALLOWED_DOCUMENT_TYPES.get(key);
  if (!label) {
    return { key: 'otros', label: defaultLabel };
  }
  return { key, label };
}

function inferDocumentTypeFromName(name: string | null | undefined) {
  const normalizedName = name?.trim().toLowerCase();
  if (!normalizedName) return null;

  for (const [key, label] of ALLOWED_DOCUMENT_TYPES.entries()) {
    const loweredLabel = label.toLowerCase();
    const prefixes = [
      `${loweredLabel} -`,
      `<${loweredLabel}> -`,
      `${loweredLabel}-`,
      `<${loweredLabel}>-`,
    ];

    if (prefixes.some((prefix) => normalizedName.startsWith(prefix))) {
      return { key, label };
    }
  }

  return null;
}

function buildStoredFileName(typeLabel: string, baseName: string): string {
  const safeLabel = typeLabel.trim() || 'Documento';
  const name = baseName.trim();

  if (!name) {
    return safeLabel;
  }

  const normalized = name.toLowerCase();
  const labelPrefixes = [
    `${safeLabel} - `,
    `<${safeLabel}> - `,
    `${safeLabel}-`,
    `<${safeLabel}>-`,
  ].map((prefix) => prefix.toLowerCase());

  const matchedPrefix = labelPrefixes.find((prefix) => normalized.startsWith(prefix));
  const cleanedName = matchedPrefix ? name.slice(matchedPrefix.length).trim() : name;

  if (!cleanedName) {
    return safeLabel;
  }

  return `${safeLabel} - ${cleanedName}`;
}

function mapDocument(row: any) {
  const inferredDocumentType = inferDocumentTypeFromName(row.file_name ?? row.title);
  const resolvedDocumentType = resolveDocumentType(row.document_type);
  const { key: documentType, label: documentTypeLabel } = inferredDocumentType ?? resolvedDocumentType;
  const title = row.title ?? row.file_name;
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    title: title ?? null,
    file_name: row.file_name,
    mime_type: row.mime_type ?? null,
    file_size: row.file_size ?? null,
    drive_folder_id: row.drive_folder_id ?? null,
    drive_web_view_link: row.drive_web_view_link ?? null,
    drive_web_content_link: row.drive_web_content_link ?? null,
    created_at: row.created_at ?? null,
    download_url: `/.netlify/functions/user_documents/${encodeURIComponent(String(row.id))}`,
    document_type: documentType,
    document_type_label: documentTypeLabel,
  };
}

function resolveExpenseColumn(documentType: string | null) {
  switch (documentType) {
    case 'gasto':
      return 'otros_gastos';
    case 'parking_peaje_kilometraje':
      return 'kilometrajes';
    case 'dietas':
      return 'dietas';
    default:
      return null;
  }
}

function parsePayrollExpense(value: any, column: PayrollExpenseColumn) {
  if (!value || typeof value !== 'object') {
    return { expense: null, error: null } as { expense: PayrollExpense | null; error: any };
  }

  const rawDate = toStringOrNull(value.date ?? value.expenseDate);
  const rawAmount = value.amount ?? value.value ?? value.otros_gastos;
  const amount = typeof rawAmount === 'string' ? Number.parseFloat(rawAmount) : Number(rawAmount);

  if (rawDate === null && (rawAmount === undefined || rawAmount === null)) {
    return { expense: null, error: null };
  }

  if (!Number.isFinite(amount) || amount <= 0) {
    return {
      expense: null,
      error: errorResponse('VALIDATION_ERROR', 'El importe del gasto no es válido', 400),
    };
  }

  if (!rawDate) {
    return {
      expense: null,
      error: errorResponse('VALIDATION_ERROR', 'La fecha del gasto es obligatoria', 400),
    };
  }

  const datePart = rawDate.split('T')[0];
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datePart);
  let parsedYear: number | null = null;
  let parsedMonth: number | null = null;

  if (dateMatch) {
    const year = Number(dateMatch[1]);
    const month = Number(dateMatch[2]);
    const day = Number(dateMatch[3]);
    const reconstructed = new Date(Date.UTC(year, month - 1, day));
    if (
      reconstructed.getUTCFullYear() === year &&
      reconstructed.getUTCMonth() === month - 1 &&
      reconstructed.getUTCDate() === day
    ) {
      parsedYear = year;
      parsedMonth = month;
    }
  } else {
    const parsedDate = new Date(rawDate);
    if (!Number.isNaN(parsedDate.getTime())) {
      parsedYear = parsedDate.getUTCFullYear();
      parsedMonth = parsedDate.getUTCMonth() + 1;
    }
  }

  if (!parsedYear || !parsedMonth) {
    return {
      expense: null,
      error: errorResponse('VALIDATION_ERROR', 'La fecha del gasto no es válida', 400),
    };
  }

  return {
    expense: {
      amount: Number(amount.toFixed(2)),
      year: parsedYear,
      month: parsedMonth,
      column,
    },
    error: null,
  };
}

async function persistPayrollExpense(
  prisma: Pick<ReturnType<typeof getPrisma>, 'office_payrolls'>,
  userId: string,
  expense: PayrollExpense,
) {
  const existing = await prisma.office_payrolls.findUnique({
    where: { user_id_year_month: { user_id: userId, year: expense.year, month: expense.month } },
  });

  const column = expense.column;
  const currentAmount = decimalToNumber(existing?.[column as keyof typeof existing] ?? 0);
  const totalAmount = Number((currentAmount + expense.amount).toFixed(2));
  const nextValues = PAYROLL_EXTRA_FIELDS.reduce<Record<PayrollExtraField, number>>((acc, field) => {
    const currentValue = decimalToNumber(existing?.[field as keyof typeof existing] ?? 0);
    acc[field] = field === column ? totalAmount : currentValue;
    return acc;
  }, {} as Record<PayrollExtraField, number>);
  const nextTotalExtras = Number(
    PAYROLL_EXTRA_FIELDS.reduce((acc, field) => acc + nextValues[field], 0).toFixed(2),
  );

  if (existing) {
    const updateData = {
      [column]: new Prisma.Decimal(totalAmount),
      total_extras: new Prisma.Decimal(nextTotalExtras),
    } as Prisma.office_payrollsUpdateInput;
    await prisma.office_payrolls.update({
      where: { user_id_year_month: { user_id: userId, year: expense.year, month: expense.month } },
      data: updateData,
    });
    return;
  }

  const createData = {
    user_id: userId,
    year: expense.year,
    month: expense.month,
    [column]: new Prisma.Decimal(totalAmount),
    total_extras: new Prisma.Decimal(nextTotalExtras),
  } as Prisma.office_payrollsCreateInput;
  await prisma.office_payrolls.create({
    data: createData,
  });
}

export const handler = async (event: any) => {
  if (event.httpMethod === 'OPTIONS') {
    return preflightResponse();
  }

  const prisma = getPrisma();
  const method = event.httpMethod;
  const { documentId } = parsePath(event.path);

  if (method === 'GET' && documentId) {
    const document = await prisma.user_documents.findUnique({ where: { id: documentId } });
    if (!document) {
      return errorResponse('NOT_FOUND', 'Documento no encontrado', 404);
    }

    const headers: Record<string, string> = {
      ...COMMON_HEADERS,
      'Content-Type': document.mime_type || 'application/octet-stream',
      'Content-Disposition': `inline; filename="${document.file_name}"`,
    };
    if (typeof document.file_size === 'number') {
      headers['Content-Length'] = String(document.file_size);
    }

    return {
      statusCode: 200,
      headers,
      isBase64Encoded: true,
      body: document.file_data ? Buffer.from(document.file_data).toString('base64') : '',
    };
  }

  if (method === 'GET') {
    const params = event.queryStringParameters || {};
    const userId = toStringOrNull(params.userId ?? params.user_id);
    if (!userId) {
      return errorResponse('VALIDATION_ERROR', 'userId es obligatorio', 400);
    }

    const documents = await prisma.user_documents.findMany({
      where: { user_id: userId },
      orderBy: { created_at: 'desc' },
    });

    return successResponse({ documents: documents.map(mapDocument) });
  }

  if (method === 'POST') {
    if (!event.body) {
      return errorResponse('VALIDATION_ERROR', 'Body requerido', 400);
    }

    let payload: any;
    try {
      payload = JSON.parse(event.body);
    } catch {
      return errorResponse('VALIDATION_ERROR', 'JSON inválido', 400);
    }

    const userId = toStringOrNull(payload.userId ?? payload.user_id);
    if (!userId) {
      return errorResponse('VALIDATION_ERROR', 'userId es obligatorio', 400);
    }

    const title =
      toStringOrNull(payload.title) || toStringOrNull(payload.fileName ?? payload.file_name);
    const fileName = toStringOrNull(payload.fileName ?? payload.file_name);
    const mimeType = toStringOrNull(payload.mimeType ?? payload.mime_type);
    const fileDataBase64 = toStringOrNull(payload.fileData ?? payload.file_data);
    const documentType = resolveDocumentType(payload.documentType ?? payload.document_type);
    const expenseColumn = resolveExpenseColumn(documentType.key);
    const payrollExpenseResult = expenseColumn
      ? parsePayrollExpense(payload.payrollExpense ?? payload.payroll_expense, expenseColumn)
      : null;

    if (payrollExpenseResult?.error) {
      return payrollExpenseResult.error;
    }

    if (!fileName || !fileDataBase64) {
      return errorResponse('VALIDATION_ERROR', 'fileName y fileData son obligatorios', 400);
    }

    const user = await prisma.users.findUnique({ where: { id: userId } });
    if (!user) {
      return errorResponse('NOT_FOUND', 'Usuario no encontrado', 404);
    }

    const resolvedTitle = title || fileName.replace(/\.[^.]+$/, '') || fileName;
    const finalTitle = buildStoredFileName(documentType.label, resolvedTitle);
    const finalFileName = buildStoredFileName(documentType.label, fileName);

    let buffer: Buffer;
    try {
      buffer = Buffer.from(fileDataBase64, 'base64');
    } catch {
      return errorResponse('VALIDATION_ERROR', 'fileData inválido', 400);
    }

    const driveUpload = await uploadUserDocumentToGoogleDrive({
      user,
      title: finalTitle,
      fileName: finalFileName,
      mimeType,
      data: buffer,
    });

    const created = await prisma.$transaction(async (tx) => {
      const document = await tx.user_documents.create({
        data: {
          user_id: userId,
          title: finalTitle,
          file_name: finalFileName,
          mime_type: mimeType,
          file_size: buffer.byteLength,
          drive_folder_id: driveUpload.destinationFolderId ?? driveUpload.driveFolderId,
          drive_web_view_link: driveUpload.driveWebViewLink,
          drive_web_content_link: driveUpload.driveFolderContentLink,
          file_data: buffer,
          created_at: new Date(),
        },
      });

      if (payrollExpenseResult?.expense) {
        await persistPayrollExpense(tx, userId, payrollExpenseResult.expense);
      }

      return document;
    });

    return successResponse({
      document: mapDocument({ ...created, title: finalTitle, document_type: documentType.key }),
    });
  }

  if (method === 'DELETE' && documentId) {
    const existing = await prisma.user_documents.findUnique({ where: { id: documentId } });
    if (!existing) {
      return errorResponse('NOT_FOUND', 'Documento no encontrado', 404);
    }

    const user = await prisma.users.findUnique({ where: { id: existing.user_id } });

    let driveDeleted = false;
    try {
      const driveResult = await deleteUserDocumentFromGoogleDrive({
        user,
        driveFileName: existing.file_name,
        driveWebViewLink: existing.drive_web_view_link,
        driveWebContentLink: existing.drive_web_content_link,
        driveFolderId: existing.drive_folder_id,
      });
      driveDeleted = driveResult.fileDeleted;
    } catch (err) {
      console.warn('[user-documents] No se pudo eliminar documento en Drive', {
        documentId,
        userId: existing.user_id,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    await prisma.user_documents.delete({ where: { id: documentId } });

    return successResponse({ deleted: true, documentId, drive_deleted: driveDeleted });
  }

  return errorResponse('METHOD_NOT_ALLOWED', 'Método no permitido', 405);
};
