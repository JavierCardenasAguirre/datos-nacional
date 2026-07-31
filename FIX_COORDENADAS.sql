-- ============================================================================
-- FIX_COORDENADAS.sql
-- Repara las coordenadas de los registros que se guardaron "colapsadas" a
-- grados enteros (todos apilados en un mismo punto del mapa).
--
-- CAUSA: las filas pegadas traían la latitud/longitud con COMA como separador
-- decimal (ej. "7,753888889"). El código antiguo cortaba el número en la coma
-- y guardaba solo "7" / "-75", por eso todos los marcadores caían en el mismo
-- sitio. El código ya está corregido para nuevas cargas; este script arregla
-- las filas que YA quedaron mal guardadas, recalculando desde grados/minutos/
-- segundos (que sí se guardaron bien).
--
-- Fórmula (Colombia): latitud positiva (N), longitud negativa (W)
--   latitud  =  grados + minutos/60 + segundos/3600
--   longitud = -( |grados| + minutos/60 + segundos/3600 )
--
-- INSTRUCCIONES: pega TODO este archivo en el SQL Editor de Supabase y ejecuta.
-- Es seguro: solo actualiza filas que están claramente corruptas (coordenada
-- entera pero con minutos o segundos disponibles).
-- ============================================================================

-- PASO 1 (opcional) — VER cuántas filas se van a corregir ANTES de tocar nada.
-- Descomenta y ejecuta solo este SELECT si quieres revisar primero.
--
-- select count(*) as filas_a_corregir
-- from intel_records
-- where (coalesce(lat_minutos,0) > 0 or coalesce(lat_segundos,0) > 0
--        or coalesce(lon_minutos,0) > 0 or coalesce(lon_segundos,0) > 0)
--   and latitud = trunc(latitud)
--   and longitud = trunc(longitud);


-- PASO 2 — CORREGIR las coordenadas colapsadas usando grados/minutos/segundos.
update intel_records
set
  latitud  =  abs(lat_grados) + coalesce(lat_minutos,0)/60.0 + coalesce(lat_segundos,0)/3600.0,
  longitud = -1 * ( abs(lon_grados) + coalesce(lon_minutos,0)/60.0 + coalesce(lon_segundos,0)/3600.0 )
where
  -- Solo filas con minutos o segundos disponibles (hay de dónde recalcular)...
  ( coalesce(lat_minutos,0) > 0 or coalesce(lat_segundos,0) > 0
    or coalesce(lon_minutos,0) > 0 or coalesce(lon_segundos,0) > 0 )
  -- ...y cuya coordenada decimal quedó en un valor ENTERO (síntoma de corrupción).
  and latitud = trunc(latitud)
  and longitud = trunc(longitud);


-- PASO 3 (opcional) — VERIFICAR el resultado.
-- select departamento, municipio, latitud, longitud,
--        lat_grados, lat_minutos, lat_segundos,
--        lon_grados, lon_minutos, lon_segundos
-- from intel_records
-- order by id desc
-- limit 50;
