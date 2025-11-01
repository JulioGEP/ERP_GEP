// frontend/src/pages/certificados/CertificadosPage.tsx
import { CertificadosPage as CertificadosView } from '../../features/certificados/CertificadosPage';

export type CertificadosPageProps = Record<string, never>;

export default function CertificadosPage(_props: CertificadosPageProps) {
  return <CertificadosView />;
}
