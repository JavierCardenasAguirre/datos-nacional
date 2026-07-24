'use client';

import { useIntel } from '@/contexts/intel-context';
import type { NameCount } from '@/contexts/intel-context';
import { Shield, MapPin, Crosshair, Users, AlertTriangle, Zap } from 'lucide-react';

function StatBar({ label, count, max, color }: { label: string; count: number; max: number; color: string }) {
  const pct = max > 0 ? (count / max) * 100 : 0;
  return (
    <div className="mb-1.5">
      <div className="flex justify-between text-[10px] mb-0.5">
        <span className="text-slate-300 truncate mr-2 max-w-[180px]">{label}</span>
        <span className={`font-mono font-bold flex-shrink-0 ${color}`}>{count.toLocaleString()}</span>
      </div>
      <div className="h-1.5 bg-slate-700/60 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-700 ${
          color === 'text-red-400' ? 'bg-red-500' :
          color === 'text-cyan-400' ? 'bg-cyan-500' :
          color === 'text-orange-400' ? 'bg-orange-500' :
          color === 'text-green-400' ? 'bg-green-500' : 'bg-purple-500'
        }`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function StatSection({ title, icon, items, color }: { title: string; icon: React.ReactNode; items: NameCount[]; color: string }) {
  const list = items ?? [];
  const max = list[0]?.count ?? 1;
  // Cuando hay muchas categorías, la lista completa se muestra dentro de un
  // contenedor con su propio scroll para no romper el diseño de la barra lateral.
  const scrollable = false;
  return (
    <div className="bg-slate-800/60 border border-slate-600/20 rounded-lg p-3 mb-2">
      <div className="flex items-center justify-between gap-1.5 mb-2">
        <div className="flex items-center gap-1.5 min-w-0">
          {icon}
          <span className={`text-[10px] font-bold tracking-wider uppercase truncate ${color}`}>{title}</span>
        </div>
        {list.length > 0 && (
          <span className="text-[9px] font-mono text-slate-400 bg-slate-700/50 rounded px-1.5 py-0.5 flex-shrink-0">
            {list.length}
          </span>
        )}
      </div>
      <div className={scrollable ? 'max-h-64 overflow-y-auto scrollbar-hide pr-1' : ''}>
        {list.map((item, i) => (
          <StatBar key={i} label={item.name} count={item.count} max={max} color={color} />
        ))}
      </div>
      {list.length === 0 && <p className="text-slate-500 text-[10px]">Sin datos</p>}
    </div>
  );
}

export default function StatsSidebar() {
  const { stats, isDataLoaded } = useIntel();

  if (!isDataLoaded || !stats) return null;

  return (
    <div className="w-full h-full overflow-y-auto scrollbar-hide p-2 space-y-1">
      <div className="bg-gradient-to-br from-cyan-800/30 to-blue-800/20 border border-cyan-500/30 rounded-lg p-4 text-center mb-2">
        <p className="text-cyan-400 text-[10px] font-bold tracking-widest uppercase">CASOS IDENTIFICADOS</p>
        <p className="text-white text-4xl font-mono font-bold mt-1">{(stats.totalCount ?? 0).toLocaleString()}</p>
      </div>

      <StatSection title="DESGLOSE POR TIPOLOGÍA" icon={<Crosshair className="w-3 h-3 text-red-400" />} items={stats.tipologias ?? []} color="text-red-400" />
      <StatSection title="ESTRUCTURA" icon={<Users className="w-3 h-3 text-cyan-400" />} items={stats.estructuras ?? []} color="text-cyan-400" />
      <StatSection title="RESPUESTA ACCIÓN" icon={<Shield className="w-3 h-3 text-green-400" />} items={stats.respuestas ?? []} color="text-green-400" />
      <StatSection title="FENÓMENO CRIMINALIDAD" icon={<AlertTriangle className="w-3 h-3 text-orange-400" />} items={stats.fenomenos ?? []} color="text-orange-400" />
      <StatSection title="ACCIÓN ENEMIGA" icon={<Zap className="w-3 h-3 text-purple-400" />} items={stats.acciones ?? []} color="text-purple-400" />
      <StatSection title="MUNICIPIO" icon={<MapPin className="w-3 h-3 text-red-400" />} items={stats.municipios ?? []} color="text-red-400" />
    </div>
  );
}
