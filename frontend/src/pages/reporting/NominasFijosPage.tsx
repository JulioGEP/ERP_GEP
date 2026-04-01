import { useCallback } from 'react';
import NominasOficinaPage from './NominasOficinaPage';
import type { OfficePayrollRecord } from '../../features/reporting/api';

function isTrainerFixedPayrollEntry(entry: OfficePayrollRecord): boolean {
  const normalizedRole = (entry.role ?? '').trim().toLowerCase();
  const isTrainerRole = normalizedRole === 'formador';
  return isTrainerRole && entry.trainerFixedContract === true && entry.canDeliverTraining !== true;
}

export default function NominasFijosPage() {
  const filterEntries = useCallback((entry: OfficePayrollRecord) => !isTrainerFixedPayrollEntry(entry), []);

  return <NominasOficinaPage filterEntries={filterEntries} />;
}
