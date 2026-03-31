import type { office_payrolls, trainer_extra_costs } from '@prisma/client';

import { requireAuth } from './_shared/auth';
import { createHttpHandler } from './_shared/http';
import { getPrisma } from './_shared/prisma';
import { errorResponse, successResponse } from './_shared/response';

type DecimalLike = { toNumber?: () => number; toString?: () => string };

type CategoryKey = 'fixedTrainers' | 'fixedStaff' | 'discontinuousTraining' | 'discontinuousPreventive' | 'discontinuousTrainers';

type MetricKey =
  | 'salarioBruto'
  | 'extrasBruto'
  | 'aportacionTrabajadorSs'
  | 'retencionIrpf'
  | 'dietasKilometraje'
  | 'salarioNeto'
  | 'aportacionEmpresarialSs'
  | 'costeTotal';

type MetricTotals = Record<MetricKey, number>;

type CategoryTotals = {
  metrics: MetricTotals;
  totalCost: number;
  serviceCost: number;
};

type AggregatedPeriod = {
  fixedTrainers: CategoryTotals;
  fixedStaff: CategoryTotals;
  discontinuousTraining: CategoryTotals;
  discontinuousPreventive: CategoryTotals;
  discontinuousTrainers: CategoryTotals;
  overall: CategoryTotals;
};

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
  'extrasBruto',
  'aportacionTrabajadorSs',
  'retencionIrpf',
  'dietasKilometraje',
  'salarioNeto',
  'aportacionEmpresarialSs',
  'costeTotal',
];

const EMPLOYEE_SS_RATE = 0.065;
const EMPLOYER_SS_RATE = 0.3425;

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
    extrasBruto: 0,
    aportacionTrabajadorSs: 0,
    retencionIrpf: 0,
    dietasKilometraje: 0,
    salarioNeto: 0,
    aportacionEmpresarialSs: 0,
    costeTotal: 0,
  };
}

function emptyCategoryTotals(): CategoryTotals {
  return { metrics: emptyMetrics(), totalCost: 0, serviceCost: 0 };
}

function computePayrollDerivedMetrics(metrics: MetricTotals): MetricTotals {
  const salarioBruto = roundToTwo(metrics.salarioBruto);
  const extrasBruto = roundToTwo(metrics.extrasBruto);
  const dietasKilometraje = roundToTwo(metrics.dietasKilometraje);
  const aportacionTrabajadorSs = roundToTwo(salarioBruto * EMPLOYEE_SS_RATE);
  const retencionIrpf = roundToTwo(Math.max(metrics.retencionIrpf, 0));
  const salarioNeto = roundToTwo(salarioBruto - aportacionTrabajadorSs - retencionIrpf + dietasKilometraje);
  const aportacionEmpresarialSs = roundToTwo(salarioBruto * EMPLOYER_SS_RATE);
  const costeTotal = roundToTwo(salarioNeto + aportacionEmpresarialSs);

  return {
    salarioBruto,
    extrasBruto,
    aportacionTrabajadorSs,
    retencionIrpf,
    dietasKilometraje,
    salarioNeto,
    aportacionEmpresarialSs,
    costeTotal,
  };
}

function computeDiscontinuousDerivedMetrics(metrics: MetricTotals, serviceCost: number): MetricTotals {
  const salarioBruto = 0;
  const extrasBruto = roundToTwo(metrics.extrasBruto);
  const dietasKilometraje = roundToTwo(metrics.dietasKilometraje);
  const aportacionTrabajadorSs = 0;
  const retencionIrpf = 0;
  const salarioNeto = roundToTwo(extrasBruto + dietasKilometraje);
  const aportacionEmpresarialSs = 0;
  const costeTotal = roundToTwo(salarioNeto + serviceCost);

  return {
    salarioBruto,
    extrasBruto,
    aportacionTrabajadorSs,
    retencionIrpf,
    dietasKilometraje,
    salarioNeto,
    aportacionEmpresarialSs,
    costeTotal,
  };
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

const DEFAULT_SERVICE_COSTS = {
  formacion: 30,
  preventivo: 15,
} as const;

const CANCELLED_VARIANT_STATUS = 'cancelado';
const EXCLUDED_SESSION_STATES: Array<'SUSPENDIDA' | 'CANCELADA'> = ['SUSPENDIDA', 'CANCELADA'];

function normalizeForMatching(value: string | null | undefined): string {
  if (!value) return '';
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

function isPreventivePipeline(
  pipelineLabel: string | null | undefined,
  pipelineId: string | null | undefined,
): boolean {
  const normalizedLabel = normalizeForMatching(pipelineLabel);
  const normalizedId = normalizeForMatching(pipelineId);

  return (
    normalizedLabel === 'gep services'
    || normalizedLabel === 'preventivos'
    || normalizedLabel === 'pci'
    || normalizedId === 'gep services'
    || normalizedId === 'preventivos'
    || normalizedId === 'pci'
  );
}

async function applyDiscontinuousServiceCosts(
  prisma: ReturnType<typeof getPrisma>,
  monthRange: { start: Date; end: Date },
  trainingTarget: CategoryTotals,
  preventiveTarget: CategoryTotals,
): Promise<void> {
  const sesionTrainers = await prisma.sesion_trainers.findMany({
    where: {
      trainers: {
        is: {
          contrato_fijo: false,
          user: {
            is: {
              can_deliver_training: false,
            },
          },
        },
      },
      sesiones: {
        fecha_inicio_utc: {
          gte: monthRange.start,
          lt: monthRange.end,
        },
        fecha_fin_utc: {
          not: null,
        },
        estado: {
          notIn: EXCLUDED_SESSION_STATES,
        },
      },
    },
    select: {
      sesion_id: true,
      trainer_id: true,
      sesiones: {
        select: {
          fecha_inicio_utc: true,
          fecha_fin_utc: true,
          tiempo_parada: true,
          deals: {
            select: {
              tipo_servicio: true,
              pipeline_label: true,
              pipeline_id: true,
            },
          },
        },
      },
    },
  });

  const sessionIds = new Set<string>();
  const sessionTrainerIds = new Set<string>();
  sesionTrainers.forEach((row) => {
    if (row.sesion_id) sessionIds.add(row.sesion_id);
    if (row.trainer_id) sessionTrainerIds.add(row.trainer_id);
  });

  const variants = await prisma.variants.findMany({
    where: {
      trainer_id: {
        not: null,
      },
      date: {
        not: null,
        gte: monthRange.start,
        lt: monthRange.end,
      },
      NOT: {
        status: { equals: CANCELLED_VARIANT_STATUS, mode: 'insensitive' },
      },
      trainers: {
        is: {
          contrato_fijo: false,
          user: {
            is: {
              can_deliver_training: false,
            },
          },
        },
      },
    },
    select: {
      id: true,
      trainer_id: true,
      date: true,
      products: {
        select: {
          hora_inicio: true,
          hora_fin: true,
        },
      },
    },
  });

  const variantIds = new Set<string>();
  const variantTrainerIds = new Set<string>();
  variants.forEach((variant) => {
    variantIds.add(variant.id);
    if (variant.trainer_id) variantTrainerIds.add(variant.trainer_id);
  });

  const trainerIds = new Set<string>([...sessionTrainerIds, ...variantTrainerIds]);
  const extraCostRows = trainerIds.size
    ? await prisma.trainer_extra_costs.findMany({
        where: {
          trainer_id: {
            in: Array.from(trainerIds),
          },
          OR: [
            ...(sessionIds.size ? [{ session_id: { in: Array.from(sessionIds) } }] : []),
            ...(variantIds.size ? [{ variant_id: { in: Array.from(variantIds) } }] : []),
          ],
        },
      })
    : [];

  const extraCostMap = new Map<string, trainer_extra_costs>();
  extraCostRows.forEach((row) => {
    if (row.session_id) {
      extraCostMap.set(`session:${row.session_id}:${row.trainer_id}`, row);
    }
    if (row.variant_id) {
      extraCostMap.set(`variant:${row.variant_id}:${row.trainer_id}`, row);
    }
  });

  sesionTrainers.forEach((row) => {
    if (!row.trainer_id || !row.sesion_id) return;
    const breakHours = decimalToNumber(row.sesiones?.tiempo_parada);
    const hours = computeSessionHours(row.sesiones?.fecha_inicio_utc ?? null, row.sesiones?.fecha_fin_utc ?? null, breakHours);
    const extraCost = extraCostMap.get(`session:${row.sesion_id}:${row.trainer_id}`) ?? null;
    const isPreventive = isPreventiveService(row.sesiones?.deals?.tipo_servicio)
      || isPreventivePipeline(row.sesiones?.deals?.pipeline_label, row.sesiones?.deals?.pipeline_id);

    if (isPreventive) {
      const rate = Math.max(decimalToNumber(extraCost?.precio_coste_preventivo), 0) || DEFAULT_SERVICE_COSTS.preventivo;
      preventiveTarget.serviceCost += hours * rate;
      return;
    }

    const rate = Math.max(decimalToNumber(extraCost?.precio_coste_formacion), 0) || DEFAULT_SERVICE_COSTS.formacion;
    trainingTarget.serviceCost += hours * rate;
  });

  variants.forEach((variant) => {
    if (!variant.trainer_id) return;
    const hours = computeVariantHours(variant.date, variant.products ?? { hora_inicio: null, hora_fin: null });
    const extraCost = extraCostMap.get(`variant:${variant.id}:${variant.trainer_id}`) ?? null;
    const rate = Math.max(decimalToNumber(extraCost?.precio_coste_formacion), 0) || DEFAULT_SERVICE_COSTS.formacion;
    trainingTarget.serviceCost += hours * rate;
  });
}


function applyOfficePayrollMetrics(target: MetricTotals, payroll: office_payrolls): void {
  const baseSalary = decimalToNumber(payroll.salario_bruto);
  const extrasBruto = decimalToNumber(payroll.pernocta)
    + decimalToNumber(payroll.nocturnidad)
    + decimalToNumber(payroll.festivo)
    + decimalToNumber(payroll.horas_extras)
    + decimalToNumber(payroll.otros_gastos)
    + decimalToNumber(payroll.variable);
  const salarioBrutoTotal = decimalToNumber(payroll.salario_bruto_total) || (baseSalary + extrasBruto);
  const deductionAmount = Math.abs(decimalToNumber(payroll.aportacion_ss_irpf));
  const aportacionTrabajador = salarioBrutoTotal * EMPLOYEE_SS_RATE;
  const retencionIrpf = Math.max(deductionAmount - aportacionTrabajador, 0);

  target.salarioBruto += salarioBrutoTotal;
  target.extrasBruto += extrasBruto;
  target.dietasKilometraje += decimalToNumber(payroll.dietas) + decimalToNumber(payroll.kilometrajes);
  target.retencionIrpf += retencionIrpf;
}

function applyTrainerExtraCostMetrics(target: MetricTotals, extraCost: trainer_extra_costs): void {
  target.dietasKilometraje += decimalToNumber(extraCost.dietas) + decimalToNumber(extraCost.kilometraje);
  target.extrasBruto += decimalToNumber(extraCost.pernocta)
    + decimalToNumber(extraCost.nocturnidad)
    + decimalToNumber(extraCost.festivo)
    + decimalToNumber(extraCost.horas_extras)
    + decimalToNumber(extraCost.gastos_extras);
}

function finalizeCategoryTotals(category: CategoryTotals, mode: 'payroll' | 'discontinuous' | 'precomputed'): CategoryTotals {
  const roundedMetrics = mode === 'payroll'
    ? computePayrollDerivedMetrics(category.metrics)
    : mode === 'discontinuous'
      ? computeDiscontinuousDerivedMetrics(category.metrics, roundToTwo(category.serviceCost))
      : METRIC_KEYS.reduce((acc, key) => {
          acc[key] = roundToTwo(category.metrics[key]);
          return acc;
        }, emptyMetrics());

  return {
    metrics: roundedMetrics,
    totalCost: roundedMetrics.costeTotal,
    serviceCost: roundToTwo(category.serviceCost),
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
  const start = new Date(Date.UTC(year, month - 2, 26, 0, 0, 0, 0));
  const end = new Date(Date.UTC(year, month - 1, 26, 0, 0, 0, 0));
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
        include: {
          user: {
            select: {
              can_deliver_training: true,
              trainer: { select: { contrato_fijo: true } },
            },
          },
        },
      }),
      prisma.trainer_extra_costs.findMany({
        where: {
          OR: [
            {
              sesion: {
                fecha_inicio_utc: {
                  gte: monthRange.start,
                  lt: monthRange.end,
                },
              },
            },
            {
              variant: {
                date: {
                  gte: monthRange.start,
                  lt: monthRange.end,
                },
              },
            },
          ],
        },
        include: {
          trainer: {
            select: {
              contrato_fijo: true,
              user: {
                select: {
                  can_deliver_training: true,
                },
              },
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
                  pipeline_label: true,
                  pipeline_id: true,
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
                },
              },
            },
          },
        },
      }),
    ]);

    const fixedTrainers = emptyCategoryTotals();
    const fixedStaff = emptyCategoryTotals();
    const discontinuousTraining = emptyCategoryTotals();
    const discontinuousPreventive = emptyCategoryTotals();

    officePayrolls.forEach((payroll) => {
      const isFixedTrainer = Boolean(payroll.user?.trainer?.contrato_fijo) && !Boolean(payroll.user?.can_deliver_training);
      if (isFixedTrainer) {
        applyOfficePayrollMetrics(fixedTrainers.metrics, payroll);
      } else {
        applyOfficePayrollMetrics(fixedStaff.metrics, payroll);
      }
    });

    trainerExtraCosts.forEach((cost) => {
      if (cost.trainer?.user?.can_deliver_training) {
        return;
      }
      const isFixedTrainer = Boolean(cost.trainer?.contrato_fijo);
      if (isFixedTrainer) {
        // Para formadores fijos, los extras ya se consolidan en office_payrolls
        // desde reporting-costes-extra. Evitamos doble conteo en reporte_nominas.
        return;
      }

      const isPreventiveCost = isPreventiveService(cost.sesion?.deals?.tipo_servicio)
        || isPreventivePipeline(cost.sesion?.deals?.pipeline_label, cost.sesion?.deals?.pipeline_id);
      if (isPreventiveCost) {
        applyTrainerExtraCostMetrics(discontinuousPreventive.metrics, cost);
        return;
      }

      applyTrainerExtraCostMetrics(discontinuousTraining.metrics, cost);
    });

    await applyDiscontinuousServiceCosts(prisma, monthRange, discontinuousTraining, discontinuousPreventive);

    const finalizedFixedTrainers = finalizeCategoryTotals(fixedTrainers, 'payroll');
    const finalizedFixedStaff = finalizeCategoryTotals(fixedStaff, 'payroll');
    const finalizedDiscontinuousTraining = finalizeCategoryTotals(discontinuousTraining, 'discontinuous');
    const finalizedDiscontinuousPreventive = finalizeCategoryTotals(discontinuousPreventive, 'discontinuous');
    const discontinuousCombined = emptyCategoryTotals();
    METRIC_KEYS.forEach((key) => {
      discontinuousCombined.metrics[key] = roundToTwo(
        finalizedDiscontinuousTraining.metrics[key] + finalizedDiscontinuousPreventive.metrics[key],
      );
    });
    discontinuousCombined.serviceCost = roundToTwo(
      finalizedDiscontinuousTraining.serviceCost + finalizedDiscontinuousPreventive.serviceCost,
    );
    const finalizedDiscontinuous = finalizeCategoryTotals(discontinuousCombined, 'discontinuous');

    const overallMetrics = emptyMetrics();
    [finalizedFixedTrainers, finalizedFixedStaff, finalizedDiscontinuous].forEach((category) => {
      METRIC_KEYS.forEach((key) => {
        overallMetrics[key] = roundToTwo(overallMetrics[key] + category.metrics[key]);
      });
    });

    const overall: CategoryTotals = {
      metrics: overallMetrics,
      totalCost: roundToTwo(overallMetrics.costeTotal),
      serviceCost: roundToTwo(
        finalizedFixedTrainers.serviceCost
        + finalizedFixedStaff.serviceCost
        + finalizedDiscontinuous.serviceCost,
      ),
    };

    return {
      fixedTrainers: finalizedFixedTrainers,
      fixedStaff: finalizedFixedStaff,
      discontinuousTraining: finalizedDiscontinuousTraining,
      discontinuousPreventive: finalizedDiscontinuousPreventive,
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
      discontinuousTraining: emptyCategoryTotals(),
      discontinuousPreventive: emptyCategoryTotals(),
      discontinuousTrainers: emptyCategoryTotals(),
      overall: emptyCategoryTotals(),
    };
    const categoryKeys: Array<keyof AggregatedPeriod> = [
      'fixedTrainers',
      'fixedStaff',
      'discontinuousTraining',
      'discontinuousPreventive',
      'discontinuousTrainers',
      'overall',
    ];

    monthAggregates.forEach((aggregate) => {
      categoryKeys.forEach((categoryKey) => {
        METRIC_KEYS.forEach((metricKey) => {
          result[categoryKey].metrics[metricKey] = roundToTwo(
            result[categoryKey].metrics[metricKey] + aggregate[categoryKey].metrics[metricKey],
          );
        });
        result[categoryKey].serviceCost = roundToTwo(
          result[categoryKey].serviceCost + aggregate[categoryKey].serviceCost,
        );
      });
    });

    result.fixedTrainers = finalizeCategoryTotals(result.fixedTrainers, 'precomputed');
    result.fixedStaff = finalizeCategoryTotals(result.fixedStaff, 'precomputed');
    result.discontinuousTraining = finalizeCategoryTotals(result.discontinuousTraining, 'precomputed');
    result.discontinuousPreventive = finalizeCategoryTotals(result.discontinuousPreventive, 'precomputed');
    result.discontinuousTrainers = finalizeCategoryTotals(result.discontinuousTrainers, 'precomputed');
    result.overall = finalizeCategoryTotals(result.overall, 'precomputed');

    return result;
  };

  const { year, month } = parsedPeriod;
  const quarter = getQuarter(month);
  const previousMonth = getPreviousMonth(year, month);
  const previousQuarter = getPreviousQuarter(year, quarter);
  const today = new Date();
  const currentMonthNumber = today.getUTCMonth() + 1;

  const aggregateYearToDate = async (targetYear: number, targetMonth: number): Promise<AggregatedPeriod> => {
    const months = Array.from({ length: targetMonth }, (_, index) => index + 1);
    const monthAggregates = await Promise.all(months.map((monthValue) => aggregateMonth(targetYear, monthValue)));

    const result: AggregatedPeriod = {
      fixedTrainers: emptyCategoryTotals(),
      fixedStaff: emptyCategoryTotals(),
      discontinuousTraining: emptyCategoryTotals(),
      discontinuousPreventive: emptyCategoryTotals(),
      discontinuousTrainers: emptyCategoryTotals(),
      overall: emptyCategoryTotals(),
    };
    const categoryKeys: Array<keyof AggregatedPeriod> = [
      'fixedTrainers',
      'fixedStaff',
      'discontinuousTraining',
      'discontinuousPreventive',
      'discontinuousTrainers',
      'overall',
    ];

    monthAggregates.forEach((aggregate) => {
      categoryKeys.forEach((categoryKey) => {
        METRIC_KEYS.forEach((metricKey) => {
          result[categoryKey].metrics[metricKey] = roundToTwo(
            result[categoryKey].metrics[metricKey] + aggregate[categoryKey].metrics[metricKey],
          );
        });
        result[categoryKey].serviceCost = roundToTwo(
          result[categoryKey].serviceCost + aggregate[categoryKey].serviceCost,
        );
      });
    });

    result.fixedTrainers = finalizeCategoryTotals(result.fixedTrainers, 'precomputed');
    result.fixedStaff = finalizeCategoryTotals(result.fixedStaff, 'precomputed');
    result.discontinuousTraining = finalizeCategoryTotals(result.discontinuousTraining, 'precomputed');
    result.discontinuousPreventive = finalizeCategoryTotals(result.discontinuousPreventive, 'precomputed');
    result.discontinuousTrainers = finalizeCategoryTotals(result.discontinuousTrainers, 'precomputed');
    result.overall = finalizeCategoryTotals(result.overall, 'precomputed');

    return result;
  };

  const [
    currentMonth,
    monthBefore,
    sameMonthLastYear,
    currentQuarter,
    quarterBefore,
    sameQuarterLastYear,
    currentYearToDate,
    lastYearToDate,
  ] = await Promise.all([
    aggregateMonth(year, month),
    aggregateMonth(previousMonth.year, previousMonth.month),
    aggregateMonth(year - 1, month),
    aggregateQuarter(year, quarter),
    aggregateQuarter(previousQuarter.year, previousQuarter.quarter),
    aggregateQuarter(year - 1, quarter),
    aggregateYearToDate(today.getUTCFullYear(), currentMonthNumber),
    aggregateYearToDate(today.getUTCFullYear() - 1, currentMonthNumber),
  ]);

  return successResponse({
    period: {
      year,
      month,
      quarter,
      period: `${year}-${String(month).padStart(2, '0')}`,
    },
    totals: {
      fixedTrainers: currentMonth.fixedTrainers,
      fixedStaff: currentMonth.fixedStaff,
      discontinuousTrainers: currentMonth.discontinuousTrainers,
      discontinuousByService: {
        training: currentMonth.discontinuousTraining,
        preventive: currentMonth.discontinuousPreventive,
      },
      overall: currentMonth.overall,
    },
    quarterTotals: {
      fixedTrainers: currentQuarter.fixedTrainers,
      fixedStaff: currentQuarter.fixedStaff,
      discontinuousTrainers: currentQuarter.discontinuousTrainers,
      discontinuousByService: {
        training: currentQuarter.discontinuousTraining,
        preventive: currentQuarter.discontinuousPreventive,
      },
      overall: currentQuarter.overall,
    },
    comparisons: {
      monthVsPreviousMonth: buildComparison(currentMonth.overall, monthBefore.overall),
      monthVsSameMonthLastYear: buildComparison(currentMonth.overall, sameMonthLastYear.overall),
      quarterVsPreviousQuarter: buildComparison(currentQuarter.overall, quarterBefore.overall),
      quarterVsSameQuarterLastYear: buildComparison(currentQuarter.overall, sameQuarterLastYear.overall),
      yearToDateVsSameDateLastYear: buildComparison(currentYearToDate.overall, lastYearToDate.overall),
    },
  });
});

export default handler;
