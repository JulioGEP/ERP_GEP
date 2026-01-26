import { getJson, postJson } from './client';

export type SlackChannel = {
  id: string;
  name: string;
  isPrivate: boolean;
};

export type SlackMessagePayload = {
  channelId: string;
  text: string;
};

export type SlackChannelsResponse = {
  channels: SlackChannel[];
};

export type SlackSendMessageResponse = {
  message?: {
    text?: string;
    ts?: string;
  };
  slack?: Record<string, unknown>;
};

export async function fetchSlackChannels() {
  return getJson<SlackChannelsResponse>('slack-messages');
}

export async function sendSlackMessage(payload: SlackMessagePayload) {
  return postJson<SlackSendMessageResponse>('slack-messages', payload);
}
