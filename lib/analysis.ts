import type { IntelRecord } from '@/contexts/intel-context';

export interface AnalysisResult {
  topMunicipios: { name: string; count: number }[];
  topTipologias: { name: string; count: number }[];
  patternTemporal: { label: string; count: number }[];
  monthlyPattern: { label: string; count: number }[];
  correlaciones: { fenomeno: string; estructura: string; count: number }[];
  recomendaciones: string[];
  riskScore: number;
}

function countBy(records: IntelRecord[], key: keyof IntelRecord): Record<string, number> {
  const map: Record<string, number> = {};
  for (const r of (records ?? [])) {
    const val = String((r as any)?.[key] ?? '').trim();
    if (val) map[val] = (map[val] ?? 0) + 1;
  }
  return map;
}

function topN(map: Record<string, number>, n: number): { name: string; count: number }[] {
  return Object.entries(map ?? {})
    .sort((a: any, b: any) => (b?.[1] ?? 0) - (a?.[1] ?? 0))
    .slice(0, n)
    .map(([name, count]: any) => ({ name: name ?? '', count: count ?? 0 }));
}

export function analyzeData(records: IntelRecord[]): AnalysisResult {
  const safeRecords = records ?? [];
  const total = safeRecords?.length ?? 0;

  const municipioMap = countBy(safeRecords, 'municipio');
  const tipologiaMap = countBy(safeRecords, 'tipologia');

  const topMunicipios = topN(municipioMap, 5);
  const topTipologias = topN(tipologiaMap, 5);

  // Day of week pattern
  const dayNames = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  const dayMap: Record<string, number> = {};
  for (const name of dayNames) dayMap[name] = 0;
  for (const r of safeRecords) {
    try {
      const d = new Date(r?.fecha ?? '');
      if (!isNaN(d.getTime())) {
        const day = dayNames[d.getDay()] ?? 'Desconocido';
        dayMap[day] = (dayMap[day] ?? 0) + 1;
      }
    } catch { /* skip */ }
  }
  const patternTemporal = dayNames.map((name: string) => ({ label: name, count: dayMap[name] ?? 0 }));

  // Monthly pattern
  const monthNames = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  const monthMap: Record<string, number> = {};
  for (const name of monthNames) monthMap[name] = 0;
  for (const r of safeRecords) {
    try {
      const d = new Date(r?.fecha ?? '');
      if (!isNaN(d.getTime())) {
        const month = monthNames[d.getMonth()] ?? 'Ene';
        monthMap[month] = (monthMap[month] ?? 0) + 1;
      }
    } catch { /* skip */ }
  }
  const monthlyPattern = monthNames.map((name: string) => ({ label: name, count: monthMap[name] ?? 0 }));

  // Correlations
  const corrMap: Record<string, number> = {};
  for (const r of safeRecords) {
    const key = `${r?.fenomenoCriminalidad ?? ''}|||${r?.estructura ?? ''}`;
    corrMap[key] = (corrMap[key] ?? 0) + 1;
  }
  const correlaciones = Object.entries(corrMap ?? {})
    .sort((a: any, b: any) => (b?.[1] ?? 0) - (a?.[1] ?? 0))
    .slice(0, 10)
    .map(([key, count]: any) => {
      const parts = (key ?? '').split('|||');
      return { fenomeno: parts?.[0] ?? '', estructura: parts?.[1] ?? '', count: count ?? 0 };
    });

  // Risk score
  const riskScore = Math.min(100, Math.round((total / 100) * 1.5));

  // Recommendations
  const recomendaciones: string[] = [];
  if ((topMunicipios?.[0]?.count ?? 0) > total * 0.2) {
    recomendaciones.push(`[ALERTA ALTA] ${topMunicipios?.[0]?.name ?? 'N/A'} concentra ${((topMunicipios?.[0]?.count ?? 0) / total * 100)?.toFixed?.(1) ?? '0'}% de los incidentes. Se recomienda reforzar presencia militar.`);
  }
  if ((topTipologias?.[0]?.count ?? 0) > 0) {
    recomendaciones.push(`[TIPOLOGIA] Tipologia predominante: "${topTipologias?.[0]?.name ?? 'N/A'}" con ${topTipologias?.[0]?.count ?? 0} casos. Priorizar recursos para esta categoria.`);
  }
  const maxDay = patternTemporal?.reduce((a: any, b: any) => ((a?.count ?? 0) > (b?.count ?? 0) ? a : b), patternTemporal?.[0]);
  if (maxDay) {
    recomendaciones.push(`[PATRON] Mayor actividad los dias ${maxDay?.label ?? 'N/A'} (${maxDay?.count ?? 0} incidentes). Incrementar operaciones preventivas.`);
  }
  const maxMonth = monthlyPattern?.reduce((a: any, b: any) => ((a?.count ?? 0) > (b?.count ?? 0) ? a : b), monthlyPattern?.[0]);
  if (maxMonth) {
    recomendaciones.push(`[TEMPORAL] Mes con mayor actividad: ${maxMonth?.label ?? 'N/A'} (${maxMonth?.count ?? 0} incidentes).`);
  }
  if ((correlaciones?.[0]?.count ?? 0) > 0) {
    recomendaciones.push(`[CORRELACION] Correlacion mas fuerte: "${correlaciones?.[0]?.fenomeno ?? ''}" vinculado a "${correlaciones?.[0]?.estructura ?? ''}" (${correlaciones?.[0]?.count ?? 0} casos).`);
  }
  recomendaciones.push(`[RESUMEN] Total de ${total} incidentes registrados en ${Object.keys(municipioMap ?? {})?.length ?? 0} municipios.`);

  return {
    topMunicipios,
    topTipologias,
    patternTemporal,
    monthlyPattern,
    correlaciones,
    recomendaciones,
    riskScore,
  };
}
