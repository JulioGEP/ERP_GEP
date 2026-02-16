import { createHttpHandler } from "./_shared/http";
import { requireAuth } from "./_shared/auth";
import { getPrisma } from "./_shared/prisma";
import { errorResponse, successResponse } from "./_shared/response";
import { buildMadridDateTime } from "./_shared/time";

type ParsedDateFilters =
  | { startDate: Date | null; endDate: Date | null }
  | { error: ReturnType<typeof errorResponse> };

type DecimalLike = { toNumber?: () => number; toString?: () => string };

type ReportRow = {
  trainerId: string;
  trainerName: string;
  sessionId: string;
  sessionName: string;
  sessionDate: string | null;
  assignedHours: number;
  loggedHours: number;
  dayHours: number;
  nightHours: number;
  regionalHolidayHours: number;
  nationalHolidayHours: number;
  hasTimeLog: boolean;
  timeLogId: string | null;
  checkIn: string | null;
  checkOut: string | null;
};

type MutationPayload = {
  id?: string;
  trainerId?: string;
  sessionId?: string;
  date?: string;
  checkInTime?: string;
  checkOutTime?: string | null;
};

function parseDateParts(
  value: string,
): { year: number; month: number; day: number } | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const day = Number.parseInt(match[3], 10);
  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day)
  )
    return null;
  const reference = new Date(Date.UTC(year, month - 1, day));
  if (
    reference.getUTCFullYear() !== year ||
    reference.getUTCMonth() !== month - 1 ||
    reference.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

function parseTimeParts(
  value: string,
): { hour: number; minute: number } | null {
  const match = value.match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;

  const hour = Number.parseInt(match[1], 10);
  const minute = Number.parseInt(match[2], 10);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;

  return { hour, minute };
}

function combineMadridDateAndTime(
  dateText: string,
  timeText: string,
): Date | null {
  const dateParts = parseDateParts(dateText);
  const timeParts = parseTimeParts(timeText);
  if (!dateParts || !timeParts) return null;

  return buildMadridDateTime({ ...dateParts, ...timeParts });
}

function parseDateFilters(
  query: Record<string, string | undefined>,
): ParsedDateFilters {
  const startText = query.startDate?.trim() ?? "";
  const endText = query.endDate?.trim() ?? "";

  let startDate: Date | null = null;
  let endDate: Date | null = null;

  if (startText) {
    const parts = parseDateParts(startText);
    if (!parts) {
      return {
        error: errorResponse(
          "INVALID_DATE",
          "La fecha de inicio proporcionada no es válida.",
          400,
        ),
      };
    }
    startDate = buildMadridDateTime({ ...parts, hour: 0, minute: 0 });
  }

  if (endText) {
    const parts = parseDateParts(endText);
    if (!parts) {
      return {
        error: errorResponse(
          "INVALID_DATE",
          "La fecha de fin proporcionada no es válida.",
          400,
        ),
      };
    }
    endDate = buildMadridDateTime({ ...parts, hour: 23, minute: 59 });
  }

  if (startDate && endDate && endDate.getTime() < startDate.getTime()) {
    return {
      error: errorResponse(
        "INVALID_DATE_RANGE",
        "La fecha de inicio no puede ser posterior a la fecha de fin.",
        400,
      ),
    };
  }

  return { startDate, endDate };
}

function decimalToNumber(
  value: DecimalLike | number | string | null | undefined,
): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (typeof value.toNumber === "function") return value.toNumber();
  if (typeof value.toString === "function") {
    const parsed = Number(value.toString());
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function roundHours(value: number): number {
  return Math.round(value * 100) / 100;
}

function computeHours(
  start: Date | null,
  end: Date | null,
  breakHours = 0,
): number {
  if (!start || !end) return 0;
  const diff = end.getTime() - start.getTime();
  if (!Number.isFinite(diff) || diff <= 0) return 0;
  const totalHours = diff / (60 * 60 * 1000);
  return Math.max(0, totalHours - Math.max(0, breakHours));
}

function setMadridTime(date: Date, hours: number, minutes = 0): Date {
  return buildMadridDateTime({
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: hours,
    minute: minutes,
  });
}

function nextMadridMidnight(date: Date): Date {
  const currentMidnight = setMadridTime(date, 0, 0);
  return new Date(currentMidnight.getTime() + 24 * 60 * 60 * 1000);
}

function computeOverlapHours(
  start: Date,
  end: Date,
  rangeStart: Date,
  rangeEnd: Date,
): number {
  const overlapStart = Math.max(start.getTime(), rangeStart.getTime());
  const overlapEnd = Math.min(end.getTime(), rangeEnd.getTime());
  if (overlapEnd <= overlapStart) return 0;
  return (overlapEnd - overlapStart) / (60 * 60 * 1000);
}

function computeDayNightHours(
  start: Date | null,
  end: Date | null,
): { dayHours: number; nightHours: number } {
  if (!start || !end || end.getTime() <= start.getTime()) {
    return { dayHours: 0, nightHours: 0 };
  }

  let cursor = new Date(start);
  let dayHours = 0;
  let nightHours = 0;

  while (cursor.getTime() < end.getTime()) {
    const nextMidnight = nextMadridMidnight(new Date(cursor));
    const segmentEnd = new Date(
      Math.min(nextMidnight.getTime(), end.getTime()),
    );

    const dayStart = setMadridTime(new Date(cursor), 6, 0);
    const dayEnd = setMadridTime(new Date(cursor), 22, 0);

    dayHours += computeOverlapHours(cursor, segmentEnd, dayStart, dayEnd);
    nightHours += computeOverlapHours(
      cursor,
      segmentEnd,
      setMadridTime(new Date(cursor), 0, 0),
      dayStart,
    );
    nightHours += computeOverlapHours(cursor, segmentEnd, dayEnd, nextMidnight);

    cursor = segmentEnd;
  }

  return {
    dayHours: roundHours(dayHours),
    nightHours: roundHours(nightHours),
  };
}

function getDateKey(value: Date | null): string | null {
  if (!value) return null;
  return value.toISOString().slice(0, 10);
}

export const handler = createHttpHandler(async (request) => {
  if (
    request.method !== "GET" &&
    request.method !== "POST" &&
    request.method !== "PUT" &&
    request.method !== "DELETE"
  ) {
    return errorResponse("METHOD_NOT_ALLOWED", "Método no permitido", 405);
  }

  const prisma = getPrisma();
  const auth = await requireAuth(request, prisma, { requireRoles: ["Admin"] });
  if ("error" in auth) return auth.error;

  if (request.method === "POST" || request.method === "PUT") {
    const payload = (request.body ?? {}) as MutationPayload;
    const trainerId = payload.trainerId?.trim() ?? "";
    const sessionId = payload.sessionId?.trim() ?? "";
    const date = payload.date?.trim() ?? "";
    const checkInTime = payload.checkInTime?.trim() ?? "";
    const checkOutTime = payload.checkOutTime?.trim() ?? "";

    if (!trainerId || !sessionId || !date || !checkInTime) {
      return errorResponse(
        "VALIDATION_ERROR",
        "Debes indicar trainerId, sessionId, date y checkInTime.",
        400,
      );
    }

    const checkIn = combineMadridDateAndTime(date, checkInTime);
    if (!checkIn) {
      return errorResponse(
        "VALIDATION_ERROR",
        "La fecha u hora de entrada no es válida.",
        400,
      );
    }

    const checkOut = checkOutTime
      ? combineMadridDateAndTime(date, checkOutTime)
      : null;
    if (checkOutTime && !checkOut) {
      return errorResponse(
        "VALIDATION_ERROR",
        "La hora de salida no es válida.",
        400,
      );
    }
    if (checkOut && checkOut.getTime() <= checkIn.getTime()) {
      return errorResponse(
        "VALIDATION_ERROR",
        "La hora de salida debe ser posterior a la entrada.",
        400,
      );
    }

    const assignment = await prisma.sesion_trainers.findFirst({
      where: {
        trainer_id: trainerId,
        sesion_id: sessionId,
        trainers: { contrato_fijo: false },
      },
      select: {
        sesiones: { select: { fecha_inicio_utc: true, fecha_fin_utc: true } },
      },
    });

    if (!assignment) {
      return errorResponse(
        "NOT_FOUND",
        "No se encontró una asignación válida para este formador discontinuo.",
        404,
      );
    }

    const adminUser = auth.user as {
      first_name?: string;
      last_name?: string;
      email?: string;
      id: string;
    };
    const fullName =
      `${adminUser.first_name ?? ""} ${adminUser.last_name ?? ""}`.trim();
    const recordedByName = fullName || adminUser.email || adminUser.id;

    const saved = await prisma.trainer_session_time_logs.upsert({
      where: {
        trainer_id_session_id: { trainer_id: trainerId, session_id: sessionId },
      },
      update: {
        scheduled_start_utc: assignment.sesiones?.fecha_inicio_utc ?? null,
        scheduled_end_utc: assignment.sesiones?.fecha_fin_utc ?? null,
        check_in_utc: checkIn,
        check_out_utc: checkOut,
        recorded_by_user_id: auth.user.id,
        recorded_by_name: recordedByName,
        source: "admin_reporting",
        updated_at: new Date(),
      },
      create: {
        trainer_id: trainerId,
        session_id: sessionId,
        scheduled_start_utc: assignment.sesiones?.fecha_inicio_utc ?? null,
        scheduled_end_utc: assignment.sesiones?.fecha_fin_utc ?? null,
        check_in_utc: checkIn,
        check_out_utc: checkOut,
        recorded_by_user_id: auth.user.id,
        recorded_by_name: recordedByName,
        source: "admin_reporting",
      },
    });

    return successResponse({
      timeLog: {
        id: saved.id,
        trainerId: saved.trainer_id,
        sessionId: saved.session_id,
        checkIn: saved.check_in_utc?.toISOString() ?? null,
        checkOut: saved.check_out_utc?.toISOString() ?? null,
      },
    });
  }

  if (request.method === "DELETE") {
    const payload = (request.body ?? {}) as MutationPayload;
    const id = payload.id?.trim() ?? "";
    if (!id) {
      return errorResponse(
        "VALIDATION_ERROR",
        "Debes indicar el id del fichaje a eliminar.",
        400,
      );
    }

    await prisma.trainer_session_time_logs.delete({ where: { id } });
    return successResponse({ ok: true });
  }

  const parsedDates = parseDateFilters(request.query);
  if ("error" in parsedDates) return parsedDates.error;
  const { startDate, endDate } = parsedDates;

  const sessionStartFilter: { not: null; gte?: Date; lte?: Date } = {
    not: null,
  };
  if (startDate) sessionStartFilter.gte = startDate;
  if (endDate) sessionStartFilter.lte = endDate;

  const assignments = await prisma.sesion_trainers.findMany({
    where: {
      trainers: { contrato_fijo: false },
      sesiones: { fecha_inicio_utc: sessionStartFilter },
    },
    select: {
      sesion_id: true,
      trainer_id: true,
      trainers: {
        select: { trainer_id: true, name: true, apellido: true, user_id: true },
      },
      sesiones: {
        select: {
          id: true,
          nombre_cache: true,
          fecha_inicio_utc: true,
          fecha_fin_utc: true,
          tiempo_parada: true,
        },
      },
    },
  });

  if (!assignments.length) {
    return successResponse({ items: [] as ReportRow[] });
  }

  const uniqueSessionIds = Array.from(
    new Set(assignments.map((item) => item.sesion_id)),
  );
  const uniqueTrainerIds = Array.from(
    new Set(assignments.map((item) => item.trainer_id)),
  );

  const timeLogs = await prisma.trainer_session_time_logs.findMany({
    where: {
      trainer_id: { in: uniqueTrainerIds },
      session_id: { in: uniqueSessionIds },
    },
    select: {
      id: true,
      trainer_id: true,
      session_id: true,
      check_in_utc: true,
      check_out_utc: true,
    },
  });

  const logMap = new Map<
    string,
    { id: string; checkIn: Date | null; checkOut: Date | null }
  >();
  for (const log of timeLogs) {
    if (!log.session_id) continue;
    logMap.set(`${log.trainer_id}::${log.session_id}`, {
      id: log.id,
      checkIn: log.check_in_utc,
      checkOut: log.check_out_utc,
    });
  }

  const userIds = Array.from(
    new Set(
      assignments
        .map((item) => item.trainers?.user_id)
        .filter((id): id is string => Boolean(id)),
    ),
  );
  const holidayDays = await prisma.user_vacation_days.findMany({
    where: {
      user_id: { in: userIds },
      type: { in: ["A", "N"] },
      ...(startDate || endDate
        ? {
            date: {
              ...(startDate
                ? { gte: new Date(startDate.toISOString().slice(0, 10)) }
                : {}),
              ...(endDate
                ? { lte: new Date(endDate.toISOString().slice(0, 10)) }
                : {}),
            },
          }
        : {}),
    },
    select: { user_id: true, date: true, type: true },
  });

  const holidayMap = new Map<string, "A" | "N">();
  for (const holiday of holidayDays) {
    const dateKey = holiday.date.toISOString().slice(0, 10);
    holidayMap.set(
      `${holiday.user_id}::${dateKey}`,
      holiday.type === "N" ? "N" : "A",
    );
  }

  const items: ReportRow[] = assignments.map((assignment) => {
    const session = assignment.sesiones;
    const trainer = assignment.trainers;
    const log = logMap.get(`${assignment.trainer_id}::${assignment.sesion_id}`);

    const assignedHours = computeHours(
      session?.fecha_inicio_utc ?? null,
      session?.fecha_fin_utc ?? null,
      decimalToNumber(session?.tiempo_parada),
    );

    const hasTimeLog = Boolean(log?.checkIn && log?.checkOut);
    const loggedHours = hasTimeLog
      ? computeHours(log?.checkIn ?? null, log?.checkOut ?? null, 0)
      : 0;
    const { dayHours, nightHours } = hasTimeLog
      ? computeDayNightHours(log?.checkIn ?? null, log?.checkOut ?? null)
      : { dayHours: 0, nightHours: 0 };

    const logDateKey = getDateKey(log?.checkIn ?? null);
    const holidayType =
      trainer?.user_id && logDateKey
        ? holidayMap.get(`${trainer.user_id}::${logDateKey}`)
        : null;

    return {
      trainerId: assignment.trainer_id,
      trainerName:
        `${trainer?.name ?? ""} ${trainer?.apellido ?? ""}`.trim() ||
        assignment.trainer_id,
      sessionId: assignment.sesion_id,
      sessionName: session?.nombre_cache ?? assignment.sesion_id,
      sessionDate: getDateKey(session?.fecha_inicio_utc ?? null),
      assignedHours: roundHours(assignedHours),
      loggedHours: roundHours(loggedHours),
      dayHours,
      nightHours,
      regionalHolidayHours: holidayType === "A" ? roundHours(loggedHours) : 0,
      nationalHolidayHours: holidayType === "N" ? roundHours(loggedHours) : 0,
      hasTimeLog,
      timeLogId: log?.id ?? null,
      checkIn: log?.checkIn?.toISOString() ?? null,
      checkOut: log?.checkOut?.toISOString() ?? null,
    };
  });

  items.sort((a, b) => {
    const dateA = a.sessionDate ?? "";
    const dateB = b.sessionDate ?? "";
    if (dateA !== dateB) return dateA.localeCompare(dateB);
    const trainerCompare = a.trainerName.localeCompare(b.trainerName, "es");
    if (trainerCompare !== 0) return trainerCompare;
    return a.sessionName.localeCompare(b.sessionName, "es");
  });

  return successResponse({ items });
});
