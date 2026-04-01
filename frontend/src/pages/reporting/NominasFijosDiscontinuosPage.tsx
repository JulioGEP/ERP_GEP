import { useCallback } from 'react';
import NominasOficinaPage from './NominasOficinaPage';
import type { OfficePayrollRecord } from '../../features/reporting/api';

function isTrainerFixedPayrollEntry(entry: OfficePayrollRecord): boolean {
  const normalizedRole = (entry.role ?? '').trim().toLowerCase();
  const isTrainerRole = normalizedRole === 'formador';
  return isTrainerRole && entry.trainerFixedContract === true && entry.canDeliverTraining !== true;
}

export default function NominasFijosDiscontinuosPage() {
  const filterEntries = useCallback((entry: OfficePayrollRecord) => isTrainerFixedPayrollEntry(entry), []);

  return (
    <NominasOficinaPage
      title="Nóminas Formadores Fijos"
      description="Listado mensual de nóminas para formadores con contrato fijo discontinuo."
      filterEntries={filterEntries}
      enableSessionsAction
      allowExtrasEdit={false}
    />
  );
}
