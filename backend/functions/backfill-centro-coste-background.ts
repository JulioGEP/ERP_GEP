// Función de backfill ONE-SHOT para rellenar centro_coste en deals existentes.
// Uso: POST /api/backfill-centro-coste con header x-webhook-token: <PIPEDRIVE_WEBHOOK_TOKEN>
// ELIMINAR este archivo una vez ejecutado correctamente.

import type { BackgroundHandler } from "@netlify/functions";
import { getDeal, getDealFields, findFieldDef, optionLabelOf } from "./_shared/pipedrive";
import { getPrisma } from "./_shared/prisma";

const KEY_CENTRO_COSTE = "21e21e35f209ba485a2e8a209e35eda396875d11";
const EXPECTED_TOKEN = process.env.PIPEDRIVE_WEBHOOK_TOKEN;

// 5 deals en paralelo, pausa de 625ms entre lotes → ~8 llamadas/s, bien bajo el límite de Pipedrive
const CONCURRENCY = 5;
const BATCH_DELAY_MS = 625;

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export const handler: BackgroundHandler = async (event) => {
  // — Auth —
  const token =
    event.headers["x-webhook-token"] ??
    event.headers["authorization"]?.replace(/^Bearer\s+/i, "");

  if (!EXPECTED_TOKEN || token !== EXPECTED_TOKEN) {
    console.error("[backfill-centro-coste] Token inválido, abortando.");
    return;
  }

  console.log("[backfill-centro-coste] Iniciando...");
  const prisma = getPrisma();

  // Obtener todos los deal_id de la BD
  const rows = await prisma.deals.findMany({ select: { deal_id: true } });
  const total = rows.length;
  console.log(`[backfill-centro-coste] Deals a procesar: ${total}`);

  // Obtener definición de campos de Pipedrive (una sola vez)
  const dealFields = await getDealFields();
  const fCentroCoste = findFieldDef(dealFields, KEY_CENTRO_COSTE);

  let updated = 0;
  let nulled = 0;
  let errors = 0;

  // Procesar en lotes de CONCURRENCY
  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    const batch = rows.slice(i, i + CONCURRENCY);

    await Promise.all(
      batch.map(async ({ deal_id }) => {
        try {
          const dealData = await getDeal(deal_id);

          const centroCoste = fCentroCoste
            ? (optionLabelOf(fCentroCoste, dealData?.[fCentroCoste.key]) ?? null)
            : dealData?.[KEY_CENTRO_COSTE]
              ? String(dealData[KEY_CENTRO_COSTE]).trim() || null
              : null;

          await prisma.deals.update({
            where: { deal_id },
            data: { centro_coste: centroCoste },
          });

          if (centroCoste) updated++;
          else nulled++;
        } catch (e) {
          console.error(`[backfill-centro-coste] Error en deal ${deal_id}:`, e);
          errors++;
        }
      }),
    );

    const done = Math.min(i + CONCURRENCY, total);
    console.log(
      `[backfill-centro-coste] ${done}/${total} — ✓ ${updated} con valor, — ${nulled} sin valor, ✗ ${errors} errores`,
    );

    if (i + CONCURRENCY < rows.length) {
      await sleep(BATCH_DELAY_MS);
    }
  }

  console.log(
    `[backfill-centro-coste] COMPLETADO. ${updated} actualizados con valor, ${nulled} sin valor (null), ${errors} errores.`,
  );
};
