export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase';
import { parseFilters, applyFilters } from '@/lib/supabase-filters';
import { normalizeTipologia } from '@/lib/text-normalization';

type NameCount = { name: string; count: number };

function noStore(res: NextResponse) {
  res.headers.set('Cache-Control', 'no-store, max-age=0, must-revalidate');
  res.headers.set('Pragma', 'no-cache');
  res.headers.set('Expires', '0');
  return res;
}

function topN(map: Record<string, number>, limit: number): NameCount[] {
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, count]) => ({ name, count }));
}

function toSafeDate(val: any): string | null {
  if (!val) return null;
  const s = String(val).slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return null;
}

function applyEventFilter(query: any, evento: string | null) {
  const txt = (evento ?? '').trim();
  if (!txt) return query;
  return query.ilike('informacion_hecho', `%${txt}%`);
}

async function fetchEstructuras(sb: ReturnType<typeof getServiceSupabase>, search: string, limit: number) {
  const rpc = await sb.rpc('intel_enemigo_estructuras', {
    p_search: search || null,
    p_limit: limit,
  });

  if (!rpc.error && Array.isArray(rpc.data)) {
    return rpc.data
      .map((r: any) => ({ name: String(r.estructura ?? '').trim(), count: Number(r.total ?? 0) }))
      .filter((x: NameCount) => x.name.length > 0 && x.count > 0);
  }

  const counts: Record<string, number> = {};
  const PAGE = 2000;
  const MAX_PAGES = 250;
  for (let p = 0; p < MAX_PAGES; p++) {
    let query = sb
      .from('intel_records')
      .select('estructura')
      .not('estructura', 'is', null)
      .neq('estructura', '')
      .order('estructura', { ascending: true })
      .range(p * PAGE, (p + 1) * PAGE - 1);

    if (search) query = query.ilike('estructura', `%${search}%`);

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;

    for (const row of data) {
      const raw = String((row as any).estructura ?? '').trim();
      if (!raw) continue;
      counts[raw] = (counts[raw] || 0) + 1;
    }

    if (data.length < PAGE) break;
  }

  return topN(counts, limit);
}

async function fetchEnemigoStats(sb: ReturnType<typeof getServiceSupabase>, req: NextRequest) {
  const search = req.nextUrl.searchParams;
  const filters = parseFilters(search);
  const evento = search.get('evento');
  const estructura = (filters.estructura ?? '').trim();

  if (!estructura) throw new Error('Debe seleccionar una estructura.');

  const rpc = await sb.rpc('intel_enemigo_stats', {
    p_estructura: estructura,
    p_fecha_inicio: filters.fechaInicio ?? null,
    p_fecha_fin: filters.fechaFin ?? null,
    p_departamento: filters.departamento ?? null,
    p_municipio: filters.municipio ?? null,
    p_tipologia: filters.tipologia ?? null,
    p_evento: evento && evento.trim() ? evento.trim() : null,
  });

  if (!rpc.error && rpc.data) return rpc.data;

  const tipologias: Record<string, number> = {};
  const departamentos: Record<string, number> = {};
  const municipios: Record<string, number> = {};
  const timeline: Record<string, number> = {};

  let minFecha: string | null = null;
  let maxFecha: string | null = null;
  let total = 0;

  const PAGE = 2000;
  const MAX_PAGES = 1000;
  for (let p = 0; p < MAX_PAGES; p++) {
    let query = sb
      .from('intel_records')
      .select('tipologia, departamento, municipio, fecha')
      .range(p * PAGE, (p + 1) * PAGE - 1)
      .order('id', { ascending: false });

    query = applyFilters(query, filters);
    query = applyEventFilter(query, evento);

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;

    total += data.length;
    for (const row of data) {
      const tipologia = normalizeTipologia(String((row as any).tipologia ?? '').trim());
      const departamento = String((row as any).departamento ?? '').trim();
      const municipio = String((row as any).municipio ?? '').trim();
      const fecha = toSafeDate((row as any).fecha);

      if (tipologia) tipologias[tipologia] = (tipologias[tipologia] || 0) + 1;
      if (departamento) departamentos[departamento] = (departamentos[departamento] || 0) + 1;
      if (municipio) municipios[municipio] = (municipios[municipio] || 0) + 1;

      if (fecha) {
        const monthKey = fecha.slice(0, 7);
        timeline[monthKey] = (timeline[monthKey] || 0) + 1;
        if (!minFecha || fecha < minFecha) minFecha = fecha;
        if (!maxFecha || fecha > maxFecha) maxFecha = fecha;
      }
    }

    if (data.length < PAGE) break;
  }

  const timelineArr = Object.entries(timeline)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([fecha, count]) => ({ fecha, count }));

  return {
    estructura,
    totalCount: total,
    tipologias: topN(tipologias, 20),
    departamentos: topN(departamentos, 20),
    municipios: topN(municipios, 20),
    timeline: timelineArr,
    minFecha,
    maxFecha,
    source: 'fallback',
  };
}

async function fetchEnemigoRecords(sb: ReturnType<typeof getServiceSupabase>, req: NextRequest) {
  const search = req.nextUrl.searchParams;
  const filters = parseFilters(search);
  const evento = search.get('evento');
  const page = Math.max(1, Number(search.get('page') ?? 1));
  const pageSize = Math.min(200, Math.max(10, Number(search.get('pageSize') ?? 50)));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  if (!(filters.estructura ?? '').trim()) throw new Error('Debe seleccionar una estructura.');

  let query = sb.from('intel_records')
    .select('id, fecha, departamento, municipio, vereda, tipologia, fenomeno_criminalidad, estructura, informacion_hecho, latitud, longitud', { count: 'exact' })
    .range(from, to)
    .order('fecha', { ascending: false, nullsFirst: false })
    .order('id', { ascending: false });

  query = applyFilters(query, filters);
  query = applyEventFilter(query, evento);

  const { data, error, count } = await query;
  if (error) throw new Error(error.message);

  return {
    records: data ?? [],
    total: count ?? 0,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil((count ?? 0) / pageSize)),
  };
}

async function fetchEnemigoMap(sb: ReturnType<typeof getServiceSupabase>, req: NextRequest) {
  const search = req.nextUrl.searchParams;
  const filters = parseFilters(search);
  const evento = search.get('evento');

  if (!(filters.estructura ?? '').trim()) throw new Error('Debe seleccionar una estructura.');

  const MAX_POINTS = 5000;

  let query = sb.from('intel_records')
    .select('id, latitud, longitud, departamento, municipio, tipologia, fecha, estructura, fenomeno_criminalidad, informacion_hecho')
    .not('latitud', 'is', null)
    .not('longitud', 'is', null)
    .range(0, MAX_POINTS - 1)
    .order('id', { ascending: false });

  query = applyFilters(query, filters);
  query = applyEventFilter(query, evento);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  return {
    points: data ?? [],
    displayed: (data ?? []).length,
  };
}

export async function GET(req: NextRequest) {
  try {
    const sb = getServiceSupabase();
    const mode = (req.nextUrl.searchParams.get('mode') ?? 'stats').toLowerCase();

    if (mode === 'estructuras') {
      const search = (req.nextUrl.searchParams.get('search') ?? '').trim();
      const limit = Math.min(500, Math.max(20, Number(req.nextUrl.searchParams.get('limit') ?? 200)));
      const items = await fetchEstructuras(sb, search, limit);
      return noStore(NextResponse.json({ items }));
    }

    if (mode === 'stats') {
      const data = await fetchEnemigoStats(sb, req);
      return noStore(NextResponse.json(data));
    }

    if (mode === 'records') {
      const data = await fetchEnemigoRecords(sb, req);
      return noStore(NextResponse.json(data));
    }

    if (mode === 'map') {
      const data = await fetchEnemigoMap(sb, req);
      return noStore(NextResponse.json(data));
    }

    return noStore(NextResponse.json({ error: 'Modo no soportado' }, { status: 400 }));
  } catch (err: any) {
    console.error('Enemy API error:', err);
    return noStore(NextResponse.json({ error: String(err?.message ?? err) }, { status: 500 }));
  }
}
