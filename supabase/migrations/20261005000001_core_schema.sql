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
