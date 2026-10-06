\set ON_ERROR_STOP on

insert into auth.users (id, email) values ('99000000-0000-0000-0000-0000000000a1', 'cfg@test.com');
insert into public.organizations (id, ruc, legal_name, address) values
  ('99000000-0000-0000-0000-000000000001', '1792020202001', 'Org Cfg', 'x');
insert into public.organization_users values
  ('99000000-0000-0000-0000-000000000001', '99000000-0000-0000-0000-0000000000a1', 'organization_admin');

create function pg_temp.assert_eq(label text, got text, want text) returns void language plpgsql as $$
begin
  if got is distinct from want then raise exception 'FALLA %: obtenido %, esperado %', label, got, want; end if;
  raise notice 'ok  %', label;
end $$;
create function pg_temp.assert_raises(label text, stmt text, expected text) returns void language plpgsql as $$
begin
  begin execute stmt;
  exception when others then
    if sqlerrm = expected or (expected = 'permission' and sqlstate = '42501') or (expected = 'fk' and sqlstate = '23503') then
      raise notice 'ok  %', label; return;
    end if;
    raise exception 'FALLA %: error inesperado % (%)', label, sqlerrm, sqlstate;
  end;
  raise exception 'FALLA %: no hubo error', label;
end $$;

set role service_role;
select public.set_provider_config('99000000-0000-0000-0000-000000000001','test','mock','  ',null,null,'99000000-0000-0000-0000-0000000000a1');
select pg_temp.assert_eq('crea la configuración de pruebas',
  (select provider::text || ':' || coalesce(provider_company_ref,'NULL') from public.organization_provider_configs
    where organization_id = '99000000-0000-0000-0000-000000000001' and environment = 'test'), 'mock:NULL');

select public.set_provider_config('99000000-0000-0000-0000-000000000001','production','factuplan','0999999999001','cert-ref-1','2027-06-01T00:00:00Z','99000000-0000-0000-0000-0000000000a1');
select pg_temp.assert_eq('crea producción con proveedor real',
  (select provider::text || ':' || provider_company_ref || ':' || certificate_ref from public.organization_provider_configs
    where organization_id = '99000000-0000-0000-0000-000000000001' and environment = 'production'), 'factuplan:0999999999001:cert-ref-1');
select pg_temp.assert_eq('guarda la expiración del certificado',
  (select to_char(certificate_expires_at at time zone 'UTC', 'YYYY-MM-DD') from public.organization_provider_configs
    where organization_id = '99000000-0000-0000-0000-000000000001' and environment = 'production'), '2027-06-01');

select pg_temp.assert_raises('producción NO acepta el proveedor simulado',
  $q$select public.set_provider_config('99000000-0000-0000-0000-000000000001','production','mock',null,null,null,null)$q$, 'production_requires_real_provider');
select pg_temp.assert_eq('el rechazo no cambió la configuración',
  (select provider::text from public.organization_provider_configs
    where organization_id = '99000000-0000-0000-0000-000000000001' and environment = 'production'), 'factuplan');

select public.set_provider_config('99000000-0000-0000-0000-000000000001','production','factuplan',null,null,null,'99000000-0000-0000-0000-0000000000a1');
select pg_temp.assert_eq('actualizar con vacíos limpia las referencias (no deja las viejas)',
  (select coalesce(provider_company_ref,'NULL') || ':' || coalesce(certificate_ref,'NULL') from public.organization_provider_configs
    where organization_id = '99000000-0000-0000-0000-000000000001' and environment = 'production'), 'NULL:NULL');
select pg_temp.assert_eq('una fila por empresa y ambiente',
  (select count(*) from public.organization_provider_configs where organization_id = '99000000-0000-0000-0000-000000000001')::text, '2');

select pg_temp.assert_eq('queda auditoría de cada cambio (3 válidos)',
  (select count(*) from public.billing_events where event_type = 'organization.provider_config_changed' and organization_id = '99000000-0000-0000-0000-000000000001')::text, '3');
select pg_temp.assert_eq('la auditoría no guarda los valores de las referencias',
  (select count(*) from public.billing_events where event_type = 'organization.provider_config_changed' and request::text like '%cert-ref-1%')::text, '0');
select pg_temp.assert_eq('la auditoría dice quién',
  (select count(distinct actor_id) from public.billing_events where event_type = 'organization.provider_config_changed' and actor_id is not null and organization_id = '99000000-0000-0000-0000-000000000001')::text, '1');
select pg_temp.assert_raises('empresa inexistente', $q$select public.set_provider_config('99000000-0000-0000-0000-00000000ffff','test','mock',null,null,null,null)$q$, 'fk');
reset role;

-- el administrador de la empresa puede LEER su configuración pero no cambiarla
select set_config('request.jwt.claim.sub', '99000000-0000-0000-0000-0000000000a1', false);
set role authenticated;
select pg_temp.assert_eq('admin de la empresa lee su configuración', (select count(*) from public.organization_provider_configs)::text, '2');
select pg_temp.assert_raises('admin de la empresa no escribe la configuración',
  $q$insert into public.organization_provider_configs (organization_id, environment, provider) values ('99000000-0000-0000-0000-000000000001','test','factuplan') on conflict (organization_id, environment) do update set provider = 'factuplan'$q$, 'permission');
select pg_temp.assert_raises('admin de la empresa no ejecuta set_provider_config',
  $q$select public.set_provider_config('99000000-0000-0000-0000-000000000001','test','mock',null,null,null,null)$q$, 'permission');
reset role;
set role anon;
select pg_temp.assert_raises('anon no ejecuta set_provider_config',
  $q$select public.set_provider_config('99000000-0000-0000-0000-000000000001','test','mock',null,null,null,null)$q$, 'permission');
reset role;

\echo 'TODAS LAS PRUEBAS DE CONFIGURACION PASARON'
