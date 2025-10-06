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

// ========= Claves de campos custom (según Pipedrive) =========
const KEY_TRAINING_ADDRESS = "training_address";
const KEY_SEDE = "sede";
const KEY_CAES = "caes";
const KEY_FUNDAE = "fundae";
const KEY_HOTEL = "hotel";

// Campo custom de HORAS por producto en el deal (Product field key)
const KEY_PRODUCT_HOURS = "38f11c8876ecde803a027fbf3c9041fda2ae7eb7";

// -------- Helpers --------
function stripHourSuffix(x: any): number {
  if (x == null) return 0;
  const s = String(x).trim();
  const num = parseInt(s.replace(/h/i, "").trim(), 10);
  return Number.isFinite(num) ? num : 0;
}

function pickFirstEmail(val: any): string | null {
  if (val == null) return null;
  if (typeof val === "string") return val;
  if (Array.isArray(val) && val.length > 0) {
    const first = val.find((e) => e?.primary) ?? val[0];
    return first?.value ?? first?.email ?? null;
  }
  if (typeof val === "object") {
    return val.value ?? val.email ?? null;
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
    return val.value ?? val.phone ?? null;
  }
  return null;
}

async function resolvePipelineLabel(
  pipeline_id?: number | string | null
): Promise<string | undefined> {
  if (!pipeline_id && pipeline_id !== 0) return undefined;
  const pipelines = await getPipelines();
  const idNum =
    typeof pipeline_id === "string" ? Number(pipeline_id) : pipeline_id;
  const match = pipelines?.find((pl: any) => pl.id === idNum);
  return match?.name ?? String(pipeline_id);
}

export async function resolveDealCustomLabels(deal: any) {
  const dealFields = await getDealFields();

  const fAddr = findFieldDef(dealFields, KEY_TRAINING_ADDRESS);
  const fSede = findFieldDef(dealFields, KEY_SEDE);
  const fCaes = findFieldDef(dealFields, KEY_CAES);
  const fFundae = findFieldDef(dealFields, KEY_FUNDAE);
  const fHotel = findFieldDef(dealFields, KEY_HOTEL);

  const trainingAddress = fAddr
    ? optionLabelOf(fAddr, deal?.[fAddr.key]) ?? deal?.[fAddr.key]
    : deal?.[KEY_TRAINING_ADDRESS];
  const sedeLabel = fSede
    ? optionLabelOf(fSede, deal?.[fSede.key]) ?? deal?.[fSede.key]
    : deal?.[KEY_SEDE];
  const caesLabel = fCaes
    ? optionLabelOf(fCaes, deal?.[fCaes.key]) ?? deal?.[fCaes.key]
    : deal?.[KEY_CAES];
  const fundaeLabel = fFundae
    ? optionLabelOf(fFundae, deal?.[fFundae.key]) ?? deal?.[fFundae.key]
    : deal?.[KEY_FUNDAE];
  const hotelLabel = fHotel
    ? optionLabelOf(fHotel, deal?.[fHotel.key]) ?? deal?.[fHotel.key]
    : deal?.[KEY_HOTEL];

  return { trainingAddress, sedeLabel, caesLabel, fundaeLabel, hotelLabel };
}

// ============================================================
// ===============  MAP & UPSERT DEAL COMPLETO  ===============
// ============================================================

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
    prev !== null && prev !== undefined ? prev : incoming ?? null;

  // 5) Upsert deal
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
      hours: null,
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
      hours: current?.hours ?? null,
      alumnos: current?.alumnos ?? 0,
      org_id: orgIdForDeal,
      person_id: dbPersonId,
    },
    select: { deal_id: true },
  });

  const dealId: string = dbDeal.deal_id;

  // 6) Productos (reset + insert)
  const productFields = await getProductFields();
  const fHours = productFields?.find((f: any) => f.key === KEY_PRODUCT_HOURS);

  await prisma.deal_products.deleteMany({ where: { deal_id: dealId } });

  for (const p of Array.isArray(products) ? products : []) {
    const name = p.name ?? p.product?.name ?? null;
    const code = p.code ?? p.product?.code ?? null;

    const hoursRaw = fHours ? p?.[fHours.key] : p?.[KEY_PRODUCT_HOURS];
    const hoursNum = stripHourSuffix(hoursRaw);
    const quantity =
      Number.isFinite(hoursNum) && hoursNum >= 0 ? hoursNum : 0;
    const hoursTxt =
      hoursRaw != null ? String(hoursRaw) : quantity ? `${quantity}h` : null;

    const price =
      p.item_price != null
        ? Number(p.item_price)
        : p.product?.prices?.[0]?.price != null
        ? Number(p.product.prices[0].price)
        : null;

    await prisma.deal_products.create({
      data: {
        id: `${dealId}_${Math.random().toString(36).slice(2)}`,
        deal_id: dealId,
        name,
        code,
        quantity: price == null && quantity === 0 ? null : quantity,
        price,
        hours: hoursTxt,
        product_comments: null,
        category: null,
      },
    });
  }

  // 7) Notas
  await prisma.deal_notes.deleteMany({ where: { deal_id: dealId } });
  for (const n of Array.isArray(notes) ? notes : []) {
    await prisma.deal_notes.create({
      data: {
        id: String(n.id ?? `${dealId}_${Math.random().toString(36).slice(2)}`),
        deal_id: dealId,
        product_id: null,
        content: n.content ?? n.note ?? "",
        author: n.user?.name ?? n.author ?? null,
        created_at: n.add_time ? new Date(n.add_time) : undefined,
        updated_at: n.update_time ? new Date(n.update_time) : undefined,
      },
    });
  }

  // 8) Ficheros
  await prisma.deal_files.deleteMany({ where: { deal_id: dealId } });
  for (const f of Array.isArray(files) ? files : []) {
    const id = String(
      f.id ?? `${dealId}_${Math.random().toString(36).slice(2)}`
    );
    await prisma.deal_files.create({
      data: {
        id,
        deal_id: dealId,
        file_name: f.file_name ?? f.name ?? "documento",
        file_url: f.file_url ?? f.url ?? null,
        file_type: f.file_type ?? f.mime_type ?? null,
        added_at: f.add_time ? new Date(f.add_time) : undefined,
      },
    });
  }

  return dealId;
}
