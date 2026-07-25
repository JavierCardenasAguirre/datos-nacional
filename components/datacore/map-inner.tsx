'use client';

import { useEffect, useRef, useState } from 'react';
import { useIntel } from '@/contexts/intel-context';
import type { MapPoint } from '@/contexts/intel-context';
import { normalizeTipologia } from '@/lib/text-normalization';

const TIPOLOGIA_COLORS: Record<string, string> = {
  'PROTESTA SOCIAL VIOLENTA': '#F97316',
  'PROTESTA SOCIAL PACIFICA': '#FACC15',
  'CAPTURA PERSONA': '#FF4444',
  'NARCOTRAFICO': '#FF9149',
  'TERRORISMO': '#FF0066',
  'EIYM': '#FFD700',
  'ARTEFACTO EXPLOSIVO': '#FF6363',
  'ABIGEATO': '#80D8C3',
  'EXTORSION': '#A19AD3',
  'HOMICIDIO': '#FF90BB',
  'COMBATE': '#FF3399',
  'DESFORESTACION': '#72BF78',
  'EVACUACION': '#60B5FF',
  default: '#FF4444',
};

function getColor(tipologia: string): string {
  const t = normalizeTipologia(tipologia ?? '');
  for (const [key, color] of Object.entries(TIPOLOGIA_COLORS)) {
    if (key !== 'default' && t.includes(key)) return color;
  }
  return TIPOLOGIA_COLORS.default;
}

export default function MapInner() {
  const mapRef = useRef<any>(null);
  const markersLayerRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const leafletRef = useRef<any>(null);
  const [mapReady, setMapReady] = useState(false);
  const { mapPoints, mapInfo, isDataLoaded } = useIntel();

  useEffect(() => {
    if (!containerRef?.current || mapRef?.current) return;
    let cancelled = false;

    async function initMap() {
      const leafletModule = await import('leaflet');
      const L = leafletModule.default || leafletModule;

      if (cancelled || !containerRef.current) return;

      if (!document.querySelector('link[data-leaflet-css]')) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.setAttribute('data-leaflet-css', 'true');
        link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
        document.head.appendChild(link);
      }

      const map = L.map(containerRef.current, {
        center: [5.0, -74.0],
        zoom: 6,
        zoomControl: true,
        attributionControl: false,
        preferCanvas: true,
      });

      const osmUrl = ['https:/', '/{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'].join('');
      L.tileLayer(osmUrl, {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap',
      }).addTo(map);

      mapRef.current = map;
      leafletRef.current = L;
      setMapReady(true);
    }

    initMap();

    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        leafletRef.current = null;
        setMapReady(false);
      }
    };
  }, []);

  useEffect(() => {
    const map = mapRef?.current;
    const L = leafletRef?.current;
    if (!map || !L || !mapReady) return;

    if (markersLayerRef?.current) {
      map.removeLayer(markersLayerRef.current);
    }

    const layerGroup = L.layerGroup();
    const points = mapPoints ?? [];

    // --- DISPERSIÓN (jitter) de puntos apilados -------------------------------
    // Algunos registros del origen traen coordenadas con precisión de solo
    // GRADOS (sin minutos/segundos), así que decenas de incidentes caen EXACTO
    // en el mismo punto y se veía un único marcador. Para que se puedan ver y
    // contar todos, a los que comparten la misma coordenada les aplicamos un
    // pequeño desplazamiento determinista en espiral alrededor del punto real.
    const keyOf = (lat: number, lon: number) => `${lat.toFixed(4)},${lon.toFixed(4)}`;
    const groupCounts = new Map<string, number>();
    for (const pt of points) {
      const lat = pt.latitud, lon = pt.longitud;
      if (lat == null || lon == null || isNaN(lat) || isNaN(lon)) continue;
      if (lat === 0 && lon === 0) continue;
      const k = keyOf(lat, lon);
      groupCounts.set(k, (groupCounts.get(k) ?? 0) + 1);
    }
    const groupIndex = new Map<string, number>();
    const GOLDEN_ANGLE = 2.399963229728653; // radianes (~137.5°): reparte parejo
    const JITTER_STEP = 0.012;               // ~1.3 km por "anillo" de la espiral

    for (const pt of points) {
      const baseLat = pt.latitud;
      const baseLon = pt.longitud;
      if (baseLat == null || baseLon == null || isNaN(baseLat) || isNaN(baseLon)) continue;
      if (baseLat === 0 && baseLon === 0) continue;

      let lat = baseLat;
      let lon = baseLon;
      const k = keyOf(baseLat, baseLon);
      if ((groupCounts.get(k) ?? 0) > 1) {
        const idx = groupIndex.get(k) ?? 0;
        groupIndex.set(k, idx + 1);
        // Espiral de Fermat: radio ~ sqrt(idx) para densidad uniforme.
        const radius = JITTER_STEP * Math.sqrt(idx);
        const angle = idx * GOLDEN_ANGLE;
        lat = baseLat + radius * Math.cos(angle);
        // corrige el achatamiento por longitud según la latitud
        const cosLat = Math.cos((baseLat * Math.PI) / 180) || 1;
        lon = baseLon + (radius * Math.sin(angle)) / cosLat;
      }

      const color = getColor(pt.tipologia ?? '');

      const circle = L.circleMarker([lat, lon], {
        radius: 4,
        fillColor: color,
        color: color,
        weight: 1,
        opacity: 0.8,
        fillOpacity: 0.6,
      });

      circle.bindPopup(
        `<div style="font-family:'DM Sans',sans-serif;color:#1e293b;background:#ffffff;padding:10px;border-radius:8px;min-width:220px;border:1px solid #e2e8f0;box-shadow:0 4px 12px rgba(0,0,0,0.15);">
          <div style="color:#0891b2;font-weight:bold;font-size:13px;margin-bottom:6px;">${pt.municipio ?? 'N/A'}</div>
          <div style="font-size:11px;color:#475569;margin-bottom:3px;"><b>Depto:</b> ${pt.departamento ?? 'N/A'}</div>
          <div style="font-size:11px;color:#475569;margin-bottom:3px;"><b>Fecha:</b> ${pt.fecha ?? 'N/A'}</div>
          <div style="font-size:11px;color:#475569;margin-bottom:3px;"><b>Tipologia:</b> ${pt.tipologia ?? 'N/A'}</div>
          <div style="font-size:11px;color:#475569;margin-bottom:3px;"><b>Fenomeno:</b> ${(pt.fenomeno_criminalidad ?? 'N/A').substring(0, 80)}</div>
          <div style="font-size:11px;color:#475569;margin-bottom:3px;"><b>Estructura:</b> ${(pt.estructura ?? 'N/A').substring(0, 60)}</div>
          <div style="font-size:10px;color:#64748b;margin-top:5px;max-height:60px;overflow-y:auto;">${(pt.informacion_hecho ?? '').substring(0, 200)}</div>
        </div>`,
        { maxWidth: 320 }
      );

      layerGroup.addLayer(circle);
    }

    layerGroup.addTo(map);
    markersLayerRef.current = layerGroup;

    // Fit bounds
    if (points.length > 0) {
      const validCoords = points
        .filter(r => r.latitud && r.longitud && !isNaN(r.latitud) && !isNaN(r.longitud) && !(r.latitud === 0 && r.longitud === 0))
        .slice(0, 5000)
        .map(r => [r.latitud, r.longitud] as [number, number]);
      if (validCoords.length > 0) {
        try {
          map.fitBounds(L.latLngBounds(validCoords), { padding: [20, 20], maxZoom: 10 });
        } catch { /* ignore */ }
      }
    }
  }, [mapPoints, mapReady]);

  return (
    <div className="w-full h-full relative">
      {!mapReady && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-800 z-10">
          <div className="text-center">
            <div className="w-8 h-8 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-cyan-400 font-mono text-sm">CARGANDO MAPA...</p>
          </div>
        </div>
      )}
      {mapInfo && mapInfo.total > 0 && (
        <div className="absolute top-2 right-2 z-20 bg-white/90 text-slate-700 text-[10px] font-mono px-2 py-1 rounded border border-slate-300 shadow-sm">
          {mapInfo.displayed < mapInfo.total
            ? `Mostrando ${mapInfo.displayed.toLocaleString()} de ${mapInfo.total.toLocaleString()} puntos`
            : `${mapInfo.total.toLocaleString()} puntos`}
        </div>
      )}
      <div ref={containerRef} className="w-full h-full" />
      <style jsx global>{`
        .leaflet-popup-content-wrapper { background: transparent !important; box-shadow: none !important; padding: 0 !important; }
        .leaflet-popup-tip { background: #ffffff !important; }
        .leaflet-popup-content { margin: 0 !important; }
      `}</style>
    </div>
  );
}
