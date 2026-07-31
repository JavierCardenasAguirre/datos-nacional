export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase';
import { parseFilters, applyFilters } from '@/lib/supabase-filters';

// Máximo de puntos a dibujar en el mapa (más que esto satura el navegador).
const MAX_POINTS = 15000;
// PostgREST devuelve como máximo 1000 filas por petición: hay que paginar.
const PAGE_SIZE = 1000;

export async function GET(req: NextRequest) {
  try {
    const filters = parseFilters(req.nextUrl.searchParams);
    const sb = getServiceSupabase();

    // Conteo estimado (rápido). El conteo EXACTO hace full-scan de 487K filas,
    // agota el tiempo y devuelve null -> el mapa quedaba vacío.
    let total = 0;
    try {
      let countQuery = sb.from('intel_records')
        .select('*', { count: 'estimated', head: true })
        .not('latitud', 'is', null)
        .not('longitud', 'is', null);
      countQuery = applyFilters(countQuery, filters);
      const { count } = await countQuery;
      total = count ?? 0;
    } catch { /* ignore, seguimos con la paginación */ }

    // Traemos páginas de 1000 (solo filas con coordenadas) hasta juntar
    // MAX_POINTS o quedarnos sin datos. Con 15 páginas basta para el tope.
    const allPoints: any[] = [];
    let from = 0;
    while (allPoints.length < MAX_POINTS) {
      let query = sb.from('intel_records')
        .select('id, latitud, longitud, departamento, municipio, tipologia, fecha, estructura, fenomeno_criminalidad, informacion_hecho')
        .not('latitud', 'is', null)
        .not('longitud', 'is', null)
        .range(from, from + PAGE_SIZE - 1)
        // DESC: prioriza los incidentes más recientes (tipologías recién
        // agregadas) para que sí aparezcan entre los puntos dibujados.
        .order('id', { ascending: false });
      query = applyFilters(query, filters);
      const { data, error } = await query;
      if (error) {
        console.error('Map points page error:', error.message);
        break;
      }
      if (!data || data.length === 0) break;
      allPoints.push(...data);
      if (data.length < PAGE_SIZE) break; // no hay más filas
      from += PAGE_SIZE;
    }

    // Si el estimado no era fiable, usamos lo realmente traído.
    if (total < allPoints.length) total = allPoints.length;

    return NextResponse.json({
      total,
      displayed: allPoints.length,
      points: allPoints.slice(0, MAX_POINTS),
    });
  } catch (err: any) {
    console.error('Map points error:', err);
    return NextResponse.json({ error: err?.message }, { status: 500 });
  }
}
