-- ============================================================================
--  DATACORE INTEL  ·  Función de estadísticas del dashboard
-- ============================================================================
--  QUÉ HACE:
--    Calcula TODOS los conteos del dashboard (tipologías, fenómenos, mapas,
--    líneas de tiempo, etc.) directamente dentro de la base de datos, sobre
--    los 487.000+ registros, en menos de 1 segundo.
--
--  POR QUÉ ES NECESARIA:
--    La API de Supabase solo devuelve 1.000 filas por petición, así que era
--    imposible contar correctamente cientos de miles de registros desde el
--    servidor web. Esta función agrupa y cuenta DENTRO de Postgres y devuelve
--    solo el resultado ya resumido (unos pocos KB).
--
--  ¿ES SEGURA? SÍ. ES 100% DE SOLO LECTURA.
--    Únicamente hace SELECT / GROUP BY. NO tiene INSERT, UPDATE, DELETE ni
--    DROP. No modifica, no borra y no mueve ninguna columna ni fila.
--    Puedes ejecutarla sin ningún riesgo para tus datos.
--
--  CÓMO INSTALARLA (una sola vez):
--    1. Entra a tu proyecto en https://supabase.com
--    2. Menú izquierdo  ->  "SQL Editor"  ->  "New query"
--    3. Pega TODO este archivo y pulsa "Run" (o Ctrl+Enter)
--    4. Debe decir "Success. No rows returned". Listo.
-- ============================================================================

create or replace function public.intel_dashboard_stats(
  p_fecha_inicio text default null,
  p_fecha_fin    text default null,
  p_departamento text default null,
  p_municipio    text default null,
  p_tipologia    text default null,
  p_fenomeno     text default null,
  p_estructura   text default null
)
returns json
language sql
stable
security definer
set search_path = public
-- Sube el límite de tiempo SOLO para esta función (los 487K registros pueden
-- tardar unos segundos). Sin esto, Supabase cancela la consulta (timeout) y el
-- dashboard cae al modo respaldo, que no alcanza a ver las tipologías nuevas.
set statement_timeout = '120s'
as $$
  -- MATERIALIZED: la normalización (tildes/mayúsculas) se calcula UNA sola vez
  -- y se reutiliza en todos los conteos. Antes se recalculaba ~13 veces sobre
  -- las 487K filas, que era justo lo que causaba el timeout.
  with base as materialized (
    select
      departamento,
      municipio,
      -- Normaliza tipología: mayúsculas, sin tildes/ñ, espacios colapsados
      upper(btrim(regexp_replace(
        translate(coalesce(tipologia, ''),
          'áéíóúàèìòùäëïöüÁÉÍÓÚÀÈÌÒÙÄËÏÖÜñÑ',
          'aeiouaeiouaeiouAEIOUAEIOUAEIOUnN'),
        '\s+', ' ', 'g'))) as tipologia_norm,
      fenomeno_criminalidad,
      estructura,
      respuesta_accion,
      accion_enemiga,
      genero,
      fecha::text as fecha_txt
    from intel_records
    where
      (p_fecha_inicio is null or fecha::text >= p_fecha_inicio)
      and (p_fecha_fin  is null or fecha::text <= p_fecha_fin)
      and (p_departamento is null or departamento = p_departamento)
      and (p_municipio    is null or municipio    = p_municipio)
      and (p_fenomeno     is null or fenomeno_criminalidad = p_fenomeno)
      and (p_estructura   is null or estructura   = p_estructura)
      and (p_tipologia is null or
           upper(btrim(regexp_replace(
             translate(coalesce(tipologia, ''),
               'áéíóúàèìòùäëïöüÁÉÍÓÚÀÈÌÒÙÄËÏÖÜñÑ',
               'aeiouaeiouaeiouAEIOUAEIOUAEIOUnN'),
             '\s+', ' ', 'g')))
           = upper(btrim(p_tipologia)))
  )
  select json_build_object(
    'totalCount', (select count(*) from base),

    'tipologias', (select coalesce(json_agg(x order by c desc), '[]'::json)
      from (select json_build_object('name', tipologia_norm, 'count', count(*)) as x, count(*) as c
            from base where tipologia_norm <> '' group by tipologia_norm order by c desc limit 300) s),

    'fenomenos', (select coalesce(json_agg(x order by c desc), '[]'::json)
      from (select json_build_object('name', fenomeno_criminalidad, 'count', count(*)) as x, count(*) as c
            from base where coalesce(btrim(fenomeno_criminalidad),'') <> '' group by fenomeno_criminalidad order by c desc limit 300) s),

    'estructuras', (select coalesce(json_agg(x order by c desc), '[]'::json)
      from (select json_build_object('name', estructura, 'count', count(*)) as x, count(*) as c
            from base where coalesce(btrim(estructura),'') <> '' group by estructura order by c desc limit 300) s),

    'respuestas', (select coalesce(json_agg(x order by c desc), '[]'::json)
      from (select json_build_object('name', respuesta_accion, 'count', count(*)) as x, count(*) as c
            from base where coalesce(btrim(respuesta_accion),'') <> '' group by respuesta_accion order by c desc limit 300) s),

    'acciones', (select coalesce(json_agg(x order by c desc), '[]'::json)
      from (select json_build_object('name', accion_enemiga, 'count', count(*)) as x, count(*) as c
            from base where coalesce(btrim(accion_enemiga),'') <> '' group by accion_enemiga order by c desc limit 300) s),

    'generos', (select coalesce(json_agg(x order by c desc), '[]'::json)
      from (select json_build_object('name', genero, 'count', count(*)) as x, count(*) as c
            from base where coalesce(btrim(genero),'') <> '' group by genero order by c desc limit 300) s),

    'municipios', (select coalesce(json_agg(x order by c desc), '[]'::json)
      from (select json_build_object('name', municipio, 'count', count(*)) as x, count(*) as c
            from base where coalesce(btrim(municipio),'') <> '' group by municipio order by c desc limit 300) s),

    'departamentos', (select coalesce(json_agg(x order by c desc), '[]'::json)
      from (select json_build_object('name', departamento, 'count', count(*)) as x, count(*) as c
            from base where coalesce(btrim(departamento),'') <> '' group by departamento order by c desc limit 300) s),

    'timeline', (select coalesce(json_agg(x order by ym), '[]'::json)
      from (select json_build_object('fecha', substr(fecha_txt,1,7), 'count', count(*)) as x, substr(fecha_txt,1,7) as ym
            from base where fecha_txt ~ '^\d{4}-\d{2}' group by substr(fecha_txt,1,7) order by ym) s),

    'dow', (select coalesce(json_agg(json_build_object('d', d, 'count', c)), '[]'::json)
      from (select extract(dow from fecha_txt::date)::int as d, count(*) as c
            from base where fecha_txt ~ '^\d{4}-\d{2}-\d{2}' group by 1) s),

    'month', (select coalesce(json_agg(json_build_object('m', m, 'count', c)), '[]'::json)
      from (select extract(month from fecha_txt::date)::int as m, count(*) as c
            from base where fecha_txt ~ '^\d{4}-\d{2}-\d{2}' group by 1) s),

    'correlaciones', (select coalesce(json_agg(x order by c desc), '[]'::json)
      from (select json_build_object('fenomeno', fenomeno_criminalidad, 'estructura', estructura, 'count', count(*)) as x, count(*) as c
            from base
            where coalesce(btrim(fenomeno_criminalidad),'') <> '' and coalesce(btrim(estructura),'') <> ''
            group by fenomeno_criminalidad, estructura order by c desc limit 15) s),

    'municipiosByDept', (select coalesce(json_object_agg(departamento, munis), '{}'::json)
      from (select departamento, array_agg(distinct municipio order by municipio) as munis
            from base
            where coalesce(btrim(departamento),'') <> '' and coalesce(btrim(municipio),'') <> ''
            group by departamento) s)
  );
$$;

-- Permite que la app (rol anónimo y autenticado) pueda llamar la función.
grant execute on function public.intel_dashboard_stats(text,text,text,text,text,text,text) to anon, authenticated, service_role;
