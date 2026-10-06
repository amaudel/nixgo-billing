-- Datos de prueba para un proyecto Supabase EN LA NUBE dedicado a pruebas (no producción).
-- Se pega en Dashboard → SQL Editor DESPUÉS de crear el usuario en Authentication → Users.
-- 1) Cambia TU_CORREO por el correo del usuario que creaste.
-- 2) No crea usuarios ni contraseñas ni API keys (la clave se crea desde el panel /api-keys).

do $$
declare
  v_email text := 'TU_CORREO';
  v_user uuid;
  v_org uuid := '22222222-2222-4222-8222-222222222222';
  v_est uuid := '33333333-3333-4333-8333-333333333333';
begin
  select id into v_user from auth.users where email = v_email;
  if v_user is null then
    raise exception 'No existe un usuario con el correo %. Créalo primero en Authentication → Users.', v_email;
  end if;

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
