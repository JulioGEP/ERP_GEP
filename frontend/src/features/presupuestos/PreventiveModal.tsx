import { Form } from 'react-bootstrap';
import {
  BudgetDetailModal,
  type BudgetDetailModalProps,
  type DealPrimaryFieldConfig,
} from './BudgetDetailModal';
import type { DealDetail, DealSummary } from '../../types/deal';

function toOptionArray(value: DealDetail['tipo_servicio'] | DealSummary['tipo_servicio']): string[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value
      .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
      .filter((entry): entry is string => entry.length > 0);
  }

  if (typeof value === 'string') {
    return value
      .split(/[;,]/)
      .map((entry) => entry.trim())
      .filter((entry): entry is string => entry.length > 0);
  }

  return [];
}

const preventiveFieldConfig: DealPrimaryFieldConfig = {
  fieldKey: 'service_label',
  label: 'Servicio',
  formatValue: (value) => {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  },
  parseOptions: ({ deal, summary }) => {
    const detailOptions = toOptionArray(deal?.tipo_servicio ?? null);
    const summaryOptions = toOptionArray(summary?.tipo_servicio ?? null);
    return [...detailOptions, ...summaryOptions];
  },
  emptyOptionsHelp: "Configura ‘tipo_servicio’ en el deal para poder seleccionar el Servicio",
  renderInput: ({ value, onChange, options, helpText, inputId, tooltip }) => {
    const listId = options.length ? `${inputId}-options` : undefined;

    return (
      <>
        <Form.Control
          id={inputId}
          list={listId}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          title={tooltip}
          placeholder={options.length ? 'Selecciona el servicio' : 'Introduce el servicio'}
        />
        {options.length ? (
          <datalist id={listId}>
            {options.map((option) => (
              <option key={option} value={option} />
            ))}
          </datalist>
        ) : null}
        {helpText ? <Form.Text className="text-muted">{helpText}</Form.Text> : null}
      </>
    );
  },
};

export type PreventiveModalProps = Omit<BudgetDetailModalProps, 'fieldConfig'>;

export function PreventiveModal(props: PreventiveModalProps) {
  return <BudgetDetailModal {...props} fieldConfig={preventiveFieldConfig} />;
}
