// @ts-nocheck
import type { ComponentProps } from 'react';
import { CertificadosPage as CertificadosView } from '../../features/certificados/CertificadosPage';

type CertificadosViewProps = ComponentProps<typeof CertificadosView>;

export type CertificadosPageProps = CertificadosViewProps;

export default function CertificadosPage(props: CertificadosPageProps) {
  return <CertificadosView {...props} />;
}
