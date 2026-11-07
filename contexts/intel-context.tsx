'use client';

import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';

// ---- Types ----
export interface IntelRecord {
  id: number;
  departamento: string;
  municipio: string;
  vereda: string;
  latGrados: number;
  latMinutos: number;
  latSegundos: number;
  lonGrados: number;
  lonMinutos: number;
  lonSegundos: number;
  latitud: number;
  longitud: number;
  fecha: string;
  tipologia: string;
  informacionHecho: string;
  fenomenoCriminalidad: string;
  medios: string;
  genero: string;
  estructura: string;
  respuestaAccion: string;
  accionEnemiga: string;
  resTipo: string;
}

export interface Filters {
  fechaInicio: string;
  fechaFin: string;
  departamento: string;
  municipio: string;
  tipologia: string;
  fenomeno: string;
  estructura: string;
}

export interface NameCount {
  name: string;
  count: number;
}

export interface StatsData {
  totalCount: number;
  tipologias: NameCount[];
  fenomenos: NameCount[];
  estructuras: NameCount[];
  respuestas: NameCount[];
  acciones: NameCount[];
  municipios: NameCount[];
  departamentos: NameCount[];
  generos: NameCount[];
  timeline: { fecha: string; count: number }[];
  correlaciones: { fenomeno: string; estructura: string; count: number }[];
  patternTemporal: { label: string; count: number }[];
  monthlyPattern: { label: string; count: number }[];
  riskScore: number;
  recomendaciones: string[];
  municipiosByDept: Record<string, string[]>;
  // Estado de la respuesta: 'rpc' = totales EXACTOS (función SQL); 'fallback' =
  // muestreo parcial (la función SQL no respondió a tiempo -> números por debajo
  // de lo real). Se usa para advertir en pantalla y no presentar cifras
  // parciales como definitivas.
  source?: 'rpc' | 'fallback';
  partial?: boolean;
  setupRequired?: boolean;
  truncatedByTimeBudget?: boolean;
  sampled?: number;
}

export interface MapPoint {
  id: number;
  latitud: number;
  longitud: number;
  departamento: string;
  municipio: string;
  tipologia: string;
  fecha: string;
  estructura: string;
  fenomeno_criminalidad: string;
  informacion_hecho: string;
}

export interface UniqueValues {
  departamentos: string[];
  municipios: string[];
  municipiosByDept: Record<string, string[]>;
  tipologias: string[];
  fenomenos: string[];
  estructuras: string[];
}

interface IntelContextType {
  isDataLoaded: boolean;
  isLoading: boolean;
  filters: Filters;
  setFilters: (filters: Filters) => void;
  stats: StatsData | null;
  mapPoints: MapPoint[];
  mapInfo: { total: number; displayed: number };
  uniqueValues: UniqueValues;
  destroyData: () => Promise<void>;
  refreshData: () => Promise<void>;
  refreshStats: () => Promise<StatsData | null>;
  forceUpdateCounter: () => Promise<StatsData | null>; // 👈 NUEVA FUNCIÓN
}

// ---- Defaults ----
const defaultFilters: Filters = {
  fechaInicio: '', fechaFin: '', departamento: '',
  municipio: '', tipologia: '', fenomeno: '', estructura: '',
};

const emptyUniqueValues: UniqueValues = {
  departamentos: [], municipios: [], municipiosByDept: {},
  tipologias: [], fenomenos: [], estructuras: [],
};

const IntelContext = createContext<IntelContextType | null>(null);

// Marca local "ya hay datos en la nube". Sirve para que, al refrescar, la app
// vaya directo al dashboard aunque la verificación del servidor tarde o falle
// (p. ej. justo después de importar 500k filas la base queda ocupada un rato).
const HAS_DATA_KEY = 'datacore_has_data';
function setHasDataHint(v: boolean) {
  try {
    if (v) localStorage.setItem(HAS_DATA_KEY, '1');
    else localStorage.removeItem(HAS_DATA_KEY);
  } catch { /* modo privado / sin storage */ }
}
function getHasDataHint(): boolean {
  try { return localStorage.getItem(HAS_DATA_KEY) === '1'; } catch { return false; }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Consulta /api/intel/count. Devuelve true/false, o null si no se pudo saber. */
async function checkHasData(timeoutMs = 20000): Promise<boolean | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`/api/intel/count?_=${Date.now()}`, { cache: 'no-store', signal: controller.signal });
    if (!res.ok) return null;
    const data = await res.json();
    if (typeof data?.hasData === 'boolean') return data.hasData;
    if (typeof data?.count === 'number') return data.count > 0;
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function buildParams(f: Filters): string {
  const p = new URLSearchParams();
  if (f.fechaInicio) p.set('fechaInicio', f.fechaInicio);
  if (f.fechaFin) p.set('fechaFin', f.fechaFin);
  if (f.departamento) p.set('departamento', f.departamento);
  if (f.municipio) p.set('municipio', f.municipio);
  if (f.tipologia) p.set('tipologia', f.tipologia);
  if (f.fenomeno) p.set('fenomeno', f.fenomeno);
  if (f.estructura) p.set('estructura', f.estructura);
  return p.toString();
}

function deriveUniqueValues(stats: StatsData): UniqueValues {
  return {
    departamentos: (stats.departamentos ?? []).map(d => d.name),
    municipios: (stats.municipios ?? []).map(m => m.name),
    municipiosByDept: stats.municipiosByDept ?? {},
    tipologias: (stats.tipologias ?? []).map(t => t.name),
    fenomenos: (stats.fenomenos ?? []).map(f => f.name),
    estructuras: (stats.estructuras ?? []).map(e => e.name),
  };
}

async function parseJsonResponse<T>(response: Response, endpoint: string): Promise<T> {
  const raw = await response.text();

  if (!response.ok) {
    const shortBody = raw.slice(0, 220);
    throw new Error(`${endpoint} HTTP ${response.status}: ${shortBody}`);
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    const shortBody = raw.slice(0, 220);
    throw new Error(`${endpoint} devolvió una respuesta no JSON: ${shortBody}`);
  }
}

export function IntelProvider({ children }: { children: React.ReactNode }) {
  const [isDataLoaded, setIsDataLoaded] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [filters, setFiltersRaw] = useState<Filters>(defaultFilters);
  const [stats, setStats] = useState<StatsData | null>(null);
  const [mapPoints, setMapPoints] = useState<MapPoint[]>([]);
  const [mapInfo, setMapInfo] = useState({ total: 0, displayed: 0 });
  const [uniqueValues, setUniqueValues] = useState<UniqueValues>(emptyUniqueValues);
  const abortRef = useRef<AbortController | null>(null);
  const hasChecked = useRef(false);

  // Load stats + map for given filters
  const loadData = useCallback(async (f: Filters, isInitial: boolean = false) => {
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setIsLoading(true);

    // Reintentos: tras una importación grande la base puede tardar en responder
    // (o la función de Vercel cortar por tiempo). En vez de dejar el dashboard en
    // 0, se reintenta con espera creciente.
    const MAX_ATTEMPTS = isInitial ? 4 : 2;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const params = buildParams(f);
      const timestamp = Date.now();
      const [statsRes, mapRes] = await Promise.all([
        fetch(`/api/intel/stats?${params}&_=${timestamp}`, { 
          signal: controller.signal,
          cache: 'no-store',
          headers: { 
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
          },
        }),
        fetch(`/api/intel/map-points?${params}&_=${timestamp}`, { 
          signal: controller.signal,
          cache: 'no-store',
          headers: { 
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
          },
        }),
      ]);
      if (controller.signal.aborted) return;

      const statsData = await parseJsonResponse<StatsData>(statsRes, '/api/intel/stats');
      const mapData = await parseJsonResponse<{ points?: MapPoint[]; total?: number; displayed?: number }>(mapRes, '/api/intel/map-points');
      if (controller.signal.aborted) return;

      // Sin filtros, un total 0 con puntos en el mapa = respuesta incompleta: reintentar
      const noFilters = buildParams(f) === '';
      const looksEmpty = (statsData?.totalCount ?? 0) <= 0 && (mapData.points?.length ?? 0) > 0;
      if (noFilters && looksEmpty && attempt < MAX_ATTEMPTS) {
        throw new Error('Totales aún no disponibles');
      }

      setStats(statsData);
      setMapPoints(mapData.points ?? []);
      setMapInfo({ total: mapData.total ?? 0, displayed: mapData.displayed ?? 0 });

      if (isInitial) {
        setUniqueValues(deriveUniqueValues(statsData));
      }
      if (noFilters && ((statsData?.totalCount ?? 0) > 0 || (mapData.points?.length ?? 0) > 0)) {
        setHasDataHint(true);
      }
      break;
    } catch (err: any) {
      if (err?.name === 'AbortError' || controller.signal.aborted) return;
      console.error(`Load data error (intento ${attempt}/${MAX_ATTEMPTS}):`, err);
      if (attempt < MAX_ATTEMPTS) {
        await sleep(2000 * attempt);
        if (controller.signal.aborted) return;
      }
    }
    }
    if (!controller.signal.aborted) setIsLoading(false);
  }, []);

  // 🔥 REFRESH STATS MEJORADO CON TIMESTAMP
  const refreshStats = useCallback(async (): Promise<StatsData | null> => {
    try {
      const params = buildParams(filters);
      const timestamp = Date.now();
      console.log('🔄 Refrescando stats con timestamp:', timestamp);
      
      const response = await fetch(`/api/intel/stats?${params}&_=${timestamp}`, {
        cache: 'no-store',
        headers: { 
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
        },
      });

      const statsData = await parseJsonResponse<StatsData>(response, '/api/intel/stats');
      console.log('📊 Stats actualizados:', statsData.totalCount);
      setStats(statsData);
      setUniqueValues(deriveUniqueValues(statsData));
      return statsData;
    } catch (error) {
      console.error('❌ Error refreshing stats:', error);
      return null;
    }
  }, [filters]);

  // 🔥 NUEVA FUNCIÓN: Forzar actualización del contador sin resetear filtros
  const forceUpdateCounter = useCallback(async (): Promise<StatsData | null> => {
    try {
      const params = buildParams(filters);
      const timestamp = Date.now();
      console.log('🔄 Forzando actualización del contador...', timestamp);
      
      const response = await fetch(`/api/intel/stats?${params}&_=${timestamp}`, {
        cache: 'no-store',
        headers: { 
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
        },
      });

      const statsData = await parseJsonResponse<StatsData>(response, '/api/intel/stats');
      console.log('📊 Contador actualizado:', statsData.totalCount);
      setStats(statsData);
      setUniqueValues(deriveUniqueValues(statsData));
      return statsData;
    } catch (error) {
      console.error('❌ Error forzando actualización:', error);
      return null;
    }
  }, [filters]);

  // Check for existing data on mount
  useEffect(() => {
    if (hasChecked.current) return;
    hasChecked.current = true;

    (async () => {
      // Si este navegador ya importó/vio datos, ir directo al dashboard
      // mientras se confirma con el servidor.
      const hint = getHasDataHint();
      if (hint) {
        setIsDataLoaded(true);
        loadData(defaultFilters, true);
      }

      let hasData = await checkHasData();
      if (hasData === null) {
        await sleep(3000);
        hasData = await checkHasData();
      }

      if (hasData === true) {
        setHasDataHint(true);
        if (!hint) {
          setIsDataLoaded(true);
          await loadData(defaultFilters, true);
        }
      } else if (hasData === false) {
        // Confirmado por el servidor: la tabla está vacía
        setHasDataHint(false);
        setIsDataLoaded(false);
        setStats(null);
        setIsLoading(false);
      } else {
        // No se pudo verificar (servidor lento/caído). No mandamos al usuario a
        // reimportar: si había marca local seguimos en el dashboard.
        console.error('No se pudo verificar si hay datos en la base.');
        if (!hint) setIsLoading(false);
      }
    })();
  }, [loadData]);

  const setFilters = useCallback((newFilters: Filters) => {
    setFiltersRaw(newFilters);
    loadData(newFilters, false);
  }, [loadData]);

  const refreshData = useCallback(async () => {
    setHasDataHint(true);
    setIsDataLoaded(true);
    setFiltersRaw(defaultFilters);
    await loadData(defaultFilters, true);
  }, [loadData]);

  const destroyData = useCallback(async () => {
    await fetch('/api/intel/destroy', { method: 'DELETE' });
    setHasDataHint(false);
    setIsDataLoaded(false);
    setStats(null);
    setMapPoints([]);
    setMapInfo({ total: 0, displayed: 0 });
    setUniqueValues(emptyUniqueValues);
    setFiltersRaw(defaultFilters);
  }, []);

  return (
    <IntelContext.Provider value={{
      isDataLoaded, isLoading, filters, setFilters,
      stats, mapPoints, mapInfo, uniqueValues,
      destroyData, refreshData,
      refreshStats,
      forceUpdateCounter, // 👈 EXPORTAMOS LA NUEVA FUNCIÓN
    }}>
      {children}
    </IntelContext.Provider>
  );
}

export function useIntel() {
  const context = useContext(IntelContext);
  if (!context) throw new Error('useIntel must be used within IntelProvider');
  return context;
}