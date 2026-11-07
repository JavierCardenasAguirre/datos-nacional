/// <reference lib="webworker" />
/**
 * Web Worker de importación: procesa el archivo y envía los lotes al servidor
 * fuera del hilo principal, para que la interfaz no se congele con archivos
 * de cientos de miles de filas.
 */
import { runImport } from '@/lib/import-pipeline';

const ctx = self as unknown as {
  onmessage: ((ev: MessageEvent) => void) | null;
  postMessage: (msg: any) => void;
};

ctx.onmessage = async (ev: MessageEvent) => {
  const { file, append, endpoint } = ev.data ?? {};
  try {
    const summary = await runImport(file as File, {
      append: Boolean(append),
      endpoint: endpoint || undefined,
      onProgress: (p) => ctx.postMessage({ type: 'progress', progress: p }),
    });
    ctx.postMessage({ type: 'done', summary });
  } catch (e: any) {
    ctx.postMessage({ type: 'error', message: String(e?.message ?? e) });
  }
};

export {};
