-- ============================================================================
--  DATACORE INTEL  ·  Estadísticas del dashboard (versión optimizada)
-- ============================================================================
--  QUÉ HACE:
--    Calcula TODOS los conteos del dashboard (tipologías, fenómenos, mapas,
--    líneas de tiempo, etc.) directamente dentro de la base de datos, sobre
--    los 487.000+ registros.
--
--  POR QUÉ ES NECESARIA:
--    La API de Supabase solo devuelve 1.000 filas por petición, así que era
--    imposible contar correctamente cientos de miles de registros desde el
--    servidor web. Esta función agrupa y cuenta DENTRO de Postgres y devuelve
--    solo el resultado ya resumido (unos pocos KB).
--
--  QUÉ CAMBIÓ EN ESTA VERSIÓN (por qué antes salían totales equivocados):
--    Antes la función tardaba ~22 segundos y Vercel la cancelaba a los pocos
--    segundos, así que el dashboard caía a un "modo respaldo" que solo alcanza
--    a leer una parte de las filas -> mostraba totales INCORRECTOS (por debajo
--    de lo real) como si fueran definitivos.
--    Ahora:
--      1) Se guarda la tipología ya normalizada en una columna fija
--         (`tipologia_norm`), en vez de recalcular tildes/mayúsculas sobre las
--         487K filas en cada consulta.
--      2) Se crean índices para agrupar y filtrar mucho más rápido.
--      3) La función usa más memoria de trabajo (work_mem) para no volcar a
--         disco. Con esto la consulta baja de ~22s a pocos segundos y Vercel
--         alcanza a recibir los TOTALES EXACTOS.
--
--  ¿ES SEGURA?
--    El PASO 1 agrega UNA columna calculada (no borra ni cambia tus datos) y
--    crea índices (solo aceleran las consultas). Los PASOS 2 y 3 son funciones
--    100% de SOLO LECTURA (solo SELECT / GROUP BY). No hay DELETE ni DROP de
--    datos. Puedes ejecutarlo con tranquilidad.
--
--  CÓMO INSTALARLO (una sola vez):
--    1. Entra a tu proyecto en https://supabase.com
--    2. Menú izquierdo  ->  "SQL Editor"  ->  "New query"
--    3. Pega TODO este archivo y pulsa "Run" (o Ctrl+Enter)
--    4. El PASO 1 puede tardar hasta ~1-2 minutos (está recorriendo las 487K
--       filas para llenar la columna nueva). Es normal. Al final debe decir
--       "Success". Listo.
-- ============================================================================


-- ============================================================================
--  PASO 1 · MIGRACIÓN (una sola vez): columna normalizada + índices
-- ============================================================================
--  `tipologia_norm` guarda la tipología ya en MAYÚSCULAS, sin tildes/ñ y con
--  espacios colapsados. Se llena SOLA (columna GENERADA) tanto para las filas
--  actuales como para todo lo que se importe en el futuro. Así la app deja de
--  gastar tiempo normalizando 487K filas en cada consulta.
alter table public.intel_records
  add column if not exists tipologia_norm text
  generated always as (
    upper(btrim(regexp_replace(
      translate(coalesce(tipologia, ''),
        'áéíóúàèìòùäëïöüÁÉÍÓÚÀÈÌÒÙÄËÏÖÜñÑ',
        'aeiouaeiouaeiouAEIOUAEIOUAEIOUnN'),
      '\s+', ' ', 'g')))
  ) stored;

-- Índices para agrupar/filtrar rápido (solo aceleran; no cambian datos).
create index if not exists idx_intel_tipologia_norm on public.intel_records (tipologia_norm);
create index if not exists idx_intel_fecha          on public.intel_records (fecha);
create index if not exists idx_intel_departamento   on public.intel_records (departamento);
create index if not exists idx_intel_municipio      on public.intel_records (municipio);
create index if not exists idx_intel_fenomeno       on public.intel_records (fenomeno_criminalidad);
create index if not exists idx_intel_estructura     on public.intel_records (estructura);

-- Deja las estadísticas del planificador al día tras crear la columna/índices.
analyze public.intel_records;


-- ============================================================================
--  PASO 2 · FUNCIÓN DE ESTADÍSTICAS DEL DASHBOARD  ·  intel_dashboard_stats
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
-- Sube el límite de tiempo SOLO para esta función.
set statement_timeout = '120s'
-- Más memoria de trabajo para que los GROUP BY / sort NO se vuelquen a disco
-- (esto era gran parte de los ~22s). Aplica solo mientras corre la función.
set work_mem = '256MB'
as $$
  -- La normalización ya viene lista en la columna `tipologia_norm`, así que el
  -- CTE base solo SELECCIONA columnas (sin recalcular tildes/mayúsculas).
  with base as materialized (
    select
      departamento,
      municipio,
      tipologia_norm,
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
      and (p_tipologia is null or tipologia_norm =
            upper(btrim(regexp_replace(
              translate(coalesce(p_tipologia, ''),
                'áéíóúàèìòùäëïöüÁÉÍÓÚÀÈÌÒÙÄËÏÖÜñÑ',
                'aeiouaeiouaeiouAEIOUAEIOUAEIOUnN'),
              '\s+', ' ', 'g'))))
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


-- ============================================================================
--  PASO 3 · FUNCIÓN LIGERA DE CONTEO EXACTO  ·  intel_count
-- ============================================================================
--  Devuelve el número EXACTO de registros (con los mismos filtros del
--  dashboard) en milisegundos. Solo hace `count(*)`. 100% de SOLO LECTURA.
create or replace function public.intel_count(
  p_fecha_inicio text default null,
  p_fecha_fin    text default null,
  p_departamento text default null,
  p_municipio    text default null,
  p_tipologia    text default null,
  p_fenomeno     text default null,
  p_estructura   text default null
)
returns bigint
language sql
stable
security definer
set search_path = public
set statement_timeout = '120s'
as $$
  select count(*)::bigint
  from intel_records
  where
    (p_fecha_inicio is null or fecha::text >= p_fecha_inicio)
    and (p_fecha_fin  is null or fecha::text <= p_fecha_fin)
    and (p_departamento is null or departamento = p_departamento)
    and (p_municipio    is null or municipio    = p_municipio)
    and (p_fenomeno     is null or fenomeno_criminalidad = p_fenomeno)
    and (p_estructura   is null or estructura   = p_estructura)
    and (p_tipologia is null or tipologia_norm =
          upper(btrim(regexp_replace(
            translate(coalesce(p_tipologia, ''),
              'áéíóúàèìòùäëïöüÁÉÍÓÚÀÈÌÒÙÄËÏÖÜñÑ',
              'aeiouaeiouaeiouAEIOUAEIOUAEIOUnN'),
            '\s+', ' ', 'g'))));
$$;

grant execute on function public.intel_count(text,text,text,text,text,text,text) to anon, authenticated, service_role;
