'use client';

import { useIntel } from '@/contexts/intel-context';
import { FileText, Download } from 'lucide-react';
import { useState, useCallback } from 'react';
import { toast } from 'sonner';

export default function PdfReportButton() {
  const { stats, filters, isDataLoaded } = useIntel();
  const [generating, setGenerating] = useState(false);

  const generatePDF = useCallback(async () => {
    if (!isDataLoaded || !stats) return;
    setGenerating(true);
    toast.info('Generando informe PDF...');

    try {
      const [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([
        import('jspdf'),
        import('html2canvas'),
      ]);

      const doc = new jsPDF('p', 'mm', 'a4');
      const pageWidth = doc.internal.pageSize.getWidth();
      const now = new Date();
      let y = 15;

      // Header
      doc.setFillColor(10, 15, 28);
      doc.rect(0, 0, pageWidth, 35, 'F');
      doc.setTextColor(0, 217, 255);
      doc.setFontSize(22);
      doc.setFont('helvetica', 'bold');
      doc.text('DATACORE INTEL', pageWidth / 2, 18, { align: 'center' });
      doc.setFontSize(10);
      doc.setTextColor(148, 163, 184);
      doc.text('INFORME DE INTELIGENCIA', pageWidth / 2, 26, { align: 'center' });
      doc.setFontSize(8);
      doc.text(`Generado: ${now.toLocaleDateString('es-CO')} ${now.toLocaleTimeString('es-CO')}`, pageWidth / 2, 32, { align: 'center' });
      y = 42;

      // Date range
      doc.setTextColor(0, 217, 255);
      doc.setFontSize(11);
      doc.text('RANGO DE ANÁLISIS', 15, y);
      y += 6;
      doc.setTextColor(80, 80, 80);
      doc.setFontSize(9);
      doc.text(`Desde: ${filters?.fechaInicio || 'Todos'} | Hasta: ${filters?.fechaFin || 'Todos'}`, 15, y);
      doc.text(`Departamento: ${filters?.departamento || 'Todos'} | Municipio: ${filters?.municipio || 'Todos'}`, 15, y + 5);
      doc.text(`Total de registros: ${(stats.totalCount ?? 0).toLocaleString()}`, 15, y + 10);
      y += 20;

      // Capture map screenshot
      try {
        const mapEl = document.querySelector('.leaflet-container') as HTMLElement;
        if (mapEl) {
          const canvas = await html2canvas(mapEl, { backgroundColor: '#0A0F1C', scale: 1.5 });
          const imgData = canvas.toDataURL('image/png');
          const imgW = pageWidth - 30;
          const imgH = (canvas.height / canvas.width) * imgW;
          doc.setTextColor(0, 217, 255);
          doc.setFontSize(11);
          doc.text('MAPA DE INCIDENTES', 15, y);
          y += 4;
          doc.addImage(imgData, 'PNG', 15, y, imgW, Math.min(imgH, 80));
          y += Math.min(imgH, 80) + 8;
        }
      } catch { /* map screenshot failed */ }

      // Top Municipios
      const topMunicipios = (stats.municipios ?? []).slice(0, 5);
      if (y > 240) { doc.addPage(); y = 15; }
      doc.setTextColor(0, 217, 255);
      doc.setFontSize(11);
      doc.text('ZONAS DE MAYOR RIESGO', 15, y);
      y += 6;
      doc.setTextColor(60, 60, 60);
      doc.setFontSize(9);
      for (const m of topMunicipios) {
        doc.text(`• ${m.name}: ${m.count} incidentes`, 20, y);
        y += 5;
      }
      y += 5;

      // Top Tipologias
      const topTipologias = (stats.tipologias ?? []).slice(0, 5);
      if (y > 240) { doc.addPage(); y = 15; }
      doc.setTextColor(0, 217, 255);
      doc.setFontSize(11);
      doc.text('TIPOLOGÍAS MÁS FRECUENTES', 15, y);
      y += 6;
      doc.setTextColor(60, 60, 60);
      doc.setFontSize(9);
      for (const t of topTipologias) {
        doc.text(`• ${t.name}: ${t.count} casos`, 20, y);
        y += 5;
      }
      y += 5;

      // Recommendations
      if (y > 220) { doc.addPage(); y = 15; }
      doc.setTextColor(0, 217, 255);
      doc.setFontSize(11);
      doc.text('RECOMENDACIONES DE SEGURIDAD', 15, y);
      y += 6;
      doc.setTextColor(60, 60, 60);
      doc.setFontSize(8);
      for (const rec of (stats.recomendaciones ?? [])) {
        const lines = doc.splitTextToSize(rec, pageWidth - 35);
        if (y + lines.length * 4 > 280) { doc.addPage(); y = 15; }
        doc.text(lines, 15, y);
        y += lines.length * 4 + 3;
      }

      // Correlaciones
      if (y > 220) { doc.addPage(); y = 15; }
      y += 5;
      doc.setTextColor(0, 217, 255);
      doc.setFontSize(11);
      doc.text('CORRELACIONES FENÓMENO - ESTRUCTURA', 15, y);
      y += 6;
      doc.setTextColor(60, 60, 60);
      doc.setFontSize(8);
      for (const c of (stats.correlaciones ?? []).slice(0, 8)) {
        const text = `${(c.fenomeno ?? '').substring(0, 40)} -> ${(c.estructura ?? '').substring(0, 25)} (${c.count})`;
        if (y > 280) { doc.addPage(); y = 15; }
        doc.text(`• ${text}`, 15, y);
        y += 4;
      }

      // Footer
      const totalPages = doc.getNumberOfPages();
      for (let p = 1; p <= totalPages; p++) {
        doc.setPage(p);
        doc.setFillColor(10, 15, 28);
        doc.rect(0, 287, pageWidth, 10, 'F');
        doc.setTextColor(100, 100, 100);
        doc.setFontSize(7);
        doc.text('DATACORE INTEL - DOCUMENTO CONFIDENCIAL', 15, 293);
        doc.text(`Página ${p}/${totalPages}`, pageWidth - 15, 293, { align: 'right' });
      }

      doc.save(`DATACORE_INTEL_${now.toISOString().split('T')[0]}.pdf`);
      toast.success('Informe PDF generado exitosamente.');
    } catch (err: any) {
      toast.error('Error generando PDF: ' + (err?.message ?? 'desconocido'));
    } finally {
      setGenerating(false);
    }
  }, [stats, filters, isDataLoaded]);

  if (!isDataLoaded) return null;

  return (
    <button onClick={generatePDF} disabled={generating}
      className="flex items-center gap-1.5 bg-green-700 hover:bg-green-600 text-white px-3 py-1.5 rounded-md text-xs font-semibold transition-all disabled:opacity-50">
      {generating ? (
        <><FileText className="w-3.5 h-3.5 animate-spin" /> GENERANDO...</>
      ) : (
        <><Download className="w-3.5 h-3.5" /> GENERAR INFORME</>
      )}
    </button>
  );
}
