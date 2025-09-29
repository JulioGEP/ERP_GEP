/**
 * API del feature Presupuestos
 * - Usa /.netlify/functions como base (robusto en producción)
 * - Si existe VITE_API_BASE, la respeta (útil en local)
 */
type ImportDealPayload = { federalNumber: string };
type Json = any;

const API_BASE: string =
  (import.meta as any)?.env?.VITE_API_BASE?.toString()?.trim() ||
  "/.netlify/functions";

/** POST -> deals_import (antes dependía de /api/deals/import via redirects) */
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
  } catch {
    // Si la respuesta fuera HTML (404 de Netlify) lo mostramos legible
    throw new Error(`HTTP ${res.status} :: ${text.slice(0, 800)}`);
  }
}
