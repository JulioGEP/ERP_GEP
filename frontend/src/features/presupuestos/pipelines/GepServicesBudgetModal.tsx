import { BudgetDetailModal, type BudgetDetailModalProps } from '../BudgetDetailModal';

export type GepServicesBudgetModalProps = BudgetDetailModalProps;

export function GepServicesBudgetModal(props: GepServicesBudgetModalProps) {
  return <BudgetDetailModal {...props} />;
}
