/**
 * API del feature Presupuestos.
 * Usa VITE_API_BASE si está definido. En caso contrario intenta primero el backend
 * propio (`/api`) y, como compatibilidad, las funciones de Netlify (`/.netlify/functions`).
 */
import type { DealSummary } from '../../types/deal';

type Json = any;

type Endpoint = {
  base: string;
  path: string;
};

const rawApiBase = (import.meta as any)?.env?.VITE_API_BASE?.toString()?.trim() || '';

function normalizeBase(base: string): string {
  if (!base) return '';
  return base.endsWith('/') ? base.replace(/\/+$/, '') : base;
}

function buildEndpoints(): Endpoint[] {
  const base = normalizeBase(rawApiBase);

  if (base) {
    const isNetlifyFunctions = base.includes('.netlify/functions');
    return [
      {
        base,
        path: isNetlifyFunctions ? '/deals_import' : '/deals/import'
      }
    ];
  }

  return [
    { base: '/api', path: '/deals/import' },
    { base: '/.netlify/functions', path: '/deals_import' }
  ];
}

const ENDPOINTS: Endpoint[] = buildEndpoints();

function joinUrl(base: string, path: string): string {
  const normalizedBase = normalizeBase(base) || '';
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
}

function parseDealSummary(data: Json): DealSummary {
  const deal = data?.deal ?? data;
  if (!deal || typeof deal !== 'object') {
    throw new Error('La respuesta de la API no contiene información del presupuesto.');
  }

  const dealId = Number(deal.dealId ?? deal.id);
  if (!Number.isFinite(dealId)) {
    throw new Error('La API no ha devuelto un identificador válido del presupuesto.');
  }

  return {
    dealId,
    title: typeof deal.title === 'string' ? deal.title : `Presupuesto ${dealId}`,
    clientName:
      typeof deal.clientName === 'string'
        ? deal.clientName
        : typeof deal.client_name === 'string'
          ? deal.client_name
          : 'Cliente sin nombre',
    sede:
      typeof deal.sede === 'string'
        ? deal.sede
        : typeof deal.branch === 'string'
          ? deal.branch
          : '—',
    trainingNames: Array.isArray(deal.trainingNames)
      ? deal.trainingNames
      : Array.isArray(deal.training_names)
        ? deal.training_names
        : undefined,
    trainingType:
      typeof deal.trainingType === 'string'
        ? deal.trainingType
        : typeof deal.training_type === 'string'
          ? deal.training_type
          : undefined,
    hours:
      deal.hours != null
        ? Number.isFinite(Number(deal.hours))
          ? Number(deal.hours)
          : null
        : deal.hours,
    caes:
      typeof deal.caes === 'string'
        ? deal.caes
        : typeof deal.caes_code === 'string'
          ? deal.caes_code
          : undefined,
    fundae:
      typeof deal.fundae === 'string'
        ? deal.fundae
        : typeof deal.fundae_code === 'string'
          ? deal.fundae_code
          : undefined,
    hotelNight:
      typeof deal.hotelNight === 'string'
        ? deal.hotelNight
        : typeof deal.hotel_night === 'string'
          ? deal.hotel_night
          : undefined,
    notes: Array.isArray(deal.notes) ? deal.notes : undefined,
    documents: Array.isArray(deal.documents) ? deal.documents : undefined
  };
}

/** POST -> deals_import */
export async function importPresupuesto(federalNumber: string): Promise<DealSummary> {
  const attempts: Array<{ url: string; error: string }> = [];

  for (const endpoint of ENDPOINTS) {
    const url = joinUrl(endpoint.base, endpoint.path);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ federalNumber })
      });

      const text = await res.text();
      let data: any = null;

      if (text) {
        try {
          data = JSON.parse(text);
        } catch (jsonError) {
          throw new Error(`Respuesta no es JSON: ${(jsonError as Error).message}`);
        }
      }

      if (!res.ok) {
        const reason = (data && (data.error || data.message)) || `HTTP ${res.status}`;
        throw new Error(`${reason} :: ${String(text).slice(0, 800)}`);
      }

      return parseDealSummary(data);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      attempts.push({ url, error: message });
    }
  }

  const detail = attempts
    .map((attempt) => `${attempt.url} → ${attempt.error}`)
    .join(' | ');

  throw new Error(`No se pudo importar el presupuesto. Intentos fallidos: ${detail}`);
}

/** Compatibilidad con código existente (App.tsx importa importDeal) */
export const importDeal = importPresupuesto;
