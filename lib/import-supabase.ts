import { runImport, type ImportProgress, type ImportSummary } from '@/lib/import-pipeline';

export type { ImportProgress, ImportSummary } from '@/lib/import-pipeline';

export interface ImportToSupabaseOptions {
  /** true = agregar sin borrar los datos existentes. Por defecto reemplaza. */
  append?: boolean;
}

/**
 * Importa un archivo .xlsx/.xls/.csv a Supabase por streaming y en lotes.
 * Usa un Web Worker cuando está disponible (no congela la interfaz) y, si no,
 * ejecuta el mismo pipeline en el hilo principal.
 *
 * Devuelve el número de registros insertados.
 */
export async function importToSupabase(
  file: File,
  onProgress?: (p: ImportProgress) => void,
  options: ImportToSupabaseOptions = {},
): Promise<number> {
  const summary = await importWithWorkerOrFallback(file, onProgress, options);
  return summary.inserted;
}

function importWithWorkerOrFallback(
  file: File,
  onProgress: ((p: ImportProgress) => void) | undefined,
  options: ImportToSupabaseOptions,
): Promise<ImportSummary> {
  let worker: Worker | null = null;
  try {
    if (typeof window !== 'undefined' && typeof Worker !== 'undefined') {
      worker = new Worker(new URL('./import-worker.ts', import.meta.url));
    }
  } catch {
    worker = null;
  }

  if (!worker) {
    return runImport(file, { append: options.append, onProgress });
  }

  const w = worker;
  return new Promise<ImportSummary>((resolve, reject) => {
    let settled = false;
    const finish = () => { settled = true; w.terminate(); };

    w.onmessage = (ev: MessageEvent) => {
      const msg = ev.data ?? {};
      if (msg.type === 'progress') onProgress?.(msg.progress);
      else if (msg.type === 'done') { finish(); resolve(msg.summary as ImportSummary); }
      else if (msg.type === 'error') { finish(); reject(new Error(msg.message)); }
    };
    w.onerror = (ev: ErrorEvent) => {
      if (settled) return;
      finish();
      // Si el worker no pudo arrancar, usar el hilo principal
      ev.preventDefault?.();
      runImport(file, { append: options.append, onProgress }).then(resolve, reject);
    };
    w.postMessage({ file, append: Boolean(options.append), endpoint: `${window.location.origin}/api/intel/import` });
  });
}
