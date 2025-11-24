// frontend/src/features/recursos/ProviderModal.tsx
import { useEffect, useMemo, useState } from 'react';
import { Button, Form, Modal, Spinner } from 'react-bootstrap';
import type { Provider } from '../../types/provider';

export type ProviderFormValues = {
  nombre_fiscal: string;
  direccion_fiscal: string;
  telefono_fiscal: string;
  mail_empresa: string;
  persona_contacto: string;
  telefono_contacto: string;
  mail_contacto: string;
};

type ProviderModalProps = {
  show: boolean;
  initialData?: Provider | null;
  isSaving: boolean;
  onClose: () => void;
  onSubmit: (values: ProviderFormValues) => void;
};

const EMPTY_FORM: ProviderFormValues = {
  nombre_fiscal: '',
  direccion_fiscal: '',
  telefono_fiscal: '',
  mail_empresa: '',
  persona_contacto: '',
  telefono_contacto: '',
  mail_contacto: '',
};

function providerToFormValues(provider?: Provider | null): ProviderFormValues {
  if (!provider) return { ...EMPTY_FORM };
  return {
    nombre_fiscal: provider.nombre_fiscal ?? '',
    direccion_fiscal: provider.direccion_fiscal ?? '',
    telefono_fiscal: provider.telefono_fiscal ?? '',
    mail_empresa: provider.mail_empresa ?? '',
    persona_contacto: provider.persona_contacto ?? '',
    telefono_contacto: provider.telefono_contacto ?? '',
    mail_contacto: provider.mail_contacto ?? '',
  };
}

export function ProviderModal({ show, initialData, isSaving, onClose, onSubmit }: ProviderModalProps) {
  const [formValues, setFormValues] = useState<ProviderFormValues>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (show) {
      setFormValues(providerToFormValues(initialData));
      setError(null);
    }
  }, [show, initialData]);

  const modalTitle = useMemo(() => 'Editar proveedor', []);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedName = formValues.nombre_fiscal.trim();

    if (!trimmedName.length) {
      setError('El nombre fiscal es obligatorio');
      return;
    }

    setError(null);
    onSubmit({
      ...formValues,
      nombre_fiscal: trimmedName,
      direccion_fiscal: formValues.direccion_fiscal.trim(),
      telefono_fiscal: formValues.telefono_fiscal.trim(),
      mail_empresa: formValues.mail_empresa.trim(),
      persona_contacto: formValues.persona_contacto.trim(),
      telefono_contacto: formValues.telefono_contacto.trim(),
      mail_contacto: formValues.mail_contacto.trim(),
    });
  };

  return (
    <Modal show={show} onHide={isSaving ? undefined : onClose} centered backdrop="static">
      <Form onSubmit={handleSubmit} noValidate>
        <Modal.Header closeButton={!isSaving}>
          <Modal.Title>{modalTitle}</Modal.Title>
        </Modal.Header>
        <Modal.Body className="pt-3">
          {error && (
            <div className="alert alert-danger" role="alert">
              {error}
            </div>
          )}
          <div className="row g-3">
            <div className="col-12">
              <Form.Group controlId="providerNombreFiscal">
                <Form.Label>Nombre fiscal *</Form.Label>
                <Form.Control
                  type="text"
                  value={formValues.nombre_fiscal}
                  required
                  onChange={(event) =>
                    setFormValues((prev) => ({ ...prev, nombre_fiscal: event.target.value }))
                  }
                  disabled={isSaving}
                />
              </Form.Group>
            </div>
            <div className="col-12">
              <Form.Group controlId="providerDireccionFiscal">
                <Form.Label>Dirección fiscal</Form.Label>
                <Form.Control
                  type="text"
                  value={formValues.direccion_fiscal}
                  onChange={(event) =>
                    setFormValues((prev) => ({ ...prev, direccion_fiscal: event.target.value }))
                  }
                  disabled={isSaving}
                />
              </Form.Group>
            </div>
            <div className="col-md-6">
              <Form.Group controlId="providerTelefonoFiscal">
                <Form.Label>Teléfono fiscal</Form.Label>
                <Form.Control
                  type="text"
                  value={formValues.telefono_fiscal}
                  onChange={(event) =>
                    setFormValues((prev) => ({ ...prev, telefono_fiscal: event.target.value }))
                  }
                  disabled={isSaving}
                />
              </Form.Group>
            </div>
            <div className="col-md-6">
              <Form.Group controlId="providerMailEmpresa">
                <Form.Label>Mail empresa</Form.Label>
                <Form.Control
                  type="email"
                  value={formValues.mail_empresa}
                  onChange={(event) =>
                    setFormValues((prev) => ({ ...prev, mail_empresa: event.target.value }))
                  }
                  disabled={isSaving}
                />
              </Form.Group>
            </div>
            <div className="col-md-6">
              <Form.Group controlId="providerPersonaContacto">
                <Form.Label>Persona de contacto</Form.Label>
                <Form.Control
                  type="text"
                  value={formValues.persona_contacto}
                  onChange={(event) =>
                    setFormValues((prev) => ({ ...prev, persona_contacto: event.target.value }))
                  }
                  disabled={isSaving}
                />
              </Form.Group>
            </div>
            <div className="col-md-6">
              <Form.Group controlId="providerTelefonoContacto">
                <Form.Label>Teléfono de contacto</Form.Label>
                <Form.Control
                  type="text"
                  value={formValues.telefono_contacto}
                  onChange={(event) =>
                    setFormValues((prev) => ({ ...prev, telefono_contacto: event.target.value }))
                  }
                  disabled={isSaving}
                />
              </Form.Group>
            </div>
            <div className="col-12">
              <Form.Group controlId="providerMailContacto">
                <Form.Label>Mail de contacto</Form.Label>
                <Form.Control
                  type="email"
                  value={formValues.mail_contacto}
                  onChange={(event) =>
                    setFormValues((prev) => ({ ...prev, mail_contacto: event.target.value }))
                  }
                  disabled={isSaving}
                />
              </Form.Group>
            </div>
          </div>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline-secondary" onClick={onClose} disabled={isSaving}>
            Cancelar
          </Button>
          <Button type="submit" disabled={isSaving}>
            {isSaving ? (
              <>
                <Spinner as="span" animation="border" size="sm" role="status" className="me-2" />
                Guardando...
              </>
            ) : (
              'Guardar'
            )}
          </Button>
        </Modal.Footer>
      </Form>
    </Modal>
  );
}
