-- Alta de empresas y gestión de usuarios desde el panel. Solo service role: el panel verifica
-- antes los permisos del usuario (administrador de plataforma / de la empresa).

-- Alta atómica: empresa + configuración de proveedor de pruebas (mock). Producción NO se
-- configura aquí a propósito: sin proveedor explícito, la API responde 409 en producción.
create function public.create_organization(
  p_ruc text,
  p_legal_name text,
  p_trade_name text,
  p_address text
) returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.organizations (ruc, legal_name, trade_name, address)
  values (p_ruc, p_legal_name, nullif(trim(p_trade_name), ''), p_address)
  returning id into v_id;

  insert into public.organization_provider_configs (organization_id, environment, provider)
  values (v_id, 'test', 'mock');

  return v_id;
end;
$$;

-- auth.users no está expuesta por la API: estas dos funciones (SECURITY DEFINER, solo service
-- role) son el único acceso, y devuelven lo mínimo (id/correo).
create function public.find_user_id_by_email(p_email text) returns uuid
language sql stable security definer
set search_path = ''
as $$
  select id from auth.users where lower(email) = lower(p_email) limit 1;
$$;

create function public.user_emails(p_user_ids uuid[]) returns table (id uuid, email text)
language sql stable security definer
set search_path = ''
as $$
  select u.id, u.email::text from auth.users u where u.id = any (p_user_ids);
$$;

revoke all on function public.create_organization(text, text, text, text) from public, anon, authenticated;
revoke all on function public.find_user_id_by_email(text) from public, anon, authenticated;
revoke all on function public.user_emails(uuid[]) from public, anon, authenticated;
grant execute on function public.create_organization(text, text, text, text) to service_role;
grant execute on function public.find_user_id_by_email(text) to service_role;
grant execute on function public.user_emails(uuid[]) to service_role;
