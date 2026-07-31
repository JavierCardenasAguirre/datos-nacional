'use client';

import { useState, useCallback } from 'react';
import { useAuth } from '@/contexts/auth-context';
import { Plus, Save, Trash2, Loader2, Lock, ClipboardPaste, X } from 'lucide-react';
import { toast } from 'sonner';
import { useIntel } from '@/contexts/intel-context';
import { parsePastedRows, type PastedRecord } from '@/lib/parse-excel';

const COLUMNS = [
  { key: 'departamento', label: 'Departamento', width: 130 },
  { key: 'municipio', label: 'Municipio', width: 130 },
  { key: 'vereda', label: 'Vereda', width: 110 },
  { key: 'fecha', label: 'Fecha', width: 110 },
  { key: 'tipologia', label: 'Tipología', width: 140 },
  { key: 'fenomeno_criminalidad', label: 'Fenómeno', width: 150 },
  { key: 'estructura', label: 'Estructura', width: 130 },
  { key: 'latitud', label: 'Latitud', width: 90 },
  { key: 'longitud', label: 'Longitud', width: 90 },
  { key: 'informacion_hecho', label: 'Información del Hecho', width: 250 },
  { key: 'medios', label: 'Medios', width: 100 },
  { key: 'genero', label: 'Género', width: 80 },
  { key: 'respuesta_accion', label: 'Respuesta Acción', width: 130 },
  { key: 'accion_enemiga', label: 'Acción Enemiga', width: 130 },
];

type Row = Record<string, string>;

function emptyRow(): Row {
  const r: Row = {};
  COLUMNS.forEach(c => { r[c.key] = ''; });
  return r;
}

// Tamaño de lote para no exceder límites de payload al guardar muchos registros
const SAVE_BATCH = 500;

export default function DataGrid() {
  const { isAdmin } = useAuth();
  const { refreshData, forceUpdateCounter } = useIntel();
  
  // 🔥 LOG PARA VERIFICAR QUE forceUpdateCounter ESTÁ DISPONIBLE
  console.log('🔍 DataGrid - forceUpdateCounter disponible:', !!forceUpdateCounter);
  console.log('🔍 DataGrid - refreshData disponible:', !!refreshData);
  
  const [rows, setRows] = useState<Row[]>([emptyRow()]);
  const [saving, setSaving] = useState(false);

  // --- Estado del pegado desde Excel ---
  const [pasteText, setPasteText] = useState('');
  const [pastePreview, setPastePreview] = useState<PastedRecord[]>([]);
  const [savingPaste, setSavingPaste] = useState(false);
  const [pasteProgress, setPasteProgress] = useState('');

  const updateCell = useCallback((rowIdx: number, key: string, value: string) => {
    setRows(prev => {
      const copy = [...prev];
      copy[rowIdx] = { ...copy[rowIdx], [key]: value };
      return copy;
    });
  }, []);

  const addRow = useCallback(() => {
    setRows(prev => [...prev, emptyRow()]);
  }, []);

  const removeRow = useCallback((idx: number) => {
    setRows(prev => prev.length <= 1 ? [emptyRow()] : prev.filter((_, i) => i !== idx));
  }, []);

  const saveRows = useCallback(async () => {
    const validRows = rows.filter(r => r.departamento.trim() || r.municipio.trim() || r.tipologia.trim());
    if (validRows.length === 0) {
      toast.error('Ingrese al menos un registro con datos.');
      return;
    }
    setSaving(true);
    try {
      console.log('🟢 1. Guardando registros manuales...', validRows.length);
      
      const res = await fetch('/api/intel/records', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validRows),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      
      console.log('🟢 2. Registros manuales guardados:', data.count);
      toast.success(`${data.count} registro(s) guardados exitosamente.`);
      setRows([emptyRow()]);
      
      // 🔥 ACTUALIZAR CONTADOR CON forceUpdateCounter
      console.log('🟢 3. Llamando a forceUpdateCounter desde saveRows...');
      try {
        const updatedStats = await forceUpdateCounter();
        console.log('🟢 4. Resultado de forceUpdateCounter en saveRows:', updatedStats);
        if (updatedStats) {
          console.log('📊 Contador actualizado en saveRows:', updatedStats.totalCount);
          toast.info(`Total: ${updatedStats.totalCount.toLocaleString()} registros`);
        } else {
          console.log('🟡 4. forceUpdateCounter devolvió null, usando refreshData');
          await refreshData();
        }
      } catch (err) {
        console.error('🔴 Error en forceUpdateCounter (saveRows):', err);
        await refreshData();
      }
      
    } catch (err: any) {
      console.error('🔴 Error en saveRows:', err);
      toast.error('Error: ' + (err?.message ?? 'desconocido'));
    } finally {
      setSaving(false);
    }
  }, [rows, refreshData, forceUpdateCounter]);

  // --- Pegado desde Excel ---
  const handlePasteChange = useCallback((text: string) => {
    setPasteText(text);
    const parsed = parsePastedRows(text);
    setPastePreview(parsed);
  }, []);

  const clearPaste = useCallback(() => {
    setPasteText('');
    setPastePreview([]);
    setPasteProgress('');
  }, []);

  const savePasted = useCallback(async () => {
    if (pastePreview.length === 0) {
      toast.error('No se detectaron filas válidas. Copie las celdas desde Excel y péguelas en el recuadro.');
      return;
    }
    setSavingPaste(true);
    setPasteProgress('');
    try {
      console.log('🟢 1. Guardando registros pegados...', pastePreview.length);
      let total = 0;
      const totalRows = pastePreview.length;
      for (let i = 0; i < totalRows; i += SAVE_BATCH) {
        const chunk = pastePreview.slice(i, i + SAVE_BATCH);
        setPasteProgress(`Guardando ${Math.min(i + chunk.length, totalRows).toLocaleString()} / ${totalRows.toLocaleString()}...`);
        const res = await fetch('/api/intel/records', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(chunk),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? 'Error al guardar');
        total += data.count ?? 0;
      }
      console.log('🟢 2. Registros pegados guardados:', total);
      toast.success(`${total.toLocaleString()} registro(s) cargados desde Excel.`);
      clearPaste();
      
      // 🔥 ACTUALIZAR CONTADOR CON forceUpdateCounter
      console.log('🟢 3. Llamando a forceUpdateCounter desde savePasted...');
      try {
        const updatedStats = await forceUpdateCounter();
        console.log('🟢 4. Resultado de forceUpdateCounter en savePasted:', updatedStats);
        if (updatedStats) {
          console.log('📊 Contador actualizado en savePasted:', updatedStats.totalCount);
          toast.info(`Total: ${updatedStats.totalCount.toLocaleString()} registros`);
        } else {
          console.log('🟡 4. forceUpdateCounter devolvió null, usando refreshData');
          await refreshData();
        }
      } catch (err) {
        console.error('🔴 Error en forceUpdateCounter (savePasted):', err);
        await refreshData();
      }
      
    } catch (err: any) {
      console.error('🔴 Error en savePasted:', err);
      toast.error('Error: ' + (err?.message ?? 'desconocido'));
    } finally {
      setSavingPaste(false);
      setPasteProgress('');
    }
  }, [pastePreview, refreshData, forceUpdateCounter, clearPaste]);

  if (!isAdmin) {
    return (
      <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-6 text-center">
        <Lock className="w-8 h-8 text-slate-500 mx-auto mb-2" />
        <p className="text-slate-400 text-sm">Solo los administradores pueden agregar registros directamente.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ============ PEGAR DESDE EXCEL ============ */}
      <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl overflow-hidden">
        <div className="p-3 border-b border-slate-700/50 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-cyan-400 flex items-center gap-2">
            <ClipboardPaste className="w-4 h-4" />
            PEGAR DESDE EXCEL
          </h3>
          {pastePreview.length > 0 && (
            <span className="text-xs font-semibold text-cyan-300 bg-cyan-500/10 border border-cyan-500/30 px-2 py-1 rounded-lg">
              {pastePreview.length.toLocaleString()} fila(s) detectada(s)
            </span>
          )}
        </div>
        <div className="p-3 space-y-3">
          <p className="text-xs text-slate-400 leading-relaxed">
            Copia las celdas o filas directamente desde tu Excel (con las mismas columnas:
            Departamento, Municipio, Vereda, coordenadas, Fecha, Tipología, etc.) y pégalas
            en el recuadro. El sistema detecta las columnas automáticamente y las carga a la base de datos.
          </p>
          <textarea
            value={pasteText}
            onChange={(e) => handlePasteChange(e.target.value)}
            placeholder="Pega aquí las celdas copiadas desde Excel (Ctrl+V)..."
            rows={4}
            className="w-full bg-slate-900/60 border border-slate-700/50 rounded-lg px-3 py-2 text-slate-200 text-xs font-mono focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/20 resize-y"
          />

          {/* Vista previa */}
          {pastePreview.length > 0 && (
            <div className="border border-slate-700/50 rounded-lg overflow-hidden">
              <div className="px-3 py-2 bg-slate-900/60 text-xs text-slate-400 font-medium">
                Vista previa (primeras {Math.min(5, pastePreview.length)} de {pastePreview.length.toLocaleString()} filas)
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-900/40 text-slate-500">
                      <th className="px-2 py-1.5 text-left font-medium">Departamento</th>
                      <th className="px-2 py-1.5 text-left font-medium">Municipio</th>
                      <th className="px-2 py-1.5 text-left font-medium">Tipología</th>
                      <th className="px-2 py-1.5 text-left font-medium">Fecha</th>
                      <th className="px-2 py-1.5 text-left font-medium">Latitud</th>
                      <th className="px-2 py-1.5 text-left font-medium">Longitud</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pastePreview.slice(0, 5).map((r, i) => (
                      <tr key={i} className="border-t border-slate-800/50">
                        <td className="px-2 py-1.5 text-slate-300 whitespace-nowrap">{r.departamento || '—'}</td>
                        <td className="px-2 py-1.5 text-slate-300 whitespace-nowrap">{r.municipio || '—'}</td>
                        <td className="px-2 py-1.5 text-slate-300 whitespace-nowrap">{r.tipologia || '—'}</td>
                        <td className="px-2 py-1.5 text-slate-300 whitespace-nowrap">{r.fecha || '—'}</td>
                        <td className="px-2 py-1.5 text-slate-300 whitespace-nowrap">{r.latitud ? r.latitud.toFixed(4) : '—'}</td>
                        <td className="px-2 py-1.5 text-slate-300 whitespace-nowrap">{r.longitud ? r.longitud.toFixed(4) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {pasteText.trim().length > 0 && pastePreview.length === 0 && (
            <p className="text-xs text-amber-400">
              No se detectaron filas válidas. Asegúrate de copiar las celdas desde Excel (no una imagen)
              y que incluyan al menos el departamento.
            </p>
          )}

          <div className="flex items-center gap-2">
            <button
              onClick={savePasted}
              disabled={savingPaste || pastePreview.length === 0}
              className="flex items-center gap-1.5 bg-cyan-600 hover:bg-cyan-500 text-white px-4 py-2 rounded-lg text-xs font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {savingPaste ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              {savingPaste ? (pasteProgress || 'Guardando...') : `Cargar ${pastePreview.length > 0 ? pastePreview.length.toLocaleString() + ' ' : ''}registro(s)`}
            </button>
            {pasteText.trim().length > 0 && !savingPaste && (
              <button
                onClick={clearPaste}
                className="flex items-center gap-1.5 bg-slate-700 hover:bg-slate-600 text-slate-200 px-3 py-2 rounded-lg text-xs transition-colors"
              >
                <X className="w-3.5 h-3.5" /> Limpiar
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ============ AGREGAR REGISTROS MANUALMENTE ============ */}
      <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl overflow-hidden">
        <div className="p-3 border-b border-slate-700/50 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-emerald-400 flex items-center gap-2">
            <div className="w-2 h-2 bg-emerald-500 rounded-full" />
            AGREGAR REGISTROS MANUALMENTE
          </h3>
          <div className="flex items-center gap-2">
            <button onClick={addRow} className="flex items-center gap-1 bg-slate-700 hover:bg-slate-600 text-slate-200 px-3 py-1.5 rounded-lg text-xs transition-colors">
              <Plus className="w-3.5 h-3.5" /> Fila
            </button>
            <button onClick={saveRows} disabled={saving}
              className="flex items-center gap-1 bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50">
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              {saving ? 'Guardando...' : 'Guardar'}
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-900/80">
                <th className="px-2 py-2 text-left text-slate-400 font-medium w-8">#</th>
                {COLUMNS.map(col => (
                  <th key={col.key} className="px-2 py-2 text-left text-slate-400 font-medium whitespace-nowrap" style={{ minWidth: col.width }}>
                    {col.label}
                  </th>
                ))}
                <th className="px-2 py-2 w-8" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rIdx) => (
                <tr key={rIdx} className="border-t border-slate-800/50 hover:bg-slate-800/30">
                  <td className="px-2 py-1 text-slate-500 font-mono">{rIdx + 1}</td>
                  {COLUMNS.map(col => (
                    <td key={col.key} className="px-1 py-1">
                      <input
                        type={col.key === 'fecha' ? 'date' : 'text'}
                        value={row[col.key] ?? ''}
                        onChange={(e) => updateCell(rIdx, col.key, e.target.value)}
                        className="w-full bg-slate-900/60 border border-slate-700/50 rounded px-2 py-1 text-slate-200 text-xs focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20"
                      />
                    </td>
                  ))}
                  <td className="px-1 py-1">
                    <button onClick={() => removeRow(rIdx)} className="text-slate-500 hover:text-red-400 p-1">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}