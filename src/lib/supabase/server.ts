import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabasePublicEnv } from "@/lib/env";

/** Cliente con la sesión del usuario: todas las consultas pasan por RLS. */
export async function createClient() {
  // cookies() primero: marca la ruta como dinámica (nunca prerenderizar datos por usuario).
  const cookieStore = await cookies();
  const env = getSupabasePublicEnv();
  if (!env) throw new Error("Supabase no está configurado (.env.local)");

  return createServerClient(env.url, env.publishableKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(list) {
        try {
          list.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Llamado desde un Server Component: el proxy ya refresca la sesión.
        }
      },
    },
  });
}
