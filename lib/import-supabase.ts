import { importFile } from '@/lib/parse-excel';
import type { IntelRecord } from '@/contexts/intel-context';

export interface ImportProgress {
  message: string;
  percent: number;
}

type SupabaseRow = {
  departamento: string;
  municipio: string;
  vereda: string;
  lat_grados: number;
  lat_minutos: number;
  lat_segundos: number;
  lon_grados: number;
  lon_minutos: number;
  lon_segundos: number;
  latitud: number;
  longitud: number;
  fecha: string | null;
  tipologia: string;
  informacion_hecho: string;
  fenomeno_criminalidad: string;
  medios: string;
  genero: string;
  estructura: string;
  respuesta_accion: string;
  accion_enemiga: string;
  res_tipo: string;
};

const MAX_ROWS_PER_BATCH = 700;
const MAX_BATCH_BYTES = 3_200_000; // margen seguro < ~4.5MB de Vercel

function toSupabaseRow(r: IntelRecord): SupabaseRow {
  return {
    departamento: r.departamento ?? '',
    municipio: r.municipio ?? '',
    vereda: r.vereda ?? '',
    lat_grados: r.latGrados ?? 0,
    lat_minutos: r.latMinutos ?? 0,
    lat_segundos: r.latSegundos ?? 0,
    lon_grados: r.lonGrados ?? 0,
    lon_minutos: r.lonMinutos ?? 0,
    lon_segundos: r.lonSegundos ?? 0,
    latitud: r.latitud ?? 0,
    longitud: r.longitud ?? 0,
    fecha: r.fecha ? String(r.fecha) : null,
    tipologia: r.tipologia ?? '',
    informacion_hecho: r.informacionHecho ?? '',
    fenomeno_criminalidad: r.fenomenoCriminalidad ?? '',
    medios: r.medios ?? '',
    genero: r.genero ?? '',
    estructura: r.estructura ?? '',
    respuesta_accion: r.respuestaAccion ?? '',
    accion_enemiga: r.accionEnemiga ?? '',
    res_tipo: r.resTipo ?? '',
  };
}

function estimateRowBytes(row: SupabaseRow): number {
  return new TextEncoder().encode(JSON.stringify(row)).length;
}

function chunkRows(rows: SupabaseRow[]): SupabaseRow[][] {
  const batches: SupabaseRow[][] = [];
  let current: SupabaseRow[] = [];
  let currentBytes = 2; // []

  for (const row of rows) {
    const rowBytes = estimateRowBytes(row) + 1; // coma separadora
    const wouldExceedBytes = current.length > 0 && (currentBytes + rowBytes > MAX_BATCH_BYTES);
    const wouldExceedRows = current.length >= MAX_ROWS_PER_BATCH;

    if (wouldExceedBytes || wouldExceedRows) {
      batches.push(current);
      current = [];
      currentBytes = 2;
    }

    current.push(row);
    currentBytes += rowBytes;
  }

  if (current.length > 0) batches.push(current);
  return batches;
}

async function postBatch(rows: SupabaseRow[], clearExisting: boolean): Promise<{ inserted: number; errors: number }> {
  const response = await fetch('/api/intel/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rows, clearExisting }),
  });

  const text = await response.text();
  let payload: any = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const errMsg = payload?.error ?? text ?? `Error HTTP ${response.status}`;
    throw new Error(errMsg);
  }

  return {
    inserted: Number(payload?.inserted ?? 0),
    errors: Number(payload?.errors ?? 0),
  };
}

export async function importToSupabase(
  file: File,
  onProgress?: (p: ImportProgress) => void,
): Promise<number> {
  onProgress?.({ message: 'Procesando archivo en el navegador...', percent: 2 });

  const records = await importFile(file, (p) => {
    const mapped = Math.min(45, Math.max(2, Math.round((p.percent / 100) * 45)));
    onProgress?.({ message: p.message, percent: mapped });
  });

  if (!records || records.length === 0) {
    throw new Error('No se encontraron registros válidos para importar.');
  }

  const rows = records.map(toSupabaseRow);
  const batches = chunkRows(rows);

  let totalInserted = 0;
  let totalErrors = 0;

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const baseProgress = 45;
    const pct = baseProgress + Math.round(((i + 1) / batches.length) * 50);

    onProgress?.({
      message: `Enviando lote ${i + 1} de ${batches.length} (${batch.length.toLocaleString()} filas)...`,
      percent: Math.min(95, pct),
    });

    const result = await postBatch(batch, i === 0);
    totalInserted += result.inserted;
    totalErrors += result.errors;
  }

  const errMsg = totalErrors > 0 ? ` (${totalErrors} filas con errores)` : '';
  onProgress?.({ message: `${totalInserted.toLocaleString()} registros insertados${errMsg}`, percent: 100 });
  return totalInserted;
}
