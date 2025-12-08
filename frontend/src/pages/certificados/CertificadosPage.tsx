// frontend/src/pages/certificados/CertificadosPage.tsx
import {
  CertificadosPage as CertificadosView,
  type CertificadosPageProps as CertificadosViewProps,
} from '../../features/certificados/CertificadosPage';

export type CertificadosPageProps = CertificadosViewProps;

export default function CertificadosPage(props: CertificadosPageProps) {
  return <CertificadosView {...props} />;
}
