// backend/functions/_shared/mappers.ts
// Mapeos y upserts a BD desde objetos de Pipedrive (deal + org + person + productos + notas + ficheros)

import { getPrisma } from "./prisma";
import {
  getDealFields,
  getProductFields,
  optionLabelOf,
  findFieldDef,
  getPipelines,
} from "./pipedrive";

// ========= Claves de campos custom (según tu mapeo/pdf) =========
// OJO: Si alguna key difiere en tu Pipedrive, cámbiala aquí.
const KEY_TRAINING_ADDRESS = "training_address"; // dirección de formación (label)
const KEY_SEDE = "sede";
const KEY_CAES = "caes";
const KEY_FUNDAE = "fundae";
const KEY_HOTEL = "hotel";

// Campo custom de HORAS por producto en el deal
const KEY_PRODUCT_HOURS = "38f11c8876ecde803a027fbf3c9041fda2ae7eb7";
// Campo de comentarios por producto en el deal (si existiese)
const KEY_PRODUCT_COMMENTS = "Product_comments";
// Campos “solo filtro” (no persistimos de momento)
const KEY_PRODUCT_TYPE = "typedealproducttype";
const KEY_PRODUCT_CATEGORY = "category";

// -------- Helpers --------
function stripHourSuffix(x: any): number {
  // Convierte "2h" -> 2, "3" -> 3, null -> 0
  if (x == null) return 0;
  const s = String(x).trim();
  const num = parseInt(s.replace(/h/i, "").trim(), 10);
  return Number.isFinite(num) ? num : 0;
}

async function resolvePipelineLabel(pipeline_id?: number | string | null): Promise<string | undefined> {
  if (!pipeline_id && pipeline_id !== 0) return undefined;
  const pipelines = await getPipelines();
  const idNum = typeof pipeline_id === "string" ? Number(pipeline_id) : pipeline_id;
  const match = pipelines?.find((pl: any) => pl.id === idNum);
  return match?.name ?? String(pipeline_id);
}

export async function resolveDealCustomLabels(deal: any) {
  const dealFields = await getDealFields();

  const fAddr  = findFieldDef(dealFields, KEY_TRAINING_ADDRESS);
  const fSede  = findFieldDef(dealFields, KEY_SEDE);
  const fCaes  = findFieldDef(dealFields, KEY_CAES);
  const fFundae= findFieldDef(dealFields, KEY_FUNDAE);
  const fHotel = findFieldDef(dealFields, KEY_HOTEL);

  const trainingAddress =
    fAddr ? optionLabelOf(fAddr, deal?.[fAddr.key]) ?? deal?.[fAddr.key] : deal?.[KEY_TRAINING_ADDRESS];
  const sedeLabel =
    fSede ? optionLabelOf(fSede, deal?.[fSede.key]) ?? deal?.[fSede.key] : deal?.[KEY_SEDE];
  const caesLabel =
    fCaes ? optionLabelOf(fCaes, deal?.[fCaes.key]) ?? deal?.[fCaes.key] : deal?.[KEY_CAES];
  const fundaeLabel =
    fFundae ? optionLabelOf(fFundae, deal?.[fFundae.key]) ?? deal?.[fFundae.key] : deal?.[KEY_FUNDAE];
  const hotelLabel =
    fHotel ? optionLabelOf(fHotel, deal?.[fHotel.key]) ?? deal?.[fHotel.key] : deal?.[KEY_HOTEL];

  return { trainingAddress, sedeLabel, caesLabel, fundaeLabel, hotelLabel };
}

// ============================================================
// ===============  MAP & UPSERT DEAL COMPLETO  ===============
// ============================================================

/**
 * Inserta/actualiza:
 *  - organizations (name)
 *  - persons
 *  - deals (campos editables preservados si ya existen)
 *  - deal_products (horas por producto -> quantity)
 *  - deal_notes
 *  - deal_files (metadatos)
 *
 * Importante:
 *  - En deals.org_id tu esquema usa BIGINT: guardamos BigInt(org.id) si existe.
 *  - En deals.pipeline_id guardamos el LABEL del pipeline (no el id numérico).
 *  - training_address/sede_label/caes_label/fundae_label/hotel_label guardan LABEL.
 *  - quantity de deal_products se usa como “horas” por producto (compatibilidad UI actual).
 */
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
  const { trainingAddress, sedeLabel, caesLabel, fundaeLabel, hotelLabel } =
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
    const dbPerson = await prisma.persons.upsert({
      where: { person_id: String(person.id) },
      create: {
        person_id: String(person.id),
        first_name: person.first_name ?? person.name ?? null,
        last_name: person.last_name ?? null,
        email: person.email ?? null,
        phone: person.phone ?? null,
        // relación hacia organizations (string)
        person_org_id: dbOrg.org_id,
      },
      update: {
        first_name: person.first_name ?? person.name ?? null,
        last_name: person.last_name ?? null,
        email: person.email ?? null,
        phone: person.phone ?? null,
        person_org_id: dbOrg.org_id,
      },
      select: { person_id: true },
    });
    dbPersonId = dbPerson.person_id;
  }

  // 4) Preservar editables en re-imports
  //    (training_address, sede_label, caes_label, fundae_label, hotel_label, hours, alumnos)
  const current = await prisma.deals.findUnique({
    where: { deal_id: String(deal.id) },
  });

  const keep = <T>(prev: T | null | undefined, incoming: T | null | undefined) =>
    prev !== null && prev !== undefined ? prev : incoming ?? null;

  // 5) Upsert deal
  const orgIdForDeal = org?.id != null ? BigInt(String(org.id)) : null; // BIGINT en BD

  const dbDeal = await (prisma as any).deals.upsert({
    where: { deal_id: String(deal.id) },
    create: {
      deal_id: String(deal.id),
      title: deal?.title ?? "—",
      // Guardamos el LABEL del pipeline en pipeline_id (según requerimiento)
      pipeline_id: pipelineLabel ?? null,

      training_address: trainingAddress ?? null,
      sede_label: sedeLabel ?? null,
      caes_label: caesLabel ?? null,
      fundae_label: fundaeLabel ?? null,
      hotel_label: hotelLabel ?? null,

      // editables (inician nulos)
      hours: null,
      alumnos: null,

      // relaciones
      org_id: orgIdForDeal,   // BIGINT | null
      person_id: dbPersonId,  // string | null
    },
    update: {
      title: deal?.title ?? "—",
      pipeline_id: pipelineLabel ?? null,

      training_address: keep((current as any)?.training_address ?? (current as any)?.training_address_label, trainingAddress),
      sede_label:       keep(current?.sede_label,       sedeLabel),
      caes_label:       keep(current?.caes_label,       caesLabel),
      fundae_label:     keep(current?.fundae_label,     fundaeLabel),
      hotel_label:      keep(current?.hotel_label,      hotelLabel),

      // hours / alumnos preservan si existen
      hours:   current?.hours   ?? null,
      alumnos: current?.alumnos ?? null,

      org_id:    orgIdForDeal,
      person_id: dbPersonId,
    },
    select: { deal_id: true },
  });

  const dealId: string = dbDeal.deal_id;

  // 6) Productos (limpiamos y reinsertamos)
  const productFields = await getProductFields();
  const fHours    = productFields?.find((f: any) => f.key === KEY_PRODUCT_HOURS);
  // const fType  = productFields?.find((f: any) => f.key === KEY_PRODUCT_TYPE);     // solo filtro
  // const fCat   = productFields?.find((f: any) => f.key === KEY_PRODUCT_CATEGORY); // solo filtro
  // const fCom   = productFields?.find((f: any) => f.key === KEY_PRODUCT_COMMENTS);

  await prisma.deal_products.deleteMany({ where: { deal_id: dealId } });

  for (const p of Array.isArray(products) ? products : []) {
    const productId = p.product_id ?? p.id ?? null;
    const name = p.name ?? p.product?.name ?? null;
    const code = p.code ?? p.product?.code ?? null;

    // Horas por producto: almacenamos en quantity (compatibilidad UI actual)
    const hoursRaw = fHours ? p?.[fHours.key] : p?.[KEY_PRODUCT_HOURS];
    const hours = stripHourSuffix(hoursRaw);
    const quantity = Number.isFinite(hours) ? hours : 0;

    // Precio si viene
    const price =
      p.item_price != null ? Number(p.item_price) :
      p.product?.prices?.[0]?.price != null ? Number(p.product.prices[0].price) :
      null;

    await (prisma as any).deal_products.create({
      data: {
        id: `${dealId}_${productId ?? Math.random().toString(36).slice(2)}`,
        deal_id: dealId,
        product_id: productId != null ? String(productId) : null,
        name,
        code,
        quantity,
        price,
        is_training: undefined, // si más adelante lo quieres calcular
        type: null,             // enum dealproducttype | null
      },
    });
  }

  // 7) Notas
  await prisma.deal_notes.deleteMany({ where: { deal_id: dealId } });
  for (const n of Array.isArray(notes) ? notes : []) {
    await (prisma as any).deal_notes.create({
      data: {
        id: String(n.id ?? `${dealId}_${Math.random().toString(36).slice(2)}`),
        deal_id: dealId,
        product_id: null,
        content: n.content ?? n.note ?? "",
        author:  n.user?.name ?? n.author ?? null,
        created_at: n.add_time ? new Date(n.add_time) : null,
        updated_at: n.update_time ? new Date(n.update_time) : null,
      },
    });
  }

  // 8) Ficheros (metadatos) — tabla deal_files
  await (prisma as any).deal_files.deleteMany({ where: { deal_id: dealId } });
  for (const f of Array.isArray(files) ? files : []) {
    const id = String(f.id ?? `${dealId}_${Math.random().toString(36).slice(2)}`);
    await (prisma as any).deal_files.create({
      data: {
        id,
        deal_id: dealId,
        product_id: null,
        file_name: f.file_name ?? f.name ?? "documento",
        file_url:  f.file_url  ?? f.url  ?? null,
        file_type: f.file_type ?? f.mime_type ?? null,
        added_at:  f.add_time ? new Date(f.add_time) : null,
        // created_at / updated_at -> por defecto BD
      },
    });
  }

  return dealId;
}
