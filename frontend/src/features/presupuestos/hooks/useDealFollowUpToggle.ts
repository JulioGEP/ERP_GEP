import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { patchDealEditable } from '../api';
import type { DealEditablePatch } from '../api';
import type { DealDetail, DealSummary } from '../../types/deal';
import {
  DEALS_WITHOUT_SESSIONS_QUERY_KEY,
  DEALS_WITHOUT_SESSIONS_FALLBACK_QUERY_KEY,
} from '../queryKeys';

type DealListQueryKey = readonly unknown[];

type MutationContext = {
  previousDetail?: DealDetail;
  previousSummaries: Array<{ key: DealListQueryKey; data: DealSummary[] | undefined }>;
};

export type FollowUpFieldKey =
  | 'caes_val'
  | 'fundae_val'
  | 'hotel_val'
  | 'transporte_val'
  | 'po_val';

export type FollowUpFieldConfig = {
  field: FollowUpFieldKey;
  label: string;
  source: 'caes_label' | 'fundae_label' | 'hotel_label' | 'transporte' | 'po';
};

export const FOLLOW_UP_FIELDS: readonly FollowUpFieldConfig[] = [
  { field: 'caes_val', label: 'CAES', source: 'caes_label' },
  { field: 'fundae_val', label: 'FUNDAE', source: 'fundae_label' },
  { field: 'hotel_val', label: 'Hotel', source: 'hotel_label' },
  { field: 'transporte_val', label: 'Transporte', source: 'transporte' },
  { field: 'po_val', label: 'PO', source: 'po' },
] as const;

const DEAL_LIST_QUERY_KEYS: readonly DealListQueryKey[] = [
  DEALS_WITHOUT_SESSIONS_QUERY_KEY,
  DEALS_WITHOUT_SESSIONS_FALLBACK_QUERY_KEY,
  ['deals', 'pendingCertificates'],
] as const;

function resolveSummaryDealId(item: DealSummary | undefined): string | null {
  if (!item) return null;
  const idCandidates = [item.deal_id, (item as any).dealId].map((value) =>
    typeof value === 'string' ? value.trim() : '',
  );
  for (const candidate of idCandidates) {
    if (candidate.length) return candidate;
  }
  return null;
}

export function isAffirmativeLabel(value: string | null | undefined): boolean {
  if (typeof value !== 'string') return false;
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase() === 'si';
}

export function useDealFollowUpToggle(options: {
  dealId: string | null | undefined;
  detailQueryKey: readonly unknown[];
  userId?: string | null;
  userName?: string | null;
}) {
  const { dealId, detailQueryKey, userId, userName } = options;
  const queryClient = useQueryClient();
  const [pendingField, setPendingField] = useState<FollowUpFieldKey | null>(null);

  const mutation = useMutation<void, unknown, { field: FollowUpFieldKey; value: boolean }, MutationContext>(
    {
      mutationFn: async ({ field, value }) => {
        if (!dealId) {
          throw new Error('Identificador del presupuesto no disponible');
        }

        const patch: Partial<DealEditablePatch> = { [field]: value };
        const userHeader = userId
          ? {
              id: userId,
              name: userName ?? undefined,
            }
          : undefined;

        await patchDealEditable(dealId, patch, userHeader);
      },
      onMutate: async ({ field, value }) => {
        if (!dealId) {
          throw new Error('Identificador del presupuesto no disponible');
        }

        setPendingField(field);

        const previousDetail = queryClient.getQueryData<DealDetail>(detailQueryKey);
        const previousSummaries = DEAL_LIST_QUERY_KEYS.map((key) => ({
          key,
          data: queryClient.getQueryData<DealSummary[]>(key),
        }));

        const dealIdStr = String(dealId);

        queryClient.setQueryData<DealDetail | undefined>(detailQueryKey, (current) =>
          current ? { ...current, [field]: value } : current,
        );

        for (const { key } of previousSummaries) {
          queryClient.setQueryData<DealSummary[] | undefined>(key, (current) => {
            if (!Array.isArray(current)) return current;
            let changed = false;
            const next = current.map((item) => {
              const summaryId = resolveSummaryDealId(item);
              if (summaryId && summaryId === dealIdStr) {
                changed = true;
                return { ...item!, [field]: value };
              }
              return item;
            });
            return changed ? next : current;
          });
        }

        return { previousDetail, previousSummaries } satisfies MutationContext;
      },
      onError: (_error, _variables, context) => {
        if (context?.previousDetail !== undefined) {
          queryClient.setQueryData(detailQueryKey, context.previousDetail);
        }
        if (context?.previousSummaries) {
          for (const entry of context.previousSummaries) {
            queryClient.setQueryData(entry.key, entry.data);
          }
        }
      },
      onSettled: () => {
        setPendingField(null);
      },
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: detailQueryKey });
      },
    },
  );

  const toggleFollowUp = (field: FollowUpFieldKey, value: boolean) =>
    mutation.mutateAsync({ field, value });

  return {
    toggleFollowUp,
    isLoading: mutation.isPending,
    pendingField,
  };
}
