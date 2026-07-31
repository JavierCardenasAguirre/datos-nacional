// Shared filter builder for Supabase queries
import { normalizeTipologia, tipologiaVariantsForFilter } from '@/lib/text-normalization';

export interface FilterParams {
  fechaInicio?: string;
  fechaFin?: string;
  departamento?: string;
  municipio?: string;
  tipologia?: string;
  fenomeno?: string;
  estructura?: string;
}

export function parseFilters(searchParams: URLSearchParams): FilterParams {
  const rawTipologia = searchParams.get('tipologia') || undefined;
  return {
    fechaInicio: searchParams.get('fechaInicio') || undefined,
    fechaFin: searchParams.get('fechaFin') || undefined,
    departamento: searchParams.get('departamento') || undefined,
    municipio: searchParams.get('municipio') || undefined,
    tipologia: rawTipologia ? normalizeTipologia(rawTipologia) : undefined,
    fenomeno: searchParams.get('fenomeno') || undefined,
    estructura: searchParams.get('estructura') || undefined,
  };
}

export function applyFilters(query: any, filters: FilterParams) {
  if (filters.fechaInicio) query = query.gte('fecha', filters.fechaInicio);
  if (filters.fechaFin) query = query.lte('fecha', filters.fechaFin);
  if (filters.departamento) query = query.eq('departamento', filters.departamento);
  if (filters.municipio) query = query.eq('municipio', filters.municipio);
  if (filters.tipologia) {
    const variants = tipologiaVariantsForFilter(filters.tipologia);
    query = variants.length > 1 ? query.in('tipologia', variants) : query.eq('tipologia', variants[0] ?? filters.tipologia);
  }
  if (filters.fenomeno) query = query.eq('fenomeno_criminalidad', filters.fenomeno);
  if (filters.estructura) query = query.eq('estructura', filters.estructura);
  return query;
}

export function buildFilterSQL(filters: FilterParams): { where: string; params: any[] } {
  const conditions: string[] = [];
  const params: any[] = [];
  let idx = 1;

  if (filters.fechaInicio) { conditions.push(`fecha >= $${idx}`); params.push(filters.fechaInicio); idx++; }
  if (filters.fechaFin) { conditions.push(`fecha <= $${idx}`); params.push(filters.fechaFin); idx++; }
  if (filters.departamento) { conditions.push(`departamento = $${idx}`); params.push(filters.departamento); idx++; }
  if (filters.municipio) { conditions.push(`municipio = $${idx}`); params.push(filters.municipio); idx++; }
  if (filters.tipologia) {
    const variants = tipologiaVariantsForFilter(filters.tipologia);
    if (variants.length > 1) {
      conditions.push(`tipologia = ANY($${idx})`);
      params.push(variants);
    } else {
      conditions.push(`tipologia = $${idx}`);
      params.push(variants[0] ?? filters.tipologia);
    }
    idx++;
  }
  if (filters.fenomeno) { conditions.push(`fenomeno_criminalidad = $${idx}`); params.push(filters.fenomeno); idx++; }
  if (filters.estructura) { conditions.push(`estructura = $${idx}`); params.push(filters.estructura); idx++; }

  const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
  return { where, params };
}
