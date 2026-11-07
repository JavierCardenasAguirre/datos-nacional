export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase';
import { requireAdmin } from '@/lib/auth';

export async function DELETE(req: NextRequest) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: 'Solo el administrador puede borrar la base de datos' }, { status: 403 });
  }
  try {
    const sb = getServiceSupabase();
    // Delete all records
    const { error } = await sb.from('intel_records').delete().neq('id', 0);
    if (error) {
      console.error('Destroy error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('Destroy error:', err);
    return NextResponse.json({ error: err?.message }, { status: 500 });
  }
}
