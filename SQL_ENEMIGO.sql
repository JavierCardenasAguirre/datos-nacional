-- SQL_ENEMIGO.sql
-- Idempotente. Ejecutar en Supabase SQL Editor sobre el esquema public.

begin;

-- 1) Asegurar columna de estructura criminal en intel_records
alter table if exists public.intel_records
  add column if not exists estructura text;

-- 2) Índices para consultas de la sección Enemigo y filtros combinables
create index if not exists idx_intel_records_estructura
  on public.intel_records (estructura);

create index if not exists idx_intel_records_fecha
  on public.intel_records (fecha);

create index if not exists idx_intel_records_departamento
  on public.intel_records (departamento);

create index if not exists idx_intel_records_municipio
  on public.intel_records (municipio);

create index if not exists idx_intel_records_tipologia
  on public.intel_records (tipologia);

create index if not exists idx_intel_records_estructura_fecha
  on public.intel_records (estructura, fecha desc);

-- 3) RPC: listado de estructuras (distinct + count)
create or replace function public.intel_enemigo_estructuras(
  p_search text default null,
  p_limit int default 200
)
returns table(estructura text, total bigint)
language sql
security definer
set search_path = public
as $$
  with base as (
    select trim(i.estructura) as estructura
    from public.intel_records i
    where i.estructura is not null
      and trim(i.estructura) <> ''
      and (p_search is null or trim(p_search) = '' or i.estructura ilike '%' || p_search || '%')
  )
  select b.estructura, count(*)::bigint as total
  from base b
  group by b.estructura
  order by total desc, b.estructura asc
  limit greatest(20, least(coalesce(p_limit, 200), 500));
$$;

-- 4) RPC: agregaciones de la sección Enemigo
create or replace function public.intel_enemigo_stats(
  p_estructura text,
  p_fecha_inicio date default null,
  p_fecha_fin date default null,
  p_departamento text default null,
  p_municipio text default null,
  p_tipologia text default null,
  p_evento text default null
)
returns jsonb
language sql
security definer
set search_path = public
as $$
  with filtered as (
    select
      i.id,
      i.fecha,
      i.departamento,
      i.municipio,
      i.tipologia,
      i.estructura
    from public.intel_records i
    where trim(coalesce(i.estructura, '')) = trim(coalesce(p_estructura, ''))
      and (p_fecha_inicio is null or i.fecha >= p_fecha_inicio)
      and (p_fecha_fin is null or i.fecha <= p_fecha_fin)
      and (p_departamento is null or p_departamento = '' or i.departamento = p_departamento)
      and (p_municipio is null or p_municipio = '' or i.municipio = p_municipio)
      and (p_tipologia is null or p_tipologia = '' or i.tipologia = p_tipologia)
      and (p_evento is null or trim(p_evento) = '' or i.informacion_hecho ilike '%' || p_evento || '%')
  ),
  top_tipologias as (
    select tipologia as name, count(*)::int as count
    from filtered
    where tipologia is not null and trim(tipologia) <> ''
    group by tipologia
    order by count desc, name asc
    limit 20
  ),
  top_departamentos as (
    select departamento as name, count(*)::int as count
    from filtered
    where departamento is not null and trim(departamento) <> ''
    group by departamento
    order by count desc, name asc
    limit 20
  ),
  top_municipios as (
    select municipio as name, count(*)::int as count
    from filtered
    where municipio is not null and trim(municipio) <> ''
    group by municipio
    order by count desc, name asc
    limit 20
  ),
  timeline as (
    select to_char(date_trunc('month', fecha), 'YYYY-MM') as fecha, count(*)::int as count
    from filtered
    where fecha is not null
    group by 1
    order by 1
  )
  select jsonb_build_object(
    'estructura', p_estructura,
    'totalCount', (select count(*)::int from filtered),
    'tipologias', coalesce((select jsonb_agg(jsonb_build_object('name', t.name, 'count', t.count)) from top_tipologias t), '[]'::jsonb),
    'departamentos', coalesce((select jsonb_agg(jsonb_build_object('name', d.name, 'count', d.count)) from top_departamentos d), '[]'::jsonb),
    'municipios', coalesce((select jsonb_agg(jsonb_build_object('name', m.name, 'count', m.count)) from top_municipios m), '[]'::jsonb),
    'timeline', coalesce((select jsonb_agg(jsonb_build_object('fecha', tl.fecha, 'count', tl.count)) from timeline tl), '[]'::jsonb),
    'minFecha', (select min(fecha)::text from filtered),
    'maxFecha', (select max(fecha)::text from filtered),
    'source', 'rpc'
  );
$$;

-- 5) Permisos de ejecución (route usa service_role)
grant execute on function public.intel_enemigo_estructuras(text, int) to service_role;
grant execute on function public.intel_enemigo_stats(text, date, date, text, text, text, text) to service_role;

-- 6) Actualizar estadísticas de planner
analyze public.intel_records;

commit;
