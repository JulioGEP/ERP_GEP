import type { ComponentProps } from 'react';
import { MailchimpPersonsView } from '../../features/recursos/MailchimpPersonsView';

type MailchimpPersonsViewProps = ComponentProps<typeof MailchimpPersonsView>;

export type MailchimpPageProps = MailchimpPersonsViewProps;

export default function MailchimpPage(props: MailchimpPageProps) {
  return <MailchimpPersonsView {...props} />;
}
