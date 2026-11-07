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
  let s = String(val).trim();
  if (s === '') return 0;
  if (s.startsWith('=')) return NaN;
  // IMPORTANTE: los datos vienen en formato es-CO, donde la COMA es el separador
  // decimal (ej. "7,753888889"). `parseFloat` corta en la coma y devolvía 7, lo
  // que colapsaba TODAS las coordenadas a grados enteros (por eso se apilaban en
  // un solo punto del mapa). Aquí normalizamos la coma a punto antes de parsear.
  if (s.includes(',') && !s.includes('.')) {
    // "7,7538"  ->  "7.7538"   (coma = separador decimal)
    s = s.replace(/,/g, '.');
  } else if (s.includes(',') && s.includes('.')) {
    // "1.234,56" -> la coma es decimal y el punto es separador de miles
    s = s.replace(/\./g, '').replace(',', '.');
  }
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
    tipologia: normalizeTipologia(safeStr(row[d + 12], 200)),
    informacionHecho: safeStr(row[d + 13], 500),
    fenomenoCriminalidad: safeStr(row[d + 14], 200),
    medios: safeStr(row[d + 15], 200),
    genero: safeStr(row[generoIdx], 50),
    estructura: safeStr(row[estructuraIdx], 200),
    respuestaAccion: safeStr(row[respuestaIdx], 200),
    accionEnemiga: safeStr(row[accionIdx], 200),
    resTipo: safeStr(row[resTipoIdx], 200),
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

const EXPECTED_COLUMNS = [
  'DEPARTAMENTO', 'MUNICIPIO', 'VEREDA',
  'LAT GRADOS', 'LAT MINUTOS', 'LAT SEGUNDOS',
  'LON GRADOS', 'LON MINUTOS', 'LON SEGUNDOS',
  'LATITUD', 'LONGITUD', 'FECHA', 'TIPOLOGIA',
  'INFORMACION HECHO', 'FENOMENO CRIMINALIDAD', 'MEDIOS',
  'GENERO', 'ESTRUCTURA', 'RESPUESTA ACCION', 'ACCION ENEMIGA', 'RES TIPO',
];

const HEADER_TOKENS = [
  'DEPARTAMENTO', 'MUNICIPIO', 'TIPOLOGIA', 'FENOMENO', 'FENOMENO CRIMINALIDAD',
  'ESTRUCTURA', 'GENERO', 'RESPUESTA', 'ACCION', 'VEREDA',
  'LAT GRADOS', 'LAT MINUTOS', 'LAT SEGUNDOS', 'LON GRADOS', 'LON MINUTOS', 'LON SEGUNDOS',
  'LATITUD', 'LONGITUD', 'INFORMACION HECHO', 'MEDIOS', 'RES TIPO',
];

const MAX_HEADER_SCAN_ROWS = 200;
const MIN_HEADER_SCORE = 2;

export interface SheetDiagnostic {
  sheetName: string;
  totalRows: number;
  headerRowIndex: number;
  bestHeaderScore: number;
  previewRows: string[];
}

export interface ParseDebugInfo {
  sheetName: string;
  detectedHeaderRowIndex: number;
  detectedHeader: string[];
  expectedColumns: string[];
  totalRowsRead: number;
  matchedSheets?: string[];
  sheetDiagnostics?: SheetDiagnostic[];
}

export interface ParseResult {
  records: IntelRecord[];
  debug: ParseDebugInfo;
}

interface HeaderScanResult {
  headerRowIndex: number;
  dataStartRowIndex: number;
  headerRow: any[];
  bestHeaderScore: number;
  normalizedHeader: string[];
  recognized: boolean;
  signature: string;
}

interface ParsedSheetResult {
  sheetName: string;
  rows: any[][];
  records: IntelRecord[];
  header: HeaderScanResult;
  diagnostic: SheetDiagnostic;
}

function extractCellValue(v: any): string {
  if (v == null) return '';
  if (typeof v === 'object') {
    const richText = (v as any).richText;
    if (Array.isArray(richText)) {
      return richText.map((p: any) => safeStr(p?.text)).join('');
    }
    if (typeof (v as any).w === 'string' && (v as any).w.trim()) return String((v as any).w);
    if ((v as any).v != null) return String((v as any).v);
    return safeStr(v);
  }
  return String(v);
}

function normalizeHeaderCell(v: any): string {
  return extractCellValue(v)
    .replace(/\u00A0/g, ' ')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[._]+/g, ' ')
    .replace(/\s*\/\s*/g, ' ')
    .replace(/\s+-\s+/g, ' ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9 ]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function normalizeHeaderRow(row: any[]): string[] {
  return (row ?? []).map(normalizeHeaderCell);
}

function combineHeaderRows(rowA: any[], rowB: any[]): any[] {
  const maxLen = Math.max(rowA?.length ?? 0, rowB?.length ?? 0);
  const out: string[] = [];
  for (let i = 0; i < maxLen; i++) {
    const a = normalizeHeaderCell(rowA?.[i]);
    const b = normalizeHeaderCell(rowB?.[i]);
    out.push([a, b].filter(Boolean).join(' ').trim());
  }
  return out;
}

function headerScore(normalizedRow: string[]): number {
  const norm = (normalizedRow ?? []).filter(Boolean);
  if (norm.length === 0) return -1;
  const joined = norm.join(' | ');
  let score = 0;
  for (const token of HEADER_TOKENS) {
    if (joined.includes(token)) score += 1;
  }
  if (joined.includes('DEPARTAMENTO')) score += 2;
  if (joined.includes('MUNICIPIO')) score += 2;
  if (joined.includes('LATITUD')) score += 1;
  if (joined.includes('LONGITUD')) score += 1;
  return score;
}

function headerLooksRecognizable(normalizedRow: string[], score: number): boolean {
  if (score < MIN_HEADER_SCORE) return false;
  const joined = normalizedRow.join(' | ');
  const hasCore = joined.includes('DEPARTAMENTO') || joined.includes('MUNICIPIO');
  const hasGeo = joined.includes('LATITUD') || joined.includes('LONGITUD') || joined.includes('LAT GRADOS');
  return hasCore && (hasGeo || score >= 4);
}

function headerFingerprint(normalizedRow: string[]): string {
  const joined = normalizedRow.join(' | ');
  const markers = [
    'DEPARTAMENTO', 'MUNICIPIO', 'VEREDA', 'LAT GRADOS', 'LAT MINUTOS', 'LAT SEGUNDOS',
    'LON GRADOS', 'LON MINUTOS', 'LON SEGUNDOS', 'LATITUD', 'LONGITUD', 'FECHA', 'TIPOLOGIA',
    'INFORMACION HECHO', 'FENOMENO CRIMINALIDAD', 'MEDIOS', 'GENERO', 'ESTRUCTURA',
    'RESPUESTA ACCION', 'ACCION ENEMIGA', 'RES TIPO',
  ];
  const present = markers.filter((m) => joined.includes(m));
  return present.join('|');
}

function scanHeader(rows: any[][]): HeaderScanResult {
  const maxScan = Math.min(rows.length, MAX_HEADER_SCAN_ROWS);
  let best: HeaderScanResult = {
    headerRowIndex: -1,
    dataStartRowIndex: -1,
    headerRow: [],
    bestHeaderScore: -1,
    normalizedHeader: [],
    recognized: false,
    signature: '',
  };

  for (let i = 0; i < maxScan; i++) {
    const row = rows[i] ?? [];
    const normSingle = normalizeHeaderRow(row);
    const singleScore = headerScore(normSingle);
    if (singleScore > best.bestHeaderScore) {
      best = {
        headerRowIndex: i,
        dataStartRowIndex: i + 1,
        headerRow: row,
        bestHeaderScore: singleScore,
        normalizedHeader: normSingle,
        recognized: headerLooksRecognizable(normSingle, singleScore),
        signature: headerFingerprint(normSingle),
      };
    }

    if (i + 1 < maxScan) {
      const nextRow = rows[i + 1] ?? [];
      const nextNorm = normalizeHeaderRow(nextRow);
      const nextScore = headerScore(nextNorm);
      const combined = combineHeaderRows(row, nextRow);
      const combinedScore = headerScore(combined);
      if (combinedScore > best.bestHeaderScore) {
        const useNextAsHeader = singleScore <= 0 && nextScore >= (combinedScore - 1);
        const selectedHeaderRowIndex = useNextAsHeader ? (i + 1) : i;
        const selectedNormalizedHeader = useNextAsHeader ? nextNorm : combined;
        const selectedHeaderRow = useNextAsHeader ? nextRow : combined;
        const selectedScore = useNextAsHeader ? nextScore : combinedScore;

        best = {
          headerRowIndex: selectedHeaderRowIndex,
          dataStartRowIndex: i + 2,
          headerRow: selectedHeaderRow,
          bestHeaderScore: selectedScore,
          normalizedHeader: selectedNormalizedHeader,
          recognized: headerLooksRecognizable(selectedNormalizedHeader, selectedScore),
          signature: headerFingerprint(selectedNormalizedHeader),
        };
      }
    }
  }

  return best;
}

function recalculateSheetRef(sheet: XLSX.WorkSheet): void {
  const keys = Object.keys(sheet ?? {}).filter((k) => !k.startsWith('!'));
  if (keys.length === 0) return;

  let minR = Number.POSITIVE_INFINITY;
  let minC = Number.POSITIVE_INFINITY;
  let maxR = -1;
  let maxC = -1;

  for (const key of keys) {
    try {
      const decoded = XLSX.utils.decode_cell(key);
      if (Number.isFinite(decoded.r) && Number.isFinite(decoded.c)) {
        minR = Math.min(minR, decoded.r);
        minC = Math.min(minC, decoded.c);
        maxR = Math.max(maxR, decoded.r);
        maxC = Math.max(maxC, decoded.c);
      }
    } catch {
      // Ignorar claves que no sean coordenadas de celdas
    }
  }

  if (maxR >= 0 && maxC >= 0 && Number.isFinite(minR) && Number.isFinite(minC)) {
    sheet['!ref'] = XLSX.utils.encode_range({ s: { r: minR, c: minC }, e: { r: maxR, c: maxC } });
  }
}

function getPreviewRows(rows: any[][], maxRows: number = 3): string[] {
  const preview: string[] = [];
  for (const row of rows) {
    const cells = (row ?? [])
      .map((c) => safeStr(extractCellValue(c)))
      .filter(Boolean);
    if (cells.length === 0) continue;
    preview.push(cells.slice(0, 8).join(' | '));
    if (preview.length >= maxRows) break;
  }
  return preview;
}

function parseGrid(rows: any[][], sheetName: string): ParsedSheetResult {
  const safeRows = rows ?? [];
  if (safeRows.length === 0) {
    return {
      sheetName,
      rows: safeRows,
      records: [],
      header: {
        headerRowIndex: -1,
        dataStartRowIndex: -1,
        headerRow: [],
        bestHeaderScore: -1,
        normalizedHeader: [],
        recognized: false,
        signature: '',
      },
      diagnostic: {
        sheetName,
        totalRows: 0,
        headerRowIndex: -1,
        bestHeaderScore: -1,
        previewRows: [],
      },
    };
  }

  const header = scanHeader(safeRows);
  const layout = detectColumnLayout(header.headerRow);

  const dataRows = header.dataStartRowIndex >= 0
    ? safeRows.slice(header.dataStartRowIndex)
    : [];

  const records: IntelRecord[] = [];
  for (let i = 0; i < dataRows.length; i++) {
    const record = processRow(dataRows[i], i, layout);
    if (record) records.push(record);
  }

  return {
    sheetName,
    rows: safeRows,
    records,
    header,
    diagnostic: {
      sheetName,
      totalRows: safeRows.length,
      headerRowIndex: header.headerRowIndex,
      bestHeaderScore: header.bestHeaderScore,
      previewRows: getPreviewRows(safeRows),
    },
  };
}

function emptyParseResult(): ParseResult {
  return {
    records: [],
    debug: {
      sheetName: '',
      detectedHeaderRowIndex: -1,
      detectedHeader: [],
      expectedColumns: EXPECTED_COLUMNS,
      totalRowsRead: 0,
      matchedSheets: [],
      sheetDiagnostics: [],
    },
  };
}

export function parseExcelFileDetailed(buffer: ArrayBuffer): ParseResult {
  const workbook = XLSX.read(buffer, {
    type: 'array',
    cellDates: true,
    raw: false,
    dense: false,
  });

  const sheetNames = workbook?.SheetNames ?? [];
  if (sheetNames.length === 0) return emptyParseResult();

  const parsedSheets: ParsedSheetResult[] = [];
  for (const sheetName of sheetNames) {
    const sheet = workbook?.Sheets?.[sheetName];
    if (!sheet) continue;
    recalculateSheetRef(sheet);
    const rows: any[][] = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: '',
      raw: false,
      blankrows: true,
    }) ?? [];
    parsedSheets.push(parseGrid(rows, sheetName));
  }

  if (parsedSheets.length === 0) return emptyParseResult();

  const diagnostics = parsedSheets.map((s) => s.diagnostic);

  const recognizedSheets = parsedSheets.filter((s) => s.header.recognized);
  const candidates = (recognizedSheets.length > 0 ? recognizedSheets : parsedSheets)
    .sort((a, b) => {
      if (b.records.length !== a.records.length) return b.records.length - a.records.length;
      return b.header.bestHeaderScore - a.header.bestHeaderScore;
    });

  const best = candidates[0];
  if (!best) {
    return {
      records: [],
      debug: {
        sheetName: '',
        detectedHeaderRowIndex: -1,
        detectedHeader: [],
        expectedColumns: EXPECTED_COLUMNS,
        totalRowsRead: 0,
        matchedSheets: [],
        sheetDiagnostics: diagnostics,
      },
    };
  }

  const signature = best.header.signature;
  const mergeable = recognizedSheets.filter((s) => {
    if (!s.header.recognized) return false;
    if (!signature) return s.sheetName === best.sheetName;
    return s.header.signature === signature;
  });

  const selectedSheets = mergeable.length > 0 ? mergeable : [best];
  let recordId = 1;
  const mergedRecords: IntelRecord[] = [];
  for (const selected of selectedSheets) {
    for (const rec of selected.records) {
      mergedRecords.push({ ...rec, id: recordId++ });
    }
  }

  return {
    records: mergedRecords,
    debug: {
      sheetName: best.sheetName,
      detectedHeaderRowIndex: best.header.headerRowIndex,
      detectedHeader: best.header.normalizedHeader.filter(Boolean),
      expectedColumns: EXPECTED_COLUMNS,
      totalRowsRead: best.rows.length,
      matchedSheets: selectedSheets.map((s) => s.sheetName),
      sheetDiagnostics: diagnostics,
    },
  };
}

export function parseExcelFile(buffer: ArrayBuffer): IntelRecord[] {
  return parseExcelFileDetailed(buffer).records;
}

export function parseCSVFileDetailed(text: string): ParseResult {
  const workbook = XLSX.read(text, { type: 'string', raw: false, dense: false });
  const sheetName = workbook?.SheetNames?.[0] ?? '';
  const sheet = workbook?.Sheets?.[sheetName];
  if (!sheet) {
    return {
      records: [],
      debug: {
        sheetName,
        detectedHeaderRowIndex: -1,
        detectedHeader: [],
        expectedColumns: EXPECTED_COLUMNS,
        totalRowsRead: 0,
        matchedSheets: [],
        sheetDiagnostics: [],
      },
    };
  }

  recalculateSheetRef(sheet);
  const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false, blankrows: true }) ?? [];
  const parsed = parseGrid(rows, sheetName);

  return {
    records: parsed.records,
    debug: {
      sheetName,
      detectedHeaderRowIndex: parsed.header.headerRowIndex,
      detectedHeader: parsed.header.normalizedHeader.filter(Boolean),
      expectedColumns: EXPECTED_COLUMNS,
      totalRowsRead: rows.length,
      matchedSheets: [sheetName],
      sheetDiagnostics: [parsed.diagnostic],
    },
  };
}

export function parseCSVFile(text: string): IntelRecord[] {
  return parseCSVFileDetailed(text).records;
}

export interface ImportProgress {
  message: string;
  percent: number;
}

export async function importFile(
  file: File,
  onProgress?: (progress: ImportProgress) => void,
): Promise<IntelRecord[]> {
  const isCSV = file?.name?.toLowerCase()?.endsWith('.csv');

  onProgress?.({ message: `Leyendo archivo (${(file.size / 1024 / 1024).toFixed(1)} MB)...`, percent: 15 });
  const buffer = await file.arrayBuffer();

  let result: ParseResult;
  if (isCSV) {
    const text = new TextDecoder().decode(buffer);
    onProgress?.({ message: 'Procesando CSV en el navegador...', percent: 60 });
    result = parseCSVFileDetailed(text);
  } else {
    onProgress?.({ message: 'Procesando Excel en el navegador...', percent: 60 });
    result = parseExcelFileDetailed(buffer);
  }

  if (result.records.length === 0) {
    const headers = result.debug.detectedHeader.length > 0
      ? result.debug.detectedHeader.join(' | ')
      : '(sin encabezados detectados)';
    const expected = result.debug.expectedColumns.join(', ');
    const diagnostics = (result.debug.sheetDiagnostics ?? [])
      .map((s) => {
        const headerRow = s.headerRowIndex >= 0 ? (s.headerRowIndex + 1) : 'N/A';
        const preview = s.previewRows.length > 0 ? s.previewRows.join(' || ') : '(sin filas no vacías)';
        return `- ${s.sheetName}: filas=${s.totalRows}, encabezado=${headerRow}, puntaje=${s.bestHeaderScore}, primerasFilas=${preview}`;
      })
      .join('\n');

    throw new Error(
      `No se encontraron registros válidos para importar. ` +
      `Hoja: "${result.debug.sheetName || 'N/A'}". ` +
      `Fila de encabezado detectada: ${result.debug.detectedHeaderRowIndex >= 0 ? (result.debug.detectedHeaderRowIndex + 1) : 'N/A'}. ` +
      `Encabezados detectados: ${headers}. ` +
      `Columnas esperadas: ${expected}.` +
      (diagnostics ? `\nDiagnóstico por hoja:\n${diagnostics}` : '')
    );
  }

  onProgress?.({ message: `${isCSV ? 'CSV' : 'Excel'} procesado (${result.records.length.toLocaleString()} filas válidas)`, percent: 100 });
  return result.records;
}
