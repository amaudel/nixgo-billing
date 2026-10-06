-- DATOS DE DESARROLLO LOCAL. Se ejecuta solo con `supabase db reset` (base local).
-- NUNCA aplicar en un proyecto Supabase real: crea un usuario con contraseña conocida.
-- No contiene API keys: se crean desde el panel (/api-keys), que es parte de lo que se prueba.

do $$
declare
  v_user uuid := '11111111-1111-4111-8111-111111111111';
  v_org uuid := '22222222-2222-4222-8222-222222222222';
  v_est uuid := '33333333-3333-4333-8333-333333333333';
begin
  -- Usuario del panel: admin@local.test / dev-password-123
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change
  ) values (
    '00000000-0000-0000-0000-000000000000', v_user, 'authenticated', 'authenticated',
    'admin@local.test', extensions.crypt('dev-password-123', extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''
  ) on conflict (id) do nothing;

  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values ('44444444-4444-4444-8444-444444444444', v_user, v_user::text,
          jsonb_build_object('sub', v_user::text, 'email', 'admin@local.test', 'email_verified', true),
          'email', now(), now(), now())
  on conflict (id) do nothing;

  -- Empresa de prueba (RUC ficticio) con proveedor mock en ambos ambientes.
  insert into public.organizations (id, ruc, legal_name, trade_name, address)
  values (v_org, '1790000000001', 'EMPRESA DEMO S.A.', 'Empresa Demo', 'Quito, Ecuador')
  on conflict (id) do nothing;

  -- administrador de ESA empresa (no de plataforma): así se prueba el rol real.
  insert into public.organization_users (organization_id, user_id, role)
  values (v_org, v_user, 'organization_admin') on conflict do nothing;

  insert into public.organization_provider_configs (organization_id, environment, provider)
  values (v_org, 'test', 'mock'), (v_org, 'production', 'mock') on conflict do nothing;

  insert into public.establishments (id, organization_id, code, name, address)
  values (v_est, v_org, '001', 'Matriz', 'Quito, Ecuador') on conflict (id) do nothing;

  insert into public.emission_points (organization_id, establishment_id, code)
  values (v_org, v_est, '001') on conflict do nothing;
end $$;
