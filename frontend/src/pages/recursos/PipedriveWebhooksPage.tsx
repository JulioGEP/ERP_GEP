import type { ComponentProps } from 'react';
import { PipedriveWebhooksView } from '../../features/recursos/PipedriveWebhooksView';

type PipedriveWebhooksViewProps = ComponentProps<typeof PipedriveWebhooksView>;

export type PipedriveWebhooksPageProps = PipedriveWebhooksViewProps;

export default function PipedriveWebhooksPage(props: PipedriveWebhooksPageProps) {
  return <PipedriveWebhooksView {...props} />;
}
