/**
 * Pipeline de importación por STREAMING para archivos grandes (500k+ filas).
 *
 * Diferencias frente al importador anterior:
 *  - No construye la matriz completa de filas ni el arreglo completo de
 *    registros: lee el archivo por bloques, procesa cada bloque y lo envía al
 *    servidor antes de leer el siguiente (memoria casi constante).
 *  - CSV: se lee con `file.stream()` y un parser propio (sin cargar el archivo
 *    entero como texto). Es el formato recomendado para archivos enormes.
 *  - XLSX: SheetJS necesita cargar el libro, pero se carga en modo `dense`, sin
 *    texto formateado (`cellText:false`) y las filas se extraen por rangos de
 *    5.000, lo que reduce la memoria a ~1/3.
 *  - El borrado de datos anteriores se hace en una petición separada y SOLO
 *    cuando ya hay al menos un lote válido listo (si el archivo no tiene
 *    registros válidos no se borra nada).
 *  - Envío concurrente (3 lotes a la vez) con reintentos y backoff.
 *
 * Puede ejecutarse en un Web Worker (ver import-worker.ts) o en el hilo
 * principal como respaldo.
 */
import * as XLSX from 'xlsx';
import {
  scanHeader,
  detectColumnLayout,
  processRow,
  getPreviewRows,
  EXPECTED_COLUMNS,
  MAX_HEADER_SCAN_ROWS,
  type HeaderScanResult,
  type ColumnLayout,
} from '@/lib/parse-excel';
import type { IntelRecord } from '@/contexts/intel-context';
import { openXlsxStream } from '@/lib/xlsx-stream';

export interface ImportProgress {
  message: string;
  percent: number;
}

export interface ImportOptions {
  /** true = agrega sin borrar lo existente. false (por defecto) = reemplaza. */
  append?: boolean;
  onProgress?: (p: ImportProgress) => void;
  endpoint?: string;
  /** Solo pruebas: fuerza el lector XLSX por streaming aunque el archivo sea pequeño. */
  forceXlsxStream?: boolean;
}

export interface ImportSummary {
  inserted: number;
  errors: number;
  parsed: number;
  batches: number;
  sheets: string[];
}

// --------------------------------------------------------------------------
// Configuración
// --------------------------------------------------------------------------
const MAX_ROWS_PER_BATCH = 1000;
const MAX_BATCH_BYTES = 3_200_000; // margen seguro < ~4.5MB de Vercel
const CONCURRENCY = 3;
const MAX_RETRIES = 4;
const XLSX_CHUNK_ROWS = 5000;
const CSV_YIELD_ROWS = 5000;
/** A partir de este tamaño los .xlsx se leen por streaming (SheetJS puede devolver hojas vacías). */
const XLSX_STREAM_THRESHOLD_BYTES = 5 * 1024 * 1024;

// --------------------------------------------------------------------------
// Mapeo a columnas de Supabase
// --------------------------------------------------------------------------
export type SupabaseRow = {
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

export function toSupabaseRow(r: IntelRecord): SupabaseRow {
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

// --------------------------------------------------------------------------
// Fuentes de filas (por bloques)
// --------------------------------------------------------------------------
interface RowSource {
  name: string;
  /** Total aproximado de filas (para el % de progreso). null si se desconoce. */
  totalRows: number | null;
  /** Primeras filas (para detectar encabezado). */
  peek: any[][];
  /** Recorre TODAS las filas (incluidas las de `peek`) en bloques. */
  chunks: () => AsyncGenerator<any[][]>;
}

function xlsxSources(buffer: ArrayBuffer): RowSource[] {
  const workbook = XLSX.read(buffer, {
    type: 'array',
    dense: true,
    cellDates: false, // fechas como serial -> parseDate usa SSF (sin problemas de zona horaria)
    cellText: false,
    cellHTML: false,
    cellNF: false,
    cellStyles: false,
  });

  const sources: RowSource[] = [];
  for (const sheetName of workbook.SheetNames ?? []) {
    const sheet = workbook.Sheets?.[sheetName] as any;
    if (!sheet) continue;

    // Rango real de la hoja (el !ref a veces viene mal o vacío)
    let range: XLSX.Range | null = null;
    if (Array.isArray(sheet)) {
      // modo dense de SheetJS 0.18: sheet[r][c]
      let maxC = 0;
      for (let r = 0; r < sheet.length; r++) {
        const row = sheet[r];
        if (row && row.length > maxC) maxC = row.length;
      }
      if (sheet.length > 0 && maxC > 0) range = { s: { r: 0, c: 0 }, e: { r: sheet.length - 1, c: maxC - 1 } };
    } else if (Array.isArray(sheet['!data'])) {
      // modo dense de SheetJS >= 0.19
      const data = sheet['!data'];
      let maxC = 0;
      for (const row of data) if (row && row.length > maxC) maxC = row.length;
      if (data.length > 0 && maxC > 0) range = { s: { r: 0, c: 0 }, e: { r: data.length - 1, c: maxC - 1 } };
    }
    if (!range && sheet['!ref']) range = XLSX.utils.decode_range(sheet['!ref']);
    if (!range) continue;

    const fullRange = range;
    const readRows = (start: number, end: number): any[][] =>
      (XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        range: { s: { r: start, c: fullRange.s.c }, e: { r: end, c: fullRange.e.c } },
        defval: '',
        raw: true,
        blankrows: true,
      }) as any[][]) ?? [];

    const peekEnd = Math.min(fullRange.e.r, fullRange.s.r + MAX_HEADER_SCAN_ROWS - 1);
    const peek = readRows(fullRange.s.r, peekEnd);

    sources.push({
      name: sheetName,
      totalRows: fullRange.e.r - fullRange.s.r + 1,
      peek,
      chunks: async function* () {
        for (let start = fullRange.s.r; start <= fullRange.e.r; start += XLSX_CHUNK_ROWS) {
          const end = Math.min(fullRange.e.r, start + XLSX_CHUNK_ROWS - 1);
          yield readRows(start, end);
        }
      },
    });
  }
  return sources;
}

/** Detecta el separador de un CSV a partir de la primera línea. */
function detectDelimiter(sample: string): string {
  const firstLine = sample.split(/\r?\n/)[0] ?? '';
  const candidates = [';', ',', '\t', '|'];
  let best = ',';
  let bestCount = -1;
  for (const c of candidates) {
    const n = firstLine.split(c).length - 1;
    if (n > bestCount) { best = c; bestCount = n; }
  }
  return best;
}

/**
 * Parser CSV por streaming (respeta comillas, "" escapadas y saltos de línea
 * dentro de celdas). Corta las celdas con `slice` en lugar de concatenar
 * carácter por carácter, para no disparar el uso de memoria.
 */
async function* streamCsvRows(file: File): AsyncGenerator<any[][]> {
  const reader = (file.stream() as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder('utf-8');
  let delimiter = ',';
  let carry = '';
  let first = true;
  let out: string[][] = [];

  const unquote = (raw: string): string => {
    if (raw.length >= 2 && raw.charCodeAt(0) === 34 && raw.charCodeAt(raw.length - 1) === 34) {
      return raw.slice(1, -1).replace(/""/g, '"');
    }
    return raw;
  };

  /** Parsea todas las filas COMPLETAS de `text`; devuelve el resto sin terminar. */
  const parseText = (text: string, isLast: boolean): string => {
    const d = delimiter.charCodeAt(0);
    const n = text.length;
    let rowStart = 0;
    let fieldStart = 0;
    let inQuotes = false;
    let row: string[] = [];
    for (let i = 0; i < n; i++) {
      const c = text.charCodeAt(i);
      if (inQuotes) {
        if (c === 34) {
          if (i + 1 < n && text.charCodeAt(i + 1) === 34) { i++; continue; }
          if (i + 1 >= n && !isLast) break; // no sabemos si es "" o cierre: esperar más datos
          inQuotes = false;
        }
        continue;
      }
      if (c === 34 && i === fieldStart) { inQuotes = true; continue; }
      if (c === d) { row.push(unquote(text.slice(fieldStart, i))); fieldStart = i + 1; continue; }
      if (c === 10) {
        let endField = i;
        if (endField > fieldStart && text.charCodeAt(endField - 1) === 13) endField--;
        row.push(unquote(text.slice(fieldStart, endField)));
        if (row.some((v) => v.trim() !== '')) out.push(row);
        row = [];
        rowStart = fieldStart = i + 1;
      }
    }
    if (isLast) {
      if (rowStart < n) {
        let endField = n;
        if (text.charCodeAt(endField - 1) === 13) endField--;
        row.push(unquote(text.slice(fieldStart, endField)));
        if (row.some((v) => v.trim() !== '')) out.push(row);
      }
      return '';
    }
    // Copia "plana" del resto para no retener el bloque completo en memoria
    return (' ' + text.slice(rowStart)).slice(1);
  };

  while (true) {
    const { value, done } = await reader.read();
    let text = done ? decoder.decode() : decoder.decode(value, { stream: true });
    if (first && text.length > 0) {
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // BOM
      delimiter = detectDelimiter(text);
      first = false;
    }
    carry = parseText(carry + text, Boolean(done));
    if (out.length >= CSV_YIELD_ROWS || (done && out.length > 0)) {
      yield out;
      out = [];
    }
    if (done) break;
  }
}

/** Crea una fuente a partir de un generador, guardando las primeras filas para detectar encabezado. */
async function peekableSource(name: string, totalRows: number | null, gen: AsyncGenerator<any[][]>): Promise<RowSource> {
  const buffered: any[][][] = [];
  let peek: any[][] = [];
  while (peek.length < MAX_HEADER_SCAN_ROWS) {
    const { value, done } = await gen.next();
    if (done || !value) break;
    buffered.push(value);
    peek = peek.concat(value.slice(0, MAX_HEADER_SCAN_ROWS - peek.length));
  }
  return {
    name,
    totalRows,
    peek,
    chunks: async function* () {
      for (const b of buffered) yield b;
      buffered.length = 0;
      for await (const b of gen) yield b;
    },
  };
}

async function csvSource(file: File): Promise<RowSource> {
  // Estimación de filas por tamaño (solo para el % de progreso)
  const approxBytesPerRow = 400;
  return peekableSource(file.name, Math.max(1, Math.round(file.size / approxBytesPerRow)), streamCsvRows(file));
}

async function xlsxStreamSources(file: File): Promise<RowSource[]> {
  const sheets = await openXlsxStream(file);
  const out: RowSource[] = [];
  for (const sh of sheets) {
    out.push(await peekableSource(sh.name, sh.totalRows, sh.rows(XLSX_CHUNK_ROWS)));
  }
  return out;
}

// --------------------------------------------------------------------------
// Envío al servidor
// --------------------------------------------------------------------------
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function postJson(endpoint: string, body: any): Promise<any> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let payload: any = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = null; }
  if (!response.ok) {
    const err: any = new Error(payload?.error ?? (text || `Error HTTP ${response.status}`));
    err.status = response.status;
    throw err;
  }
  return payload;
}

async function postWithRetry(endpoint: string, body: any): Promise<any> {
  let lastErr: any;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await postJson(endpoint, body);
    } catch (e: any) {
      lastErr = e;
      // No reintentar errores de cliente (400/401/403/413): no se arreglan solos
      if (e?.status && e.status >= 400 && e.status < 500 && e.status !== 408 && e.status !== 429) throw e;
      await sleep(1000 * Math.pow(2, attempt));
    }
  }
  throw lastErr;
}

// --------------------------------------------------------------------------
// Pipeline principal
// --------------------------------------------------------------------------
export async function runImport(file: File, opts: ImportOptions = {}): Promise<ImportSummary> {
  const endpoint = opts.endpoint ?? '/api/intel/import';
  const onProgress = opts.onProgress;
  const isCSV = file?.name?.toLowerCase()?.endsWith('.csv');
  const sizeMB = (file.size / 1024 / 1024).toFixed(1);

  onProgress?.({ message: `Leyendo archivo (${sizeMB} MB)...`, percent: 2 });

  const lower = file?.name?.toLowerCase() ?? '';
  const isZipXlsx = lower.endsWith('.xlsx') || lower.endsWith('.xlsm');
  const hasRecognized = (srcs: RowSource[]) => srcs.some((s) => scanHeader(s.peek).recognized);

  let sources: RowSource[];
  try {
    if (isCSV) {
      sources = [await csvSource(file)];
    } else if (isZipXlsx && (opts.forceXlsxStream || file.size > XLSX_STREAM_THRESHOLD_BYTES)) {
      onProgress?.({ message: `Abriendo Excel por partes (${sizeMB} MB)...`, percent: 4 });
      try {
        sources = await xlsxStreamSources(file);
      } catch (streamErr) {
        console.warn('Lector XLSX por streaming falló, se intenta con SheetJS:', streamErr);
        sources = xlsxSources(await file.arrayBuffer());
      }
    } else {
      onProgress?.({ message: `Abriendo Excel (${sizeMB} MB)...`, percent: 4 });
      sources = xlsxSources(await file.arrayBuffer());
      // SheetJS puede devolver hojas vacías sin error: reintentar con el lector por streaming
      if (isZipXlsx && !hasRecognized(sources)) {
        try {
          const alt = await xlsxStreamSources(file);
          if (hasRecognized(alt)) sources = alt;
        } catch { /* conservar resultado de SheetJS */ }
      }
    }
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    throw new Error(
      `No se pudo leer el archivo (${sizeMB} MB): ${msg}. ` +
      (isCSV ? '' : 'Si el Excel es muy grande, guárdelo como "CSV UTF-8" y vuelva a importarlo: el CSV se procesa por partes y usa mucha menos memoria.')
    );
  }

  // --- Detección de encabezados por hoja
  const analyzed = sources.map((src) => {
    const header: HeaderScanResult = scanHeader(src.peek);
    const layout: ColumnLayout = detectColumnLayout(header.headerRow);
    return { src, header, layout };
  });

  const recognized = analyzed.filter((a) => a.header.recognized);
  if (recognized.length === 0) {
    const best = [...analyzed].sort((a, b) => b.header.bestHeaderScore - a.header.bestHeaderScore)[0];
    const headers = best && best.header.normalizedHeader.filter(Boolean).length > 0
      ? best.header.normalizedHeader.filter(Boolean).join(' | ')
      : '(sin encabezados detectados)';
    const diagnostics = analyzed
      .map((a) => {
        const hr = a.header.headerRowIndex >= 0 ? a.header.headerRowIndex + 1 : 'N/A';
        const preview = getPreviewRows(a.src.peek);
        return `- ${a.src.name}: filas=${a.src.totalRows ?? '?'}, encabezado=${hr}, puntaje=${a.header.bestHeaderScore}, primerasFilas=${preview.length ? preview.join(' || ') : '(sin filas no vacías)'}`;
      })
      .join('\n');
    throw new Error(
      `No se encontraron registros válidos para importar. ` +
      `Hoja: "${best?.src.name ?? 'N/A'}". ` +
      `Fila de encabezado detectada: ${best && best.header.headerRowIndex >= 0 ? best.header.headerRowIndex + 1 : 'N/A'}. ` +
      `Encabezados detectados: ${headers}. ` +
      `Columnas esperadas: ${EXPECTED_COLUMNS.join(', ')}.` +
      (diagnostics ? `\nDiagnóstico por hoja:\n${diagnostics}` : '')
    );
  }

  // Hoja principal = reconocida con más filas; se combinan las que tengan la misma estructura
  const best = [...recognized].sort((a, b) =>
    ((b.src.totalRows ?? 0) - (a.src.totalRows ?? 0)) || (b.header.bestHeaderScore - a.header.bestHeaderScore)
  )[0]!;
  const selected = best.header.signature
    ? recognized.filter((a) => a.header.signature === best.header.signature)
    : [best];
  const totalRowsAll = selected.reduce((acc, a) => acc + (a.src.totalRows ?? 0), 0) || 1;

  // --- Estado de envío
  let cleared = Boolean(opts.append);
  let inserted = 0;
  let errors = 0;
  let parsed = 0;
  let batchesSent = 0;
  let rowsSeen = 0;
  const inFlight = new Set<Promise<void>>();
  let fatal: any = null;

  const ensureCleared = async () => {
    if (cleared) return;
    onProgress?.({ message: 'Limpiando datos anteriores...', percent: 6 });
    await postWithRetry(endpoint, { rows: [], clearExisting: true });
    cleared = true;
  };

  const progressPct = () => Math.min(97, 8 + Math.round((rowsSeen / totalRowsAll) * 89));

  const sendBatch = async (rows: SupabaseRow[]) => {
    await ensureCleared();
    while (inFlight.size >= CONCURRENCY) await Promise.race(inFlight);
    if (fatal) throw fatal;
    const p = (async () => {
      try {
        const res = await postWithRetry(endpoint, { rows, clearExisting: false });
        inserted += Number(res?.inserted ?? 0);
        errors += Number(res?.errors ?? 0);
        batchesSent++;
        onProgress?.({
          message: `Importando... ${inserted.toLocaleString()} registros insertados (lote ${batchesSent})`,
          percent: progressPct(),
        });
      } catch (e) {
        fatal = fatal ?? e;
      }
    })();
    inFlight.add(p);
    p.finally(() => inFlight.delete(p));
  };

  let batch: SupabaseRow[] = [];
  let batchBytes = 2;
  const encoder = new TextEncoder();

  const flush = async () => {
    if (batch.length === 0) return;
    const toSend = batch;
    batch = [];
    batchBytes = 2;
    await sendBatch(toSend);
  };

  for (const { src, header, layout } of selected) {
    let rowIndex = 0; // índice relativo al inicio de la hoja (igual que scanHeader)
    for await (const chunk of src.chunks()) {
      for (const row of chunk) {
        const idx = rowIndex++;
        if (idx < header.dataStartRowIndex) continue;
        const rec = processRow(row, idx, layout);
        if (!rec) continue;
        parsed++;
        const sbRow = toSupabaseRow(rec);
        const bytes = encoder.encode(JSON.stringify(sbRow)).length + 1;
        if (batch.length > 0 && (batch.length >= MAX_ROWS_PER_BATCH || batchBytes + bytes > MAX_BATCH_BYTES)) {
          await flush();
        }
        batch.push(sbRow);
        batchBytes += bytes;
      }
      rowsSeen += chunk.length;
      if (fatal) throw fatal;
      // Ceder el control para no congelar (relevante si corre en el hilo principal)
      await sleep(0);
    }
  }
  await flush();
  await Promise.all(inFlight);
  if (fatal) {
    throw new Error(
      `La importación se detuvo tras insertar ${inserted.toLocaleString()} registros: ${String(fatal?.message ?? fatal)}`
    );
  }

  if (parsed === 0) {
    throw new Error(
      `No se encontraron registros válidos para importar. Hoja(s): ${selected.map((s) => s.src.name).join(', ')}. ` +
      `Se encontró el encabezado, pero ninguna fila tenía departamento y coordenadas válidas.`
    );
  }

  const errMsg = errors > 0 ? ` (${errors.toLocaleString()} filas con errores)` : '';
  onProgress?.({ message: `${inserted.toLocaleString()} registros insertados${errMsg}`, percent: 100 });

  return { inserted, errors, parsed, batches: batchesSent, sheets: selected.map((s) => s.src.name) };
}
