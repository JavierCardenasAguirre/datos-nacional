export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase';
import { getSessionUser } from '@/lib/auth';
import { normalizeTipologia, normalizeText } from '@/lib/text-normalization';

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user || user.role !== 'admin') {
    return NextResponse.json({ error: 'Solo administradores pueden agregar registros' }, { status: 403 });
  }

  try {
    const body = await req.json();
    const records = Array.isArray(body) ? body : [body];
    const supabase = getServiceSupabase();

    const rows = records.map((r: any) => ({
      departamento: normalizeText(r.departamento),
      municipio: normalizeText(r.municipio),
      vereda: normalizeText(r.vereda),
      lat_grados: parseFloat(r.lat_grados ?? r.latitud_grados) || 0,
      lat_minutos: parseFloat(r.lat_minutos ?? r.latitud_minutos) || 0,
      lat_segundos: parseFloat(r.lat_segundos ?? r.latitud_segundos) || 0,
      lon_grados: parseFloat(r.lon_grados ?? r.longitud_grados) || 0,
      lon_minutos: parseFloat(r.lon_minutos ?? r.longitud_minutos) || 0,
      lon_segundos: parseFloat(r.lon_segundos ?? r.longitud_segundos) || 0,
      latitud: parseFloat(r.latitud) || 0,
      longitud: parseFloat(r.longitud) || 0,
      fecha: r.fecha || null,
      tipologia: normalizeTipologia(r.tipologia),
      informacion_hecho: normalizeText(r.informacion_hecho),
      fenomeno_criminalidad: normalizeText(r.fenomeno_criminalidad),
      medios: normalizeText(r.medios),
      genero: normalizeText(r.genero),
      estructura: normalizeText(r.estructura),
      respuesta_accion: normalizeText(r.respuesta_accion),
      accion_enemiga: normalizeText(r.accion_enemiga),
      res_tipo: normalizeText(r.res_tipo),
    })).filter((row) => row.departamento || row.municipio || row.tipologia);

    if (rows.length === 0) {
      return NextResponse.json({ error: 'No hay filas válidas para insertar' }, { status: 400 });
    }

    const { data, error } = await supabase.from('intel_records').insert(rows).select('id');
    if (error) throw error;

    return NextResponse.json({ success: true, count: data?.length ?? 0 });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Error al insertar' }, { status: 500 });
  }
}
