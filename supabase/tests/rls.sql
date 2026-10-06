-- Pruebas de aislamiento RLS entre dos empresas. Requiere bootstrap.sql + migraciones.
-- Falla (ON_ERROR_STOP) si alguna aserción no se cumple.
\set ON_ERROR_STOP on

-- ---- datos (como superusuario)
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin-a@test'),
  ('00000000-0000-0000-0000-0000000000a2', 'viewer-a@test'),
  ('00000000-0000-0000-0000-0000000000b1', 'admin-b@test'),
  ('00000000-0000-0000-0000-0000000000c1', 'platform@test');
insert into public.platform_admins values ('00000000-0000-0000-0000-0000000000c1');
insert into public.organizations (id, ruc, legal_name, address) values
  ('a0000000-0000-0000-0000-000000000001', '1790000000001', 'Empresa A', 'x'),
  ('b0000000-0000-0000-0000-000000000001', '1790000000002', 'Empresa B', 'x');
insert into public.organization_users values
  ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 'organization_admin'),
  ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a2', 'viewer'),
  ('b0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b1', 'organization_admin');
insert into public.establishments (id, organization_id, code, name, address) values
  ('a1000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', '001', 'A', 'x'),
  ('b1000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', '001', 'B', 'x');
insert into public.emission_points (id, organization_id, establishment_id, code) values
  ('a2000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', '001'),
  ('b2000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001', '001');
insert into public.customers (id, organization_id, identification_type, identification, legal_name) values
  ('a3000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'cedula', '1', 'Cli A'),
  ('b3000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'cedula', '1', 'Cli B');
insert into public.invoices (organization_id, establishment_id, emission_point_id, customer_id, issue_date, environment) values
  ('a0000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', 'a3000000-0000-0000-0000-000000000001', current_date, 'test'),
  ('b0000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001', 'b2000000-0000-0000-0000-000000000001', 'b3000000-0000-0000-0000-000000000001', current_date, 'test');
insert into public.api_keys (organization_id, application_name, environment, key_prefix, key_hash) values
  ('a0000000-0000-0000-0000-000000000001', 'app', 'test', 'nb_test_x', 'hash-a'),
  ('b0000000-0000-0000-0000-000000000001', 'app', 'test', 'nb_test_y', 'hash-b');

-- ---- helpers
create function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', uid, false);
  execute 'set role authenticated';
end $$;
create function pg_temp.assert_eq(label text, got bigint, want bigint) returns void language plpgsql as $$
begin
  if got is distinct from want then raise exception 'FALLA %: obtenido %, esperado %', label, got, want; end if;
  raise notice 'ok  %', label;
end $$;
create function pg_temp.assert_rows(label text, stmt text, want bigint) returns void language plpgsql as $$
declare n bigint;
begin
  execute stmt; get diagnostics n = row_count;
  if n <> want then raise exception 'FALLA %: % filas afectadas, esperadas %', label, n, want; end if;
  raise notice 'ok  %', label;
end $$;
-- Ejecuta sql como el rol actual y espera un error de permisos/RLS.
create function pg_temp.assert_denied(label text, stmt text) returns void language plpgsql as $$
declare n bigint;
begin
  begin
    execute stmt; get diagnostics n = row_count;
    if n > 0 then raise exception 'FALLA %: la operación afectó % filas', label, n; end if;
  exception when insufficient_privilege or check_violation then null;
  end;
  raise notice 'ok  %', label;
end $$;

-- ---- admin de A
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select pg_temp.assert_eq('A ve solo su organización', (select count(*) from public.organizations), 1);
select pg_temp.assert_eq('A ve solo sus facturas', (select count(*) from public.invoices), 1);
select pg_temp.assert_eq('A ve solo sus clientes', (select count(*) from public.customers), 1);
select pg_temp.assert_eq('A ve solo sus api keys', (select count(*) from public.api_keys), 1);
select pg_temp.assert_denied('A no lee key_hash', 'select key_hash from public.api_keys');
select pg_temp.assert_denied('A no inserta facturas', $q$insert into public.invoices (organization_id, establishment_id, emission_point_id, customer_id, issue_date, environment) values ('a0000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000001','a2000000-0000-0000-0000-000000000001','a3000000-0000-0000-0000-000000000001', current_date, 'test')$q$);
select pg_temp.assert_denied('A no inserta en org B', $q$insert into public.establishments (organization_id, code, name, address) values ('b0000000-0000-0000-0000-000000000001','002','x','x')$q$);
select pg_temp.assert_rows('A no actualiza org B', $q$update public.establishments set name='hack' where organization_id='b0000000-0000-0000-0000-000000000001'$q$, 0);
select pg_temp.assert_denied('A no mueve su vínculo a org B', $q$insert into public.organization_users values ('b0000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','organization_admin')$q$);
select pg_temp.assert_denied('A no puede cambiar current_sequence', $q$update public.emission_points set current_sequence = 0 where id='a2000000-0000-0000-0000-000000000001'$q$);
select pg_temp.assert_denied('A no crea punto con secuencial inicial', $q$insert into public.emission_points (organization_id, establishment_id, code, current_sequence) values ('a0000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000001','002', 500)$q$);
select pg_temp.assert_denied('A no ejecuta next_sequential', $q$select public.next_sequential('a2000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001')$q$);
select pg_temp.assert_denied('A no lee idempotency_keys', 'select * from public.idempotency_keys');
select pg_temp.assert_denied('A no lee webhook_events', 'select * from public.webhook_events');
select pg_temp.assert_rows('A puede editar code de su punto', $q$update public.emission_points set code='009' where id='a2000000-0000-0000-0000-000000000001'$q$, 1);
select pg_temp.assert_eq('dashboard_stats respeta RLS', (public.dashboard_stats(current_date, current_date)->>'month_count')::bigint, 1);
reset role;

-- ---- viewer de A
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a2');
select pg_temp.assert_eq('viewer ve facturas de A', (select count(*) from public.invoices), 1);
select pg_temp.assert_eq('viewer no ve billing_events', (select count(*) from public.billing_events), 0);
select pg_temp.assert_eq('viewer no ve api_keys', (select count(*) from public.api_keys), 0);
select pg_temp.assert_denied('viewer no escribe establecimientos', $q$insert into public.establishments (organization_id, code, name, address) values ('a0000000-0000-0000-0000-000000000001','003','x','x')$q$);
reset role;

-- ---- platform admin
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select pg_temp.assert_eq('platform admin ve ambas organizaciones', (select count(*) from public.organizations), 2);
reset role;

-- ---- anon
set role anon;
select pg_temp.assert_denied('anon no lee organizaciones', 'select * from public.organizations');
reset role;

-- ---- service role: secuencial atómico
set role service_role;
select pg_temp.assert_eq('next_sequential 1', public.next_sequential('a2000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001'), 1);
select pg_temp.assert_eq('next_sequential 2', public.next_sequential('a2000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001'), 2);
select pg_temp.assert_eq('next_sequential no cruza empresas', coalesce(public.next_sequential('a2000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000001'), -1), -1);
reset role;

\echo 'TODAS LAS PRUEBAS RLS PASARON'
