import { useCallback, useEffect, useMemo, useState, type ComponentProps, type ComponentType } from 'react';
import { Alert, Button, Container, Nav, Navbar, NavDropdown, Spinner, Toast, ToastContainer } from 'react-bootstrap';
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BudgetImportModal } from './features/presupuestos/BudgetImportModal';
import { BudgetDetailModalEmpresas } from './features/presupuestos/empresas/BudgetDetailModalEmpresas';
import { BudgetDetailModalAbierta } from './features/presupuestos/abierta/BudgetDetailModalAbierta';
import { BudgetDetailModalServices } from './features/presupuestos/services/BudgetDetailModalServices';
import { BudgetDetailModalMaterial } from './features/presupuestos/material/BudgetDetailModalMaterial';
import { ProductCommentWindow } from './features/presupuestos/ProductCommentWindow';
import type { ProductCommentPayload } from './features/presupuestos/ProductCommentWindow';
import { ApiError } from "./api/client";
import {
  deleteDeal,
  fetchDealDetail,
  fetchDealsWithoutSessions,
  importDeal,
} from "./features/presupuestos/api/deals.api";
import {
  DEALS_WITHOUT_SESSIONS_QUERY_KEY,
  DEALS_WITHOUT_SESSIONS_FALLBACK_QUERY_KEY,
} from './features/presupuestos/queryKeys';
import {
  DEAL_NOT_WON_ERROR_CODE,
  DEAL_NOT_WON_ERROR_MESSAGE,
  normalizeImportDealResult,
} from './features/presupuestos/importDealUtils';
import type { CalendarSession } from './features/calendar/api';
import type { DealDetail, DealSummary } from './types/deal';
import logo from './assets/gep-group-logo.png';
import { PublicSessionStudentsPage } from './public/PublicSessionStudentsPage';
import { AppRouter } from './app/router';
import LoginPage from './pages/auth/LoginPage';
import ForgotPasswordPage from './pages/auth/ForgotPasswordPage';
import ResetPasswordPage from './pages/auth/ResetPasswordPage';
import { useCurrentUser } from './app/auth/UserContext';
import { logout as requestLogout } from './api/auth';
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
import { getAllowedPathsForRole, isRoleAllowedForPath, normalizeNavigationPath, resolveDefaultPathForRole } from './app/rbac';
import type { UserRole } from './types/user';

const ACTIVE_PATH_STORAGE_KEY = 'erp-gep-active-path';

type NavChildConfig = {
  key: string;
  label: string;
  path: string;
  allowedRoles?: readonly UserRole[];
};

type NavItemConfig = {
  key: string;
  label: string;
  path?: string;
  children?: NavChildConfig[];
  allowedRoles?: readonly UserRole[];
};

const NAVIGATION_ITEMS: readonly NavItemConfig[] = [
  {
    key: 'Presupuestos',
    label: 'Presupuestos',
    children: [
      {
        key: 'Presupuestos/SinPlanificar',
        label: 'Sin planificar',
        path: '/presupuestos/sinplanificar',
        allowedRoles: ['admin', 'comercial', 'administracion', 'logistica', 'people'],
      },
      {
        key: 'Presupuestos/SinTrabajar',
        label: 'Sin trabajar',
        path: '/presupuestos/sintrabajar',
        allowedRoles: ['admin', 'comercial', 'administracion', 'logistica', 'people'],
      },
    ],
    allowedRoles: ['admin', 'comercial', 'administracion', 'logistica', 'people'],
  },
  {
    key: 'Calendario',
    label: 'Calendario',
    children: [
      {
        key: 'Calendario/Sesiones',
        label: 'Por sesiones',
        path: '/calendario/por_sesiones',
        allowedRoles: ['admin'],
      },
      {
        key: 'Calendario/Formadores',
        label: 'Por formador',
        path: '/calendario/por_formador',
        allowedRoles: ['admin'],
      },
      {
        key: 'Calendario/Unidades',
        label: 'Por unidad móvil',
        path: '/calendario/por_unidad_movil',
        allowedRoles: ['admin'],
      },
    ],
    allowedRoles: ['admin'],
  },
  {
    key: 'Recursos',
    label: 'Recursos',
    children: [
      {
        key: 'Recursos/Formadores',
        label: 'Formadores / Bomberos',
        path: '/recursos/formadores_bomberos',
        allowedRoles: ['admin', 'people'],
      },
      {
        key: 'Recursos/Unidades',
        label: 'Unidades Móviles',
        path: '/recursos/unidades_moviles',
        allowedRoles: ['admin', 'logistica'],
      },
      {
        key: 'Recursos/Salas',
        label: 'Salas',
        path: '/recursos/salas',
        allowedRoles: ['admin', 'logistica'],
      },
      {
        key: 'Recursos/Productos',
        label: 'Productos',
        path: '/recursos/productos',
        allowedRoles: ['admin'],
      },
      {
        key: 'Recursos/FormacionAbierta',
        label: 'Formación Abierta',
        path: '/recursos/formacion_abierta',
        allowedRoles: ['admin'],
      },
    ],
  },
  {
    key: 'Certificados',
    label: 'Certificados',
    children: [
      {
        key: 'Certificados/Principal',
        label: 'Certificados',
        path: '/certificados',
        allowedRoles: ['admin', 'administracion'],
      },
      {
        key: 'Certificados/Templates',
        label: 'Plantillas de Certificados',
        path: '/certificados/templates_certificados',
        allowedRoles: ['admin', 'administracion'],
      },
    ],
    allowedRoles: ['admin', 'administracion'],
  },
  {
    key: 'Informes',
    label: 'Informes',
    children: [
      {
        key: 'Informes/Formacion',
        label: 'Formación',
        path: '/informes/formacion',
        allowedRoles: ['admin'],
      },
      {
        key: 'Informes/Preventivo',
        label: 'Preventivo',
        path: '/informes/preventivo',
        allowedRoles: ['admin'],
      },
      {
        key: 'Informes/Simulacro',
        label: 'Simulacro',
        path: '/informes/simulacro',
        allowedRoles: ['admin'],
      },
      {
        key: 'Informes/RecursoPreventivoEbro',
        label: 'Recurso Preventivo EBRO',
        path: '/informes/recurso_preventivo_ebro',
        allowedRoles: ['admin'],
      },
    ],
    allowedRoles: ['admin'],
  },
  {
    key: 'Usuarios',
    label: 'Usuarios',
    path: '/usuarios',
    allowedRoles: ['admin'],
  },
];

function canAccessNavEntry(
  role: UserRole,
  allowedRoles: readonly UserRole[] | undefined,
  path?: string,
): boolean {
  if (role === 'admin') {
    return true;
  }
  if (allowedRoles && allowedRoles.length > 0) {
    return allowedRoles.includes(role);
  }
  if (path) {
    return isRoleAllowedForPath(role, path);
  }
  return false;
}

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
const FORMACION_ABIERTA_PIPELINE_KEY = normalizePipelineKey('Formación Abierta');

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

function AuthenticatedApp() {
  const { user, setUser } = useCurrentUser();

  const role: UserRole = (user?.role as UserRole) ?? 'formador';

  const navigationItems = useMemo(() => {
    return NAVIGATION_ITEMS.map((item) => {
      const normalizedPath = item.path ? normalizeNavigationPath(item.path) : undefined;
      const normalizedChildren = item.children
        ?.map((child) => {
          const normalizedChildPath = normalizeNavigationPath(child.path);
          if (!canAccessNavEntry(role, child.allowedRoles, normalizedChildPath)) {
            return null;
          }
          return { ...child, path: normalizedChildPath };
        })
        .filter((child): child is NavChildConfig => Boolean(child));

      const itemAllowed =
        canAccessNavEntry(role, item.allowedRoles, normalizedPath) ||
        (normalizedChildren && normalizedChildren.length > 0);

      if (!itemAllowed) {
        return null;
      }

      return {
        ...item,
        path: normalizedPath,
        children: normalizedChildren,
      };
    }).filter((entry): entry is NavItemConfig => Boolean(entry));
  }, [role]);

  const allowedPaths = useMemo(() => getAllowedPathsForRole(role), [role]);

  const knownPaths = useMemo<ReadonlySet<string>>(() => {
    const paths = new Set<string>();
    allowedPaths.forEach((path) => paths.add(normalizeNavigationPath(path)));
    paths.add('/');
    return paths;
  }, [allowedPaths]);

  const defaultRedirectPath = useMemo(() => resolveDefaultPathForRole(role), [role]);

  const canImportBudget = role !== 'logistica';

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
  const [autoRefreshBudgetId, setAutoRefreshBudgetId] = useState<string | null>(null);

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

  const logoutMutation = useMutation({
    mutationFn: requestLogout,
    onSuccess: () => {
      setUser(null);
      queryClient.clear();
      navigate('/login', { replace: true });
    },
    onError: (error: unknown) => {
      console.error('No se pudo cerrar la sesión', error);
      pushToast({ variant: 'danger', message: 'No se pudo cerrar la sesión. Inténtalo de nuevo.' });
    },
  });

  const handleLogout = useCallback(() => {
    if (logoutMutation.isPending) {
      return;
    }
    logoutMutation.mutate();
  }, [logoutMutation]);

  const handleOpenImportModal = useCallback(() => {
    if (!canImportBudget) {
      return;
    }
    setImportResultWarnings(null);
    setImportResultDealId(null);
    setImportError(null);
    setShowImportModal(true);
  }, [canImportBudget]);

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
      setAutoRefreshBudgetId(null);
    },
    onSuccess: async (payload) => {
      const { deal, warnings } = normalizeImportDealResult(payload);

      let summary: DealSummary | null = null;
      let normalizedDealId: string | null = null;
      let resolvedPipelineKey: string | null = null;

      if (deal) {
        summary = buildSummaryFromDeal(deal as DealDetail | DealSummary);
        normalizedDealId = summary.dealId ?? summary.deal_id ?? null;

        if (normalizedDealId) {
          const detailForCache: DealDetail = {
            ...(deal as DealDetail),
            deal_id: normalizedDealId,
          };
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

      const extractPipelineData = (
        source: DealSummary | null | undefined,
      ): { label: string | null; labelKey: string; id: string | null; idKey: string } => {
        const label = normalizeOptionalString(source?.pipeline_label);
        const id = normalizeOptionalString(source?.pipeline_id);
        return {
          label,
          labelKey: label ? normalizePipelineKey(label) : '',
          id,
          idKey: id ? normalizePipelineKey(id) : '',
        };
      };

      if (summary && normalizedDealId) {
        let {
          label: pipelineLabel,
          labelKey: pipelineLabelKey,
          id: pipelineId,
          idKey: pipelineIdKey,
        } = extractPipelineData(summary);

        const ensurePipelineFromDetail = async () => {
          if (!normalizedDealId) return;

          const cachedDetail = queryClient.getQueryData<DealDetail>([
            'deal',
            normalizedDealId,
          ]);
          if (cachedDetail) {
            summary = buildSummaryFromDeal(cachedDetail);
            normalizedDealId = summary.dealId ?? summary.deal_id ?? normalizedDealId;
            const extracted = extractPipelineData(summary);
            pipelineLabel = extracted.label;
            pipelineLabelKey = extracted.labelKey;
            pipelineId = extracted.id;
            pipelineIdKey = extracted.idKey;
          }

          if (!pipelineLabel || !pipelineLabelKey || !KNOWN_PIPELINE_KEYS.has(pipelineLabelKey)) {
            try {
              const refreshedDetail = await fetchDealDetail(normalizedDealId);
              queryClient.setQueryData(['deal', normalizedDealId], refreshedDetail);
              summary = buildSummaryFromDeal(refreshedDetail);
              normalizedDealId = summary.dealId ?? summary.deal_id ?? normalizedDealId;
              const extracted = extractPipelineData(summary);
              pipelineLabel = extracted.label;
              pipelineLabelKey = extracted.labelKey;
              pipelineId = extracted.id;
              pipelineIdKey = extracted.idKey;
            } catch (error) {
              console.error(
                '[App] No se pudo obtener el pipeline del presupuesto importado',
                error,
              );
            }
          }
        };

        if (!pipelineLabel || !pipelineLabelKey || !KNOWN_PIPELINE_KEYS.has(pipelineLabelKey)) {
          await ensurePipelineFromDetail();
        }

        const candidatePipelineKey =
          pipelineLabelKey && KNOWN_PIPELINE_KEYS.has(pipelineLabelKey)
            ? pipelineLabelKey
            : pipelineIdKey && KNOWN_PIPELINE_KEYS.has(pipelineIdKey)
            ? pipelineIdKey
            : '';

        resolvedPipelineKey = candidatePipelineKey || null;
      }

      const normalizedId = normalizeDealId(normalizedDealId);
      if (normalizedId && resolvedPipelineKey === FORMACION_ABIERTA_PIPELINE_KEY) {
        setAutoRefreshBudgetId(normalizedId);
      } else {
        setAutoRefreshBudgetId(null);
      }
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

        setSelectedBudgetSummary(summaryWithNormalizedId);
        setSelectedBudgetId(summaryWithNormalizedId.dealId ?? summaryWithNormalizedId.deal_id ?? null);
      } else {
        setSelectedBudgetSummary(null);
        setSelectedBudgetId(null);
        setAutoRefreshBudgetId(null);
      }

      pushToast({ variant: 'success', message: 'Presupuesto importado' });
    },
    onError: (error: unknown) => {
      const apiError = error instanceof ApiError ? error : null;
      if (apiError?.code === DEAL_NOT_WON_ERROR_CODE) {
        const message = DEAL_NOT_WON_ERROR_MESSAGE;
        setImportError(message);
        setImportResultDealId(null);
        setImportResultWarnings(null);
        setAutoRefreshBudgetId(null);
        pushToast({ variant: 'danger', message });
        return;
      }

      const code = apiError?.code ?? 'UNKNOWN_ERROR';
      const message =
        apiError?.message ?? 'No se ha podido importar el presupuesto. Inténtalo de nuevo más tarde.';
      const detailedMessage = `No se pudo importar. [${code}] ${message}`;
      setImportError(detailedMessage);
      setImportResultDealId(null);
      setImportResultWarnings(null);
      setAutoRefreshBudgetId(null);
      pushToast({ variant: 'danger', message: detailedMessage });
    }
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const normalizedPath = normalizeNavigationPath(location.pathname);
    if (knownPaths.has(normalizedPath)) {
      try {
        window.localStorage.setItem(ACTIVE_PATH_STORAGE_KEY, location.pathname);
      } catch (error) {
        console.warn('No se pudo guardar la ruta activa', error);
      }
    }
  }, [location.pathname, knownPaths]);

  useEffect(() => {
    if (!location.pathname.startsWith('/presupuestos')) {
      setShowImportModal(false);
    }
  }, [location.pathname]);

  const budgets = budgetsQuery.data ?? [];
  const isRefreshing = budgetsQuery.isFetching && !budgetsQuery.isLoading;

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
    setAutoRefreshBudgetId(null);
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
    setAutoRefreshBudgetId(null);
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
    canImportBudget,
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

  const pipelineLabelValue = normalizeOptionalString(selectedBudgetSummary?.pipeline_label);
  const pipelineIdValue = pipelineLabelValue
    ? null
    : normalizeOptionalString(selectedBudgetSummary?.pipeline_id);

  const pipelineLabelKey = pipelineLabelValue ? normalizePipelineKey(pipelineLabelValue) : '';
  const pipelineIdKey = pipelineIdValue ? normalizePipelineKey(pipelineIdValue) : '';
  const pipelineKeyCandidates = pipelineLabelKey
    ? [pipelineLabelKey]
    : pipelineIdKey
    ? [pipelineIdKey]
    : [];

  const BudgetModalComponent = resolveBudgetModalComponent(pipelineKeyCandidates);

  const budgetModalProps: BudgetModalProps = {
    dealId: selectedBudgetId,
    summary: selectedBudgetSummary,
    onClose: handleCloseDetail,
    onShowProductComment: handleShowProductComment,
    onNotify: pushToast,
    autoRefreshOnOpen: !!selectedBudgetId && selectedBudgetId === autoRefreshBudgetId,
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
              navigate(defaultRedirectPath);
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
          <div className="ms-auto d-flex align-items-center gap-4 flex-wrap justify-content-end">
            <Nav className="gap-3">
              {navigationItems.map((item) =>
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

            <div className="d-flex align-items-center gap-2">
              {user ? (
                <span className="text-muted small mb-0 text-end">
                  {user.name?.trim()?.length ? user.name : user.email}
                </span>
              ) : null}
              <Button
                variant="outline-secondary"
                size="sm"
                onClick={handleLogout}
                disabled={logoutMutation.isPending}
              >
                {logoutMutation.isPending ? 'Saliendo…' : 'Salir'}
              </Button>
            </div>
          </div>
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
            defaultRedirectPath={defaultRedirectPath}
            knownPaths={knownPaths}
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

function LoadingScreen() {
  return (
    <Container className="min-vh-100 d-flex align-items-center justify-content-center">
      <Spinner animation="border" role="status" variant="primary">
        <span className="visually-hidden">Cargando…</span>
      </Spinner>
    </Container>
  );
}

function RequireAuth({ children }: { children: JSX.Element }) {
  const { status, isFetching, user, error } = useCurrentUser();
  const location = useLocation();

  if (status === 'loading' || isFetching) {
    return <LoadingScreen />;
  }

  if (status === 'error') {
    console.error('No se pudo verificar la sesión actual', error);
    return (
      <Navigate
        to="/login"
        state={{
          from: `${location.pathname}${location.search}`,
          sessionError: true,
        }}
        replace
      />
    );
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: `${location.pathname}${location.search}` }} replace />;
  }

  return children;
}

function PublicOnlyRoute({ children }: { children: JSX.Element }) {
  const { status, isFetching, user } = useCurrentUser();

  if (status === 'loading' || isFetching) {
    return <LoadingScreen />;
  }

  if (status === 'authenticated' && user) {
    return <Navigate to="/presupuestos" replace />;
  }

  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/public/*" element={<PublicSessionStudentsPage />} />
      <Route
        path="/login"
        element={
          <PublicOnlyRoute>
            <LoginPage />
          </PublicOnlyRoute>
        }
      />
      <Route
        path="/forgot-password"
        element={
          <PublicOnlyRoute>
            <ForgotPasswordPage />
          </PublicOnlyRoute>
        }
      />
      <Route
        path="/reset-password"
        element={
          <PublicOnlyRoute>
            <ResetPasswordPage />
          </PublicOnlyRoute>
        }
      />
      <Route
        path="/*"
        element={
          <RequireAuth>
            <AuthenticatedApp />
          </RequireAuth>
        }
      />
    </Routes>
  );
}
