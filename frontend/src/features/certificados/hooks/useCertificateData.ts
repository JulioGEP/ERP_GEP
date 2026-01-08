import { useCallback, useMemo, useRef, useState } from 'react';

import type { DealDetail, DealProduct } from '../../../types/deal';
import type { SessionGroupDTO, SessionStudent } from "../../../api/sessions.types";
import { fetchDealDetail } from "../../presupuestos/api/deals.api";
import { fetchDealSessions } from "../../presupuestos/api/sessions.api";
import { fetchSessionStudents } from "../../presupuestos/api/students.api";
import {
  mapSessionToCertificateSession,
  mapStudentsToCertificateRows,
  type CertificateRow,
  type CertificateSession,
} from '../lib/mappers';

const CERTIFICATE_SESSIONS_PAGE_LIMIT = 30;

function resolveErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return 'Ha ocurrido un error inesperado';
}

function buildProductMap(deal: DealDetail | null): Map<string, DealProduct> {
  const map = new Map<string, DealProduct>();
  const products = deal?.products ?? [];
  for (const product of products) {
    if (!product) continue;
    const id = product.id != null ? String(product.id) : '';
    if (!id) continue;
    map.set(id, product);
  }
  return map;
}

function flattenSessionGroups(
  groups: SessionGroupDTO[],
  products: Map<string, DealProduct>,
): CertificateSession[] {
  const items: CertificateSession[] = [];
  for (const group of groups) {
    if (!group?.sessions?.length) continue;
    const fallbackProductName = group.product?.name ?? null;

    for (const session of group.sessions) {
      if (!session) continue;
      const product = products.get(String(session.deal_product_id));
      items.push(
        mapSessionToCertificateSession(session, {
          product: product ?? null,
          fallbackProductName,
        }),
      );
    }
  }
  return items;
}

async function fetchAllDealSessions(dealId: string): Promise<SessionGroupDTO[]> {
  const initialGroups = await fetchDealSessions(dealId, {
    page: 1,
    limit: CERTIFICATE_SESSIONS_PAGE_LIMIT,
  });

  const expandedGroups = await Promise.all(
    initialGroups.map(async (group) => {
      const totalPages = group.pagination?.totalPages ?? 1;
      const productId = group.product?.id;

      if (!productId || totalPages <= 1) {
        return group;
      }

      const pageRequests = [];
      for (let page = 2; page <= totalPages; page += 1) {
        pageRequests.push(
          fetchDealSessions(dealId, {
            productId,
            page,
            limit: CERTIFICATE_SESSIONS_PAGE_LIMIT,
          }),
        );
      }

      const pageGroups = await Promise.all(pageRequests);
      const mergedSessions = [...group.sessions];

      for (const groups of pageGroups) {
        const nextGroup =
          groups.find((item) => item.product?.id === productId) ?? groups[0];
        if (nextGroup?.sessions?.length) {
          mergedSessions.push(...nextGroup.sessions);
        }
      }

      return {
        ...group,
        sessions: mergedSessions,
        pagination: {
          ...group.pagination,
          page: 1,
          totalPages,
        },
      };
    }),
  );

  return expandedGroups;
}

export function useCertificateData() {
  const [deal, setDeal] = useState<DealDetail | null>(null);
  const [sessions, setSessions] = useState<CertificateSession[]>([]);
  const [students, setStudents] = useState<SessionStudent[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);

  const [loadingDeal, setLoadingDeal] = useState(false);
  const [loadingStudents, setLoadingStudents] = useState(false);

  const [dealError, setDealError] = useState<string | null>(null);
  const [studentsError, setStudentsError] = useState<string | null>(null);

  const sessionRequestIdRef = useRef(0);

  const resetState = useCallback(() => {
    setDeal(null);
    setSessions([]);
    setStudents([]);
    setSelectedSessionId(null);
  }, []);

  // ⬇️ Acepta string | number | null | undefined y normaliza internamente
  const loadStudentsForSession = useCallback(
    async (
      dealId: string | number | null | undefined,
      sessionId: string | number | null | undefined
    ) => {
      const normalizedDealId = String(dealId ?? '').trim();
      const normalizedSessionId = String(sessionId ?? '').trim();

      if (!normalizedDealId || !normalizedSessionId) {
        setStudents([]);
        return;
      }

      const requestId = ++sessionRequestIdRef.current;
      setLoadingStudents(true);
      setStudentsError(null);

      try {
        const list = await fetchSessionStudents(normalizedDealId, normalizedSessionId);
        if (sessionRequestIdRef.current === requestId) {
          setStudents(list);
        }
      } catch (error) {
        if (sessionRequestIdRef.current === requestId) {
          setStudents([]);
          setStudentsError(resolveErrorMessage(error));
        }
      } finally {
        if (sessionRequestIdRef.current === requestId) {
          setLoadingStudents(false);
        }
      }
    },
    [],
  );

  const loadDealAndSessions = useCallback(
    async (dealId: string | number, options?: { presetSessionId?: string | null }) => {
      const normalizedDealId = String(dealId ?? '').trim();
      const normalizedPresetSessionId = options?.presetSessionId
        ? String(options.presetSessionId).trim()
        : '';

      sessionRequestIdRef.current = 0;
      resetState();
      setDealError(null);
      setStudentsError(null);
      setLoadingStudents(false);

      if (!normalizedDealId) {
        setDealError('Introduce un número de deal válido');
        return;
      }

      setLoadingDeal(true);

      try {
        const [dealDetail, sessionGroups] = await Promise.all([
          fetchDealDetail(normalizedDealId),
          fetchAllDealSessions(normalizedDealId),
        ]);

        setDeal(dealDetail);

        const productMap = buildProductMap(dealDetail);
        const flattenedSessions = flattenSessionGroups(sessionGroups, productMap);
        setSessions(flattenedSessions);

        const presetSession = normalizedPresetSessionId
          ? flattenedSessions.find(
              (session) => String(session.id).trim() === normalizedPresetSessionId,
            )
          : null;

        if (presetSession) {
          setSelectedSessionId(presetSession.id);
          await loadStudentsForSession(dealDetail.deal_id, presetSession.id);
          return;
        }

        if (flattenedSessions.length === 1) {
          const onlySession = flattenedSessions[0];
          setSelectedSessionId(onlySession.id);
          // ⬇️ Ahora compila aunque deal_id sea string | null
          await loadStudentsForSession(dealDetail.deal_id, onlySession.id);
          return;
        }

        setSelectedSessionId(null);
        setStudents([]);
      } catch (error) {
        resetState();
        setDealError(resolveErrorMessage(error));
      } finally {
        setLoadingDeal(false);
      }
    },
    [loadStudentsForSession, resetState],
  );

  const selectSession = useCallback(
    async (sessionId: string | null) => {
      const normalizedSessionId = sessionId ? String(sessionId).trim() : '';
      if (!normalizedSessionId) {
        sessionRequestIdRef.current += 1;
        setSelectedSessionId(null);
        setStudents([]);
        setStudentsError(null);
        setLoadingStudents(false);
        return;
      }

      setSelectedSessionId(normalizedSessionId);

      if (!deal?.deal_id) {
        return;
      }

      await loadStudentsForSession(deal.deal_id, normalizedSessionId);
    },
    [deal?.deal_id, loadStudentsForSession],
  );

  const resetAll = useCallback(() => {
    sessionRequestIdRef.current += 1;
    resetState();
    setDealError(null);
    setStudentsError(null);
    setLoadingDeal(false);
    setLoadingStudents(false);
  }, [resetState]);

  const selectedSession = useMemo(
    () => sessions.find((session) => session.id === selectedSessionId) ?? null,
    [sessions, selectedSessionId],
  );

  const rows: CertificateRow[] = useMemo(
    () => mapStudentsToCertificateRows({ students, deal, session: selectedSession }),
    [students, deal, selectedSession],
  );

  return {
    deal,
    sessions,
    students,
    selectedSessionId,
    selectedSession,
    rows,
    loadingDeal,
    loadingStudents,
    dealError,
    studentsError,
    loadDealAndSessions,
    selectSession,
    resetAll,
  };
}
