"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { generateApiKey } from "@/lib/security/api-keys";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export interface CreateKeyState {
  error?: string;
  /** Clave completa: se muestra UNA vez y no se guarda en ningún sitio. */
  key?: string;
  prefix?: string;
}

const createSchema = z.object({
  organizationId: z.uuid("Empresa inválida"),
  applicationName: z.string().trim().min(1, "Indica el nombre de la aplicación").max(64),
  environment: z.enum(["test", "production"]),
});

/** El usuario debe ser administrador de la empresa (o administrador de plataforma). */
async function requireOrgAdmin(organizationId: string) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;

  // Ambas lecturas pasan por RLS con la sesión del usuario: solo ve sus propias filas.
  const [{ data: membership }, { data: platform }] = await Promise.all([
    supabase
      .from("organization_users")
      .select("role")
      .eq("organization_id", organizationId)
      .eq("user_id", auth.user.id)
      .maybeSingle(),
    supabase.from("platform_admins").select("user_id").eq("user_id", auth.user.id).maybeSingle(),
  ]);
  const allowed = membership?.role === "organization_admin" || platform !== null;
  return allowed ? { userId: auth.user.id } : null;
}

export async function createApiKey(_prev: CreateKeyState, formData: FormData): Promise<CreateKeyState> {
  const parsed = createSchema.safeParse({
    organizationId: formData.get("organizationId"),
    applicationName: formData.get("applicationName"),
    environment: formData.get("environment"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Datos inválidos" };

  const actor = await requireOrgAdmin(parsed.data.organizationId);
  if (!actor) return { error: "No tienes permiso para crear claves en esta empresa." };

  const generated = generateApiKey(parsed.data.environment === "production" ? "live" : "test");
  const { error } = await createAdminClient()
    .from("api_keys")
    .insert({
      organization_id: parsed.data.organizationId,
      application_name: parsed.data.applicationName,
      environment: parsed.data.environment,
      key_prefix: generated.prefix,
      key_hash: generated.hash, // solo el hash; la clave completa no se persiste
      scopes: ["invoices:read", "invoices:write"],
      created_by: actor.userId,
    });
  if (error) return { error: "No se pudo crear la clave." };

  revalidatePath("/api-keys");
  return { key: generated.key, prefix: generated.prefix };
}

export async function revokeApiKey(formData: FormData): Promise<void> {
  const id = z.uuid().safeParse(formData.get("id"));
  if (!id.success) return;

  // La política RLS de api_keys solo deja ver claves a administradores de su empresa:
  // si la fila es visible con la sesión del usuario, tiene permiso para revocarla.
  const supabase = await createClient();
  const { data: row } = await supabase.from("api_keys").select("id, organization_id").eq("id", id.data).maybeSingle();
  if (!row) return;

  await createAdminClient()
    .from("api_keys")
    .update({ status: "revoked", revoked_at: new Date().toISOString() })
    .eq("id", row.id)
    .eq("organization_id", row.organization_id);
  revalidatePath("/api-keys");
}
