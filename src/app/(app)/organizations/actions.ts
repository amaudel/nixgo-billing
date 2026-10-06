"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOrgAdmin, requirePlatformAdmin } from "@/lib/auth/permissions";
import {
  addMemberSchema,
  createOrganizationSchema,
  emissionPointSchema,
  establishmentSchema,
  providerConfigSchema,
} from "@/lib/organizations/schema";
import { createAdminClient } from "@/lib/supabase/admin";

export interface FormState {
  error?: string;
  ok?: string;
}

const UNIQUE_VIOLATION = "23505";
const first = (issues: { message: string }[]) => issues[0]?.message ?? "Datos inválidos";
const denied: FormState = { error: "No tienes permiso para hacer esto." };

/** Alta de empresa: solo administradores de plataforma (la escritura usa service role). */
export async function createOrganization(_prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await requirePlatformAdmin())) return denied;

  const parsed = createOrganizationSchema.safeParse({
    ruc: formData.get("ruc"),
    legalName: formData.get("legalName"),
    tradeName: formData.get("tradeName"),
    address: formData.get("address"),
  });
  if (!parsed.success) return { error: first(parsed.error.issues) };

  const { data, error } = await createAdminClient().rpc("create_organization", {
    p_ruc: parsed.data.ruc,
    p_legal_name: parsed.data.legalName,
    p_trade_name: parsed.data.tradeName ?? null,
    p_address: parsed.data.address,
  });
  if (error?.code === UNIQUE_VIOLATION) return { error: "Ya existe una empresa con ese RUC." };
  if (error || typeof data !== "string") return { error: "No se pudo crear la empresa." };

  revalidatePath("/organizations");
  redirect(`/organizations/${data}`);
}

/**
 * Establecimientos, puntos de emisión y miembros se escriben con la SESIÓN del usuario: las
 * políticas RLS deciden (solo administradores de esa empresa o de plataforma).
 */
export async function createEstablishment(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = establishmentSchema.safeParse({
    organizationId: formData.get("organizationId"),
    code: formData.get("code"),
    name: formData.get("name"),
    address: formData.get("address"),
  });
  if (!parsed.success) return { error: first(parsed.error.issues) };

  const actor = await requireOrgAdmin(parsed.data.organizationId);
  if (!actor) return denied;

  const { error } = await actor.supabase.from("establishments").insert({
    organization_id: parsed.data.organizationId,
    code: parsed.data.code,
    name: parsed.data.name,
    address: parsed.data.address,
  });
  if (error?.code === UNIQUE_VIOLATION) return { error: `Ya existe el establecimiento ${parsed.data.code}.` };
  if (error) return { error: "No se pudo crear el establecimiento." };

  revalidatePath(`/organizations/${parsed.data.organizationId}`);
  return { ok: `Establecimiento ${parsed.data.code} creado.` };
}

export async function createEmissionPoint(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = emissionPointSchema.safeParse({
    organizationId: formData.get("organizationId"),
    establishmentId: formData.get("establishmentId"),
    code: formData.get("code"),
  });
  if (!parsed.success) return { error: first(parsed.error.issues) };

  const actor = await requireOrgAdmin(parsed.data.organizationId);
  if (!actor) return denied;

  // La FK compuesta (establishment_id, organization_id) impide usar un establecimiento ajeno.
  const { error } = await actor.supabase.from("emission_points").insert({
    organization_id: parsed.data.organizationId,
    establishment_id: parsed.data.establishmentId,
    code: parsed.data.code,
  });
  if (error?.code === UNIQUE_VIOLATION) return { error: `Ya existe el punto de emisión ${parsed.data.code} en ese establecimiento.` };
  if (error) return { error: "No se pudo crear el punto de emisión." };

  revalidatePath(`/organizations/${parsed.data.organizationId}`);
  return { ok: `Punto de emisión ${parsed.data.code} creado.` };
}

/**
 * Agrega a la empresa un usuario que YA tiene cuenta (el alta de cuentas es de la plataforma:
 * Supabase → Authentication → Users). El mensaje no distingue "no existe" de otros fallos para
 * no confirmar a un administrador qué correos tienen cuenta.
 */
export async function addMember(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = addMemberSchema.safeParse({
    organizationId: formData.get("organizationId"),
    email: formData.get("email"),
    role: formData.get("role"),
  });
  if (!parsed.success) return { error: first(parsed.error.issues) };

  const actor = await requireOrgAdmin(parsed.data.organizationId);
  if (!actor) return denied;

  const notAdded: FormState = { error: "No se pudo agregar: verifica que el correo tenga una cuenta creada." };
  const { data: userId, error: lookupError } = await createAdminClient().rpc("find_user_id_by_email", {
    p_email: parsed.data.email,
  });
  if (lookupError || typeof userId !== "string") return notAdded;

  const { error } = await actor.supabase.from("organization_users").insert({
    organization_id: parsed.data.organizationId,
    user_id: userId,
    role: parsed.data.role,
  });
  if (error?.code === UNIQUE_VIOLATION) return { error: "Ese usuario ya pertenece a la empresa." };
  if (error) return notAdded;

  revalidatePath(`/organizations/${parsed.data.organizationId}`);
  return { ok: "Usuario agregado." };
}

/**
 * Proveedor y referencias por empresa y ambiente: solo administradores de plataforma (cambia con
 * qué proveedor y certificado se emite). La regla "producción no usa mock" la impone también la
 * base de datos, y cada cambio queda auditado.
 */
export async function saveProviderConfig(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requirePlatformAdmin();
  if (!actor) return denied;

  const parsed = providerConfigSchema.safeParse({
    organizationId: formData.get("organizationId"),
    environment: formData.get("environment"),
    provider: formData.get("provider"),
    providerCompanyRef: formData.get("providerCompanyRef"),
    certificateRef: formData.get("certificateRef"),
    certificateExpiresAt: formData.get("certificateExpiresAt"),
    confirmProduction: formData.get("confirmProduction"),
  });
  if (!parsed.success) return { error: first(parsed.error.issues) };
  const c = parsed.data;

  const { error } = await createAdminClient().rpc("set_provider_config", {
    p_organization_id: c.organizationId,
    p_environment: c.environment,
    p_provider: c.provider,
    p_provider_company_ref: c.providerCompanyRef ?? null,
    p_certificate_ref: c.certificateRef ?? null,
    // Fin del día en Ecuador (UTC-5, sin horario de verano).
    p_certificate_expires_at: c.certificateExpiresAt ? `${c.certificateExpiresAt}T23:59:59-05:00` : null,
    p_actor: actor.userId,
  });
  if (error?.message === "production_requires_real_provider") {
    return { error: "Producción no puede usar el proveedor simulado (mock)." };
  }
  if (error) return { error: "No se pudo guardar la configuración." };

  revalidatePath(`/organizations/${c.organizationId}`);
  return { ok: `Configuración de ${c.environment === "production" ? "producción" : "pruebas"} guardada.` };
}
