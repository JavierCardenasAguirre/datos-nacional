'use client';

import { useIntel } from '@/contexts/intel-context';
import { useAuth } from '@/contexts/auth-context';
import { Upload, Trash2, Calendar, X, Activity, Loader2, Users, LogOut, User, Menu } from 'lucide-react';
import { useRef, useState, useCallback, useEffect } from 'react';
import { importToSupabase, type ImportProgress } from '@/lib/import-supabase';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import AdminUsersPanel from './admin-users-panel';

export default function Header({ onMenuToggle, sidebarOpen }: { onMenuToggle?: () => void; sidebarOpen?: boolean }) {
  const {
    isDataLoaded, isLoading, filters, setFilters,
    uniqueValues, stats, destroyData, refreshData,
  } = useIntel();
  const { user, isAdmin, logout } = useAuth();
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [showDestroyConfirm, setShowDestroyConfirm] = useState(false);
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [importProgress, setImportProgress] = useState<ImportProgress>({ message: '', percent: 0 });
  const [isReloading, setIsReloading] = useState(false);

  // Detectar si venimos de una recarga por importación
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('reloaded') === 'true') {
      // Limpiar el parámetro de la URL
      const newUrl = window.location.pathname;
      window.history.replaceState({}, '', newUrl);
      // Forzar actualización de datos
      refreshData();
    }
  }, [refreshData]);

  const handleImport = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e?.target?.files?.[0];
    if (!file) return;
    
    if (isReloading) return; // Evitar múltiples importaciones
    
    setImporting(true);
    setIsReloading(true);
    setImportProgress({ message: 'Iniciando...', percent: 0 });
    const startTime = Date.now();
    
    try {
      const count = await importToSupabase(file, (p) => setImportProgress(p));
      
      if (count === 0) {
        toast.error('No se encontraron registros válidos en el archivo.');
        setIsReloading(false);
        setImporting(false);
        setImportProgress({ message: '', percent: 0 });
        if (fileInputRef?.current) fileInputRef.current.value = '';
        return;
      }

      const secs = Math.floor((Date.now() - startTime) / 1000);
      toast.success(`${count.toLocaleString()} registros insertados en ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}.`);
      
      // 🔥 RECARGAR LA PÁGINA FORZADAMENTE
      toast.info('Actualizando vista...', { duration: 1500 });
      
      setTimeout(() => {
        // Recargar con un parámetro para saber que venimos de una importación
        window.location.href = '/?reloaded=true&t=' + Date.now();
      }, 1500);
      
    } catch (err: any) {
      toast.error('Error al procesar: ' + (err?.message ?? 'desconocido'));
      setIsReloading(false);
      setImporting(false);
      setImportProgress({ message: '', percent: 0 });
      if (fileInputRef?.current) fileInputRef.current.value = '';
    }
  }, [isReloading]);

  const handleDestroy = useCallback(async () => {
    setShowDestroyConfirm(false);
    try {
      await destroyData();
      toast.success('Datos destruidos exitosamente.');
      // Recargar después de destruir
      setTimeout(() => {
        window.location.reload();
      }, 1000);
    } catch (err: any) {
      toast.error('Error al destruir datos: ' + (err?.message ?? 'desconocido'));
    }
  }, [destroyData]);

  const filteredMunicipios = filters.departamento && uniqueValues.municipiosByDept[filters.departamento]
    ? uniqueValues.municipiosByDept[filters.departamento]
    : uniqueValues.municipios;

  const totalCount = stats?.totalCount ?? 0;

  return (
    <>
      <header id="main-header" className="fixed top-0 left-0 right-0 z-50 bg-slate-800/95 backdrop-blur-md border-b border-slate-600/30 flex flex-col shadow-lg">
        {/* PRIMERA FILA: Logo + Botón Hamburguesa + Acciones de usuario */}
        <div className="flex items-center justify-between h-9 px-4 border-b border-slate-600/20">
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={onMenuToggle}
              className="lg:hidden text-cyan-400 hover:text-cyan-300 p-1 -ml-1 transition-colors"
            >
              {sidebarOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
            </button>
            
            <Activity className="w-5 h-5 text-cyan-400" />
            <span className="font-display text-sm font-bold tracking-tight text-white hidden sm:inline">DATACORE</span>
            <span className="font-display text-sm font-bold tracking-tight text-cyan-400 hidden sm:inline">INTEL</span>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            {isAdmin && (
              <button onClick={() => setShowAdminPanel(true)}
                className="flex items-center gap-1 bg-purple-700/50 hover:bg-purple-600/60 text-purple-200 px-2 py-0.5 rounded text-[10px] font-semibold transition-all border border-purple-600/30"
                title="Administrar usuarios">
                <Users className="w-3 h-3" />
                <span className="hidden md:inline">USUARIOS</span>
              </button>
            )}
            {isDataLoaded && isAdmin && (
              <button onClick={() => setShowDestroyConfirm(true)}
                className="flex items-center gap-1 bg-red-800/40 hover:bg-red-700/60 text-red-300 hover:text-red-200 px-2 py-0.5 rounded text-[10px] font-semibold transition-all border border-red-700/40">
                <Trash2 className="w-3 h-3" />
                <span className="hidden sm:inline">DESTRUIR</span>
              </button>
            )}
            {isAdmin ? (
              <>
                <button 
                  onClick={() => fileInputRef?.current?.click?.()}
                  disabled={importing || isReloading}
                  className="flex items-center gap-1 bg-cyan-600 hover:bg-cyan-500 text-white px-2 py-0.5 rounded text-[10px] font-semibold transition-all disabled:opacity-50"
                >
                  <Upload className="w-3 h-3" />
                  {importing ? `${importProgress.percent}%` : (isReloading ? 'RECARGANDO...' : 'IMPORTAR')}
                </button>
                <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleImport} className="hidden" />
              </>
            ) : null}

            <div className="flex items-center gap-1 text-slate-300 text-[10px] border-l border-slate-600/50 pl-2 ml-1">
              <User className="w-3 h-3 text-slate-400" />
              <span className="hidden lg:inline truncate max-w-[80px]">{user?.name ?? ''}</span>
              <button onClick={async () => { await logout(); router.push('/login'); }}
                className="flex items-center gap-1 text-slate-400 hover:text-red-400 hover:bg-red-900/30 px-1.5 py-0.5 rounded transition-all" title="Cerrar sesión">
                <LogOut className="w-3 h-3" />
                <span className="hidden md:inline text-[9px]">SALIR</span>
              </button>
            </div>
          </div>
        </div>

        {/* SEGUNDA FILA: Filtros */}
        {isDataLoaded && (
          <div className="flex items-center gap-2 px-4 py-1.5 bg-slate-900/40 flex-wrap">
            <div className="flex items-center gap-1 flex-shrink-0">
              <Calendar className="w-3 h-3 text-cyan-400 flex-shrink-0" />
              <input type="date" value={filters.fechaInicio}
                onChange={(e) => setFilters({ ...filters, fechaInicio: e.target.value })}
                className="bg-slate-900/80 border border-slate-600/50 rounded px-1.5 py-0.5 text-[10px] text-slate-200 font-mono w-[100px]" />
              <span className="text-slate-500 text-[10px]">-</span>
              <input type="date" value={filters.fechaFin}
                onChange={(e) => setFilters({ ...filters, fechaFin: e.target.value })}
                className="bg-slate-900/80 border border-slate-600/50 rounded px-1.5 py-0.5 text-[10px] text-slate-200 font-mono w-[100px]" />
            </div>

            <select value={filters.departamento}
              onChange={(e) => setFilters({ ...filters, departamento: e.target.value, municipio: '' })}
              className="bg-slate-900/80 border border-slate-600/50 rounded px-1.5 py-0.5 text-[10px] text-slate-200 min-w-[90px] flex-shrink-0">
              <option value="">Todos Dptos</option>
              {uniqueValues.departamentos.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>

            <select value={filters.municipio}
              onChange={(e) => setFilters({ ...filters, municipio: e.target.value })}
              className="bg-slate-900/80 border border-slate-600/50 rounded px-1.5 py-0.5 text-[10px] text-slate-200 min-w-[90px] flex-shrink-0">
              <option value="">Todos Mpios</option>
              {filteredMunicipios.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>

            <select value={filters.tipologia}
              onChange={(e) => setFilters({ ...filters, tipologia: e.target.value })}
              className="bg-slate-900/80 border border-slate-600/50 rounded px-1.5 py-0.5 text-[10px] text-slate-200 min-w-[100px] flex-shrink-0">
              <option value="">Todas Tipologías</option>
              {uniqueValues.tipologias.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>

            <button
              onClick={() => setFilters({ fechaInicio: '', fechaFin: '', departamento: '', municipio: '', tipologia: '', fenomeno: '', estructura: '' })}
              title="Limpiar filtros"
              className="flex items-center gap-1 bg-slate-700/60 hover:bg-slate-600/60 text-slate-300 px-1.5 py-0.5 rounded text-[10px] transition-colors flex-shrink-0">
              <X className="w-3 h-3" /> <span className="hidden sm:inline">Limpiar</span>
            </button>

            <div className="text-[10px] text-cyan-400 font-mono flex-shrink-0 font-bold ml-auto">
              {isLoading ? <Loader2 className="w-3 h-3 animate-spin inline" /> : totalCount.toLocaleString()}
            </div>
          </div>
        )}
      </header>

      {importing && (
        <div className="fixed top-[4.5rem] left-0 right-0 z-[90] bg-slate-800/95 backdrop-blur-sm border-b border-cyan-700/40 px-4 py-3">
          <div className="max-w-2xl mx-auto">
            <div className="flex items-center justify-between text-xs mb-2">
              <span className="text-slate-300 truncate max-w-[70%]">{importProgress.message || 'Procesando...'}</span>
              <span className="text-cyan-400 font-mono font-bold">{importProgress.percent}%</span>
            </div>
            <div className="w-full bg-slate-900 rounded-full h-2 overflow-hidden">
              <div className="h-full rounded-full transition-all duration-500 ease-out"
                style={{ width: `${Math.max(2, importProgress.percent)}%`, background: 'linear-gradient(90deg, #06b6d4, #22d3ee, #67e8f9)', boxShadow: '0 0 8px rgba(6, 182, 212, 0.4)' }} />
            </div>
          </div>
        </div>
      )}

      {isReloading && !importing && (
        <div className="fixed top-[4.5rem] left-0 right-0 z-[90] bg-slate-800/95 backdrop-blur-sm border-b border-cyan-700/40 px-4 py-3">
          <div className="max-w-2xl mx-auto flex items-center justify-center gap-2">
            <Loader2 className="w-4 h-4 text-cyan-400 animate-spin" />
            <span className="text-cyan-400 text-xs font-mono">RECARGANDO DATOS...</span>
          </div>
        </div>
      )}

      {showAdminPanel && <AdminUsersPanel onClose={() => setShowAdminPanel(false)} />}

      {showDestroyConfirm && (
        <div className="fixed inset-0 z-[100] bg-black/70 flex items-center justify-center p-4">
          <div className="bg-slate-800 border border-red-700/50 rounded-xl p-6 max-w-md w-full shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-900/40 flex items-center justify-center">
                <Trash2 className="w-5 h-5 text-red-400" />
              </div>
              <div>
                <h3 className="text-white font-display font-bold">DESTRUIR DATOS</h3>
                <p className="text-red-400 text-xs">Esta acción es irreversible</p>
              </div>
            </div>
            <p className="text-slate-300 text-sm mb-6">Todos los datos serán eliminados permanentemente de la base de datos.</p>
            <div className="flex gap-3">
              <button onClick={() => setShowDestroyConfirm(false)}
                className="flex-1 bg-slate-600 hover:bg-slate-500 text-white px-4 py-2 rounded-lg text-sm transition-colors">Cancelar</button>
              <button onClick={handleDestroy}
                className="flex-1 bg-red-700 hover:bg-red-600 text-white px-4 py-2 rounded-lg text-sm font-bold transition-colors">CONFIRMAR</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}