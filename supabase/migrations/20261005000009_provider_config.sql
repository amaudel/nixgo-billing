-- Configuración de proveedor por empresa y ambiente (solo service role; el panel exige antes
-- administrador de plataforma). Solo REFERENCIAS: nunca claves, contraseñas ni archivos P12.
--
-- Regla: producción no puede usar el proveedor simulado. Un "mock" en producción haría pasar
-- facturas falsas por reales; mock es solo para pruebas.
create function public.set_provider_config(
  p_organization_id uuid,
  p_environment public.billing_environment,
  p_provider public.billing_provider_name,
  p_provider_company_ref text,
  p_certificate_ref text,
  p_certificate_expires_at timestamptz,
  p_actor uuid
) returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_environment = 'production' and p_provider = 'mock' then
    raise exception 'production_requires_real_provider';
  end if;

  insert into public.organization_provider_configs
    (organization_id, environment, provider, provider_company_ref, certificate_ref, certificate_expires_at)
  values (p_organization_id, p_environment, p_provider, nullif(trim(p_provider_company_ref), ''),
          nullif(trim(p_certificate_ref), ''), p_certificate_expires_at)
  on conflict (organization_id, environment) do update
    set provider = excluded.provider,
        provider_company_ref = excluded.provider_company_ref,
        certificate_ref = excluded.certificate_ref,
        certificate_expires_at = excluded.certificate_expires_at;

  -- Auditoría: qué se cambió y quién (sin los valores de las referencias).
  insert into public.billing_events
    (organization_id, event_type, provider, actor_type, actor_id, request)
  values (
    p_organization_id, 'organization.provider_config_changed', p_provider, 'user', p_actor::text,
    jsonb_build_object('environment', p_environment, 'provider', p_provider,
                       'has_company_ref', nullif(trim(p_provider_company_ref), '') is not null,
                       'has_certificate_ref', nullif(trim(p_certificate_ref), '') is not null)
  );
end;
$$;

revoke all on function public.set_provider_config(uuid, public.billing_environment, public.billing_provider_name, text, text, timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.set_provider_config(uuid, public.billing_environment, public.billing_provider_name, text, text, timestamptz, uuid) to service_role;
