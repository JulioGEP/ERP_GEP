import { useMemo } from 'react';
import { PreventiveModal, type PreventiveModalProps } from './PreventiveModal';

export type PreventiveSessionModalProps = PreventiveModalProps;

export function PreventiveSessionModal({
  initialSections,
  ...props
}: PreventiveSessionModalProps) {
  const normalizedInitialSections = useMemo(() => {
    const sections = Array.isArray(initialSections) ? [...initialSections] : [];
    if (!sections.includes('sessions')) {
      sections.unshift('sessions');
    }
    return sections;
  }, [initialSections]);

  return <PreventiveModal {...props} initialSections={normalizedInitialSections} />;
}
