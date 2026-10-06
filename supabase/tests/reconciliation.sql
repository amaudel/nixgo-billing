\set ON_ERROR_STOP on

insert into public.organizations (id, ruc, legal_name, address) values
  ('ff000000-0000-0000-0000-000000000001', '1799999999001', 'Org R1', 'x');
insert into public.establishments (id, organization_id, code, name, address) values
  ('ff100000-0000-0000-0000-000000000001', 'ff000000-0000-0000-0000-000000000001', '001', 'R', 'x');
insert into public.emission_points (id, organization_id, establishment_id, code) values
  ('ff200000-0000-0000-0000-000000000001', 'ff000000-0000-0000-0000-000000000001', 'ff100000-0000-0000-0000-000000000001', '001');
insert into public.organization_provider_configs (organization_id, environment, provider, provider_company_ref)
values ('ff000000-0000-0000-0000-000000000001', 'test', 'mock', 'ref-1');

create function pg_temp.assert_eq(label text, got text, want text) returns void language plpgsql as $$
begin
  if got is distinct from want then raise exception 'FALLA %: obtenido %, esperado %', label, got, want; end if;
  raise notice 'ok  %', label;
end $$;
create function pg_temp.assert_raises(label text, stmt text) returns void language plpgsql as $$
begin
  begin execute stmt; exception when insufficient_privilege then raise notice 'ok  %', label; return; end;
  raise exception 'FALLA %: no hubo error', label;
end $$;
create function pg_temp.new_invoice(key text) returns uuid language plpgsql as $$
begin
  return (public.create_invoice_draft('ff000000-0000-0000-0000-000000000001','test','mock',null,'app',key,'h-'||key,
    jsonb_build_object('establishment_code','001','emission_point_code','001','issue_date','2026-10-05',
      'customer', jsonb_build_object('identification_type','cedula','identification','0912345678','legal_name','Cli'),
      'totals', jsonb_build_object('subtotal',10,'discount',0,'tax',0,'total',10),
      'items', jsonb_build_array(jsonb_build_object('description','x','quantity',1,'unit_price',10,'discount',0,'tax_rate',0,'tax_amount',0,'total',10)))))->>'invoice_id';
end $$;

set role service_role;
create temp table inv as select pg_temp.new_invoice('r1') a, pg_temp.new_invoice('r2') b, pg_temp.new_invoice('r3') c, pg_temp.new_invoice('r4') d;
grant select on inv to public;
-- a, b: processing con documento; c: pending sin documento; d: autorizada
select public.apply_provider_result('ff000000-0000-0000-0000-000000000001',(select a from inv),'mock','mock_ra','processing',null,null,null,null);
select public.apply_provider_result('ff000000-0000-0000-0000-000000000001',(select b from inv),'mock','mock_rb','processing',null,null,null,null);
select public.apply_provider_result('ff000000-0000-0000-0000-000000000001',(select d from inv),'mock','mock_rd','authorized','AK-REC-1','AU-REC-1',now(),null);
reset role;

-- envejecer a y b (la fecha la fija un trigger al actualizar: se desactiva solo para preparar el dato)
alter table public.invoices disable trigger invoices_updated_at;
update public.invoices set updated_at = now() - interval '2 hours' where id = (select a from inv);
update public.invoices set updated_at = now() - interval '1 hour' where id = (select b from inv);
alter table public.invoices enable trigger invoices_updated_at;

set role service_role;
select pg_temp.assert_eq('con 10 min lista las 2 atascadas', jsonb_array_length(public.invoices_to_reconcile(10, 50))::text, '2');
select pg_temp.assert_eq('la más antigua va primero', (public.invoices_to_reconcile(10, 50))->0->>'provider_document_id', 'mock_ra');
select pg_temp.assert_eq('devuelve lo que necesita el adaptador',
  (select (j->>'ruc') || ':' || (j->>'environment') || ':' || (j->>'provider_company_ref') from jsonb_array_elements(public.invoices_to_reconcile(10, 50)) j limit 1), '1799999999001:test:ref-1');
select pg_temp.assert_eq('no incluye pending sin documento ni autorizadas',
  (select count(*) from jsonb_array_elements(public.invoices_to_reconcile(0, 50)) j where j->>'id' in ((select c from inv)::text, (select d from inv)::text))::text, '0');
select pg_temp.assert_eq('con 90 min solo la de 2 horas', jsonb_array_length(public.invoices_to_reconcile(90, 50))::text, '1');
select pg_temp.assert_eq('con 1000 min ninguna', jsonb_array_length(public.invoices_to_reconcile(1000, 50))::text, '0');
select pg_temp.assert_eq('respeta el límite', jsonb_array_length(public.invoices_to_reconcile(10, 1))::text, '1');

-- si el proveedor sigue diciendo "processing", la factura pasa al final de la cola
select pg_temp.assert_eq('reaplicar processing es un cambio válido',
  public.apply_provider_result('ff000000-0000-0000-0000-000000000001',(select a from inv),'mock',null,'processing',null,null,null,null)::text, 'true');
select pg_temp.assert_eq('ya no está atascada (updated_at renovado)', jsonb_array_length(public.invoices_to_reconcile(10, 50))::text, '1');
select pg_temp.assert_eq('queda la otra', (public.invoices_to_reconcile(10, 50))->0->>'provider_document_id', 'mock_rb');

-- resolver desde el proveedor
select pg_temp.assert_eq('el proveedor autoriza',
  public.apply_provider_result('ff000000-0000-0000-0000-000000000001',(select b from inv),'mock',null,'authorized','AK-REC-2','AU-REC-2',now(),null)::text, 'true');
select pg_temp.assert_eq('autorizada sale de la cola (solo en esta empresa quedan 0)',
  (select count(*) from jsonb_array_elements(public.invoices_to_reconcile(0, 100)) j
    where j->>'organization_id' = 'ff000000-0000-0000-0000-000000000001' and j->>'id' = (select b from inv)::text)::text, '0');
reset role;

set role authenticated;
select pg_temp.assert_raises('authenticated no ejecuta invoices_to_reconcile', $q$select public.invoices_to_reconcile(0, 10)$q$);
reset role;
set role anon;
select pg_temp.assert_raises('anon no ejecuta invoices_to_reconcile', $q$select public.invoices_to_reconcile(0, 10)$q$);
reset role;

\echo 'TODAS LAS PRUEBAS DE RECONCILIACION PASARON'
