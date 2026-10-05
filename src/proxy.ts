import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabasePublicEnv } from "@/lib/env";

/**
 * Refresca la sesión de Supabase y hace una comprobación OPTIMISTA de acceso al panel.
 * La autorización real ocurre en cada página/ruta (getUser + RLS), no aquí.
 */
export async function proxy(request: NextRequest) {
  const env = getSupabasePublicEnv();
  if (!env) return NextResponse.next();

  let response = NextResponse.next({ request });

  const supabase = createServerClient(env.url, env.publishableKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(list) {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const { data } = await supabase.auth.getClaims();
  const isLogin = request.nextUrl.pathname.startsWith("/login");

  if (!data?.claims && !isLogin) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  if (data?.claims && isLogin) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }
  return response;
}

export const config = {
  // /api/* usa su propia autenticación (API keys / firma de webhook), no cookies.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
