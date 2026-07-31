'use client';

import { useIntel } from '@/contexts/intel-context';
import { useMemo } from 'react';
import {
  Brain, MapPin, TrendingUp, TrendingDown, Minus, Radar, Globe2,
  AlertOctagon, Crosshair, ShieldAlert, Shield, Activity, Target,
} from 'lucide-react';

type Trend = 'up' | 'down' | 'flat';

export default function AnalysisPanel() {
  const { stats, isDataLoaded } = useIntel();

  const intel = useMemo(() => {
    if (!stats) return null;

    const total = stats.totalCount ?? 0;
    const tipologias = stats.tipologias ?? [];
    const municipios = stats.municipios ?? [];
    const departamentos = stats.departamentos ?? [];
    const fenomenos = stats.fenomenos ?? [];
    const acciones = stats.acciones ?? [];
    const estructuras = stats.estructuras ?? [];
    const correlaciones = stats.correlaciones ?? [];
    const timeline = stats.timeline ?? [];
    const patternTemporal = stats.patternTemporal ?? [];
    const monthlyPattern = stats.monthlyPattern ?? [];

    // --- Tendencia temporal (últimos 3 periodos vs 3 anteriores) ----------
    let trend: Trend = 'flat';
    let trendPct = 0;
    if (timeline.length >= 2) {
      const last3 = timeline.slice(-3);
      const prev3 = timeline.slice(-6, -3);
      const avg = (arr: { count: number }[]) => (arr.length ? arr.reduce((s, x) => s + x.count, 0) / arr.length : 0);
      const a = avg(last3);
      const b = avg(prev3.length ? prev3 : timeline.slice(0, -3).length ? timeline.slice(0, timeline.length - last3.length) : last3);
      if (b > 0) {
        trendPct = Math.round(((a - b) / b) * 100);
        if (trendPct > 8) trend = 'up';
        else if (trendPct < -8) trend = 'down';
      }
    }

    const peakDay = [...patternTemporal].sort((x, y) => y.count - x.count)[0];
    const peakMonth = [...monthlyPattern].sort((x, y) => y.count - x.count)[0];

    // --- Alcance geográfico ----------------------------------------------
    const numDeptos = departamentos.length;
    const numMunis = municipios.length;
    const topDepShare = total > 0 && departamentos[0] ? (departamentos[0].count / total) * 100 : 0;
    const topMuniShare = total > 0 && municipios[0] ? (municipios[0].count / total) * 100 : 0;

    // --- Nivel de importancia (basado en riskScore) ----------------------
    const risk = stats.riskScore ?? 0;
    let level: { label: string; color: string; ring: string };
    if (risk >= 75) level = { label: 'CRÍTICA', color: 'text-red-400', ring: 'ring-red-500/40' };
    else if (risk >= 50) level = { label: 'ALTA', color: 'text-orange-400', ring: 'ring-orange-500/40' };
    else if (risk >= 25) level = { label: 'MEDIA', color: 'text-yellow-400', ring: 'ring-yellow-500/40' };
    else level = { label: 'BAJA', color: 'text-green-400', ring: 'ring-green-500/40' };

    // --- Predicción (proyección deterministica de patrones) --------------
    const prediction: string[] = [];
    if (tipologias[0]) {
      prediction.push(`Se prevé continuidad de "${tipologias[0].name}" como tipología dominante (${tipologias[0].count.toLocaleString()} casos).`);
    }
    if (municipios[0]) {
      prediction.push(`Foco probable de nuevos incidentes: ${municipios[0].name} (${topMuniShare.toFixed(1)}% del total).`);
    }
    if (peakDay?.count > 0 && peakMonth?.count > 0) {
      prediction.push(`Mayor probabilidad de eventos los ${peakDay.label} y durante ${peakMonth.label}.`);
    }
    if (trend === 'up') prediction.push(`Tendencia AL ALZA (+${trendPct}%) en los periodos recientes; se recomienda anticipar recursos.`);
    else if (trend === 'down') prediction.push(`Tendencia A LA BAJA (${trendPct}%); mantener vigilancia para evitar repuntes.`);
    else prediction.push('Actividad ESTABLE; sin variaciones bruscas proyectadas.');

    // --- Amenazas (fenómenos + acción enemiga) ---------------------------
    const amenazas = fenomenos.slice(0, 5).map((f) => ({
      name: f.name,
      count: f.count,
      pct: total > 0 ? (f.count / total) * 100 : 0,
    }));
    const accionesTop = acciones.slice(0, 4);

    // --- Vulnerabilidades (concentración geográfica / estructural) -------
    const vulnerabilidades = municipios.slice(0, 5).map((m) => ({
      name: m.name,
      count: m.count,
      pct: total > 0 ? (m.count / total) * 100 : 0,
    }));

    // --- Análisis narrativo ----------------------------------------------
    const analisis: string[] = [];
    analisis.push(`Universo analizado: ${total.toLocaleString()} incidentes en ${numMunis.toLocaleString()} municipios de ${numDeptos.toLocaleString()} departamentos.`);
    if (departamentos[0]) {
      analisis.push(`${departamentos[0].name} concentra el ${topDepShare.toFixed(1)}% de la actividad registrada.`);
    }
    if (estructuras[0]) {
      analisis.push(`Estructura con mayor incidencia: "${estructuras[0].name}" (${estructuras[0].count.toLocaleString()} casos).`);
    }
    if (correlaciones[0]) {
      analisis.push(`Correlación crítica: "${correlaciones[0].fenomeno}" vinculado a "${correlaciones[0].estructura}" (${correlaciones[0].count.toLocaleString()} casos).`);
    }

    return {
      total, risk, level, trend, trendPct,
      prediction, amenazas, accionesTop, vulnerabilidades, analisis,
      numDeptos, numMunis, topDepShare, topMuniShare,
      peakDay, peakMonth,
      recomendaciones: stats.recomendaciones ?? [],
    };
  }, [stats]);

  if (!isDataLoaded || !stats || !intel) return null;

  const TrendIcon = intel.trend === 'up' ? TrendingUp : intel.trend === 'down' ? TrendingDown : Minus;
  const trendColor = intel.trend === 'up' ? 'text-red-400' : intel.trend === 'down' ? 'text-green-400' : 'text-slate-400';

  return (
    <div className="p-1 space-y-2.5">
      {/* ---------- CABECERA PREMIUM ---------- */}
      <div className="relative overflow-hidden rounded-xl border border-purple-500/30 bg-gradient-to-br from-slate-900 via-purple-950/40 to-slate-900 p-4">
        <div className="absolute -top-8 -right-8 w-32 h-32 bg-purple-600/10 rounded-full blur-2xl" />
        <div className="relative flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-purple-500/30 to-cyan-500/20 border border-purple-400/30 flex items-center justify-center">
              <Brain className="w-5 h-5 text-purple-300" />
            </div>
            <div>
              <h2 className="text-white text-sm font-bold tracking-widest uppercase leading-tight">Análisis de Inteligencia</h2>
              <p className="text-purple-300/70 text-[10px] tracking-wider uppercase">Motor predictivo · DATACORE INTEL</p>
            </div>
          </div>
          {/* Medidor de riesgo */}
          <div className={`flex flex-col items-center rounded-lg bg-slate-900/60 px-3 py-1.5 ring-1 ${intel.level.ring}`}>
            <span className="text-[9px] text-slate-400 tracking-wider uppercase">Nivel</span>
            <span className={`text-lg font-mono font-bold leading-none ${intel.level.color}`}>{intel.risk}</span>
            <span className={`text-[9px] font-bold tracking-wider ${intel.level.color}`}>{intel.level.label}</span>
          </div>
        </div>
        {/* Métricas rápidas */}
        <div className="relative grid grid-cols-4 gap-2 mt-3">
          <Metric icon={<Target className="w-3 h-3" />} label="Incidentes" value={intel.total.toLocaleString()} accent="text-cyan-300" />
          <Metric icon={<Globe2 className="w-3 h-3" />} label="Deptos" value={intel.numDeptos.toLocaleString()} accent="text-emerald-300" />
          <Metric icon={<MapPin className="w-3 h-3" />} label="Municipios" value={intel.numMunis.toLocaleString()} accent="text-orange-300" />
          <Metric icon={<TrendIcon className="w-3 h-3" />} label="Tendencia" value={`${intel.trendPct > 0 ? '+' : ''}${intel.trendPct}%`} accent={trendColor} />
        </div>
      </div>

      {/* ---------- TARJETAS ---------- */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5">
        {/* PREDICCIÓN */}
        <Card title="Predicción" icon={<Radar className="w-4 h-4" />} tone="cyan">
          <ul className="space-y-1.5">
            {intel.prediction.map((p, i) => (
              <li key={i} className="flex gap-1.5 text-[11px] text-slate-300 leading-snug">
                <span className="text-cyan-400 mt-0.5">▸</span><span>{p}</span>
              </li>
            ))}
          </ul>
        </Card>

        {/* ALCANCE */}
        <Card title="Alcance" icon={<Globe2 className="w-4 h-4" />} tone="emerald">
          <div className="space-y-1.5 text-[11px]">
            <Row label="Cobertura geográfica" value={`${intel.numDeptos} deptos · ${intel.numMunis} mpios`} />
            <Row label="Concentración dept. principal" value={`${intel.topDepShare.toFixed(1)}%`} bar={intel.topDepShare} tone="emerald" />
            <Row label="Concentración mpio. principal" value={`${intel.topMuniShare.toFixed(1)}%`} bar={intel.topMuniShare} tone="emerald" />
            {intel.peakDay?.count > 0 && <Row label="Día pico" value={intel.peakDay.label} />}
            {intel.peakMonth?.count > 0 && <Row label="Mes pico" value={intel.peakMonth.label} />}
          </div>
        </Card>

        {/* AMENAZAS */}
        <Card title="Amenazas" icon={<Crosshair className="w-4 h-4" />} tone="red">
          <div className="space-y-1.5">
            {intel.amenazas.length === 0 && <p className="text-slate-500 text-[11px]">Sin datos</p>}
            {intel.amenazas.map((a, i) => (
              <div key={i}>
                <div className="flex justify-between text-[11px] mb-0.5">
                  <span className="text-slate-300 truncate mr-2">{i + 1}. {a.name}</span>
                  <span className="text-red-400 font-mono font-bold flex-shrink-0">{a.count.toLocaleString()}</span>
                </div>
                <div className="h-1 bg-slate-700/60 rounded-full overflow-hidden">
                  <div className="h-full bg-red-500 rounded-full" style={{ width: `${Math.min(100, a.pct)}%` }} />
                </div>
              </div>
            ))}
            {intel.accionesTop.length > 0 && (
              <div className="pt-1.5 mt-1 border-t border-slate-700/50">
                <p className="text-[9px] text-slate-500 uppercase tracking-wider mb-1">Acciones enemigas</p>
                <div className="flex flex-wrap gap-1">
                  {intel.accionesTop.map((a, i) => (
                    <span key={i} className="text-[9px] bg-red-950/50 text-red-300 border border-red-800/40 rounded px-1.5 py-0.5">
                      {a.name} · {a.count.toLocaleString()}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Card>

        {/* VULNERABILIDADES */}
        <Card title="Vulnerabilidades" icon={<ShieldAlert className="w-4 h-4" />} tone="orange">
          <div className="space-y-1.5">
            {intel.vulnerabilidades.length === 0 && <p className="text-slate-500 text-[11px]">Sin datos</p>}
            {intel.vulnerabilidades.map((v, i) => (
              <div key={i}>
                <div className="flex justify-between text-[11px] mb-0.5">
                  <span className="text-slate-300 truncate mr-2">{i + 1}. {v.name}</span>
                  <span className="text-orange-400 font-mono font-bold flex-shrink-0">{v.pct.toFixed(1)}%</span>
                </div>
                <div className="h-1 bg-slate-700/60 rounded-full overflow-hidden">
                  <div className="h-full bg-orange-500 rounded-full" style={{ width: `${Math.min(100, v.pct)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* ANÁLISIS */}
      <Card title="Análisis" icon={<Activity className="w-4 h-4" />} tone="purple">
        <ul className="space-y-1.5">
          {intel.analisis.map((a, i) => (
            <li key={i} className="flex gap-1.5 text-[11px] text-slate-300 leading-snug">
              <span className="text-purple-400 mt-0.5">◆</span><span>{a}</span>
            </li>
          ))}
        </ul>
      </Card>

      {/* IMPORTANCIA / RECOMENDACIONES */}
      <Card title="Importancia y Recomendaciones" icon={<AlertOctagon className="w-4 h-4" />} tone="green">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-[10px] text-slate-400 uppercase tracking-wider">Prioridad operacional</span>
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-900/70 ring-1 ${intel.level.ring} ${intel.level.color}`}>
            {intel.level.label}
          </span>
        </div>
        <div className="space-y-1.5">
          {intel.recomendaciones.map((rec, i) => (
            <div key={i} className="flex gap-1.5 text-[11px] text-slate-300 leading-snug bg-slate-900/40 rounded-md px-2 py-1.5 border border-slate-700/40">
              <Shield className="w-3 h-3 text-green-400 mt-0.5 flex-shrink-0" />
              <span>{rec}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

// ----------------- Subcomponentes de presentación -----------------
function Metric({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: string; accent: string }) {
  return (
    <div className="rounded-lg bg-slate-900/50 border border-slate-700/40 px-2 py-1.5 text-center">
      <div className={`flex items-center justify-center gap-1 ${accent}`}>{icon}<span className="text-sm font-mono font-bold leading-none">{value}</span></div>
      <p className="text-[8px] text-slate-500 uppercase tracking-wider mt-1">{label}</p>
    </div>
  );
}

const TONES: Record<string, { border: string; text: string; grad: string }> = {
  cyan: { border: 'border-cyan-500/25', text: 'text-cyan-400', grad: 'from-cyan-500/10' },
  emerald: { border: 'border-emerald-500/25', text: 'text-emerald-400', grad: 'from-emerald-500/10' },
  red: { border: 'border-red-500/25', text: 'text-red-400', grad: 'from-red-500/10' },
  orange: { border: 'border-orange-500/25', text: 'text-orange-400', grad: 'from-orange-500/10' },
  purple: { border: 'border-purple-500/25', text: 'text-purple-400', grad: 'from-purple-500/10' },
  green: { border: 'border-green-500/25', text: 'text-green-400', grad: 'from-green-500/10' },
};

function Card({ title, icon, tone, children }: { title: string; icon: React.ReactNode; tone: keyof typeof TONES | string; children: React.ReactNode }) {
  const t = TONES[tone] ?? TONES.cyan;
  return (
    <div className={`rounded-xl border ${t.border} bg-gradient-to-br ${t.grad} to-slate-800/60 p-3`}>
      <div className="flex items-center gap-1.5 mb-2">
        <span className={t.text}>{icon}</span>
        <span className={`text-[11px] font-bold tracking-widest uppercase ${t.text}`}>{title}</span>
      </div>
      {children}
    </div>
  );
}

function Row({ label, value, bar, tone }: { label: string; value: string; bar?: number; tone?: string }) {
  const barColor = tone === 'emerald' ? 'bg-emerald-500' : 'bg-cyan-500';
  return (
    <div>
      <div className="flex justify-between gap-2">
        <span className="text-slate-400">{label}</span>
        <span className="text-slate-200 font-mono font-semibold flex-shrink-0">{value}</span>
      </div>
      {bar != null && (
        <div className="h-1 bg-slate-700/60 rounded-full overflow-hidden mt-1">
          <div className={`h-full ${barColor} rounded-full`} style={{ width: `${Math.min(100, bar)}%` }} />
        </div>
      )}
    </div>
  );
}
