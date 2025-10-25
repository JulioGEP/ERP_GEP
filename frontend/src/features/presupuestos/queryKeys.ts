export const DEALS_WITHOUT_SESSIONS_QUERY_KEY = ['deals', 'noSessions'] as const;

export const DEALS_WITHOUT_SESSIONS_FALLBACK_QUERY_KEY = [
  ...DEALS_WITHOUT_SESSIONS_QUERY_KEY,
  'fallback',
] as const;
