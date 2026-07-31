export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase';
import { verifyPassword, createToken, COOKIE_NAME } from '@/lib/auth';

export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json();

    if (!email || !password) {
      return NextResponse.json({ error: 'Email y contrase\u00f1a son requeridos' }, { status: 400 });
    }

    const sb = getServiceSupabase();
    const { data: user, error } = await sb.from('app_users')
      .select('id, email, name, role, status, password_hash')
      .eq('email', email.toLowerCase().trim())
      .single();

    if (error || !user) {
      return NextResponse.json({ error: 'Credenciales inv\u00e1lidas' }, { status: 401 });
    }

    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) {
      return NextResponse.json({ error: 'Credenciales inv\u00e1lidas' }, { status: 401 });
    }

    if (user.status === 'pending') {
      return NextResponse.json({
        error: 'Tu cuenta est\u00e1 pendiente de aprobaci\u00f3n por el administrador.',
        pending: true,
      }, { status: 403 });
    }

    if (user.status === 'rejected') {
      return NextResponse.json({
        error: 'Tu cuenta ha sido rechazada por el administrador.',
      }, { status: 403 });
    }

    const token = await createToken({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      status: user.status,
    });

    const res = NextResponse.json({
      user: { id: user.id, email: user.email, name: user.name, role: user.role, status: user.status },
    });
    res.cookies.set(COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7,
      path: '/',
    });
    return res;
  } catch (err: any) {
    console.error('Login error:', err);
    return NextResponse.json({ error: err?.message ?? 'Error interno' }, { status: 500 });
  }
}
