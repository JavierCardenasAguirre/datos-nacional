export const dynamic = 'force-dynamic';
export const revalidate = 0;
// Vercel: da margen a las consultas. En plan Hobby se limita a 10s de todos
// modos, pero el contador se resuelve en ~1-2s con el conteo exacto ligero.
export const maxDuration = 30;

import { NextRequest, NextResponse } from 'next/server';
import { supabase, getServiceSupabase } from '@/lib/supabase';
import { parseFilters, applyFilters } from '@/lib/supabase-filters';
import { normalizeTipologia } from '@/lib/text-normalization';

// Supabase (PostgREST) devuelve como máximo 1000 filas por petición, así que la
// única forma escalable de contar 487.000+ registros es agregando DENTRO de la
// base de datos con la función SQL `intel_dashboard_stats` (ver SUPABASE_SETUP.sql).
// Si esa función aún no está instalada, usamos un respaldo por muestreo para que
// el dashboard no se vea vacío, marcándolo como parcial.

const PAGE_SIZE = 1000;      // límite real de PostgREST
const FALLBACK_MAX_PAGES = 500; // muestra hasta 500.000 filas si falta la función SQL
const FALLBACK_PARALLEL = 8;

const DAY_NAMES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const MONTH_NAMES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

type NC = { name: string; count: number };

function buildRecomendaciones(params: {
  total: number;
  tipologias: NC[];
  municipios: NC[];
  patternTemporal: { label: string; count: number }[];
  monthlyPattern: { label: string; count: number }[];
  correlaciones: { fenomeno: string; estructura: string; count: number }[];
  municipiosCount: number;
}): string[] {
  const { total, tipologias, municipios, patternTemporal, monthlyPattern, correlaciones, municipiosCount } = params;
  const rec: string[] = [];
  if ((municipios[0]?.count ?? 0) > total * 0.15) {
    rec.push(`[ALERTA ALTA] ${municipios[0]?.name ?? 'N/A'} concentra ${((municipios[0]?.count ?? 0) / total * 100).toFixed(1)}% de los incidentes. Se recomienda reforzar presencia militar.`);
  }
  if ((tipologias[0]?.count ?? 0) > 0) {
    rec.push(`[TIPOLOGIA] Tipología predominante: "${tipologias[0]?.name ?? 'N/A'}" con ${tipologias[0]?.count ?? 0} casos.`);
  }
  const maxDay = patternTemporal.reduce((a, b) => (a.count > b.count ? a : b), patternTemporal[0]);
  if (maxDay?.count > 0) {
    rec.push(`[PATRON] Mayor actividad los días ${maxDay.label} (${maxDay.count} incidentes).`);
  }
  const maxMonth = monthlyPattern.reduce((a, b) => (a.count > b.count ? a : b), monthlyPattern[0]);
  if (maxMonth?.count > 0) {
    rec.push(`[TEMPORAL] Mes con mayor actividad: ${maxMonth.label} (${maxMonth.count} incidentes).`);
  }
  if ((correlaciones[0]?.count ?? 0) > 0) {
    rec.push(`[CORRELACION] Correlación más fuerte: "${correlaciones[0]?.fenomeno ?? ''}" vinculado a "${correlaciones[0]?.estructura ?? ''}" (${correlaciones[0]?.count ?? 0} casos).`);
  }
  rec.push(`[RESUMEN] Total de ${total} incidentes registrados en ${municipiosCount} municipios.`);
  return rec;
}

// ---- Detecta si el error del RPC es "la función no existe" ---------------
function isMissingFunction(error: any): boolean {
  if (!error) return false;
  const code = String(error.code ?? '');
  const msg = String(error.message ?? '').toLowerCase();
  return (
    code === 'PGRST202' ||          // PostgREST: función no encontrada
    code === '42883' ||             // Postgres: undefined_function
    msg.includes('could not find the function') ||
    msg.includes('does not exist')
  );
}

// Construye los argumentos de las funciones SQL a partir de los filtros.
function buildRpcArgs(filters: any) {
  return {
    p_fecha_inicio: filters.fechaInicio ?? null,
    p_fecha_fin: filters.fechaFin ?? null,
    p_departamento: filters.departamento ?? null,
    p_municipio: filters.municipio ?? null,
    p_tipologia: filters.tipologia ?? null,
    p_fenomeno: filters.fenomeno ?? null,
    p_estructura: filters.estructura ?? null,
  };
}

// ---- CONTEO EXACTO Y FRESCO (nunca estimado para el número final) --------
// El "contador de eventos" DEBE reflejar de inmediato las filas nuevas. El
// conteo ESTIMADO de Postgres no sirve (se actualiza tarde). Estrategia:
//   1) RPC intel_count  -> exacto, inmune al límite de 8s de Supabase.
//   2) count:'exact'    -> exacto vía PostgREST (por si la RPC no está instalada).
//   3) count:'estimated'-> último recurso, para no mostrar 0.
async function getExactCount(sb: ReturnType<typeof getServiceSupabase>, filters: any): Promise<number | null> {
  // 1) Función SQL ligera
  try {
    const c = await sb.rpc('intel_count', buildRpcArgs(filters));
    if (!c.error && typeof c.data === 'number') return c.data;
  } catch { /* sigue al plan B */ }

  // 2) Conteo exacto por PostgREST
  try {
    let q = sb.from('intel_records').select('*', { count: 'exact', head: true });
    q = applyFilters(q, filters);
    const x = await q;
    if (!x.error && x.count != null) return x.count;
  } catch { /* sigue al plan C */ }

  // 3) Estimado (último recurso)
  try {
    let q = sb.from('intel_records').select('*', { count: 'estimated', head: true });
    q = applyFilters(q, filters);
    const e = await q;
    return e.count ?? null;
  } catch {
    return null;
  }
}

// Llama a la función pesada de agregación con un límite de tiempo. Si no
// responde a tiempo, ABORTA la consulta (para no dejar queries de ~25s colgadas
// ocupando conexiones de Supabase) y devuelve null -> se usa el respaldo.
async function callBigRpcWithTimeout(
  sb: ReturnType<typeof getServiceSupabase>,
  rpcArgs: Record<string, any>,
  ms: number,
): Promise<any | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const rpc = await sb.rpc('intel_dashboard_stats', rpcArgs).abortSignal(controller.signal);
    return rpc;
  } catch {
    return null; // abortada o error
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(req: NextRequest) {
  try {
    const filters = parseFilters(req.nextUrl.searchParams);
    const sb = getServiceSupabase();

    // El contador exacto se resuelve SIEMPRE por su cuenta (rápido) para que
    // sea correcto pase lo que pase con la función pesada de agregación.
    const exactCountPromise = getExactCount(sb, filters);

    // =====================================================================
    // 1) CAMINO PRINCIPAL: función SQL de agregación (rápida y exacta)
    // =====================================================================
    const rpcArgs = buildRpcArgs(filters);

    // La función pesada puede tardar ~25s sobre 487K filas. La corremos "contra
    // reloj": si no responde en 6s la abandonamos y usamos el respaldo, de modo
    // que la petición SIEMPRE termina dentro del límite de Vercel.
    const rpc = await callBigRpcWithTimeout(sb, rpcArgs, 6000);

    if (rpc && !rpc.error && rpc.data) {
      const d: any = rpc.data;
      // El contador SIEMPRE usa el conteo exacto y fresco (no el de la RPC, por
      // si sus estadísticas quedaran atrás); si falla, usa el de la RPC.
      const exactCount = await exactCountPromise;
      const total: number = exactCount ?? d.totalCount ?? 0;

      const dowArr: { d: number; count: number }[] = Array.isArray(d.dow) ? d.dow : [];
      const monthArr: { m: number; count: number }[] = Array.isArray(d.month) ? d.month : [];
      const dowMap: Record<number, number> = {};
      dowArr.forEach((x) => { dowMap[x.d] = x.count; });
      const monthMap: Record<number, number> = {};
      monthArr.forEach((x) => { monthMap[x.m] = x.count; });

      const patternTemporal = DAY_NAMES.map((label, i) => ({ label, count: dowMap[i] || 0 }));
      const monthlyPattern = MONTH_NAMES.map((label, i) => ({ label, count: monthMap[i + 1] || 0 }));

      const tipologias: NC[] = d.tipologias ?? [];
      const municipios: NC[] = d.municipios ?? [];
      const correlaciones = d.correlaciones ?? [];
      const municipiosByDept = d.municipiosByDept ?? {};

      const recomendaciones = buildRecomendaciones({
        total, tipologias, municipios, patternTemporal, monthlyPattern, correlaciones,
        municipiosCount: municipios.length,
      });

      const data = {
        totalCount: total,
        tipologias,
        fenomenos: d.fenomenos ?? [],
        estructuras: d.estructuras ?? [],
        respuestas: d.respuestas ?? [],
        acciones: d.acciones ?? [],
        municipios,
        departamentos: d.departamentos ?? [],
        generos: d.generos ?? [],
        timeline: d.timeline ?? [],
        correlaciones,
        patternTemporal,
        monthlyPattern,
        riskScore: Math.min(100, Math.round((total / 100) * 1.5)),
        recomendaciones,
        municipiosByDept,
        source: 'rpc',
        partial: false,
      };

      // 🔥 RESPONDE CON HEADERS ANTI-CACHÉ
      const response = NextResponse.json(data);
      response.headers.set('Cache-Control', 'no-store, max-age=0, must-revalidate');
      response.headers.set('Pragma', 'no-cache');
      response.headers.set('Expires', '0');
      return response;
    }

    // Si la RPC devolvió error (y no es "función inexistente"), lo registramos.
    // `rpc === null` significa que se agotó el tiempo (6s) -> usamos respaldo.
    if (rpc && rpc.error && !isMissingFunction(rpc.error)) {
      console.error('RPC stats error:', rpc.error.message);
    }

    // =====================================================================
    // 2) RESPALDO: función lenta/no instalada -> muestreo acotado.
    //    El contador usa el conteo EXACTO (no el estimado del muestreo).
    // =====================================================================
    const exactCount = await exactCountPromise;
    const fallbackData = await fallbackSample(req, filters, sb, exactCount);
    
    // 🔥 RESPONDE CON HEADERS ANTI-CACHÉ TAMBIÉN PARA FALLBACK
    const response = NextResponse.json(fallbackData);
    response.headers.set('Cache-Control', 'no-store, max-age=0, must-revalidate');
    response.headers.set('Pragma', 'no-cache');
    response.headers.set('Expires', '0');
    return response;

  } catch (err: any) {
    console.error('Stats error:', err);
    const response = NextResponse.json({ error: err?.message }, { status: 500 });
    response.headers.set('Cache-Control', 'no-store, max-age=0, must-revalidate');
    response.headers.set('Pragma', 'no-cache');
    response.headers.set('Expires', '0');
    return response;
  }
}

async function fallbackSample(_req: NextRequest, filters: any, sb: ReturnType<typeof getServiceSupabase>, exactTotal?: number | null) {
  // El contador usa el conteo EXACTO calculado aparte (fresco). Solo si ese
  // fallara, recurrimos al estimado (rápido pero puede quedar desactualizado).
  let total = 0;
  if (typeof exactTotal === 'number') {
    total = exactTotal;
  } else {
    try {
      let estQuery = sb.from('intel_records').select('*', { count: 'estimated', head: true });
      estQuery = applyFilters(estQuery, filters);
      const est = await estQuery;
      total = est.count ?? 0;
    } catch { /* ignore */ }
  }

  const fieldCounts: Record<string, Record<string, number>> = {
    departamento: {}, municipio: {}, tipologia: {},
    fenomeno_criminalidad: {}, estructura: {},
    respuesta_accion: {}, accion_enemiga: {}, genero: {},
  };
  const timelineCounts: Record<string, number> = {};
  const corrCounts: Record<string, number> = {};
  const dayCounts: Record<number, number> = {};
  const monthCounts: Record<number, number> = {};
  const deptMuniMap: Record<string, Set<string>> = {};

  let sampled = 0;
  for (let b = 0; b < FALLBACK_MAX_PAGES; b += FALLBACK_PARALLEL) {
    const promises: Promise<any>[] = [];
    for (let p = b; p < Math.min(b + FALLBACK_PARALLEL, FALLBACK_MAX_PAGES); p++) {
      let q = sb.from('intel_records')
        .select('departamento, municipio, tipologia, fenomeno_criminalidad, estructura, respuesta_accion, accion_enemiga, fecha, genero')
        .range(p * PAGE_SIZE, (p + 1) * PAGE_SIZE - 1)
        .order('id', { ascending: false });
      q = applyFilters(q, filters);
      promises.push(Promise.resolve(q));
    }
    const results = await Promise.all(promises);
    let gotAny = false;
    for (const { data, error } of results) {
      if (error) { console.error('Fallback page error:', error.message); continue; }
      if (!data || data.length === 0) continue;
      gotAny = true;
      sampled += data.length;
      for (const r of data) {
        for (const field of Object.keys(fieldCounts)) {
          const val = (r as any)[field];
          if (val) {
            const raw = String(val).trim();
            if (!raw) continue;
            const nv = field === 'tipologia' ? normalizeTipologia(raw) : raw;
            if (nv) fieldCounts[field][nv] = (fieldCounts[field][nv] || 0) + 1;
          }
        }
        const dept = (r as any).departamento;
        const muni = (r as any).municipio;
        if (dept && muni) {
          if (!deptMuniMap[dept]) deptMuniMap[dept] = new Set();
          deptMuniMap[dept].add(muni);
        }
        const f = (r as any).fecha;
        if (f) {
          const fs2 = String(f);
          const ym = fs2.substring(0, 7);
          if (ym.length === 7) timelineCounts[ym] = (timelineCounts[ym] || 0) + 1;
          try {
            const dt = new Date(fs2);
            if (!isNaN(dt.getTime())) {
              dayCounts[dt.getDay()] = (dayCounts[dt.getDay()] || 0) + 1;
              monthCounts[dt.getMonth()] = (monthCounts[dt.getMonth()] || 0) + 1;
            }
          } catch {}
        }
        const fen = (r as any).fenomeno_criminalidad;
        const est = (r as any).estructura;
        if (fen && est) {
          const key = `${String(fen).trim()}|||${String(est).trim()}`;
          corrCounts[key] = (corrCounts[key] || 0) + 1;
        }
      }
    }
    if (!gotAny) break;
  }

  const topN = (map: Record<string, number>, n = 300): NC[] =>
    Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, n).map(([name, count]) => ({ name, count }));

  const timeline = Object.entries(timelineCounts)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([fecha, count]) => ({ fecha, count }));

  const correlaciones = Object.entries(corrCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([key, count]) => {
      const [fenomeno, estructura] = key.split('|||');
      return { fenomeno: fenomeno ?? '', estructura: estructura ?? '', count };
    });

  const patternTemporal = DAY_NAMES.map((label, i) => ({ label, count: dayCounts[i] || 0 }));
  const monthlyPattern = MONTH_NAMES.map((label, i) => ({ label, count: monthCounts[i] || 0 }));

  const tipologias = topN(fieldCounts.tipologia);
  const municipios = topN(fieldCounts.municipio);
  const totalForCalc = total > 0 ? total : sampled;

  const recomendaciones = buildRecomendaciones({
    total: totalForCalc, tipologias, municipios, patternTemporal, monthlyPattern, correlaciones,
    municipiosCount: Object.keys(fieldCounts.municipio).length,
  });

  const municipiosByDept: Record<string, string[]> = {};
  for (const [dept, muniSet] of Object.entries(deptMuniMap)) {
    municipiosByDept[dept] = Array.from(muniSet).sort();
  }

  const partial = sampled < totalForCalc;

  return {
    totalCount: totalForCalc,
    tipologias,
    fenomenos: topN(fieldCounts.fenomeno_criminalidad),
    estructuras: topN(fieldCounts.estructura),
    respuestas: topN(fieldCounts.respuesta_accion),
    acciones: topN(fieldCounts.accion_enemiga),
    municipios,
    departamentos: topN(fieldCounts.departamento),
    generos: topN(fieldCounts.genero),
    timeline,
    correlaciones,
    patternTemporal,
    monthlyPattern,
    riskScore: Math.min(100, Math.round((totalForCalc / 100) * 1.5)),
    recomendaciones,
    municipiosByDept,
    source: 'fallback',
    partial,
    sampled,
    setupRequired: true,
  };
}