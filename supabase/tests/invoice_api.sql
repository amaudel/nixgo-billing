-- Pruebas de las funciones de la API de facturas (create_invoice_draft, invoice_detail, ...).
\set ON_ERROR_STOP on

insert into public.organizations (id, ruc, legal_name, address) values
  ('aa000000-0000-0000-0000-000000000001', '1791111111001', 'Org X', 'x'),
  ('bb000000-0000-0000-0000-000000000001', '1792222222001', 'Org Y', 'x');
insert into public.establishments (id, organization_id, code, name, address) values
  ('aa100000-0000-0000-0000-000000000001', 'aa000000-0000-0000-0000-000000000001', '001', 'X', 'x'),
  ('bb100000-0000-0000-0000-000000000001', 'bb000000-0000-0000-0000-000000000001', '001', 'Y', 'x');
insert into public.emission_points (id, organization_id, establishment_id, code) values
  ('aa200000-0000-0000-0000-000000000001', 'aa000000-0000-0000-0000-000000000001', 'aa100000-0000-0000-0000-000000000001', '001'),
  ('bb200000-0000-0000-0000-000000000001', 'bb000000-0000-0000-0000-000000000001', 'bb100000-0000-0000-0000-000000000001', '001');

create function pg_temp.assert_eq(label text, got text, want text) returns void language plpgsql as $$
begin
  if got is distinct from want then raise exception 'FALLA %: obtenido %, esperado %', label, got, want; end if;
  raise notice 'ok  %', label;
end $$;
create function pg_temp.assert_raises(label text, stmt text, expected text) returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    if sqlerrm = expected or (expected = 'permission' and sqlstate = '42501') then
      raise notice 'ok  %', label; return;
    end if;
    raise exception 'FALLA %: error inesperado % (%)', label, sqlerrm, sqlstate;
  end;
  raise exception 'FALLA %: no hubo error', label;
end $$;
create function pg_temp.invoice_body(est text, pt text, ref text, total numeric) returns jsonb language sql as $$
  select jsonb_build_object(
    'establishment_code', est, 'emission_point_code', pt, 'issue_date', '2026-10-05',
    'external_reference', ref,
    'customer', jsonb_build_object('identification_type', 'cedula', 'identification', '0912345678',
                                   'legal_name', 'Juan Pérez', 'email', 'j@x.com'),
    'totals', jsonb_build_object('subtotal', total, 'discount', 0, 'tax', 0, 'total', total),
    'items', jsonb_build_array(
      jsonb_build_object('sku', 'S1', 'description', 'Plan', 'quantity', 1, 'unit_price', total,
                         'discount', 0, 'tax_rate', 0, 'tax_amount', 0, 'total', total)))
$$;

set role service_role;

-- crear
create temp table r1 as select public.create_invoice_draft(
  'aa000000-0000-0000-0000-000000000001', 'test', 'mock', null, 'app', 'k1', 'h1',
  pg_temp.invoice_body('001', '001', 'pay_1', 25)) as r;
grant select on r1 to public;
select pg_temp.assert_eq('crea factura nueva', (select r->>'replayed' from r1), 'false');
select pg_temp.assert_eq('estado inicial pending', (public.invoice_detail('aa000000-0000-0000-0000-000000000001','test',(select (r->>'invoice_id')::uuid from r1)))->>'status', 'pending');
select pg_temp.assert_eq('secuencial 1', (public.invoice_detail('aa000000-0000-0000-0000-000000000001','test',(select (r->>'invoice_id')::uuid from r1)))->>'sequential', '1');
select pg_temp.assert_eq('guarda 1 ítem', jsonb_array_length(public.invoice_detail('aa000000-0000-0000-0000-000000000001','test',(select (r->>'invoice_id')::uuid from r1))->'items')::text, '1');
select pg_temp.assert_eq('evento invoice.created', (select count(*) from public.billing_events where event_type='invoice.created' and organization_id='aa000000-0000-0000-0000-000000000001')::text, '1');

-- idempotencia
select pg_temp.assert_eq('misma clave y cuerpo => replay',
  (public.create_invoice_draft('aa000000-0000-0000-0000-000000000001','test','mock',null,'app','k1','h1',pg_temp.invoice_body('001','001','pay_1',25)))->>'invoice_id',
  (select r->>'invoice_id' from r1));
select pg_temp.assert_eq('replay no consume secuencial',
  (select current_sequence from public.emission_points where id='aa200000-0000-0000-0000-000000000001')::text, '1');
select pg_temp.assert_raises('misma clave, otro cuerpo => conflicto',
  $q$select public.create_invoice_draft('aa000000-0000-0000-0000-000000000001','test','mock',null,'app','k1','OTRO',pg_temp.invoice_body('001','001','pay_1',99))$q$,
  'idempotency_conflict');
select pg_temp.assert_eq('misma clave en otro ambiente => factura distinta',
  ((public.create_invoice_draft('aa000000-0000-0000-0000-000000000001','production','mock',null,'app','k1','h1',pg_temp.invoice_body('001','001','pay_1',25)))->>'replayed'), 'false');
select pg_temp.assert_eq('la misma clave en otra empresa es independiente',
  ((public.create_invoice_draft('bb000000-0000-0000-0000-000000000001','test','mock',null,'app','k1','h1',pg_temp.invoice_body('001','001','pay_1',25)))->>'replayed'), 'false');

-- errores revierten todo (sin hueco en el secuencial y la clave queda libre)
select pg_temp.assert_raises('establecimiento inexistente',
  $q$select public.create_invoice_draft('aa000000-0000-0000-0000-000000000001','test','mock',null,'app','k2','h2',pg_temp.invoice_body('999','001','x',1))$q$,
  'establishment_not_found');
select pg_temp.assert_raises('punto de emisión inexistente',
  $q$select public.create_invoice_draft('aa000000-0000-0000-0000-000000000001','test','mock',null,'app','k2','h2',pg_temp.invoice_body('001','999','x',1))$q$,
  'emission_point_not_found');
select pg_temp.assert_eq('el error no dejó la clave reclamada',
  (select count(*) from public.idempotency_keys where key = 'test:k2')::text, '0');
-- (la factura de producción y la de test comparten punto de emisión: van en 2)
select pg_temp.assert_eq('el error no consumió secuencial',
  (select current_sequence from public.emission_points where id='aa200000-0000-0000-0000-000000000001')::text, '2');

-- aislamiento
select pg_temp.assert_raises('no usa establecimiento de otra empresa',
  $q$select public.create_invoice_draft('aa000000-0000-0000-0000-000000000001','test','mock',null,'app','k3','h3',pg_temp.invoice_body('002','001','x',1))$q$,
  'establishment_not_found');
select pg_temp.assert_eq('otra empresa no ve la factura (detail)',
  coalesce((public.invoice_detail('bb000000-0000-0000-0000-000000000001','test',(select (r->>'invoice_id')::uuid from r1)))::text, 'null'), 'null');
select pg_temp.assert_eq('otro ambiente no ve la factura (detail)',
  coalesce((public.invoice_detail('aa000000-0000-0000-0000-000000000001','production',(select (r->>'invoice_id')::uuid from r1)))::text, 'null'), 'null');
select pg_temp.assert_eq('el cliente es por empresa',
  (select count(*) from public.customers where identification = '0912345678')::text, '2');

-- listado
select pg_temp.assert_eq('lista solo facturas de la empresa y ambiente',
  jsonb_array_length(public.invoice_list('aa000000-0000-0000-0000-000000000001','test',null,null,10,0))::text, '1');
select pg_temp.assert_eq('filtra por external_reference',
  jsonb_array_length(public.invoice_list('aa000000-0000-0000-0000-000000000001','test',null,'nope',10,0))::text, '0');
select pg_temp.assert_eq('filtra por estado',
  jsonb_array_length(public.invoice_list('aa000000-0000-0000-0000-000000000001','test','authorized',null,10,0))::text, '0');

-- resultado del proveedor
select pg_temp.assert_eq('pending -> processing',
  public.apply_provider_result('aa000000-0000-0000-0000-000000000001',(select (r->>'invoice_id')::uuid from r1),'mock','mock_1','processing',null,null,null,null)::text, 'true');
select pg_temp.assert_eq('processing -> authorized',
  public.apply_provider_result('aa000000-0000-0000-0000-000000000001',(select (r->>'invoice_id')::uuid from r1),'mock',null,'authorized','AK','AUTH1',now(),null)::text, 'true');
select pg_temp.assert_eq('un estado final no vuelve atrás',
  public.apply_provider_result('aa000000-0000-0000-0000-000000000001',(select (r->>'invoice_id')::uuid from r1),'mock',null,'rejected',null,null,null,'x')::text, 'false');
select pg_temp.assert_eq('otra empresa no puede modificarla',
  public.apply_provider_result('bb000000-0000-0000-0000-000000000001',(select (r->>'invoice_id')::uuid from r1),'mock',null,'voided',null,null,null,null)::text, 'false');
select pg_temp.assert_eq('conserva provider_document_id',
  (public.invoice_detail('aa000000-0000-0000-0000-000000000001','test',(select (r->>'invoice_id')::uuid from r1)))->>'provider_document_id', 'mock_1');
reset role;

-- las funciones no son ejecutables por usuarios del panel ni anon
set role authenticated;
select pg_temp.assert_raises('authenticated no ejecuta create_invoice_draft',
  $q$select public.create_invoice_draft('aa000000-0000-0000-0000-000000000001','test','mock',null,'app','kz','hz',pg_temp.invoice_body('001','001','x',1))$q$, 'permission');
select pg_temp.assert_raises('authenticated no ejecuta invoice_detail',
  $q$select public.invoice_detail('aa000000-0000-0000-0000-000000000001','test',gen_random_uuid())$q$, 'permission');
reset role;
set role anon;
select pg_temp.assert_raises('anon no ejecuta invoice_list',
  $q$select public.invoice_list('aa000000-0000-0000-0000-000000000001','test',null,null,10,0)$q$, 'permission');
reset role;

\echo 'TODAS LAS PRUEBAS DE LA API DE FACTURAS PASARON'
