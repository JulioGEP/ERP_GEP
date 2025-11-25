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
const KEY_TRANSPORTE    = "30dccde5faa7c09a3b380f8597d4f9acfe403877";
const KEY_PO            = "9cf8ccb7ef293494974f98ddbc72ec726486310e";
const KEY_PROVEEDORES = "76f421f696ee2d38e9b8f2f5d708a3dfada6dd26";
const KEY_OBSERVACIONES = "21c64e05e77f65e39f91942dadff9cda10e1a713";
const KEY_FECHA_ESTIMADA_ENTREGA_MATERIAL = "cd18e5dd60c35d1127befc644316fac59ca47194";
const KEY_DIRECCION_ENVIO = "c82df445d3f11aa21f199db69184d4742b48a6a4";
const KEY_FORMA_PAGO_MATERIAL = "155285b48c2c0c03c8b54c1ee7e9e01286025454";
const KEY_TIPO_SERVICIO = "1d78d202448ee549a86e0881ec06f3ff7842c5ea";
const KEY_MAIL_INVOICE  = "8b0652b56fd17d4547149f1ae26b1b74b527eaf0";
const KEY_A_FECHA       = "98f072a788090ac2ae52017daaf9618c3a189033";
const KEY_W_ID_VARIATION = "478b2a7f79323212032ab2344aff193c4bf77523";
const KEY_PRESU_HOLDED  = "4118257ffc3bad107769f69d05e5bd1d7415cadd";
const KEY_MODO_RESERVA  = "c6eabce7c04f864646aa72c944f875fd71cdf178";

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

function toNullableString(val: any): string | null {
  if (val === null || val === undefined) return null;
  if (typeof val === "string") {
    const trimmed = val.trim();
    return trimmed.length ? trimmed : null;
  }
  if (typeof val === "number" || typeof val === "boolean") {
    return String(val);
  }
  if (typeof val === "object") {
    const candidates = [
      (val as any).name,
      (val as any).label,
      (val as any).value,
      (val as any).id,
      (val as any).email,
    ];
    for (const candidate of candidates) {
      if (candidate === val) continue;
      const resolved = toNullableString(candidate);
      if (resolved) return resolved;
    }
  }
  return null;
}

function normalizePipelineLabel(value: unknown): string | null {
  const label = toNullableString(value);
  if (!label) return null;
  return label
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function isMaterialPipelineLabel(value: unknown): boolean {
  const normalized = normalizePipelineLabel(value);
  return normalized === "material" || normalized === "materiales";
}

function toBooleanOrNull(val: any): boolean | null {
  if (val === null || val === undefined || val === "") return null;
  if (typeof val === "boolean") return val;
  if (typeof val === "number") {
    if (!Number.isFinite(val)) return null;
    if (val === 1) return true;
    if (val === 0) return false;
  }
  if (typeof val === "string") {
    const normalized = val.trim().toLowerCase();
    if (!normalized.length) return null;
    if (["1", "true", "si", "sí", "yes", "y"].includes(normalized)) return true;
    if (["0", "false", "no", "n"].includes(normalized)) return false;
  }
  if (typeof val === "object") {
    const candidates = [(val as any).value, (val as any).id, (val as any).label, (val as any).name];
    for (const candidate of candidates) {
      if (candidate === val) continue;
      const resolved = toBooleanOrNull(candidate);
      if (resolved !== null) return resolved;
    }
  }
  return null;
}

function toDateOrNull(val: any): Date | null {
  if (val === null || val === undefined || val === "") return null;
  if (val instanceof Date && !Number.isNaN(val.getTime())) {
    return val;
  }
  if (typeof val === "number") {
    const dateFromNumber = new Date(val);
    return Number.isNaN(dateFromNumber.getTime()) ? null : dateFromNumber;
  }
  const str = typeof val === "string" ? val.trim() : String(val);
  if (!str.length) return null;
  const parsed = new Date(str);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
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

function buildProductFingerprint(name?: string | null, code?: string | null): string | null {
  const normalizedName = typeof name === "string" ? name.trim().toLowerCase() : "";
  const normalizedCode = typeof code === "string" ? code.trim().toLowerCase() : "";
  if (!normalizedName && !normalizedCode) return null;
  return `${normalizedCode}|${normalizedName}`;
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
  const fTipoServicio = findFieldDef(dealFields, KEY_TIPO_SERVICIO);
  const fModoReserva = findFieldDef(dealFields, KEY_MODO_RESERVA);
  const fProveedores = findFieldDef(dealFields, KEY_PROVEEDORES);
  const fObservaciones = findFieldDef(dealFields, KEY_OBSERVACIONES);
  const fDireccionEnvio = findFieldDef(dealFields, KEY_DIRECCION_ENVIO);
  const fFormaPagoMaterial = findFieldDef(dealFields, KEY_FORMA_PAGO_MATERIAL);

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
  const tipoServicioLabel = fTipoServicio
    ? optionLabelOf(fTipoServicio, deal?.[fTipoServicio.key]) ?? null
    : (() => {
        const raw = deal?.[KEY_TIPO_SERVICIO];
        if (raw === null || raw === undefined) return null;
        const value = String(raw).trim();
        return value.length ? value : null;
      })();

  const poValueRaw = deal?.[KEY_PO];
  const poValue =
    poValueRaw === null || poValueRaw === undefined
      ? null
      : String(poValueRaw).trim() || null;

  const mailInvoiceRaw = deal?.[KEY_MAIL_INVOICE];
  const mailInvoice =
    mailInvoiceRaw === null || mailInvoiceRaw === undefined
      ? null
      : String(mailInvoiceRaw).trim() || null;

  const ownerName =
    toNullableString(deal?.owner_name) ??
    toNullableString(deal?.user_id) ??
    toNullableString(deal?.owner_id);

  const aFecha = toDateOrNull(deal?.[KEY_A_FECHA]);
  const wIdVariation = toNullableString(deal?.[KEY_W_ID_VARIATION]);
  const presuHolded = toNullableString(deal?.[KEY_PRESU_HOLDED]);

  const modoReservaRaw = fModoReserva ? deal?.[fModoReserva.key] : deal?.[KEY_MODO_RESERVA];
  const modoReservaLabel = fModoReserva
    ? optionLabelOf(fModoReserva, modoReservaRaw) ?? toNullableString(modoReservaRaw)
    : toNullableString(modoReservaRaw);

  const proveedoresLabel = fProveedores
    ? optionLabelOf(fProveedores, deal?.[fProveedores.key]) ?? null
    : toNullableString(deal?.[KEY_PROVEEDORES]);
  const observaciones = toNullableString(
    deal?.[fObservaciones?.key ?? KEY_OBSERVACIONES],
  );
  const fechaEstimadaEntregaMaterial = toNullableString(
    deal?.[KEY_FECHA_ESTIMADA_ENTREGA_MATERIAL],
  );
  const direccionEnvio = resolveAddressFromDeal(
    deal,
    fDireccionEnvio?.key ?? KEY_DIRECCION_ENVIO,
  );
  const formaPagoMaterial = fFormaPagoMaterial
    ? optionLabelOf(fFormaPagoMaterial, deal?.[fFormaPagoMaterial.key]) ?? null
    : toNullableString(deal?.[KEY_FORMA_PAGO_MATERIAL]);

  return {
    trainingAddress,
    sedeLabel,
    caesLabel,
    fundaeLabel,
    hotelLabel,
    transporteLabel,
    poValue,
    tipoServicioLabel,
    mailInvoice,
    ownerName,
    aFecha,
    wIdVariation,
    presuHolded,
    modoReserva: modoReservaLabel,
    proveedoresLabel,
    observaciones,
    fechaEstimadaEntregaMaterial,
    direccionEnvio,
    formaPagoMaterial,
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
  const {
    trainingAddress,
    sedeLabel,
    caesLabel,
    fundaeLabel,
    hotelLabel,
    transporteLabel,
    poValue,
    tipoServicioLabel,
    mailInvoice,
    ownerName,
    aFecha,
    wIdVariation,
    presuHolded,
    modoReserva,
    proveedoresLabel,
    observaciones,
    fechaEstimadaEntregaMaterial,
    direccionEnvio,
    formaPagoMaterial,
  } =
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

  const isMaterialDeal = isMaterialPipelineLabel(pipelineLabel);
  const materialStatus = isMaterialDeal ? current?.estado_material ?? "Pedidos confirmados" : null;

  // 5) Upsert deal (sin 'hours' en deals)
  const orgIdForDeal = org?.id != null ? String(org.id) : null;

  const dbDeal = await prisma.deals.upsert({
    where: { deal_id: String(deal.id) },
    create: {
      deal_id: String(deal.id),
      title: deal?.title ?? "—",
      pipeline_id: pipelineLabel ?? null,
      estado_material: materialStatus,
      training_address: trainingAddress ?? null,
      sede_label: sedeLabel ?? null,
      caes_label: caesLabel ?? null,
      fundae_label: fundaeLabel ?? null,
      hotel_label: hotelLabel ?? null,
      transporte: transporteLabel ?? null,
      po: poValue ?? null,
      tipo_servicio: tipoServicioLabel ?? null,
      mail_invoice: mailInvoice ?? null,
      proveedores: proveedoresLabel ?? null,
      observaciones: observaciones ?? null,
      fecha_estimada_entrega_material: fechaEstimadaEntregaMaterial ?? null,
      direccion_envio: direccionEnvio ?? null,
      forma_pago_material: formaPagoMaterial ?? null,
      comercial: ownerName ?? null,
      a_fecha: aFecha ?? null,
      w_id_variation: wIdVariation ?? null,
      presu_holded: presuHolded,
      modo_reserva: modoReserva ?? null,
      org_id: orgIdForDeal,
      person_id: dbPersonId,
    },
    update: {
      title: deal?.title ?? "—",
      pipeline_id: pipelineLabel ?? null,
      estado_material: materialStatus,
      training_address: keep(current?.training_address, trainingAddress),
      sede_label: keep(current?.sede_label, sedeLabel),
      caes_label: keep(current?.caes_label, caesLabel),
      fundae_label: keep(current?.fundae_label, fundaeLabel),
      hotel_label: keep(current?.hotel_label, hotelLabel),
      transporte: keep(current?.transporte, transporteLabel),
      po: poValue ?? null,
      tipo_servicio: tipoServicioLabel ?? null,
      mail_invoice: mailInvoice ?? null,
      proveedores: keep(current?.proveedores, proveedoresLabel),
      observaciones: keep(current?.observaciones, observaciones),
      fecha_estimada_entrega_material: keep(
        current?.fecha_estimada_entrega_material,
        fechaEstimadaEntregaMaterial,
      ),
      direccion_envio: keep(current?.direccion_envio, direccionEnvio),
      forma_pago_material: keep(current?.forma_pago_material, formaPagoMaterial),
      comercial: ownerName ?? null,
      a_fecha: aFecha ?? null,
      w_id_variation: wIdVariation ?? null,
      presu_holded: presuHolded,
      modo_reserva: modoReserva ?? null,
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

  type ExistingProductRecord = { id: string; name: string | null; code: string | null };

  const existingProducts = (await prisma.deal_products.findMany({
    where: { deal_id: dealId },
    select: { id: true, name: true, code: true },
  })) as ExistingProductRecord[];

  const existingAutoProducts = existingProducts.filter((product) => !isLikelyManualId(product.id));
  const existingAutoIds = new Set<string>(existingAutoProducts.map((product) => product.id));
  const existingAutoByFingerprint = new Map<string, string>();

  for (const product of existingAutoProducts) {
    const fingerprint = buildProductFingerprint(product.name, product.code);
    if (fingerprint && !existingAutoByFingerprint.has(fingerprint)) {
      existingAutoByFingerprint.set(fingerprint, product.id);
    }
  }

  const incomingProductIds = new Set<string>();

  const resolveProductId = (dealId: string, source: any, fingerprint: string | null): string => {
    const candidateIds = [
      source?.id,
      source?.deal_product_id,
      source?.item_id,
      source?.product_id,
      source?.product?.id,
    ];

    for (const candidate of candidateIds) {
      if (candidate === null || candidate === undefined) continue;
      const trimmed = String(candidate).trim();
      if (!trimmed.length) continue;
      return `${dealId}_${trimmed}`;
    }

    if (fingerprint) {
      const reused = existingAutoByFingerprint.get(fingerprint);
      if (reused) {
        existingAutoByFingerprint.delete(fingerprint);
        return reused;
      }
    }

    return `${dealId}_${Math.random().toString(36).slice(2)}`;
  };

  const now = new Date();

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
    const productCatalogId = p.product_id ?? p.id ?? null;
    if (productCatalogId != null) {
      try {
        const catalog = await getProductCached(productCatalogId);
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

    const fingerprint = buildProductFingerprint(baseName, code);
    const productId = resolveProductId(dealId, p, fingerprint);
    incomingProductIds.add(productId);

    const data = {
      deal_id: dealId,
      name: baseName,
      code,
      quantity,
      price,
      hours,
      product_comments,
      category,
      type,
    } as Record<string, any>;

    if (existingAutoIds.has(productId)) {
      await prisma.deal_products.update({
        where: { id: productId },
        data: { ...data, updated_at: now } as any,
      });
    } else {
      await prisma.deal_products.create({
        data: { id: productId, ...data, updated_at: now } as any,
      });
    }
  }

  const idsToDelete = Array.from(existingAutoIds).filter((id) => !incomingProductIds.has(id));
  if (idsToDelete.length) {
    await prisma.deal_products.deleteMany({
      where: { deal_id: dealId, id: { in: idsToDelete } },
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
    const fileName =
      f?.original_file_name ??
      f?.file_name ??
      f?.name ??
      (typeof f?.title === "string" ? f.title : "documento");

    await prisma.deal_files.upsert({
      where: { id },
      create: {
        id,
        deal_id: dealId,
        file_name: fileName,
        file_url: f.file_url ?? f.url ?? null,
        file_type: f.file_type ?? f.mime_type ?? null,
        ...(f.add_time ? { added_at: new Date(f.add_time) } : {}),
      },
      update: {
        deal_id: dealId,
        file_name: fileName,
        file_url: f.file_url ?? f.url ?? null,
        file_type: f.file_type ?? f.mime_type ?? null,
        ...(f.add_time ? { added_at: new Date(f.add_time) } : {}),
      },
    });
  }

  return dealId;
}
