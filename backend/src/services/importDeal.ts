import type { DealSummary } from '../types/deal';
import { pipedriveClient } from './pipedriveClient';
import { prisma } from './prisma';

/** Helpers genéricos (no cambian tu flujo) */
type PDDeal = { id: number; title: string; org_id?: any; person_id?: any; products?: any[]; pipeline_id?: any; [k: string]: any };
type PDOrg  = { id: number; name?: string | null; address?: string | null; [k: string]: any };
type PDPerson = { id: number; first_name?: string | null; last_name?: string | null; email?: any; phone?: any };

function ensureArray<T>(v: T | T[] | null | undefined): T[] { return !v ? [] : Array.isArray(v) ? v : [v]; }
function parseIntSafe(v: any): number { const n = parseInt(String(v ?? ''), 10); return Number.isNaN(n) ? 0 : n; }
function parseNumberSafe(v: any): number { const n = Number(v ?? 0); return Number.isNaN(n) ? 0 : n; }
function primaryFromField(field: any): string | null {
  if (!field) return null;
  if (typeof field === 'string') return field;
  if (Array.isArray(field)) {
    const primary = field.find((x) => x?.primary) ?? field[0];
    return primary?.value ?? null;
  }
  return null;
}

// Regla para distinguir formación
const isTraining = (p: any): boolean => {
  const code = String(p?.code ?? '').toLowerCase();
  const name = String(p?.name ?? '').toLowerCase();
  return code.startsWith('form-') || name.includes('formación') || name.includes('formacion');
};

// Para evitar “no existe propiedad X en PrismaClient” cuando tu client está desfasado
const $ = (model: string) => (prisma as any)[model];

// Claves de Pipedrive que nos has dado (por claridad)
const PD_KEY_PRODUCT_TYPE   = '5bad94030bb7917c186f3238fb2cd8f7a91cf30b'; // → deal_products.type (string)
const PD_KEY_PRODUCT_HOURS  = '38f11c8876ecde803a027fbf3c9041fda2ae7eb7'; // → deal_products.hours (number)
const PD_KEY_PRODUCT_CODE   = 'code';                                      // → deal_products.code (string)
const PD_KEY_PRODUCT_CAT    = 'category';                                  // → deal_products.category (string)

// Claves a nivel DEAL que ya usabas
const PD_KEY_TRAINING_ADDR  = '8b2a7570f5ba8aa4754f061cd9dc92fd778376a7';
const PD_KEY_SEDE_LABEL     = '676d6bd51e52999c582c01f67c99a35ed30bf6ae';
const PD_KEY_CAES_LABEL     = 'e1971bf3a21d48737b682bf8d864ddc5eb15a351';
const PD_KEY_FUNDAE_LABEL   = '245d60d4d18aec40ba888998ef92e5d00e494583';
const PD_KEY_HOTEL_LABEL    = 'c3a6daf8eb5b4e59c3c07cda8e01f43439101269';
// (hours a nivel deal lo mantenemos por compatibilidad)
const PD_KEY_DEAL_HOURS     = '38f11c8876ecde803a027fbf3c9041fda2ae7eb7';

export async function importDealFromPipedrive(federalNumber: string): Promise<DealSummary> {
  // Deal + productos embebidos
  const dealResp = await pipedriveClient.get<{ data: PDDeal | null }>(
    `/deals/${encodeURIComponent(federalNumber)}`,
    { params: { include_products: 1 } }
  );
  const deal = dealResp.data?.data;
  if (!deal) throw new Error('No se ha encontrado el presupuesto solicitado en Pipedrive.');

  const orgIdRaw = deal.org_id && typeof deal.org_id === 'object' ? deal.org_id.value : deal.org_id;
  const orgIdStr = String(orgIdRaw ?? '');
  if (!orgIdStr) throw new Error('El presupuesto no tiene una organización asociada.');

  const personIdRaw = deal.person_id && typeof deal.person_id === 'object' ? deal.person_id.value : deal.person_id;
  const personIdStr = personIdRaw ? String(personIdRaw) : null;

  // Cargas paralelas
  const [orgResp, personResp, notesResp, filesResp] = await Promise.all([
    pipedriveClient.get<{ data: PDOrg | null }>(`/organizations/${orgIdStr}`),
    personIdStr
      ? pipedriveClient.get<{ data: PDPerson | null }>(`/persons/${personIdStr}`)
      : Promise.resolve({ data: { data: null } } as { data: { data: PDPerson | null } }),
    pipedriveClient.get<{ data: any[] | null }>(`/deals/${deal.id}/notes`),
    pipedriveClient.get<{ data: any[] | null }>(`/deals/${deal.id}/files`)
  ]);

  const org: PDOrg | null = orgResp.data?.data ?? null;
  const person: PDPerson | null = (personResp as any).data?.data ?? null;
  const notes = Array.isArray(notesResp.data?.data) ? notesResp.data!.data : [];
  const files = Array.isArray(filesResp.data?.data) ? filesResp.data!.data : [];

  // Productos → arrays limpios
  const allProducts = ensureArray(deal.products);

  // Normaliza todos los productos con los campos que quieres persistir en deal_products
  const normalizedProducts = allProducts.map((p: any) => {
    const product_id  = String(p.product_id ?? p.id ?? '');
    const name        = String(p.name ?? '');
    const quantity    = parseNumberSafe(p.quantity ?? 0);
    const price       = parseNumberSafe(p.item_price ?? p.price ?? 0);

    // Campos nuevos a guardar por producto
    const prodTypeStr = p?.[PD_KEY_PRODUCT_TYPE] != null ? String(p[PD_KEY_PRODUCT_TYPE]) : null; // texto Pipedrive
    const code        = p?.[PD_KEY_PRODUCT_CODE] != null ? String(p[PD_KEY_PRODUCT_CODE]) : null;
    const category    = p?.[PD_KEY_PRODUCT_CAT]  != null ? String(p[PD_KEY_PRODUCT_CAT])  : null;
    const hours       = p?.[PD_KEY_PRODUCT_HOURS] != null ? parseIntSafe(p[PD_KEY_PRODUCT_HOURS]) : null;

    // Clasificación TRAINING/EXTRA (tu lógica previa)
    const trainingFlag = isTraining(p);
    const enumType = trainingFlag ? 'TRAINING' : 'EXTRA'; // dealproducttype?

    return {
      product_id,
      name,
      quantity,
      price,
      is_training: trainingFlag,
      // mapeos solicitados:
      code,
      category,
      hours,
      // 'type' en tu tabla es dealproducttype? → guardamos la etiqueta enum usada (TRAINING/EXTRA)
      type: enumType as any,
      // además conservamos el valor textual de Pipedrive en caso de necesitarlo:
      __pd_type_text: prodTypeStr, // (no se persiste; sólo informativo durante el import)
      __raw: p
    };
  });

  const trainingProducts = normalizedProducts.filter((p) => p.is_training);
  const extraProducts    = normalizedProducts.filter((p) => !p.is_training);

  const sessionsCount = trainingProducts.reduce((acc, p) => acc + (p.quantity ?? 0), 0);
  const sessionsIds   = trainingProducts.map((p) => p.product_id);

  // Campos custom a nivel DEAL (se mantienen)
  const hoursFromDeal    = parseIntSafe(deal[PD_KEY_DEAL_HOURS]);
  const training_address = String(deal[PD_KEY_TRAINING_ADDR] ?? '');
  const sede_label       = String(deal[PD_KEY_SEDE_LABEL] ?? '');
  const caes_label       = Boolean(deal[PD_KEY_CAES_LABEL] ?? false);
  const fundae_label     = Boolean(deal[PD_KEY_FUNDAE_LABEL] ?? false);
  const hotel_label      = Boolean(deal[PD_KEY_HOTEL_LABEL] ?? false);
  const trainingType     = deal.pipeline_id != null ? String(deal.pipeline_id) : null;

  // Horas agregadas desde productos (por si te interesa usarlo más adelante)
  const hoursFromProducts = normalizedProducts.reduce((acc, p) => acc + (p.hours ?? 0), 0);

  // Persistencia (todo en strings para cuadrar tipos del client actual)
  await prisma.$transaction(async () => {
    // organizations (usa strings)
    if ($('organizations')) {
      await $('organizations').upsert({
        where: { org_id: orgIdStr },
        create: {
          org_id: orgIdStr,
          name: org?.name ?? 'Organización sin nombre',
        },
        update: {
          name: org?.name ?? 'Organización sin nombre'
        }
      });
    }

    // persons (vinculamos a org)
    if (person && $('persons')) {
      await $('persons').upsert({
        where: { person_id: String(person.id) },
        create: {
          person_id: String(person.id),
          org_id: orgIdStr,
          name: person.first_name ?? null,
          email: primaryFromField(person.email)
        },
        update: {
          org_id: orgIdStr,
          name: person.first_name ?? null,
          email: primaryFromField(person.email)
        }
      });
    }

    // deals (se mantiene tu lógica previa)
    const trainingValue = $('deals')?.fields?.training?.type === 'Json' ? trainingProducts : JSON.stringify(trainingProducts);
    const extrasValue   = $('deals')?.fields?.extras?.type === 'Json'   ? extraProducts   : JSON.stringify(extraProducts);

    const dealDataCreate: any = {
      deal_id: String(deal.id),
      org_id: orgIdStr,
      title: deal.title,
      training: trainingValue,
      extras: extrasValue,
      hours: hoursFromDeal, // mantenemos el campo hours del deal (compatibilidad)
      training_address,
      sede_label,
      caes_label,
      fundae_label,
      hotel_label,
      // sessionsNum: sessionsCount,
      // sessionsIds: JSON.stringify(sessionsIds),
    };

    const dealDataUpdate: any = {
      title: deal.title,
      training: trainingValue,
      extras: extrasValue,
      hours: hoursFromDeal, // mantenido
      training_address,
      sede_label,
      caes_label,
      fundae_label,
      hotel_label,
      // sessionsNum: sessionsCount,
      // sessionsIds: JSON.stringify(sessionsIds),
    };

    const savedDeal = $('deals')
      ? await $('deals').upsert({
          where: { deal_id: String(deal.id) },
          create: dealDataCreate,
          update: dealDataUpdate
        })
      : { deal_id: String(deal.id) };

    // deal_products → ahora guardamos hours/type/code/category por producto
    if ($('deal_products')) {
      await $('deal_products').deleteMany({ where: { deal_id: savedDeal.deal_id } });

      // Adaptamos a tu esquema:
      // model deal_products {
      //   id String @id
      //   deal_id String?
      //   product_id String?
      //   name String?
      //   code String?
      //   quantity Decimal?
      //   price Decimal?
      //   is_training Boolean?
      //   created_at DateTime @default(now())
      //   updated_at DateTime @default(now())
      //   type dealproducttype?
      //   hours Int?
      //   category String?
      // }

      const rows: any[] = normalizedProducts.map((p) => ({
        deal_id: savedDeal.deal_id,
        product_id: p.product_id,
        name: p.name,
        code: p.code ?? null,
        quantity: p.quantity,
        price: p.price,
        is_training: p.is_training,
        type: p.type,               // 'TRAINING' | 'EXTRA' (enum dealproducttype?)
        hours: p.hours ?? null,     // NUEVO
        category: p.category ?? null// NUEVO
      }));

      if (rows.length) await $('deal_products').createMany({ data: rows });
    }

    // notes (usa comment_deal si es lo que tu client exige)
    if ($('notes')) {
      await $('notes').deleteMany({ where: { deal_id: String(deal.id) } });
      if (notes.length) {
        const notesRows = notes.map((n: any) => ({
          note_id: String(n.id),
          deal_id: String(deal.id),
          author_id: '0',
          comment_deal: String(n.content ?? '')
        }));
        await $('notes').createMany({ data: notesRows });
      }
    }

    // documents → si finalmente mapeas a deal_files en otro sitio, deja esta parte como noop
    if ($('documents')) {
      await $('documents').deleteMany({ where: { deal_id: String(deal.id) } });
      if (files.length) {
        const docsRows = files.map((f: any) => ({
          doc_id: String(f.id),
          deal_id: String(deal.id),
          file_name: String(f.name ?? `file_${f.id}`),
          file_size: 0,
          mime_type: null,
          storage_key: `pipedrive:${f.id}`,
          origin: 'imported',
          uploaded_by: null
        }));
        await $('documents').createMany({ data: docsRows });
      }
    }
  });

  // Resumen front (sin romper tu shape)
  const summary: DealSummary = {
    dealId: deal.id,
    title: deal.title,
    clientName: org?.name ?? 'Organización sin nombre',
    sede_label,
    trainingNames: normalizedProducts.filter(p => p.is_training).map((p) => p.name).filter(Boolean),
    trainingType: trainingType ?? undefined,
    hours: hoursFromDeal, // mantenido; el popup mostrará horas por producto desde deal_products
    caes_label: caes_label ? '1' : undefined,
    fundae_label: fundae_label ? '1' : undefined,
    hotel_label: hotel_label ? '1' : undefined,
    notes: notes.map((n: any) => String(n.content ?? '')),
    documents: files.map((f: any) => String(f.name ?? ''))
  };

  return summary;
}
