-- ARCHIVO GENERADO: las 5 migraciones de supabase/migrations/ en orden, para pegar en
-- Dashboard → SQL Editor de un proyecto Supabase de PRUEBAS cuando el CLI no puede conectar.
-- No lo edites: la fuente de verdad son los archivos de supabase/migrations/.
-- Va dentro de una transacción: si algo falla, no se aplica nada.
-- Nota: esta vía no registra el historial de migraciones del CLI (`supabase db push` luego intentaría reaplicarlas).

begin;

-- ============================================================ 20261005000001_core_schema.sql
-- Nixgo Billing: esquema base multi-tenant.
-- Convención: toda tabla de negocio lleva organization_id y los hijos lo referencian con FK
-- compuesta (id, organization_id) para que sea IMPOSIBLE mezclar datos de dos empresas.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- enums
create type public.billing_environment as enum ('test', 'production');
create type public.organization_status as enum ('active', 'suspended', 'inactive');
create type public.org_role as enum ('organization_admin', 'billing_user', 'viewer');
create type public.document_type as enum ('invoice', 'credit_note');
-- Lista provisional; validar contra la ficha técnica vigente del SRI antes de producción.
create type public.identification_type as enum ('ruc', 'cedula', 'passport', 'final_consumer', 'foreign_id');
create type public.invoice_status as enum
  ('draft', 'pending', 'processing', 'authorized', 'rejected', 'failed', 'voided');
create type public.billing_provider_name as enum ('mock', 'factuplan');

-- ---------------------------------------------------------------- helpers
create function public.set_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------- platform admins
-- Rol global (no pertenece a una empresa), por eso vive fuera de organization_users.
create table public.platform_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- organizations
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  ruc text not null unique check (ruc ~ '^[0-9]{13}$'),
  legal_name text not null check (length(trim(legal_name)) > 0),
  trade_name text,
  address text not null,
  environment public.billing_environment not null default 'test',
  status public.organization_status not null default 'active',
  tax_config jsonb not null default '{}'::jsonb,   -- configuración tributaria (sin secretos)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger organizations_updated_at before update on public.organizations
  for each row execute function public.set_updated_at();

-- Proveedor y referencias por ambiente. SOLO referencias: nunca claves, P12 ni contraseñas.
create table public.organization_provider_configs (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  environment public.billing_environment not null,
  provider public.billing_provider_name not null default 'mock',
  provider_company_ref text,        -- id de la empresa en el proveedor
  certificate_ref text,             -- referencia opaca al certificado custodiado por el proveedor
  certificate_expires_at timestamptz,
  connection_status text not null default 'unconfigured'
    check (connection_status in ('unconfigured', 'connected', 'error')),
  updated_at timestamptz not null default now(),
  primary key (organization_id, environment)
);
create trigger provider_configs_updated_at before update on public.organization_provider_configs
  for each row execute function public.set_updated_at();

create table public.organization_users (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.org_role not null,
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);
create index organization_users_user_idx on public.organization_users (user_id);

-- ---------------------------------------------------------------- establishments / emission points
create table public.establishments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  code text not null check (code ~ '^[0-9]{3}$'),
  name text not null,
  address text not null,
  unique (organization_id, code),
  unique (id, organization_id)
);

create table public.emission_points (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  establishment_id uuid not null,
  code text not null check (code ~ '^[0-9]{3}$'),
  document_type public.document_type not null default 'invoice',
  current_sequence integer not null default 0 check (current_sequence >= 0),
  foreign key (establishment_id, organization_id)
    references public.establishments (id, organization_id) on delete cascade,
  unique (establishment_id, code, document_type),
  unique (id, organization_id)
);

-- ---------------------------------------------------------------- customers
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  identification_type public.identification_type not null,
  identification text not null,
  legal_name text not null,
  email text,
  phone text,
  address text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, identification_type, identification),
  unique (id, organization_id)
);
create trigger customers_updated_at before update on public.customers
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------- invoices
create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  establishment_id uuid not null,
  emission_point_id uuid not null,
  customer_id uuid not null,
  sequential integer,
  access_key text unique,
  issue_date date not null,
  subtotal numeric(14, 2) not null default 0,
  discount numeric(14, 2) not null default 0,
  tax numeric(14, 2) not null default 0,
  total numeric(14, 2) not null default 0,
  currency char(3) not null default 'USD',
  status public.invoice_status not null default 'draft',
  environment public.billing_environment not null,
  provider public.billing_provider_name,
  provider_document_id text,
  sri_authorization_number text,
  sri_authorized_at timestamptz,
  rejection_reason text,
  source_application text,          -- aplicación consumidora (viene de la API key)
  external_reference text,          -- id del pago/pedido en la app consumidora
  idempotency_key text,
  created_by_api_key_id uuid,
  created_by_user_id uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id) references public.organizations (id) on delete restrict,
  foreign key (establishment_id, organization_id) references public.establishments (id, organization_id),
  foreign key (emission_point_id, organization_id) references public.emission_points (id, organization_id),
  foreign key (customer_id, organization_id) references public.customers (id, organization_id),
  unique (emission_point_id, sequential),
  unique (organization_id, idempotency_key),
  unique (id, organization_id)
);
create index invoices_org_issue_idx on public.invoices (organization_id, issue_date desc);
create index invoices_org_status_idx on public.invoices (organization_id, status);
create index invoices_provider_doc_idx on public.invoices (provider, provider_document_id);
create trigger invoices_updated_at before update on public.invoices
  for each row execute function public.set_updated_at();

create table public.invoice_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  invoice_id uuid not null,
  sku text,
  description text not null,
  quantity numeric(14, 6) not null check (quantity > 0),
  unit_price numeric(14, 6) not null check (unit_price >= 0),
  discount numeric(14, 2) not null default 0,
  tax_rate numeric(5, 2) not null default 0,
  tax_amount numeric(14, 2) not null default 0,
  total numeric(14, 2) not null,
  foreign key (invoice_id, organization_id) references public.invoices (id, organization_id) on delete cascade
);
create index invoice_items_invoice_idx on public.invoice_items (invoice_id);

create table public.electronic_documents (
  invoice_id uuid primary key,
  organization_id uuid not null,
  xml_url text,
  ride_url text,
  authorized_xml_url text,
  foreign key (invoice_id, organization_id) references public.invoices (id, organization_id) on delete cascade
);

-- ---------------------------------------------------------------- audit (append-only)
create table public.billing_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  invoice_id uuid,
  event_type text not null,
  provider public.billing_provider_name,
  actor_type text not null check (actor_type in ('user', 'api_key', 'provider', 'system')),
  actor_id text,                    -- user id / api key id (nunca la clave)
  source_application text,
  request jsonb,                    -- SIEMPRE pasado por redactSecrets()
  response jsonb,                   -- SIEMPRE pasado por redactSecrets()
  created_at timestamptz not null default now(),
  foreign key (invoice_id, organization_id) references public.invoices (id, organization_id)
);
create index billing_events_org_created_idx on public.billing_events (organization_id, created_at desc);
create index billing_events_invoice_idx on public.billing_events (invoice_id);

create function public.forbid_modification() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% es de solo anexar (append-only)', tg_table_name;
end;
$$;
create trigger billing_events_append_only before update or delete on public.billing_events
  for each row execute function public.forbid_modification();

-- ---------------------------------------------------------------- api keys
create table public.api_keys (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  application_name text not null,
  environment public.billing_environment not null,
  key_prefix text not null,         -- p. ej. nb_test_ab12cd34 (no secreto)
  key_hash text not null unique,    -- SHA-256 hex; la clave completa nunca se guarda
  scopes text[] not null default '{}',
  status text not null default 'active' check (status in ('active', 'revoked')),
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
create index api_keys_org_idx on public.api_keys (organization_id);

alter table public.invoices
  add constraint invoices_created_by_api_key_fk
  foreign key (created_by_api_key_id) references public.api_keys (id);

-- ---------------------------------------------------------------- idempotency
create table public.idempotency_keys (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  key text not null,
  request_hash text not null,       -- misma clave con otro cuerpo => 422
  invoice_id uuid,
  response_status integer,
  response_body jsonb,
  created_at timestamptz not null default now(),
  primary key (organization_id, key)
);

-- ---------------------------------------------------------------- webhooks
create table public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider public.billing_provider_name not null,
  event_id text not null,           -- id del evento en el proveedor
  event_type text,
  payload jsonb,                    -- sanitizado
  status text not null default 'received' check (status in ('received', 'processed', 'ignored', 'failed')),
  error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (provider, event_id)       -- idempotencia: un evento se procesa una sola vez
);

-- ---------------------------------------------------------------- secuenciales
-- Incremento atómico del secuencial. Solo service role (revocado para el resto).
create function public.next_sequential(p_emission_point_id uuid, p_organization_id uuid)
returns integer
language sql
set search_path = ''
as $$
  update public.emission_points
     set current_sequence = current_sequence + 1
   where id = p_emission_point_id and organization_id = p_organization_id
  returning current_sequence;
$$;
revoke all on function public.next_sequential(uuid, uuid) from public, anon, authenticated;
grant execute on function public.next_sequential(uuid, uuid) to service_role;

-- ============================================================ 20261005000002_rls.sql
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

-- ============================================================ 20261005000003_dashboard_functions.sql
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

-- ============================================================ 20261005000004_emission_points_sequence_guard.sql
-- current_sequence solo debe cambiar vía next_sequential() (service role).
-- Se reemplazan los privilegios de tabla de emission_points por privilegios por columna
-- para que un organization_admin no pueda reiniciar ni retroceder el secuencial.

revoke insert, update on public.emission_points from authenticated;

grant insert (organization_id, establishment_id, code, document_type)
  on public.emission_points to authenticated;
grant update (code, document_type)
  on public.emission_points to authenticated;
-- select y delete se conservan; las políticas RLS siguen limitando a organization_admin.

-- ============================================================ 20261005000005_invoice_api_functions.sql
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

commit;
