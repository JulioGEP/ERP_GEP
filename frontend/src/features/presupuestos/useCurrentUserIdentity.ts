import { useMemo } from 'react';
import { useAuth as useAuthContext } from '../../context/AuthContext';

const FALLBACK_USER = 'erp_user';

function normalize(value: string | null | undefined): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return trimmed.length ? trimmed : '';
}

export function useCurrentUserIdentity(): { userId: string; userName: string } {
  const { user } = useAuthContext();
  const userIdRaw = user?.id ?? null;
  const firstName = user?.firstName ?? null;
  const lastName = user?.lastName ?? null;
  const email = user?.email ?? null;

  return useMemo(() => {
    const userId = normalize(userIdRaw) || FALLBACK_USER;
    const fullName = [normalize(firstName), normalize(lastName)].filter(Boolean).join(' ').trim();
    const userName = fullName || normalize(email) || userId;

    return { userId, userName };
  }, [email, firstName, lastName, userIdRaw]);
}
