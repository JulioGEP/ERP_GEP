// backend/functions/deal_notes.ts
import { randomUUID } from "crypto";
import { getPrisma } from "./_shared/prisma";
import { COMMON_HEADERS, errorResponse, successResponse } from "./_shared/response";
import { nowInMadridDate, nowInMadridISO, toMadridISOString } from "./_shared/timezone";

const DEFAULT_AUTHOR = process.env.DEFAULT_NOTE_AUTHOR || "erp_user";

function parsePath(path: string) {
  const p = String(path || "");
  const m = p.match(/\/(?:\.netlify\/functions\/)?deal_notes\/([^/]+)(?:\/([^/]+))?$/i);
  const dealId = m?.[1] ? decodeURIComponent(m[1]) : null;
  const noteId = m?.[2] ? decodeURIComponent(m[2]) : null;
  return { dealId, noteId };
}

function headerValue(event: any, key: string): string | null {
  const headers = event?.headers || {};
  const direct = headers[key];
  if (typeof direct === "string") return direct;
  const lower = headers[key.toLowerCase()];
  return typeof lower === "string" ? lower : null;
}

function mapNoteForResponse(note: any) {
  if (!note) return note;
  return {
    id: note.id,
    deal_id: note.deal_id,
    content: note.content,
    author: note.author,
    created_at: toMadridISOString(note.created_at),
    updated_at: toMadridISOString(note.updated_at),
  };
}

export const handler = async (event: any) => {
  try {
    if (event.httpMethod === "OPTIONS") {
      return { statusCode: 204, headers: COMMON_HEADERS, body: "" };
    }

    const { dealId, noteId } = parsePath(event.path || "");
    if (!dealId) {
      return errorResponse("VALIDATION_ERROR", "deal_id requerido en path", 400);
    }

    const prisma = getPrisma();
    const dealIdStr = String(dealId).trim();
    if (!dealIdStr) {
      return errorResponse("VALIDATION_ERROR", "deal_id inválido", 400);
    }

    const method = event.httpMethod;

    const requestUser =
      headerValue(event, "X-User-Name")?.trim() || headerValue(event, "X-User-Id")?.trim() || null;

    if (method === "POST" && !noteId) {
      if (!event.body) return errorResponse("VALIDATION_ERROR", "Body requerido", 400);
      const { content } = JSON.parse(event.body || "{}");
      const trimmedContent = typeof content === "string" ? content.trim() : "";
      if (!trimmedContent.length) {
        return errorResponse("VALIDATION_ERROR", "content requerido", 400);
      }

      const author = requestUser && requestUser.length ? requestUser : DEFAULT_AUTHOR;
      const now = nowInMadridDate();

      const created = await prisma.deal_notes.create({
        data: {
          id: randomUUID(),
          deal_id: dealIdStr,
          content: trimmedContent,
          author,
          created_at: now,
          updated_at: now,
        },
      });

      return successResponse({ note: mapNoteForResponse(created) }, 201);
    }

    if (method === "PATCH" && noteId) {
      if (!event.body) return errorResponse("VALIDATION_ERROR", "Body requerido", 400);
      const existing = await prisma.deal_notes.findUnique({ where: { id: String(noteId) } });
      if (!existing || existing.deal_id !== dealIdStr) {
        return errorResponse("NOT_FOUND", "Nota no encontrada", 404);
      }

      if (existing.author && requestUser && existing.author !== requestUser) {
        return errorResponse("FORBIDDEN", "No puedes editar esta nota", 403);
      }

      const { content } = JSON.parse(event.body || "{}");
      const trimmedContent = typeof content === "string" ? content.trim() : "";
      if (!trimmedContent.length) {
        return errorResponse("VALIDATION_ERROR", "content requerido", 400);
      }

      const updatedNow = nowInMadridDate();

      const updated = await prisma.deal_notes.update({
        where: { id: String(noteId) },
        data: {
          content: trimmedContent,
          updated_at: updatedNow,
        },
      });

      return successResponse({ note: mapNoteForResponse(updated) });
    }

    if (method === "DELETE" && noteId) {
      const existing = await prisma.deal_notes.findUnique({ where: { id: String(noteId) } });
      if (!existing || existing.deal_id !== dealIdStr) {
        return errorResponse("NOT_FOUND", "Nota no encontrada", 404);
      }

      if (existing.author && requestUser && existing.author !== requestUser) {
        return errorResponse("FORBIDDEN", "No puedes eliminar esta nota", 403);
      }

      await prisma.deal_notes.delete({ where: { id: String(noteId) } });

      return successResponse({ deleted: true });
    }

    return errorResponse("NOT_IMPLEMENTED", "Ruta o método no soportado", 404);
  } catch (e: any) {
    const message = e?.message || "Unexpected";
    return errorResponse("UNEXPECTED", message, 500);
  }
};
