"use client";

import { useActionState } from "react";
import { createApiKey, type CreateKeyState } from "./actions";

const field =
  "mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200";

export function CreateKeyForm({ organizations }: { organizations: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState<CreateKeyState, FormData>(createApiKey, {});

  return (
    <div className="space-y-4">
      <form action={action} className="grid gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm md:grid-cols-4">
        <label className="text-sm font-medium text-slate-700">
          Empresa
          <select name="organizationId" required className={field}>
            {organizations.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm font-medium text-slate-700">
          Aplicación
          <input name="applicationName" required maxLength={64} placeholder="NidoCerca" className={field} />
        </label>
        <label className="text-sm font-medium text-slate-700">
          Ambiente
          <select name="environment" className={field}>
            <option value="test">Pruebas (nb_test_…)</option>
            <option value="production">Producción (nb_live_…)</option>
          </select>
        </label>
        <div className="flex items-end">
          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
          >
            {pending ? "Creando…" : "Crear clave"}
          </button>
        </div>
      </form>

      {state.error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </p>
      )}
      {state.key && (
        <div role="status" className="rounded-xl border border-amber-300 bg-amber-50 p-4">
          <p className="text-sm font-semibold text-amber-900">Copia esta clave ahora: no se volverá a mostrar.</p>
          <code className="mt-2 block break-all rounded bg-white px-3 py-2 font-mono text-sm">{state.key}</code>
          <p className="mt-2 text-xs text-amber-800">
            Guárdala como secreto de servidor en la app consumidora. Nunca en frontend ni en Git.
          </p>
        </div>
      )}
    </div>
  );
}
