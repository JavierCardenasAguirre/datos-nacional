'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Loader2, Search, Users, CalendarRange, Filter, MapPin,
  ShieldAlert, Crosshair, Building2, ChevronLeft, ChevronRight,
} from 'lucide-react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell,
  LineChart, Line,
} from 'recharts';

interface NameCount {
  name: string;
  count: number;
}

interface EnemyStats {
  estructura: string;
  totalCount: number;
  tipologias: NameCount[];
  departamentos: NameCount[];
  municipios: NameCount[];
  timeline: { fecha: string; count: number }[];
  minFecha: string | null;
  maxFecha: string | null;
  source?: string;
}

interface EnemyRecord {
  id: number;
  fecha: string;
  departamento: string;
  municipio: string;
  vereda: string;
  tipologia: string;
  fenomeno_criminalidad: string;
  estructura: string;
  informacion_hecho: string;
  latitud: number;
  longitud: number;
}

interface EnemyMapPoint {
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

interface EnemyFilters {
  fechaInicio: string;
  fechaFin: string;
  departamento: string;
  municipio: string;
  tipologia: string;
  evento: string;
}

const defaultFilters: EnemyFilters = {
  fechaInicio: '',
  fechaFin: '',
  departamento: '',
  municipio: '',
  tipologia: '',
  evento: '',
};

const COLORS = ['#06b6d4', '#ef4444', '#22c55e', '#f97316', '#a855f7', '#eab308', '#ec4899', '#60a5fa'];

function buildQuery(estructura: string, filters: EnemyFilters, page = 1, pageSize = 50) {
  const p = new URLSearchParams();
  if (estructura) p.set('estructura', estructura);
  if (filters.fechaInicio) p.set('fechaInicio', filters.fechaInicio);
  if (filters.fechaFin) p.set('fechaFin', filters.fechaFin);
  if (filters.departamento) p.set('departamento', filters.departamento);
  if (filters.municipio) p.set('municipio', filters.municipio);
  if (filters.tipologia) p.set('tipologia', filters.tipologia);
  if (filters.evento) p.set('evento', filters.evento);
  p.set('page', String(page));
  p.set('pageSize', String(pageSize));
  p.set('_', String(Date.now()));
  return p.toString();
}

function MiniMap({ points }: { points: EnemyMapPoint[] }) {
  const [ready, setReady] = useState(false);
  const [L, setL] = useState<any>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const layerRef = useRef<any>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const leafletModule = await import('leaflet');
      if (cancelled) return;
      const leaflet = leafletModule.default || leafletModule;
      setL(leaflet);

      if (!document.querySelector('link[data-leaflet-css]')) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.setAttribute('data-leaflet-css', 'true');
        link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
        document.head.appendChild(link);
      }

      const el = containerRef.current;
      if (!el || mapRef.current) return;

      mapRef.current = leaflet.map(el, {
        center: [5.0, -74.0],
        zoom: 6,
        zoomControl: true,
        attributionControl: false,
        preferCanvas: true,
      });
      const osmUrl = ['https:/', '/{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'].join('');
      leaflet.tileLayer(osmUrl, { maxZoom: 19 }).addTo(mapRef.current);
      setReady(true);
    })();

    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        layerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!ready || !mapRef.current || !L) return;
    if (layerRef.current) mapRef.current.removeLayer(layerRef.current);
    const group = L.layerGroup();

    const valid = (points ?? []).filter((pt) => Number.isFinite(pt.latitud) && Number.isFinite(pt.longitud));
    for (const pt of valid) {
      const marker = L.circleMarker([pt.latitud, pt.longitud], {
        radius: 4,
        color: '#06b6d4',
        fillColor: '#06b6d4',
        fillOpacity: 0.55,
        weight: 1,
      });
      marker.bindPopup(
        `<div style="font-size:11px;line-height:1.3">
          <b>${pt.municipio ?? 'N/A'} (${pt.departamento ?? 'N/A'})</b><br/>
          <span><b>Fecha:</b> ${pt.fecha ?? 'N/A'}</span><br/>
          <span><b>Tipología:</b> ${pt.tipologia ?? 'N/A'}</span><br/>
          <span><b>Estructura:</b> ${pt.estructura ?? 'N/A'}</span>
        </div>`
      );
      group.addLayer(marker);
    }

    group.addTo(mapRef.current);
    layerRef.current = group;

    if (valid.length > 0) {
      const coords = valid.slice(0, 3000).map((v) => [v.latitud, v.longitud] as [number, number]);
      try {
        mapRef.current.fitBounds(L.latLngBounds(coords), { padding: [20, 20], maxZoom: 11 });
      } catch {
        // ignore
      }
    }
  }, [points, ready, L]);

  return (
    <div className="w-full h-full relative">
      {!ready && (
        <div className="absolute inset-0 flex items-center justify-center text-cyan-400 text-xs z-10 bg-slate-900/40">
          <Loader2 className="w-4 h-4 animate-spin mr-2" /> Cargando mapa...
        </div>
      )}
      <div ref={(el) => { containerRef.current = el; }} className="w-full h-full" />
    </div>
  );
}

export default function EnemigoPanel() {
  const [estructuras, setEstructuras] = useState<NameCount[]>([]);
  const [estructuraSearch, setEstructuraSearch] = useState('');
  const [selectedEstructura, setSelectedEstructura] = useState('');

  const [filters, setFilters] = useState<EnemyFilters>(defaultFilters);
  const [stats, setStats] = useState<EnemyStats | null>(null);
  const [records, setRecords] = useState<EnemyRecord[]>([]);
  const [mapPoints, setMapPoints] = useState<EnemyMapPoint[]>([]);

  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalRecords, setTotalRecords] = useState(0);

  const [loadingList, setLoadingList] = useState(true);
  const [loadingData, setLoadingData] = useState(false);
  const [error, setError] = useState('');

  const loadEstructuras = useCallback(async (search: string) => {
    setLoadingList(true);
    try {
      const p = new URLSearchParams();
      p.set('mode', 'estructuras');
      p.set('limit', '250');
      if (search.trim()) p.set('search', search.trim());
      p.set('_', String(Date.now()));

      const res = await fetch(`/api/intel/enemigo?${p.toString()}`, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? 'No se pudo cargar estructuras');

      const items = Array.isArray(data?.items) ? data.items : [];
      setEstructuras(items);
      if (!selectedEstructura && items.length > 0) {
        setSelectedEstructura(items[0].name);
      }
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setLoadingList(false);
    }
  }, [selectedEstructura]);

  const loadStatsAndMap = useCallback(async (estructura: string, f: EnemyFilters) => {
    if (!estructura) return;
    setLoadingData(true);
    setError('');
    try {
      const common = buildQuery(estructura, f, 1, 50);

      const [statsRes, mapRes] = await Promise.all([
        fetch(`/api/intel/enemigo?mode=stats&${common}`, { cache: 'no-store' }),
        fetch(`/api/intel/enemigo?mode=map&${common}`, { cache: 'no-store' }),
      ]);

      const statsJson = await statsRes.json();
      const mapJson = await mapRes.json();

      if (!statsRes.ok) throw new Error(statsJson?.error ?? 'No se pudo cargar estadísticas de enemigo');
      if (!mapRes.ok) throw new Error(mapJson?.error ?? 'No se pudo cargar mapa de enemigo');

      setStats(statsJson);
      setMapPoints(mapJson?.points ?? []);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setLoadingData(false);
    }
  }, []);

  const loadRecords = useCallback(async (estructura: string, f: EnemyFilters, pageNum: number) => {
    if (!estructura) return;
    try {
      const q = buildQuery(estructura, f, pageNum, 50);
      const res = await fetch(`/api/intel/enemigo?mode=records&${q}`, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? 'No se pudo cargar registros');
      setRecords(data?.records ?? []);
      setTotalPages(Number(data?.totalPages ?? 1));
      setTotalRecords(Number(data?.total ?? 0));
    } catch (e: any) {
      setError(String(e?.message ?? e));
    }
  }, []);

  useEffect(() => {
    loadEstructuras('');
  }, [loadEstructuras]);

  useEffect(() => {
    const t = setTimeout(() => loadEstructuras(estructuraSearch), 250);
    return () => clearTimeout(t);
  }, [estructuraSearch, loadEstructuras]);

  useEffect(() => {
    if (!selectedEstructura) return;
    setPage(1);
    loadStatsAndMap(selectedEstructura, filters);
    loadRecords(selectedEstructura, filters, 1);
  }, [selectedEstructura, filters, loadStatsAndMap, loadRecords]);

  useEffect(() => {
    if (!selectedEstructura) return;
    loadRecords(selectedEstructura, filters, page);
  }, [page, selectedEstructura, filters, loadRecords]);

  const municipiosFiltrados = useMemo(() => {
    const list = stats?.municipios ?? [];
    return list.map((x) => x.name);
  }, [stats?.municipios]);

  const tipologias = useMemo(() => (stats?.tipologias ?? []).map((x) => x.name), [stats?.tipologias]);
  const departamentos = useMemo(() => (stats?.departamentos ?? []).map((x) => x.name), [stats?.departamentos]);

  return (
    <div className="space-y-4">
      <div className="bg-slate-800/70 border border-slate-600/30 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <ShieldAlert className="w-5 h-5 text-cyan-400" />
          <h2 className="text-cyan-300 font-bold tracking-wide">SECCIÓN ENEMIGO</h2>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <div className="lg:col-span-1">
            <label className="text-[11px] text-slate-400 block mb-1">Buscar estructura</label>
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2 top-2" />
              <input
                value={estructuraSearch}
                onChange={(e) => setEstructuraSearch(e.target.value)}
                placeholder="GAO, organización, bloque..."
                className="w-full bg-slate-900/70 border border-slate-600/40 rounded-md pl-7 pr-2 py-1.5 text-xs text-slate-200"
              />
            </div>
          </div>

          <div className="lg:col-span-2">
            <label className="text-[11px] text-slate-400 block mb-1">Estructura seleccionada</label>
            <select
              value={selectedEstructura}
              onChange={(e) => setSelectedEstructura(e.target.value)}
              className="w-full bg-slate-900/70 border border-slate-600/40 rounded-md px-2 py-1.5 text-xs text-slate-200"
            >
              <option value="">Seleccione...</option>
              {estructuras.map((e) => (
                <option key={e.name} value={e.name}>{e.name} ({e.count.toLocaleString()})</option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-6 gap-2 mt-3">
          <InputDate label="Desde" value={filters.fechaInicio} onChange={(v) => setFilters((p) => ({ ...p, fechaInicio: v }))} />
          <InputDate label="Hasta" value={filters.fechaFin} onChange={(v) => setFilters((p) => ({ ...p, fechaFin: v }))} />
          <SelectInput label="Departamento" value={filters.departamento} options={departamentos} onChange={(v) => setFilters((p) => ({ ...p, departamento: v, municipio: '' }))} />
          <SelectInput label="Municipio" value={filters.municipio} options={municipiosFiltrados} onChange={(v) => setFilters((p) => ({ ...p, municipio: v }))} />
          <SelectInput label="Tipología" value={filters.tipologia} options={tipologias} onChange={(v) => setFilters((p) => ({ ...p, tipologia: v }))} />
          <div>
            <label className="text-[11px] text-slate-400 block mb-1">Evento (texto)</label>
            <input
              value={filters.evento}
              onChange={(e) => setFilters((p) => ({ ...p, evento: e.target.value }))}
              placeholder="palabra clave"
              className="w-full bg-slate-900/70 border border-slate-600/40 rounded-md px-2 py-1.5 text-xs text-slate-200"
            />
          </div>
        </div>

        <div className="mt-2">
          <button
            onClick={() => setFilters(defaultFilters)}
            className="text-xs bg-slate-700/60 hover:bg-slate-600/60 text-slate-200 px-2 py-1 rounded-md inline-flex items-center gap-1"
          >
            <Filter className="w-3 h-3" /> Limpiar filtros
          </button>
        </div>
      </div>

      {loadingList && (
        <div className="text-xs text-cyan-400 flex items-center gap-2"><Loader2 className="w-3 h-3 animate-spin" /> Cargando estructuras...</div>
      )}

      {error && <div className="text-xs text-red-400 bg-red-900/20 border border-red-700/40 rounded-md p-2">{error}</div>}

      {selectedEstructura && stats && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiCard icon={<Users className="w-4 h-4 text-cyan-400" />} label="Total eventos" value={stats.totalCount.toLocaleString()} />
            <KpiCard icon={<Crosshair className="w-4 h-4 text-red-400" />} label="Tipologías" value={String(stats.tipologias.length)} />
            <KpiCard icon={<Building2 className="w-4 h-4 text-emerald-400" />} label="Departamentos" value={String(stats.departamentos.length)} />
            <KpiCard icon={<CalendarRange className="w-4 h-4 text-purple-400" />} label="Rango" value={`${stats.minFecha ?? 'N/A'} → ${stats.maxFecha ?? 'N/A'}`} />
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
            <ChartCard title="Top tipologías">
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={(stats.tipologias ?? []).slice(0, 12)} layout="vertical" margin={{ top: 5, right: 10, left: 5, bottom: 5 }}>
                  <XAxis type="number" tick={{ fontSize: 10, fill: '#94a3b8' }} />
                  <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 9, fill: '#cbd5e1' }} />
                  <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8 }} />
                  <Bar dataKey="count">
                    {(stats.tipologias ?? []).slice(0, 12).map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Top departamentos">
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={(stats.departamentos ?? []).slice(0, 12)} margin={{ top: 5, right: 10, left: 5, bottom: 35 }}>
                  <XAxis dataKey="name" tick={{ fontSize: 9, fill: '#cbd5e1' }} angle={-30} textAnchor="end" interval={0} height={50} />
                  <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} />
                  <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8 }} />
                  <Bar dataKey="count">
                    {(stats.departamentos ?? []).slice(0, 12).map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Evolución temporal">
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={stats.timeline ?? []} margin={{ top: 5, right: 10, left: 5, bottom: 35 }}>
                  <XAxis dataKey="fecha" tick={{ fontSize: 9, fill: '#cbd5e1' }} angle={-30} textAnchor="end" interval="preserveStartEnd" height={50} />
                  <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} />
                  <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8 }} />
                  <Line dataKey="count" stroke="#22d3ee" strokeWidth={2} dot={{ r: 2 }} />
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>

          <div className="bg-slate-800/70 border border-slate-600/30 rounded-xl p-3">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm text-cyan-300 font-semibold flex items-center gap-2"><MapPin className="w-4 h-4" /> Mapa de eventos ({mapPoints.length.toLocaleString()})</h3>
              {loadingData && <Loader2 className="w-4 h-4 animate-spin text-cyan-400" />}
            </div>
            <div className="h-[320px] rounded-lg overflow-hidden border border-slate-700/50 bg-slate-900/40">
              <MiniMap points={mapPoints} />
            </div>
          </div>

          <div className="bg-slate-800/70 border border-slate-600/30 rounded-xl overflow-hidden">
            <div className="p-3 border-b border-slate-600/30 flex items-center justify-between">
              <h3 className="text-sm text-cyan-300 font-semibold">Registros filtrados</h3>
              <span className="text-xs text-slate-400">{totalRecords.toLocaleString()} total</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-slate-900/60 text-slate-400">
                  <tr>
                    <th className="text-left px-2 py-2">Fecha</th>
                    <th className="text-left px-2 py-2">Departamento</th>
                    <th className="text-left px-2 py-2">Municipio</th>
                    <th className="text-left px-2 py-2">Tipología</th>
                    <th className="text-left px-2 py-2">Fenómeno</th>
                    <th className="text-left px-2 py-2">Evento</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((r) => (
                    <tr key={r.id} className="border-t border-slate-700/40 text-slate-200 align-top">
                      <td className="px-2 py-2 whitespace-nowrap">{r.fecha || 'N/A'}</td>
                      <td className="px-2 py-2 whitespace-nowrap">{r.departamento || 'N/A'}</td>
                      <td className="px-2 py-2 whitespace-nowrap">{r.municipio || 'N/A'}</td>
                      <td className="px-2 py-2 whitespace-nowrap">{r.tipologia || 'N/A'}</td>
                      <td className="px-2 py-2 whitespace-nowrap">{r.fenomeno_criminalidad || 'N/A'}</td>
                      <td className="px-2 py-2 max-w-[460px]">{(r.informacion_hecho || '').slice(0, 220)}</td>
                    </tr>
                  ))}
                  {records.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-3 py-6 text-center text-slate-500">No hay registros para los filtros actuales.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="p-2 border-t border-slate-600/30 flex items-center justify-between text-xs">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="px-2 py-1 rounded bg-slate-700/60 text-slate-200 disabled:opacity-40 inline-flex items-center gap-1"
              >
                <ChevronLeft className="w-3 h-3" /> Anterior
              </button>
              <span className="text-slate-400">Página {page} de {Math.max(1, totalPages)}</span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="px-2 py-1 rounded bg-slate-700/60 text-slate-200 disabled:opacity-40 inline-flex items-center gap-1"
              >
                Siguiente <ChevronRight className="w-3 h-3" />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function KpiCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="bg-slate-800/70 border border-slate-600/30 rounded-lg p-3">
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-[11px] text-slate-400 uppercase tracking-wide">{label}</span>
        {icon}
      </div>
      <p className="text-sm text-white font-semibold break-words">{value}</p>
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-slate-800/70 border border-slate-600/30 rounded-xl p-3">
      <h3 className="text-xs text-cyan-300 font-semibold uppercase tracking-wider mb-2">{title}</h3>
      {children}
    </div>
  );
}

function InputDate({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="text-[11px] text-slate-400 block mb-1">{label}</label>
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-slate-900/70 border border-slate-600/40 rounded-md px-2 py-1.5 text-xs text-slate-200"
      />
    </div>
  );
}

function SelectInput({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="text-[11px] text-slate-400 block mb-1">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-slate-900/70 border border-slate-600/40 rounded-md px-2 py-1.5 text-xs text-slate-200"
      >
        <option value="">Todos</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}
