import { useCallback, useEffect, useState, type ComponentProps, type ComponentType } from 'react';
import { Container, Nav, Navbar, Toast, ToastContainer, NavDropdown } from 'react-bootstrap';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BudgetImportModal } from './features/presupuestos/BudgetImportModal';
import { BudgetDetailModalEmpresas } from './features/presupuestos/empresas/BudgetDetailModalEmpresas';
import { BudgetDetailModalAbierta } from './features/presupuestos/abierta/BudgetDetailModalAbierta';
import { BudgetDetailModalServices } from './features/presupuestos/services/BudgetDetailModalServices';
import { BudgetDetailModalMaterial } from './features/presupuestos/material/BudgetDetailModalMaterial';
import { ProductCommentWindow } from './features/presupuestos/ProductCommentWindow';
import type { ProductCommentPayload } from './features/presupuestos/ProductCommentWindow';
import { ApiError } from './api/client';
import {
  deleteDeal,
  fetchDealDetail,
  fetchDealsWithoutSessions,
  importDeal,
} from './features/presupuestos/api/deals.api';
import {
  fetchDealSessions,
  fetchDealStudents,
  createSessionStudent,
  updateSessionStudent,
  type SessionDTO,
  type SessionGroupDTO,
  type SessionStudent,
} from './features/presupuestos/api';
import {
  DEALS_WITHOUT_SESSIONS_QUERY_KEY,
  DEALS_WITHOUT_SESSIONS_FALLBACK_QUERY_KEY,
} from './features/presupuestos/queryKeys';
import { normalizeImportDealResult } from './features/presupuestos/importDealUtils';
import {
  diffNoteStudents,
  extractNoteStudents,
  pickDefaultSessionId,
} from './features/presupuestos/abierta/noteStudents';
import type { CalendarSession } from './features/calendar/api';
import type { DealDetail, DealSummary } from './types/deal';
import logo from './assets/gep-group-logo.png';
import { PublicSessionStudentsPage } from './public/PublicSessionStudentsPage';
import { AppRouter } from './app/router';
import type { BudgetsPageProps } from './pages/presupuestos/BudgetsPage';
import type { PorSesionesPageProps } from './pages/calendario/PorSesionesPage';
import type { PorUnidadMovilPageProps } from './pages/calendario/PorUnidadMovilPage';
import type { PorFormadorPageProps } from './pages/calendario/PorFormadorPage';
import type { FormadoresBomberosPageProps } from './pages/recursos/FormadoresBomberosPage';
import type { UnidadesMovilesPageProps } from './pages/recursos/UnidadesMovilesPage';
import type { SalasPageProps } from './pages/recursos/SalasPage';
import type { TemplatesCertificadosPageProps } from './pages/recursos/TemplatesCertificadosPage';
import type { ProductosPageProps } from './pages/recursos/ProductosPage';
import type { CertificadosPageProps } from './pages/certificados/CertificadosPage';
import type { RecursosFormacionAbiertaPageProps } from './pages/recursos/FormacionAbiertaPage';
import { TOAST_EVENT, type ToastEventDetail } from './utils/toast';

const ACTIVE_PATH_STORAGE_KEY = 'erp-gep-active-path';

type NavChild = {
  key: string;
  label: string;
  path: string;
};

type NavItem = {
  key: string;
  label: string;
  path?: string;
  children?: NavChild[];
};

const NAVIGATION_ITEMS: NavItem[] = [
  {
    key: 'Presupuestos',
    label: 'Presupuestos',
    children: [
      { key: 'Presupuestos/SinPlanificar', label: 'Sin planificar', path: '/presupuestos/sinplanificar' },
    ],
  },
  {
    key: 'Calendario',
    label: 'Calendario',
    children: [
      { key: 'Calendario/Sesiones', label: 'Por sesiones', path: '/calendario/por_sesiones' },
      { key: 'Calendario/Formadores', label: 'Por formador', path: '/calendario/por_formador' },
      { key: 'Calendario/Unidades', label: 'Por unidad móvil', path: '/calendario/por_unidad_movil' },
    ],
  },
  {
    key: 'Recursos',
    label: 'Recursos',
    children: [
      { key: 'Recursos/Formadores', label: 'Formadores / Bomberos', path: '/recursos/formadores_bomberos' },
      { key: 'Recursos/Unidades', label: 'Unidades Móviles', path: '/recursos/unidades_moviles' },
      { key: 'Recursos/Salas', label: 'Salas', path: '/recursos/salas' },
      { key: 'Recursos/Productos', label: 'Productos', path: '/recursos/productos' },
      { key: 'Recursos/FormacionAbierta', label: 'Formación Abierta', path: '/recursos/formacion_abierta' },
    ],
  },
  {
    key: 'Certificados',
    label: 'Certificados',
    path: '/certificados',
    children: [
      { key: 'Certificados/Principal', label: 'Certificados', path: '/certificados' },
      {
        key: 'Certificados/Templates',
        label: 'Plantillas de Certificados',
        path: '/certificados/templates_certificados',
      },
    ],
  },
  {
    key: 'Informes',
    label: 'Informes',
    children: [
      { key: 'Informes/Formacion', label: 'Formación', path: '/informes/formacion' },
      { key: 'Informes/Preventivo', label: 'Preventivo', path: '/informes/preventivo' },
      { key: 'Informes/Simulacro', label: 'Simulacro', path: '/informes/simulacro' },
      {
        key: 'Informes/RecursoPreventivoEbro',
        label: 'Recurso Preventivo EBRO',
        path: '/informes/recurso_preventivo_ebro',
      },
    ],
  },
];

const LEGACY_APP_PATHS = ['/formacion_abierta/cursos'] as const;

const KNOWN_APP_PATHS = new Set(
  [
    ...NAVIGATION_ITEMS.flatMap((item) => [item.path, ...(item.children?.map((child) => child.path) ?? [])]),
    ...LEGACY_APP_PATHS,
  ].filter((path): path is string => Boolean(path))
);

const DEFAULT_REDIRECT_PATH = '/presupuestos/sinplanificar';

type BudgetModalProps = ComponentProps<typeof BudgetDetailModalEmpresas>;

function normalizePipelineKey(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function normalizeOptionalString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function normalizeDealId(value: unknown): string | null {
  return normalizeOptionalString(value);
}

function buildSummaryFromDeal(deal: DealDetail | DealSummary): DealSummary {
  const base = deal as DealSummary;
  const resolvedDealId =
    normalizeDealId((deal as any)?.dealId) ??
    normalizeDealId((deal as any)?.deal_id) ??
    normalizeDealId(base?.dealId) ??
    normalizeDealId(base?.deal_id) ??
    '';

  const pipelineLabel =
    normalizeOptionalString((deal as any)?.pipeline_label) ?? base.pipeline_label ?? null;

  const pipelineId =
    normalizeOptionalString((deal as any)?.pipeline_id) ??
    normalizeOptionalString((deal as any)?.deal_pipeline_id) ??
    pipelineLabel ??
    (base.pipeline_id ?? null);

  const trainingAddress =
    normalizeOptionalString((deal as any)?.training_address) ??
    base.training_address ??
    null;

  const title =
    normalizeOptionalString((deal as any)?.title) ??
    normalizeOptionalString(base?.title) ??
    resolvedDealId;

  const summary: DealSummary = {
    ...base,
    deal_id: resolvedDealId,
    dealId: resolvedDealId,
    title,
    pipeline_label: pipelineLabel,
    pipeline_id: pipelineId,
    training_address: trainingAddress,
    organization: (deal as any)?.organization ?? base.organization ?? null,
    person: (deal as any)?.person ?? base.person ?? null,
  };

  return summary;
}

type BudgetModalConfig = {
  component: ComponentType<BudgetModalProps>;
  keys: readonly string[];
};

const BUDGET_MODAL_CONFIG: readonly BudgetModalConfig[] = [
  { component: BudgetDetailModalEmpresas, keys: ['Formación Empresas', 'Formación Empresa'] },
  { component: BudgetDetailModalAbierta, keys: ['Formación Abierta'] },
  { component: BudgetDetailModalServices, keys: ['GEP Services'] },
  { component: BudgetDetailModalMaterial, keys: ['Material'] },
];

const BUDGET_MODAL_COMPONENTS = new Map<string, ComponentType<BudgetModalProps>>(
  BUDGET_MODAL_CONFIG.flatMap(({ component, keys }) =>
    keys
      .map(normalizePipelineKey)
      .filter((key) => key.length > 0)
      .map((key) => [key, component] as const),
  ),
);

const KNOWN_PIPELINE_KEYS = new Set(BUDGET_MODAL_COMPONENTS.keys());

function resolveBudgetModalComponent(
  keyCandidates: readonly unknown[],
): ComponentType<BudgetModalProps> {
  for (const candidate of keyCandidates) {
    const normalized = normalizePipelineKey(candidate);
    if (!normalized.length) {
      continue;
    }
    const component = BUDGET_MODAL_COMPONENTS.get(normalized);
    if (component) {
      return component;
    }
  }
  return BudgetDetailModalEmpresas;
}

type ToastMessage = {
  id: string;
  variant: 'success' | 'danger' | 'info' | 'warning';
  message: string;
};

export default function App() {
  const isPublicStudentsPage =
    typeof window !== 'undefined' && /\/public\/sesiones\/[^/]+\/alumnos/i.test(window.location.pathname);

  if (isPublicStudentsPage) {
    return <PublicSessionStudentsPage />;
  }

  const location = useLocation();
  const navigate = useNavigate();
  const isBudgetsRoute = location.pathname.startsWith('/presupuestos');

  const [showImportModal, setShowImportModal] = useState(false);
  const [selectedBudgetId, setSelectedBudgetId] = useState<string | null>(null);
  const [selectedBudgetSummary, setSelectedBudgetSummary] = useState<DealSummary | null>(null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [productComment, setProductComment] = useState<ProductCommentPayload | null>(null);
  const [importResultWarnings, setImportResultWarnings] = useState<string[] | null>(null);
  const [importResultDealId, setImportResultDealId] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [recentlyImportedBudgetId, setRecentlyImportedBudgetId] = useState<string | null>(null);

  const queryClient = useQueryClient();

  useEffect(() => {
    if (!selectedBudgetId) {
      setProductComment(null);
    }
  }, [selectedBudgetId]);

  const budgetsQuery = useQuery({
    queryKey: DEALS_WITHOUT_SESSIONS_QUERY_KEY,
    queryFn: fetchDealsWithoutSessions,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchInterval: false,
    retry: 0,
    staleTime: Infinity,
    enabled: isBudgetsRoute,
  });

  useEffect(() => {
    if (!budgetsQuery.isSuccess) {
      return;
    }
    const data = budgetsQuery.data;
    if (!Array.isArray(data) || data.length === 0) {
      return;
    }
    queryClient.setQueryData(DEALS_WITHOUT_SESSIONS_FALLBACK_QUERY_KEY, data);
  }, [budgetsQuery.data, budgetsQuery.isSuccess, queryClient]);

  const pushToast = useCallback((toast: Omit<ToastMessage, 'id'>) => {
    const id =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random()}`;
    setToasts((prev) => [...prev, { ...toast, id }]);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const handleOpenImportModal = useCallback(() => {
    setImportResultWarnings(null);
    setImportResultDealId(null);
    setImportError(null);
    setShowImportModal(true);
  }, []);

  const handleCloseImportModal = useCallback(() => {
    setShowImportModal(false);
    setImportResultWarnings(null);
    setImportResultDealId(null);
    setImportError(null);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleGlobalToast = (event: Event) => {
      const detail = (event as CustomEvent<ToastEventDetail>).detail;
      if (!detail || typeof detail.message !== 'string') {
        return;
      }
      const variant = detail.variant ?? 'info';
      pushToast({ variant, message: detail.message });
    };

    window.addEventListener(TOAST_EVENT, handleGlobalToast as EventListener);
    return () => {
      window.removeEventListener(TOAST_EVENT, handleGlobalToast as EventListener);
    };
  }, [pushToast]);

  const importMutation = useMutation({
    mutationFn: (dealId: string) => importDeal(dealId),
    onMutate: () => {
      setImportError(null);
      setImportResultDealId(null);
      setImportResultWarnings(null);
    },
    onSuccess: async (payload) => {
      const { deal, warnings } = normalizeImportDealResult(payload);

      let dealDetail: DealDetail | null = deal ? (deal as DealDetail) : null;

      const syncNoteStudentsFromNotes = async (dealId: string, detail: DealDetail | null) => {
        const normalizedDealIdValue = normalizeOptionalString(dealId);
        if (!normalizedDealIdValue) {
          return;
        }

        let detailWithNotes = detail;
        if (!detailWithNotes || !Array.isArray(detailWithNotes.notes) || detailWithNotes.notes.length === 0) {
          try {
            detailWithNotes = await fetchDealDetail(normalizedDealIdValue);
            queryClient.setQueryData(['deal', normalizedDealIdValue], detailWithNotes);
            dealDetail = detailWithNotes;
          } catch (error) {
            console.error(
              '[App] No se pudo obtener el detalle del presupuesto para sincronizar alumnos',
              error,
            );
            return;
          }
        }
        if (!detailWithNotes) {
          return;
        }

        const noteInfo = extractNoteStudents(detailWithNotes.notes);
        if (!noteInfo.students.length) {
          return;
        }

        const productIds = Array.isArray(detailWithNotes.products)
          ? detailWithNotes.products
              .map((product) => {
                if (!product) return null;
                const code = typeof product.code === 'string' ? product.code.trim().toLowerCase() : '';
                if (code.startsWith('ext-')) {
                  return null;
                }
                if (product.id === null || product.id === undefined) {
                  return null;
                }
                const normalized = String(product.id).trim();
                return normalized.length ? normalized : null;
              })
              .filter((id): id is string => Boolean(id))
          : [];

        const fetchSessionsForProducts = async (): Promise<SessionDTO[]> => {
          const pageSize = 200;
          const sessionsMap = new Map<string, SessionDTO>();
          const productsToFetch = productIds.length ? productIds : [null];

          for (const productId of productsToFetch) {
            let page = 1;
            let hasMore = true;
            while (hasMore) {
              const options: { productId?: string; page: number; limit: number } = {
                page,
                limit: pageSize,
              };
              if (productId) {
                options.productId = productId;
              }
              const groups: SessionGroupDTO[] = await fetchDealSessions(normalizedDealIdValue, options);
              if (!Array.isArray(groups) || !groups.length) {
                break;
              }

              for (const group of groups) {
                if (!group || !Array.isArray(group.sessions)) {
                  continue;
                }
                for (const session of group.sessions) {
                  if (!session || typeof session.id !== 'string') {
                    continue;
                  }
                  const trimmedId = session.id.trim();
                  if (!trimmedId.length) {
                    continue;
                  }
                  sessionsMap.set(trimmedId, session);
                }
              }

              const pagination = groups[0]?.pagination ?? null;
              if (!pagination) {
                break;
              }
              const totalPages = Number(pagination.totalPages ?? 1);
              if (!Number.isFinite(totalPages) || totalPages <= page) {
                hasMore = false;
              } else {
                page += 1;
              }
            }
          }

          return Array.from(sessionsMap.values());
        };

        try {
          const sessions = await fetchSessionsForProducts();
          if (!sessions.length) {
            return;
          }
          const defaultSessionId = pickDefaultSessionId(sessions);
          if (!defaultSessionId) {
            return;
          }

          const existingStudents = await fetchDealStudents(normalizedDealIdValue);
          const diff = diffNoteStudents(noteInfo.students, existingStudents);
          if (!diff.toCreate.length && !diff.toUpdate.length) {
            return;
          }

          let createdCount = 0;
          let updatedCount = 0;

          for (const update of diff.toUpdate) {
            try {
              await updateSessionStudent(update.id, {
                nombre: update.nombre,
                apellido: update.apellido,
              });
              updatedCount += 1;
            } catch (error) {
              if (error instanceof ApiError && error.code === 'NOT_FOUND') {
                continue;
              }
              throw error;
            }
          }

          for (const student of diff.toCreate) {
            try {
              await createSessionStudent({
                dealId: normalizedDealIdValue,
                sessionId: defaultSessionId,
                nombre: student.nombre,
                apellido: student.apellido,
                dni: student.dni,
              });
              createdCount += 1;
            } catch (error) {
              if (error instanceof ApiError && error.code === 'DUPLICATE_DNI') {
                continue;
              }
              throw error;
            }
          }

          if (createdCount > 0 || updatedCount > 0) {
            const parts: string[] = [];
            if (createdCount > 0) {
              parts.push(`${createdCount} ${createdCount === 1 ? 'alumno creado' : 'alumnos creados'}`);
            }
            if (updatedCount > 0) {
              parts.push(`${updatedCount} ${updatedCount === 1 ? 'alumno actualizado' : 'alumnos actualizados'}`);
            }
            pushToast({
              variant: 'success',
              message: `Alumnos sincronizados desde la nota (${parts.join(' y ')})`,
            });
          }

          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ['dealStudents', normalizedDealIdValue] }),
            queryClient.invalidateQueries({ queryKey: ['session-students', normalizedDealIdValue, defaultSessionId] }),
          ]);
        } catch (error) {
          const baseMessage =
            error instanceof ApiError
              ? `No se pudieron sincronizar los alumnos de la nota. [${error.code}] ${error.message}`
              : error instanceof Error
              ? `No se pudieron sincronizar los alumnos de la nota. ${error.message}`
              : 'No se pudieron sincronizar los alumnos de la nota.';
          console.error('[App] Error al sincronizar alumnos de nota tras importar', error);
          pushToast({ variant: 'danger', message: baseMessage });
        }
      };

      let summary: DealSummary | null = null;
      let normalizedDealId: string | null = null;

      if (deal) {
        summary = buildSummaryFromDeal(deal as DealDetail | DealSummary);
        normalizedDealId = summary.dealId ?? summary.deal_id ?? null;

        if (normalizedDealId) {
          const detailForCache: DealDetail = {
            ...(deal as DealDetail),
            deal_id: normalizedDealId,
          };
          dealDetail = detailForCache;
          queryClient.setQueryData<DealDetail | undefined>(
            ['deal', normalizedDealId],
            (current) => {
              const mergedDetail: DealDetail = {
                ...(current ?? {}),
                ...detailForCache,
                deal_id: normalizedDealId,
              };
              return mergedDetail;
            },
          );
        }

      }

      const extractPipelineInfo = (
        source: DealSummary | null | undefined,
      ): { info: string | null; key: string } => {
        const info =
          normalizeOptionalString(source?.pipeline_label) ??
          normalizeOptionalString(source?.pipeline_id);
        const key = info ? normalizePipelineKey(info) : '';
        return { info, key };
      };

      if (summary && normalizedDealId) {
        let { info: pipelineInfo, key: pipelineKey } = extractPipelineInfo(summary);

        const ensurePipelineFromDetail = async () => {
          if (!normalizedDealId) return;

          const cachedDetail = queryClient.getQueryData<DealDetail>([
            'deal',
            normalizedDealId,
          ]);
          if (cachedDetail) {
            dealDetail = cachedDetail;
            summary = buildSummaryFromDeal(cachedDetail);
            normalizedDealId = summary.dealId ?? summary.deal_id ?? normalizedDealId;
            const extracted = extractPipelineInfo(summary);
            pipelineInfo = extracted.info;
            pipelineKey = extracted.key;
          }

          if (!pipelineInfo || !pipelineKey || !KNOWN_PIPELINE_KEYS.has(pipelineKey)) {
            try {
              const refreshedDetail = await fetchDealDetail(normalizedDealId);
              queryClient.setQueryData(['deal', normalizedDealId], refreshedDetail);
              dealDetail = refreshedDetail;
              summary = buildSummaryFromDeal(refreshedDetail);
              normalizedDealId = summary.dealId ?? summary.deal_id ?? normalizedDealId;
              const extracted = extractPipelineInfo(summary);
              pipelineInfo = extracted.info;
              pipelineKey = extracted.key;
            } catch (error) {
              console.error(
                '[App] No se pudo obtener el pipeline del presupuesto importado',
                error,
              );
            }
          }
        };

        if (!pipelineInfo || !pipelineKey || !KNOWN_PIPELINE_KEYS.has(pipelineKey)) {
          await ensurePipelineFromDetail();
        }
      }

      const normalizedId = normalizeDealId(normalizedDealId);
      setImportResultWarnings(warnings);
      setImportResultDealId(normalizedId);
      setImportError(null);

      if (summary && normalizedId) {
        const summaryWithNormalizedId: DealSummary = {
          ...summary,
          deal_id: normalizedId,
          dealId: normalizedId,
        };

        queryClient.setQueryData<DealSummary[]>(
          DEALS_WITHOUT_SESSIONS_QUERY_KEY,
          (current = []) => {
            const existingIndex = current.findIndex((item) => {
              const currentId = normalizeDealId(item.dealId ?? item.deal_id);
              return currentId === normalizedId;
            });

            if (existingIndex >= 0) {
              const next = current.slice();
              next[existingIndex] = { ...next[existingIndex], ...summaryWithNormalizedId };
              return next;
            }

            return [summaryWithNormalizedId, ...current];
          },
        );
        setRecentlyImportedBudgetId(normalizedId);

        if (pipelineKey === 'formacion abierta') {
          await syncNoteStudentsFromNotes(normalizedId, dealDetail);
        }
      } else {
        setRecentlyImportedBudgetId(null);
      }

      pushToast({ variant: 'success', message: 'Presupuesto importado' });
    },
    onError: (error: unknown) => {
      const apiError = error instanceof ApiError ? error : null;
      const code = apiError?.code ?? 'UNKNOWN_ERROR';
      const message =
        apiError?.message ?? 'No se ha podido importar el presupuesto. Inténtalo de nuevo más tarde.';
      const detailedMessage = `No se pudo importar. [${code}] ${message}`;
      setImportError(detailedMessage);
      setImportResultDealId(null);
      setImportResultWarnings(null);
      pushToast({ variant: 'danger', message: detailedMessage });
    }
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (KNOWN_APP_PATHS.has(location.pathname)) {
      try {
        window.localStorage.setItem(ACTIVE_PATH_STORAGE_KEY, location.pathname);
      } catch (error) {
        console.warn('No se pudo guardar la ruta activa', error);
      }
    }
  }, [location.pathname]);

  useEffect(() => {
    if (!location.pathname.startsWith('/presupuestos')) {
      setShowImportModal(false);
    }
  }, [location.pathname]);

  const budgets = budgetsQuery.data ?? [];
  const isRefreshing = budgetsQuery.isFetching && !budgetsQuery.isLoading;

  useEffect(() => {
    if (!recentlyImportedBudgetId) {
      return;
    }
    const exists = budgets.some((item) => {
      const currentId = normalizeDealId(item.dealId ?? item.deal_id);
      return currentId === recentlyImportedBudgetId;
    });
    if (!exists) {
      setRecentlyImportedBudgetId(null);
    }
  }, [budgets, recentlyImportedBudgetId]);

  const deleteDealMutation = useMutation({
    mutationFn: (dealId: string) => deleteDeal(dealId),
    onSuccess: (_, dealId) => {
      setSelectedBudgetId((current) => (current === dealId ? null : current));
      setSelectedBudgetSummary((current) => {
        if (!current) return current;
        const currentId = current.dealId ?? current.deal_id;
        return currentId === dealId ? null : current;
      });
      pushToast({ variant: 'success', message: 'Presupuesto eliminado' });
      queryClient.invalidateQueries({ queryKey: DEALS_WITHOUT_SESSIONS_QUERY_KEY });
    },
    onError: (error: unknown) => {
      const message =
        error instanceof ApiError
          ? error.message
          : error instanceof Error
          ? error.message
          : 'No se pudo eliminar el presupuesto.';
      pushToast({ variant: 'danger', message });
    },
  });

  const handleSelectBudget = useCallback((budget: DealSummary) => {
    setSelectedBudgetSummary(budget);
    // 👇 asegura string | null
    setSelectedBudgetId(budget.dealId ?? null);
    setRecentlyImportedBudgetId((current) => {
      if (!current) return current;
      const normalizedSelectedId = normalizeDealId(budget.dealId ?? budget.deal_id);
      return normalizedSelectedId === current ? null : current;
    });
  }, []);

  const handleDeleteBudget = useCallback(
    async (budget: DealSummary) => {
      const rawId = budget.dealId ?? budget.deal_id;
      const id = typeof rawId === 'string' ? rawId.trim() : '';
      if (!id) {
        throw new Error('No se pudo determinar el identificador del presupuesto.');
      }

      await deleteDealMutation.mutateAsync(id);
    },
    [deleteDealMutation]
  );

  const handleCloseDetail = useCallback(() => {
    setSelectedBudgetSummary(null);
    setSelectedBudgetId(null);
  }, []);

  const handleShowProductComment = useCallback((payload: ProductCommentPayload) => {
    setProductComment(payload);
  }, []);

  const handleCloseProductComment = useCallback(() => {
    setProductComment(null);
  }, []);

  const handleOpenCalendarSession = useCallback(
    (session: CalendarSession) => {
      void (async () => {
        const id = session.dealId?.trim();
        if (!id) {
          pushToast({ variant: 'danger', message: 'No se pudo determinar el identificador del presupuesto.' });
          return;
        }

        const dealTitle = session.dealTitle?.trim() ?? '';
        const sessionTitle = session.title.trim();
        const summaryTitle = dealTitle.length
          ? dealTitle
          : sessionTitle.length
          ? sessionTitle
          : `Presupuesto ${id}`;

        const productId = session.productId.trim();
        const productName = session.productName?.trim() ?? '';
        const productCode = session.productCode?.trim() ?? '';

        const hasProductInfo = Boolean(productId.length || productName.length || productCode.length);

        const productNames = productName.length
          ? [productName]
          : productCode.length
          ? [productCode]
          : undefined;

        const summaryFromSession: DealSummary = {
          deal_id: id,
          dealId: id,
          title: summaryTitle,
          training_address: session.dealAddress,
          organization: null,
          person: null,
          products: hasProductInfo
            ? [
                {
                  id: productId.length ? productId : null,
                  deal_id: id,
                  name: productName.length ? productName : null,
                  code: productCode.length ? productCode : null,
                  comments: null,
                  quantity: null,
                  price: null,
                  type: null,
                  hours: null,
                },
              ]
            : undefined,
          productNames,
        };

        const pipelineCandidate = session.dealPipelineId?.trim() ?? null;
        const pipelineCandidateKey = normalizePipelineKey(pipelineCandidate);
        let pipelineLabel =
          pipelineCandidate && KNOWN_PIPELINE_KEYS.has(pipelineCandidateKey) ? pipelineCandidate : null;
        let pipelineId = pipelineCandidate;

        if (!pipelineLabel) {
          let detail: DealDetail | null = queryClient.getQueryData<DealDetail>(['deal', id]) ?? null;
          if (!detail) {
            try {
              detail = await fetchDealDetail(id);
              queryClient.setQueryData(['deal', id], detail);
            } catch (error) {
              console.error('[App] Error al obtener el pipeline del presupuesto', error);
              pushToast({ variant: 'danger', message: 'No se pudo obtener el pipeline del presupuesto.' });
              return;
            }
          }

          if (detail) {
            pipelineLabel = detail.pipeline_label?.trim() ?? pipelineLabel;
            const detailPipelineId = (detail as any)?.pipeline_id;
            if (detailPipelineId != null) {
              const normalized = String(detailPipelineId).trim();
              if (normalized.length) {
                pipelineId = normalized;
              }
            }
          }
        }

        if (!pipelineLabel) {
          pushToast({ variant: 'danger', message: 'No se pudo determinar el pipeline del presupuesto.' });
          return;
        }

        const summaryWithPipeline: DealSummary = {
          ...summaryFromSession,
          pipeline_label: pipelineLabel,
          pipeline_id: pipelineId ?? pipelineLabel,
        };

        setSelectedBudgetSummary(summaryWithPipeline);
        setSelectedBudgetId(id);
      })();
    },
    [pushToast, queryClient],
  );

  const budgetsPageProps: BudgetsPageProps = {
    budgets,
    isLoading: budgetsQuery.isLoading,
    isFetching: isRefreshing,
    error: budgetsQuery.error ?? null,
    onRetry: () => budgetsQuery.refetch(),
    onSelect: handleSelectBudget,
    onDelete: handleDeleteBudget,
    onOpenImportModal: handleOpenImportModal,
    isImporting: importMutation.isPending,
    highlightBudgetId: recentlyImportedBudgetId,
  };

  const calendarSessionsPageProps: PorSesionesPageProps = {
    onNotify: pushToast,
    onSessionOpen: handleOpenCalendarSession,
  };

  const calendarUnitsPageProps: PorUnidadMovilPageProps = {
    onNotify: pushToast,
    onSessionOpen: handleOpenCalendarSession,
  };

  const calendarTrainersPageProps: PorFormadorPageProps = {
    onNotify: pushToast,
    onSessionOpen: handleOpenCalendarSession,
  };

  const formadoresBomberosPageProps: FormadoresBomberosPageProps = {
    onNotify: pushToast,
  };

  const unidadesMovilesPageProps: UnidadesMovilesPageProps = {
    onNotify: pushToast,
  };

  const salasPageProps: SalasPageProps = {
    onNotify: pushToast,
  };

  const templatesCertificadosPageProps: TemplatesCertificadosPageProps = {
    onNotify: pushToast,
  };

  const productosPageProps: ProductosPageProps = {
    onNotify: pushToast,
  };

  const certificadosPageProps: CertificadosPageProps = {};
  const recursosFormacionAbiertaPageProps: RecursosFormacionAbiertaPageProps = {};

  const pipelineLabelKey = (selectedBudgetSummary?.pipeline_label ?? '').trim();
  const pipelineIdKey =
    selectedBudgetSummary?.pipeline_id != null
      ? String(selectedBudgetSummary.pipeline_id).trim()
      : '';

  const BudgetModalComponent = resolveBudgetModalComponent([pipelineLabelKey, pipelineIdKey]);

  const budgetModalProps: BudgetModalProps = {
    dealId: selectedBudgetId,
    summary: selectedBudgetSummary,
    onClose: handleCloseDetail,
    onShowProductComment: handleShowProductComment,
    onNotify: pushToast,
  };

  return (
    <div className="min-vh-100 d-flex flex-column">
      <Navbar bg="white" expand="lg" className="shadow-sm py-3">
        <Container fluid="xl" className="d-flex align-items-center gap-4">
          <Navbar.Brand
            href="#"
            className="d-flex align-items-center gap-3"
            onClick={(event) => {
              event.preventDefault();
              navigate(DEFAULT_REDIRECT_PATH);
            }}
          >
            <img src={logo} height={64} alt="GEP Group" />
            <div>
              <span className="d-block fw-semibold text-uppercase small text-muted">GEP Group</span>
              <span className="d-block fw-bold" style={{ color: 'var(--color-red)' }}>
                Planificador
              </span>
            </div>
          </Navbar.Brand>
          <Nav className="ms-auto gap-3">
            {NAVIGATION_ITEMS.map((item) =>
              item.children ? (
                <NavDropdown
                  key={item.key}
                  title={<span className="text-uppercase">{item.label}</span>}
                  id={`nav-${item.key}`}
                  active={item.children.some((child) => location.pathname.startsWith(child.path))}
                >
                  {item.children.map((child) => (
                    <NavDropdown.Item
                      key={child.key}
                      as={NavLink}
                      to={child.path}
                      className="text-uppercase"
                    >
                      {child.label}
                    </NavDropdown.Item>
                  ))}
                </NavDropdown>
              ) : (
                <Nav.Item key={item.key}>
                  <Nav.Link
                    as={NavLink}
                    to={item.path ?? '#'}
                    className="text-uppercase"
                  >
                    {item.label}
                  </Nav.Link>
                </Nav.Item>
              )
            )}
          </Nav>
        </Container>
      </Navbar>

      <main className="flex-grow-1 py-5">
        <Container fluid="xl">
          <AppRouter
            budgetsPageProps={budgetsPageProps}
            porSesionesPageProps={calendarSessionsPageProps}
            porUnidadMovilPageProps={calendarUnitsPageProps}
            porFormadorPageProps={calendarTrainersPageProps}
            formadoresBomberosPageProps={formadoresBomberosPageProps}
            unidadesMovilesPageProps={unidadesMovilesPageProps}
            salasPageProps={salasPageProps}
            templatesCertificadosPageProps={templatesCertificadosPageProps}
            productosPageProps={productosPageProps}
            certificadosPageProps={certificadosPageProps}
            recursosFormacionAbiertaPageProps={recursosFormacionAbiertaPageProps}
            defaultRedirectPath={DEFAULT_REDIRECT_PATH}
            knownPaths={KNOWN_APP_PATHS}
            activePathStorageKey={ACTIVE_PATH_STORAGE_KEY}
          />
        </Container>
      </main>

      <footer className="py-4 bg-white mt-auto border-top">
        <Container fluid="xl" className="text-muted small d-flex justify-content-between align-items-center">
          <span>© {new Date().getFullYear()} GEP Group</span>
          <span>ERP colaborativo para planificación de formaciones</span>
        </Container>
      </footer>

      <BudgetImportModal
        show={showImportModal}
        isLoading={importMutation.isPending}
        resultWarnings={importResultWarnings ?? undefined}
        resultDealId={importResultDealId ?? undefined}
        error={importError}
        onClose={handleCloseImportModal}
        onSubmit={(dealId) => importMutation.mutate(dealId)}
      />

      <BudgetModalComponent {...budgetModalProps} />

      <ProductCommentWindow
        show={!!productComment}
        productName={productComment?.productName ?? null}
        comment={productComment?.comment ?? null}
        onClose={handleCloseProductComment}
      />

      <ToastContainer position="bottom-end" className="p-3">
        {toasts.map((toast) => {
          const textClass = toast.variant === 'warning' ? 'text-dark' : 'text-white';
          return (
            <Toast
              key={toast.id}
              bg={toast.variant}
              onClose={() => removeToast(toast.id)}
              delay={5000}
              autohide
            >
              <Toast.Body className={textClass}>{toast.message}</Toast.Body>
            </Toast>
          );
        })}
      </ToastContainer>
    </div>
  );
}
