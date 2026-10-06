-- Pruebas de process_webhook_event (idempotencia, estados finales, aislamiento).
\set ON_ERROR_STOP on

insert into public.organizations (id, ruc, legal_name, address) values
  ('cc000000-0000-0000-0000-000000000001', '1793333333001', 'Org W1', 'x'),
  ('dd000000-0000-0000-0000-000000000001', '1794444444001', 'Org W2', 'x');
insert into public.establishments (id, organization_id, code, name, address) values
  ('cc100000-0000-0000-0000-000000000001', 'cc000000-0000-0000-0000-000000000001', '001', 'W1', 'x'),
  ('dd100000-0000-0000-0000-000000000001', 'dd000000-0000-0000-0000-000000000001', '001', 'W2', 'x');
insert into public.emission_points (id, organization_id, establishment_id, code) values
  ('cc200000-0000-0000-0000-000000000001', 'cc000000-0000-0000-0000-000000000001', 'cc100000-0000-0000-0000-000000000001', '001'),
  ('dd200000-0000-0000-0000-000000000001', 'dd000000-0000-0000-0000-000000000001', 'dd100000-0000-0000-0000-000000000001', '001');

create function pg_temp.assert_eq(label text, got text, want text) returns void language plpgsql as $$
begin
  if got is distinct from want then raise exception 'FALLA %: obtenido %, esperado %', label, got, want; end if;
  raise notice 'ok  %', label;
end $$;
create function pg_temp.assert_raises(label text, stmt text, expected text) returns void language plpgsql as $$
begin
  begin execute stmt;
  exception when others then
    if sqlerrm = expected or (expected = 'permission' and sqlstate = '42501') or (expected = 'unique' and sqlstate = '23505') then
      raise notice 'ok  %', label; return;
    end if;
    raise exception 'FALLA %: error inesperado % (%)', label, sqlerrm, sqlstate;
  end;
  raise exception 'FALLA %: no hubo error', label;
end $$;
create function pg_temp.new_invoice(org uuid, est uuid, ep uuid, key text) returns uuid language plpgsql as $$
declare r jsonb;
begin
  r := public.create_invoice_draft(org, 'test', 'mock', null, 'app', key, 'h-' || key,
    jsonb_build_object('establishment_code','001','emission_point_code','001','issue_date','2026-10-05',
      'customer', jsonb_build_object('identification_type','cedula','identification','0912345678','legal_name','Cli'),
      'totals', jsonb_build_object('subtotal',10,'discount',0,'tax',0,'total',10),
      'items', jsonb_build_array(jsonb_build_object('description','x','quantity',1,'unit_price',10,'discount',0,'tax_rate',0,'tax_amount',0,'total',10))));
  return (r->>'invoice_id')::uuid;
end $$;
create function pg_temp.hook(evt text, doc text, st text, auth text default null) returns jsonb language sql as $$
  select public.process_webhook_event('mock', evt, 'invoice.' || coalesce(st,'x'), jsonb_build_object('id', evt),
    doc, st::public.invoice_status, case when auth is null then null else 'AK-' || auth end, auth, case when auth is null then null else now() end,
    case when st = 'rejected' then 'motivo' else null end)
$$;

set role service_role;
create temp table inv as
  select pg_temp.new_invoice('cc000000-0000-0000-0000-000000000001','cc100000-0000-0000-0000-000000000001','cc200000-0000-0000-0000-000000000001','w1') as a,
         pg_temp.new_invoice('dd000000-0000-0000-0000-000000000001','dd100000-0000-0000-0000-000000000001','dd200000-0000-0000-0000-000000000001','w2') as b;
grant select on inv to public;
select public.apply_provider_result('cc000000-0000-0000-0000-000000000001', (select a from inv), 'mock', 'mock_A', 'processing', null, null, null, null);
select public.apply_provider_result('dd000000-0000-0000-0000-000000000001', (select b from inv), 'mock', 'mock_B', 'processing', null, null, null, null);

-- aplicar
select pg_temp.assert_eq('authorized se aplica', (pg_temp.hook('e1','mock_A','authorized','AUTH1'))->>'outcome', 'applied');
select pg_temp.assert_eq('factura A autorizada con número',
  (select status::text || ':' || sri_authorization_number from public.invoices where id = (select a from inv)), 'authorized:AUTH1');
select pg_temp.assert_eq('clave de acceso guardada', (select access_key from public.invoices where id = (select a from inv)), 'AK-AUTH1');
select pg_temp.assert_eq('evento queda processed con empresa e invoice',
  (select status || ':' || (organization_id = 'cc000000-0000-0000-0000-000000000001')::text || ':' || (invoice_id = (select a from inv))::text from public.webhook_events where event_id = 'e1'), 'processed:true:true');
select pg_temp.assert_eq('queda registro en billing_events',
  (select count(*) from public.billing_events where event_type = 'provider.webhook' and invoice_id = (select a from inv))::text, '1');

-- idempotencia
select pg_temp.assert_eq('mismo evento otra vez => duplicate', (pg_temp.hook('e1','mock_A','authorized','AUTH1'))->>'outcome', 'duplicate');
select pg_temp.assert_eq('el duplicado no genera otro billing_event',
  (select count(*) from public.billing_events where event_type = 'provider.webhook' and invoice_id = (select a from inv))::text, '1');
select pg_temp.assert_eq('un solo registro del evento', (select count(*) from public.webhook_events where event_id = 'e1')::text, '1');

-- estados finales y desorden
select pg_temp.assert_eq('rejected posterior no pisa authorized', (pg_temp.hook('e2','mock_A','rejected'))->>'outcome', 'unchanged');
select pg_temp.assert_eq('sigue authorized', (select status::text from public.invoices where id = (select a from inv)), 'authorized');
select pg_temp.assert_eq('processing tardío no retrocede', (pg_temp.hook('e3','mock_A','processing'))->>'outcome', 'unchanged');

-- aislamiento: el evento de A no toca B
select pg_temp.assert_eq('la factura B sigue processing', (select status::text from public.invoices where id = (select b from inv)), 'processing');
select pg_temp.assert_eq('rejected aplica a B (su propio documento)', (pg_temp.hook('e4','mock_B','rejected'))->>'outcome', 'applied');
select pg_temp.assert_eq('B rechazada con motivo y A intacta',
  (select string_agg(status::text, ',' order by organization_id) from public.invoices where id in ((select a from inv), (select b from inv))), 'authorized,rejected');

-- documento desconocido: no_found, reintentable
select pg_temp.assert_eq('documento desconocido => not_found', (pg_temp.hook('e5','mock_C','authorized','AUTH5'))->>'outcome', 'not_found');
select pg_temp.assert_eq('el evento queda failed', (select status from public.webhook_events where event_id = 'e5'), 'failed');
-- carrera: el aviso llegó antes de guardar el id del documento
create temp table inv2 as select pg_temp.new_invoice('cc000000-0000-0000-0000-000000000001','cc100000-0000-0000-0000-000000000001','cc200000-0000-0000-0000-000000000001','w3') as c;
grant select on inv2 to public;
select public.apply_provider_result('cc000000-0000-0000-0000-000000000001', (select c from inv2), 'mock', 'mock_C', 'processing', null, null, null, null);
select pg_temp.assert_eq('el reintento del mismo evento ahora se aplica', (pg_temp.hook('e5','mock_C','authorized','AUTH5'))->>'outcome', 'applied');
select pg_temp.assert_eq('el evento reintentado queda processed', (select status from public.webhook_events where event_id = 'e5'), 'processed');

-- sin id de documento / estado no permitido
select pg_temp.assert_eq('sin documento => ignored',
  (public.process_webhook_event('mock','e6','x','{}'::jsonb,null,'authorized',null,null,null,null))->>'outcome', 'ignored');
create temp table inv3 as select pg_temp.new_invoice('cc000000-0000-0000-0000-000000000001','cc100000-0000-0000-0000-000000000001','cc200000-0000-0000-0000-000000000001','w4') as d;
grant select on inv3 to public;
select public.apply_provider_result('cc000000-0000-0000-0000-000000000001', (select d from inv3), 'mock', 'mock_D', 'processing', null, null, null, null);
select pg_temp.assert_eq('estado "draft" no se aplica', (pg_temp.hook('e7','mock_D','draft'))->>'outcome', 'unchanged');
select pg_temp.assert_eq('la factura D sigue processing', (select status::text from public.invoices where id = (select d from inv3)), 'processing');

-- un documento del proveedor no puede asignarse a dos facturas
select pg_temp.assert_raises('provider_document_id único',
  $q$select public.apply_provider_result('cc000000-0000-0000-0000-000000000001', (select d from inv3), 'mock', 'mock_A', 'processing', null, null, null, null)$q$,
  'unique');
reset role;

-- privilegios
set role authenticated;
select pg_temp.assert_raises('authenticated no ejecuta process_webhook_event',
  $q$select public.process_webhook_event('mock','x','x','{}'::jsonb,'d','authorized',null,null,null,null)$q$, 'permission');
select pg_temp.assert_raises('authenticated no lee webhook_events', $q$select * from public.webhook_events$q$, 'permission');
reset role;
set role anon;
select pg_temp.assert_raises('anon no ejecuta process_webhook_event',
  $q$select public.process_webhook_event('mock','x','x','{}'::jsonb,'d','authorized',null,null,null,null)$q$, 'permission');
reset role;

\echo 'TODAS LAS PRUEBAS DE WEBHOOKS PASARON'
