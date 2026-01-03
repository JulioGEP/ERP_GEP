import { useCallback } from 'react';
import NominasOficinaPage from './NominasOficinaPage';
import type { OfficePayrollRecord } from '../../features/reporting/api';

export default function NominasFijosDiscontinuosPage() {
  const filterEntries = useCallback(
    (entry: OfficePayrollRecord) => entry.trainerFixedContract === true,
    [],
  );

  return (
    <NominasOficinaPage
      title="Nóminas Fijos discontinuos"
      description="Listado mensual de nóminas para formadores con contrato fijo discontinuo."
      filterEntries={filterEntries}
    />
  );
}
