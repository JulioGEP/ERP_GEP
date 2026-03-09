import type { Handler } from '@netlify/functions';

const NETLIFY_SCHEDULE_HEADERS = ['x-netlify-event', 'x-nf-event'];
const MADRID_AUTOMATION_HOUR = '07';

export function isScheduledInvocation(event: Parameters<Handler>[0]): boolean {
  const headers = event.headers ?? {};

  for (const [headerKey, headerValue] of Object.entries(headers)) {
    const normalizedHeaderKey = headerKey.toLowerCase();
    if (!NETLIFY_SCHEDULE_HEADERS.includes(normalizedHeaderKey)) continue;

    if (String(headerValue ?? '').toLowerCase() === 'schedule') {
      return true;
    }
  }

  return false;
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
