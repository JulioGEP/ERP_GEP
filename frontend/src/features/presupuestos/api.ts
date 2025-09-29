export interface ImportDealPayload {
  federalNumber: string;
}

const BASE =
  (typeof import.meta !== "undefined" &&
    (import.meta as any).env?.VITE_API_BASE &&
    String((import.meta as any).env.VITE_API_BASE).trim()) ||
  "/api";

export async function importDeal(payload: ImportDealPayload) {
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
  return (await res.json()) as import("../../types/deal").DealSummary;
}
