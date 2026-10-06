import { z } from "zod";
import { EmptyState, PageHeader, Table, td, th } from "@/components/ui";
import { getOrganizationOverview } from "@/lib/data/dashboard";
import { createClient } from "@/lib/supabase/server";
import { revokeApiKey } from "./actions";
import { CreateKeyForm } from "./create-key-form";

const rowSchema = z.array(
  z.object({
    id: z.string(),
    application_name: z.string(),
    environment: z.enum(["test", "production"]),
    key_prefix: z.string(),
    status: z.enum(["active", "revoked"]),
    created_at: z.string(),
    last_used_at: z.string().nullable(),
    organizations: z.object({ trade_name: z.string().nullable(), legal_name: z.string() }).nullable(),
  }),
);

const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("es-EC", { timeZone: "America/Guayaquil", dateStyle: "short", timeStyle: "short" }) : "Nunca";

export default async function ApiKeysPage() {
  const supabase = await createClient();
  const [orgs, { data, error }] = await Promise.all([
    getOrganizationOverview(supabase),
    // Columnas permitidas por RLS/grants (sin key_hash).
    supabase
      .from("api_keys")
      .select("id, application_name, environment, key_prefix, status, created_at, last_used_at, organizations(trade_name, legal_name)")
      .order("created_at", { ascending: false }),
  ]);
  if (error) throw new Error(`api_keys: ${error.message}`);
  const keys = rowSchema.parse(data);

  return (
    <>
      <PageHeader
        title="API keys"
        subtitle="Claves con las que las aplicaciones consumidoras se autentican en Nixgo Billing"
      />
      {orgs.length > 0 && (
        <div className="mb-6">
          <CreateKeyForm organizations={orgs.map((o) => ({ id: o.id, name: o.trade_name ?? o.legal_name }))} />
        </div>
      )}
      {keys.length === 0 ? (
        <EmptyState>No hay claves visibles. Solo los administradores de cada empresa pueden verlas y crearlas.</EmptyState>
      ) : (
        <Table>
          <thead className="bg-slate-50">
            <tr>
              <th className={th}>Empresa</th>
              <th className={th}>Aplicación</th>
              <th className={th}>Clave</th>
              <th className={th}>Ambiente</th>
              <th className={th}>Estado</th>
              <th className={th}>Último uso</th>
              <th className={th} />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {keys.map((k) => (
              <tr key={k.id}>
                <td className={td}>{k.organizations?.trade_name ?? k.organizations?.legal_name ?? "—"}</td>
                <td className={td}>{k.application_name}</td>
                <td className={`${td} font-mono`}>{k.key_prefix}…</td>
                <td className={td}>{k.environment === "production" ? "Producción" : "Pruebas"}</td>
                <td className={td}>{k.status === "active" ? "Activa" : "Revocada"}</td>
                <td className={td}>{fmt(k.last_used_at)}</td>
                <td className={`${td} text-right`}>
                  {k.status === "active" && (
                    <form action={revokeApiKey}>
                      <input type="hidden" name="id" value={k.id} />
                      <button type="submit" className="text-xs font-medium text-red-700 hover:underline">
                        Revocar
                      </button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
