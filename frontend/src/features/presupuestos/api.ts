/**
 * API del feature Presupuestos.
 * Forzamos base a /.netlify/functions (robusto en producción).
 * Si existe VITE_API_BASE, la respeta (útil en local).
 */
type Json = any;

const API_BASE: string =
  (import.meta as any)?.env?.VITE_API_BASE?.toString()?.trim() ||
  "/.netlify/functions";

/** POST -> deals_import */
export async function importPresupuesto(federalNumber: string): Promise<Json> {
  const res = await fetch(`${API_BASE}/deals_import`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ federalNumber }),
  });

  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // Si upstream devolviera HTML (404), deja un error legible
  }

  if (!res.ok) {
    const reason =
      (data && (data.error || data.message)) || `HTTP ${res.status}`;
    throw new Error(`${reason} :: ${String(text).slice(0, 800)}`);
  }

  return data ?? {};
}

/** Compatibilidad con código existente (App.tsx importa importDeal) */
export const importDeal = importPresupuesto;
