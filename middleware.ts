import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';

const COOKIE_NAME = 'datacore_session';
const PUBLIC_PATHS = ['/login', '/register', '/api/auth/login', '/api/auth/register', '/api/auth/logout', '/api/auth/me'];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some(p => pathname === p || pathname.startsWith(p + '/'));
}

function isStaticAsset(pathname: string): boolean {
  return pathname.startsWith('/_next') || pathname.startsWith('/favicon') || pathname.startsWith('/og-') || pathname.endsWith('.svg') || pathname.endsWith('.png') || pathname.endsWith('.ico');
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Allow static assets
  if (isStaticAsset(pathname)) return NextResponse.next();

  // Allow public paths
  if (isPublicPath(pathname)) return NextResponse.next();

  // Check for token
  const token = req.cookies.get(COOKIE_NAME)?.value;
  if (!token) {
    // API routes return 401, pages redirect to login
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }
    return NextResponse.redirect(new URL('/login', req.url));
  }

  // Verify JWT
  try {
    const secret = new TextEncoder().encode(process.env.JWT_SECRET ?? 'fallback-secret-change-me');
    const { payload } = await jwtVerify(token, secret);

    // Check if user is approved
    if (payload.status !== 'approved') {
      if (pathname.startsWith('/api/')) {
        return NextResponse.json({ error: 'Cuenta no aprobada' }, { status: 403 });
      }
      // Clear cookie and redirect to login
      const res = NextResponse.redirect(new URL('/login', req.url));
      res.cookies.set(COOKIE_NAME, '', { maxAge: 0, path: '/' });
      return res;
    }

    // Admin-only routes
    if (pathname.startsWith('/api/admin') && payload.role !== 'admin') {
      return NextResponse.json({ error: 'Solo administradores' }, { status: 403 });
    }

    return NextResponse.next();
  } catch {
    // Invalid token
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Sesi\u00f3n inv\u00e1lida' }, { status: 401 });
    }
    const res = NextResponse.redirect(new URL('/login', req.url));
    res.cookies.set(COOKIE_NAME, '', { maxAge: 0, path: '/' });
    return res;
  }
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon\\.ico|.*\\.svg$|.*\\.png$).*)',
  ],
};
