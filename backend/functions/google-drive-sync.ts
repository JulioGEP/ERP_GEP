// backend/functions/google-drive-sync.ts
import { COMMON_HEADERS, errorResponse, successResponse } from "./_shared/response";
import { importGoogleDriveDocumentsIntoErp } from "./_shared/googleDrive";

export const handler = async (event: any) => {
  try {
    if (event.httpMethod === "OPTIONS") {
      return { statusCode: 204, headers: COMMON_HEADERS, body: "" };
    }

    if (event.httpMethod !== "POST") {
      return errorResponse("NOT_IMPLEMENTED", "Método no soportado", 405);
    }

    const summary = await importGoogleDriveDocumentsIntoErp();
    return successResponse({ ok: true, summary });
  } catch (err: any) {
    const message = err?.message || "Error inesperado";
    console.error("[google-drive-sync] Error en sincronización entrante", err);
    return errorResponse("SYNC_ERROR", message, 500);
  }
};
