import type { Handler } from '@netlify/functions';
import bcrypt from 'bcryptjs';
import { prisma } from './_shared/prisma';
import { jsonOk, jsonError, withCorsAndCookies } from './_shared/response';
import { signSessionCookie } from './_shared/auth';

function assertEnv() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL missing');
  if (!process.env.ALLOWED_EMAIL_DOMAIN) throw new Error('ALLOWED_EMAIL_DOMAIN missing');
}

export const handler: Handler = withCorsAndCookies(async (event) => {
  try {
    assertEnv();

    if (event.httpMethod !== 'POST') return jsonError(405, 'Method not allowed');
    if (!event.body) return jsonError(400, 'Empty body');

    const { email, password } = JSON.parse(event.body) as {
      email?: string;
      password?: string;
    };
    if (!email || !password) return jsonError(400, 'Email y contraseña son obligatorios');

    const allowedDomain = process.env.ALLOWED_EMAIL_DOMAIN?.trim().toLowerCase() ?? '';
    const incomingDomain = email.split('@')[1]?.toLowerCase() ?? '';
    if (allowedDomain && incomingDomain !== allowedDomain) {
      return jsonError(401, 'Credenciales inválidas');
    }

    const user = await prisma.users.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } as any },
    });

    if (!user || user.active === false) return jsonError(401, 'Credenciales inválidas');
    if (!user.password_hash) return jsonError(401, 'Credenciales inválidas');

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return jsonError(401, 'Credenciales inválidas');

    const displayName =
      (user as any).name ?? `${user.first_name ?? ''} ${user.last_name ?? ''}`.trim();

    const cookie = await signSessionCookie({
      id: user.id,
      email: user.email,
      role: user.role,
      name: displayName,
    });

    return jsonOk(
      {
        ok: true,
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
          name: displayName,
        },
      },
      { setCookie: cookie }
    );
  } catch (err: any) {
    console.error('auth-login error:', err?.message ?? err);
    return jsonError(500, 'Error interno al iniciar sesión');
  }
});
