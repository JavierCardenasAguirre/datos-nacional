'use client';

import { Upload, Lock, Map, BarChart3, Brain, FileText, Activity, Loader2, Database, ArrowRight, LogOut } from 'lucide-react';
import { useRef, useCallback, useState, useEffect } from 'react';
import { useIntel } from '@/contexts/intel-context';
import { useAuth } from '@/contexts/auth-context';
import { importToSupabase, type ImportProgress } from '@/lib/import-supabase';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function WelcomeScreen() {
  const { refreshData, isLoading } = useIntel();
  const { user, isAdmin, logout } = useAuth();
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<ImportProgress>({ message: '', percent: 0 });
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<any>(null);
  const [dbCount, setDbCount] = useState<number | null>(null);
  const [checkingDb, setCheckingDb] = useState(true);

  // Check current record count via server-side API (bypasses RLS)
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/intel/count');
        const data = await res.json();
        setDbCount(data?.count ?? 0);
      } catch {
        setDbCount(0);
      } finally {
        setCheckingDb(false);
      }
    })();
  }, []);

  const handleImport = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e?.target?.files?.[0];
    if (!file) return;
    setImporting(true);
    setProgress({ message: 'Iniciando...', percent: 0 });
    setElapsed(0);
    const startTime = Date.now();
    timerRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);
    try {
      const count = await importToSupabase(file, (p) => setProgress(p));
      if (count === 0) {
        toast.error('No se encontraron registros válidos.');
      } else {
        const totalTime = Math.floor((Date.now() - startTime) / 1000);
        toast.success(`${count.toLocaleString()} registros insertados en ${formatTime(totalTime)}.`);
        await refreshData();
      }
    } catch (err: any) {
      toast.error('Error: ' + (err?.message ?? 'desconocido'));
    } finally {
      clearInterval(timerRef.current);
      setImporting(false);
      setProgress({ message: '', percent: 0 });
      setElapsed(0);
      if (fileInputRef?.current) fileInputRef.current.value = '';
    }
  }, [refreshData]);

  const handleContinue = useCallback(async () => {
    await refreshData();
  }, [refreshData]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex flex-col items-center justify-center">
        <Loader2 className="w-10 h-10 text-cyan-400 animate-spin mb-4" />
        <p className="text-cyan-400 font-mono text-sm">VERIFICANDO DATOS...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex flex-col items-center justify-center p-6">
      {/* Logout button */}
      <div className="absolute top-4 right-4 z-20 flex items-center gap-3">
        <span className="text-slate-400 text-sm">{user?.name ?? ''}</span>
        <button onClick={async () => { await logout(); router.push('/login'); }}
          className="flex items-center gap-1.5 bg-slate-700/80 hover:bg-red-600/80 text-slate-300 hover:text-white px-3 py-2 rounded-lg text-xs font-semibold transition-all">
          <LogOut className="w-3.5 h-3.5" /> Cerrar Sesión
        </button>
      </div>

      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-cyan-500/5 rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-blue-500/5 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }} />
      </div>

      <div className="relative z-10 text-center max-w-3xl w-full">
        <div className="flex items-center justify-center gap-3 mb-6">
          <Activity className="w-12 h-12 text-cyan-400" />
          <div>
            <h1 className="font-display text-4xl md:text-5xl font-bold tracking-tight">
              <span className="text-white">DATACORE</span>{' '}
              <span className="text-cyan-400">INTEL</span>
            </h1>
          </div>
        </div>

        <p className="text-slate-400 text-sm md:text-base mb-8 max-w-lg mx-auto">
          Sistema de análisis de inteligencia criminal. Importa tus datos y visualiza patrones, tendencias y zonas de riesgo.
        </p>

        {/* Database status card */}
        <div className="max-w-md mx-auto mb-6">
          <div className="bg-slate-800/80 border border-slate-600/40 rounded-xl p-5">
            <div className="flex items-center gap-3 mb-3">
              <Database className="w-6 h-6 text-cyan-400" />
              <span className="text-slate-200 font-semibold text-sm">Estado de la Base de Datos</span>
            </div>
            {checkingDb ? (
              <div className="flex items-center gap-2 text-slate-400 text-sm">
                <Loader2 className="w-4 h-4 animate-spin" /> Verificando...
              </div>
            ) : dbCount !== null && dbCount > 0 ? (
              <>
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-2.5 h-2.5 bg-emerald-500 rounded-full animate-pulse" />
                  <span className="text-emerald-400 text-sm font-semibold">
                    {dbCount.toLocaleString()} registros encontrados
                  </span>
                </div>
                <button onClick={handleContinue}
                  className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white px-6 py-3 rounded-lg text-sm font-bold transition-all shadow-lg shadow-emerald-500/20">
                  <ArrowRight className="w-4 h-4" /> CONTINUAR AL DASHBOARD
                </button>
              </>
            ) : (
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 bg-amber-500 rounded-full" />
                <span className="text-amber-400 text-sm">Base de datos vacía - Importe datos para comenzar</span>
              </div>
            )}
          </div>
        </div>

        {/* Import section - admin only */}
        {!importing ? (
          isAdmin ? (
            <>
              <button onClick={() => fileInputRef?.current?.click?.()}
                className="group relative inline-flex items-center gap-3 bg-cyan-600 hover:bg-cyan-500 text-white px-8 py-4 rounded-xl text-lg font-bold transition-all shadow-lg shadow-cyan-500/20 hover:shadow-cyan-500/40">
                <Upload className="w-6 h-6" />
                IMPORTAR INTEL
                <div className="absolute inset-0 rounded-xl border-2 border-cyan-400/30 group-hover:border-cyan-400/60 transition-colors" />
              </button>
              <p className="text-slate-500 text-xs mt-3">Soporta archivos .xlsx, .xls y .csv | Los datos se almacenan en la nube</p>
            </>
          ) : (
            <div className="bg-slate-800/60 border border-slate-600/30 rounded-xl p-4 max-w-sm mx-auto">
              <Lock className="w-5 h-5 text-slate-500 mx-auto mb-2" />
              <p className="text-slate-400 text-xs">La importación de datos está restringida al administrador.</p>
            </div>
          )
        ) : (
          <div className="max-w-md mx-auto bg-slate-800/80 border border-cyan-700/40 rounded-xl p-6">
            <div className="flex items-center gap-3 mb-4">
              <Loader2 className="w-6 h-6 text-cyan-400 animate-spin" />
              <span className="text-cyan-300 font-semibold text-sm">PROCESANDO E INSERTANDO DATOS</span>
            </div>
            <div className="w-full bg-slate-900 rounded-full h-3 mb-3 overflow-hidden">
              <div className="h-full rounded-full transition-all duration-500 ease-out"
                style={{ width: `${Math.max(2, progress.percent)}%`, background: 'linear-gradient(90deg, #06b6d4, #22d3ee, #67e8f9)', boxShadow: '0 0 12px rgba(6, 182, 212, 0.5)' }} />
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400 truncate max-w-[70%]">{progress.message || 'Iniciando...'}</span>
              <span className="text-cyan-400 font-mono font-bold">{progress.percent}%</span>
            </div>
            <div className="mt-3 pt-3 border-t border-cyan-900/30 flex items-center justify-between text-xs">
              <span className="text-slate-500">Tiempo transcurrido</span>
              <span className="text-cyan-300 font-mono font-bold">{formatTime(elapsed)}</span>
            </div>
          </div>
        )}

        <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleImport} className="hidden" />

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-12">
          {[
            { icon: Map, label: 'Mapa Interactivo', desc: 'Geolocalización' },
            { icon: BarChart3, label: 'Estadísticas', desc: 'Análisis visual' },
            { icon: Brain, label: 'Análisis IA', desc: 'Patrones y tendencias' },
            { icon: FileText, label: 'Informes PDF', desc: 'Documentación' },
          ].map((feat, i) => (
            <div key={i} className="bg-slate-800/60 border border-slate-600/20 rounded-lg p-4 text-center">
              <feat.icon className="w-6 h-6 text-cyan-400 mx-auto mb-2" />
              <p className="text-white text-xs font-semibold">{feat.label}</p>
              <p className="text-slate-500 text-[10px]">{feat.desc}</p>
            </div>
          ))}
        </div>

        <div className="mt-8 flex items-center justify-center gap-2 text-slate-500 text-xs">
          <Lock className="w-3.5 h-3.5" />
          <span>Datos almacenados de forma segura en la nube. Persistentes entre sesiones.</span>
        </div>
      </div>
    </div>
  );
}
