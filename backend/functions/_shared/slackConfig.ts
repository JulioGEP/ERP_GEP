const DEFAULT_SLACK_CHANNEL_ID = 'C063C7QRHK4';

export function getSlackToken(): string {
  return String(process.env.SLACK_TOKEN ?? process.env.SLACK_BOT_TOKEN ?? '').trim();
}

export function getSlackChannelId(): string {
  return String(process.env.SLACK_CHANNEL_ID ?? DEFAULT_SLACK_CHANNEL_ID).trim();
}

