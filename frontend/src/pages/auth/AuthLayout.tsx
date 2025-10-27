import type { ReactNode } from 'react';
import { Card, Container } from 'react-bootstrap';
import logo from '../../assets/gep-group-logo.png';

type AuthLayoutProps = {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
};

export function AuthLayout({ title, subtitle, children, footer }: AuthLayoutProps) {
  return (
    <Container className="min-vh-100 d-flex align-items-center justify-content-center py-5">
      <Card className="w-100 shadow-sm" style={{ maxWidth: 420 }}>
        <Card.Body className="p-4">
          <div className="text-center mb-4">
            <img src={logo} alt="GEP Group" height={56} className="mb-3" />
            <h1 className="h4 fw-bold mb-1">{title}</h1>
            {subtitle ? <p className="text-muted mb-0">{subtitle}</p> : null}
          </div>
          {children}
        </Card.Body>
        {footer ? <Card.Footer className="bg-white text-center">{footer}</Card.Footer> : null}
      </Card>
    </Container>
  );
}
