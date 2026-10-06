-- current_sequence solo debe cambiar vía next_sequential() (service role).
-- Se reemplazan los privilegios de tabla de emission_points por privilegios por columna
-- para que un organization_admin no pueda reiniciar ni retroceder el secuencial.

revoke insert, update on public.emission_points from authenticated;

grant insert (organization_id, establishment_id, code, document_type)
  on public.emission_points to authenticated;
grant update (code, document_type)
  on public.emission_points to authenticated;
-- select y delete se conservan; las políticas RLS siguen limitando a organization_admin.
