import { z } from "zod";

const publicSchema = z.object({
  url: z.url(),
  publishableKey: z.string().min(1),
});

/** Variables NEXT_PUBLIC_* deben referenciarse de forma estática para que Next las inyecte. */
export function getSupabasePublicEnv() {
  const parsed = publicSchema.safeParse({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    publishableKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  });
  return parsed.success ? parsed.data : null;
}

export function isSupabaseConfigured(): boolean {
  return getSupabasePublicEnv() !== null;
}

export function getServiceRoleKey(): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY no está configurada");
  return key;
}
