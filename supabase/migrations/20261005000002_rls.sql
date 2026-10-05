-- Aislamiento por empresa: RLS en TODAS las tablas.
-- Principio: denegar por defecto. Los usuarios del panel solo LEEN (y administran unos pocos
-- datos de su empresa); toda escritura de facturación pasa por el backend con service role,
-- que filtra explícitamente por organization_id.

-- Funciones auxiliares en un esquema NO expuesto por la API REST.
create schema if not exists app_private;
revoke all on schema app_private from public, anon;
grant usage on schema app_private to authenticated, service_role;

create function app_private.is_platform_admin() returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from public.platform_admins where user_id = (select auth.uid()));
$$;

create function app_private.is_org_member(p_org uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select app_private.is_platform_admin() or exists (
    select 1 from public.organization_users
    where organization_id = p_org and user_id = (select auth.uid())
  );
$$;

create function app_private.has_org_role(p_org uuid, p_roles public.org_role[]) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select app_private.is_platform_admin() or exists (
    select 1 from public.organization_users
    where organization_id = p_org and user_id = (select auth.uid()) and role = any (p_roles)
  );
$$;

revoke all on all functions in schema app_private from public, anon;
grant execute on all functions in schema app_private to authenticated, service_role;

-- ---------------------------------------------------------------- privilegios base
-- Supabase concede ALL por defecto a anon/authenticated: se retira y se concede lo mínimo.
revoke all on all tables in schema public from anon, authenticated;
-- Tablas futuras nacen sin acceso para anon/authenticated (hay que conceder explícitamente).
alter default privileges in schema public revoke all on tables from anon, authenticated;

grant select on
  public.organizations, public.organization_provider_configs, public.organization_users,
  public.establishments, public.emission_points, public.customers,
  public.invoices, public.invoice_items, public.electronic_documents,
  public.billing_events, public.platform_admins
to authenticated;
-- api_keys: sin acceso a key_hash.
grant select (id, organization_id, application_name, environment, key_prefix, scopes, status,
              created_at, last_used_at, revoked_at) on public.api_keys to authenticated;

-- Administración desde el panel (limitada por políticas de abajo).
grant insert, update, delete on public.establishments, public.emission_points to authenticated;
grant insert, update on public.customers to authenticated;
grant insert, update, delete on public.organization_users to authenticated;

-- ---------------------------------------------------------------- enable RLS
alter table public.platform_admins enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_provider_configs enable row level security;
alter table public.organization_users enable row level security;
alter table public.establishments enable row level security;
alter table public.emission_points enable row level security;
alter table public.customers enable row level security;
alter table public.invoices enable row level security;
alter table public.invoice_items enable row level security;
alter table public.electronic_documents enable row level security;
alter table public.billing_events enable row level security;
alter table public.api_keys enable row level security;
alter table public.idempotency_keys enable row level security;   -- sin políticas: solo service role
alter table public.webhook_events enable row level security;     -- sin políticas: solo service role

-- ---------------------------------------------------------------- policies
create policy platform_admins_self on public.platform_admins
  for select to authenticated using (user_id = (select auth.uid()));

create policy organizations_select on public.organizations
  for select to authenticated using (app_private.is_org_member(id));
-- Alta/edición/baja de empresas: solo service role (operación de plataforma).

create policy provider_configs_select on public.organization_provider_configs
  for select to authenticated using (app_private.is_org_member(organization_id));  -- solo referencias, sin secretos

create policy org_users_select on public.organization_users
  for select to authenticated
  using (user_id = (select auth.uid())
         or app_private.has_org_role(organization_id, array['organization_admin']::public.org_role[]));
create policy org_users_insert on public.organization_users
  for insert to authenticated
  with check (app_private.has_org_role(organization_id, array['organization_admin']::public.org_role[]));
create policy org_users_update on public.organization_users
  for update to authenticated
  using (app_private.has_org_role(organization_id, array['organization_admin']::public.org_role[]))
  with check (app_private.has_org_role(organization_id, array['organization_admin']::public.org_role[]));
create policy org_users_delete on public.organization_users
  for delete to authenticated
  using (app_private.has_org_role(organization_id, array['organization_admin']::public.org_role[]));

create policy establishments_select on public.establishments
  for select to authenticated using (app_private.is_org_member(organization_id));
create policy establishments_write on public.establishments
  for all to authenticated
  using (app_private.has_org_role(organization_id, array['organization_admin']::public.org_role[]))
  with check (app_private.has_org_role(organization_id, array['organization_admin']::public.org_role[]));

create policy emission_points_select on public.emission_points
  for select to authenticated using (app_private.is_org_member(organization_id));
create policy emission_points_write on public.emission_points
  for all to authenticated
  using (app_private.has_org_role(organization_id, array['organization_admin']::public.org_role[]))
  with check (app_private.has_org_role(organization_id, array['organization_admin']::public.org_role[]));

create policy customers_select on public.customers
  for select to authenticated using (app_private.is_org_member(organization_id));
create policy customers_insert on public.customers
  for insert to authenticated
  with check (app_private.has_org_role(organization_id,
    array['organization_admin', 'billing_user']::public.org_role[]));
create policy customers_update on public.customers
  for update to authenticated
  using (app_private.has_org_role(organization_id,
    array['organization_admin', 'billing_user']::public.org_role[]))
  with check (app_private.has_org_role(organization_id,
    array['organization_admin', 'billing_user']::public.org_role[]));

-- Facturas y derivados: lectura para miembros; escritura solo backend.
create policy invoices_select on public.invoices
  for select to authenticated using (app_private.is_org_member(organization_id));
create policy invoice_items_select on public.invoice_items
  for select to authenticated using (app_private.is_org_member(organization_id));
create policy electronic_documents_select on public.electronic_documents
  for select to authenticated using (app_private.is_org_member(organization_id));
create policy billing_events_select on public.billing_events
  for select to authenticated
  using (app_private.has_org_role(organization_id,
    array['organization_admin', 'billing_user']::public.org_role[]));

create policy api_keys_select on public.api_keys
  for select to authenticated
  using (app_private.has_org_role(organization_id, array['organization_admin']::public.org_role[]));
