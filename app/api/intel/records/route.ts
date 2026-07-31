export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase';
import { getSessionUser } from '@/lib/auth';
import { normalizeTipologia, normalizeText } from '@/lib/text-normalization';

// Parsea un número aceptando la COMA como separador decimal (formato es-CO).
// `parseFloat("7,7538")` devolvía 7 (cortaba en la coma) y colapsaba las
// coordenadas a grados enteros. Devuelve NaN si no es un número válido.
function parseNum(val: any): number {
  if (val == null) return NaN;
  let s = String(val).trim();
  if (s === '') return NaN;
  if (s.includes(',') && !s.includes('.')) {
    s = s.replace(/,/g, '.');
  } else if (s.includes(',') && s.includes('.')) {
    s = s.replace(/\./g, '').replace(',', '.');
  }
  const n = parseFloat(s);
  return isNaN(n) ? NaN : n;
}

// Convierte grados/minutos/segundos a decimal. En Colombia la latitud es
// positiva (N) y la longitud negativa (W), igual que en el parser de importación.
function dmsToDecimal(g: number, m: number, s: number, isLon: boolean): number {
  const dec = Math.abs(g) + (m || 0) / 60 + (s || 0) / 3600;
  return isLon ? -Math.abs(dec) : dec;
}

// Resuelve la coordenada final: usa el decimal si trae parte fraccionaria; si
// viene vacío, en 0 o entero (síntoma de dato corrupto) pero SÍ hay minutos o
// segundos, la recalcula desde grados/minutos/segundos (fuente de alta precisión).
function resolveCoord(decRaw: any, g: number, m: number, s: number, isLon: boolean): number {
  const dec = parseNum(decRaw);
  const hasSubDegree = (m || 0) > 0 || (s || 0) > 0;
  if (!isFinite(dec) || dec === 0 || (Number.isInteger(dec) && hasSubDegree)) {
    const fromDms = dmsToDecimal(g, m, s, isLon);
    if (fromDms !== 0) return fromDms;
  }
  return isFinite(dec) ? dec : 0;
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user || user.role !== 'admin') {
    return NextResponse.json({ error: 'Solo administradores pueden agregar registros' }, { status: 403 });
  }

  try {
    const body = await req.json();
    const records = Array.isArray(body) ? body : [body];
    const supabase = getServiceSupabase();

    const rows = records.map((r: any) => {
      const latG = parseNum(r.lat_grados ?? r.latitud_grados) || 0;
      const latM = parseNum(r.lat_minutos ?? r.latitud_minutos) || 0;
      const latS = parseNum(r.lat_segundos ?? r.latitud_segundos) || 0;
      const lonG = parseNum(r.lon_grados ?? r.longitud_grados) || 0;
      const lonM = parseNum(r.lon_minutos ?? r.longitud_minutos) || 0;
      const lonS = parseNum(r.lon_segundos ?? r.longitud_segundos) || 0;
      return {
      departamento: normalizeText(r.departamento),
      municipio: normalizeText(r.municipio),
      vereda: normalizeText(r.vereda),
      lat_grados: latG,
      lat_minutos: latM,
      lat_segundos: latS,
      lon_grados: lonG,
      lon_minutos: lonM,
      lon_segundos: lonS,
      latitud: resolveCoord(r.latitud, latG, latM, latS, false),
      longitud: resolveCoord(r.longitud, lonG, lonM, lonS, true),
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
      };
    }).filter((row) => row.departamento || row.municipio || row.tipologia);

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
