/**
 * API del feature Presupuestos
 * - Siempre usa /.netlify/functions como base por robustez en producción
 * - Si existe VITE_API_BASE la respeta (permite entorno local)
 */
type ImportDealPayload = { federalNumber: string };
type Json = any;

const API_BASE: string =
  (import.meta as any)?.env?.VITE_API_BASE?.toString()?.trim() ||
  "/.netlify/functions";

/** POST -> deals_import (antes: /api/deals/import via redirect) */
export async function importPresupuesto(federalNumber: string): Promise<Json> {
  const url = `${API_BASE}/deals_import`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ federalNumber } as ImportDealPayload),
  });

  const text = await res.text();
  try {
    const data = text ? JSON.parse(text) : {};
    if (!res.ok) {
      const msg = data?.error || `HTTP ${res.status}`;
      throw new Error(`${msg} :: ${text.slice(0, 800)}`);
    }
    return data;
  } catch (e) {
    // Si Pipedrive devolviese HTML o JSON inválido, mostramos snippet útil
    throw new Error(
      `HTTP ${res.status} :: ${text.slice(0, 800)}`
    );
  }
}
