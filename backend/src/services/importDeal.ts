import type { DealSummary } from '../types/deal';
import { pipedriveClient } from './pipedriveClient';
import { prisma } from './prisma';

/** Helpers genéricos (no cambian tu flujo) */
type PDDeal = { id: number; title: string; org_id?: any; person_id?: any; products?: any[]; pipeline_id?: any; [k: string]: any };
type PDOrg  = { id: number; name?: string | null; address?: string | null; [k: string]: any };
type PDPerson = { id: number; first_name?: string | null; last_name?: string | null; email?: any; phone?: any };

function ensureArray<T>(v: T | T[] | null | undefined): T[] { return !v ? [] : Array.isArray(v) ? v : [v]; }
function parseIntSafe(v: any): number { const n = parseInt(String(v ?? ''), 10); return Number.isNaN(n) ? 0 : n; }
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
  const trainingProducts = allProducts.filter(isTraining).map((p) => ({
    product_id: String(p.product_id ?? p.id ?? ''),
    name: String(p.name ?? ''),
    quantity: parseIntSafe(p.quantity ?? 0)
  }));
  const extraProducts = allProducts.filter((p) => !isTraining(p)).map((p) => ({
    product_id: String(p.product_id ?? p.id ?? ''),
    name: String(p.name ?? ''),
    quantity: parseIntSafe(p.quantity ?? 0)
  }));

  const sessionsCount = trainingProducts.reduce((acc, p) => acc + (p.quantity ?? 0), 0);
  const sessionsIds   = trainingProducts.map((p) => p.product_id);

  // Campos custom mínimos
  const hours = parseIntSafe(deal['38f11c8876ecde803a027fbf3c9041fda2ae7eb7']);
  const deal_direction = String(deal['8b2a7570f5ba8aa4754f061cd9dc92fd778376a7'] ?? '');
  const sede = String(deal['676d6bd51e52999c582c01f67c99a35ed30bf6ae'] ?? '');
  const CAES = Boolean(deal['e1971bf3a21d48737b682bf8d864ddc5eb15a351'] ?? false);
  const FUNDAE = Boolean(deal['245d60d4d18aec40ba888998ef92e5d00e494583'] ?? false);
  const Hotel_Night = Boolean(deal['c3a6daf8eb5b4e59c3c07cda8e01f43439101269'] ?? false);
  const trainingType = deal.pipeline_id != null ? String(deal.pipeline_id) : null;

  // Persistencia (todo en strings para cuadrar tipos del client actual)
  await prisma.$transaction(async () => {
    // organizations (usa strings)
    if ($('organizations')) {
      await $('organizations').upsert({
        where: { org_id: orgIdStr },
        create: {
          org_id: orgIdStr,
          name: org?.name ?? 'Organización sin nombre',
          // si tu modelo tiene cif/phone/address, añade aquí según tu client real
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
          // añade last_name / phone si tu client los tiene
        },
        update: {
          org_id: orgIdStr,
          name: person.first_name ?? null,
          email: primaryFromField(person.email)
        }
      });
    }

    // deals
    const trainingValue = $('deals')?.fields?.training?.type === 'Json' ? trainingProducts : JSON.stringify(trainingProducts);
    const extrasValue   = $('deals')?.fields?.extras?.type === 'Json'   ? extraProducts   : JSON.stringify(extraProducts);

    const dealDataCreate: any = {
      deal_id: String(deal.id),
      deal_org_id: orgIdStr,
      org_id: orgIdStr,
      title: deal.title,
      training: trainingValue,
      extras: extrasValue,
      hours,
      deal_direction,
      sede,
      CAES,
      FUNDAE,
      Hotel_Night,
      // si existen en tu modelo:
      // sessionsNum: sessionsCount,
      // sessionsIds: JSON.stringify(sessionsIds),
    };

    const dealDataUpdate: any = {
      title: deal.title,
      training: trainingValue,
      extras: extrasValue,
      hours,
      deal_direction,
      sede,
      CAES,
      FUNDAE,
      Hotel_Night,
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

    // deal_products (si tu client lo tiene ya)
    if ($('deal_products')) {
      await $('deal_products').deleteMany({ where: { deal_id: savedDeal.deal_id } });
      const rows: any[] = [
        ...trainingProducts.map((p) => ({
          deal_id: savedDeal.deal_id,
          pd_product_id: p.product_id,
          name: p.name,
          quantity: p.quantity,
          type: 'TRAINING'
        })),
        ...extraProducts.map((p) => ({
          deal_id: savedDeal.deal_id,
          pd_product_id: p.product_id,
          name: p.name,
          quantity: p.quantity,
          type: 'EXTRA'
        }))
      ];
      if (rows.length) await $('deal_products').createMany({ data: rows });
    }

    // notes (usa comment_deal si es lo que tu client exige)
    if ($('notes')) {
      await $('notes').deleteMany({ where: { deal_id: String(deal.id) } });
      if (notes.length) {
        const notesRows = notes.map((n) => ({
          note_id: String(n.id),
          deal_id: String(deal.id),
          author_id: '0',
          comment_deal: String(n.content ?? '') // <- nombre que tu client está pidiendo
        }));
        await $('notes').createMany({ data: notesRows });
      }
    }

    // documents
    if ($('documents')) {
      await $('documents').deleteMany({ where: { deal_id: String(deal.id) } });
      if (files.length) {
        const docsRows = files.map((f) => ({
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

  // Resumen front
  const summary: DealSummary = {
    dealId: deal.id,
    title: deal.title,
    clientName: org?.name ?? 'Organización sin nombre',
    sede,
    trainingNames: trainingProducts.map((p) => p.name).filter(Boolean),
    trainingType: trainingType ?? undefined,
    hours,
    caes: CAES ? '1' : undefined,
    fundae: FUNDAE ? '1' : undefined,
    hotelNight: Hotel_Night ? '1' : undefined,
    notes: notes.map((n) => String(n.content ?? '')),
    documents: files.map((f) => String(f.name ?? ''))
  };

  return summary;
}
