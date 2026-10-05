import "server-only";
import { createClient } from "@/lib/supabase/server";

type SessionClient = Awaited<ReturnType<typeof createClient>>;

/** ¿Es administrador de plataforma? La lectura pasa por RLS: solo ve su propia fila. */
export async function isPlatformAdmin(supabase: SessionClient, userId: string): Promise<boolean> {
  const { data } = await supabase.from("platform_admins").select("user_id").eq("user_id", userId).maybeSingle();
  return data !== null;
}

/**
 * Usuario autenticado con permiso para administrar la empresa (administrador de la empresa o
 * de plataforma), o null. Es una comprobación de UX/fail-fast: la protección real son las
 * políticas RLS, que se aplican igualmente a cada escritura hecha con la sesión del usuario.
 */
export async function requireOrgAdmin(organizationId: string) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;

  const [{ data: membership }, platform] = await Promise.all([
    supabase
      .from("organization_users")
      .select("role")
      .eq("organization_id", organizationId)
      .eq("user_id", auth.user.id)
      .maybeSingle(),
    isPlatformAdmin(supabase, auth.user.id),
  ]);
  if (membership?.role !== "organization_admin" && !platform) return null;
  return { userId: auth.user.id, supabase };
}

export async function requirePlatformAdmin() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user || !(await isPlatformAdmin(supabase, auth.user.id))) return null;
  return { userId: auth.user.id };
}
