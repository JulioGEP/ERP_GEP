import { BudgetDetailModal, type BudgetDetailModalProps } from '../BudgetDetailModal';

export type OpenTrainingBudgetModalProps = BudgetDetailModalProps;

export function OpenTrainingBudgetModal(props: OpenTrainingBudgetModalProps) {
  return <BudgetDetailModal {...props} />;
}
