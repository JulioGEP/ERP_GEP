/**
 * API del feature Presupuestos.
 * Forzamos base a /.netlify/functions (robusto en producción).
 * Si existe VITE_API_BASE, la respeta (útil en local).
 */
import type { DealSummary } from '../../types/deal';

type Json = any;

const API_BASE: string =
  (import.meta as any)?.env?.VITE_API_BASE?.toString()?.trim() ||
  '/.netlify/functions';

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
  const res = await fetch(`${API_BASE}/deals_import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ federalNumber })
  });

  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // Si upstream devolviera HTML (404), deja un error legible
  }

  if (!res.ok) {
    const reason = (data && (data.error || data.message)) || `HTTP ${res.status}`;
    throw new Error(`${reason} :: ${String(text).slice(0, 800)}`);
  }

  return parseDealSummary(data);
}

/** Compatibilidad con código existente (App.tsx importa importDeal) */
export const importDeal = importPresupuesto;
