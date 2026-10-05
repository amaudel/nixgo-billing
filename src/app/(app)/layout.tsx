import { redirect } from "next/navigation";
import { Sidebar } from "@/components/sidebar";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "./actions";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  if (!isSupabaseConfigured()) {
    return (
      <main className="mx-auto max-w-lg p-8">
        <h1 className="text-lg font-semibold">Falta configurar Supabase</h1>
        <p className="mt-2 text-sm text-slate-600">
          Copia <code>.env.example</code> a <code>.env.local</code> y completa las variables. Instrucciones en el README.
        </p>
      </main>
    );
  }

  // getUser() valida el token contra Supabase Auth (el proxy solo hace una comprobación optimista).
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <Sidebar email={data.user.email ?? ""} signOut={signOut} />
      <main className="min-w-0 flex-1 p-4 md:p-8">{children}</main>
    </div>
  );
}
