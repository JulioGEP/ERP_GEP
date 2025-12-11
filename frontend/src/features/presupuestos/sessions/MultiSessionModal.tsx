import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Col,
  Collapse,
  Form,
  ListGroup,
  Modal,
  Overlay,
  Popover,
  Row,
  Spinner,
  Stack,
} from 'react-bootstrap';
import {
  createSession,
  fetchSessionAvailability,
  type MobileUnitOption,
  type RoomOption,
  type TrainerOption,
} from '../api';

const MADRID_TIMEZONE = 'Europe/Madrid';

function getTimeZoneOffset(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const values: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== 'literal') values[part.type] = part.value;
  }
  const utcTime = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second),
  );
  return utcTime - date.getTime();
}

function localInputToUtc(value: string | null): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = value.trim();
  if (!trimmed.length) return null;
  const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) return undefined;
  const [, yearStr, monthStr, dayStr, hourStr, minuteStr] = match;
  const year = Number(yearStr);
  const monthIndex = Number(monthStr) - 1;
  const day = Number(dayStr);
  const hour = Number(hourStr);
  const minute = Number(minuteStr);
  const baseDate = new Date(Date.UTC(year, monthIndex, day, hour, minute, 0));
  if (!Number.isFinite(baseDate.getTime())) return undefined;
  const offset = getTimeZoneOffset(baseDate, MADRID_TIMEZONE);
  return new Date(baseDate.getTime() - offset).toISOString();
}

function getNextDay(date: string): string | null {
  const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const [, yearStr, monthStr, dayStr] = match;
  const dateObj = new Date(Date.UTC(Number(yearStr), Number(monthStr) - 1, Number(dayStr) + 1));
  if (!Number.isFinite(dateObj.getTime())) return null;
  const nextYear = dateObj.getUTCFullYear();
  const nextMonth = String(dateObj.getUTCMonth() + 1).padStart(2, '0');
  const nextDay = String(dateObj.getUTCDate()).padStart(2, '0');
  return `${nextYear}-${nextMonth}-${nextDay}`;
}

function buildIsoRange(
  date: string,
  startTime: string,
  endTime: string,
  allowOvernight = false,
): { startIso: string; endIso: string } | null {
  const useNextDay = allowOvernight && endTime < startTime;
  const endDate = useNextDay ? getNextDay(date) : date;
  if (!endDate) return null;

  const startIso = localInputToUtc(`${date}T${startTime}`);
  const endIso = localInputToUtc(`${endDate}T${endTime}`);
  if (typeof startIso !== 'string' || typeof endIso !== 'string') return null;
  if (!useNextDay && new Date(endIso).getTime() < new Date(startIso).getTime()) return null;
  return { startIso, endIso };
}

function formatDateLabel(date: string): string {
  const dt = new Date(`${date}T00:00:00`);
  if (!Number.isFinite(dt.getTime())) return date;
  return dt.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function getUnitId(unit: MobileUnitOption & { unidad_movil_id?: string }): string {
  return unit.unidad_id ?? (unit as any).unidad_movil_id ?? '';
}

export type MultiSessionPayload = {
  productId: string;
  dealId: string;
  dealAddress: string | null;
  isInCompany: boolean;
};

type MultiSessionModalProps = MultiSessionPayload & {
  show: boolean;
  onClose: () => void;
  productName?: string | null;
  trainers: TrainerOption[];
  units: MobileUnitOption[];
  rooms: RoomOption[];
  onCreated?: () => void;
};

type AvailabilityConflict = {
  date: string;
  trainers: string[];
  units: string[];
  room?: boolean;
};

export function MultiSessionModal({
  show,
  onClose,
  trainers,
  units,
  rooms,
  productId,
  productName,
  dealId,
  dealAddress,
  onCreated,
  isInCompany,
}: MultiSessionModalProps) {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [name, setName] = useState(productName?.trim() ?? '');
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('11:00');
  const [dates, setDates] = useState<string[]>([today]);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(() => new Date(`${today}T00:00:00`));
  const [trainerFilter, setTrainerFilter] = useState('');
  const [unitFilter, setUnitFilter] = useState('');
  const [roomFilter, setRoomFilter] = useState('');
  const [trainerListOpen, setTrainerListOpen] = useState(false);
  const [unitListOpen, setUnitListOpen] = useState(false);
  const [roomListOpen, setRoomListOpen] = useState(false);
  const [trainerIds, setTrainerIds] = useState<string[]>([]);
  const [unitIds, setUnitIds] = useState<string[]>([]);
  const [roomId, setRoomId] = useState<string>('');
  const [isNightSchedule, setIsNightSchedule] = useState(false);
  const [status, setStatus] = useState<'idle' | 'checking' | 'ready' | 'creating' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<AvailabilityConflict[] | null>(null);
  const calendarTargetRef = useRef<HTMLDivElement | null>(null);
  const trainerFieldRef = useRef<HTMLDivElement | null>(null);
  const unitFieldRef = useRef<HTMLDivElement | null>(null);
  const roomFieldRef = useRef<HTMLDivElement | null>(null);
  const trainerPointerInteractingRef = useRef(false);
  const unitPointerInteractingRef = useRef(false);
  const roomPointerInteractingRef = useRef(false);

  const availableRooms = useMemo(() => (isInCompany ? [] : rooms), [isInCompany, rooms]);

  const sortedTrainers = useMemo(() => [...trainers].sort((a, b) => a.name.localeCompare(b.name, 'es')), [trainers]);
  const sortedUnits = useMemo(() => [...units].sort((a, b) => a.name.localeCompare(b.name, 'es')), [units]);
  const sortedRooms = useMemo(() => [...availableRooms].sort((a, b) => a.name.localeCompare(b.name, 'es')), [availableRooms]);

  const resetState = useCallback(() => {
    setName(productName?.trim() ?? '');
    setStartTime('09:00');
    setEndTime('11:00');
    setDates([today]);
    setCalendarMonth(new Date(`${today}T00:00:00`));
    setTrainerFilter('');
    setUnitFilter('');
    setRoomFilter('');
    setTrainerListOpen(false);
    setUnitListOpen(false);
    setRoomListOpen(false);
    setCalendarOpen(false);
    setTrainerIds([]);
    setUnitIds([]);
    setRoomId('');
    setIsNightSchedule(false);
    setStatus('idle');
    setError(null);
    setConflicts(null);
  }, [productName, today]);

  useEffect(() => {
    if (!show) return;
    setName((current) => {
      if (current.trim()) return current;
      return productName?.trim() ?? '';
    });
  }, [productName, show]);

  useEffect(() => {
    const selectedDate = dates[0];
    if (!selectedDate) return;
    const baseDate = new Date(`${selectedDate}T00:00:00`);
    if (!Number.isFinite(baseDate.getTime())) return;
    const monthStart = new Date(Date.UTC(baseDate.getUTCFullYear(), baseDate.getUTCMonth(), 1));
    setCalendarMonth(monthStart);
  }, [dates]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (trainerFieldRef.current && !trainerFieldRef.current.contains(target)) {
        setTrainerListOpen(false);
      }
      if (unitFieldRef.current && !unitFieldRef.current.contains(target)) {
        setUnitListOpen(false);
      }
      if (roomFieldRef.current && !roomFieldRef.current.contains(target)) {
        setRoomListOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  useEffect(() => {
    if (!show) {
      setCalendarOpen(false);
    }
  }, [show]);

  useEffect(() => {
    if (startTime <= endTime && isNightSchedule) {
      setIsNightSchedule(false);
    }
  }, [endTime, isNightSchedule, startTime]);

  const handleToggleDate = useCallback((dateIso: string) => {
    setDates((current) => {
      const set = new Set(current);
      if (set.has(dateIso)) {
        set.delete(dateIso);
      } else {
        set.add(dateIso);
      }
      return Array.from(set).sort();
    });
  }, []);

  const handleRemoveDate = useCallback((value: string) => {
    setDates((current) => current.filter((item) => item !== value));
  }, []);

  const calendarCells = useMemo(() => {
    const monthStart = new Date(Date.UTC(calendarMonth.getUTCFullYear(), calendarMonth.getUTCMonth(), 1));
    const daysInMonth = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 0)).getUTCDate();
    const weekdayOffset = (monthStart.getUTCDay() + 6) % 7;
    const cells: Array<{ date: string | null; dayLabel: string | null }> = [];

    for (let i = 0; i < weekdayOffset; i += 1) {
      cells.push({ date: null, dayLabel: null });
    }

    for (let day = 1; day <= daysInMonth; day += 1) {
      const iso = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth(), day))
        .toISOString()
        .slice(0, 10);
      cells.push({ date: iso, dayLabel: String(day) });
    }

    while (cells.length % 7 !== 0) {
      cells.push({ date: null, dayLabel: null });
    }

    return cells;
  }, [calendarMonth]);

  const trainerSummary = useMemo(() => {
    if (!trainerIds.length) return '';
    const selected = new Set(trainerIds);
    return sortedTrainers
      .filter((trainer) => selected.has(trainer.trainer_id))
      .map((trainer) => `${trainer.name}${trainer.apellido ? ` ${trainer.apellido}` : ''}`)
      .join(', ');
  }, [sortedTrainers, trainerIds]);

  const unitSummary = useMemo(() => {
    if (!unitIds.length) return '';
    const selected = new Set(unitIds);
    return sortedUnits
      .filter((unit) => selected.has(getUnitId(unit)))
      .map((unit) => (unit.matricula ? `${unit.name} (${unit.matricula})` : unit.name))
      .join(', ');
  }, [sortedUnits, unitIds]);

  const roomSummary = useMemo(() => {
    if (!roomId) return '';
    const selected = sortedRooms.find((room) => room.sala_id === roomId);
    if (!selected) return '';
    return selected.sede ? `${selected.name} (${selected.sede})` : selected.name;
  }, [roomId, sortedRooms]);

  const filteredTrainers = useMemo(() => {
    const search = trainerFilter.trim().toLowerCase();
    if (!search) return sortedTrainers;
    return sortedTrainers.filter((trainer) => {
      const label = `${trainer.name} ${trainer.apellido ?? ''}`.toLowerCase();
      return label.includes(search);
    });
  }, [sortedTrainers, trainerFilter]);

  const filteredUnits = useMemo(() => {
    const search = unitFilter.trim().toLowerCase();
    if (!search) return sortedUnits;
    return sortedUnits.filter((unit) => {
      const label = `${unit.name} ${unit.matricula ?? ''}`.toLowerCase();
      return label.includes(search);
    });
  }, [sortedUnits, unitFilter]);

  const filteredRooms = useMemo(() => {
    const search = roomFilter.trim().toLowerCase();
    if (!search) return sortedRooms;
    return sortedRooms.filter((room) => {
      const label = `${room.name} ${room.sede ?? ''}`.toLowerCase();
      return label.includes(search);
    });
  }, [roomFilter, sortedRooms]);

  const selectedDatesLabel = useMemo(() => {
    if (!dates.length) return '';
    if (dates.length <= 3) {
      return dates.map((date) => formatDateLabel(date)).join(', ');
    }
    return `${dates.length} días seleccionados`;
  }, [dates]);

  const handleStart = useCallback(async () => {
    setError(null);
    setConflicts(null);
    if (!name.trim()) {
      setError('El nombre de la sesión es obligatorio.');
      return;
    }
    if (!startTime || !endTime) {
      setError('Selecciona hora de inicio y fin.');
      return;
    }
    if (!dates.length) {
      setError('Añade al menos un día.');
      return;
    }

    const endBeforeStart = endTime < startTime;
    let allowOvernight = isNightSchedule;
    if (endBeforeStart && !allowOvernight) {
      const confirmNight = window.confirm('¿Es horario Nocturno?');
      if (!confirmNight) {
        setError('Modifica el horario para que la hora fin sea posterior a la hora inicio.');
        setStatus('error');
        return;
      }
      allowOvernight = true;
      setIsNightSchedule(true);
    }

    setStatus('checking');
    const newConflicts: AvailabilityConflict[] = [];

    for (const date of dates) {
      const range = buildIsoRange(date, startTime, endTime, allowOvernight);
      if (!range) {
        setError('Rango de fechas u horas no válido.');
        setStatus('error');
        return;
      }
      try {
        const availability = await fetchSessionAvailability({ start: range.startIso, end: range.endIso });
        const trainerConflicts = trainerIds.filter((id) => availability.trainers?.includes(id));
        const unitConflicts = unitIds.filter((id) => availability.units?.includes(id));
        const roomConflict = roomId ? availability.rooms?.includes(roomId) : false;
        if (trainerConflicts.length || unitConflicts.length || roomConflict) {
          newConflicts.push({ date, trainers: trainerConflicts, units: unitConflicts, room: roomConflict });
        }
      } catch (checkError) {
        setError(checkError instanceof Error ? checkError.message : 'No se pudo comprobar la disponibilidad.');
        setStatus('error');
        return;
      }
    }

    if (newConflicts.length) {
      setConflicts(newConflicts);
      setStatus('error');
      return;
    }

    setStatus('ready');
  }, [dates, endTime, name, roomId, startTime, trainerIds, unitIds]);

  const handleConfirm = useCallback(async () => {
    setError(null);
    if (endTime < startTime && !isNightSchedule) {
      const confirmNight = window.confirm('¿Es horario Nocturno?');
      if (!confirmNight) {
        setError('Confirma el horario nocturno antes de crear las sesiones.');
        setStatus('error');
        return;
      }
      setIsNightSchedule(true);
    }

    setStatus('creating');

    const allowOvernight = isNightSchedule || endTime < startTime;
    try {
      for (const date of dates) {
        const range = buildIsoRange(date, startTime, endTime, allowOvernight);
        if (!range) throw new Error('Rango de fechas u horas no válido.');
        await createSession({
          deal_id: dealId,
          deal_product_id: productId,
          nombre_cache: name,
          fecha_inicio_utc: range.startIso,
          fecha_fin_utc: range.endIso,
          sala_id: isInCompany ? undefined : roomId || null,
          direccion: dealAddress ?? '',
          trainer_ids: trainerIds,
          unidad_movil_ids: unitIds,
          force_estado_borrador: true,
        });
      }
      onCreated?.();
      onClose();
      resetState();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'No se pudieron crear las sesiones.');
      setStatus('error');
    }
  }, [
    dates,
    dealAddress,
    dealId,
    endTime,
    isInCompany,
    isNightSchedule,
    name,
    onClose,
    onCreated,
    productId,
    resetState,
    roomId,
    startTime,
    trainerIds,
    unitIds,
  ]);

  const handleRevert = useCallback(() => {
    resetState();
  }, [resetState]);

  const isCreating = status === 'creating';
  const isChecking = status === 'checking';
  const isReady = status === 'ready';

  return (
    <Modal show={show} onHide={onClose} size="lg" backdrop="static">
      <Modal.Header closeButton>
        <Modal.Title>Múltiples sesiones</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <Stack gap={3}>
          <Form.Group>
            <Form.Label>Nombre</Form.Label>
            <Form.Control
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Nombre de la sesión"
            />
          </Form.Group>

          <Row>
            <Col md={6}>
              <Form.Group>
                <Form.Label>Hora inicio</Form.Label>
                <Form.Control type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} />
              </Form.Group>
            </Col>
            <Col md={6}>
              <Form.Group>
                <Form.Label>Hora fin</Form.Label>
                <Form.Control type="time" value={endTime} onChange={(event) => setEndTime(event.target.value)} />
              </Form.Group>
            </Col>
          </Row>

          <Form.Group>
            <Form.Label>Días</Form.Label>
            <div ref={calendarTargetRef} className="position-relative" style={{ maxWidth: 320 }}>
              <Form.Control
                readOnly
                value={selectedDatesLabel}
                placeholder="Selecciona días"
                onClick={() => setCalendarOpen(true)}
                aria-expanded={calendarOpen}
              />
              <Overlay target={calendarTargetRef.current} show={calendarOpen} placement="bottom-start">
                <Popover id="multi-session-calendar" className="p-3" style={{ maxWidth: 400 }}>
                  <div className="d-flex justify-content-between align-items-center mb-2">
                    <Button
                      variant="light"
                      size="sm"
                      onClick={() =>
                        setCalendarMonth((current) => {
                          const next = new Date(current);
                          next.setUTCMonth(current.getUTCMonth() - 1, 1);
                          return next;
                        })
                      }
                    >
                      ←
                    </Button>
                    <div className="fw-semibold text-capitalize">
                      {calendarMonth.toLocaleDateString('es-ES', { month: 'long', year: 'numeric', timeZone: 'UTC' })}
                    </div>
                    <Button variant="light" size="sm" aria-label="Cerrar calendario" onClick={() => setCalendarOpen(false)}>
                      ×
                    </Button>
                    <Button
                      variant="light"
                      size="sm"
                      onClick={() =>
                        setCalendarMonth((current) => {
                          const next = new Date(current);
                          next.setUTCMonth(current.getUTCMonth() + 1, 1);
                          return next;
                        })
                      }
                    >
                      →
                    </Button>
                  </div>
                  <div className="d-grid text-center small text-muted" style={{ gridTemplateColumns: 'repeat(7, 1fr)' }}>
                    {['L', 'M', 'X', 'J', 'V', 'S', 'D'].map((weekday) => (
                      <div key={weekday} className="py-1">
                        {weekday}
                      </div>
                    ))}
                  </div>
                  <div className="d-grid gap-1" style={{ gridTemplateColumns: 'repeat(7, minmax(38px, 1fr))' }}>
                    {calendarCells.map((cell, index) => {
                      if (!cell.date) {
                        return <div key={`empty-${index}`} />;
                      }
                      const selected = dates.includes(cell.date);
                      return (
                        <Button
                          key={cell.date}
                          variant={selected ? 'warning' : 'light'}
                          size="sm"
                          className="w-100"
                          onClick={() => handleToggleDate(cell.date as string)}
                        >
                          {cell.dayLabel}
                        </Button>
                      );
                    })}
                  </div>
                </Popover>
              </Overlay>
            </div>
            <div className="d-flex gap-2 flex-wrap mt-2">
              {dates.map((date) => (
                <Badge key={date} bg="secondary">
                  {formatDateLabel(date)}{' '}
                  <Button
                    variant="link"
                    size="sm"
                    className="text-white text-decoration-none ms-1 p-0 align-baseline"
                    onClick={() => handleRemoveDate(date)}
                    aria-label={`Eliminar ${date}`}
                  >
                    ×
                  </Button>
                </Badge>
              ))}
            </div>
          </Form.Group>

          <Row>
            <Col md={6}>
              <Form.Group>
                <Form.Label>Formadores</Form.Label>
                <div ref={trainerFieldRef} className="session-multiselect">
                  <Form.Control
                    type="text"
                    readOnly
                    placeholder="Selecciona formadores"
                    value={trainerSummary}
                    aria-expanded={trainerListOpen}
                    aria-controls="multi-session-trainers-options"
                    className="session-multiselect-summary"
                    onMouseDown={() => {
                      trainerPointerInteractingRef.current = true;
                    }}
                    onClick={() => {
                      setTrainerListOpen((open) => !open);
                      trainerPointerInteractingRef.current = false;
                    }}
                    onFocus={() => {
                      if (!trainerPointerInteractingRef.current) {
                        setTrainerListOpen(true);
                      }
                    }}
                    onBlur={() => {
                      trainerPointerInteractingRef.current = false;
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        setTrainerListOpen((open) => !open);
                      }
                    }}
                  />
                  <Collapse in={trainerListOpen}>
                    <div id="multi-session-trainers-options" className="session-multiselect-panel mt-2">
                      <Form.Control
                        type="search"
                        placeholder="Buscar"
                        value={trainerFilter}
                        onChange={(event) => setTrainerFilter(event.target.value)}
                        className="mb-2"
                      />
                      <div className="border rounded overflow-auto" style={{ maxHeight: 200 }}>
                        <ListGroup variant="flush">
                          {filteredTrainers.map((trainer) => {
                            const label = `${trainer.name}${trainer.apellido ? ` ${trainer.apellido}` : ''}`;
                            const checked = trainerIds.includes(trainer.trainer_id);
                            return (
                              <ListGroup.Item key={trainer.trainer_id} className="py-1">
                                <Form.Check
                                  type="checkbox"
                                  id={`multi-session-trainer-${trainer.trainer_id}`}
                                  label={label}
                                  checked={checked}
                                  onChange={(event) =>
                                    setTrainerIds((current) => {
                                      const set = new Set(current);
                                      if (event.target.checked) {
                                        set.add(trainer.trainer_id);
                                      } else {
                                        set.delete(trainer.trainer_id);
                                      }
                                      return Array.from(set);
                                    })
                                  }
                                />
                              </ListGroup.Item>
                            );
                          })}
                          {!filteredTrainers.length && (
                            <ListGroup.Item className="text-muted py-2">Sin resultados</ListGroup.Item>
                          )}
                        </ListGroup>
                      </div>
                    </div>
                  </Collapse>
                </div>
              </Form.Group>
            </Col>
            <Col md={6}>
              <Form.Group>
                <Form.Label>Unidades móviles</Form.Label>
                <div ref={unitFieldRef} className="session-multiselect">
                  <Form.Control
                    type="text"
                    readOnly
                    placeholder="Selecciona unidades móviles"
                    value={unitSummary}
                    aria-expanded={unitListOpen}
                    aria-controls="multi-session-units-options"
                    className="session-multiselect-summary"
                    onMouseDown={() => {
                      unitPointerInteractingRef.current = true;
                    }}
                    onClick={() => {
                      setUnitListOpen((open) => !open);
                      unitPointerInteractingRef.current = false;
                    }}
                    onFocus={() => {
                      if (!unitPointerInteractingRef.current) {
                        setUnitListOpen(true);
                      }
                    }}
                    onBlur={() => {
                      unitPointerInteractingRef.current = false;
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        setUnitListOpen((open) => !open);
                      }
                    }}
                  />
                  <Collapse in={unitListOpen}>
                    <div id="multi-session-units-options" className="session-multiselect-panel mt-2">
                      <Form.Control
                        type="search"
                        placeholder="Buscar"
                        value={unitFilter}
                        onChange={(event) => setUnitFilter(event.target.value)}
                        className="mb-2"
                      />
                      <div className="border rounded overflow-auto" style={{ maxHeight: 200 }}>
                        <ListGroup variant="flush">
                          {filteredUnits.map((unit) => {
                            const label = unit.matricula ? `${unit.name} (${unit.matricula})` : unit.name;
                            const unitId = getUnitId(unit);
                            const checked = unitIds.includes(unitId);
                            return (
                              <ListGroup.Item key={unitId || unit.name} className="py-1">
                                <Form.Check
                                  type="checkbox"
                                  id={`multi-session-unit-${unitId || unit.name}`}
                                  label={label}
                                  checked={checked}
                                  onChange={(event) =>
                                    setUnitIds((current) => {
                                      const set = new Set(current);
                                      if (event.target.checked) {
                                        set.add(unitId);
                                      } else {
                                        set.delete(unitId);
                                      }
                                      return Array.from(set);
                                    })
                                  }
                                />
                              </ListGroup.Item>
                            );
                          })}
                          {!filteredUnits.length && (
                            <ListGroup.Item className="text-muted py-2">Sin resultados</ListGroup.Item>
                          )}
                        </ListGroup>
                      </div>
                    </div>
                  </Collapse>
                </div>
              </Form.Group>
            </Col>
          </Row>

          {!isInCompany && (
            <Form.Group>
              <Form.Label>Salas</Form.Label>
              <div ref={roomFieldRef} className="session-multiselect">
                <Form.Control
                  type="text"
                  readOnly
                  placeholder="Selecciona sala"
                  value={roomSummary}
                  aria-expanded={roomListOpen}
                  aria-controls="multi-session-rooms-options"
                  className="session-multiselect-summary"
                  onMouseDown={() => {
                    roomPointerInteractingRef.current = true;
                  }}
                  onClick={() => {
                    setRoomListOpen((open) => !open);
                    roomPointerInteractingRef.current = false;
                  }}
                  onFocus={() => {
                    if (!roomPointerInteractingRef.current) {
                      setRoomListOpen(true);
                    }
                  }}
                  onBlur={() => {
                    roomPointerInteractingRef.current = false;
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      setRoomListOpen((open) => !open);
                    }
                  }}
                />
                <Collapse in={roomListOpen}>
                  <div id="multi-session-rooms-options" className="session-multiselect-panel mt-2">
                    <Form.Control
                      type="search"
                      placeholder="Buscar"
                      value={roomFilter}
                      onChange={(event) => setRoomFilter(event.target.value)}
                      className="mb-2"
                    />
                    <div className="border rounded overflow-auto" style={{ maxHeight: 200 }}>
                      <ListGroup variant="flush">
                        <ListGroup.Item className="py-1">
                          <Form.Check
                            type="radio"
                            id="multi-session-room-none"
                            name="multi-session-room"
                            label="Sin sala asignada"
                            checked={!roomId}
                            onChange={() => setRoomId('')}
                          />
                        </ListGroup.Item>
                        {filteredRooms.map((room) => {
                          const label = room.sede ? `${room.name} (${room.sede})` : room.name;
                          return (
                            <ListGroup.Item key={room.sala_id} className="py-1">
                              <Form.Check
                                type="radio"
                                id={`multi-session-room-${room.sala_id}`}
                                name="multi-session-room"
                                label={label}
                                checked={roomId === room.sala_id}
                                onChange={() => setRoomId(room.sala_id)}
                              />
                            </ListGroup.Item>
                          );
                        })}
                        {!filteredRooms.length && (
                          <ListGroup.Item className="text-muted py-2">Sin resultados</ListGroup.Item>
                        )}
                      </ListGroup>
                    </div>
                  </div>
                </Collapse>
              </div>
            </Form.Group>
          )}

          {error ? <Alert variant="danger">{error}</Alert> : null}
          {conflicts?.length ? (
            <Alert variant="warning">
              <div className="fw-semibold mb-2">Disponibilidad encontrada</div>
              <ul className="mb-0">
                {conflicts.map((conflict) => (
                  <li key={conflict.date}>
                    {formatDateLabel(conflict.date)}: {conflict.trainers.length ? `Formador/es ocupados (${conflict.trainers.length})` : ''}
                    {conflict.units.length ? `${conflict.trainers.length ? ' · ' : ''}Unidades móviles ocupadas (${conflict.units.length})` : ''}
                    {conflict.room ? `${conflict.trainers.length || conflict.units.length ? ' · ' : ''}Sala ocupada` : ''}
                  </li>
                ))}
              </ul>
            </Alert>
          ) : null}
          {status === 'ready' ? (
            <Alert variant="success">
              Todas las combinaciones tienen disponibilidad. Puedes confirmar o revertir la operación.
            </Alert>
          ) : null}
        </Stack>
      </Modal.Body>
      <Modal.Footer className="d-flex justify-content-between">
        <div className="d-flex align-items-center gap-2">
          <Button variant="secondary" onClick={onClose} disabled={isCreating || isChecking}>
            Cerrar
          </Button>
          <Button variant="outline-secondary" onClick={handleRevert} disabled={isCreating}>
            Revertir
          </Button>
        </div>
        {isReady ? (
          <Button variant="success" onClick={handleConfirm} disabled={isCreating}>
            {isCreating ? <Spinner animation="border" size="sm" /> : 'Confirmar'}
          </Button>
        ) : (
          <Button variant="primary" onClick={handleStart} disabled={isChecking || isCreating}>
            {isChecking ? <Spinner animation="border" size="sm" /> : 'Crear'}
          </Button>
        )}
      </Modal.Footer>
    </Modal>
  );
}

