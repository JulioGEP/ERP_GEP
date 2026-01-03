import { useCallback } from 'react';
import NominasOficinaPage from './NominasOficinaPage';
import type { OfficePayrollRecord } from '../../features/reporting/api';

export default function NominasFijosPage() {
  const filterEntries = useCallback(
    (entry: OfficePayrollRecord) => entry.trainerFixedContract !== true,
    [],
  );

  return <NominasOficinaPage filterEntries={filterEntries} />;
}
