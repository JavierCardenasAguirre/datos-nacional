export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { normalizeTipologia } from '@/lib/text-normalization';

// Fetch all distinct values with pagination (Supabase default limit is 1000)
async function fetchDistinct(table: string, field: string): Promise<string[]> {
  const set = new Set<string>();
  const pageSize = 5000;
  let from = 0;
  let hasMore = true;
  while (hasMore) {
    const { data, error } = await supabase
      .from(table)
      .select(field)
      .range(from, from + pageSize - 1)
      .order(field, { ascending: true });
    if (error || !data || data.length === 0) { hasMore = false; break; }
    for (const r of data) {
      const v = (r as any)[field];
      if (!v || !String(v).trim()) continue;
      const raw = String(v).trim();
      const normalized = field === 'tipologia' ? normalizeTipologia(raw) : raw;
      if (normalized) set.add(normalized);
    }
    from += pageSize;
    if (data.length < pageSize) hasMore = false;
  }
  return Array.from(set).sort();
}

export async function GET(req: NextRequest) {
  try {
    const [departamentos, municipios, tipologias, fenomenos, estructuras] = await Promise.all([
      fetchDistinct('intel_records', 'departamento'),
      fetchDistinct('intel_records', 'municipio'),
      fetchDistinct('intel_records', 'tipologia'),
      fetchDistinct('intel_records', 'fenomeno_criminalidad'),
      fetchDistinct('intel_records', 'estructura'),
    ]);

    return NextResponse.json({ departamentos, municipios, tipologias, fenomenos, estructuras });
  } catch (err: any) {
    console.error('Filters error:', err);
    return NextResponse.json({ error: err?.message }, { status: 500 });
  }
}
