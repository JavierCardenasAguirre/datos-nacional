import bcrypt from 'bcryptjs';
import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';

const JWT_SECRET_STR = process.env.JWT_SECRET ?? 'fallback-secret-change-me';
const secret = new TextEncoder().encode(JWT_SECRET_STR);
const COOKIE_NAME = 'datacore_session';

export interface UserPayload {
  id: number;
  email: string;
  name: string;
  role: string; // 'admin' | 'user'
  status: string; // 'approved' | 'pending' | 'rejected'
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function createToken(user: UserPayload): Promise<string> {
  return new SignJWT({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    status: user.status,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('7d')
    .setIssuedAt()
    .sign(secret);
}

export async function verifyToken(token: string): Promise<UserPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret);
    return payload as unknown as UserPayload;
  } catch {
    return null;
  }
}

export async function getSessionUser(): Promise<UserPayload | null> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(COOKIE_NAME)?.value;
    if (!token) return null;
    return verifyToken(token);
  } catch {
    return null;
  }
}

export function getTokenFromCookieHeader(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp(`${COOKIE_NAME}=([^;]+)`));
  return match ? match[1] : null;
}

export { COOKIE_NAME };

// ---------------------------------------------------------------------------
// ADMINISTRADOR ÚNICO
// Solo esta cuenta puede ser administradora. Aunque en la base de datos otra
// cuenta tenga role='admin', el servidor la trata como usuario normal.
// Se puede cambiar con la variable de entorno ADMIN_EMAIL (opcional).
// ---------------------------------------------------------------------------
export const ADMIN_EMAIL = (process.env.ADMIN_EMAIL ?? 'amdres.di@gmail.com').toLowerCase().trim();

export function isAdminEmail(email: string | null | undefined): boolean {
  return !!email && email.toLowerCase().trim() === ADMIN_EMAIL;
}

/** Rol efectivo: 'admin' solo si el email es el del administrador único. */
export function effectiveRole(email: string | null | undefined, dbRole?: string | null): 'admin' | 'user' {
  return isAdminEmail(email) && (dbRole ?? 'admin') === 'admin' ? 'admin' : 'user';
}

/**
 * Lee el usuario de la sesión y lo VUELVE A VERIFICAR en la base de datos
 * (para que un usuario eliminado/rechazado o un ex-admin pierda el acceso de
 * inmediato, sin esperar a que caduque su token de 7 días).
 */
export async function getVerifiedSessionUser(): Promise<UserPayload | null> {
  const session = await getSessionUser();
  if (!session?.id) return null;
  const { getServiceSupabase } = await import('./supabase');
  const sb = getServiceSupabase();
  const { data, error } = await sb.from('app_users')
    .select('id, email, name, role, status')
    .eq('id', session.id)
    .maybeSingle();
  if (error || !data) return null;
  return {
    id: data.id,
    email: data.email,
    name: data.name,
    role: effectiveRole(data.email, data.role),
    status: data.status,
  };
}

/** Devuelve el admin verificado en BD, o null si quien llama no es el admin. */
export async function requireAdmin(): Promise<UserPayload | null> {
  const u = await getVerifiedSessionUser();
  if (!u || u.status !== 'approved' || u.role !== 'admin') return null;
  return u;
}
