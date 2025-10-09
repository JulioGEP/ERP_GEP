// backend/functions/_shared/mappers.ts
// Mapeos y upserts a BD desde objetos de Pipedrive (deal + org + person + productos + notas + ficheros)

import { getPrisma } from "./prisma";
import {
  getDealFields,
  optionLabelOf,
  findFieldDef,
  getPipelines,
  getProductFields, // seguimos consultando definiciones por si existe horas en la línea del deal
  getProductCached,
} from "./pipedrive";

/* ========= Claves de campos custom (según Pipedrive) =========
   Usa las KEYS REALES de tu instancia, no el nombre visible del campo. */
const KEY_TRAINING_ADDRESS_BASE = "8b2a7570f5ba8aa4754f061cd9dc92fd778376a7"; // base, sin sufijo
const KEY_SEDE   = "676d6bd51e52999c582c01f67c99a35ed30bf6ae";
const KEY_CAES   = "e1971bf3a21d48737b682bf8d864ddc5eb15a351";
const KEY_FUNDAE = "245d60d4d18aec40ba888998ef92e5d00e494583";
const KEY_HOTEL  = "c3a6daf8eb5b4e59c3c07cda8e01f43439101269";
const KEY_TRANSPORTE = "30dccde5faa7c09a3b380f8597d4f9acfe403877";
const KEY_PO         = "9cf8ccb7ef293494974f98ddbc72ec726486310e";

// HORAS en la **línea del deal** (si existe ese custom en tu instancia)
const KEY_PRODUCT_HOURS_IN_LINE = "38f11c8876ecde803a027fbf3c9041fda2ae7eb7";

// HASH reales de catálogo (opción única/type y hours)
const KEY_PRODUCT_TYPE_HASH  = "5bad94030bb7917c186f3238fb2cd8f7a91cf30b";
const KEY_PRODUCT_HOURS_HASH = "38f11c8876ecde803a027fbf3c9041fda2ae7eb7";

/* ---------------- Helpers ---------------- */
function toInt(val: any, def = 0): number {
  if (val === null || val === undefined || val === "") return def;
  const n = Number(val);
  return Number.isFinite(n) ? Math.round(n) : def;
}

function toMoney(val: any, def = 0): number {
  if (val === null || val === undefined || val === "") return def;
  const n = Number(typeof val === "string" ? val.replace(",", ".") : val);
  return Number.isFinite(n) ? n : def;
}

function pickFirstEmail(val: any): string | null {
  if (val == null) return null;
  if (typeof val === "string") return val;
  if (Array.isArray(val) && val.length > 0) {
    const first = val.find((e) => e?.primary) ?? val[0];
    return first?.value ?? first?.email ?? null;
  }
  if (typeof val === "object") {
    return (val as any).value ?? (val as any).email ?? null;
  }
  return null;
}

function pickFirstPhone(val: any): string | null {
  if (val == null) return null;
  if (typeof val === "string") return val;
  if (Array.isArray(val) && val.length > 0) {
    const first = val.find((p) => p?.primary) ?? val[0];
    return first?.value ?? first?.phone ?? null;
  }
  if (typeof val === "object") {
    return (val as any).value ?? (val as any).phone ?? null;
  }
  return null;
}

function isLikelyManualId(id?: string | null): boolean {
  return typeof id === "string" && id.includes("-");
}

async function resolvePipelineLabel(
  pipeline_id?: number | string | null
): Promise<string | undefined> {
  if (!pipeline_id && pipeline_id !== 0) return undefined;
  const pipelines = await getPipelines();
  const idNum = typeof pipeline_id === "string" ? Number(pipeline_id) : pipeline_id;
  const match = pipelines?.find((pl: any) => pl.id === idNum);
  return match?.name ?? String(pipeline_id);
}

// HTML -> texto plano (para comments)
function htmlToPlain(input?: string | null): string | null {
  if (!input) return null;
  let s = input.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/div>\s*<div>/gi, "\n");
  s = s.replace(/<div>/gi, "");
  s = s.replace(/<\/div>/gi, "");
  s = s.replace(/<[^>]+>/g, "");
  s = s.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return s || null;
}

/* Dirección: prioriza *_formatted_address; si viene como objeto con formatted_address, úsalo;
   si no, devuelve el valor plano del campo base. */
function resolveAddressFromDeal(deal: any, keyBase: string): string | null {
  if (!deal) return null;
  const formattedKey = `${keyBase}_formatted_address`;
  if (deal[formattedKey]) return String(deal[formattedKey]);
  const raw = deal[keyBase];
  if (raw && typeof raw === "object" && "formatted_address" in raw) {
    return String((raw as any).formatted_address);
  }
  return raw != null ? String(raw) : null;
}

export async function resolveDealCustomLabels(deal: any) {
  const dealFields = await getDealFields();

  const fSede   = findFieldDef(dealFields, KEY_SEDE);
  const fCaes   = findFieldDef(dealFields, KEY_CAES);
  const fFundae = findFieldDef(dealFields, KEY_FUNDAE);
  const fHotel  = findFieldDef(dealFields, KEY_HOTEL);
  const fTransporte = findFieldDef(dealFields, KEY_TRANSPORTE);

  // Dirección (no es options): prioriza *_formatted_address
  const trainingAddress = resolveAddressFromDeal(deal, KEY_TRAINING_ADDRESS_BASE);

  // Opciones únicas: mapea id -> label ("Sí"/"No")
  const sedeLabel   = fSede   ? (optionLabelOf(fSede, deal?.[fSede.key])     ?? null) : null;
  const caesLabel   = fCaes   ? (optionLabelOf(fCaes, deal?.[fCaes.key])     ?? null) : null;
  const fundaeLabel = fFundae ? (optionLabelOf(fFundae, deal?.[fFundae.key]) ?? null) : null;
  const hotelLabel  = fHotel  ? (optionLabelOf(fHotel, deal?.[fHotel.key])   ?? null) : null;
  const transporteLabel = fTransporte
    ? optionLabelOf(fTransporte, deal?.[fTransporte.key]) ?? null
    : null;

  const poValueRaw = deal?.[KEY_PO];
  const poValue =
    poValueRaw === null || poValueRaw === undefined
      ? null
      : String(poValueRaw).trim() || null;

  return {
    trainingAddress,
    sedeLabel,
    caesLabel,
    fundaeLabel,
    hotelLabel,
    transporteLabel,
    poValue,
  };
}

/* ============================================================
 * ===============  MAP & UPSERT DEAL COMPLETO  ===============
 * ============================================================ */

export async function mapAndUpsertDealTree({
  deal,
  org,
  person,
  products,
  notes,
  files,
}: {
  deal: any;
  org: any;
  person?: any;
  products: any[];
  notes: any[];
  files: any[];
}) {
  const prisma = getPrisma();

  // 1) Labels
  const pipelineLabel = await resolvePipelineLabel(deal?.pipeline_id);
  const { trainingAddress, sedeLabel, caesLabel, fundaeLabel, hotelLabel, transporteLabel, poValue } =
    await resolveDealCustomLabels(deal);

  // 2) Organización
  const dbOrg = await prisma.organizations.upsert({
    where: { org_id: String(org?.id ?? "") },
    create: { org_id: String(org?.id ?? ""), name: org?.name ?? "—" },
    update: { name: org?.name ?? "—" },
    select: { org_id: true },
  });

  // 3) Persona (si hay)
  let dbPersonId: string | null = null;
  if (person?.id != null) {
    const email = pickFirstEmail(person.email);
    const phone = pickFirstPhone(person.phone);

    const dbPerson = await prisma.persons.upsert({
      where: { person_id: String(person.id) },
      create: {
        person_id: String(person.id),
        first_name: person.first_name ?? person.name ?? null,
        last_name: person.last_name ?? null,
        email,
        phone,
        org_id: dbOrg.org_id,
      },
      update: {
        first_name: person.first_name ?? person.name ?? null,
        last_name: person.last_name ?? null,
        email,
        phone,
        org_id: dbOrg.org_id,
      },
      select: { person_id: true },
    });
    dbPersonId = dbPerson.person_id;
  }

  // 4) Preservar editables en re-imports
  const current = await prisma.deals.findUnique({
    where: { deal_id: String(deal.id) },
  });

  const keep = <T>(prev: T | null | undefined, incoming: T | null | undefined) =>
    incoming !== null && incoming !== undefined ? incoming : prev ?? null;

  // 5) Upsert deal (sin 'hours' en deals)
  const orgIdForDeal = org?.id != null ? String(org.id) : null;

  const dbDeal = await prisma.deals.upsert({
    where: { deal_id: String(deal.id) },
    create: {
      deal_id: String(deal.id),
      title: deal?.title ?? "—",
      pipeline_id: pipelineLabel ?? null,
      training_address: trainingAddress ?? null,
      sede_label: sedeLabel ?? null,
      caes_label: caesLabel ?? null,
      fundae_label: fundaeLabel ?? null,
      hotel_label: hotelLabel ?? null,
      transporte: transporteLabel ?? null,
      po: poValue ?? null,
      alumnos: 0,
      org_id: orgIdForDeal,
      person_id: dbPersonId,
    },
    update: {
      title: deal?.title ?? "—",
      pipeline_id: pipelineLabel ?? null,
      training_address: keep(current?.training_address, trainingAddress),
      sede_label: keep(current?.sede_label, sedeLabel),
      caes_label: keep(current?.caes_label, caesLabel),
      fundae_label: keep(current?.fundae_label, fundaeLabel),
      hotel_label: keep(current?.hotel_label, hotelLabel),
      transporte: keep(current?.transporte, transporteLabel),
      po: poValue ?? null,
      alumnos: current?.alumnos ?? 0,
      org_id: orgIdForDeal,
      person_id: dbPersonId,
    },
    select: { deal_id: true },
  });

  const dealId: string = dbDeal.deal_id;

  // 6) Productos (reset + insert) — enriquecidos con CATÁLOGO
  const productFields = await getProductFields(); // definiciones para mapear options y hashes
  const fHoursInLine = productFields?.find((f: any) => f.key === KEY_PRODUCT_HOURS_IN_LINE);

  // definiciones para TYPE/HOURS/CATEGORY desde producto embebido o catálogo
  const fTypeDef = productFields?.find((f: any) =>
    [KEY_PRODUCT_TYPE_HASH, "type"].includes(f.key)
  );
  const fHoursDef = productFields?.find((f: any) =>
    [KEY_PRODUCT_HOURS_HASH, "hours"].includes(f.key)
  );
  const fCategoryDef = productFields?.find((f: any) =>
    ["category"].includes(f.key)
  );

  await prisma.deal_products.deleteMany({ where: { deal_id: dealId } });

  for (const p of Array.isArray(products) ? products : []) {
    const baseName = p.name ?? p.product?.name ?? null;
    const baseCode = p.code ?? p.product?.code ?? null;

    // Desde línea del deal:
    const quantity = toInt(p.quantity, 0);
    const price = toMoney(p.item_price, 0);
    const product_comments = htmlToPlain(p.comments ?? null);

    // HORAS en línea (si existiese ese custom en la línea, numérico directo)
    let hours: number | null = null;
  if (fHoursInLine) {
  const raw = p?.[fHoursInLine.key];
  if (raw != null && raw !== "") {
    const n = Number(String(raw).replace(",", ".").trim());
    hours = Number.isFinite(n) ? Math.round(n) : null;
  }
}

    // Enriquecimiento por PRODUCTO EMBEBIDO (include_product_data=1)
    const embedded = p.product ?? {};
    const embeddedCF = embedded.custom_fields ?? {};
    let code: string | null = baseCode ?? (embedded.code ?? null);
    let type: string | null = null;
    let category: string | null = null;

    if (fHoursDef && hours == null) {
      const rawE = embedded[fHoursDef.key] ?? embeddedCF[fHoursDef.key];
      if (rawE != null && rawE !== "") {
        const n = Number(String(rawE).replace(",", ".").trim());
        hours = Number.isFinite(n) ? Math.round(n) : null;
      }
    }
    if (fTypeDef) {
      const rawTypeE = embedded[fTypeDef.key] ?? embeddedCF[fTypeDef.key];
      if (rawTypeE != null) {
        type = optionLabelOf(fTypeDef, rawTypeE) ?? String(rawTypeE);
      }
    }
    if (fCategoryDef) {
      const rawCatE = embedded[fCategoryDef.key] ?? embeddedCF[fCategoryDef.key];
      if (rawCatE != null) {
        category = optionLabelOf(fCategoryDef, rawCatE) ?? String(rawCatE);
      }
    }

    // Fallback al CATÁLOGO (GET /products/{id}) y sus custom_fields
    const productId = p.product_id ?? p.id ?? null;
    if (productId != null) {
      try {
        const catalog = await getProductCached(productId);
        const catCF = catalog?.custom_fields ?? {};

        code = code ?? catalog?.code ?? null;

        if (fHoursDef && hours == null) {
          const rawC = catalog?.[fHoursDef.key] ?? catCF?.[fHoursDef.key];
          if (rawC != null && rawC !== "") {
            const n = Number(String(rawC).replace(",", ".").trim());
            hours = Number.isFinite(n) ? Math.round(n) : null;
          }
        }
        if (!type && fTypeDef) {
          const rawTypeC = catalog?.[fTypeDef.key] ?? catCF?.[fTypeDef.key];
          if (rawTypeC != null) {
            type = optionLabelOf(fTypeDef, rawTypeC) ?? String(rawTypeC);
          }
        }
        if (!category && fCategoryDef) {
          const rawCatC = catalog?.[fCategoryDef.key] ?? catCF?.[fCategoryDef.key];
          if (rawCatC != null) {
            category = optionLabelOf(fCategoryDef, rawCatC) ?? String(rawCatC);
          }
        }
      } catch {
        // no rompemos el import si falla el catálogo
      }
    }

    await prisma.deal_products.create({
      data: {
        id: `${dealId}_${(p.id ?? p.product_id ?? Math.random().toString(36).slice(2)).toString()}`,
        deal_id: dealId,
        name: baseName,
        code,
        quantity,           // entero (NUMERIC(10,0) en DB)
        price,              // decimal(12,2)
        hours,              // NUMERIC(10,0) en DB (o Int según Prisma)
        product_comments,   // texto limpio
        category,           // texto
        type,               // texto (label de opción única)
      },
    });
  }

  // 7) Notas (sin product_id)
  const existingNoteIds = await prisma.deal_notes.findMany({
    where: { deal_id: dealId },
    select: { id: true },
  });
  const preservedNoteIds = existingNoteIds
    .map((n: { id: string | null }) => n.id)
    .filter((id: string | null): id is string => isLikelyManualId(id));

  if (preservedNoteIds.length) {
    await prisma.deal_notes.deleteMany({
      where: { deal_id: dealId, id: { notIn: preservedNoteIds } },
    });
  } else {
    await prisma.deal_notes.deleteMany({ where: { deal_id: dealId } });
  }

  for (const n of (Array.isArray(notes) ? notes : [])) {
    const createdAt = n?.add_time ? new Date(n.add_time) : new Date();
    const updatedAt = n?.update_time ? new Date(n.update_time) : new Date();

    const id = String(n?.id ?? `${dealId}_${Math.random().toString(36).slice(2)}`);

    await prisma.deal_notes.upsert({
      where: { id },
      create: {
        id,
        deal_id: dealId,
        content: n?.content ?? n?.note ?? "",
        author: n?.user?.name ?? n?.author ?? null,
        created_at: createdAt,
        updated_at: updatedAt,
      },
      update: {
        deal_id: dealId,
        content: n?.content ?? n?.note ?? "",
        author: n?.user?.name ?? n?.author ?? null,
        created_at: createdAt,
        updated_at: updatedAt,
      },
    });
  }

  // 8) Ficheros
  const existingDocIds = await prisma.deal_files.findMany({
    where: { deal_id: dealId },
    select: { id: true },
  });
  const preservedDocIds = existingDocIds
    .map((d: { id: string | null }) => d.id)
    .filter((id: string | null): id is string => isLikelyManualId(id));

  if (preservedDocIds.length) {
    await prisma.deal_files.deleteMany({
      where: { deal_id: dealId, id: { notIn: preservedDocIds } },
    });
  } else {
    await prisma.deal_files.deleteMany({ where: { deal_id: dealId } });
  }

  for (const f of Array.isArray(files) ? files : []) {
    const id = String(f.id ?? `${dealId}_${Math.random().toString(36).slice(2)}`);
    await prisma.deal_files.upsert({
      where: { id },
      create: {
        id,
        deal_id: dealId,
        file_name: f.file_name ?? f.name ?? "documento",
        file_url: f.file_url ?? f.url ?? null,
        file_type: f.file_type ?? f.mime_type ?? null,
        ...(f.add_time ? { added_at: new Date(f.add_time) } : {}),
      },
      update: {
        deal_id: dealId,
        file_name: f.file_name ?? f.name ?? "documento",
        file_url: f.file_url ?? f.url ?? null,
        file_type: f.file_type ?? f.mime_type ?? null,
        ...(f.add_time ? { added_at: new Date(f.add_time) } : {}),
      },
    });
  }

  return dealId;
}
