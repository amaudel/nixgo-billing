-- Funciones de la API de facturas (Fase 1). Solo service role: el backend ya resolvió la
-- organización desde la API key y la pasa explícitamente; ninguna función confía en auth.uid().
-- Cada función filtra SIEMPRE por organization_id.

-- ---------------------------------------------------------------- create_invoice_draft
-- Reserva atómica: idempotencia + cliente + secuencial + factura 'pending' + ítems + evento.
-- Si algo falla, todo se revierte (incluido el secuencial: no quedan huecos).
-- p_invoice: { establishment_code, emission_point_code, issue_date, external_reference,
--              customer{...}, totals{subtotal,discount,tax,total}, items[...] }
create function public.create_invoice_draft(
  p_organization_id uuid,
  p_environment public.billing_environment,
  p_provider public.billing_provider_name,
  p_api_key_id uuid,
  p_source_application text,
  p_idempotency_key text,
  p_request_hash text,
  p_invoice jsonb
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_key text := p_environment::text || ':' || p_idempotency_key;  -- test y producción no se mezclan
  v_claimed integer;
  v_existing public.idempotency_keys;
  v_establishment_id uuid;
  v_emission_point_id uuid;
  v_customer_id uuid;
  v_sequential integer;
  v_invoice_id uuid;
begin
  -- 1. Reclamar la clave. Una petición concurrente con la misma clave espera aquí a que la
  --    primera confirme o revierta, y después ve su resultado.
  insert into public.idempotency_keys (organization_id, key, request_hash)
  values (p_organization_id, v_key, p_request_hash)
  on conflict (organization_id, key) do nothing;
  get diagnostics v_claimed = row_count;

  if v_claimed = 0 then
    select * into v_existing from public.idempotency_keys
     where organization_id = p_organization_id and key = v_key;
    if v_existing.request_hash <> p_request_hash then
      raise exception 'idempotency_conflict';
    end if;
    return jsonb_build_object('replayed', true, 'invoice_id', v_existing.invoice_id);
  end if;

  -- 2. Establecimiento y punto de emisión de ESTA organización.
  select id into v_establishment_id from public.establishments
   where organization_id = p_organization_id and code = p_invoice->>'establishment_code';
  if v_establishment_id is null then raise exception 'establishment_not_found'; end if;

  select id into v_emission_point_id from public.emission_points
   where organization_id = p_organization_id and establishment_id = v_establishment_id
     and code = p_invoice->>'emission_point_code' and document_type = 'invoice';
  if v_emission_point_id is null then raise exception 'emission_point_not_found'; end if;

  -- 3. Cliente (se actualiza si ya existe para esta organización).
  insert into public.customers
    (organization_id, identification_type, identification, legal_name, email, phone, address)
  values (
    p_organization_id,
    (p_invoice#>>'{customer,identification_type}')::public.identification_type,
    p_invoice#>>'{customer,identification}',
    p_invoice#>>'{customer,legal_name}',
    p_invoice#>>'{customer,email}',
    p_invoice#>>'{customer,phone}',
    p_invoice#>>'{customer,address}'
  )
  on conflict (organization_id, identification_type, identification) do update
    set legal_name = excluded.legal_name,
        email = coalesce(excluded.email, public.customers.email),
        phone = coalesce(excluded.phone, public.customers.phone),
        address = coalesce(excluded.address, public.customers.address)
  returning id into v_customer_id;

  -- 4. Secuencial atómico y factura.
  v_sequential := public.next_sequential(v_emission_point_id, p_organization_id);

  insert into public.invoices (
    organization_id, establishment_id, emission_point_id, customer_id, sequential, issue_date,
    subtotal, discount, tax, total, status, environment, provider, source_application,
    external_reference, idempotency_key, created_by_api_key_id
  ) values (
    p_organization_id, v_establishment_id, v_emission_point_id, v_customer_id, v_sequential,
    (p_invoice->>'issue_date')::date,
    (p_invoice#>>'{totals,subtotal}')::numeric, (p_invoice#>>'{totals,discount}')::numeric,
    (p_invoice#>>'{totals,tax}')::numeric, (p_invoice#>>'{totals,total}')::numeric,
    'pending', p_environment, p_provider, p_source_application,
    p_invoice->>'external_reference', v_key, p_api_key_id
  ) returning id into v_invoice_id;

  insert into public.invoice_items
    (organization_id, invoice_id, sku, description, quantity, unit_price, discount, tax_rate, tax_amount, total)
  select p_organization_id, v_invoice_id, i->>'sku', i->>'description',
         (i->>'quantity')::numeric, (i->>'unit_price')::numeric, (i->>'discount')::numeric,
         (i->>'tax_rate')::numeric, (i->>'tax_amount')::numeric, (i->>'total')::numeric
    from jsonb_array_elements(p_invoice->'items') as i;

  update public.idempotency_keys set invoice_id = v_invoice_id
   where organization_id = p_organization_id and key = v_key;

  insert into public.billing_events
    (organization_id, invoice_id, event_type, provider, actor_type, actor_id, source_application, request)
  values (
    p_organization_id, v_invoice_id, 'invoice.created', p_provider, 'api_key', p_api_key_id::text,
    p_source_application,
    jsonb_build_object('external_reference', p_invoice->>'external_reference',
                       'total', p_invoice#>'{totals,total}')
  );

  return jsonb_build_object('replayed', false, 'invoice_id', v_invoice_id);
end;
$$;

-- ---------------------------------------------------------------- invoice_detail
-- Una factura de una organización y ambiente (null si no existe o es de otra empresa).
create function public.invoice_detail(
  p_organization_id uuid,
  p_environment public.billing_environment,
  p_invoice_id uuid
) returns jsonb
language sql stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', i.id,
    'status', i.status,
    'environment', i.environment,
    'provider', i.provider,
    'provider_document_id', i.provider_document_id,
    'establishment_code', e.code,
    'emission_point_code', ep.code,
    'sequential', i.sequential,
    'issue_date', i.issue_date,
    'currency', i.currency,
    'external_reference', i.external_reference,
    'subtotal', i.subtotal, 'discount', i.discount, 'tax', i.tax, 'total', i.total,
    'access_key', i.access_key,
    'authorization_number', i.sri_authorization_number,
    'authorized_at', i.sri_authorized_at,
    'rejection_reason', i.rejection_reason,
    'created_at', i.created_at,
    'customer', jsonb_build_object(
      'identification_type', c.identification_type, 'identification', c.identification,
      'legal_name', c.legal_name, 'email', c.email, 'phone', c.phone, 'address', c.address),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'sku', it.sku, 'description', it.description, 'quantity', it.quantity,
        'unit_price', it.unit_price, 'discount', it.discount, 'tax_rate', it.tax_rate,
        'tax_amount', it.tax_amount, 'total', it.total) order by it.id)
        from public.invoice_items it
       where it.invoice_id = i.id and it.organization_id = i.organization_id), '[]'::jsonb)
  )
  from public.invoices i
  join public.establishments e on e.id = i.establishment_id and e.organization_id = i.organization_id
  join public.emission_points ep on ep.id = i.emission_point_id and ep.organization_id = i.organization_id
  join public.customers c on c.id = i.customer_id and c.organization_id = i.organization_id
  where i.id = p_invoice_id and i.organization_id = p_organization_id and i.environment = p_environment;
$$;

-- ---------------------------------------------------------------- invoice_list
-- Resumen paginado (sin ítems), más recientes primero. Devuelve limit+1 filas máximo para que
-- el llamador sepa si hay más.
create function public.invoice_list(
  p_organization_id uuid,
  p_environment public.billing_environment,
  p_status public.invoice_status,
  p_external_reference text,
  p_limit integer,
  p_offset integer
) returns jsonb
language sql stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(row_to_json(r)::jsonb order by r.created_at desc, r.id desc), '[]'::jsonb)
  from (
    select i.id, i.status, i.environment, e.code as establishment_code, ep.code as emission_point_code,
           i.sequential, i.issue_date, i.currency, i.external_reference,
           i.subtotal, i.discount, i.tax, i.total, i.access_key,
           i.sri_authorization_number as authorization_number, i.sri_authorized_at as authorized_at,
           i.rejection_reason, i.created_at, c.identification as customer_identification,
           c.legal_name as customer_legal_name
      from public.invoices i
      join public.establishments e on e.id = i.establishment_id and e.organization_id = i.organization_id
      join public.emission_points ep on ep.id = i.emission_point_id and ep.organization_id = i.organization_id
      join public.customers c on c.id = i.customer_id and c.organization_id = i.organization_id
     where i.organization_id = p_organization_id and i.environment = p_environment
       and (p_status is null or i.status = p_status)
       and (p_external_reference is null or i.external_reference = p_external_reference)
     order by i.created_at desc, i.id desc
     limit greatest(p_limit, 1) + 1 offset greatest(p_offset, 0)
  ) r;
$$;

-- ---------------------------------------------------------------- apply_provider_result
-- Aplica el resultado del proveedor (respuesta directa, reconciliación o webhook).
-- Solo transiciona facturas aún no finales; devuelve false si no cambió nada.
create function public.apply_provider_result(
  p_organization_id uuid,
  p_invoice_id uuid,
  p_provider public.billing_provider_name,
  p_provider_document_id text,
  p_status public.invoice_status,
  p_access_key text,
  p_authorization_number text,
  p_authorized_at timestamptz,
  p_rejection_reason text
) returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_rows integer;
begin
  update public.invoices
     set provider = p_provider,
         provider_document_id = coalesce(p_provider_document_id, provider_document_id),
         status = p_status,
         access_key = coalesce(p_access_key, access_key),
         sri_authorization_number = coalesce(p_authorization_number, sri_authorization_number),
         sri_authorized_at = coalesce(p_authorized_at, sri_authorized_at),
         rejection_reason = coalesce(p_rejection_reason, rejection_reason)
   where id = p_invoice_id and organization_id = p_organization_id
     and status in ('pending', 'processing');
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

-- ---------------------------------------------------------------- privilegios
-- Supabase concede EXECUTE a anon/authenticated por defecto: se retira explícitamente.
revoke all on function public.create_invoice_draft(uuid, public.billing_environment, public.billing_provider_name, uuid, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.invoice_detail(uuid, public.billing_environment, uuid) from public, anon, authenticated;
revoke all on function public.invoice_list(uuid, public.billing_environment, public.invoice_status, text, integer, integer) from public, anon, authenticated;
revoke all on function public.apply_provider_result(uuid, uuid, public.billing_provider_name, text, public.invoice_status, text, text, timestamptz, text) from public, anon, authenticated;
grant execute on function public.create_invoice_draft(uuid, public.billing_environment, public.billing_provider_name, uuid, text, text, text, jsonb) to service_role;
grant execute on function public.invoice_detail(uuid, public.billing_environment, uuid) to service_role;
grant execute on function public.invoice_list(uuid, public.billing_environment, public.invoice_status, text, integer, integer) to service_role;
grant execute on function public.apply_provider_result(uuid, uuid, public.billing_provider_name, text, public.invoice_status, text, text, timestamptz, text) to service_role;
