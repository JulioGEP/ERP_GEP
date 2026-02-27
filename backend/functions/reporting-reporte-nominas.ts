import type { office_payrolls, trainer_extra_costs } from '@prisma/client';

import { requireAuth } from './_shared/auth';
import { createHttpHandler } from './_shared/http';
import { getPrisma } from './_shared/prisma';
import { errorResponse, successResponse } from './_shared/response';

type DecimalLike = { toNumber?: () => number; toString?: () => string };

type CategoryKey = 'fixedTrainers' | 'fixedStaff' | 'discontinuousTrainers';

type MetricKey =
  | 'salarioBruto'
  | 'salarioBrutoTotal'
  | 'salarioLimpio'
  | 'contingenciasComunes'
  | 'aportacionSsIrpf'
  | 'totalEmpresa'
  | 'costeServicioFormacion'
  | 'costeServicioPreventivo'
  | 'dietas'
  | 'kilometraje'
  | 'pernocta'
  | 'nocturnidad'
  | 'festivo'
  | 'horasExtras'
  | 'gastosExtras';

type MetricTotals = Record<MetricKey, number>;

type CategoryTotals = {
  metrics: MetricTotals;
  totalCost: number;
};

type AggregatedPeriod = Record<CategoryKey | 'overall', CategoryTotals>;

type ComparisonMetric = {
  current: number;
  previous: number;
  absoluteDifference: number;
  percentageDifference: number | null;
};

type ComparisonResult = {
  metrics: Record<MetricKey, ComparisonMetric>;
  totalCost: ComparisonMetric;
};

const METRIC_KEYS: MetricKey[] = [
  'salarioBruto',
  'salarioBrutoTotal',
  'salarioLimpio',
  'contingenciasComunes',
  'aportacionSsIrpf',
  'totalEmpresa',
  'costeServicioFormacion',
  'costeServicioPreventivo',
  'dietas',
  'kilometraje',
  'pernocta',
  'nocturnidad',
  'festivo',
  'horasExtras',
  'gastosExtras',
];

const TRAINING_SERVICE_RATE_PER_HOUR = 30;
const PREVENTIVE_SERVICE_RATE_PER_HOUR = 15;

function decimalToNumber(value: DecimalLike | number | string | null | undefined): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (typeof value.toNumber === 'function') return value.toNumber();
  if (typeof value.toString === 'function') {
    const parsed = Number(value.toString());
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function roundToTwo(value: number): number {
  return Math.round(value * 100) / 100;
}

function emptyMetrics(): MetricTotals {
  return {
    salarioBruto: 0,
    salarioBrutoTotal: 0,
    salarioLimpio: 0,
    contingenciasComunes: 0,
    aportacionSsIrpf: 0,
    totalEmpresa: 0,
    costeServicioFormacion: 0,
    costeServicioPreventivo: 0,
    dietas: 0,
    kilometraje: 0,
    pernocta: 0,
    nocturnidad: 0,
    festivo: 0,
    horasExtras: 0,
    gastosExtras: 0,
  };
}

function emptyCategoryTotals(): CategoryTotals {
  return { metrics: emptyMetrics(), totalCost: 0 };
}

function computeTotalCost(metrics: MetricTotals): number {
  return roundToTwo(
    metrics.totalEmpresa
      + metrics.costeServicioFormacion
      + metrics.costeServicioPreventivo
      + metrics.dietas
      + metrics.kilometraje
      + metrics.pernocta
      + metrics.nocturnidad
      + metrics.festivo
      + metrics.horasExtras
      + metrics.gastosExtras,
  );
}

function computeSessionHours(start: Date | null, end: Date | null, breakHours = 0): number {
  if (!start || !end) return 0;
  const diff = end.getTime() - start.getTime();
  if (!Number.isFinite(diff) || diff <= 0) return 0;
  const totalHours = diff / (60 * 60 * 1000);
  const normalizedBreak = Number.isFinite(breakHours) ? Math.max(0, breakHours) : 0;
  return Math.max(0, totalHours - normalizedBreak);
}

function extractTimeParts(value: Date | string | null | undefined): { hour: number; minute: number } | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return {
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
  };
}

function computeVariantHours(
  variantDate: Date | string | null | undefined,
  productTimes: { hora_inicio: Date | string | null; hora_fin: Date | string | null },
): number {
  if (!variantDate) return 0;
  const parsedDate = variantDate instanceof Date ? variantDate : new Date(variantDate);
  if (Number.isNaN(parsedDate.getTime())) return 0;

  const startTime = extractTimeParts(productTimes.hora_inicio) ?? { hour: 9, minute: 0 };
  const endTime = extractTimeParts(productTimes.hora_fin) ?? { hour: 11, minute: 0 };

  const start = new Date(Date.UTC(
    parsedDate.getUTCFullYear(),
    parsedDate.getUTCMonth(),
    parsedDate.getUTCDate(),
    startTime.hour,
    startTime.minute,
  ));

  let end = new Date(Date.UTC(
    parsedDate.getUTCFullYear(),
    parsedDate.getUTCMonth(),
    parsedDate.getUTCDate(),
    endTime.hour,
    endTime.minute,
  ));

  if (end.getTime() <= start.getTime()) {
    end = new Date(start.getTime() + 60 * 60 * 1000);
  }

  const diff = end.getTime() - start.getTime();
  if (!Number.isFinite(diff) || diff <= 0) return 0;
  return diff / (60 * 60 * 1000);
}

function isPreventiveService(tipo: string | null | undefined): boolean {
  if (!tipo) return false;
  return tipo.toLowerCase().includes('preventivo');
}

function normalizePipelineLabel(value: string | null | undefined): string {
  if (!value) return '';
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

function isPreventivePipeline(pipeline: string | null | undefined): boolean {
  const normalized = normalizePipelineLabel(pipeline);
  return normalized === 'preventivos' || normalized === 'gep services' || normalized === 'pci';
}

function applyTrainerServiceCostMetrics(target: MetricTotals, extraCost: trainer_extra_costs & {
  sesion?: {
    fecha_inicio_utc: Date | null;
    fecha_fin_utc: Date | null;
    tiempo_parada: DecimalLike | null;
    deals: { tipo_servicio: string | null; pipeline_id: string | null; pipeline_label: string | null } | null;
  } | null;
  variant?: {
    date: Date | null;
    products: {
      hora_inicio: Date | null;
      hora_fin: Date | null;
      deal_products: Array<{
        deals: { pipeline_id: string | null; pipeline_label: string | null; tipo_servicio: string | null } | null;
      }>;
    } | null;
  } | null;
}): void {
  const breakHours = decimalToNumber(extraCost.sesion?.tiempo_parada);
  const sessionHours = computeSessionHours(extraCost.sesion?.fecha_inicio_utc ?? null, extraCost.sesion?.fecha_fin_utc ?? null, breakHours);
  const variantHours = computeVariantHours(extraCost.variant?.date ?? null, extraCost.variant?.products ?? { hora_inicio: null, hora_fin: null });
  const workedHours = sessionHours + variantHours;

  const pipelineSource =
    extraCost.sesion?.deals?.pipeline_id
    ?? extraCost.sesion?.deals?.pipeline_label
    ?? extraCost.variant?.products?.deal_products[0]?.deals?.pipeline_id
    ?? extraCost.variant?.products?.deal_products[0]?.deals?.pipeline_label
    ?? null;

  const variantDeal = extraCost.variant?.products?.deal_products[0]?.deals ?? null;

  const serviceType = (isPreventivePipeline(pipelineSource)
    || isPreventiveService(extraCost.sesion?.deals?.tipo_servicio)
    || isPreventiveService(variantDeal?.tipo_servicio))
    ? 'preventivo'
    : 'formacion';

  if (serviceType === 'preventivo') {
    target.costeServicioPreventivo += workedHours * PREVENTIVE_SERVICE_RATE_PER_HOUR;
  } else {
    target.costeServicioFormacion += workedHours * TRAINING_SERVICE_RATE_PER_HOUR;
  }
}

function applyOfficePayrollMetrics(target: MetricTotals, payroll: office_payrolls): void {
  target.salarioBruto += decimalToNumber(payroll.salario_bruto);
  target.salarioBrutoTotal += decimalToNumber(payroll.salario_bruto_total);
  target.salarioLimpio += decimalToNumber(payroll.salario_limpio);
  target.contingenciasComunes += decimalToNumber(payroll.contingencias_comunes);
  target.aportacionSsIrpf += decimalToNumber(payroll.aportacion_ss_irpf);
  target.totalEmpresa += decimalToNumber(payroll.total_empresa);
  target.dietas += decimalToNumber(payroll.dietas);
  target.kilometraje += decimalToNumber(payroll.kilometrajes);
  target.pernocta += decimalToNumber(payroll.pernocta);
  target.nocturnidad += decimalToNumber(payroll.nocturnidad);
  target.festivo += decimalToNumber(payroll.festivo);
  target.horasExtras += decimalToNumber(payroll.horas_extras);
  target.gastosExtras += decimalToNumber(payroll.otros_gastos);
}

function applyTrainerExtraCostMetrics(target: MetricTotals, extraCost: trainer_extra_costs): void {
  target.dietas += decimalToNumber(extraCost.dietas);
  target.kilometraje += decimalToNumber(extraCost.kilometraje);
  target.pernocta += decimalToNumber(extraCost.pernocta);
  target.nocturnidad += decimalToNumber(extraCost.nocturnidad);
  target.festivo += decimalToNumber(extraCost.festivo);
  target.horasExtras += decimalToNumber(extraCost.horas_extras);
  target.gastosExtras += decimalToNumber(extraCost.gastos_extras);
}

function finalizeCategoryTotals(category: CategoryTotals): CategoryTotals {
  const roundedMetrics = emptyMetrics();
  METRIC_KEYS.forEach((key) => {
    roundedMetrics[key] = roundToTwo(category.metrics[key]);
  });
  return {
    metrics: roundedMetrics,
    totalCost: computeTotalCost(roundedMetrics),
  };
}

function buildComparison(current: CategoryTotals, previous: CategoryTotals): ComparisonResult {
  const metrics = {} as Record<MetricKey, ComparisonMetric>;

  METRIC_KEYS.forEach((key) => {
    const currentValue = roundToTwo(current.metrics[key]);
    const previousValue = roundToTwo(previous.metrics[key]);
    const absoluteDifference = roundToTwo(currentValue - previousValue);
    const percentageDifference =
      previousValue === 0 ? null : roundToTwo((absoluteDifference / previousValue) * 100);

    metrics[key] = {
      current: currentValue,
      previous: previousValue,
      absoluteDifference,
      percentageDifference,
    };
  });

  const totalCurrent = roundToTwo(current.totalCost);
  const totalPrevious = roundToTwo(previous.totalCost);
  const totalAbsoluteDifference = roundToTwo(totalCurrent - totalPrevious);

  return {
    metrics,
    totalCost: {
      current: totalCurrent,
      previous: totalPrevious,
      absoluteDifference: totalAbsoluteDifference,
      percentageDifference:
        totalPrevious === 0 ? null : roundToTwo((totalAbsoluteDifference / totalPrevious) * 100),
    },
  };
}

function buildMonthRangeUtc(year: number, month: number): { start: Date; end: Date } {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));
  return { start, end };
}

function parseYearMonth(value: string | null): { year: number; month: number } | null {
  if (!value) return null;
  const trimmed = value.trim();
  const match = /^(\d{4})-(\d{2})$/.exec(trimmed);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return null;
  }
  return { year, month };
}

function getPreviousMonth(year: number, month: number): { year: number; month: number } {
  if (month === 1) return { year: year - 1, month: 12 };
  return { year, month: month - 1 };
}

function getQuarter(month: number): number {
  return Math.floor((month - 1) / 3) + 1;
}

function getQuarterMonths(quarter: number): number[] {
  const startMonth = (quarter - 1) * 3 + 1;
  return [startMonth, startMonth + 1, startMonth + 2];
}

function getPreviousQuarter(year: number, quarter: number): { year: number; quarter: number } {
  if (quarter === 1) return { year: year - 1, quarter: 4 };
  return { year, quarter: quarter - 1 };
}

export const handler = createHttpHandler(async (request) => {
  if (request.method !== 'GET') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Método no permitido', 405);
  }

  const prisma = getPrisma();
  const auth = await requireAuth(request, prisma, { requireRoles: ['Admin'] });
  if ('error' in auth) return auth.error;

  const now = new Date();
  const defaultPeriod = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const periodInput = request.query.period ?? defaultPeriod;
  const parsedPeriod = parseYearMonth(periodInput);
  if (!parsedPeriod) {
    return errorResponse('INVALID_PERIOD', 'El periodo debe tener el formato YYYY-MM.', 400);
  }


  const aggregateMonth = async (year: number, month: number): Promise<AggregatedPeriod> => {
    const monthRange = buildMonthRangeUtc(year, month);

    const [officePayrolls, trainerExtraCosts] = await Promise.all([
      prisma.office_payrolls.findMany({
        where: { year, month },
        include: { user: { select: { trainer: { select: { contrato_fijo: true } } } } },
      }),
      prisma.trainer_extra_costs.findMany({
        where: {
          created_at: {
            gte: monthRange.start,
            lt: monthRange.end,
          },
        },
        include: {
          trainer: {
            select: {
              contrato_fijo: true,
            },
          },
          sesion: {
            select: {
              fecha_inicio_utc: true,
              fecha_fin_utc: true,
              tiempo_parada: true,
              deals: {
                select: {
                  tipo_servicio: true,
                  pipeline_id: true,
                  pipeline_label: true,
                },
              },
            },
          },
          variant: {
            select: {
              date: true,
              products: {
                select: {
                  hora_inicio: true,
                  hora_fin: true,
                  deal_products: {
                    take: 1,
                    select: {
                      deals: {
                        select: {
                          tipo_servicio: true,
                          pipeline_id: true,
                          pipeline_label: true,
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      }),
    ]);

    const fixedTrainers = emptyCategoryTotals();
    const fixedStaff = emptyCategoryTotals();
    const discontinuousTrainers = emptyCategoryTotals();

    officePayrolls.forEach((payroll) => {
      const isFixedTrainer = Boolean(payroll.user?.trainer?.contrato_fijo);
      if (isFixedTrainer) {
        applyOfficePayrollMetrics(fixedTrainers.metrics, payroll);
      } else {
        applyOfficePayrollMetrics(fixedStaff.metrics, payroll);
      }
    });

    trainerExtraCosts.forEach((cost) => {
      const isFixedTrainer = Boolean(cost.trainer?.contrato_fijo);
      if (!isFixedTrainer) {
        applyTrainerServiceCostMetrics(discontinuousTrainers.metrics, cost);
        applyTrainerExtraCostMetrics(discontinuousTrainers.metrics, cost);
      }
    });

    const finalizedFixedTrainers = finalizeCategoryTotals(fixedTrainers);
    const finalizedFixedStaff = finalizeCategoryTotals(fixedStaff);
    const finalizedDiscontinuous = finalizeCategoryTotals(discontinuousTrainers);

    const overallMetrics = emptyMetrics();
    [finalizedFixedTrainers, finalizedFixedStaff, finalizedDiscontinuous].forEach((category) => {
      METRIC_KEYS.forEach((key) => {
        overallMetrics[key] = roundToTwo(overallMetrics[key] + category.metrics[key]);
      });
    });

    const overall: CategoryTotals = {
      metrics: overallMetrics,
      totalCost: computeTotalCost(overallMetrics),
    };

    return {
      fixedTrainers: finalizedFixedTrainers,
      fixedStaff: finalizedFixedStaff,
      discontinuousTrainers: finalizedDiscontinuous,
      overall,
    };
  };

  const aggregateQuarter = async (year: number, quarter: number): Promise<AggregatedPeriod> => {
    const months = getQuarterMonths(quarter);
    const monthAggregates = await Promise.all(months.map((month) => aggregateMonth(year, month)));

    const result: AggregatedPeriod = {
      fixedTrainers: emptyCategoryTotals(),
      fixedStaff: emptyCategoryTotals(),
      discontinuousTrainers: emptyCategoryTotals(),
      overall: emptyCategoryTotals(),
    };

    monthAggregates.forEach((aggregate) => {
      (Object.keys(result) as Array<keyof AggregatedPeriod>).forEach((categoryKey) => {
        METRIC_KEYS.forEach((metricKey) => {
          result[categoryKey].metrics[metricKey] = roundToTwo(
            result[categoryKey].metrics[metricKey] + aggregate[categoryKey].metrics[metricKey],
          );
        });
      });
    });

    (Object.keys(result) as Array<keyof AggregatedPeriod>).forEach((categoryKey) => {
      result[categoryKey] = finalizeCategoryTotals(result[categoryKey]);
    });

    return result;
  };

  const { year, month } = parsedPeriod;
  const quarter = getQuarter(month);
  const previousMonth = getPreviousMonth(year, month);
  const previousQuarter = getPreviousQuarter(year, quarter);

  const [
    currentMonth,
    monthBefore,
    sameMonthLastYear,
    currentQuarter,
    quarterBefore,
    sameQuarterLastYear,
  ] = await Promise.all([
    aggregateMonth(year, month),
    aggregateMonth(previousMonth.year, previousMonth.month),
    aggregateMonth(year - 1, month),
    aggregateQuarter(year, quarter),
    aggregateQuarter(previousQuarter.year, previousQuarter.quarter),
    aggregateQuarter(year - 1, quarter),
  ]);

  return successResponse({
    period: {
      year,
      month,
      quarter,
      period: `${year}-${String(month).padStart(2, '0')}`,
    },
    totals: currentMonth,
    quarterTotals: currentQuarter,
    comparisons: {
      monthVsPreviousMonth: buildComparison(currentMonth.overall, monthBefore.overall),
      monthVsSameMonthLastYear: buildComparison(currentMonth.overall, sameMonthLastYear.overall),
      quarterVsPreviousQuarter: buildComparison(currentQuarter.overall, quarterBefore.overall),
      quarterVsSameQuarterLastYear: buildComparison(currentQuarter.overall, sameQuarterLastYear.overall),
    },
  });
});

export default handler;
