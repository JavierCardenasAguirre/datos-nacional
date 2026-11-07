export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase';
import { hashPassword } from '@/lib/auth';

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

    // Nadie se vuelve administrador al registrarse: el único admin es
    // ADMIN_EMAIL. Todos los registros quedan pendientes de aprobación.
    const password_hash = await hashPassword(password);

    const { error } = await sb.from('app_users').insert({
      email: email.toLowerCase().trim(),
      password_hash,
      name: name.trim(),
      role: 'user',
      status: 'pending',
    });

    if (error) {
      console.error('Register error:', error);
      return NextResponse.json({ error: 'Error al registrar usuario' }, { status: 500 });
    }

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
