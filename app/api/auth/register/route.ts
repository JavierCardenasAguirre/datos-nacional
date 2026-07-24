export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase';
import { hashPassword, createToken, COOKIE_NAME } from '@/lib/auth';

export async function POST(req: NextRequest) {
  try {
    const { email, password, name } = await req.json();

    if (!email || !password || !name) {
      return NextResponse.json({ error: 'Todos los campos son requeridos' }, { status: 400 });
    }
    if (password.length < 6) {
      return NextResponse.json({ error: 'La contrase\u00f1a debe tener al menos 6 caracteres' }, { status: 400 });
    }

    const sb = getServiceSupabase();

    // Check if email already exists
    const { data: existing } = await sb.from('app_users').select('id').eq('email', email.toLowerCase().trim()).limit(1);
    if (existing && existing.length > 0) {
      return NextResponse.json({ error: 'Este email ya est\u00e1 registrado' }, { status: 409 });
    }

    // Check if this is the first user (will be admin)
    const { count } = await sb.from('app_users').select('*', { count: 'exact', head: true });
    const isFirstUser = (count ?? 0) === 0;

    const password_hash = await hashPassword(password);

    const { data: newUser, error } = await sb.from('app_users').insert({
      email: email.toLowerCase().trim(),
      password_hash,
      name: name.trim(),
      role: isFirstUser ? 'admin' : 'user',
      status: isFirstUser ? 'approved' : 'pending',
    }).select('id, email, name, role, status').single();

    if (error) {
      console.error('Register error:', error);
      return NextResponse.json({ error: 'Error al registrar usuario' }, { status: 500 });
    }

    // If first user (admin), log them in immediately
    if (isFirstUser) {
      const token = await createToken(newUser);
      const res = NextResponse.json({ user: newUser, message: 'Cuenta de administrador creada exitosamente' });
      res.cookies.set(COOKIE_NAME, token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 60 * 60 * 24 * 7, // 7 days
        path: '/',
      });
      return res;
    }

    // Not first user - pending approval
    return NextResponse.json({
      user: null,
      message: 'Registro exitoso. Tu cuenta est\u00e1 pendiente de aprobaci\u00f3n por el administrador.',
      pending: true,
    });
  } catch (err: any) {
    console.error('Register error:', err);
    return NextResponse.json({ error: err?.message ?? 'Error interno' }, { status: 500 });
  }
}
