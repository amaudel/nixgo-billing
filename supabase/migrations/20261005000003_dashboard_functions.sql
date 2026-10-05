-- Funciones de lectura para el panel. SECURITY INVOKER: se ejecutan con los permisos del usuario,
-- por lo que RLS filtra automáticamente por las empresas a las que pertenece.

create function public.dashboard_stats(p_today date, p_month_start date)
returns jsonb
language sql stable security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'active_organizations',
      (select count(*) from public.organizations where status = 'active'),
    'today_count',
      (select count(*) from public.invoices where issue_date = p_today),
    'month_count',
      (select count(*) from public.invoices where issue_date >= p_month_start),
    'month_authorized_total',
      (select coalesce(sum(total), 0) from public.invoices
        where issue_date >= p_month_start and status = 'authorized'),
    'month_by_status',
      (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb)
         from (select status, count(*) as n from public.invoices
                where issue_date >= p_month_start group by status) s)
  );
$$;

create function public.organization_overview(p_month_start date)
returns table (
  id uuid,
  ruc text,
  legal_name text,
  trade_name text,
  status public.organization_status,
  environment public.billing_environment,
  provider public.billing_provider_name,
  invoices_month bigint
)
language sql stable security invoker
set search_path = ''
as $$
  select o.id, o.ruc, o.legal_name, o.trade_name, o.status, o.environment, pc.provider,
         (select count(*) from public.invoices i
           where i.organization_id = o.id and i.issue_date >= p_month_start)
    from public.organizations o
    left join public.organization_provider_configs pc
      on pc.organization_id = o.id and pc.environment = o.environment
   order by o.legal_name;
$$;

revoke all on function public.dashboard_stats(date, date) from public, anon;
revoke all on function public.organization_overview(date) from public, anon;
grant execute on function public.dashboard_stats(date, date) to authenticated;
grant execute on function public.organization_overview(date) to authenticated;
