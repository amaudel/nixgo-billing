-- Fase 2: recepción idempotente de webhooks del proveedor.

-- Un documento del proveedor identifica UNA sola factura de Nixgo: sin esto, un webhook podría
-- resolverse a la factura equivocada. (Parcial: las facturas aún sin enviar no tienen id.)
create unique index invoices_provider_document_uidx
  on public.invoices (provider, provider_document_id)
  where provider_document_id is not null;

-- Trazabilidad: a qué factura/empresa afectó cada evento (se rellena al procesarlo).
alter table public.webhook_events
  add column organization_id uuid,
  add column invoice_id uuid,
  add constraint webhook_events_invoice_fk
    foreign key (invoice_id, organization_id) references public.invoices (id, organization_id);
create index webhook_events_invoice_idx on public.webhook_events (invoice_id);

-- process_webhook_event: TODO en una transacción.
--  1. Reclama el evento (provider, event_id). Una entrega concurrente espera aquí y luego ve
--     el resultado, por lo que cada evento se aplica una sola vez.
--  2. La empresa se obtiene SIEMPRE de la factura encontrada por (provider, provider_document_id);
--     nunca de datos del cuerpo del webhook.
--  3. Solo transiciona facturas 'pending'/'processing' hacia un estado válido de webhook; un
--     estado final no se pisa (los avisos pueden llegar repetidos o desordenados).
-- Resultados: applied | unchanged | duplicate | ignored | not_found.
--   not_found deja el evento 'failed' y se reprocesa si el proveedor reintenta (p. ej. el aviso
--   llegó antes de que guardáramos el id del documento).
create function public.process_webhook_event(
  p_provider public.billing_provider_name,
  p_event_id text,
  p_event_type text,
  p_payload jsonb,
  p_provider_document_id text,
  p_status public.invoice_status,
  p_access_key text,
  p_authorization_number text,
  p_authorized_at timestamptz,
  p_rejection_reason text
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_claimed integer;
  v_existing public.webhook_events;
  v_invoice public.invoices;
  v_changed boolean := false;
begin
  insert into public.webhook_events (provider, event_id, event_type, payload)
  values (p_provider, p_event_id, p_event_type, p_payload)
  on conflict (provider, event_id) do nothing;
  get diagnostics v_claimed = row_count;

  if v_claimed = 0 then
    select * into v_existing from public.webhook_events
     where provider = p_provider and event_id = p_event_id for update;
    if v_existing.status in ('processed', 'ignored') then
      return jsonb_build_object('outcome', 'duplicate');
    end if;
  end if;

  if p_provider_document_id is null then
    update public.webhook_events
       set status = 'ignored', error = 'sin id de documento', processed_at = now()
     where provider = p_provider and event_id = p_event_id;
    return jsonb_build_object('outcome', 'ignored');
  end if;

  select * into v_invoice from public.invoices
   where provider = p_provider and provider_document_id = p_provider_document_id
   for update;
  if not found then
    update public.webhook_events
       set status = 'failed', error = 'invoice_not_found'
     where provider = p_provider and event_id = p_event_id;
    return jsonb_build_object('outcome', 'not_found');
  end if;

  if p_status in ('processing', 'authorized', 'rejected', 'failed')
     and v_invoice.status in ('pending', 'processing') then
    update public.invoices
       set status = p_status,
           access_key = coalesce(p_access_key, access_key),
           sri_authorization_number = coalesce(p_authorization_number, sri_authorization_number),
           sri_authorized_at = coalesce(p_authorized_at, sri_authorized_at),
           rejection_reason = coalesce(p_rejection_reason, rejection_reason)
     where id = v_invoice.id and organization_id = v_invoice.organization_id;
    v_changed := true;
  end if;

  insert into public.billing_events
    (organization_id, invoice_id, event_type, provider, actor_type, actor_id, request, response)
  values (
    v_invoice.organization_id, v_invoice.id, 'provider.webhook', p_provider, 'provider', p_event_id,
    p_payload,
    jsonb_build_object('applied', v_changed, 'from', v_invoice.status, 'to', p_status)
  );

  update public.webhook_events
     set status = 'processed', processed_at = now(), error = null,
         organization_id = v_invoice.organization_id, invoice_id = v_invoice.id
   where provider = p_provider and event_id = p_event_id;

  return jsonb_build_object(
    'outcome', case when v_changed then 'applied' else 'unchanged' end,
    'invoice_id', v_invoice.id);
end;
$$;

revoke all on function public.process_webhook_event(public.billing_provider_name, text, text, jsonb, text, public.invoice_status, text, text, timestamptz, text) from public, anon, authenticated;
grant execute on function public.process_webhook_event(public.billing_provider_name, text, text, jsonb, text, public.invoice_status, text, text, timestamptz, text) to service_role;
