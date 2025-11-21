import { Buffer } from 'node:buffer';

import { PrismaClient } from '@prisma/client';

import { getPrisma } from './_shared/prisma';
import { errorResponse, preflightResponse, successResponse } from './_shared/response';

const CUSTOM_TEMPLATE_PREFIX = 'custom-';
const DEFAULT_TEMPLATE_PREFIX = 'default-';

type TrainingTemplate = {
  id: string;
  name: string;
  title: string;
  duration: string;
  theory: string[];
  practice: string[];
};

type TemplatePayload = {
  id?: unknown;
  name?: unknown;
  title?: unknown;
  duration?: unknown;
  theory?: unknown;
  practice?: unknown;
  mode?: unknown;
};

type PlantillaRecord = {
  id: string;
  name: string;
  title: string;
  slug: string;
  puntos: unknown;
};

type PuntosPayload = {
  duration?: unknown;
  duracion?: unknown;
  theory?: unknown;
  teorica?: unknown;
  practice?: unknown;
  practica?: unknown;
};

function normalise(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function toDisplayString(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value).trim();
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => {
      if (entry === null || entry === undefined) {
        return '';
      }
      return String(entry).trim();
    })
    .filter((entry) => entry.length > 0);
}

function parsePuntos(puntos: unknown): { duration: string; theory: string[]; practice: string[] } {
  if (!puntos || typeof puntos !== 'object') {
    return { duration: '', theory: [], practice: [] };
  }

  const data = puntos as PuntosPayload;
  const duration = toDisplayString(data.duration ?? data.duracion);
  const theory = toStringArray((data.theory ?? data.teorica) as unknown);
  const practice = toStringArray((data.practice ?? data.practica) as unknown);

  return { duration, theory, practice };
}

function toTrainingTemplate(record: PlantillaRecord): TrainingTemplate {
  const { duration, theory, practice } = parsePuntos(record.puntos);
  return {
    id: record.slug,
    name: record.name,
    title: record.title,
    duration,
    theory,
    practice,
  };
}

function buildPuntos(duration: string, theory: string[], practice: string[]): Record<string, unknown> {
  const puntos: Record<string, unknown> = {
    theory,
    practice,
  };

  if (duration) {
    puntos.duration = duration;
  }

  return puntos;
}

function isUuid(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length !== 36) {
    return false;
  }
  return /^[0-9a-fA-F-]{36}$/.test(trimmed);
}

async function findTemplateByIdentifier(prisma: PrismaClient, identifier: string): Promise<PlantillaRecord | null> {
  const trimmed = toDisplayString(identifier);
  if (!trimmed) {
    return null;
  }

  const candidates = Array.from(new Set([trimmed, trimmed.toLowerCase()].filter((value) => value.length > 0)));
  for (const candidate of candidates) {
    const bySlug = await prisma.plantillas.findUnique({
      where: { slug: candidate },
      select: { id: true, name: true, title: true, slug: true, puntos: true },
    });
    if (bySlug) {
      return bySlug;
    }
  }

  if (!isUuid(trimmed)) {
    return null;
  }

  try {
    const byId = await prisma.plantillas.findUnique({
      where: { id: trimmed },
      select: { id: true, name: true, title: true, slug: true, puntos: true },
    });
    return byId;
  } catch {
    return null;
  }
}

function resolveSlugCandidate(providedId: string, fallback: string): string {
  const trimmed = toDisplayString(providedId);
  const fallbackSource = fallback || trimmed || 'Plantilla';
  const base = normalise(trimmed || fallbackSource).replace(/\s+/g, '-') || 'plantilla';
  const lowerTrimmed = trimmed.toLowerCase();
  const hasKnownPrefix =
    lowerTrimmed.startsWith(CUSTOM_TEMPLATE_PREFIX) || lowerTrimmed.startsWith(DEFAULT_TEMPLATE_PREFIX);
  if (hasKnownPrefix) {
    return base;
  }
  return `${CUSTOM_TEMPLATE_PREFIX}${base}`;
}

async function ensureUniqueSlug(
  prisma: PrismaClient,
  baseSlug: string,
  options: { excludeId?: string } = {},
): Promise<string> {
  let candidate = baseSlug;
  let index = 2;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const existing = await prisma.plantillas.findFirst({
      where: {
        slug: candidate,
        ...(options.excludeId ? { NOT: { id: options.excludeId } } : {}),
      },
      select: { id: true },
    });
    if (!existing) {
      return candidate;
    }
    candidate = `${baseSlug}-${index}`;
    index += 1;
  }
}

function parsePayload(body: unknown, isBase64Encoded: unknown): TemplatePayload | null {
  if (body === null || body === undefined) {
    return {};
  }

  if (typeof body === 'object' && !Buffer.isBuffer(body)) {
    return body as TemplatePayload;
  }

  if (typeof body !== 'string') {
    return null;
  }

  const rawText = Boolean(isBase64Encoded) ? Buffer.from(body, 'base64').toString('utf8') : body;
  try {
    return JSON.parse(rawText || '{}') as TemplatePayload;
  } catch {
    return null;
  }
}

async function handleListTemplates() {
  const prisma = getPrisma();
  const templates: PlantillaRecord[] = await prisma.plantillas.findMany({
    orderBy: { created_at: 'asc' },
    select: { id: true, name: true, title: true, slug: true, puntos: true },
  });

  return successResponse({ templates: templates.map((record) => toTrainingTemplate(record)) });
}

async function handleSaveTemplate(event: any) {
  const payload = parsePayload(event.body, event.isBase64Encoded);
  if (!payload) {
    return errorResponse('VALIDATION_ERROR', 'Cuerpo de la petición no válido.', 400);
  }

  const name = toDisplayString(payload.name);
  const title = toDisplayString(payload.title) || name;
  if (!name) {
    return errorResponse('VALIDATION_ERROR', 'El nombre de la formación es obligatorio.', 400);
  }

  const duration = toDisplayString(payload.duration);
  const theory = toStringArray(payload.theory);
  const practice = toStringArray(payload.practice);
  const mode = toDisplayString(payload.mode).toLowerCase();
  const providedId = toDisplayString(payload.id);

  const prisma = getPrisma();
  const existing = providedId ? await findTemplateByIdentifier(prisma, providedId) : null;

  if (existing) {
    const duplicateName = await prisma.plantillas.findFirst({
      where: {
        name: { equals: name, mode: 'insensitive' },
        NOT: { id: existing.id },
      },
      select: { id: true },
    });
    if (duplicateName) {
      return errorResponse('VALIDATION_ERROR', 'Ya existe una plantilla con ese nombre.', 400);
    }

    const updated = await prisma.plantillas.update({
      where: { id: existing.id },
      data: {
        name,
        title,
        puntos: buildPuntos(duration, theory, practice) as any,
      },
      select: { id: true, name: true, title: true, slug: true, puntos: true },
    });

    return successResponse({ template: toTrainingTemplate(updated) });
  }

  if (mode === 'update' && providedId) {
    return errorResponse('NOT_FOUND', 'Plantilla no encontrada.', 404);
  }

  const duplicateName = await prisma.plantillas.findFirst({
    where: { name: { equals: name, mode: 'insensitive' } },
    select: { id: true },
  });
  if (duplicateName) {
    return errorResponse('VALIDATION_ERROR', 'Ya existe una plantilla con ese nombre.', 400);
  }

  const slugBase = resolveSlugCandidate(providedId, title || name);
  const slug = await ensureUniqueSlug(prisma, slugBase);

  const created = await prisma.plantillas.create({
    data: {
      name,
      title,
      slug,
      puntos: buildPuntos(duration, theory, practice) as any,
    },
    select: { id: true, name: true, title: true, slug: true, puntos: true },
  });

  return successResponse({ template: toTrainingTemplate(created) }, 201);
}

async function handleDeleteTemplate(event: any) {
  const idFromQuery = toDisplayString(event.queryStringParameters?.id);
  let identifier = idFromQuery;
  if (!identifier && event.body) {
    const parsed = parsePayload(event.body, event.isBase64Encoded);
    if (parsed) {
      identifier = toDisplayString((parsed as { id?: unknown }).id);
    }
  }

  if (!identifier) {
    return errorResponse('VALIDATION_ERROR', 'Identificador de plantilla no válido.', 400);
  }

  const prisma = getPrisma();
  const existing = await findTemplateByIdentifier(prisma, identifier);
  if (!existing) {
    return errorResponse('NOT_FOUND', 'Plantilla no encontrada.', 404);
  }

  await prisma.plantillas.delete({ where: { id: existing.id } });
  return successResponse({ deleted: true });
}

export const handler = async (event: any) => {
  try {
    if (event.httpMethod === 'OPTIONS') {
      return preflightResponse();
    }

    if (event.httpMethod === 'GET') {
      return await handleListTemplates();
    }

    if (event.httpMethod === 'POST') {
      return await handleSaveTemplate(event);
    }

    if (event.httpMethod === 'DELETE') {
      return await handleDeleteTemplate(event);
    }

    return errorResponse('METHOD_NOT_ALLOWED', 'Método no soportado', 405);
  } catch (error) {
    console.error('[training-templates] handler error', error);
    return errorResponse('UNEXPECTED_ERROR', 'Se ha producido un error inesperado', 500);
  }
};
