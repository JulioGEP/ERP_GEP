import type { Handler } from '@netlify/functions';
import { Prisma } from '@prisma/client';
import { err, ok, preflight } from './_lib/http';
import { getPrisma } from './_shared/prisma';
import { listAllPersons } from './_shared/pipedrive';
import { buildMailchimpPersonInput } from './_shared/pipedrive-mailchimp';

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const safeLimit = Math.max(1, Math.floor(limit));
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  let active = 0;

  return new Promise((resolve, reject) => {
    const runNext = () => {
      if (nextIndex >= items.length && active === 0) {
        resolve(results);
        return;
      }

      while (active < safeLimit && nextIndex < items.length) {
        const currentIndex = nextIndex;
        const currentItem = items[nextIndex];
        nextIndex += 1;
        active += 1;

        worker(currentItem, currentIndex)
          .then((result) => {
            results[currentIndex] = result;
          })
          .catch(reject)
          .finally(() => {
            active -= 1;
            runNext();
          });
      }
    };

    runNext();
  });
}

export const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return preflight();
  if (event.httpMethod !== 'POST') {
    return err('METHOD_NOT_ALLOWED', 'Método no soportado', 405);
  }

  try {
    const prisma = getPrisma();
    const rawPersons = await listAllPersons();
    const orgCache = { organizations: new Map<string, any | null>() };
    const concurrency =
      Number.parseInt(process.env.PIPEDRIVE_PERSON_SYNC_CONCURRENCY ?? '4', 10) || 4;
    const mappedResults = await mapWithConcurrency(
      rawPersons,
      concurrency,
      async (raw) => buildMailchimpPersonInput(raw, orgCache),
    );
    const mapped = mappedResults.filter(
      (person): person is Awaited<ReturnType<typeof buildMailchimpPersonInput>> => Boolean(person),
    );

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
