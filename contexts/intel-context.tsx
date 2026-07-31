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

      setStats(statsData);
      setMapPoints(mapData.points ?? []);
      setMapInfo({ total: mapData.total ?? 0, displayed: mapData.displayed ?? 0 });

      if (isInitial) {
        setUniqueValues(deriveUniqueValues(statsData));
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      console.error('Load data error:', err);
    } finally {
      if (!controller.signal.aborted) setIsLoading(false);
    }
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
      try {
        const res = await fetch('/api/intel/count');
        const data = await res.json();
        if ((data?.count ?? 0) > 0) {
          setIsDataLoaded(true);
          await loadData(defaultFilters, true);
        } else {
          setIsLoading(false);
        }
      } catch (err) {
        console.error('Check data error:', err);
        setIsLoading(false);
      }
    })();
  }, [loadData]);

  const setFilters = useCallback((newFilters: Filters) => {
    setFiltersRaw(newFilters);
    loadData(newFilters, false);
  }, [loadData]);

  const refreshData = useCallback(async () => {
    setIsDataLoaded(true);
    setFiltersRaw(defaultFilters);
    await loadData(defaultFilters, true);
  }, [loadData]);

  const destroyData = useCallback(async () => {
    await fetch('/api/intel/destroy', { method: 'DELETE' });
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