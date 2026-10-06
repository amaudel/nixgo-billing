-- Reconciliación: facturas que llevan demasiado tiempo en 'processing' porque se perdió el
-- webhook. Devuelve lo que el adaptador necesita para preguntarle al proveedor (sin secretos).
-- Solo service role (trabajo de sistema, no hay una organización concreta). Más antiguas primero;
-- cada consulta que no cambie nada reaplica 'processing', lo que renueva updated_at y la manda al
-- final de la cola (no se insiste con la misma factura en cada pasada).
create function public.invoices_to_reconcile(p_older_than_minutes integer, p_limit integer)
returns jsonb
language sql stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(row_to_json(r)::jsonb order by r.updated_at asc, r.id asc), '[]'::jsonb)
  from (
    select i.id, i.organization_id, i.environment, i.provider, i.provider_document_id,
           o.ruc, pc.provider_company_ref, pc.certificate_ref, i.updated_at
      from public.invoices i
      join public.organizations o on o.id = i.organization_id
      left join public.organization_provider_configs pc
        on pc.organization_id = i.organization_id and pc.environment = i.environment
     where i.status = 'processing'
       and i.provider is not null
       and i.provider_document_id is not null
       and i.updated_at < now() - make_interval(mins => greatest(p_older_than_minutes, 0))
     order by i.updated_at asc, i.id asc
     limit least(greatest(p_limit, 1), 100)
  ) r;
$$;

revoke all on function public.invoices_to_reconcile(integer, integer) from public, anon, authenticated;
grant execute on function public.invoices_to_reconcile(integer, integer) to service_role;
