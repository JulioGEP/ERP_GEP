import { useCallback, useEffect, useMemo, useState, type ComponentProps, type ComponentType } from 'react';
import { Container, Nav, Navbar, Toast, ToastContainer, NavDropdown, Offcanvas } from 'react-bootstrap';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BudgetImportModal } from '../features/presupuestos/BudgetImportModal';
import { BudgetDetailModalEmpresas } from '../features/presupuestos/empresas/BudgetDetailModalEmpresas';
import { BudgetDetailModalAbierta } from '../features/presupuestos/abierta/BudgetDetailModalAbierta';
import { BudgetDetailModalServices } from '../features/presupuestos/services/BudgetDetailModalServices';
import { BudgetDetailModalMaterial } from '../features/presupuestos/material/BudgetDetailModalMaterial';
import { ProductCommentWindow } from '../features/presupuestos/ProductCommentWindow';
import type { ProductCommentPayload } from '../features/presupuestos/ProductCommentWindow';
import { VariantModal } from '../features/formacion_abierta/ProductVariantsList';
import type { ActiveVariant, ProductInfo, VariantInfo } from '../features/formacion_abierta/types';
import { ApiError } from '../api/client';
import { fetchMaterialOrders } from '../features/materials/orders.api';
import {
  deleteDeal,
  fetchDealDetail,
  fetchDeals,
  fetchDealsWithoutSessions,
  matchesPendingPlanningCriteria,
  importDeal,
} from '../features/presupuestos/api/deals.api';
import type { UnplannedSessionSummary } from '../features/presupuestos/api/sessions.api';
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
import type { CalendarSession, CalendarVariantEvent } from '../features/calendar/api';
import type { DealDetail, DealSummary } from '../types/deal';
import logo from '../assets/gep-group-logo.png';
import { AppRouter } from './router';
import { hasPendingExternalFollowUp } from './utils/budgetFollowUp';
import type { BudgetsPageProps } from '../pages/presupuestos/BudgetsPage';
import type { AllBudgetsPageProps } from '../pages/presupuestos/AllBudgetsPage';
import type { UnworkedBudgetsPageProps } from '../pages/presupuestos/UnworkedBudgetsPage';
import type { UnplannedSessionsPageProps } from '../pages/presupuestos/UnplannedSessionsPage';
import type { MaterialsBoardPageProps } from '../pages/materiales/MaterialsBoardPage';
import type { MaterialsBudgetsPageProps } from '../pages/materiales/MaterialsBudgetsPage';
import type { MaterialsPendingProductsPageProps } from '../pages/materiales/MaterialsPendingProductsPage';
import type { MaterialsOrdersPageProps } from '../pages/materiales/MaterialsOrdersPage';
import { isMaterialPipeline } from '../routes/materiales/MaterialsBudgetsPage';
import { MATERIAL_ORDERS_QUERY_KEY } from '../features/materials/queryKeys';
import type { PorSesionesPageProps } from '../pages/calendario/PorSesionesPage';
import type { PorUnidadMovilPageProps } from '../pages/calendario/PorUnidadMovilPage';
import type { PorFormadorPageProps } from '../pages/calendario/PorFormadorPage';
import type { PorEmpresaPageProps } from '../pages/calendario/PorEmpresaPage';
import type { FormadoresBomberosPageProps } from '../pages/recursos/FormadoresBomberosPage';
import type { UnidadesMovilesPageProps } from '../pages/recursos/UnidadesMovilesPage';
import type { SalasPageProps } from '../pages/recursos/SalasPage';
import type { ProveedoresPageProps } from '../pages/recursos/ProveedoresPage';
import type { TemplatesCertificadosPageProps } from '../pages/recursos/TemplatesCertificadosPage';
import type { ProductosPageProps } from '../pages/recursos/ProductosPage';
import type { StockPageProps } from '../pages/recursos/StockPage';
import type { CertificadosPageProps } from '../pages/certificados/CertificadosPage';
import type { RecursosFormacionAbiertaPageProps } from '../pages/recursos/FormacionAbiertaPage';
import type { ConfirmacionesPageProps } from '../pages/recursos/ConfirmacionesPage';
import type { UsersPageProps } from '../pages/usuarios/UsersPage';
import { useAuth } from '../context/AuthContext'; // ⬅️ ruta corregida
import { TOAST_EVENT, type ToastEventDetail } from '../utils/toast';
import type { MaterialOrder, MaterialOrdersResponse } from '../types/materialOrder';

const ACTIVE_PATH_STORAGE_KEY = 'erp-gep-active-path';
const NAVBAR_OFFCANVAS_ID = 'app-navbar-offcanvas';
const NAVBAR_OFFCANVAS_LABEL_ID = 'app-navbar-offcanvas-label';

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

const BASE_NAVIGATION_ITEMS: NavItem[] = [
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
      { key: 'Presupuestos/SinAgendar', label: 'Sin agendar', path: '/presupuestos/sin_agendar' },
    ],
  },
  {
    key: 'Materiales',
    label: 'Materiales',
    children: [
      { key: 'Materiales/Tablero', label: 'Tablero', path: '/materiales/tablero' },
      { key: 'Materiales/Todos', label: 'Todos', path: '/materiales/todos' },
      { key: 'Materiales/Pendientes', label: 'Pendientes', path: '/materiales/pendientes' },
      { key: 'Materiales/Pedidos', label: 'Pedidos', path: '/materiales/pedidos' },
    ],
  },
  {
    key: 'Calendario',
    label: 'Calendario',
    children: [
      { key: 'Calendario/Sesiones', label: 'Por sesiones', path: '/calendario/por_sesiones' },
      { key: 'Calendario/Formadores', label: 'Por formador', path: '/calendario/por_formador' },
      { key: 'Calendario/Empresas', label: 'Por empresa', path: '/calendario/por_empresa' },
      { key: 'Calendario/Unidades', label: 'Por unidad móvil', path: '/calendario/por_unidad_movil' },
    ],
  },
  {
    key: 'Recursos',
    label: 'Recursos',
    children: [
      { key: 'Recursos/Formadores', label: 'Formadores / Bomberos', path: '/recursos/formadores_bomberos' },
      { key: 'Recursos/Confirmaciones', label: 'Confirmaciones', path: '/recursos/confirmaciones' },
      { key: 'Recursos/Unidades', label: 'Unidades Móviles', path: '/recursos/unidades_moviles' },
      { key: 'Recursos/Salas', label: 'Salas', path: '/recursos/salas' },
      { key: 'Recursos/Formaciones', label: 'Formaciones', path: '/recursos/formaciones' },
      { key: 'Recursos/Stock', label: 'Stock', path: '/recursos/stock' },
      { key: 'Recursos/ImportarSesion', label: 'Importar sesiones', path: '/recursos/importar_sesion' },
      { key: 'Recursos/ImportarEnBucle', label: 'Importar en bucle', path: '/recursos/importar_en_bucle' },
      { key: 'Recursos/Proveedores', label: 'Proveedores', path: '/recursos/proveedores' },
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
    key: 'Reporting',
    label: 'Reporting',
    children: [
      {
        key: 'Reporting/ControlHorario',
        label: 'Control Horario',
        path: '/reporting/control_horario',
      },
      {
        key: 'Reporting/CostesExtra',
        label: 'Costes Extra',
        path: '/reporting/costes_extra',
      },
      {
        key: 'Reporting/HorasFormadores',
        label: 'Horas Formadores',
        path: '/reporting/horas_formadores',
      },
      {
        key: 'Reporting/Comparativa',
        label: 'Comparativa Formaciones y Servicios',
        path: '/reporting/comparativa',
      },
      {
        key: 'Reporting/WebhooksPipedrive',
        label: 'Webhooks Pipedrive',
        path: '/reporting/webhooks_pipedrive',
      },
      {
        key: 'Reporting/Logs',
        label: 'Logs',
        path: '/reporting/logs',
      },
    ],
  },
  {
    key: 'Usuarios',
    label: 'Usuarios',
    path: '/usuarios',
    children: [
      { key: 'Usuarios/Principal', label: 'Gestión de usuarios', path: '/usuarios' },
      { key: 'Usuarios/Vacaciones', label: 'Vacaciones', path: '/usuarios/vacaciones' },
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

function sanitizeString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const text = String(value).trim();
  return text.length ? text : null;
}

function sanitizeNumber(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  const numeric = Number(String(value).trim());
  return Number.isFinite(numeric) ? numeric : null;
}

function sanitizeStringArray(values: unknown[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  values.forEach((value) => {
    const normalized = sanitizeString(value);
    if (!normalized || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    output.push(normalized);
  });
  return output;
}

type CalendarVariantTrainerRecord = CalendarVariantEvent['variant']['trainers'][number];
type CalendarVariantUnitRecord =
  | CalendarVariantEvent['variant']['unidades'][number]
  | CalendarVariantEvent['variant']['unidad'];

function mapCalendarVariantTrainer(
  record: CalendarVariantTrainerRecord | CalendarVariantEvent['variant']['trainer'] | null | undefined,
): VariantInfo['trainers'][number] | null {
  if (!record) {
    return null;
  }
  const trainerId =
    sanitizeString(record.trainer_id) ??
    sanitizeString(record.name) ??
    sanitizeString(record.apellido);
  if (!trainerId) {
    return null;
  }
  const dni = 'dni' in record ? (record as { dni?: string | null }).dni ?? null : null;
  return {
    trainer_id: trainerId,
    name: record.name ?? null,
    apellido: record.apellido ?? null,
    dni,
  };
}

function mapCalendarVariantUnit(
  record: CalendarVariantUnitRecord | null | undefined,
): VariantInfo['unidades'][number] | null {
  if (!record) {
    return null;
  }
  const unitId =
    sanitizeString(record.unidad_id) ??
    sanitizeString(record.name) ??
    sanitizeString(record.matricula);
  if (!unitId) {
    return null;
  }
  const name = sanitizeString(record.name) ?? unitId;
  return {
    unidad_id: unitId,
    name,
    matricula: record.matricula ?? null,
  };
}

function resolveVariantSala(details: CalendarVariantEvent['variant']): VariantInfo['sala'] | null {
  const fallbackId =
    sanitizeString(details.sala_id) ??
    sanitizeString(details.sala?.name) ??
    sanitizeString(details.sala?.sede);
  if (details.sala) {
    const id = sanitizeString(details.sala.sala_id) ?? fallbackId;
    if (id) {
      const name = sanitizeString(details.sala.name) ?? id;
      return { sala_id: id, name, sede: details.sala.sede ?? null };
    }
  }
  if (fallbackId) {
    const sede = details.sala?.sede ?? null;
    return { sala_id: fallbackId, name: fallbackId, sede };
  }
  return null;
}

function resolveVariantUnits(details: CalendarVariantEvent['variant']): VariantInfo['unidades'] {
  const units: VariantInfo['unidades'] = [];
  const seen = new Set<string>();
  const addUnit = (record: CalendarVariantUnitRecord | null | undefined) => {
    const mapped = mapCalendarVariantUnit(record);
    if (!mapped || seen.has(mapped.unidad_id)) {
      return;
    }
    seen.add(mapped.unidad_id);
    units.push(mapped);
  };
  (details.unidades ?? []).forEach(addUnit);
  addUnit(details.unidad);
  const fallbackId = sanitizeString(details.unidad_movil_id);
  if (fallbackId && !seen.has(fallbackId)) {
    units.push({ unidad_id: fallbackId, name: fallbackId, matricula: null });
    seen.add(fallbackId);
  }
  return units;
}

function createActiveVariantFromCalendarEvent(event: CalendarVariantEvent): ActiveVariant {
  const variantDetails = event.variant;
  const trainerRecord = mapCalendarVariantTrainer(variantDetails.trainer);
  const trainers = (variantDetails.trainers ?? [])
    .map((record) => mapCalendarVariantTrainer(record))
    .filter((record): record is VariantInfo['trainers'][number] => !!record);
  const trainerIds = sanitizeStringArray(variantDetails.trainer_ids ?? []);
  const resolvedTrainerId = sanitizeString(variantDetails.trainer_id);
  if (resolvedTrainerId && !trainerIds.includes(resolvedTrainerId)) {
    trainerIds.push(resolvedTrainerId);
  }
  if (trainerRecord && !trainerIds.includes(trainerRecord.trainer_id)) {
    trainerIds.push(trainerRecord.trainer_id);
  }
  trainers.forEach((record) => {
    if (!trainerIds.includes(record.trainer_id)) {
      trainerIds.push(record.trainer_id);
    }
  });

  const unidades = resolveVariantUnits(variantDetails);
  const primaryUnit = unidades[0] ?? null;
  const unidadMovilIds = sanitizeStringArray(variantDetails.unidad_movil_ids ?? []);
  const resolvedUnidadMovilId = primaryUnit?.unidad_id ?? sanitizeString(variantDetails.unidad_movil_id);
  if (resolvedUnidadMovilId && !unidadMovilIds.includes(resolvedUnidadMovilId)) {
    unidadMovilIds.push(resolvedUnidadMovilId);
  }

  const resolvedSala = resolveVariantSala(variantDetails);
  const stockValue = sanitizeNumber(variantDetails.stock);

  const variantInfo: VariantInfo = {
    id: variantDetails.id,
    id_woo: sanitizeString(variantDetails.id_woo) ?? '',
    name: variantDetails.name ?? null,
    status: variantDetails.status ?? null,
    price: variantDetails.price ?? null,
    stock: stockValue,
    stock_status: variantDetails.stock_status ?? null,
    sede: variantDetails.sede ?? null,
    date: variantDetails.date ?? null,
    trainer_id: resolvedTrainerId,
    trainer_ids: trainerIds,
    trainer: trainerRecord,
    trainers,
    trainer_invite_status: 'NOT_SENT',
    trainer_invite_statuses: {},
    trainer_invites: [],
    sala_id: resolvedSala?.sala_id ?? sanitizeString(variantDetails.sala_id),
    sala: resolvedSala,
    unidad_movil_id: resolvedUnidadMovilId,
    unidad_movil_ids: unidadMovilIds,
    unidad: primaryUnit,
    unidades,
    created_at: variantDetails.created_at ?? null,
    updated_at: variantDetails.updated_at ?? null,
  };

  const productInfo: ProductInfo = {
    id: event.product.id,
    id_woo: sanitizeString(event.product.id_woo),
    name: event.product.name ?? null,
    code: event.product.code ?? null,
    template: event.product.template ?? null,
    category: event.product.category ?? null,
    variants: [variantInfo],
    default_variant_start: event.product.default_variant_start,
    default_variant_end: event.product.default_variant_end,
    default_variant_stock_status: event.product.default_variant_stock_status,
    default_variant_stock_quantity: sanitizeNumber(event.product.default_variant_stock_quantity),
    default_variant_price: event.product.default_variant_price,
    hora_inicio: event.product.hora_inicio ?? null,
    hora_fin: event.product.hora_fin ?? null,
  };

  return { product: productInfo, variant: variantInfo };
}

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

  const normalizedRole = (user?.role ?? '').trim().toLowerCase();

  const navigationCatalog = useMemo(() => {
    const items: NavItem[] = [...BASE_NAVIGATION_ITEMS];
    if (normalizedRole === 'formador') {
      items.unshift(
        { key: 'Trainer/Dashboard', label: 'Mi panel', path: '/usuarios/trainer/dashboard' },
        { key: 'Trainer/PendingSessions', label: 'Pendientes', path: '/usuarios/trainer/pendientes' },
        { key: 'Trainer/Sessions', label: 'Mis sesiones', path: '/usuarios/trainer/sesiones' },
        {
          key: 'Trainer/Reports',
          label: 'Mis informes',
          path: '/usuarios/trainer/informes',
          children: [
            {
              key: 'Trainer/Reports/Formacion',
              label: 'Formación',
              path: '/usuarios/trainer/informes/formacion',
            },
            {
              key: 'Trainer/Reports/Preventivo',
              label: 'Preventivo',
              path: '/usuarios/trainer/informes/preventivo',
            },
            {
              key: 'Trainer/Reports/Simulacro',
              label: 'Simulacro',
              path: '/usuarios/trainer/informes/simulacro',
            },
            {
              key: 'Trainer/Reports/RecursoPreventivoEbro',
              label: 'Recurso Preventivo EBRO',
              path: '/usuarios/trainer/informes/recurso_preventivo_ebro',
            },
          ],
        },
        { key: 'Trainer/Availability', label: 'Mi disponibilidad', path: '/usuarios/trainer/disponibilidad' },
      );
    }
    return items;
  }, [normalizedRole]);

  // Calcula path por defecto según permisos visibles en el menú
  const computeDefaultPath = useCallback((): string => {
    // Prioriza hijos en el orden declarado en navigationCatalog
    for (const item of navigationCatalog) {
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
  }, [hasPermission, navigationCatalog]);

  const defaultRedirectPath = useMemo(() => computeDefaultPath(), [computeDefaultPath]);

  const filteredNavItems = useMemo(() => {
    return navigationCatalog.map((item) => {
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
  }, [hasPermission, navigationCatalog, permissions]);

  const allowedPaths = useMemo(() => {
    const paths = new Set<string>();
    for (const item of navigationCatalog) {
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
  }, [hasPermission, navigationCatalog, permissions]);

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
  const isMaterialsRoute = location.pathname.startsWith('/materiales');

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
  const [activeCalendarVariant, setActiveCalendarVariant] = useState<ActiveVariant | null>(null);
  const [highlightedCalendarSessionId, setHighlightedCalendarSessionId] = useState<string | null>(null);

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
    enabled: isBudgetsTodosRoute || isBudgetsSinTrabajarRoute || isMaterialsRoute,
  });

  const materialsOrdersQuery = useQuery({
    queryKey: MATERIAL_ORDERS_QUERY_KEY,
    queryFn: () => fetchMaterialOrders(),
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 1,
    enabled: isMaterialsRoute,
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

  const handleMaterialOrderCreated = useCallback(
    (order: MaterialOrder, nextOrder?: number) => {
      queryClient.setQueryData<MaterialOrdersResponse | undefined>(
        MATERIAL_ORDERS_QUERY_KEY,
        (current) => {
          if (!current) {
            return { orders: [order], nextOrderNumber: nextOrder ?? order.orderNumber + 1 };
          }

          const updatedOrders = [order, ...current.orders];
          const resolvedNextOrderNumber = Math.max(
            nextOrder ?? current.nextOrderNumber,
            order.orderNumber + 1,
          );

          return { ...current, orders: updatedOrders, nextOrderNumber: resolvedNextOrderNumber };
        },
      );
    },
    [queryClient],
  );

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
  const materialOrdersData = materialsOrdersQuery.data;
  const materialOrders = materialOrdersData?.orders ?? [];
  const nextMaterialOrderNumber = materialOrdersData?.nextOrderNumber ?? 1;
  const isRefreshingMaterialOrders = materialsOrdersQuery.isFetching && !materialsOrdersQuery.isLoading;
  const materialsBudgets = useMemo(
    () => allBudgets.filter((budget) => isMaterialPipeline(budget)),
    [allBudgets],
  );

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
    setHighlightedCalendarSessionId(null);
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
    setHighlightedCalendarSessionId(null);
  }, []);

  const handleShowProductComment = useCallback((payload: ProductCommentPayload) => {
    setProductComment(payload);
  }, []);

  const handleCloseProductComment = useCallback(() => {
    setProductComment(null);
  }, []);

  const handleOpenCalendarVariant = useCallback((variantEvent: CalendarVariantEvent) => {
    const active = createActiveVariantFromCalendarEvent(variantEvent);
    setActiveCalendarVariant(active);
  }, []);

  const handleCloseCalendarVariant = useCallback(() => {
    setActiveCalendarVariant(null);
  }, []);

  const handleCalendarVariantUpdated = useCallback((updatedVariant: VariantInfo) => {
    setActiveCalendarVariant((current) => {
      if (!current || current.variant.id !== updatedVariant.id) {
        return current;
      }
      const nextVariants = current.product.variants.some((item) => item.id === updatedVariant.id)
        ? current.product.variants.map((item) => (item.id === updatedVariant.id ? { ...item, ...updatedVariant } : item))
        : current.product.variants;
      return {
        product: { ...current.product, variants: nextVariants },
        variant: { ...current.variant, ...updatedVariant },
      };
    });
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
        setHighlightedCalendarSessionId(session.id?.trim() ?? null);
      })();
    },
    [pushToast, queryClient],
  );

  const handleOpenUnplannedSession = useCallback(
    (session: UnplannedSessionSummary) => {
      void (async () => {
        const id = session.dealId?.trim();
        if (!id) {
          pushToast({ variant: 'danger', message: 'No se pudo determinar el identificador del presupuesto.' });
          return;
        }

        const sessionTitle = session.sessionName?.trim() ?? '';
        const organizationName = session.organizationName?.trim() ?? '';
        const summaryTitle = sessionTitle.length
          ? sessionTitle
          : organizationName.length
          ? organizationName
          : `Presupuesto ${id}`;

        const productNames = session.productTags?.length ? session.productTags : undefined;

        const summaryFromSession: DealSummary = {
          deal_id: id,
          dealId: id,
          title: summaryTitle,
          training_address: null,
          organization: null,
          person: null,
          products: undefined,
          productNames,
        };

        const pipelineCandidate = session.pipeline?.trim() ?? null;
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
        setHighlightedCalendarSessionId(session.id?.trim() ?? null);
      })();
    },
    [pushToast, queryClient],
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
    pageSize: 10,
    serverQueryOptions: {
      fetcher: fetchDealsWithoutSessions,
      queryKey: ['budget-table', 'noSessions'],
    },
  };

  const unplannedSessionsPageProps: UnplannedSessionsPageProps = {
    onSelectSession: handleOpenUnplannedSession,
    onOpenImportModal: handleOpenImportModal,
    isImporting: importMutation.isPending,
    canImport: canImportBudgets,
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

  const materialsBoardPageProps: MaterialsBoardPageProps = {
    budgets: materialsBudgets,
    isLoading: allBudgetsQuery.isLoading,
    isFetching: isRefreshingAllBudgets,
    error: allBudgetsQuery.error ?? null,
    onRetry: () => allBudgetsQuery.refetch(),
    onSelect: handleSelectBudget,
  };

  const materialsBudgetsPageProps: MaterialsBudgetsPageProps = {
    budgets: materialsBudgets,
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
      fetcher: async (options) => {
        const results = await fetchDeals(options);
        return results.filter((budget) => isMaterialPipeline(budget));
      },
      queryKey: ['budget-table', 'materials'],
    },
    pageSize: 10,
  };

  const materialsPendingProductsPageProps: MaterialsPendingProductsPageProps = {
    budgets: materialsBudgets,
    isLoading: allBudgetsQuery.isLoading,
    isFetching: isRefreshingAllBudgets,
    error: allBudgetsQuery.error ?? null,
    onRetry: () => allBudgetsQuery.refetch(),
    onSelect: handleSelectBudget,
    onOpenImportModal: handleOpenImportModal,
    isImporting: importMutation.isPending,
    canImport: canImportBudgets,
    nextOrderNumber: nextMaterialOrderNumber,
    onOrderCreated: handleMaterialOrderCreated,
    onOrdersRefresh: () => materialsOrdersQuery.refetch(),
    isLoadingOrders: materialsOrdersQuery.isLoading,
  };

  const materialsOrdersPageProps: MaterialsOrdersPageProps = {
    orders: materialOrders,
    isLoading: materialsOrdersQuery.isLoading,
    isFetching: isRefreshingMaterialOrders,
    error: materialsOrdersQuery.error ?? null,
    onRetry: () => materialsOrdersQuery.refetch(),
  };

  const calendarSessionsPageProps: PorSesionesPageProps = {
    onNotify: pushToast,
    onSessionOpen: handleOpenCalendarSession,
    onVariantOpen: handleOpenCalendarVariant,
  };

  const calendarUnitsPageProps: PorUnidadMovilPageProps = {
    onNotify: pushToast,
    onSessionOpen: handleOpenCalendarSession,
    onVariantOpen: handleOpenCalendarVariant,
  };

  const calendarTrainersPageProps: PorFormadorPageProps = {
    onNotify: pushToast,
    onSessionOpen: handleOpenCalendarSession,
    onVariantOpen: handleOpenCalendarVariant,
  };

  const calendarOrganizationsPageProps: PorEmpresaPageProps = {
    onNotify: pushToast,
    onSessionOpen: handleOpenCalendarSession,
    onVariantOpen: handleOpenCalendarVariant,
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

  const proveedoresPageProps: ProveedoresPageProps = {
    onNotify: pushToast,
  };

  const templatesCertificadosPageProps: TemplatesCertificadosPageProps = {
    onNotify: pushToast,
  };

  const productosPageProps: ProductosPageProps = {
    onNotify: pushToast,
  };

  const stockPageProps: StockPageProps = {
    onNotify: pushToast,
  };

  const recursosConfirmacionesPageProps: ConfirmacionesPageProps = {
    onNotify: pushToast,
  };

  const certificadosPageProps: CertificadosPageProps = {};
  const recursosFormacionAbiertaPageProps: RecursosFormacionAbiertaPageProps = {};
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
    highlightSessionId: highlightedCalendarSessionId,
  };

  return (
    <div className="min-vh-100 d-flex flex-column">
      <Navbar bg="white" expand="xl" className="shadow-sm py-3">
        <Container fluid="xl" className="d-flex align-items-center gap-4">
          <Navbar.Brand
            href="#"
            className="d-flex align-items-center"
            onClick={(event) => {
              event.preventDefault();
              navigate(homePath);
            }}
          >
            <img src={logo} height={64} alt="GEP Group" />
          </Navbar.Brand>
          <Navbar.Toggle aria-controls={NAVBAR_OFFCANVAS_ID} />
          <Navbar.Offcanvas
            id={NAVBAR_OFFCANVAS_ID}
            aria-labelledby={NAVBAR_OFFCANVAS_LABEL_ID}
            placement="start"
          >
            <Offcanvas.Header closeButton closeVariant="white" className="border-bottom">
              <Offcanvas.Title id={NAVBAR_OFFCANVAS_LABEL_ID} className="text-uppercase fw-semibold">
                Menú
              </Offcanvas.Title>
            </Offcanvas.Header>
            <Offcanvas.Body className="p-4 p-xl-0">
              <Nav className="ms-xl-auto gap-3 flex-column flex-xl-row align-items-start align-items-xl-center w-100">
                {filteredNavItems.map((item) =>
                  item.children && item.children.length ? (
                    <NavDropdown
                      key={item.key}
                      title={
                        <span className="text-uppercase d-block w-100 w-xl-auto text-start text-xl-center">
                          {item.label}
                        </span>
                      }
                      id={`nav-${item.key}`}
                      active={item.children.some((child) => location.pathname.startsWith(child.path))}
                      className="w-100 w-xl-auto"
                      menuVariant="light"
                    >
                      {item.children.map((child) => (
                        <NavDropdown.Item key={child.key} as={NavLink} to={child.path}>
                          {child.label}
                        </NavDropdown.Item>
                      ))}
                    </NavDropdown>
                  ) : item.path ? (
                    <Nav.Item key={item.key} className="w-100 w-xl-auto">
                      <Nav.Link
                        as={NavLink}
                        to={item.path}
                        className="text-uppercase w-100 w-xl-auto text-start text-xl-center"
                      >
                        {item.label}
                      </Nav.Link>
                    </Nav.Item>
                  ) : null,
                )}
                {user && (
                  <NavDropdown
                    align="end"
                    title={
                      <span className="d-block w-100 w-xl-auto text-start text-xl-center">
                        {userDisplayName || 'Cuenta'}
                      </span>
                    }
                    id="nav-user"
                    className="w-100 w-xl-auto"
                  >
                    <NavDropdown.Item as={NavLink} to="/perfil">
                      Mi perfil
                    </NavDropdown.Item>
                    <NavDropdown.Divider />
                    <NavDropdown.Item onClick={handleLogout}>Cerrar sesión</NavDropdown.Item>
                  </NavDropdown>
                )}
              </Nav>
            </Offcanvas.Body>
          </Navbar.Offcanvas>
        </Container>
      </Navbar>

      <main className="flex-grow-1 py-5">
        <Container fluid="xl">
          <AppRouter
            budgetsPageProps={budgetsPageProps}
            allBudgetsPageProps={allBudgetsPageProps}
            unworkedBudgetsPageProps={unworkedBudgetsPageProps}
            unplannedSessionsPageProps={unplannedSessionsPageProps}
            materialsBudgetsPageProps={materialsBudgetsPageProps}
            materialsPendingProductsPageProps={materialsPendingProductsPageProps}
            materialsOrdersPageProps={materialsOrdersPageProps}
            materialsBoardPageProps={materialsBoardPageProps}
            porSesionesPageProps={calendarSessionsPageProps}
            porUnidadMovilPageProps={calendarUnitsPageProps}
            porFormadorPageProps={calendarTrainersPageProps}
            porEmpresaPageProps={calendarOrganizationsPageProps}
            formadoresBomberosPageProps={formadoresBomberosPageProps}
            unidadesMovilesPageProps={unidadesMovilesPageProps}
            salasPageProps={salasPageProps}
            proveedoresPageProps={proveedoresPageProps}
            templatesCertificadosPageProps={templatesCertificadosPageProps}
            productosPageProps={productosPageProps}
            stockPageProps={stockPageProps}
            recursosConfirmacionesPageProps={recursosConfirmacionesPageProps}
            certificadosPageProps={certificadosPageProps}
            recursosFormacionAbiertaPageProps={recursosFormacionAbiertaPageProps}
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

      <VariantModal
        active={activeCalendarVariant}
        onHide={handleCloseCalendarVariant}
        onVariantUpdated={handleCalendarVariantUpdated}
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
