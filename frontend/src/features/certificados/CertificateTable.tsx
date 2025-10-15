import { Form, Table } from 'react-bootstrap';

import type { CertificateRow } from './lib/mappers';

type CertificateTableProps = {
  rows: CertificateRow[];
  onRowsChange?: (rows: CertificateRow[]) => void;
  disabled?: boolean;
};

type EditableField =
  | 'presu'
  | 'nombre'
  | 'apellidos'
  | 'dni'
  | 'fecha'
  | 'fecha2'
  | 'lugar'
  | 'horas'
  | 'cliente'
  | 'formacion'
  | 'irata';

const REQUIRED_FIELDS: EditableField[] = ['nombre', 'apellidos', 'dni'];

function buildFullName(row: CertificateRow): string {
  const name = row.nombre?.trim() ?? '';
  const surname = row.apellidos?.trim() ?? '';
  const fullName = `${name} ${surname}`.trim();
  return fullName.length ? fullName : 'Alumno sin nombre';
}

export function CertificateTable({ rows, onRowsChange, disabled }: CertificateTableProps) {
  const handleChange = (rowId: string, field: EditableField, value: string) => {
    if (!onRowsChange) return;
    const nextRows = rows.map((row) =>
      row.id === rowId
        ? {
            ...row,
            [field]: value,
          }
        : row,
    );
    onRowsChange(nextRows);
  };

  const renderInput = (row: CertificateRow, field: EditableField) => {
    const value = row[field] ?? '';
    const trimmedValue = typeof value === 'string' ? value.trim() : '';
    const isRequired = REQUIRED_FIELDS.includes(field);
    const isInvalid = isRequired && !trimmedValue.length;
    return (
      <Form.Control
        size="sm"
        type="text"
        value={value}
        onChange={(event) => handleChange(row.id, field, event.target.value)}
        disabled={disabled}
        isInvalid={isInvalid}
        aria-invalid={isInvalid || undefined}
      />
    );
  };

  return (
    <div className="certificate-table-wrapper">
      <Table striped bordered hover responsive size="sm" className="certificate-table mb-0">
        <thead>
          <tr>
            <th>Presu</th>
            <th>Nombre</th>
            <th>Apellidos</th>
            <th>DNI</th>
            <th>Fecha</th>
            <th>Fecha 2</th>
            <th>Lugar</th>
            <th>Horas</th>
            <th>Cliente</th>
            <th>Formación</th>
            <th>Irata</th>
            <th className="text-center">Cert.</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const fullName = buildFullName(row);
            return (
              <tr key={row.id}>
                <td>{renderInput(row, 'presu')}</td>
                <td>
                  <div className="certificate-table-name">
                    {row.driveUrl ? (
                      <a href={row.driveUrl} target="_blank" rel="noreferrer">
                        {fullName}
                      </a>
                    ) : (
                      <span>{fullName}</span>
                    )}
                  </div>
                  {renderInput(row, 'nombre')}
                </td>
                <td>{renderInput(row, 'apellidos')}</td>
                <td className="certificate-table-dni">{renderInput(row, 'dni')}</td>
                <td>{renderInput(row, 'fecha')}</td>
                <td>{renderInput(row, 'fecha2')}</td>
                <td>{renderInput(row, 'lugar')}</td>
                <td className="certificate-table-hours">{renderInput(row, 'horas')}</td>
                <td>{renderInput(row, 'cliente')}</td>
                <td>{renderInput(row, 'formacion')}</td>
                <td>{renderInput(row, 'irata')}</td>
                <td className="text-center align-middle">
                  <Form.Check
                    type="checkbox"
                    checked={Boolean(row.certificado)}
                    readOnly
                    disabled
                    aria-label={`Certificado generado para ${fullName}`}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </Table>
    </div>
  );
}
