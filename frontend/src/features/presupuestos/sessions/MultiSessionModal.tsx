import { useCallback, useMemo, useState } from 'react';
import { Alert, Badge, Button, Col, Form, Modal, Row, Spinner, Stack } from 'react-bootstrap';
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

function buildIsoRange(date: string, startTime: string, endTime: string): { startIso: string; endIso: string } | null {
  const startIso = localInputToUtc(`${date}T${startTime}`);
  const endIso = localInputToUtc(`${date}T${endTime}`);
  if (typeof startIso !== 'string' || typeof endIso !== 'string') return null;
  if (new Date(endIso).getTime() < new Date(startIso).getTime()) return null;
  return { startIso, endIso };
}

function formatDateLabel(date: string): string {
  const dt = new Date(`${date}T00:00:00`);
  if (!Number.isFinite(dt.getTime())) return date;
  return dt.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
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
  dealId,
  dealAddress,
  onCreated,
  isInCompany,
}: MultiSessionModalProps) {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [name, setName] = useState('');
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('11:00');
  const [dates, setDates] = useState<string[]>([today]);
  const [dateInput, setDateInput] = useState(today);
  const [trainerIds, setTrainerIds] = useState<string[]>([]);
  const [unitIds, setUnitIds] = useState<string[]>([]);
  const [roomId, setRoomId] = useState<string>('');
  const [status, setStatus] = useState<'idle' | 'checking' | 'ready' | 'creating' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<AvailabilityConflict[] | null>(null);

  const availableRooms = useMemo(() => (isInCompany ? [] : rooms), [isInCompany, rooms]);

  const resetState = useCallback(() => {
    setName('');
    setStartTime('09:00');
    setEndTime('11:00');
    setDates([today]);
    setDateInput(today);
    setTrainerIds([]);
    setUnitIds([]);
    setRoomId('');
    setStatus('idle');
    setError(null);
    setConflicts(null);
  }, [today]);

  const handleAddDate = useCallback(() => {
    const normalized = dateInput.trim();
    if (!normalized || dates.includes(normalized)) return;
    setDates((current) => [...current, normalized].sort());
  }, [dateInput, dates]);

  const handleRemoveDate = useCallback((value: string) => {
    setDates((current) => current.filter((item) => item !== value));
  }, []);

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

    setStatus('checking');
    const newConflicts: AvailabilityConflict[] = [];

    for (const date of dates) {
      const range = buildIsoRange(date, startTime, endTime);
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
    setStatus('creating');
    setError(null);
    try {
      for (const date of dates) {
        const range = buildIsoRange(date, startTime, endTime);
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
  }, [dates, dealAddress, dealId, endTime, isInCompany, name, onClose, onCreated, productId, resetState, roomId, startTime, trainerIds, unitIds]);

  const handleRevert = useCallback(() => {
    resetState();
  }, [resetState]);

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
            <div className="d-flex align-items-center gap-2 flex-wrap">
              <Form.Control type="date" value={dateInput} onChange={(event) => setDateInput(event.target.value)} style={{ maxWidth: 200 }} />
              <Button variant="outline-primary" onClick={handleAddDate} disabled={!dateInput}>
                Añadir día
              </Button>
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
                <Form.Select
                  multiple
                  value={trainerIds}
                  onChange={(event) =>
                    setTrainerIds(Array.from(event.target.selectedOptions, (option) => option.value))
                  }
                >
                  {trainers.map((trainer) => (
                    <option key={trainer.trainer_id} value={trainer.trainer_id}>
                      {trainer.name}
                      {trainer.apellido ? ` ${trainer.apellido}` : ''}
                    </option>
                  ))}
                </Form.Select>
              </Form.Group>
            </Col>
            <Col md={6}>
              <Form.Group>
                <Form.Label>Unidades móviles</Form.Label>
                <Form.Select
                  multiple
                  value={unitIds}
                  onChange={(event) => setUnitIds(Array.from(event.target.selectedOptions, (option) => option.value))}
                >
                  {units.map((unit) => (
                    <option key={unit.unidad_movil_id} value={unit.unidad_movil_id}>
                      {unit.name}
                    </option>
                  ))}
                </Form.Select>
              </Form.Group>
            </Col>
          </Row>

          {!isInCompany && (
            <Form.Group>
              <Form.Label>Salas</Form.Label>
              <Form.Select value={roomId} onChange={(event) => setRoomId(event.target.value)}>
                <option value="">Selecciona sala</option>
                {availableRooms.map((room) => (
                  <option key={room.sala_id} value={room.sala_id}>
                    {room.name}
                  </option>
                ))}
              </Form.Select>
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
          <Button variant="secondary" onClick={onClose} disabled={status === 'creating' || status === 'checking'}>
            Cerrar
          </Button>
          <Button variant="outline-secondary" onClick={handleRevert} disabled={status === 'creating'}>
            Revertir
          </Button>
        </div>
        {status === 'ready' ? (
          <Button variant="success" onClick={handleConfirm} disabled={status === 'creating'}>
            {status === 'creating' ? <Spinner animation="border" size="sm" /> : 'Confirmar'}
          </Button>
        ) : (
          <Button variant="primary" onClick={handleStart} disabled={status === 'checking' || status === 'creating'}>
            {status === 'checking' ? <Spinner animation="border" size="sm" /> : 'Crear'}
          </Button>
        )}
      </Modal.Footer>
    </Modal>
  );
}

