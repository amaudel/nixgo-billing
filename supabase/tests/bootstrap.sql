-- Emula lo mínimo de Supabase para probar migraciones en un Postgres plano (sin Docker).
-- Solo para pruebas locales/CI: NO aplicar en un proyecto Supabase real.
-- Los roles son del clúster: crearlos solo si faltan.
do $$ begin
  if not exists (select from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
grant usage on schema public to anon, authenticated, service_role;
-- Supabase concede ALL por defecto en tablas/funciones nuevas de public.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
create schema auth;
-- Mismas columnas que usa supabase/seed.sql en el auth.users real.
create table auth.users (
  instance_id uuid, id uuid primary key default gen_random_uuid(), aud text, role text, email text,
  encrypted_password text, email_confirmed_at timestamptz, raw_app_meta_data jsonb, raw_user_meta_data jsonb,
  created_at timestamptz, updated_at timestamptz,
  confirmation_token text, recovery_token text, email_change_token_new text, email_change text
);
create table auth.identities (
  id uuid primary key, user_id uuid references auth.users (id), provider_id text, identity_data jsonb,
  provider text, last_sign_in_at timestamptz, created_at timestamptz, updated_at timestamptz
);
-- En Supabase las extensiones viven en el esquema "extensions".
create schema if not exists extensions;
create extension if not exists pgcrypto schema extensions;
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
