import { isSupabaseConfigured } from "@/lib/env";
import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mb-6">
          <p className="text-lg font-semibold tracking-tight">Nixgo Billing</p>
          <p className="text-sm text-slate-500">Facturación electrónica para Ecuador</p>
        </div>
        {isSupabaseConfigured() ? (
          <LoginForm />
        ) : (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Supabase no está configurado. Copia <code>.env.example</code> a <code>.env.local</code> y
            completa las variables (ver README).
          </p>
        )}
      </div>
    </main>
  );
}
