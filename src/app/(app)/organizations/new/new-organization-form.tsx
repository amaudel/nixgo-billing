"use client";

import { useActionState } from "react";
import { FormMessage, SubmitButton, fieldClass } from "@/components/form-bits";
import { createOrganization, type FormState } from "../actions";

export function NewOrganizationForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(createOrganization, {});
  return (
    <form action={action} className="max-w-xl space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <label className="block text-sm font-medium text-slate-700">
        RUC
        <input name="ruc" required inputMode="numeric" maxLength={13} pattern="\d{13}" placeholder="13 dígitos" className={`${fieldClass} font-mono`} />
      </label>
      <label className="block text-sm font-medium text-slate-700">
        Razón social
        <input name="legalName" required maxLength={300} className={fieldClass} />
      </label>
      <label className="block text-sm font-medium text-slate-700">
        Nombre comercial <span className="font-normal text-slate-400">(opcional)</span>
        <input name="tradeName" maxLength={300} className={fieldClass} />
      </label>
      <label className="block text-sm font-medium text-slate-700">
        Dirección matriz
        <input name="address" required maxLength={300} className={fieldClass} />
      </label>
      <FormMessage state={state} />
      <SubmitButton pending={pending}>{pending ? "Creando…" : "Crear empresa"}</SubmitButton>
    </form>
  );
}
