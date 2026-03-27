import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../context/AuthContext';

type ReportPrefillResponse = {
  deal?: {
    cliente?: string;
    contacto?: string;
    sessions?: Array<{ direccion?: string }>;
    sesiones?: Array<{ direccion?: string }>;
  };
  cliente?: string;
  contacto?: string;
  sessions?: Array<{ direccion?: string }>;
  sesiones?: Array<{ direccion?: string }>;
  error?: string;
};

type SaveResponse = {
  ok?: boolean;
  message?: string;
  error_code?: string;
};

type FormState = {
  presupuesto: string;
  cliente: string;
  personaContacto: string;
  direccionPreventivo: string;
  bombero: string;
  fechaEjercicio: string;
  turno: string;
  partesTrabajo: number;
  asistenciasSanitarias: number;
  observaciones: string;
  responsable: string;
};

const INITIAL_STATE: FormState = {
  presupuesto: '',
  cliente: '',
  personaContacto: '',
  direccionPreventivo: '',
  bombero: '',
  fechaEjercicio: '',
  turno: '',
  partesTrabajo: 0,
  asistenciasSanitarias: 0,
  observaciones: '',
  responsable: '',
};

function resolveFirstSessionAddress(payload: ReportPrefillResponse): string {
  const sessions =
    payload.deal?.sessions ?? payload.deal?.sesiones ?? payload.sessions ?? payload.sesiones ?? [];
  if (!Array.isArray(sessions) || sessions.length === 0) return '';
  const first = sessions.find((session) => typeof session?.direccion === 'string' && session.direccion.trim());
  return first?.direccion?.trim() ?? '';
}

export default function ActuacionesPreventivosReportPage() {
  const { user } = useAuth();
  const [form, setForm] = useState<FormState>(INITIAL_STATE);
  const [loadingPrefill, setLoadingPrefill] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const loggedUserName = useMemo(() => {
    const parts = [user?.firstName?.trim(), user?.lastName?.trim()].filter(Boolean);
    return parts.join(' ').trim();
  }, [user?.firstName, user?.lastName]);

  useEffect(() => {
    if (!loggedUserName) return;
    setForm((current) => {
      if (current.bombero.trim()) return current;
      return { ...current, bombero: loggedUserName };
    });
  }, [loggedUserName]);

  const onBuscarPresupuesto = async () => {
    if (!form.presupuesto.trim()) {
      setMessage({ type: 'error', text: 'Debes indicar un número de presupuesto.' });
      return;
    }

    setLoadingPrefill(true);
    setMessage(null);
    try {
      const response = await fetch('/.netlify/functions/reportPrefill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dealId: form.presupuesto.trim() }),
      });
      const payload = (await response.json()) as ReportPrefillResponse;
      if (!response.ok) {
        throw new Error(payload?.error ?? 'No se pudo recuperar la información del presupuesto.');
      }

      const source = payload.deal ?? payload;
      setForm((current) => ({
        ...current,
        cliente:
          typeof source?.cliente === 'string' && source.cliente.trim() ? source.cliente.trim() : current.cliente,
        personaContacto:
          typeof source?.contacto === 'string' && source.contacto.trim()
            ? source.contacto.trim()
            : current.personaContacto,
        direccionPreventivo: resolveFirstSessionAddress(payload) || current.direccionPreventivo,
      }));
    } catch (error) {
      const text = error instanceof Error ? error.message : 'Error inesperado al buscar presupuesto.';
      setMessage({ type: 'error', text });
    } finally {
      setLoadingPrefill(false);
    }
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setMessage(null);

    try {
      const response = await fetch('/.netlify/functions/actuaciones-preventivos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });

      const payload = (await response.json()) as SaveResponse;
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.message ?? 'No se pudo guardar el informe.');
      }

      setMessage({ type: 'success', text: 'Informe guardado correctamente.' });
      setForm((current) => ({
        ...current,
        turno: '',
        partesTrabajo: 0,
        asistenciasSanitarias: 0,
        observaciones: '',
        responsable: '',
      }));
    } catch (error) {
      const text = error instanceof Error ? error.message : 'No se pudo guardar el informe.';
      setMessage({ type: 'error', text });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="container py-3">
      <h1 className="h3 mb-3">Informe de Actuaciones Preventivos</h1>
      <p className="text-muted mb-4">
        Registra actuaciones de preventivo por presupuesto y guarda los datos en base de datos.
      </p>

      {message && (
        <div className={`alert ${message.type === 'success' ? 'alert-success' : 'alert-danger'}`} role="alert">
          {message.text}
        </div>
      )}

      <form className="d-grid gap-3" onSubmit={onSubmit}>
        <div className="row g-3 align-items-stretch">
          <div className="col-md-6 d-flex">
            <div className="card w-100 h-100">
              <div className="card-body">
                <h2 className="h5">Datos del cliente</h2>
                <div className="row g-3">
                  <div className="col-12">
                    <label className="form-label">Presupuesto</label>
                    <div className="input-group">
                      <input
                        className="form-control"
                        value={form.presupuesto}
                        required
                        onChange={(e) => setForm((current) => ({ ...current, presupuesto: e.target.value }))}
                      />
                      <button
                        className="btn btn-outline-primary"
                        type="button"
                        onClick={onBuscarPresupuesto}
                        disabled={loadingPrefill}
                      >
                        {loadingPrefill ? 'Buscando…' : 'Buscar'}
                      </button>
                    </div>
                  </div>
                  <div className="col-12">
                    <label className="form-label">Cliente</label>
                    <input
                      className="form-control"
                      value={form.cliente}
                      required
                      onChange={(e) => setForm((current) => ({ ...current, cliente: e.target.value }))}
                    />
                  </div>
                  <div className="col-12">
                    <label className="form-label">Persona de contacto</label>
                    <input
                      className="form-control"
                      value={form.personaContacto}
                      required
                      onChange={(e) => setForm((current) => ({ ...current, personaContacto: e.target.value }))}
                    />
                  </div>
                  <div className="col-12">
                    <label className="form-label">Dirección del Preventivo</label>
                    <input
                      className="form-control"
                      value={form.direccionPreventivo}
                      required
                      onChange={(e) => setForm((current) => ({ ...current, direccionPreventivo: e.target.value }))}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="col-md-6 d-flex">
            <div className="card w-100 h-100">
              <div className="card-body">
                <h2 className="h5">Registro</h2>
                <div className="row g-3">
                  <div className="col-12">
                    <label className="form-label">Bombero/a</label>
                    <input
                      className="form-control"
                      value={form.bombero}
                      required
                      readOnly
                    />
                  </div>
                  <div className="col-12">
                    <label className="form-label">Fecha ejercicio</label>
                    <input
                      type="datetime-local"
                      className="form-control"
                      value={form.fechaEjercicio}
                      required
                      onChange={(e) => setForm((current) => ({ ...current, fechaEjercicio: e.target.value }))}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-body">
            <h2 className="h5">Actuaciones</h2>
            <div className="row g-3">
              <div className="col-md-3">
                <label className="form-label">Turno</label>
                <select
                  className="form-select"
                  value={form.turno}
                  required
                  onChange={(e) => setForm((current) => ({ ...current, turno: e.target.value }))}
                >
                  <option value="" disabled>
                    Selecciona turno
                  </option>
                  <option value="Mañana">Mañana</option>
                  <option value="Tarde">Tarde</option>
                  <option value="Noche">Noche</option>
                </select>
              </div>
              <div className="col-md-3">
                <label className="form-label">Partes de trabajo</label>
                <input
                  type="number"
                  min={0}
                  className="form-control"
                  value={form.partesTrabajo}
                  required
                  onChange={(e) =>
                    setForm((current) => ({ ...current, partesTrabajo: Number(e.target.value || 0) }))
                  }
                />
              </div>
              <div className="col-md-3">
                <label className="form-label">Asistencias Sanitarias</label>
                <input
                  type="number"
                  min={0}
                  className="form-control"
                  value={form.asistenciasSanitarias}
                  required
                  onChange={(e) =>
                    setForm((current) => ({ ...current, asistenciasSanitarias: Number(e.target.value || 0) }))
                  }
                />
              </div>
              <div className="col-md-3">
                <label className="form-label">Responsable</label>
                <input
                  className="form-control"
                  placeholder="Nombre - Primer Apellido"
                  value={form.responsable}
                  required
                  onChange={(e) => setForm((current) => ({ ...current, responsable: e.target.value }))}
                />
              </div>
              <div className="col-12">
                <label className="form-label">Observaciones</label>
                <textarea
                  className="form-control"
                  rows={4}
                  value={form.observaciones}
                  onChange={(e) => setForm((current) => ({ ...current, observaciones: e.target.value }))}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="d-flex justify-content-end">
          <button className="btn btn-primary" type="submit" disabled={saving}>
            {saving ? 'Guardando…' : 'Guardar informe'}
          </button>
        </div>
      </form>
    </div>
  );
}
