function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatPeriod(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

export function getCurrentPayrollDateRange(referenceDate = new Date()): { startDate: string; endDate: string } {
  const reference = new Date(referenceDate);
  if (Number.isNaN(reference.getTime())) {
    const today = new Date();
    return { startDate: formatDate(today), endDate: formatDate(today) };
  }

  const endDate =
    reference.getDate() >= 26
      ? new Date(reference.getFullYear(), reference.getMonth() + 1, 25)
      : new Date(reference.getFullYear(), reference.getMonth(), 25);
  const startDate = new Date(endDate.getFullYear(), endDate.getMonth() - 1, 26);

  return {
    startDate: formatDate(startDate),
    endDate: formatDate(endDate),
  };
}

export function getCurrentPayrollPeriod(referenceDate = new Date()): string {
  const reference = new Date(referenceDate);
  if (Number.isNaN(reference.getTime())) {
    return formatPeriod(new Date());
  }

  const periodMonthDate =
    reference.getDate() >= 26
      ? new Date(reference.getFullYear(), reference.getMonth() + 1, 1)
      : new Date(reference.getFullYear(), reference.getMonth(), 1);

  return formatPeriod(periodMonthDate);
}
