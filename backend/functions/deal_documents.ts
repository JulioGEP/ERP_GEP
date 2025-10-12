import { COMMON_HEADERS, errorResponse, successResponse } from "./_shared/response";
import { getPrisma } from "./_shared/prisma";
import { getDeal, listDealFiles } from "./_shared/pipedrive";
import { syncDealDocumentsFromPipedrive } from "./_shared/dealDocumentsSync";

type SupportedRoute = "sync" | "list" | null;

function resolveRoute(path: string | null | undefined): SupportedRoute {
  if (!path) return null;
  const normalized = path.replace(/^\/\.netlify\/functions/, "");
  if (/\/deal_documents\/sync\/?$/i.test(normalized)) return "sync";
  if (/\/deal_documents\/list\/?$/i.test(normalized)) return "list";
  return null;
}

function resolveDealId(value: unknown): { dealIdStr: string; dealIdNum: number } | null {
  if (value === null || value === undefined) return null;
  const str = String(value).trim();
  if (!str.length) return null;
  const num = Number(str);
  if (!Number.isFinite(num)) return null;
  return { dealIdStr: str, dealIdNum: Math.trunc(num) };
}

function resolveOrganizationNameFromDeal(deal: any): string | null {
  if (!deal) return null;
  if (typeof deal?.organization === "object" && deal.organization?.name) {
    return String(deal.organization.name);
  }
  if (typeof deal?.org_id === "object" && deal.org_id?.name) {
    return String(deal.org_id.name);
  }
  if (typeof deal?.org_name === "string" && deal.org_name.trim().length) {
    return deal.org_name.trim();
  }
  return null;
}

export const handler = async (event: any) => {
  try {
    if (event.httpMethod === "OPTIONS") {
      return { statusCode: 204, headers: COMMON_HEADERS, body: "" };
    }

    if (event.httpMethod !== "GET") {
      return errorResponse("METHOD_NOT_ALLOWED", "Método no permitido", 405);
    }

    const route = resolveRoute(event.path);
    if (!route) {
      return errorResponse("NOT_FOUND", "Ruta no soportada", 404);
    }

    const dealIdCandidate =
      event.queryStringParameters?.dealId ?? event.queryStringParameters?.deal_id;
    const resolvedDealId = resolveDealId(dealIdCandidate);
    if (!resolvedDealId) {
      return errorResponse("VALIDATION_ERROR", "dealId inválido", 400);
    }

    const { dealIdStr, dealIdNum } = resolvedDealId;

    if (route === "list") {
      const prisma = getPrisma();
      const documents = await prisma.deal_files.findMany({
        where: { deal_id: dealIdStr },
        orderBy: { created_at: "desc" },
        select: {
          id: true,
          file_name: true,
          file_url: true,
          pipedrive_file_id: true,
        },
      });
      return successResponse({
        documents,
        documents_count: documents.length,
      });
    }

    if (route === "sync") {
      const deal = await getDeal(dealIdNum);
      if (!deal) {
        return errorResponse("NOT_FOUND", "Deal no encontrado en Pipedrive", 404);
      }

      const files = await listDealFiles(dealIdNum).then((result) => (Array.isArray(result) ? result : []));
      const organizationName = resolveOrganizationNameFromDeal(deal);
      const summary = await syncDealDocumentsFromPipedrive({
        deal,
        dealId: dealIdStr,
        files,
        organizationName,
      });

      return successResponse({
        ok: true,
        imported: summary.imported,
        skipped: summary.skipped,
        warnings: summary.warnings,
      });
    }

    return errorResponse("NOT_FOUND", "Ruta no soportada", 404);
  } catch (error: any) {
    const message = error?.message ? String(error.message) : String(error);
    return errorResponse("SYNC_ERROR", message, 500);
  }
};
