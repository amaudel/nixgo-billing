import Link from "next/link";
import { EmptyState, PageHeader, Table, td, th } from "@/components/ui";
import { isPlatformAdmin } from "@/lib/auth/permissions";
import { getOrganizationOverview } from "@/lib/data/dashboard";
import { createClient } from "@/lib/supabase/server";

const STATUS_LABEL = { active: "Activa", suspended: "Suspendida", inactive: "Inactiva" } as const;
const ENV_LABEL = { test: "Pruebas", production: "Producción" } as const;

export default async function OrganizationsPage() {
  const supabase = await createClient();
  const orgs = await getOrganizationOverview(supabase);
  const { data: auth } = await supabase.auth.getUser();
  const canCreate = auth.user ? await isPlatformAdmin(supabase, auth.user.id) : false;

  return (
    <>
      <PageHeader title="Empresas" subtitle="Organizaciones que emiten facturas a través de Nixgo Billing" />
      {canCreate && (
        <p className="mb-4">
          <Link href="/organizations/new" className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700">
            Nueva empresa
          </Link>
        </p>
      )}
      {orgs.length === 0 ? (
        <EmptyState>
          {canCreate ? "Aún no hay empresas. Crea la primera con «Nueva empresa»." : "No perteneces a ninguna empresa todavía."}
        </EmptyState>
      ) : (
        <Table>
          <thead className="bg-slate-50">
            <tr>
              <th className={th}>Empresa</th>
              <th className={th}>RUC</th>
              <th className={th}>Estado</th>
              <th className={th}>Proveedor</th>
              <th className={th}>Ambiente</th>
              <th className={`${th} text-right`}>Facturas mes</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {orgs.map((o) => (
              <tr key={o.id}>
                <td className={td}>
                  <Link href={`/organizations/${o.id}`} className="font-medium text-indigo-700 hover:underline">
                    {o.trade_name ?? o.legal_name}
                  </Link>
                  {o.trade_name && <p className="text-xs text-slate-500">{o.legal_name}</p>}
                </td>
                <td className={`${td} font-mono`}>{o.ruc}</td>
                <td className={td}>{STATUS_LABEL[o.status]}</td>
                <td className={`${td} capitalize`}>{o.provider ?? "—"}</td>
                <td className={td}>{ENV_LABEL[o.environment]}</td>
                <td className={`${td} text-right tabular-nums`}>{o.invoices_month}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
