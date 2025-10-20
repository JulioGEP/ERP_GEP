import { SessionModal, type SessionModalProps } from '../SessionModal';

export type OpenTrainingSessionModalProps = SessionModalProps;

export function OpenTrainingSessionModal(props: OpenTrainingSessionModalProps) {
  return <SessionModal {...props} />;
}
