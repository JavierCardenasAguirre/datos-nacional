export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase';

// El conteo EXACTO ('exact') hace un full-scan de la tabla y agota el tiempo de
// espera cuando hay cientos de miles de registros (devuelve null -> "Base de
// datos vacía"). El conteo ESTIMADO ('planned'/'estimated') usa las estadísticas
// del planificador de Postgres y responde en milisegundos, suficiente para saber
// si hay datos. Intentamos exacto solo como respaldo para tablas pequeñas.
export async function GET() {
  try {
    const sb = getServiceSupabase();

    // 1) Estimado (rápido, no hace full-scan)
    const est = await sb.from('intel_records').select('*', { count: 'estimated', head: true });
    if (!est.error && (est.count ?? 0) > 0) {
      return NextResponse.json({ count: est.count });
    }

    // 2) Si el estimado es 0 (tabla recién creada / sin ANALYZE) intentamos exacto.
    //    En tablas pequeñas es instantáneo; si falla, devolvemos el estimado.
    const exact = await sb.from('intel_records').select('*', { count: 'exact', head: true });
    if (!exact.error && exact.count != null) {
      return NextResponse.json({ count: exact.count });
    }

    return NextResponse.json({ count: est.count ?? 0 });
  } catch (err: any) {
    console.error('Count error:', err);
    return NextResponse.json({ count: 0 });
  }
}
