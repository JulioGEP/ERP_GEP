import { useEffect, useMemo, useState } from 'react';
import { fetchReportList, type ReportListEntry } from '../../../../api/reports';
import { ReportListSection } from '../../../../features/informes/ReportListSection';
import { useAuth } from '../../../../context/AuthContext';

const normalizeText = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

export default function TrainerReportsListPage() {
  const { user } = useAuth();
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

  const trainerName = useMemo(() => {
    if (!user?.firstName && !user?.lastName) return '';
    return normalizeText(`${user?.firstName ?? ''} ${user?.lastName ?? ''}`);
  }, [user?.firstName, user?.lastName]);

  const rows = useMemo(() => {
    if (!trainerName) return reports;
    return reports.filter((report) => normalizeText(report.formador ?? '').includes(trainerName));
  }, [reports, trainerName]);

  return (
    <ReportListSection
      title="Informes"
      description="Informes registrados por ti"
      rows={rows}
      loading={loading}
      error={error}
      emptyMessage="No has registrado informes todavía."
    />
  );
}
