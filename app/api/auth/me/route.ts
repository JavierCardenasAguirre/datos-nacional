export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser, getVerifiedSessionUser, COOKIE_NAME } from '@/lib/auth';

// Devuelve el usuario ACTUAL según la base de datos (no solo el token), para
// que los cambios de rol/estado o la eliminación se apliquen de inmediato.
export async function GET(_req: NextRequest) {
  const session = await getSessionUser();
  if (!session) {
    return NextResponse.json({ user: null });
  }
  const user = await getVerifiedSessionUser();
  if (!user || user.status !== 'approved') {
    const res = NextResponse.json({ user: null });
    res.cookies.set(COOKIE_NAME, '', { maxAge: 0, path: '/' });
    return res;
  }
  return NextResponse.json({ user });
}
