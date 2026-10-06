"use client";

import { useActionState } from "react";
import { FormMessage, SubmitButton, fieldClass } from "@/components/form-bits";
import { ORG_ROLES, ROLE_LABEL } from "@/lib/organizations/schema";
import { addMember, createEmissionPoint, createEstablishment, saveProviderConfig, type FormState } from "../actions";

const card = "space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm";

export function EstablishmentForm({ organizationId }: { organizationId: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(createEstablishment, {});
  return (
    <form action={action} className={card}>
      <input type="hidden" name="organizationId" value={organizationId} />
      <p className="text-sm font-semibold">Nuevo establecimiento</p>
      <div className="grid gap-3 md:grid-cols-3">
        <label className="text-sm font-medium text-slate-700">
          Código
          <input name="code" required inputMode="numeric" maxLength={3} pattern="\d{3}" placeholder="001" className={`${fieldClass} font-mono`} />
        </label>
        <label className="text-sm font-medium text-slate-700">
          Nombre
          <input name="name" required maxLength={200} placeholder="Matriz" className={fieldClass} />
        </label>
        <label className="text-sm font-medium text-slate-700">
          Dirección
          <input name="address" required maxLength={300} className={fieldClass} />
        </label>
      </div>
      <FormMessage state={state} />
      <SubmitButton pending={pending}>{pending ? "Creando…" : "Crear establecimiento"}</SubmitButton>
    </form>
  );
}

export function EmissionPointForm({
  organizationId,
  establishments,
}: {
  organizationId: string;
  establishments: { id: string; code: string; name: string }[];
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(createEmissionPoint, {});
  return (
    <form action={action} className={card}>
      <input type="hidden" name="organizationId" value={organizationId} />
      <p className="text-sm font-semibold">Nuevo punto de emisión</p>
      {establishments.length === 0 ? (
        <p className="text-sm text-slate-500">Crea primero un establecimiento.</p>
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="text-sm font-medium text-slate-700">
              Establecimiento
              <select name="establishmentId" required className={fieldClass}>
                {establishments.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.code} · {e.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm font-medium text-slate-700">
              Código
              <input name="code" required inputMode="numeric" maxLength={3} pattern="\d{3}" placeholder="001" className={`${fieldClass} font-mono`} />
            </label>
          </div>
          <FormMessage state={state} />
          <SubmitButton pending={pending}>{pending ? "Creando…" : "Crear punto de emisión"}</SubmitButton>
        </>
      )}
    </form>
  );
}

export function AddMemberForm({ organizationId }: { organizationId: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(addMember, {});
  return (
    <form action={action} className={card}>
      <input type="hidden" name="organizationId" value={organizationId} />
      <p className="text-sm font-semibold">Agregar usuario</p>
      <p className="text-xs text-slate-500">
        La persona debe tener ya una cuenta (se crea en Supabase → Authentication → Users).
      </p>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="text-sm font-medium text-slate-700">
          Correo
          <input name="email" type="email" required maxLength={254} className={fieldClass} />
        </label>
        <label className="text-sm font-medium text-slate-700">
          Rol
          <select name="role" defaultValue="billing_user" className={fieldClass}>
            {ORG_ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <FormMessage state={state} />
      <SubmitButton pending={pending}>{pending ? "Agregando…" : "Agregar usuario"}</SubmitButton>
    </form>
  );
}

export function ProviderConfigForm({ organizationId }: { organizationId: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveProviderConfig, {});
  return (
    <form action={action} className={card}>
      <input type="hidden" name="organizationId" value={organizationId} />
      <p className="text-sm font-semibold">Cambiar configuración</p>
      <p className="text-xs text-slate-500">
        Solo <strong>referencias</strong> (ids u opacos). Nunca pegues contraseñas, claves ni archivos .p12. Los campos vacíos borran
        la referencia guardada.
      </p>
      <div className="grid gap-3 md:grid-cols-3">
        <label className="text-sm font-medium text-slate-700">
          Ambiente
          <select name="environment" className={fieldClass}>
            <option value="test">Pruebas</option>
            <option value="production">Producción</option>
          </select>
        </label>
        <label className="text-sm font-medium text-slate-700">
          Proveedor
          <select name="provider" className={fieldClass}>
            <option value="mock">Simulado (mock) — solo pruebas</option>
            <option value="factuplan">Factuplan (aún sin implementar)</option>
          </select>
        </label>
        <label className="text-sm font-medium text-slate-700">
          Vencimiento del certificado
          <input name="certificateExpiresAt" type="date" className={fieldClass} />
        </label>
        <label className="text-sm font-medium text-slate-700">
          Id de la empresa en el proveedor
          <input name="providerCompanyRef" maxLength={200} className={`${fieldClass} font-mono`} />
        </label>
        <label className="text-sm font-medium text-slate-700 md:col-span-2">
          Referencia del certificado
          <input name="certificateRef" maxLength={200} className={`${fieldClass} font-mono`} />
        </label>
      </div>
      <label className="flex items-start gap-2 text-sm text-slate-700">
        <input type="checkbox" name="confirmProduction" className="mt-1" />
        <span>
          Para <strong>Producción</strong>: confirmo que emite facturas con validez tributaria.
        </span>
      </label>
      <FormMessage state={state} />
      <SubmitButton pending={pending}>{pending ? "Guardando…" : "Guardar configuración"}</SubmitButton>
    </form>
  );
}
