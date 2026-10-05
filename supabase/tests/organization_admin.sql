-- Pruebas de create_organization, find_user_id_by_email, user_emails y de lo que el panel
-- hace con RLS (administradores de empresa creando establecimientos/puntos/miembros).
\set ON_ERROR_STOP on

insert into auth.users (id, email) values
  ('ee000000-0000-0000-0000-0000000000a1', 'Admin.Uno@Test.com'),
  ('ee000000-0000-0000-0000-0000000000a2', 'otro@test.com'),
  ('ee000000-0000-0000-0000-0000000000b1', 'admin-dos@test.com');

create function pg_temp.assert_eq(label text, got text, want text) returns void language plpgsql as $$
begin
  if got is distinct from want then raise exception 'FALLA %: obtenido %, esperado %', label, got, want; end if;
  raise notice 'ok  %', label;
end $$;
create function pg_temp.assert_raises(label text, stmt text, expected text) returns void language plpgsql as $$
begin
  begin execute stmt;
  exception when others then
    if sqlerrm = expected or (expected = 'permission' and sqlstate = '42501') or (expected = 'unique' and sqlstate = '23505')
       or (expected = 'rls' and sqlstate = '42501') or (expected = 'fk' and sqlstate = '23503') or (expected = 'check' and sqlstate = '23514') then
      raise notice 'ok  %', label; return;
    end if;
    raise exception 'FALLA %: error inesperado % (%)', label, sqlerrm, sqlstate;
  end;
  raise exception 'FALLA %: no hubo error', label;
end $$;
create function pg_temp.assert_rows(label text, stmt text, want bigint) returns void language plpgsql as $$
declare n bigint;
begin
  execute stmt; get diagnostics n = row_count;
  if n <> want then raise exception 'FALLA %: % filas, esperadas %', label, n, want; end if;
  raise notice 'ok  %', label;
end $$;

-- ---- service role: alta de empresas y búsqueda de usuarios
set role service_role;
create temp table orgs as
  select public.create_organization('1795555555001', 'Empresa Nueva S.A.', '  ', 'Quito') as a,
         public.create_organization('1796666666001', 'Empresa Dos S.A.', 'Dos', 'Guayaquil') as b;
grant select on orgs to public;
select pg_temp.assert_eq('crea la empresa', (select legal_name from public.organizations where id = (select a from orgs)), 'Empresa Nueva S.A.');
select pg_temp.assert_eq('trade_name en blanco queda null', coalesce((select trade_name from public.organizations where id = (select a from orgs)), 'NULL'), 'NULL');
select pg_temp.assert_eq('ambiente por omisión: pruebas', (select environment::text from public.organizations where id = (select a from orgs)), 'test');
select pg_temp.assert_eq('crea proveedor mock SOLO para pruebas',
  (select string_agg(environment::text || ':' || provider::text, ',') from public.organization_provider_configs where organization_id = (select a from orgs)), 'test:mock');
select pg_temp.assert_raises('RUC repetido', $q$select public.create_organization('1795555555001','Otra','x','y')$q$, 'unique');
select pg_temp.assert_raises('RUC inválido', $q$select public.create_organization('123','Otra','x','y')$q$, 'check');
select pg_temp.assert_eq('el alta fallida no deja la empresa a medias',
  (select count(*) from public.organizations where legal_name = 'Otra')::text, '0');
select pg_temp.assert_eq('ni configuraciones de más',
  (select count(*) from public.organization_provider_configs where organization_id = (select a from orgs))::text, '1');
select pg_temp.assert_eq('busca usuario sin distinguir mayúsculas', (public.find_user_id_by_email('admin.uno@test.COM'))::text, 'ee000000-0000-0000-0000-0000000000a1');
select pg_temp.assert_eq('usuario inexistente => null', coalesce((public.find_user_id_by_email('nadie@test.com'))::text, 'NULL'), 'NULL');
select pg_temp.assert_eq('user_emails devuelve solo los pedidos',
  (select count(*) from public.user_emails(array['ee000000-0000-0000-0000-0000000000a2']::uuid[]))::text, '1');
reset role;

insert into public.organization_users values
  ((select a from orgs), 'ee000000-0000-0000-0000-0000000000a1', 'organization_admin'),
  ((select b from orgs), 'ee000000-0000-0000-0000-0000000000b1', 'organization_admin');

-- ---- lo que hace el panel con la sesión del administrador de la empresa A (RLS)
create function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', uid, false); execute 'set role authenticated'; end $$;

select pg_temp.as_user('ee000000-0000-0000-0000-0000000000a1');
select pg_temp.assert_rows('admin A crea establecimiento en A',
  format($q$insert into public.establishments (organization_id, code, name, address) values (%L,'001','Matriz','x')$q$, (select a from orgs)), 1);
select pg_temp.assert_raises('admin A no crea establecimiento en B',
  format($q$insert into public.establishments (organization_id, code, name, address) values (%L,'001','Intruso','x')$q$, (select b from orgs)), 'rls');
select pg_temp.assert_raises('código de establecimiento repetido',
  format($q$insert into public.establishments (organization_id, code, name, address) values (%L,'001','Dup','x')$q$, (select a from orgs)), 'unique');
select pg_temp.assert_raises('código de 3 dígitos',
  format($q$insert into public.establishments (organization_id, code, name, address) values (%L,'1','Mal','x')$q$, (select a from orgs)), 'check');
select pg_temp.assert_rows('admin A crea punto de emisión',
  format($q$insert into public.emission_points (organization_id, establishment_id, code) select %L, id, '001' from public.establishments where organization_id = %L$q$, (select a from orgs), (select a from orgs)), 1);
select pg_temp.assert_raises('no crea punto con secuencial inicial',
  format($q$insert into public.emission_points (organization_id, establishment_id, code, current_sequence) select %L, id, '002', 99 from public.establishments where organization_id = %L$q$, (select a from orgs), (select a from orgs)), 'permission');
select pg_temp.assert_rows('admin A agrega un miembro a A',
  format($q$insert into public.organization_users (organization_id, user_id, role) values (%L,'ee000000-0000-0000-0000-0000000000a2','viewer')$q$, (select a from orgs)), 1);
select pg_temp.assert_raises('admin A no agrega miembros a B',
  format($q$insert into public.organization_users (organization_id, user_id, role) values (%L,'ee000000-0000-0000-0000-0000000000a2','viewer')$q$, (select b from orgs)), 'rls');
select pg_temp.assert_raises('miembro repetido',
  format($q$insert into public.organization_users (organization_id, user_id, role) values (%L,'ee000000-0000-0000-0000-0000000000a2','viewer')$q$, (select a from orgs)), 'unique');
select pg_temp.assert_eq('admin A ve a sus 2 miembros y a ninguno de B',
  (select count(*) from public.organization_users)::text, '2');
select pg_temp.assert_raises('admin A no crea empresas', $q$insert into public.organizations (ruc, legal_name, address) values ('1797777777001','x','y')$q$, 'permission');
select pg_temp.assert_raises('admin A no ejecuta create_organization', $q$select public.create_organization('1798888888001','x','y','z')$q$, 'permission');
select pg_temp.assert_raises('admin A no busca usuarios', $q$select public.find_user_id_by_email('otro@test.com')$q$, 'permission');
select pg_temp.assert_raises('admin A no lee correos', $q$select * from public.user_emails(array[]::uuid[])$q$, 'permission');
reset role;

-- el viewer agregado no puede administrar
select pg_temp.as_user('ee000000-0000-0000-0000-0000000000a2');
select pg_temp.assert_raises('viewer no crea establecimientos',
  format($q$insert into public.establishments (organization_id, code, name, address) values (%L,'002','x','x')$q$, (select a from orgs)), 'rls');
select pg_temp.assert_raises('viewer no agrega miembros',
  format($q$insert into public.organization_users (organization_id, user_id, role) values (%L,'ee000000-0000-0000-0000-0000000000b1','viewer')$q$, (select a from orgs)), 'rls');
reset role;
set role anon;
select pg_temp.assert_raises('anon no ejecuta find_user_id_by_email', $q$select public.find_user_id_by_email('otro@test.com')$q$, 'permission');
reset role;

\echo 'TODAS LAS PRUEBAS DE ADMINISTRACION PASARON'
