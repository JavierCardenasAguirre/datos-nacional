import { normalizeTipologia } from '@/lib/text-normalization';

function parseDMS(g: any, m: any, s: any, isLon: boolean): number {
  const gn = parseFloat(String(g ?? 0)) || 0;
  const mn = parseFloat(String(m ?? 0)) || 0;
  const sn2 = parseFloat(String(s ?? 0)) || 0;
  const dec = gn + mn / 60 + sn2 / 3600;
  return isLon ? -Math.abs(dec) : dec;
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

function pd(val: any): string | null {
  if (!val) return null;
  if (val instanceof Date) {
    const iso = val.toISOString().split('T')[0];
    return iso || null;
  }
  if (typeof val === 'number') {
    const epoch = new Date(1899, 11, 30);
    const d = new Date(epoch.getTime() + val * 86400000);
    if (!isNaN(d.getTime())) return d.toISOString().split('T')[0] ?? null;
    return null;
  }
  if (typeof val === 'string') {
    const t = val.trim();
    if (t.startsWith('=')) return null;
    const p = new Date(t);
    if (!isNaN(p.getTime())) return p.toISOString().split('T')[0] ?? null;
    return null;
  }
  return null;
}

export function sanitizeClientRowForImport(r: any): Record<string, any> | null {
  const latG = sn(r?.lat_grados) || 0;
  const latM = sn(r?.lat_minutos) || 0;
  const latS = sn(r?.lat_segundos) || 0;
  const lonG = sn(r?.lon_grados) || 0;
  const lonM = sn(r?.lon_minutos) || 0;
  const lonS = sn(r?.lon_segundos) || 0;

  let lat = sn(r?.latitud);
  let lon = sn(r?.longitud);
  if (isNaN(lat) || lat === 0) lat = parseDMS(latG, latM, latS, false);
  if (isNaN(lon) || lon === 0) lon = parseDMS(lonG, lonM, lonS, true);
  if (lat === 0 && lon === 0) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;

  const out = {
    departamento: ss(r?.departamento),
    municipio: ss(r?.municipio),
    vereda: ss(r?.vereda, 100),
    lat_grados: latG,
    lat_minutos: latM,
    lat_segundos: latS,
    lon_grados: lonG,
    lon_minutos: lonM,
    lon_segundos: lonS,
    latitud: lat,
    longitud: lon,
    fecha: pd(r?.fecha),
    tipologia: normalizeTipologia(ss(r?.tipologia, 200)),
    informacion_hecho: ss(r?.informacion_hecho, 500),
    fenomeno_criminalidad: ss(r?.fenomeno_criminalidad, 200),
    medios: ss(r?.medios, 200),
    genero: ss(r?.genero, 50),
    estructura: ss(r?.estructura, 200),
    respuesta_accion: ss(r?.respuesta_accion, 200),
    accion_enemiga: ss(r?.accion_enemiga, 200),
    res_tipo: ss(r?.res_tipo, 200),
  };

  if (!out.departamento && !out.municipio && !out.tipologia) return null;
  return out;
}
