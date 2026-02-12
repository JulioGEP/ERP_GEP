// backend/functions/trainer_documents.ts
import { Prisma } from '@prisma/client';
import { getPrisma } from './_shared/prisma';
import {
  COMMON_HEADERS,
  errorResponse,
  preflightResponse,
  successResponse,
} from './_shared/response';
import { nowInMadridDate, toMadridISOString } from './_shared/timezone';
import {
  deleteTrainerDocumentFromGoogleDrive,
  getTrainerFolderWebViewLink,
  uploadTrainerDocumentToGoogleDrive,
} from './_shared/googleDrive';

const ALLOWED_DOCUMENT_TYPES = new Map([
  ['curriculum_vitae', 'Curriculum Vitae'],
  ['personales', 'Personal'],
  ['certificados', 'Certificados'],
  ['gasto', 'Gasto'],
  ['parking_peaje_kilometraje', 'Parking / Peaje / Kilometraje'],
  ['dietas', 'Dietas'],
  ['otros', 'Otros'],
  ['justificante', 'Justificante'],
]);

const MAX_TRAINER_DOCUMENT_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_TRAINER_DOCUMENT_SIZE_LABEL = '10 MB';

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

type ParsedPath = {
  documentId: string | null;
};

type TrainerDocumentRecord = {
  id: string;
  trainer_id: string;
  document_type: string;
  file_name: string;
  original_file_name: string | null;
  mime_type: string | null;
  file_size: number | null;
  drive_file_id: string | null;
  drive_file_name: string | null;
  drive_web_view_link: string | null;
  uploaded_at: Date | string | null;
  created_at: Date | string | null;
  updated_at: Date | string | null;
};

function parsePath(path: string | undefined | null): ParsedPath {
  const normalized = String(path || '');
  const trimmed = normalized.replace(/^\/?\.netlify\/functions\//, '/');
  const segments = trimmed.split('/').filter(Boolean);
  if (segments[0] !== 'trainer_documents') {
    return { documentId: null };
  }
  const documentId = segments[1] ? decodeURIComponent(segments[1]) : null;
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

function normalizeIncomingFileName(name: string): string {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  if (!trimmed) return '';
  if (!trimmed.includes('%')) return trimmed;
  try {
    return decodeURIComponent(trimmed);
  } catch {
    return trimmed;
  }
}

function buildStoredFileName(typeLabel: string, baseName: string): string {
  const safeLabel = typeLabel.trim() || 'Documento';
  const name = baseName.trim();
  const prefixedLabel = safeLabel.toLowerCase() === 'gasto' ? `<${safeLabel}>` : safeLabel;

  if (!name) {
    return prefixedLabel;
  }

  const prefixesToKeep = [
    `${prefixedLabel} - `,
    `${safeLabel} - `,
  ];

  if (prefixesToKeep.some((prefix) => name.toLowerCase().startsWith(prefix.toLowerCase()))) {
    return name;
  }

  return `${prefixedLabel} - ${name}`;
}

function mapTrainerDocument(row: TrainerDocumentRecord) {
  const documentType = toStringOrNull(row.document_type) ?? 'otros';
  const label = ALLOWED_DOCUMENT_TYPES.get(documentType) ?? documentType;
  return {
    id: String(row.id ?? ''),
    trainer_id: String(row.trainer_id ?? ''),
    document_type: documentType,
    document_type_label: label,
    file_name: toStringOrNull(row.file_name),
    original_file_name: toStringOrNull(row.original_file_name),
    mime_type: toStringOrNull(row.mime_type),
    file_size: typeof row.file_size === 'number' ? row.file_size : null,
    drive_file_id: toStringOrNull(row.drive_file_id),
    drive_file_name: toStringOrNull(row.drive_file_name),
    drive_web_view_link: toStringOrNull(row.drive_web_view_link),
    uploaded_at: row.uploaded_at ? toMadridISOString(row.uploaded_at) : null,
    created_at: row.created_at ? toMadridISOString(row.created_at) : null,
    updated_at: row.updated_at ? toMadridISOString(row.updated_at) : null,
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
    return { expense: null, error: errorResponse('VALIDATION_ERROR', 'El importe del gasto no es válido', 400) };
  }

  if (!rawDate) {
    return { expense: null, error: errorResponse('VALIDATION_ERROR', 'La fecha del gasto es obligatoria', 400) };
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
    return { expense: null, error: errorResponse('VALIDATION_ERROR', 'La fecha del gasto no es válida', 400) };
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
  } as Prisma.office_payrollsUncheckedCreateInput;
  await prisma.office_payrolls.create({
    data: createData,
  });
}

function parseDocumentType(value: unknown) {
  const key = toStringOrNull(value)?.toLowerCase();
  if (!key) {
    return { error: errorResponse('VALIDATION_ERROR', 'El tipo de documento es obligatorio', 400) };
  }
  const label = ALLOWED_DOCUMENT_TYPES.get(key);
  if (!label) {
    return { error: errorResponse('VALIDATION_ERROR', 'Tipo de documento no válido', 400) };
  }
  return { key, label };
}

function toBufferFromBase64(contentBase64: string): Buffer {
  return Buffer.from(String(contentBase64), 'base64');
}

export const handler = async (event: any) => {
  try {
    if (event.httpMethod === 'OPTIONS') {
      return preflightResponse();
    }

    const prisma = getPrisma();
    const method = event.httpMethod;
    const { documentId } = parsePath(event.path);

    if (method === 'GET') {
      const params = event.queryStringParameters || {};
      const trainerId = toStringOrNull(params.trainerId ?? params.trainer_id);
      if (!trainerId) {
        return errorResponse('VALIDATION_ERROR', 'trainerId es obligatorio', 400);
      }

      const trainer = await prisma.trainers.findUnique({ where: { trainer_id: trainerId } });
      if (!trainer) {
        return errorResponse('NOT_FOUND', 'Formador no encontrado', 404);
      }

      const documents = await prisma.trainer_documents.findMany({
        where: { trainer_id: trainerId },
        orderBy: { uploaded_at: 'desc' },
      });

      let folderLink: string | null = null;
      try {
        folderLink = await getTrainerFolderWebViewLink({ trainer, createIfMissing: false });
      } catch (err) {
        console.warn('[trainer-documents] No se pudo obtener enlace de carpeta', {
          trainerId,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      return successResponse({
        documents: documents.map(mapTrainerDocument),
        drive_folder_web_view_link: folderLink,
      });
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

      const trainerId = toStringOrNull(payload?.trainer_id ?? payload?.trainerId);
      if (!trainerId) {
        return errorResponse('VALIDATION_ERROR', 'trainer_id es obligatorio', 400);
      }

      const documentTypeResult = parseDocumentType(payload?.document_type ?? payload?.documentType);
      if ('error' in documentTypeResult) {
        return documentTypeResult.error;
      }

      const expenseColumn = resolveExpenseColumn(documentTypeResult.key);
      const payrollExpenseResult = expenseColumn
        ? parsePayrollExpense(payload?.payrollExpense ?? payload?.payroll_expense, expenseColumn)
        : null;

      const trainer = await prisma.trainers.findUnique({ where: { trainer_id: trainerId } });
      if (!trainer) {
        return errorResponse('NOT_FOUND', 'Formador no encontrado', 404);
      }

      if (payrollExpenseResult?.error) {
        return payrollExpenseResult.error;
      }

      if (payrollExpenseResult?.expense && (!trainer.user_id || !trainer.contrato_fijo)) {
        return errorResponse(
          'VALIDATION_ERROR',
          'No se pudo vincular el gasto con la nómina del formador.',
          400,
        );
      }

      const fileInput = typeof payload?.file === 'object' && payload.file ? payload.file : payload;

      const rawFileName =
        toStringOrNull(
          fileInput?.fileName ??
            fileInput?.name ??
            payload?.fileName ??
            payload?.name,
        ) ?? '';
      const mimeType =
        toStringOrNull(
          fileInput?.mimeType ?? payload?.mimeType ?? payload?.contentType,
        ) ?? 'application/octet-stream';
      const contentBase64 =
        toStringOrNull(
          fileInput?.contentBase64 ??
            fileInput?.base64 ??
            fileInput?.data ??
            payload?.contentBase64 ??
            payload?.fileContentBase64 ??
            payload?.fileBase64,
        ) ?? null;

      const declaredSize =
        typeof fileInput?.fileSize === 'number'
          ? fileInput.fileSize
          : Number(fileInput?.fileSize ?? payload?.fileSize);

      if (!contentBase64) {
        return errorResponse(
          'VALIDATION_ERROR',
          'Se requiere el contenido del archivo en base64 (contentBase64)',
          400,
        );
      }

      let buffer: Buffer;
      try {
        buffer = toBufferFromBase64(contentBase64);
      } catch {
        return errorResponse('VALIDATION_ERROR', 'contentBase64 no es válido', 400);
      }

      if (!buffer.length) {
        return errorResponse('VALIDATION_ERROR', 'El archivo recibido está vacío', 400);
      }

      if (buffer.length > MAX_TRAINER_DOCUMENT_SIZE_BYTES) {
        return errorResponse(
          'PAYLOAD_TOO_LARGE',
          `El archivo supera el tamaño máximo permitido de ${MAX_TRAINER_DOCUMENT_SIZE_LABEL}`,
          413,
        );
      }

      if (Number.isFinite(declaredSize) && declaredSize > 0) {
        const delta = Math.abs(buffer.length - Number(declaredSize));
        if (delta > Math.max(512, Number(declaredSize) * 0.05)) {
          return errorResponse(
            'VALIDATION_ERROR',
            'El tamaño del archivo no coincide con el contenido recibido',
            400,
          );
        }
      }

      const originalFileName = normalizeIncomingFileName(rawFileName) || 'Documento';
      const finalFileName = buildStoredFileName(documentTypeResult.label, originalFileName);

      const uploadResult = await uploadTrainerDocumentToGoogleDrive({
        trainer,
        documentTypeLabel: documentTypeResult.label,
        fileName: finalFileName,
        mimeType,
        data: buffer,
      });

      const created = await prisma.$transaction(async (tx) => {
        const document = await tx.trainer_documents.create({
          data: {
            trainer_id: trainerId,
            document_type: documentTypeResult.key,
            file_name: finalFileName,
            original_file_name: originalFileName,
            mime_type: mimeType,
            file_size: buffer.length,
            drive_file_id: uploadResult.driveFileId,
            drive_file_name: uploadResult.driveFileName,
            drive_web_view_link: uploadResult.driveWebViewLink,
            uploaded_at: nowInMadridDate(),
          },
        });

        if (payrollExpenseResult?.expense && trainer.user_id && trainer.contrato_fijo) {
          await persistPayrollExpense(tx, trainer.user_id, payrollExpenseResult.expense);
        }

        return document;
      });

      return successResponse({
        document: mapTrainerDocument(created as TrainerDocumentRecord),
        drive_folder_web_view_link: uploadResult.trainerFolderWebViewLink,
      }, 201);
    }

    if (method === 'DELETE') {
      if (!documentId) {
        return errorResponse('VALIDATION_ERROR', 'documentId requerido en la ruta', 400);
      }

      const existing = await prisma.trainer_documents.findUnique({ where: { id: documentId } });
      if (!existing) {
        return errorResponse('NOT_FOUND', 'Documento no encontrado', 404);
      }

      const trainer = await prisma.trainers.findUnique({ where: { trainer_id: existing.trainer_id } });
      if (!trainer) {
        return errorResponse('NOT_FOUND', 'Formador no encontrado', 404);
      }

      let driveDeleted = false;
      try {
        const driveResult = await deleteTrainerDocumentFromGoogleDrive({
          trainer,
          driveFileId: existing.drive_file_id,
          driveFileName: existing.drive_file_name,
          driveWebViewLink: existing.drive_web_view_link,
        });
        driveDeleted = driveResult.fileDeleted;
      } catch (err) {
        console.warn('[trainer-documents] No se pudo eliminar documento en Drive', {
          trainerId: existing.trainer_id,
          documentId,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      await prisma.trainer_documents.delete({ where: { id: documentId } });

      return successResponse({
        deleted: true,
        documentId,
        drive_deleted: driveDeleted,
      });
    }

    return {
      statusCode: 405,
      headers: COMMON_HEADERS,
      body: JSON.stringify({
        ok: false,
        error_code: 'METHOD_NOT_ALLOWED',
        message: 'Método no soportado',
      }),
    };
  } catch (error) {
    console.error('[trainer-documents] Error inesperado', error);
    return errorResponse('INTERNAL_ERROR', 'Se produjo un error inesperado', 500);
  }
};
