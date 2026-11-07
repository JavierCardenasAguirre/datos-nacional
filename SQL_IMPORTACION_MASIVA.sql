-- ============================================================================
--  IMPORTACIÓN MASIVA (500k+ registros) · ejecutar UNA VEZ en Supabase > SQL Editor
--  Es idempotente: se puede ejecutar varias veces sin dañar datos.
-- ============================================================================

-- 1) Borrado rápido de intel_records (lo usa /api/intel/import al reemplazar datos).
--    Sin esta función la app sigue funcionando, pero borra con DELETE por lotes,
--    que con cientos de miles de filas es lento y puede agotar el tiempo.
create or replace function public.intel_truncate()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  truncate table public.intel_records restart identity;
end;
$$;

-- Solo el backend (service_role) puede ejecutarla; nunca anon/authenticated.
revoke all on function public.intel_truncate() from public;
revoke all on function public.intel_truncate() from anon, authenticated;
grant execute on function public.intel_truncate() to service_role;

-- 2) Refrescar la caché de esquema de la API para que vea la función de inmediato.
notify pgrst, 'reload schema';

-- ============================================================================
--  3) (OPCIONAL) Ejecutar DESPUÉS de terminar una importación grande, para que
--     las estadísticas/consultas del dashboard usen bien los índices.
-- ============================================================================
-- analyze public.intel_records;

-- ============================================================================
--  PASO EXTRA · Actualizar estadísticas tras una importación masiva
-- ============================================================================
--  Después de cargar cientos de miles de filas, Postgres aún "cree" que la
--  tabla está vacía hasta que actualiza sus estadísticas. Esto hace lentas las
--  funciones del dashboard y que los conteos estimados den 0. Ejecutar una vez
--  después de cada carga grande (tarda segundos, no modifica datos):
analyze public.intel_records;
