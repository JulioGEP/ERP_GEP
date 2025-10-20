import { BudgetDetailModal, type BudgetDetailModalProps } from '../BudgetDetailModal';

export type MaterialsBudgetModalProps = BudgetDetailModalProps;

export function MaterialsBudgetModal(props: MaterialsBudgetModalProps) {
  return <BudgetDetailModal {...props} />;
}
