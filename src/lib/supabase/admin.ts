import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getServiceRoleKey, getSupabasePublicEnv } from "@/lib/env";

/**
 * Cliente con service role: SALTA RLS.
 * Solo para rutas de API server-to-server (API keys, webhooks) donde la organización
 * ya fue resuelta y TODA consulta debe filtrar explícitamente por organization_id.
 * Nunca importar desde componentes de cliente.
 */
export function createAdminClient() {
  const env = getSupabasePublicEnv();
  if (!env) throw new Error("Supabase no está configurado (.env.local)");
  return createClient(env.url, getServiceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
