const SLACK_API_URL = 'https://slack.com/api/chat.postMessage';

const DEFAULT_ATTEMPTS = 3;
const DEFAULT_DELAY_MS = 1500;
const MAX_ATTEMPTS = 10;
const MAX_DELAY_MS = 15000;
const RETRYABLE_SLACK_ERRORS = new Set([
  'internal_error',
  'fatal_error',
  'request_timeout',
  'service_unavailable',
  'ratelimited',
]);

type SlackApiPayload = {
  ok?: boolean;
  error?: string;
};

export type SlackRetryOptions = {
  attempts?: number;
  delayMs?: number;
  channel: string;
  logger?: Pick<Console, 'info' | 'warn'>;
};

export type SlackPostResult = {
  attemptsRequested: number;
  attemptsUsed: number;
};

type SlackPostErrorDetails = {
  retryable: boolean;
  message: string;
};

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

function normalizePositiveInteger(value: unknown, fallback: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(max, Math.floor(parsed));
}

function buildSlackPostError(response: Response, rawBody: string, payload: SlackApiPayload | null): SlackPostErrorDetails {
  const slackError = String(payload?.error ?? '').trim();
  const baseMessage = slackError.length
    ? `Slack API chat.postMessage falló (${slackError})`
    : `Slack API chat.postMessage devolvió HTTP ${response.status}`;
  const rawDetails = rawBody ? ` | body=${rawBody}` : '';
  const retryable =
    response.status === 429 ||
    response.status >= 500 ||
    (slackError.length > 0 && RETRYABLE_SLACK_ERRORS.has(slackError));

  return {
    retryable,
    message: `${baseMessage}${rawDetails}`,
  };
}

async function postSlackMessageOnce(token: string, text: string, channel: string): Promise<void> {
  const response = await fetch(SLACK_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({
      channel,
      text,
    }),
  });

  const rawBody = await response.text();
  let payload: SlackApiPayload | null = null;

  try {
    payload = rawBody ? (JSON.parse(rawBody) as SlackApiPayload) : null;
  } catch {
    payload = null;
  }

  if (!response.ok || !payload?.ok) {
    const errorDetails = buildSlackPostError(response, rawBody, payload);
    const error = new Error(errorDetails.message) as Error & { retryable?: boolean };
    error.retryable = errorDetails.retryable;
    throw error;
  }
}

export function getSlackRetryOptions(
  query: Record<string, string | null | undefined> | null | undefined,
): Pick<SlackRetryOptions, 'attempts' | 'delayMs'> {
  return {
    attempts: normalizePositiveInteger(query?.attempts, DEFAULT_ATTEMPTS, MAX_ATTEMPTS),
    delayMs: normalizePositiveInteger(query?.delayMs, DEFAULT_DELAY_MS, MAX_DELAY_MS),
  };
}

export async function postSlackMessageWithRetry(
  token: string,
  text: string,
  options: SlackRetryOptions,
): Promise<SlackPostResult> {
  const attemptsRequested = normalizePositiveInteger(options.attempts, DEFAULT_ATTEMPTS, MAX_ATTEMPTS);
  const delayMs = normalizePositiveInteger(options.delayMs, DEFAULT_DELAY_MS, MAX_DELAY_MS);
  const logger = options.logger ?? console;

  let attemptsUsed = 0;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= attemptsRequested; attempt += 1) {
    attemptsUsed = attempt;

    try {
      await postSlackMessageOnce(token, text, options.channel);
      return {
        attemptsRequested,
        attemptsUsed,
      };
    } catch (error) {
      lastError = error;
      const retryable = Boolean(
        error &&
          typeof error === 'object' &&
          'retryable' in error &&
          (error as { retryable?: boolean }).retryable === true,
      );

      if (!retryable || attempt >= attemptsRequested) {
        throw error;
      }

      logger.warn('[slack-post] Slack envío falló; se reintentará.', {
        attempt,
        attemptsRequested,
        delayMs,
        message: error instanceof Error ? error.message : String(error ?? ''),
      });

      await sleep(delayMs);
    }
  }

  if (lastError instanceof Error) {
    throw lastError;
  }

  throw new Error('No se pudo completar el envío a Slack.');
}
