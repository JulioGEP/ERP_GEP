import type { Handler } from '@netlify/functions';

const NETLIFY_SCHEDULE_HEADER = 'x-netlify-event';
const MADRID_AUTOMATION_HOUR = '07';

export function isScheduledInvocation(event: Parameters<Handler>[0]): boolean {
  const scheduleHeader = event.headers?.[NETLIFY_SCHEDULE_HEADER] ?? event.headers?.[NETLIFY_SCHEDULE_HEADER.toUpperCase()];
  return String(scheduleHeader ?? '').toLowerCase() === 'schedule';
}

export function isWithinMadridAutomationWindow(
  isoDateTime: string,
  startMinuteInclusive = 0,
  endMinuteInclusive = 59,
): boolean {
  const timePart = isoDateTime.split('T')[1] ?? '';
  const [hour = '', minute = ''] = timePart.split(':');
  const minuteNumber = Number.parseInt(minute, 10);

  return (
    hour === MADRID_AUTOMATION_HOUR
    && Number.isInteger(minuteNumber)
    && minuteNumber >= startMinuteInclusive
    && minuteNumber <= endMinuteInclusive
  );
}
