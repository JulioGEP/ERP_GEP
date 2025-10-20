import { useMemo } from 'react';

import { BudgetDetailModal, type BudgetDetailModalProps } from './BudgetDetailModal';

export type SessionModalProps = BudgetDetailModalProps;

export function SessionModal({ initialSections, ...props }: SessionModalProps) {
  const normalizedSections = useMemo(() => {
    const base = Array.isArray(initialSections) ? initialSections : [];
    const sections = [...base];
    if (!sections.includes('sessions')) {
      sections.unshift('sessions');
    }
    return sections;
  }, [initialSections]);

  return <BudgetDetailModal {...props} initialSections={normalizedSections} />;
}
