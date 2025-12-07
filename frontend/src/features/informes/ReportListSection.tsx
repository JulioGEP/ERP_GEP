import type { ReportListEntry } from '../../api/reports';

const formatDate = (value: string | null) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('es-ES');
};

type ReportListSectionProps = {
  title: string;
  description?: string;
  rows: ReportListEntry[];
  loading: boolean;
  error: string | null;
  emptyMessage?: string;
};

export function ReportListSection({
  title,
  description,
  rows,
  loading,
  error,
  emptyMessage = 'No hay informes registrados todavía.',
}: ReportListSectionProps) {
  return (
    <section className="py-3">
      <div className="d-flex align-items-center justify-content-between mb-3">
        <div>
          {description ? <p className="text-muted mb-1">{description}</p> : null}
          <h2 className="h4 mb-0">{title}</h2>
        </div>
      </div>

      {error ? (
        <div className="alert alert-danger" role="alert">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="text-center py-4">Cargando informes...</div>
      ) : (
        <div className="table-responsive">
          <table className="table table-striped align-middle">
            <thead>
              <tr>
                <th>Presupuesto</th>
                <th>Empresa</th>
                <th>Sesión</th>
                <th>Fecha</th>
                <th>Formador</th>
                <th>Enlace</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-4">
                    {emptyMessage}
                  </td>
                </tr>
              ) : (
                rows.map((report) => (
                  <tr key={report.id}>
                    <td>{report.presupuesto || '—'}</td>
                    <td>{report.empresa || '—'}</td>
                    <td>{report.sesion || '—'}</td>
                    <td>{formatDate(report.fecha)}</td>
                    <td>{report.formador || '—'}</td>
                    <td>
                      {report.enlace ? (
                        <a href={report.enlace} target="_blank" rel="noreferrer">
                          Ver informe
                        </a>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export default ReportListSection;
