export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, isAdminEmail, effectiveRole } from '@/lib/auth';
import { getServiceSupabase } from '@/lib/supabase';

// GET: List all users (admin only)
export async function GET(req: NextRequest) {
  const user = await requireAdmin();
  if (!user) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
  }

  const sb = getServiceSupabase();
  const { data, error } = await sb.from('app_users')
    .select('id, email, name, role, status, created_at')
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // El rol mostrado es el efectivo: solo el administrador único aparece como ADMIN.
  const users = (data ?? []).map((u: any) => ({ ...u, role: effectiveRole(u.email, u.role) }));
  return NextResponse.json({ users });
}

// PATCH: Update user status (approve/reject)
export async function PATCH(req: NextRequest) {
  const currentUser = await requireAdmin();
  if (!currentUser) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
  }

  const { userId, action } = await req.json();
  if (!userId || !['approve', 'reject'].includes(action)) {
    return NextResponse.json({ error: 'Datos inv\u00e1lidos' }, { status: 400 });
  }

  if (userId === currentUser.id) {
    return NextResponse.json({ error: 'No puedes cambiar tu propio estado' }, { status: 400 });
  }

  const sb = getServiceSupabase();
  const newStatus = action === 'approve' ? 'approved' : 'rejected';

  const { data: target } = await sb.from('app_users').select('id, email').eq('id', userId).maybeSingle();
  if (!target) {
    return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 });
  }
  if (isAdminEmail(target.email)) {
    return NextResponse.json({ error: 'No se puede modificar al administrador' }, { status: 400 });
  }

  // Al aprobar, la cuenta queda SIEMPRE como usuario normal (nunca admin).
  const { error } = await sb.from('app_users')
    .update({ status: newStatus, role: 'user' })
    .eq('id', userId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, status: newStatus });
}

// DELETE: Remove a user
export async function DELETE(req: NextRequest) {
  const currentUser = await requireAdmin();
  if (!currentUser) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
  }

  const { userId } = await req.json();
  if (!userId) {
    return NextResponse.json({ error: 'userId requerido' }, { status: 400 });
  }

  // Prevent admin from deleting themselves
  if (userId === currentUser.id) {
    return NextResponse.json({ error: 'No puedes eliminarte a ti mismo' }, { status: 400 });
  }

  const sb = getServiceSupabase();
  const { data: target } = await sb.from('app_users').select('id, email').eq('id', userId).maybeSingle();
  if (!target) {
    return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 });
  }
  if (isAdminEmail(target.email)) {
    return NextResponse.json({ error: 'No se puede eliminar al administrador' }, { status: 400 });
  }
  const { error } = await sb.from('app_users').delete().eq('id', userId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
