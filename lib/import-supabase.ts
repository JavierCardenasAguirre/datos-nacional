export interface ImportProgress {
  message: string;
  percent: number;
}

export async function importToSupabase(
  file: File,
  onProgress?: (p: ImportProgress) => void
): Promise<number> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch('/api/intel/import', {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => 'Error del servidor');
    throw new Error(errText);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('No se pudo leer la respuesta del servidor');

  const decoder = new TextDecoder();
  let buffer = '';
  let totalInserted = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    let nlIdx: number;
    while ((nlIdx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.substring(0, nlIdx).trim();
      buffer = buffer.substring(nlIdx + 1);
      if (!line) continue;

      try {
        const msg = JSON.parse(line);
        if (msg.t === 'p') {
          onProgress?.({ message: msg.m ?? '', percent: msg.p ?? 0 });
        } else if (msg.t === 'e') {
          throw new Error(msg.m ?? 'Error del servidor');
        } else if (msg.t === 'd') {
          totalInserted = msg.n ?? 0;
          const errors = msg.errors ?? 0;
          const errMsg = errors > 0 ? ` (${errors} filas con errores)` : '';
          onProgress?.({ message: `${totalInserted.toLocaleString()} registros insertados${errMsg}`, percent: 100 });
        }
      } catch (e: any) {
        if (e?.message?.includes('Error')) throw e;
      }
    }
  }

  return totalInserted;
}
