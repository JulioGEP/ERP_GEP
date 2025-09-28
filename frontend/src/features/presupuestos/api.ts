// frontend/src/features/presupuestos/api.ts
// Implementación autosuficiente (sin importar ../../lib/http)

type DealSummary = unknown; // Ajusta si ya tienes un tipo definido en tu proyecto

const BASE =
  (typeof import.meta !== "undefined" &&
    (import.meta as any).env?.VITE_API_BASE &&
    String((import.meta as any).env.VITE_API_BASE).trim()) ||
  "/api";

export interface ImportDealPayload {
  federalNumber: string;
}

export async function importDeal(payload: ImportDealPayload): Promise<DealSummary> {
  const res = await fetch(`${BASE}/deals/import`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    credentials: "include",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${res.statusText} :: ${text}`);
  }

  return (await res.json()) as DealSummary;
}
