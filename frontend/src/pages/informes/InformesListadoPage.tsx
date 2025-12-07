import { useEffect, useMemo, useState } from 'react';
import type { ReportListEntry } from '../../api/reports';
import { fetchReportList } from '../../api/reports';
import { ReportListSection } from '../../features/informes/ReportListSection';

export default function InformesListadoPage() {
  const [reports, setReports] = useState<ReportListEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadReports = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetchReportList();
        setReports(response.reports || []);
      } catch (err) {
        const message =
          err instanceof Error && err.message
            ? err.message
            : 'No se pudo cargar el listado de informes.';
        setError(message);
      } finally {
        setLoading(false);
      }
    };

    void loadReports();
  }, []);

  const rows = useMemo(() => reports, [reports]);

  return (
    <ReportListSection
      title="Listado de informes"
      description="Informes generados por formadores"
      rows={rows}
      loading={loading}
      error={error}
    />
  );
}
