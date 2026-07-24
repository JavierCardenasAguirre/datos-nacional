export const dynamic = 'force-dynamic';
export const maxDuration = 300;

import { NextRequest } from 'next/server';
import ExcelJS from 'exceljs';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { normalizeTipologia } from '@/lib/text-normalization';

// Compact record: array of values in fixed order to reduce JSON size ~66%
// Index: [0]=dept, [1]=muni, [2]=vereda, [3]=latG, [4]=latM, [5]=latS,
//        [6]=lonG, [7]=lonM, [8]=lonS, [9]=lat, [10]=lon, [11]=fecha,
//        [12]=tipologia, [13]=infoHecho, [14]=fenomeno, [15]=medios,
//        [16]=genero, [17]=estructura, [18]=respAccion, [19]=accEnemiga, [20]=resTipo

function parseDMS(g: any, m: any, s: any, isLon: boolean): number {
  const gn = parseFloat(String(g ?? 0)) || 0;
  const mn = parseFloat(String(m ?? 0)) || 0;
  const sn = parseFloat(String(s ?? 0)) || 0;
  const dec = gn + mn / 60 + sn / 3600;
  return isLon ? -Math.abs(dec) : dec;
}

function cv(cell: ExcelJS.Cell | undefined): any {
  if (!cell) return '';
  const v = cell.value;
  if (v == null) return '';
  if (typeof v === 'object' && v !== null && 'result' in v) return (v as any).result ?? '';
  if (typeof v === 'object' && v !== null && 'richText' in v) return ((v as any).richText ?? []).map((r: any) => r?.text ?? '').join('');
  return v;
}

function ss(val: any, maxLen: number = 0): string {
  if (val == null) return '';
  if (val instanceof Date) return val.toISOString().split('T')[0] ?? '';
  const s = String(val).trim();
  if (s.startsWith('=')) return '';
  if (maxLen > 0 && s.length > maxLen) return s.substring(0, maxLen);
  return s;
}

function sn(val: any): number {
  if (val == null) return NaN;
  if (typeof val === 'number') return val;
  const s = String(val).trim();
  if (s.startsWith('=')) return NaN;
  return parseFloat(s);
}


interface ColumnLayout {
  deptIdx: number;
  hasBlankAfterMedios: boolean;
}

function detectColumnLayout(row: any[]): ColumnLayout {
  const rowValues = row ?? [];
  const first = ss(rowValues[0]);
  const second = ss(rowValues[1]);

  const firstUpper = first.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  const secondUpper = second.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();

  const firstIsIndex = first === '' || /^\d+$/.test(first) || ['NO', 'N°', 'NUMERO', 'ID', '#'].includes(firstUpper);
  const secondLooksDeptHeader = secondUpper.includes('DEPARTAMENTO');
  const deptIdx = firstIsIndex && secondLooksDeptHeader ? 1 : 0;

  const mediosIdx = deptIdx + 15;
  const markerAfterMedios = ss(rowValues[mediosIdx + 1]);
  const markerGenero = ss(rowValues[mediosIdx + 2]);

  const markerGeneroUpper = markerGenero.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  const headerHasGeneroAfterBlank = markerGeneroUpper.includes('GENERO');
  const hasBlankAfterMedios = headerHasGeneroAfterBlank || (markerAfterMedios === '' && markerGenero !== '');

  return { deptIdx, hasBlankAfterMedios };
}

function pd(val: any): string {
  if (!val) return '';
  if (val instanceof Date) return val.toISOString().split('T')[0] ?? '';
  if (typeof val === 'number') {
    const epoch = new Date(1899, 11, 30);
    const d = new Date(epoch.getTime() + val * 86400000);
    if (!isNaN(d.getTime())) return d.toISOString().split('T')[0] ?? '';
    return '';
  }
  if (typeof val === 'string') {
    if (val.startsWith('=')) return '';
    const p = new Date(val);
    if (!isNaN(p.getTime())) return p.toISOString().split('T')[0] ?? '';
    return val;
  }
  return '';
}

function processRow(cells: any[], layout: ColumnLayout): any[] | null {
  const d = layout.deptIdx;
  const generoIdx = layout.hasBlankAfterMedios ? d + 17 : d + 16;
  const estructuraIdx = generoIdx + 1;
  const respuestaIdx = generoIdx + 2;
  const accionIdx = generoIdx + 3;
  const resTipoIdx = generoIdx + 4;

  const dept = ss(cells[d]);
  if (!dept) return null;

  let lat = sn(cells[d + 9]);
  let lon = sn(cells[d + 10]);
  if (isNaN(lat) || lat === 0) lat = parseDMS(cells[d + 3], cells[d + 4], cells[d + 5], false);
  if (isNaN(lon) || lon === 0) lon = parseDMS(cells[d + 6], cells[d + 7], cells[d + 8], true);
  if (lat === 0 && lon === 0) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;

  return [
    dept, ss(cells[d + 1]), ss(cells[d + 2], 100),
    sn(cells[d + 3])||0, sn(cells[d + 4])||0, sn(cells[d + 5])||0,
    sn(cells[d + 6])||0, sn(cells[d + 7])||0, sn(cells[d + 8])||0,
    lat, lon, pd(cells[d + 11]),
    normalizeTipologia(ss(cells[d + 12])), ss(cells[d + 13], 200), ss(cells[d + 14]),
    ss(cells[d + 15]), ss(cells[generoIdx]), ss(cells[estructuraIdx]),
    ss(cells[respuestaIdx]), ss(cells[accionIdx]), ss(cells[resTipoIdx]),
  ];
}

// CSV parser
function parseCSVLine(line: string, delim: string): string[] {
  const result: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = false;
      } else cur += ch;
    } else {
      if (ch === '"') inQ = true;
      else if (ch === delim) { result.push(cur); cur = ''; }
      else cur += ch;
    }
  }
  result.push(cur);
  return result;
}

export async function POST(req: NextRequest) {
  let tmpFile = '';
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    if (!file) {
      return new Response(JSON.stringify({ error: 'No file' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const fileName = file.name?.toLowerCase() ?? '';
    const isCSV = fileName.endsWith('.csv');
    const arrayBuffer = await file.arrayBuffer();
    const fileSizeMB = (arrayBuffer.byteLength / 1024 / 1024).toFixed(0);

    // Use NDJSON streaming: each line is a JSON object
    // Types: "progress" (status updates), "chunk" (batch of records), "done" (final)
    const encoder = new TextEncoder();
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();

    const sendLine = async (obj: any) => {
      await writer.write(encoder.encode(JSON.stringify(obj) + '\n'));
    };

    // Process in background
    (async () => {
      try {
        let totalRecords = 0;
        const CHUNK_SIZE = 10000;
        let chunk: any[][] = [];

        const flushChunk = async () => {
          if (chunk.length === 0) return;
          await sendLine({ t: 'c', d: chunk });
          totalRecords += chunk.length;
          chunk = [];
        };

        if (isCSV) {
          await sendLine({ t: 'p', m: `Procesando CSV (${fileSizeMB}MB)...`, p: 5 });
          const text = Buffer.from(arrayBuffer).toString('utf-8');
          
          // Count lines for progress estimate
          let lineCount = 0;
          for (let i = 0; i < text.length; i++) { if (text[i] === '\n') lineCount++; }
          
          await sendLine({ t: 'p', m: `${lineCount.toLocaleString()} filas detectadas. Procesando...`, p: 10 });
          
          const firstNL = text.indexOf('\n');
          const firstLine = firstNL > 0 ? text.substring(0, firstNL) : text;
          const delim = (firstLine.split(';').length > firstLine.split(',').length) ? ';' : ',';
          
          let lineStart = 0;
          let isHeader = true;
          let rowIdx = 0;
          let emptyStreak = 0;
          let layout: ColumnLayout = { deptIdx: 1, hasBlankAfterMedios: true };

          for (let i = 0; i <= text.length; i++) {
            if (i === text.length || text[i] === '\n') {
              let lineEnd = i;
              if (lineEnd > 0 && text[lineEnd - 1] === '\r') lineEnd--;
              if (lineEnd > lineStart) {
                const line = text.substring(lineStart, lineEnd);
                if (isHeader) {
                  const headerCells = parseCSVLine(line, delim);
                  layout = detectColumnLayout(headerCells);
                  isHeader = false;
                } else {
                  rowIdx++;
                  const cells = parseCSVLine(line, delim);
                  const deptCell = cells[layout.deptIdx];
                  if (!deptCell || String(deptCell).trim() === '') {
                    emptyStreak++;
                    if (emptyStreak > 50) break;
                  } else {
                    emptyStreak = 0;
                    const rec = processRow(cells, layout);
                    if (rec) chunk.push(rec);
                  }
                  if (rowIdx % CHUNK_SIZE === 0) {
                    await flushChunk();
                    const pct = Math.min(90, Math.round(10 + (rowIdx / lineCount) * 80));
                    await sendLine({ t: 'p', m: `Procesando fila ${rowIdx.toLocaleString()} de ${lineCount.toLocaleString()}...`, p: pct });
                  }
                }
              }
              lineStart = i + 1;
            }
          }
          await flushChunk();

        } else {
          // Excel with ExcelJS streaming
          await sendLine({ t: 'p', m: `Cargando Excel (${fileSizeMB}MB)...`, p: 5 });
          
          tmpFile = path.join(os.tmpdir(), `excel_${Date.now()}.xlsx`);
          fs.writeFileSync(tmpFile, Buffer.from(arrayBuffer));
          
          const estRows = 500000; // estimate for progress
          let rowIdx = 0;
          let isHeader = true;
          let emptyStreak = 0;
          let layout: ColumnLayout = { deptIdx: 1, hasBlankAfterMedios: true };

          const wbReader = new ExcelJS.stream.xlsx.WorkbookReader(
            fs.createReadStream(tmpFile), {}
          );

          for await (const ws of wbReader) {
            await sendLine({ t: 'p', m: 'Leyendo hoja de cálculo...', p: 8 });
            for await (const row of ws) {
              if (isHeader) {
                const headerCells: any[] = [];
                for (let c = 1; c <= 23; c++) headerCells.push(cv(row.getCell(c)));
                layout = detectColumnLayout(headerCells);
                isHeader = false;
                continue;
              }
              rowIdx++;

              const dept = cv(row.getCell(layout.deptIdx + 1));
              if (!dept || String(dept).trim() === '') {
                emptyStreak++;
                if (emptyStreak > 100) break;
                continue;
              }
              emptyStreak = 0;

              const cells: any[] = [];
              for (let c = 1; c <= 23; c++) cells.push(cv(row.getCell(c)));
              
              const rec = processRow(cells, layout);
              if (rec) chunk.push(rec);

              if (rowIdx % CHUNK_SIZE === 0) {
                await flushChunk();
                const pct = Math.min(90, Math.round(10 + (rowIdx / estRows) * 80));
                await sendLine({ t: 'p', m: `Procesando fila ${rowIdx.toLocaleString()} de ~${estRows.toLocaleString()}...`, p: pct });
              }
            }
            break;
          }
          await flushChunk();
          try { fs.unlinkSync(tmpFile); tmpFile = ''; } catch {}
        }

        await sendLine({ t: 'p', m: 'Finalizando...', p: 95 });
        await sendLine({ t: 'd', n: totalRecords });
        await writer.close();
      } catch (err: any) {
        console.error('Stream parse error:', err);
        try {
          await sendLine({ t: 'e', m: err?.message ?? 'Error procesando archivo' });
          await writer.close();
        } catch {}
        if (tmpFile) try { fs.unlinkSync(tmpFile); } catch {}
      }
    })();

    return new Response(readable, {
      headers: {
        'Content-Type': 'application/x-ndjson',
        'Transfer-Encoding': 'chunked',
        'Cache-Control': 'no-cache',
      },
    });
  } catch (err: any) {
    console.error('Parse file error:', err);
    if (tmpFile) try { fs.unlinkSync(tmpFile); } catch {}
    return new Response(JSON.stringify({ error: err?.message ?? 'Error' }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
}
