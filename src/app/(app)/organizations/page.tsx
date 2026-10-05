import { EmptyState, PageHeader, Table, td, th } from "@/components/ui";
import { getOrganizationOverview } from "@/lib/data/dashboard";
import { createClient } from "@/lib/supabase/server";

const STATUS_LABEL = { active: "Activa", suspended: "Suspendida", inactive: "Inactiva" } as const;
const ENV_LABEL = { test: "Pruebas", production: "Producción" } as const;

export default async function OrganizationsPage() {
  const supabase = await createClient();
  const orgs = await getOrganizationOverview(supabase);

  return (
    <>
      <PageHeader title="Empresas" subtitle="Organizaciones que emiten facturas a través de Nixgo Billing" />
      {orgs.length === 0 ? (
        <EmptyState>Aún no hay empresas. Se crean desde el backend de plataforma (ver docs/DATABASE.md).</EmptyState>
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
                  <p className="font-medium">{o.trade_name ?? o.legal_name}</p>
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
