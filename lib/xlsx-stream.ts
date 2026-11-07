/**
 * Lector de XLSX por STREAMING (sin cargar el libro completo en memoria).
 *
 * Por qué existe: SheetJS descomprime cada hoja como UNA sola cadena de texto.
 * En hojas de cientos de miles de filas el XML descomprimido supera el tamaño
 * máximo de cadena de JavaScript (~512 MB en V8) y SheetJS devuelve la hoja
 * VACÍA sin lanzar error. Eso produce "sin encabezados detectados" aunque el
 * archivo esté bien.
 *
 * Este lector:
 *  - Lee el directorio central del ZIP con `File.slice` (acceso aleatorio).
 *  - Descomprime cada entrada por partes con fflate (`Inflate` en streaming).
 *  - Carga `sharedStrings.xml` (necesario para resolver textos) y luego recorre
 *    la hoja fila a fila, entregando bloques de filas.
 *
 * Los valores se entregan "crudos" (igual que SheetJS con raw:true): números
 * como number (las fechas llegan como serial de Excel), textos como string.
 */
import { Inflate } from 'fflate';

// --------------------------------------------------------------------------
// ZIP
// --------------------------------------------------------------------------
interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

async function readBytes(file: Blob, start: number, end: number): Promise<Uint8Array> {
  return new Uint8Array(await file.slice(start, end).arrayBuffer());
}

function u16(b: Uint8Array, o: number) { return b[o]! | (b[o + 1]! << 8); }
function u32(b: Uint8Array, o: number) { return (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) >>> 0; }
function u64(b: Uint8Array, o: number) { return u32(b, o) + u32(b, o + 4) * 0x100000000; }

async function readZipEntries(file: Blob): Promise<Map<string, ZipEntry>> {
  const size = file.size;
  const tailLen = Math.min(size, 65557 + 20);
  const tail = await readBytes(file, size - tailLen, size);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (u32(tail, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('El archivo no es un .xlsx válido (ZIP sin directorio central).');

  let cdCount = u16(tail, eocd + 10);
  let cdSize = u32(tail, eocd + 12);
  let cdOffset = u32(tail, eocd + 16);

  // ZIP64
  if (cdOffset === 0xffffffff || cdSize === 0xffffffff || cdCount === 0xffff) {
    const locIdx = eocd - 20;
    if (locIdx >= 0 && u32(tail, locIdx) === 0x07064b50) {
      const z64Offset = u64(tail, locIdx + 8);
      const z64 = await readBytes(file, z64Offset, z64Offset + 56);
      if (u32(z64, 0) === 0x06064b50) {
        cdCount = u64(z64, 32);
        cdSize = u64(z64, 40);
        cdOffset = u64(z64, 48);
      }
    }
  }

  const cd = await readBytes(file, cdOffset, cdOffset + cdSize);
  const entries = new Map<string, ZipEntry>();
  const dec = new TextDecoder('utf-8');
  let p = 0;
  for (let n = 0; n < cdCount && p + 46 <= cd.length; n++) {
    if (u32(cd, p) !== 0x02014b50) break;
    const method = u16(cd, p + 10);
    let compressedSize = u32(cd, p + 20);
    let uncompressedSize = u32(cd, p + 24);
    const nameLen = u16(cd, p + 28);
    const extraLen = u16(cd, p + 30);
    const commentLen = u16(cd, p + 32);
    let localHeaderOffset = u32(cd, p + 42);
    const name = dec.decode(cd.subarray(p + 46, p + 46 + nameLen));

    // Campo extra ZIP64 (tamaños > 4GB)
    let e = p + 46 + nameLen;
    const eEnd = e + extraLen;
    while (e + 4 <= eEnd) {
      const id = u16(cd, e);
      const len = u16(cd, e + 2);
      if (id === 0x0001) {
        let q = e + 4;
        if (uncompressedSize === 0xffffffff) { uncompressedSize = u64(cd, q); q += 8; }
        if (compressedSize === 0xffffffff) { compressedSize = u64(cd, q); q += 8; }
        if (localHeaderOffset === 0xffffffff) { localHeaderOffset = u64(cd, q); q += 8; }
      }
      e += 4 + len;
    }

    entries.set(name.replace(/^\/+/, ''), { name, method, compressedSize, uncompressedSize, localHeaderOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** Devuelve el texto de una entrada del ZIP en trozos (streaming). */
async function* streamEntryText(file: Blob, entry: ZipEntry): AsyncGenerator<string> {
  const lh = await readBytes(file, entry.localHeaderOffset, entry.localHeaderOffset + 30);
  if (u32(lh, 0) !== 0x04034b50) throw new Error(`Cabecera ZIP inválida en ${entry.name}`);
  const dataStart = entry.localHeaderOffset + 30 + u16(lh, 26) + u16(lh, 28);
  const dataEnd = dataStart + entry.compressedSize;

  const decoder = new TextDecoder('utf-8');
  const pending: string[] = [];
  let inflater: Inflate | null = null;
  if (entry.method === 8) {
    inflater = new Inflate((chunk) => {
      if (chunk.length) pending.push(decoder.decode(chunk, { stream: true }));
    });
  } else if (entry.method !== 0) {
    throw new Error(`Compresión ZIP no soportada (${entry.method}) en ${entry.name}`);
  }

  const STEP = 1 << 20; // 1 MB comprimido por lectura
  for (let pos = dataStart; pos < dataEnd; pos += STEP) {
    const end = Math.min(dataEnd, pos + STEP);
    const bytes = await readBytes(file, pos, end);
    const last = end >= dataEnd;
    if (inflater) inflater.push(bytes, last);
    else pending.push(decoder.decode(bytes, { stream: !last }));
    while (pending.length) yield pending.shift()!;
  }
  const rest = decoder.decode();
  if (rest) yield rest;
}

// --------------------------------------------------------------------------
// XML helpers
// --------------------------------------------------------------------------
function decodeXml(s: string): string {
  if (s.indexOf('&') < 0) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_m, g: string) => {
    if (g === 'amp') return '&';
    if (g === 'lt') return '<';
    if (g === 'gt') return '>';
    if (g === 'quot') return '"';
    if (g === 'apos') return "'";
    if (g[1] === 'x') return String.fromCodePoint(parseInt(g.slice(2), 16));
    return String.fromCodePoint(parseInt(g.slice(1), 10));
  });
}

function getAttr(tag: string, name: string): string | null {
  const re = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`);
  const m = re.exec(tag);
  return m ? (m[1] ?? m[2] ?? '') : null;
}

/** Texto de los <t> de un <si>/<is>, ignorando la guía fonética <rPh>. */
function extractRichText(xml: string): string {
  const clean = xml.indexOf('rPh') >= 0 ? xml.replace(/<(?:\w+:)?rPh\b[\s\S]*?<\/(?:\w+:)?rPh>/g, '') : xml;
  let out = '';
  const re = /<(?:\w+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?t>|<(?:\w+:)?t(?:\s[^>]*)?\/>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean))) out += m[1] ?? '';
  return decodeXml(out);
}

/**
 * Recorre un flujo XML y entrega cada elemento <tag>...</tag> completo
 * (también los auto-cerrados <tag .../>). Acepta prefijos de namespace.
 */
async function* iterElements(chunks: AsyncGenerator<string>, tag: string): AsyncGenerator<string> {
  const openRe = new RegExp(`<(?:\\w+:)?${tag}[\\s>/]`, 'g');
  const closeRe = new RegExp(`</(?:\\w+:)?${tag}>`, 'g');
  let buf = '';
  for await (const chunk of chunks) {
    buf += chunk;
    let pos = 0;
    while (true) {
      openRe.lastIndex = pos;
      const om = openRe.exec(buf);
      if (!om) { pos = Math.max(pos, buf.length - (tag.length + 8)); break; }
      const start = om.index;
      const gt = buf.indexOf('>', start);
      if (gt < 0) { pos = start; break; }
      if (buf.charCodeAt(gt - 1) === 47 /* / */) { // auto-cerrado
        yield buf.slice(start, gt + 1);
        pos = gt + 1;
        continue;
      }
      closeRe.lastIndex = gt;
      const cm = closeRe.exec(buf);
      if (!cm) { pos = start; break; }
      const end = cm.index + cm[0].length;
      yield buf.slice(start, end);
      pos = end;
    }
    // Copia plana del resto para no retener el bloque grande
    buf = pos > 0 ? (' ' + buf.slice(pos)).slice(1) : buf;
  }
}

function colToIndex(ref: string): number {
  let n = 0;
  for (let i = 0; i < ref.length; i++) {
    const c = ref.charCodeAt(i);
    if (c >= 65 && c <= 90) n = n * 26 + (c - 64);
    else if (c >= 97 && c <= 122) n = n * 26 + (c - 96);
    else break;
  }
  return n - 1;
}

function decodeRef(ref: string): { r: number; c: number } {
  const m = /^\$?([A-Za-z]+)\$?(\d+)$/.exec(ref);
  if (!m) return { r: -1, c: -1 };
  return { r: parseInt(m[2]!, 10) - 1, c: colToIndex(m[1]!) };
}

// --------------------------------------------------------------------------
// API pública
// --------------------------------------------------------------------------
export interface StreamSheet {
  name: string;
  /** Filas según <dimension> (aprox.), null si no viene. */
  totalRows: number | null;
  /** Recorre las filas en bloques. La primera fila entregada es la primera fila con datos. */
  rows: (chunkSize: number) => AsyncGenerator<any[][]>;
}

export async function openXlsxStream(file: Blob): Promise<StreamSheet[]> {
  const entries = await readZipEntries(file);

  const readWhole = async (path: string): Promise<string | null> => {
    const e = entries.get(path);
    if (!e) return null;
    let s = '';
    for await (const c of streamEntryText(file, e)) s += c;
    return s;
  };

  const workbookXml = await readWhole('xl/workbook.xml');
  if (!workbookXml) throw new Error('El archivo no contiene xl/workbook.xml (¿es realmente .xlsx?).');
  const relsXml = (await readWhole('xl/_rels/workbook.xml.rels')) ?? '';

  // Relaciones id -> ruta
  const rels = new Map<string, string>();
  for (const m of relsXml.matchAll(/<(?:\w+:)?Relationship\b[^>]*>/g)) {
    const id = getAttr(m[0], 'Id');
    let target = getAttr(m[0], 'Target');
    if (!id || !target) continue;
    target = target.replace(/\\/g, '/');
    if (target.startsWith('/')) target = target.slice(1);
    else if (!target.startsWith('xl/')) target = 'xl/' + target;
    rels.set(id, target.replace(/\/\.\//g, '/'));
  }

  // Textos compartidos
  const sst: string[] = [];
  let sstPath = 'xl/sharedStrings.xml';
  for (const [, t] of rels) if (/sharedStrings\d*\.xml$/i.test(t)) sstPath = t;
  const sstEntry = entries.get(sstPath);
  if (sstEntry) {
    for await (const si of iterElements(streamEntryText(file, sstEntry), 'si')) {
      sst.push(extractRichText(si));
    }
  }

  // Hojas en orden del libro
  const sheets: StreamSheet[] = [];
  let idx = 0;
  for (const m of workbookXml.matchAll(/<(?:\w+:)?sheet\b[^>]*>/g)) {
    idx++;
    const tag = m[0];
    const name = decodeXml(getAttr(tag, 'name') ?? `Hoja${idx}`);
    const rid = getAttr(tag, 'r:id') ?? getAttr(tag, 'id');
    let path = rid ? rels.get(rid) : undefined;
    if (!path || !entries.has(path)) path = `xl/worksheets/sheet${idx}.xml`;
    const entry = entries.get(path);
    if (!entry) continue;

    // Leer solo el comienzo para obtener <dimension>
    let head = '';
    for await (const c of streamEntryText(file, entry)) {
      head += c;
      if (head.length > 4096 || /<(?:\w+:)?sheetData/.test(head)) break;
    }
    const dimRef = /<(?:\w+:)?dimension\b[^>]*ref\s*=\s*"([^"]+)"/.exec(head)?.[1] ?? '';
    let totalRows: number | null = null;
    let dimStartCol: number | null = null;
    if (dimRef) {
      const [a, b] = dimRef.split(':');
      const s = decodeRef(a ?? '');
      const e = decodeRef(b ?? a ?? '');
      if (s.r >= 0 && e.r >= 0) totalRows = e.r - s.r + 1;
      if (s.c >= 0) dimStartCol = s.c;
    }

    sheets.push({
      name,
      totalRows,
      rows: (chunkSize: number) => sheetRows(file, entry, sst, chunkSize, dimStartCol),
    });
  }
  return sheets;
}

async function* sheetRows(
  file: Blob,
  entry: ZipEntry,
  sst: string[],
  chunkSize: number,
  dimStartCol: number | null,
): AsyncGenerator<any[][]> {
  let out: any[][] = [];
  let firstRow = -1;
  let nextRow = -1;
  let minCol = dimStartCol ?? 0;

  const cellRe = /<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g;
  const vRe = /<(?:\w+:)?v(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?v>/;

  for await (const rowXml of iterElements(streamEntryText(file, entry), 'row')) {
    const gt = rowXml.indexOf('>');
    const rowTag = rowXml.slice(0, gt + 1);
    const rAttr = getAttr(rowTag, 'r');
    const rowNum = rAttr ? parseInt(rAttr, 10) - 1 : (nextRow < 0 ? 0 : nextRow);

    const row: any[] = [];
    let seqCol = 0;
    let hasValue = false;
    if (!rowTag.endsWith('/>')) {
      cellRe.lastIndex = gt + 1;
      let m: RegExpExecArray | null;
      while ((m = cellRe.exec(rowXml))) {
        const attrs = m[1] ?? '';
        const inner = m[2] ?? '';
        const ref = getAttr(attrs, 'r');
        const col = ref ? decodeRef(ref).c : seqCol;
        seqCol = col + 1;
        const t = getAttr(attrs, 't') ?? 'n';

        let val: any = '';
        if (t === 'inlineStr') {
          val = extractRichText(inner);
        } else {
          const vm = vRe.exec(inner);
          const raw = vm ? vm[1] ?? '' : '';
          if (raw === '') val = '';
          else if (t === 's') val = sst[parseInt(raw, 10)] ?? '';
          else if (t === 'str' || t === 'e' || t === 'd') val = decodeXml(raw);
          else if (t === 'b') val = raw === '1';
          else {
            const n = Number(raw);
            val = Number.isFinite(n) ? n : decodeXml(raw);
          }
        }
        if (val !== '' && val != null) hasValue = true;
        row[col] = val;
      }
    }

    // Ignorar filas vacías ANTES de la primera con datos (como el !ref recalculado)
    if (firstRow < 0) {
      if (!hasValue) continue;
      firstRow = rowNum;
      nextRow = rowNum;
      if (dimStartCol == null) {
        let c0 = 0;
        while (c0 < row.length && (row[c0] === undefined || row[c0] === '')) c0++;
        minCol = c0;
      }
    }

    // Rellenar filas faltantes (equivale a blankrows:true)
    while (nextRow < rowNum) {
      out.push([]);
      nextRow++;
      if (out.length >= chunkSize) { yield out; out = []; }
    }

    const dense: any[] = new Array(Math.max(0, row.length - minCol));
    for (let c = minCol; c < row.length; c++) dense[c - minCol] = row[c] ?? '';
    out.push(dense);
    nextRow = rowNum + 1;
    if (out.length >= chunkSize) { yield out; out = []; }
  }
  if (out.length > 0) yield out;
}
