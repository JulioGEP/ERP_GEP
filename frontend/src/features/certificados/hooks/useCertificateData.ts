import { useCallback, useMemo, useRef, useState } from 'react';

import type { DealDetail, DealProduct } from '../../../types/deal';
import {
  fetchDealDetail,
  fetchDealSessions,
  fetchSessionStudents,
  type SessionGroupDTO,
  type SessionStudent,
} from '../../presupuestos/api';
import {
  mapSessionToCertificateSession,
  mapStudentsToCertificateRows,
  type CertificateRow,
  type CertificateSession,
} from '../lib/mappers';

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

  const loadStudentsForSession = useCallback(
    async (dealId: string, sessionId: string) => {
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
    async (dealId: string | number) => {
      const normalizedDealId = String(dealId ?? '').trim();

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
          fetchDealSessions(normalizedDealId),
        ]);

        setDeal(dealDetail);

        const productMap = buildProductMap(dealDetail);
        const flattenedSessions = flattenSessionGroups(sessionGroups, productMap);
        setSessions(flattenedSessions);

        if (flattenedSessions.length === 1) {
          const onlySession = flattenedSessions[0];
          setSelectedSessionId(onlySession.id);
          await loadStudentsForSession(dealDetail.deal_id, onlySession.id);
        } else {
          setSelectedSessionId(null);
          setStudents([]);
        }
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
  };
}
