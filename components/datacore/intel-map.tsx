'use client';

import dynamic from 'next/dynamic';

const MapInner = dynamic(() => import('./map-inner'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full bg-slate-800 flex items-center justify-center">
      <div className="text-cyan-400 text-sm font-mono animate-pulse">CARGANDO MAPA...</div>
    </div>
  ),
});

export default function IntelMap() {
  return <MapInner />;
}
