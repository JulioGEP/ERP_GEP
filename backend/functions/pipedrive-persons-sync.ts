import type { Handler } from '@netlify/functions';
import { Prisma } from '@prisma/client';
import { err, ok, preflight } from './_lib/http';
import { getPrisma } from './_shared/prisma';
import { listAllPersons } from './_shared/pipedrive';
import { buildMailchimpPersonInput } from './_shared/pipedrive-mailchimp';

export const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return preflight();
  if (event.httpMethod !== 'POST') {
    return err('METHOD_NOT_ALLOWED', 'Método no soportado', 405);
  }

  try {
    const prisma = getPrisma();
    const rawPersons = await listAllPersons();
    const orgCache = new Map<string, string | null>();
    const mapped: Awaited<ReturnType<typeof buildMailchimpPersonInput>>[] = [];

    for (const raw of rawPersons) {
      const mappedPerson = await buildMailchimpPersonInput(raw, orgCache);
      if (mappedPerson) mapped.push(mappedPerson);
    }

    const now = new Date();
    const result = await prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        const existing = await tx.pipedrive_mailchimp_persons.findMany({
          select: { person_id: true },
        });
        const existingIds = new Set(existing.map((row) => row.person_id));

        let created = 0;
        let updated = 0;

        for (const person of mapped) {
          const { person_id, ...payload } = person;
          await tx.pipedrive_mailchimp_persons.upsert({
            where: { person_id },
            update: { ...payload, updated_at: now },
            create: { person_id, ...payload, created_at: now, updated_at: now },
          });

          if (existingIds.has(person_id)) {
            updated += 1;
          } else {
            created += 1;
          }
        }

        return { created, updated };
      },
      { timeout: 60000 },
    );

    return ok({
      ok: true,
      summary: {
        fetched: rawPersons.length,
        imported: mapped.length,
        created: result.created,
        updated: result.updated,
      },
    });
  } catch (error) {
    console.error('[pipedrive-persons-sync] handler error', error);
    return err('UNEXPECTED_ERROR', 'Se ha producido un error inesperado', 500);
  }
};
