-- ============================================================================
--  ADMINISTRADOR ÚNICO: amdres.di@gmail.com
--  Ejecutar UNA vez en Supabase > SQL Editor. No borra usuarios ni datos.
-- ============================================================================

-- 1) Todos pasan a usuario normal, excepto el administrador único
update public.app_users
set role = 'user'
where lower(trim(email)) <> 'amdres.di@gmail.com';

-- 2) Asegurar que amdres.di@gmail.com sea admin y esté aprobado
update public.app_users
set role = 'admin', status = 'approved'
where lower(trim(email)) = 'amdres.di@gmail.com';

-- 3) Comprobación
select email, name, role, status
from public.app_users
order by role, email;
