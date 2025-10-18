import type { ComponentProps } from 'react';
import { CertificateTemplatesView } from '../../features/recursos/CertificateTemplatesView';

type CertificateTemplatesViewProps = ComponentProps<typeof CertificateTemplatesView>;

export type TemplatesCertificadosPageProps = CertificateTemplatesViewProps;

export default function TemplatesCertificadosPage(props: TemplatesCertificadosPageProps) {
  return <CertificateTemplatesView {...props} />;
}
