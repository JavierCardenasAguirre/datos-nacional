export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 30;

import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase';

// Este endpoint decide si se muestra el DASHBOARD o la pantalla de "Importar".
// Antes devolvía { count: 0 } ante CUALQUIER error o demora (p. ej. el conteo
// tardaba >10 s justo después de importar cientos de miles de filas), y la app
// creía que la base estaba vacía -> al refrescar volvía a pedir el Excel.
//
// Ahora:
//   1) `hasData` se calcula leyendo UNA sola fila por la clave primaria
//      (milisegundos, sin importar el tamaño de la tabla).
//   2) `count` es el ESTIMADO de Postgres (rápido); solo es informativo.
//   3) Si algo falla se responde 503 con el error, NUNCA un falso 0.
function noStore(res: NextResponse) {
  res.headers.set('Cache-Control', 'no-store, max-age=0, must-revalidate');
  res.headers.set('Pragma', 'no-cache');
  res.headers.set('Expires', '0');
  return res;
}

export async function GET() {
  try {
    const sb = getServiceSupabase();

    const probe = await sb.from('intel_records').select('id').limit(1);
    if (probe.error) {
      console.error('Count probe error:', probe.error.message);
      return noStore(NextResponse.json({ error: probe.error.message, hasData: null }, { status: 503 }));
    }
    const hasData = (probe.data?.length ?? 0) > 0;
    if (!hasData) return noStore(NextResponse.json({ hasData: false, count: 0 }));

    let count: number | null = null;
    let source: 'exact' | 'planned' | 'probe' = 'probe';

    try {
      const exact = await sb.from('intel_records').select('*', { count: 'exact', head: true });
      if (!exact.error && typeof exact.count === 'number' && exact.count > 0) {
        count = exact.count;
        source = 'exact';
      }
    } catch { /* continúa con fallback */ }

    if (count == null) {
      try {
        const planned = await sb.from('intel_records').select('*', { count: 'planned', head: true });
        if (!planned.error && typeof planned.count === 'number' && planned.count > 0) {
          count = planned.count;
          source = 'planned';
        }
      } catch { /* continúa con fallback */ }
    }

    // Hay datos aunque el conteo exact/planned falle: nunca devolver 0.
    return noStore(NextResponse.json({ hasData: true, count: count ?? 1, source }));
  } catch (err: any) {
    console.error('Count error:', err);
    return noStore(NextResponse.json({ error: String(err?.message ?? err), hasData: null }, { status: 503 }));
  }
}
