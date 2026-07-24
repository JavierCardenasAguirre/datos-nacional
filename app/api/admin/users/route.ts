export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { getServiceSupabase } from '@/lib/supabase';

// GET: List all users (admin only)
export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user || user.role !== 'admin') {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
  }

  const sb = getServiceSupabase();
  const { data, error } = await sb.from('app_users')
    .select('id, email, name, role, status, created_at')
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ users: data ?? [] });
}

// PATCH: Update user status (approve/reject)
export async function PATCH(req: NextRequest) {
  const currentUser = await getSessionUser();
  if (!currentUser || currentUser.role !== 'admin') {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
  }

  const { userId, action } = await req.json();
  if (!userId || !['approve', 'reject'].includes(action)) {
    return NextResponse.json({ error: 'Datos inv\u00e1lidos' }, { status: 400 });
  }

  const sb = getServiceSupabase();
  const newStatus = action === 'approve' ? 'approved' : 'rejected';

  const { error } = await sb.from('app_users')
    .update({ status: newStatus })
    .eq('id', userId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, status: newStatus });
}

// DELETE: Remove a user
export async function DELETE(req: NextRequest) {
  const currentUser = await getSessionUser();
  if (!currentUser || currentUser.role !== 'admin') {
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
  const { error } = await sb.from('app_users').delete().eq('id', userId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
