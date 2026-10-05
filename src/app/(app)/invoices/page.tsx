import { z } from "zod";
import { StatusBadge, statusLabel } from "@/components/status-badge";
import { EmptyState, PageHeader, Table, td, th } from "@/components/ui";
import { INVOICE_STATUSES, type InvoiceStatus } from "@/lib/billing/types";
import { formatInvoiceNumber, formatMoney } from "@/lib/data/format";
import { createClient } from "@/lib/supabase/server";

const filtersSchema = z.object({
  status: z.enum(INVOICE_STATUSES).optional().catch(undefined),
  org: z.uuid().optional().catch(undefined),
  from: z.iso.date().optional().catch(undefined),
  to: z.iso.date().optional().catch(undefined),
  q: z.string().trim().max(80).optional().catch(undefined),
});

interface Row {
  id: string;
  issue_date: string;
  sequential: number | null;
  total: number;
  status: InvoiceStatus;
  organizations: { trade_name: string | null; legal_name: string } | null;
  customers: { legal_name: string } | null;
  establishments: { code: string } | null;
  emission_points: { code: string } | null;
}

const input =
  "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200";

export default async function InvoicesPage({ searchParams }: PageProps<"/invoices">) {
  const raw = await searchParams;
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const filters = filtersSchema.parse({
    status: first(raw.status) || undefined,
    org: first(raw.org) || undefined,
    from: first(raw.from) || undefined,
    to: first(raw.to) || undefined,
    q: first(raw.q) || undefined,
  });

  const supabase = await createClient();

  const customerJoin = filters.q ? "customers!inner(legal_name)" : "customers(legal_name)";
  let query = supabase
    .from("invoices")
    .select(
      `id, issue_date, sequential, total, status,
       organizations(trade_name, legal_name), ${customerJoin},
       establishments(code), emission_points(code)`,
    )
    .order("issue_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(50);

  if (filters.status) query = query.eq("status", filters.status);
  if (filters.org) query = query.eq("organization_id", filters.org);
  if (filters.from) query = query.gte("issue_date", filters.from);
  if (filters.to) query = query.lte("issue_date", filters.to);
  if (filters.q) query = query.ilike("customers.legal_name", `%${filters.q.replace(/[%_]/g, "\\$&")}%`);

  const [{ data, error }, { data: orgs }] = await Promise.all([
    query.overrideTypes<Row[], { merge: false }>(),
    supabase.from("organizations").select("id, trade_name, legal_name").order("legal_name"),
  ]);
  if (error) throw new Error(`invoices: ${error.message}`);
  const rows = data ?? [];

  return (
    <>
      <PageHeader title="Facturas" subtitle="Últimas 50 facturas que coinciden con los filtros" />

      <form className="mb-4 flex flex-wrap items-end gap-3" method="get">
        <select name="org" defaultValue={filters.org ?? ""} className={input} aria-label="Empresa">
          <option value="">Todas las empresas</option>
          {(orgs ?? []).map((o) => (
            <option key={o.id} value={o.id}>
              {o.trade_name ?? o.legal_name}
            </option>
          ))}
        </select>
        <select name="status" defaultValue={filters.status ?? ""} className={input} aria-label="Estado">
          <option value="">Todos los estados</option>
          {INVOICE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {statusLabel(s)}
            </option>
          ))}
        </select>
        <input type="date" name="from" defaultValue={filters.from} className={input} aria-label="Desde" />
        <input type="date" name="to" defaultValue={filters.to} className={input} aria-label="Hasta" />
        <input name="q" defaultValue={filters.q} placeholder="Cliente" className={input} aria-label="Cliente" />
        <button type="submit" className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700">
          Filtrar
        </button>
      </form>

      {rows.length === 0 ? (
        <EmptyState>No hay facturas que coincidan con los filtros.</EmptyState>
      ) : (
        <Table>
          <thead className="bg-slate-50">
            <tr>
              <th className={th}>Fecha</th>
              <th className={th}>Empresa</th>
              <th className={th}>Cliente</th>
              <th className={th}>Número</th>
              <th className={`${th} text-right`}>Total</th>
              <th className={th}>Estado SRI</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r.id}>
                <td className={td}>{r.issue_date}</td>
                <td className={td}>{r.organizations?.trade_name ?? r.organizations?.legal_name}</td>
                <td className={td}>{r.customers?.legal_name}</td>
                <td className={`${td} font-mono`}>
                  {formatInvoiceNumber(r.establishments?.code, r.emission_points?.code, r.sequential)}
                </td>
                <td className={`${td} text-right tabular-nums`}>{formatMoney(Number(r.total))}</td>
                <td className={td}>
                  <StatusBadge status={r.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
