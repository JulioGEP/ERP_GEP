import { FormEvent, useMemo, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { emitToast } from '../../utils/toast';

type BudgetPrefillResponse = {
  deal?: {
    cliente?: string;
    contacto?: string;
    comercial?: string;
    direccionPreventivo?: string;
    training_address?: string;
  };
};

const TURNO_OPTIONS = ['Mañana', 'Noche'] as const;

export default function ActuacionesPreventivosReportPage() {
  const { user } = useAuth();
  const creatorName = useMemo(
    () => [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim(),
    [user?.firstName, user?.lastName],
  );

  const [isLoadingBudget, setIsLoadingBudget] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [form, setForm] = useState({
    presupuesto: '',
    cliente: '',
    personaContacto: '',
    direccionPreventivo: '',
    bombero: creatorName,
    fechaEjercicio: '',
    turno: 'Mañana',
    partesTrabajo: '',
    asistenciasSanitarias: '',
    derivaronMutua: '',
    observaciones: '',
    responsable: '',
  });

  const updateField = <K extends keyof typeof form>(field: K, value: (typeof form)[K]) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const handleLoadBudget = async () => {
    const presupuesto = form.presupuesto.trim();
    if (!presupuesto) {
      emitToast({ variant: 'warning', message: 'Introduce el Nº Presupuesto antes de buscar.' });
      return;
    }

    setIsLoadingBudget(true);
    try {
      const response = await fetch('/.netlify/functions/reportPrefill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dealId: presupuesto }),
      });

      const payload = (await response.json()) as BudgetPrefillResponse;
      if (!response.ok) {
        throw new Error('No se pudo obtener el presupuesto.');
      }

      const deal = payload?.deal ?? {};
      setForm((current) => ({
        ...current,
        cliente: typeof deal.cliente === 'string' ? deal.cliente : '',
        personaContacto: typeof deal.contacto === 'string' ? deal.contacto : '',
        direccionPreventivo:
          typeof deal.direccionPreventivo === 'string'
            ? deal.direccionPreventivo
            : typeof deal.training_address === 'string'
              ? deal.training_address
              : '',
      }));
    } catch (error) {
      console.error(error);
      emitToast({ variant: 'danger', message: 'No se ha podido cargar el presupuesto.' });
    } finally {
      setIsLoadingBudget(false);
    }
  };

  const handleSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const presupuesto = form.presupuesto.trim();
    if (!presupuesto) {
      emitToast({ variant: 'warning', message: 'El Nº de presupuesto es obligatorio.' });
      return;
    }

    if (!form.fechaEjercicio) {
      emitToast({ variant: 'warning', message: 'La fecha del ejercicio es obligatoria.' });
      return;
    }

    setIsSaving(true);
    try {
      const response = await fetch('/.netlify/functions/actuaciones-preventivos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dealId: presupuesto,
          cliente: form.cliente,
          personaContacto: form.personaContacto,
          direccionPreventivo: form.direccionPreventivo,
          fechaEjercicio: form.fechaEjercicio,
          turno: form.turno,
          partesTrabajo: form.partesTrabajo,
          asistenciasSanitarias: form.asistenciasSanitarias,
          derivaronMutua: form.derivaronMutua,
          observaciones: form.observaciones,
          responsable: form.responsable,
        }),
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error || payload?.message || 'No se pudo guardar el informe.');
      }

      emitToast({ variant: 'success', message: 'Informe guardado correctamente.' });
    } catch (error) {
      console.error(error);
      const message = error instanceof Error ? error.message : 'No se pudo guardar el informe.';
      emitToast({ variant: 'danger', message });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section className="py-2 py-md-3">
      <div className="container-fluid">
        <h2 className="h4 mb-3">Informe de actuaciones preventivos</h2>
        <form className="card shadow-sm" onSubmit={handleSave}>
          <div className="card-body d-grid gap-3">
            <h3 className="h5 mb-0">Datos del cliente</h3>

            <div className="row g-3 align-items-end">
              <div className="col-12 col-md-6 col-lg-4">
                <label className="form-label" htmlFor="presupuesto">Presupuesto</label>
                <input
                  id="presupuesto"
                  className="form-control"
                  value={form.presupuesto}
                  onChange={(event) => updateField('presupuesto', event.target.value)}
                  required
                />
              </div>
              <div className="col-12 col-md-6 col-lg-3">
                <button type="button" className="btn btn-outline-primary w-100" onClick={handleLoadBudget} disabled={isLoadingBudget}>
                  {isLoadingBudget ? 'Buscando...' : 'Buscar'}
                </button>
              </div>
            </div>

            <div className="row g-3">
              <div className="col-12 col-lg-3">
                <label className="form-label" htmlFor="cliente">Cliente</label>
                <input id="cliente" className="form-control" value={form.cliente} readOnly />
              </div>
              <div className="col-12 col-lg-3">
                <label className="form-label" htmlFor="persona-contacto">Persona de contacto</label>
                <input id="persona-contacto" className="form-control" value={form.personaContacto} readOnly />
              </div>
              <div className="col-12 col-lg-3">
                <label className="form-label" htmlFor="responsable">Responsable</label>
                <input
                  id="responsable"
                  className="form-control"
                  placeholder="Nombre - Primer Apellido"
                  value={form.responsable}
                  onChange={(event) => updateField('responsable', event.target.value)}
                />
              </div>
              <div className="col-12">
                <label className="form-label" htmlFor="direccion-preventivo">Dirección del Preventivo</label>
                <input id="direccion-preventivo" className="form-control" value={form.direccionPreventivo} readOnly />
              </div>
            </div>

            <hr className="my-1" />
            <h3 className="h5 mb-0">Registro</h3>

            <div className="row g-3">
              <div className="col-12 col-lg-6">
                <label className="form-label" htmlFor="bombero">Bombero/a</label>
                <input
                  id="bombero"
                  className="form-control"
                  value={form.bombero}
                  onChange={(event) => updateField('bombero', event.target.value)}
                  readOnly
                />
              </div>
              <div className="col-12 col-lg-6">
                <label className="form-label" htmlFor="fecha-ejercicio">Fecha ejercicio</label>
                <input
                  id="fecha-ejercicio"
                  type="datetime-local"
                  className="form-control"
                  value={form.fechaEjercicio}
                  onChange={(event) => updateField('fechaEjercicio', event.target.value)}
                  required
                />
              </div>
            </div>

            <hr className="my-1" />
            <h3 className="h5 mb-0">Actuaciones</h3>

            <div className="row g-3">
              <div className="col-12 col-lg-3">
                <label className="form-label" htmlFor="turno">Turno</label>
                <select
                  id="turno"
                  className="form-select"
                  value={form.turno}
                  onChange={(event) => updateField('turno', event.target.value)}
                >
                  {TURNO_OPTIONS.map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
              </div>
              <div className="col-12 col-lg-3">
                <label className="form-label" htmlFor="partes-trabajo">Partes de trabajo</label>
                <input
                  id="partes-trabajo"
                  className="form-control"
                  type="number"
                  min={0}
                  value={form.partesTrabajo}
                  onChange={(event) => updateField('partesTrabajo', event.target.value)}
                />
              </div>
              <div className="col-12 col-lg-3">
                <label className="form-label" htmlFor="asistencias-sanitarias">Asistencias Sanitarias</label>
                <input
                  id="asistencias-sanitarias"
                  className="form-control"
                  type="number"
                  min={0}
                  value={form.asistenciasSanitarias}
                  onChange={(event) => updateField('asistenciasSanitarias', event.target.value)}
                />
              </div>
              <div className="col-12 col-lg-3">
                <label className="form-label" htmlFor="derivaron-mutua">Derivaron a Mútua</label>
                <input
                  id="derivaron-mutua"
                  className="form-control"
                  type="number"
                  min={0}
                  value={form.derivaronMutua}
                  onChange={(event) => updateField('derivaronMutua', event.target.value)}
                />
              </div>
              <div className="col-12">
                <label className="form-label" htmlFor="observaciones">Observaciones</label>
                <textarea
                  id="observaciones"
                  className="form-control"
                  rows={4}
                  value={form.observaciones}
                  onChange={(event) => updateField('observaciones', event.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="card-footer d-flex justify-content-end">
            <button type="submit" className="btn btn-success" disabled={isSaving}>
              {isSaving ? 'Guardando informe...' : 'Guardar informe'}
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}
