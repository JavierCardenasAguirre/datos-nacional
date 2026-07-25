import * as XLSX from 'xlsx';
import type { IntelRecord } from '@/contexts/intel-context';
import { normalizeTipologia } from '@/lib/text-normalization';

function parseDMS(grados: any, minutos: any, segundos: any, isLon: boolean): number {
  const g = parseFloat(String(grados ?? 0)) || 0;
  const m = parseFloat(String(minutos ?? 0)) || 0;
  const s = parseFloat(String(segundos ?? 0)) || 0;
  const decimal = g + m / 60 + s / 3600;
  return isLon ? -Math.abs(decimal) : decimal;
}

function parseDate(val: any): string {
  if (!val) return '';
  if (val instanceof Date) return val.toISOString().split('T')[0] ?? '';
  if (typeof val === 'number') {
    try {
      const d = XLSX.SSF.parse_date_code(val);
      if (d) {
        const yr = String(d?.y ?? 2020);
        const mo = String(d?.m ?? 1).padStart(2, '0');
        const dy = String(d?.d ?? 1).padStart(2, '0');
        return `${yr}-${mo}-${dy}`;
      }
    } catch { /* ignore */ }
    return '';
  }
  if (typeof val === 'string') {
    const t = val.trim();
    if (t.startsWith('=')) return '';
    
    // Formato con mes abreviado en español: DD-MMM-YY o DD-MMM-AAAA (p. ej. "20-abr-21")
    const monthMap: Record<string, string> = {
      'ene': '01', 'feb': '02', 'mar': '03', 'abr': '04', 'may': '05', 'jun': '06',
      'jul': '07', 'ago': '08', 'sep': '09', 'oct': '10', 'nov': '11', 'dic': '12'
    };
    const mAbbrev = t.match(/^(\d{1,2})[/\-.]([a-zñ]{3})[/\-.](\d{2,4})$/i);
    if (mAbbrev) {
      const dy = mAbbrev[1] ?? '';
      const monthAbbr = (mAbbrev[2] ?? '').toLowerCase();
      const yr = mAbbrev[3] ?? '';
      const mo = monthMap[monthAbbr];
      if (mo) {
        const fullYear = yr.length === 2 ? `20${yr}` : yr;
        return `${fullYear.padStart(4, '0')}-${mo}-${dy.padStart(2, '0')}`;
      }
    }
    
    // Número de serie de Excel (p. ej. 44168 = fecha). Al copiar desde Excel la
    // fecha suele venir ya formateada, pero si llega el serial lo convertimos.
    // Rango 20000-60000 ≈ años 1954-2064; así no confundimos un año de 4 dígitos.
    if (/^\d{5}$/.test(t)) {
      const serial = parseInt(t, 10);
      if (serial >= 20000 && serial <= 60000) return parseDate(serial);
    }
    // Formato con separadores: DD/MM/AAAA, DD-MM-AAAA, DD.MM.AAAA (formato Colombia).
    // También acepta AAAA/MM/DD o AAAA-MM-DD (ISO con cualquier separador).
    const m = t.match(/^(\d{1,4})[/\-.](\d{1,2})[/\-.](\d{1,4})$/);
    if (m) {
      const a = m[1] ?? '', b = m[2] ?? '', c = m[3] ?? '';
      let yr: string, mo: string, dy: string;
      if (a.length === 4) {
        // AAAA-MM-DD
        yr = a; mo = b; dy = c;
      } else {
        // DD-MM-AAAA (día primero, formato local)
        dy = a; mo = b; yr = c.length === 2 ? `20${c}` : c;
      }
      const moN = parseInt(mo, 10), dyN = parseInt(dy, 10);
      if (moN >= 1 && moN <= 12 && dyN >= 1 && dyN <= 31) {
        return `${yr.padStart(4, '0')}-${mo.padStart(2, '0')}-${dy.padStart(2, '0')}`;
      }
    }
    const parsed = new Date(t);
    if (!isNaN(parsed.getTime())) return parsed.toISOString().split('T')[0] ?? '';
    return t;
  }
  return '';
}

function safeStr(val: any, maxLen: number = 0): string {
  if (val == null) return '';
  const s = String(val).trim();
  if (s.startsWith('=')) return '';
  if (maxLen > 0 && s.length > maxLen) return s.substring(0, maxLen);
  return s;
}

function safeNum(val: any): number {
  if (val == null) return 0;
  const s = String(val).trim();
  if (s.startsWith('=')) return NaN;
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}


interface ColumnLayout {
  deptIdx: number;
  hasBlankAfterMedios: boolean;
}

function detectColumnLayout(row: any[]): ColumnLayout {
  const rowValues = row ?? [];
  const first = safeStr(rowValues[0]);
  const second = safeStr(rowValues[1]);

  const firstUpper = first.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  const secondUpper = second.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();

  const firstIsIndex = first === '' || /^\d+$/.test(first) || ['NO', 'N°', 'NUMERO', 'ID', '#'].includes(firstUpper);
  const secondLooksDeptHeader = secondUpper.includes('DEPARTAMENTO');
  const deptIdx = firstIsIndex && secondLooksDeptHeader ? 1 : 0;

  const mediosIdx = deptIdx + 15;
  const markerAfterMedios = safeStr(rowValues[mediosIdx + 1]);
  const markerGenero = safeStr(rowValues[mediosIdx + 2]);

  const markerGeneroUpper = markerGenero.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  const headerHasGeneroAfterBlank = markerGeneroUpper.includes('GENERO');
  const hasBlankAfterMedios = headerHasGeneroAfterBlank || (markerAfterMedios === '' && markerGenero !== '');

  return { deptIdx, hasBlankAfterMedios };
}

function processRow(row: any[], i: number, layout: ColumnLayout): IntelRecord | null {
  if (!row || (row?.length ?? 0) < 10) return null;

  const d = layout.deptIdx;
  const generoIdx = layout.hasBlankAfterMedios ? d + 17 : d + 16;
  const estructuraIdx = generoIdx + 1;
  const respuestaIdx = generoIdx + 2;
  const accionIdx = generoIdx + 3;
  const resTipoIdx = generoIdx + 4;

  let lat = safeNum(row[d + 9]);
  let lon = safeNum(row[d + 10]);

  if (isNaN(lat) || lat === 0) {
    lat = parseDMS(row[d + 3], row[d + 4], row[d + 5], false);
  }
  if (isNaN(lon) || lon === 0) {
    lon = parseDMS(row[d + 6], row[d + 7], row[d + 8], true);
  }

  if (lat === 0 && lon === 0) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;

  const dept = safeStr(row[d]);
  if (!dept) return null;

  return {
    id: i + 1,
    departamento: dept,
    municipio: safeStr(row[d + 1]),
    vereda: safeStr(row[d + 2], 100),
    latGrados: safeNum(row[d + 3]),
    latMinutos: safeNum(row[d + 4]),
    latSegundos: safeNum(row[d + 5]),
    lonGrados: safeNum(row[d + 6]),
    lonMinutos: safeNum(row[d + 7]),
    lonSegundos: safeNum(row[d + 8]),
    latitud: lat,
    longitud: lon,
    fecha: parseDate(row[d + 11]),
    tipologia: normalizeTipologia(safeStr(row[d + 12])),
    informacionHecho: safeStr(row[d + 13], 200),
    fenomenoCriminalidad: safeStr(row[d + 14]),
    medios: safeStr(row[d + 15]),
    genero: safeStr(row[generoIdx]),
    estructura: safeStr(row[estructuraIdx]),
    respuestaAccion: safeStr(row[respuestaIdx]),
    accionEnemiga: safeStr(row[accionIdx]),
    resTipo: safeStr(row[resTipoIdx]),
  };
}

// ============================================================================
// PEGADO DESDE EXCEL (copiar celdas -> pegar en el dashboard)
// El navegador entrega el portapapeles como texto: columnas separadas por TAB
// y filas separadas por salto de línea. Se reutiliza la misma lógica de
// detección de columnas del importador de Excel para mapear correctamente.
// ============================================================================

// Formato que espera el endpoint /api/intel/records (snake_case)
export interface PastedRecord {
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
  fecha: string;
  tipologia: string;
  informacion_hecho: string;
  fenomeno_criminalidad: string;
  medios: string;
  genero: string;
  estructura: string;
  respuesta_accion: string;
  accion_enemiga: string;
  res_tipo: string;
}

function upper(v: string): string {
  return v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
}

// ¿La primera fila pegada es un encabezado (DEPARTAMENTO, MUNICIPIO...)?
function looksLikeHeaderRow(cells: string[]): boolean {
  const joined = (cells ?? []).map((c) => upper(safeStr(c))).join('|');
  return joined.includes('DEPARTAMENTO') && joined.includes('MUNICIPIO');
}

// Detección de layout usando la fila de ENCABEZADO (la más confiable).
// Localiza la posición exacta de DEPARTAMENTO y de GENERO para saber el
// desplazamiento y si existe la columna en blanco intermedia.
function detectLayoutFromHeader(header: string[]): ColumnLayout {
  const cells = (header ?? []).map((c) => upper(safeStr(c)));
  const deptIdx = Math.max(0, cells.findIndex((c) => c.includes('DEPARTAMENTO')));
  const generoIdx = cells.findIndex((c) => c.includes('GENERO'));

  // Sin blanco: genero = dept + 16. Con blanco (columna intermedia): genero = dept + 17.
  // Si no encontramos GÉNERO en el encabezado, usamos el conteo de columnas.
  const hasBlankAfterMedios = generoIdx >= 0
    ? (generoIdx - deptIdx) === 17
    : (cells.length - deptIdx) >= 22;

  return { deptIdx, hasBlankAfterMedios };
}

// Detección de layout para datos pegados SIN encabezado.
// El departamento SIEMPRE es texto y nunca vacío ni un entero puro, por eso
// podemos distinguir con seguridad si hay una columna índice ("No") al inicio,
// incluso cuando esa columna viene vacía en las filas de datos.
function detectPasteLayout(row: string[]): ColumnLayout {
  const first = safeStr(row?.[0]);
  const second = safeStr(row?.[1]);

  const firstIsIndex = first === '' || /^\d+$/.test(first);
  const secondHasLetters = /[A-Za-zÁÉÍÓÚÑáéíóúñ]/.test(second);
  const deptIdx = firstIsIndex && secondHasLetters ? 1 : 0;

  // Detección por CONTEO de columnas (más confiable que buscar celdas vacías,
  // porque la columna intermedia sin título puede traer datos).
  // De DEPARTAMENTO a RES TIPO hay 22 campos cuando existe la columna intermedia
  // y 21 cuando no existe.
  const fieldsAfterDept = (row?.length ?? 0) - deptIdx;
  const hasBlankAfterMedios = fieldsAfterDept >= 22;

  return { deptIdx, hasBlankAfterMedios };
}

function pastedRowToRecord(row: string[], layout: ColumnLayout): PastedRecord | null {
  if (!row || row.length < 3) return null;

  const d = layout.deptIdx;
  const dept = safeStr(row[d]);
  // Debe tener al menos departamento, municipio o tipología para ser válido
  const muni = safeStr(row[d + 1]);
  const generoIdx = layout.hasBlankAfterMedios ? d + 17 : d + 16;
  const tipo = normalizeTipologia(safeStr(row[d + 12]));

  if (!dept && !muni && !tipo) return null;

  let lat = safeNum(row[d + 9]);
  let lon = safeNum(row[d + 10]);
  if (isNaN(lat) || lat === 0) lat = parseDMS(row[d + 3], row[d + 4], row[d + 5], false);
  if (isNaN(lon) || lon === 0) lon = parseDMS(row[d + 6], row[d + 7], row[d + 8], true);

  return {
    departamento: dept,
    municipio: muni,
    vereda: safeStr(row[d + 2], 100),
    lat_grados: safeNum(row[d + 3]),
    lat_minutos: safeNum(row[d + 4]),
    lat_segundos: safeNum(row[d + 5]),
    lon_grados: safeNum(row[d + 6]),
    lon_minutos: safeNum(row[d + 7]),
    lon_segundos: safeNum(row[d + 8]),
    latitud: lat,
    longitud: lon,
    fecha: parseDate(row[d + 11]),
    tipologia: tipo,
    informacion_hecho: safeStr(row[d + 13], 2000),
    fenomeno_criminalidad: safeStr(row[d + 14]),
    medios: safeStr(row[d + 15]),
    genero: safeStr(row[generoIdx]),
    estructura: safeStr(row[generoIdx + 1]),
    respuesta_accion: safeStr(row[generoIdx + 2]),
    accion_enemiga: safeStr(row[generoIdx + 3]),
    res_tipo: safeStr(row[generoIdx + 4]),
  };
}

/**
 * Convierte el texto del portapapeles de Excel en una matriz de filas/celdas.
 *
 * Excel/Sheets usan TSV: columnas separadas por TAB y filas por salto de línea.
 * PERO cuando una celda contiene saltos de línea, tabs o comillas (típico de la
 * columna "INFORMACIÓN HECHO"), Excel la encierra entre comillas dobles y escapa
 * las comillas internas duplicándolas ("").  Un split ingenuo por "\n" rompería
 * esa celda en varias filas, por eso se usa una máquina de estados que respeta
 * las comillas.
 */
function parseClipboardTable(text: string): string[][] {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const n = normalized.length;

  const endField = () => { row.push(field); field = ''; };
  const endRow = () => { endField(); rows.push(row); row = []; };

  while (i < n) {
    const ch = normalized[i];
    if (inQuotes) {
      if (ch === '"') {
        if (normalized[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    // Fuera de comillas: una comilla al inicio de la celda abre modo comillas
    if (ch === '"' && field === '') { inQuotes = true; i++; continue; }
    if (ch === '\t') { endField(); i++; continue; }
    if (ch === '\n') { endRow(); i++; continue; }
    field += ch; i++;
  }
  // Última celda/fila si el texto no termina en salto de línea
  if (field.length > 0 || row.length > 0) endRow();

  // Descartar filas totalmente vacías
  return rows.filter((r) => r.some((c) => (c ?? '').trim().length > 0));
}

/**
 * Parsea texto pegado desde Excel (TSV) y devuelve registros listos para
 * enviar a /api/intel/records. Ignora encabezados y filas vacías.
 */
export function parsePastedRows(text: string): PastedRecord[] {
  if (!text) return [];

  let rows = parseClipboardTable(text);
  if (rows.length === 0) return [];

  // Si el usuario copió también la fila de encabezado, la usamos para detectar
  // el layout de forma exacta y luego la quitamos de los datos.
  let layout: ColumnLayout;
  if (looksLikeHeaderRow(rows[0] ?? [])) {
    layout = detectLayoutFromHeader(rows[0] ?? []);
    rows = rows.slice(1);
  } else {
    layout = detectPasteLayout(rows[0] ?? []);
  }
  if (rows.length === 0) return [];

  const out: PastedRecord[] = [];
  for (const row of rows) {
    const rec = pastedRowToRecord(row, layout);
    if (rec) out.push(rec);
  }
  return out;
}

export function parseExcelFile(buffer: ArrayBuffer): IntelRecord[] {
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
  const sheetName = workbook?.SheetNames?.[0] ?? '';
  const sheet = workbook?.Sheets?.[sheetName];
  if (!sheet) return [];
  const jsonData: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) ?? [];
  const rows = jsonData?.slice(1) ?? [];
  const records: IntelRecord[] = [];
  const layout = detectColumnLayout(jsonData?.[0] ?? rows?.[0] ?? []);
  for (let i = 0; i < (rows?.length ?? 0); i++) {
    const record = processRow(rows[i], i, layout);
    if (record) records.push(record);
  }
  return records;
}

export function parseCSVFile(text: string): IntelRecord[] {
  const workbook = XLSX.read(text, { type: 'string' });
  const sheetName = workbook?.SheetNames?.[0] ?? '';
  const sheet = workbook?.Sheets?.[sheetName];
  if (!sheet) return [];
  const jsonData: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) ?? [];
  const rows = jsonData?.slice(1) ?? [];
  const records: IntelRecord[] = [];
  const layout = detectColumnLayout(jsonData?.[0] ?? rows?.[0] ?? []);
  for (let i = 0; i < (rows?.length ?? 0); i++) {
    const record = processRow(rows[i], i, layout);
    if (record) records.push(record);
  }
  return records;
}

// Convert compact array from server to IntelRecord
// Server format: [dept,muni,vereda,latG,latM,latS,lonG,lonM,lonS,lat,lon,fecha,
//                 tipologia,infoHecho,fenomeno,medios,genero,estructura,respAccion,accEnemiga,resTipo]
function compactToRecord(arr: any[], id: number): IntelRecord {
  return {
    id,
    departamento: arr[0] ?? '',
    municipio: arr[1] ?? '',
    vereda: arr[2] ?? '',
    latGrados: arr[3] ?? 0,
    latMinutos: arr[4] ?? 0,
    latSegundos: arr[5] ?? 0,
    lonGrados: arr[6] ?? 0,
    lonMinutos: arr[7] ?? 0,
    lonSegundos: arr[8] ?? 0,
    latitud: arr[9] ?? 0,
    longitud: arr[10] ?? 0,
    fecha: arr[11] ?? '',
    tipologia: normalizeTipologia(arr[12] ?? ''),
    informacionHecho: arr[13] ?? '',
    fenomenoCriminalidad: arr[14] ?? '',
    medios: arr[15] ?? '',
    genero: arr[16] ?? '',
    estructura: arr[17] ?? '',
    respuestaAccion: arr[18] ?? '',
    accionEnemiga: arr[19] ?? '',
    resTipo: arr[20] ?? '',
  };
}

export interface ImportProgress {
  message: string;
  percent: number;
}

// Threshold in bytes to use server-side parsing (10 MB)
const SERVER_PARSE_THRESHOLD = 10 * 1024 * 1024;

export async function importFile(
  file: File,
  onProgress?: (progress: ImportProgress) => void,
): Promise<IntelRecord[]> {
  const isCSV = file?.name?.toLowerCase()?.endsWith('.csv');
  const isLargeFile = file.size > SERVER_PARSE_THRESHOLD;

  // Small CSV files: client-side SheetJS
  if (isCSV && !isLargeFile) {
    onProgress?.({ message: 'Leyendo archivo CSV...', percent: 30 });
    const buffer = await file.arrayBuffer();
    const text = new TextDecoder().decode(buffer);
    onProgress?.({ message: 'Procesando CSV...', percent: 60 });
    const records = parseCSVFile(text);
    onProgress?.({ message: 'Listo', percent: 100 });
    return records;
  }

  // Small Excel files: try client-side SheetJS first
  if (!isCSV && !isLargeFile) {
    onProgress?.({ message: 'Procesando archivo Excel...', percent: 30 });
    const buffer = await file.arrayBuffer();
    const records = parseExcelFile(buffer);
    if (records.length > 0) {
      onProgress?.({ message: 'Listo', percent: 100 });
      return records;
    }
    // If SheetJS returned empty, fall through to server-side
  }

  // Large files or SheetJS failure: stream from server
  const sizeMB = (file.size / 1024 / 1024).toFixed(0);
  onProgress?.({ message: `Subiendo archivo (${sizeMB}MB) al servidor...`, percent: 2 });

  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch('/api/parse-excel', {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => 'Error del servidor');
    throw new Error(errText);
  }

  // Read NDJSON stream
  const reader = response.body?.getReader();
  if (!reader) throw new Error('No se pudo leer la respuesta del servidor');

  const decoder = new TextDecoder();
  let buffer = '';
  const allRecords: IntelRecord[] = [];
  let recordId = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // Process complete lines
    let newlineIdx: number;
    while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.substring(0, newlineIdx).trim();
      buffer = buffer.substring(newlineIdx + 1);
      if (!line) continue;

      try {
        const msg = JSON.parse(line);
        if (msg.t === 'p') {
          // Progress update
          onProgress?.({ message: msg.m ?? '', percent: msg.p ?? 0 });
        } else if (msg.t === 'c') {
          // Chunk of compact records
          const rows: any[][] = msg.d ?? [];
          for (let i = 0; i < rows.length; i++) {
            recordId++;
            allRecords.push(compactToRecord(rows[i], recordId));
          }
        } else if (msg.t === 'e') {
          throw new Error(msg.m ?? 'Error del servidor');
        } else if (msg.t === 'd') {
          // Done
          onProgress?.({ message: `${allRecords.length.toLocaleString()} registros cargados`, percent: 100 });
        }
      } catch (parseErr: any) {
        if (parseErr?.message?.includes('Error')) throw parseErr;
        // Skip malformed lines
      }
    }
  }

  if (allRecords.length === 0) {
    throw new Error('No se encontraron registros válidos en el archivo.');
  }

  return allRecords;
}
