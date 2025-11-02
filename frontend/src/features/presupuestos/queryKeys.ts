export const DEALS_QUERY_KEY = ['deals'] as const;

export const DEALS_WITHOUT_SESSIONS_QUERY_KEY = [...DEALS_QUERY_KEY, 'noSessions'] as const;

export const DEALS_ALL_QUERY_KEY = [...DEALS_QUERY_KEY, 'all'] as const;

export const DEALS_WITHOUT_SESSIONS_FALLBACK_QUERY_KEY = [
  ...DEALS_WITHOUT_SESSIONS_QUERY_KEY,
  'fallback',
] as const;
