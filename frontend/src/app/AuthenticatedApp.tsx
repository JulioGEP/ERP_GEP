import { useCallback, useEffect, useMemo, useState, type ComponentProps, type ComponentType } from 'react';
import { Container, Nav, Navbar, Toast, ToastContainer, NavDropdown } from 'react-bootstrap';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BudgetImportModal } from '../features/presupuestos/BudgetImportModal';
import { BudgetDetailModalEmpresas } from '../features/presupuestos/empresas/BudgetDetailModalEmpresas';
import { BudgetDetailModalAbierta } from '../features/presupuestos/abierta/BudgetDetailModalAbierta';
import { BudgetDetailModalServices } from '../features/presupuestos/services/BudgetDetailModalServices';
import { BudgetDetailModalMaterial } from '../features/presupuestos/material/BudgetDetailModalMaterial';
import { ProductCommentWindow } from '../features/presupuestos/ProductCommentWindow';
import type { ProductCommentPayload } from '../features/presupuestos/ProductCommentWindow';
import { ApiError } from '../api/client';
import {
  deleteDeal,
  fetchDealDetail,
  fetchDeals,
  fetchDealsWithoutSessions,
  matchesPendingPlanningCriteria,
  importDeal,
} from '../features/presupuestos/api/deals.api';
import {
  DEALS_ALL_QUERY_KEY,
  DEALS_QUERY_KEY,
  DEALS_WITHOUT_SESSIONS_QUERY_KEY,
  DEALS_WITHOUT_SESSIONS_FALLBACK_QUERY_KEY,
} from '../features/presupuestos/queryKeys';
import {
  DEAL_NOT_WON_ERROR_CODE,
  DEAL_NOT_WON_ERROR_MESSAGE,
  normalizeImportDealResult,
} from '../features/presupuestos/importDealUtils';
import type { CalendarSession } from '../features/calendar/api';
import type { DealDetail, DealSummary } from '../types/deal';
import logo from '../assets/gep-group-logo.png';
import { AppRouter } from './router';
import { hasPendingExternalFollowUp } from './utils/budgetFollowUp';
import type { BudgetsPageProps } from '../pages/presupuestos/BudgetsPage';
import type { AllBudgetsPageProps } from '../pages/presupuestos/AllBudgetsPage';
import type { UnworkedBudgetsPageProps } from '../pages/presupuestos/UnworkedBudgetsPage';
import type { PorSesionesPageProps } from '../pages/calendario/PorSesionesPage';
import type { PorUnidadMovilPageProps } from '../pages/calendario/PorUnidadMovilPage';
import type { PorFormadorPageProps } from '../pages/calendario/PorFormadorPage';
import type { FormadoresBomberosPageProps } from '../pages/recursos/FormadoresBomberosPage';
import type { UnidadesMovilesPageProps } from '../pages/recursos/UnidadesMovilesPage';
import type { SalasPageProps } from '../pages/recursos/SalasPage';
import type { TemplatesCertificadosPageProps } from '../pages/recursos/TemplatesCertificadosPage';
import type { ProductosPageProps } from '../pages/recursos/ProductosPage';
import type { CertificadosPageProps } from '../pages/certificados/CertificadosPage';
import type { RecursosFormacionAbiertaPageProps } from '../pages/recursos/FormacionAbiertaPage';
import type { TrainerPageProps } from '../pages/usuarios/TrainerPage';
import type { UsersPageProps } from '../pages/usuarios/UsersPage';
import { useAuth } from '../context/AuthContext'; // ⬅️ ruta corregida
import { TOAST_EVENT, type ToastEventDetail } from '../utils/toast';

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
    key: 'Dashboard',
    label: 'Dashboard',
    path: '/dashboard',
  },
  {
    key: 'Presupuestos',
    label: 'Presupuestos',
    children: [
      { key: 'Presupuestos/Todos', label: 'Todos', path: '/presupuestos/todos' },
      { key: 'Presupuestos/SinTrabajar', label: 'Sin trabajar', path: '/presupuestos/sintrabajar' },
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
  {
    key: 'Usuarios',
    label: 'Usuarios',
    path: '/usuarios',
    children: [
      { key: 'Usuarios/Principal', label: 'Gestión de usuarios', path: '/usuarios' },
      { key: 'Usuarios/Trainer', label: 'Área Formador', path: '/usuarios/trainer' },
    ],
  },
];

const LEGACY_APP_PATHS = ['/formacion_abierta/cursos'] as const;

const DEFAULT_REDIRECT_PATH = '/dashboard';

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

export default function AuthenticatedApp() {
  const { user, logout, permissions, hasPermission } = useAuth(); // ⬅️ sin getDefaultPath
  const location = useLocation();
  const navigate = useNavigate();
  const canImportBudgets = user?.role !== 'Logistica';

  // Redirección defensiva si por cualquier motivo se monta sin sesión
  useEffect(() => {
    if (!user) {
      navigate('/login', { replace: true });
    }
  }, [user, navigate]);

  // Calcula path por defecto según permisos visibles en el menú
  const computeDefaultPath = useCallback((): string => {
    // Prioriza hijos en el orden declarado en NAVIGATION_ITEMS
    for (const item of NAVIGATION_ITEMS) {
      if (item.path && hasPermission(item.path)) return item.path;
      for (const child of item.children ?? []) {
        if (hasPermission(child.path)) return child.path;
      }
    }
    if (hasPermission('/perfil')) return '/perfil';
    // Fallback configurable
    if (hasPermission(DEFAULT_REDIRECT_PATH)) return DEFAULT_REDIRECT_PATH;
    // Último recurso: primer legacy conocido o raíz
    return LEGACY_APP_PATHS[0] ?? '/';
  }, [hasPermission]);

  const defaultRedirectPath = useMemo(() => computeDefaultPath(), [computeDefaultPath]);

  const filteredNavItems = useMemo(() => {
    return NAVIGATION_ITEMS.map((item) => {
      const children = (item.children ?? []).filter((child) => hasPermission(child.path));
      const hasDirect = item.path ? hasPermission(item.path) : false;
      if (!hasDirect && children.length === 0) {
        return null;
      }
      return { ...item, children };
    }).filter(
  (item): item is { children: NavChild[]; key: string; label: string; path?: string } =>
    !!item && Array.isArray((item as any).children)
);
  }, [hasPermission, permissions]);

  const allowedPaths = useMemo(() => {
    const paths = new Set<string>();
    for (const item of NAVIGATION_ITEMS) {
      if (item.path && hasPermission(item.path)) {
        paths.add(item.path);
      }
      for (const child of item.children ?? []) {
        if (hasPermission(child.path)) {
          paths.add(child.path);
        }
      }
    }
    for (const legacy of LEGACY_APP_PATHS) {
      paths.add(legacy);
    }
    paths.add('/perfil');
    return paths;
  }, [hasPermission, permissions]);

  const fallbackPath = useMemo(() => {
    const firstAllowed = allowedPaths.values().next().value as string | undefined;
    return firstAllowed ?? DEFAULT_REDIRECT_PATH;
  }, [allowedPaths]);

  const homePath = defaultRedirectPath !== '/' ? defaultRedirectPath : fallbackPath;

  const userDisplayName = useMemo(() => {
    if (!user) return '';
    const firstName = (user.firstName ?? '').trim();
    if (firstName.length) return firstName;
    const lastName = (user.lastName ?? '').trim();
    if (lastName.length) return lastName;
    return user.email;
  }, [user]);

  const handleLogout = useCallback(async () => {
    await logout();
    navigate('/login', { replace: true });
  }, [logout, navigate]);

  const isBudgetsRoute = location.pathname.startsWith('/presupuestos');
  const isBudgetsTodosRoute = location.pathname.startsWith('/presupuestos/todos');
  const isBudgetsSinTrabajarRoute = location.pathname.startsWith('/presupuestos/sintrabajar');

  const [showImportModal, setShowImportModal] = useState(false);
  const [selectedBudgetId, setSelectedBudgetId] = useState<string | null>(null);
  const [selectedBudgetSummary, setSelectedBudgetSummary] = useState<DealSummary | null>(null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [productComment, setProductComment] = useState<ProductCommentPayload | null>(null);
  const [importResultWarnings, setImportResultWarnings] = useState<string[] | null>(null);
  const [importResultDealId, setImportResultDealId] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [autoRefreshBudgetId, setAutoRefreshBudgetId] = useState<string | null>(null);
  const [isCheckingExistingDeal, setIsCheckingExistingDeal] = useState(false);

  const queryClient = useQueryClient();

  useEffect(() => {
    if (!selectedBudgetId) {
      setProductComment(null);
    }
  }, [selectedBudgetId]);

  const budgetsWithoutSessionsQuery = useQuery({
    queryKey: DEALS_WITHOUT_SESSIONS_QUERY_KEY,
    queryFn: () => fetchDealsWithoutSessions(),
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchInterval: false,
    retry: 0,
    staleTime: Infinity,
    enabled: isBudgetsRoute,
  });

  const allBudgetsQuery = useQuery({
    queryKey: DEALS_ALL_QUERY_KEY,
    queryFn: () => fetchDeals(),
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchInterval: false,
    retry: 0,
    staleTime: Infinity,
    enabled: isBudgetsTodosRoute || isBudgetsSinTrabajarRoute,
  });

  const pendingPlanningBudgets = useMemo(() => {
    const source = budgetsWithoutSessionsQuery.data ?? [];
    if (!Array.isArray(source) || source.length === 0) {
      return [] as DealSummary[];
    }
    return source.filter((deal) => matchesPendingPlanningCriteria(deal));
  }, [budgetsWithoutSessionsQuery.data]);

  useEffect(() => {
    if (!budgetsWithoutSessionsQuery.isSuccess) {
      return;
    }
    if (!pendingPlanningBudgets.length) {
      return;
    }
    queryClient.setQueryData(DEALS_WITHOUT_SESSIONS_FALLBACK_QUERY_KEY, pendingPlanningBudgets);
  }, [budgetsWithoutSessionsQuery.isSuccess, pendingPlanningBudgets, queryClient]);

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

      if (!showImportModal) {
        pushToast({ variant: 'success', message: 'Presupuesto importado' });
      }
    },
    onError: (error: unknown) => {
      const apiError = error instanceof ApiError ? error : null;
      if (apiError?.code === DEAL_NOT_WON_ERROR_CODE) {
        const message = DEAL_NOT_WON_ERROR_MESSAGE;
        setImportError(message);
        setImportResultDealId(null);
        setImportResultWarnings(null);
        setAutoRefreshBudgetId(null);
        if (!showImportModal) {
          pushToast({ variant: 'danger', message });
        }
        return;
      }

      const code = apiError?.code ?? 'UNKNOWN_ERROR';
      const defaultMessage =
        apiError?.message ?? 'No se ha podido importar el presupuesto. Inténtalo de nuevo más tarde.';
      const friendlyNotFoundMessage = 'El presupuesto que indicas, no existe en Pipedrive';
      const isPipedriveNotFoundError =
        apiError?.code === 'IMPORT_ERROR' &&
        typeof apiError?.message === 'string' &&
        (/->\s*404/.test(apiError.message) || /deal not found/i.test(apiError.message));

      const detailedMessage = isPipedriveNotFoundError
        ? friendlyNotFoundMessage
        : `No se pudo importar. [${code}] ${defaultMessage}`;
      setImportError(detailedMessage);
      setImportResultDealId(null);
      setImportResultWarnings(null);
      setAutoRefreshBudgetId(null);
      if (!showImportModal) {
        pushToast({ variant: 'danger', message: detailedMessage });
      }
    }
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (allowedPaths.has(location.pathname)) {
      try {
        window.localStorage.setItem(ACTIVE_PATH_STORAGE_KEY, location.pathname);
      } catch (error) {
        console.warn('No se pudo guardar la ruta activa', error);
      }
    }
  }, [allowedPaths, location.pathname]);

  useEffect(() => {
    if (!location.pathname.startsWith('/presupuestos')) {
      setShowImportModal(false);
    }
  }, [location.pathname]);

  const isRefreshingWithoutSessions =
    budgetsWithoutSessionsQuery.isFetching && !budgetsWithoutSessionsQuery.isLoading;

  const allBudgets = allBudgetsQuery.data ?? [];
  const isRefreshingAllBudgets = allBudgetsQuery.isFetching && !allBudgetsQuery.isLoading;

  const unworkedBudgets = useMemo(
    () => allBudgets.filter((budget) => hasPendingExternalFollowUp(budget)),
    [allBudgets],
  );

  const handleImportSubmit = useCallback(
    async (rawDealId: string) => {
      const normalizedDealId = normalizeDealId(rawDealId);
      if (!normalizedDealId) {
        return;
      }

      setImportError(null);
      setIsCheckingExistingDeal(true);

      const matchDealId = (value: unknown) => normalizeDealId(value) === normalizedDealId;
      const findSummaryInList = (list: DealSummary[] | undefined | null): DealSummary | null => {
        if (!Array.isArray(list)) return null;
        const entry = list.find((item) => matchDealId(item?.dealId) || matchDealId(item?.deal_id));
        return entry ?? null;
      };

      let shouldImport = false;
      try {
        let existingSummary: DealSummary | null = findSummaryInList(pendingPlanningBudgets);
        if (!existingSummary) {
          existingSummary = findSummaryInList(allBudgets);
        }
        if (!existingSummary) {
          const cachedList = queryClient.getQueryData<DealSummary[]>(DEALS_WITHOUT_SESSIONS_QUERY_KEY);
          if (cachedList) {
            existingSummary = findSummaryInList(cachedList);
          }
        }
        if (!existingSummary) {
          const cachedAll = queryClient.getQueryData<DealSummary[]>(DEALS_ALL_QUERY_KEY);
          if (cachedAll) {
            existingSummary = findSummaryInList(cachedAll);
          }
        }
        if (!existingSummary) {
          const fallbackList = queryClient.getQueryData<DealSummary[]>(
            DEALS_WITHOUT_SESSIONS_FALLBACK_QUERY_KEY,
          );
          if (fallbackList) {
            existingSummary = findSummaryInList(fallbackList);
          }
        }

        let existingDetail: DealDetail | null = null;
        if (existingSummary) {
          if (!existingSummary.pipeline_label && !existingSummary.pipeline_id) {
            existingDetail = queryClient.getQueryData<DealDetail>(['deal', normalizedDealId]) ?? null;
          }
        } else {
          existingDetail = queryClient.getQueryData<DealDetail>(['deal', normalizedDealId]) ?? null;
        }

        if (!existingDetail) {
          try {
            existingDetail = await fetchDealDetail(normalizedDealId);
            if (existingDetail) {
              queryClient.setQueryData(['deal', normalizedDealId], existingDetail);
            }
          } catch (error) {
            if (error instanceof ApiError && (error.status === 404 || error.code === 'HTTP_404')) {
              existingDetail = null;
            } else {
              throw error;
            }
          }
        }

        const summaryCandidate = existingDetail
          ? buildSummaryFromDeal(existingDetail)
          : existingSummary
          ? buildSummaryFromDeal(existingSummary)
          : null;

        if (summaryCandidate) {
          pushToast({ variant: 'warning', message: 'El presupuesto que indicas, ya existe en el ERP' });
          setImportResultWarnings(null);
          setImportResultDealId(null);
          setAutoRefreshBudgetId(null);
          setShowImportModal(false);
          setSelectedBudgetSummary(summaryCandidate);
          setSelectedBudgetId(summaryCandidate.dealId ?? summaryCandidate.deal_id ?? normalizedDealId);
          return;
        }

        shouldImport = true;
      } catch (error) {
        console.error('[App] No se pudo comprobar la existencia del presupuesto antes de importar', error);
        const message = 'No se pudo comprobar si el presupuesto existe. Inténtalo de nuevo.';
        setImportError(message);
        pushToast({ variant: 'danger', message });
        return;
      } finally {
        setIsCheckingExistingDeal(false);
      }

      if (shouldImport) {
        importMutation.mutate(normalizedDealId);
      }
    },
    [
      allBudgets,
      pendingPlanningBudgets,
      fetchDealDetail,
      importMutation,
      pushToast,
      queryClient,
      setAutoRefreshBudgetId,
      setImportError,
      setImportResultDealId,
      setImportResultWarnings,
      setIsCheckingExistingDeal,
      setSelectedBudgetId,
      setSelectedBudgetSummary,
      setShowImportModal,
    ],
  );

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
      queryClient.invalidateQueries({ queryKey: DEALS_QUERY_KEY });
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

  const handleOpenCalendarDeal = useCallback(
    ({ dealId, summary }: { dealId: string; summary: DealSummary }) => {
      const normalizedId = typeof dealId === 'string' ? dealId.trim() : '';
      if (!normalizedId.length) {
        pushToast({ variant: 'danger', message: 'No se pudo determinar el identificador del presupuesto.' });
        return;
      }

      const normalizedSummary = buildSummaryFromDeal(summary);
      setSelectedBudgetSummary(normalizedSummary);
      setSelectedBudgetId(normalizedId);
    },
    [pushToast],
  );

  const budgetsPageProps: BudgetsPageProps = {
    budgets: pendingPlanningBudgets,
    isLoading: budgetsWithoutSessionsQuery.isLoading,
    isFetching: isRefreshingWithoutSessions,
    error: budgetsWithoutSessionsQuery.error ?? null,
    onRetry: () => budgetsWithoutSessionsQuery.refetch(),
    onSelect: handleSelectBudget,
    onDelete: handleDeleteBudget,
    onOpenImportModal: handleOpenImportModal,
    isImporting: importMutation.isPending,
    canImport: canImportBudgets,
    serverQueryOptions: {
      fetcher: fetchDealsWithoutSessions,
      queryKey: ['budget-table', 'noSessions'],
    },
  };

  const allBudgetsPageProps: AllBudgetsPageProps = {
    budgets: allBudgets,
    isLoading: allBudgetsQuery.isLoading,
    isFetching: isRefreshingAllBudgets,
    error: allBudgetsQuery.error ?? null,
    onRetry: () => allBudgetsQuery.refetch(),
    onSelect: handleSelectBudget,
    onDelete: handleDeleteBudget,
    onOpenImportModal: handleOpenImportModal,
    isImporting: importMutation.isPending,
    canImport: canImportBudgets,
    serverQueryOptions: {
      fetcher: fetchDeals,
      queryKey: ['budget-table', 'all'],
    },
  };

  const unworkedBudgetsPageProps: UnworkedBudgetsPageProps = {
    budgets: unworkedBudgets,
    isLoading: allBudgetsQuery.isLoading,
    isFetching: isRefreshingAllBudgets,
    error: allBudgetsQuery.error ?? null,
    onRetry: () => allBudgetsQuery.refetch(),
    onSelect: handleSelectBudget,
    onDelete: handleDeleteBudget,
    onOpenImportModal: handleOpenImportModal,
    isImporting: importMutation.isPending,
    canImport: canImportBudgets,
  };

  const calendarSessionsPageProps: PorSesionesPageProps = {
    onNotify: pushToast,
    onSessionOpen: handleOpenCalendarSession,
    onDealOpen: handleOpenCalendarDeal,
  };

  const calendarUnitsPageProps: PorUnidadMovilPageProps = {
    onNotify: pushToast,
    onSessionOpen: handleOpenCalendarSession,
    onDealOpen: handleOpenCalendarDeal,
  };

  const calendarTrainersPageProps: PorFormadorPageProps = {
    onNotify: pushToast,
    onSessionOpen: handleOpenCalendarSession,
    onDealOpen: handleOpenCalendarDeal,
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
  const trainerPageProps: TrainerPageProps = {};
  const usersPageProps: UsersPageProps = { onNotify: pushToast };

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
              navigate(homePath);
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
          <Nav className="ms-auto gap-3 align-items-center">
            {filteredNavItems.map((item) =>
              item.children && item.children.length ? (
                <NavDropdown
                  key={item.key}
                  title={<span className="text-uppercase">{item.label}</span>}
                  id={`nav-${item.key}`}
                  active={item.children.some((child) => location.pathname.startsWith(child.path))}
                >
                  {item.children.map((child) => (
                    <NavDropdown.Item key={child.key} as={NavLink} to={child.path}>
                      {child.label}
                    </NavDropdown.Item>
                  ))}
                </NavDropdown>
              ) : item.path ? (
                <Nav.Item key={item.key}>
                  <Nav.Link as={NavLink} to={item.path} className="text-uppercase">
                    {item.label}
                  </Nav.Link>
                </Nav.Item>
              ) : null,
            )}
            {user && (
              <NavDropdown align="end" title={<span>{userDisplayName || 'Cuenta'}</span>} id="nav-user">
                <NavDropdown.Item as={NavLink} to="/perfil">
                  Mi perfil
                </NavDropdown.Item>
                <NavDropdown.Divider />
                <NavDropdown.Item onClick={handleLogout}>Cerrar sesión</NavDropdown.Item>
              </NavDropdown>
            )}
          </Nav>
        </Container>
      </Navbar>

      <main className="flex-grow-1 py-5">
        <Container fluid="xl">
          <AppRouter
            budgetsPageProps={budgetsPageProps}
            allBudgetsPageProps={allBudgetsPageProps}
            unworkedBudgetsPageProps={unworkedBudgetsPageProps}
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
            trainerPageProps={trainerPageProps}
            usersPageProps={usersPageProps}
            defaultRedirectPath={homePath}
            knownPaths={allowedPaths}
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
        isLoading={importMutation.isPending || isCheckingExistingDeal}
        resultWarnings={importResultWarnings ?? undefined}
        resultDealId={importResultDealId ?? undefined}
        error={importError}
        onClose={handleCloseImportModal}
        onSubmit={(dealId) => {
          void handleImportSubmit(dealId);
        }}
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
