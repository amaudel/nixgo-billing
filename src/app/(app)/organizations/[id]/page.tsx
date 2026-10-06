import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { EmptyState, PageHeader, Table, td, th } from "@/components/ui";
import { isPlatformAdmin } from "@/lib/auth/permissions";
import { ORG_ROLES, ROLE_LABEL } from "@/lib/organizations/schema";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { AddMemberForm, EmissionPointForm, EstablishmentForm, ProviderConfigForm } from "./forms";

const orgSchema = z.object({
  id: z.string(),
  ruc: z.string(),
  legal_name: z.string(),
  trade_name: z.string().nullable(),
  address: z.string(),
  status: z.enum(["active", "suspended", "inactive"]),
});
const establishmentRows = z.array(z.object({ id: z.string(), code: z.string(), name: z.string(), address: z.string() }));
const pointRows = z.array(
  z.object({ id: z.string(), establishment_id: z.string(), code: z.string(), current_sequence: z.number() }),
);
const memberRows = z.array(z.object({ user_id: z.string(), role: z.enum(ORG_ROLES) }));
const configRows = z.array(
  z.object({
    environment: z.enum(["test", "production"]),
    provider: z.enum(["mock", "factuplan"]),
    provider_company_ref: z.string().nullable(),
    certificate_ref: z.string().nullable(),
    certificate_expires_at: z.string().nullable(),
    connection_status: z.string(),
  }),
);
const emailRows = z.array(z.object({ id: z.string(), email: z.string().nullable() }));

const ENV_LABEL = { test: "Pruebas", production: "Producción" } as const;
const PROVIDER_LABEL = { mock: "Simulado (mock)", factuplan: "Factuplan" } as const;

function certificateText(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso).toLocaleDateString("es-EC", { timeZone: "America/Guayaquil" });
  const days = Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
  if (days < 0) return `${date} · VENCIDO`;
  if (days <= 30) return `${date} · vence en ${days} día${days === 1 ? "" : "s"}`;
  return date;
}

const STATUS_LABEL = { active: "Activa", suspended: "Suspendida", inactive: "Inactiva" } as const;

export default async function OrganizationPage({ params }: PageProps<"/organizations/[id]">) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) notFound();

  // Todo se lee con la sesión del usuario: RLS devuelve solo lo que le corresponde.
  const { data: orgRow } = await supabase
    .from("organizations")
    .select("id, ruc, legal_name, trade_name, address, status")
    .eq("id", id)
    .maybeSingle();
  if (!orgRow) notFound();
  const org = orgSchema.parse(orgRow);

  const [estRes, ptRes, memRes, platform, cfgRes] = await Promise.all([
    supabase.from("establishments").select("id, code, name, address").eq("organization_id", id).order("code"),
    supabase
      .from("emission_points")
      .select("id, establishment_id, code, current_sequence")
      .eq("organization_id", id)
      .order("code"),
    supabase.from("organization_users").select("user_id, role").eq("organization_id", id),
    isPlatformAdmin(supabase, auth.user.id),
    supabase
      .from("organization_provider_configs")
      .select("environment, provider, provider_company_ref, certificate_ref, certificate_expires_at, connection_status")
      .eq("organization_id", id),
  ]);
  if (estRes.error) throw new Error(`establishments: ${estRes.error.message}`);
  if (ptRes.error) throw new Error(`emission_points: ${ptRes.error.message}`);
  if (memRes.error) throw new Error(`organization_users: ${memRes.error.message}`);

  if (cfgRes.error) throw new Error(`organization_provider_configs: ${cfgRes.error.message}`);
  const configs = configRows.parse(cfgRes.data);
  const establishments = establishmentRows.parse(estRes.data);
  const points = pointRows.parse(ptRes.data);
  const members = memberRows.parse(memRes.data);
  const canAdmin = platform || members.some((m) => m.user_id === auth.user.id && m.role === "organization_admin");

  // Correos: auth.users no es accesible con la sesión; se consulta con service role SOLO para
  // los usuarios que RLS ya dejó ver a este administrador.
  let emails = new Map<string, string>();
  if (canAdmin && members.length > 0) {
    const { data } = await createAdminClient().rpc("user_emails", { p_user_ids: members.map((m) => m.user_id) });
    emails = new Map(emailRows.parse(data ?? []).map((e) => [e.id, e.email ?? ""]));
  }

  return (
    <>
      <p className="mb-2 text-sm">
        <Link href="/organizations" className="text-indigo-700 hover:underline">
          ← Empresas
        </Link>
      </p>
      <PageHeader title={org.trade_name ?? org.legal_name} subtitle={`${org.legal_name} · RUC ${org.ruc} · ${STATUS_LABEL[org.status]}`} />
      <p className="-mt-4 mb-6 text-sm text-slate-500">{org.address}</p>

      <section className="mb-8 space-y-3">
        <h2 className="text-base font-semibold">Establecimientos y puntos de emisión</h2>
        {establishments.length === 0 ? (
          <EmptyState>Aún no hay establecimientos. Sin uno y un punto de emisión no se pueden emitir facturas.</EmptyState>
        ) : (
          <Table>
            <thead className="bg-slate-50">
              <tr>
                <th className={th}>Establecimiento</th>
                <th className={th}>Dirección</th>
                <th className={th}>Puntos de emisión</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {establishments.map((e) => (
                <tr key={e.id}>
                  <td className={td}>
                    <span className="font-mono">{e.code}</span> · {e.name}
                  </td>
                  <td className={td}>{e.address}</td>
                  <td className={td}>
                    {points
                      .filter((p) => p.establishment_id === e.id)
                      .map((p) => `${p.code} (último nº ${p.current_sequence})`)
                      .join(" · ") || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        {canAdmin && (
          <div className="grid gap-4 md:grid-cols-2">
            <EstablishmentForm organizationId={org.id} />
            <EmissionPointForm organizationId={org.id} establishments={establishments} />
          </div>
        )}
      </section>

      <section className="mb-8 space-y-3">
        <h2 className="text-base font-semibold">Proveedor de facturación</h2>
        {configs.length === 0 ? (
          <EmptyState>Sin proveedor configurado: ni pruebas ni producción pueden emitir.</EmptyState>
        ) : (
          <Table>
            <thead className="bg-slate-50">
              <tr>
                <th className={th}>Ambiente</th>
                <th className={th}>Proveedor</th>
                <th className={th}>Id en el proveedor</th>
                <th className={th}>Certificado</th>
                <th className={th}>Vencimiento</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {configs.map((c) => (
                <tr key={c.environment}>
                  <td className={td}>{ENV_LABEL[c.environment]}</td>
                  <td className={td}>{PROVIDER_LABEL[c.provider]}</td>
                  <td className={`${td} font-mono`}>{c.provider_company_ref ?? "—"}</td>
                  <td className={`${td} font-mono`}>{c.certificate_ref ?? "—"}</td>
                  <td className={td}>{certificateText(c.certificate_expires_at)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        {!configs.some((c) => c.environment === "production") && (
          <p className="text-sm text-slate-500">Producción no está configurada: las apps con clave <code>nb_live_…</code> reciben un error 409.</p>
        )}
        {platform ? (
          <ProviderConfigForm organizationId={org.id} />
        ) : (
          <p className="text-xs text-slate-500">Solo un administrador de plataforma puede cambiar la configuración del proveedor.</p>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold">Usuarios</h2>
        {members.length === 0 ? (
          <EmptyState>No hay usuarios visibles.</EmptyState>
        ) : (
          <Table>
            <thead className="bg-slate-50">
              <tr>
                <th className={th}>Correo</th>
                <th className={th}>Rol</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {members.map((m) => (
                <tr key={m.user_id}>
                  <td className={td}>{emails.get(m.user_id) || (m.user_id === auth.user.id ? (auth.user.email ?? "Tú") : "—")}</td>
                  <td className={td}>{ROLE_LABEL[m.role]}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        {canAdmin && <AddMemberForm organizationId={org.id} />}
      </section>
    </>
  );
}
