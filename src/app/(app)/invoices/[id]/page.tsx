import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState, PageHeader, Table, td, th } from "@/components/ui";
import { formatInvoiceNumber, formatMoney } from "@/lib/data/format";
import { loadInvoiceForPanel } from "@/lib/invoices/panel";
import { createClient } from "@/lib/supabase/server";

const itemRows = z.array(
  z.object({
    id: z.string(),
    sku: z.string().nullable(),
    description: z.string(),
    quantity: z.number(),
    unit_price: z.number(),
    discount: z.number(),
    tax_rate: z.number(),
    total: z.number(),
  }),
);
const eventRows = z.array(
  z.object({ id: z.string(), event_type: z.string(), actor_type: z.string(), provider: z.string().nullable(), created_at: z.string() }),
);

const EVENT_LABEL: Record<string, string> = {
  "invoice.created": "Factura creada",
  "provider.invoice_submitted": "Enviada al proveedor",
  "provider.webhook": "Aviso del proveedor (webhook)",
  "provider.reconciled": "Consultada al proveedor (reconciliación)",
  "provider.error": "Error del proveedor al enviar",
  "provider.reconcile_error": "Error al reconciliar",
};
const ACTOR_LABEL: Record<string, string> = { user: "usuario", api_key: "app (API key)", provider: "proveedor", system: "sistema" };
const ID_LABEL: Record<string, string> = { ruc: "RUC", cedula: "Cédula", passport: "Pasaporte", final_consumer: "Consumidor final", foreign_id: "Id. extranjera" };

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("es-EC", { timeZone: "America/Guayaquil", dateStyle: "short", timeStyle: "medium" }) : "—";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-sm break-words">{children || "—"}</dd>
    </div>
  );
}

export default async function InvoiceDetailPage({ params }: PageProps<"/invoices/[id]">) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const supabase = await createClient();
  const found = await loadInvoiceForPanel(supabase, id);
  if (!found) notFound();
  const { invoice, customer, organization } = found;

  const [itemsRes, eventsRes] = await Promise.all([
    supabase
      .from("invoice_items")
      .select("id, sku, description, quantity, unit_price, discount, tax_rate, total")
      .eq("invoice_id", id)
      .eq("organization_id", invoice.organization_id),
    // RLS: solo administradores y facturación ven los eventos; el resto recibe una lista vacía.
    supabase
      .from("billing_events")
      .select("id, event_type, actor_type, provider, created_at")
      .eq("invoice_id", id)
      .eq("organization_id", invoice.organization_id)
      .order("created_at", { ascending: true }),
  ]);
  if (itemsRes.error) throw new Error(`invoice_items: ${itemsRes.error.message}`);
  const items = itemRows.parse(itemsRes.data);
  const events = eventsRes.error ? [] : eventRows.parse(eventsRes.data);

  const number = formatInvoiceNumber(found.establishmentCode, found.emissionPointCode, invoice.sequential);
  const money = (n: number) => formatMoney(n, invoice.currency);

  return (
    <>
      <p className="mb-2 text-sm">
        <Link href="/invoices" className="text-indigo-700 hover:underline">
          ← Facturas
        </Link>
      </p>
      <PageHeader title={`Factura ${number}`} subtitle={`${organization?.trade_name ?? organization?.legal_name ?? ""} · ${invoice.environment === "production" ? "Producción" : "Pruebas"}`} />

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <StatusBadge status={invoice.status} />
        {invoice.status === "authorized" ? (
          <>
            <a href={`/invoices/${invoice.id}/ride`} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-700">
              Descargar RIDE (PDF)
            </a>
            <a href={`/invoices/${invoice.id}/xml`} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold hover:bg-slate-50">
              Descargar XML
            </a>
          </>
        ) : (
          <span className="text-sm text-slate-500">El RIDE y el XML están disponibles cuando la factura se autoriza.</span>
        )}
      </div>

      <section className="mb-8 grid gap-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm md:grid-cols-3">
        <dl className="space-y-4">
          <Field label="Fecha de emisión">{invoice.issue_date}</Field>
          <Field label="Referencia externa">{invoice.external_reference}</Field>
          <Field label="Aplicación origen">{invoice.source_application}</Field>
        </dl>
        <dl className="space-y-4">
          <Field label="Cliente">{customer?.legal_name}</Field>
          <Field label="Identificación">
            {customer ? `${ID_LABEL[customer.identification_type] ?? customer.identification_type} ${customer.identification}` : null}
          </Field>
          <Field label="Correo">{customer?.email}</Field>
        </dl>
        <dl className="space-y-4">
          <Field label="Nº de autorización">{invoice.sri_authorization_number}</Field>
          <Field label="Autorizada el">{invoice.sri_authorized_at ? when(invoice.sri_authorized_at) : null}</Field>
          <Field label="Clave de acceso">
            <span className="font-mono text-xs">{invoice.access_key}</span>
          </Field>
          {invoice.rejection_reason && <Field label="Motivo de rechazo">{invoice.rejection_reason}</Field>}
        </dl>
      </section>

      <section className="mb-8 space-y-3">
        <h2 className="text-base font-semibold">Detalle</h2>
        <Table>
          <thead className="bg-slate-50">
            <tr>
              <th className={th}>Descripción</th>
              <th className={`${th} text-right`}>Cant.</th>
              <th className={`${th} text-right`}>P. unitario</th>
              <th className={`${th} text-right`}>Desc.</th>
              <th className={`${th} text-right`}>IVA %</th>
              <th className={`${th} text-right`}>Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.map((i) => (
              <tr key={i.id}>
                <td className={td}>{i.sku ? `${i.sku} · ` : ""}{i.description}</td>
                <td className={`${td} text-right tabular-nums`}>{i.quantity}</td>
                <td className={`${td} text-right tabular-nums`}>{money(i.unit_price)}</td>
                <td className={`${td} text-right tabular-nums`}>{money(i.discount)}</td>
                <td className={`${td} text-right tabular-nums`}>{i.tax_rate}</td>
                <td className={`${td} text-right tabular-nums`}>{money(i.total)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
        <dl className="ml-auto max-w-xs space-y-1 text-sm">
          <div className="flex justify-between"><dt>Subtotal</dt><dd className="tabular-nums">{money(invoice.subtotal)}</dd></div>
          <div className="flex justify-between"><dt>Descuento</dt><dd className="tabular-nums">{money(invoice.discount)}</dd></div>
          <div className="flex justify-between"><dt>IVA</dt><dd className="tabular-nums">{money(invoice.tax)}</dd></div>
          <div className="flex justify-between border-t border-slate-200 pt-1 font-semibold"><dt>Total</dt><dd className="tabular-nums">{money(invoice.total)}</dd></div>
        </dl>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold">Historial</h2>
        {events.length === 0 ? (
          <EmptyState>Sin eventos visibles (el historial lo ven administradores y facturación).</EmptyState>
        ) : (
          <ol className="space-y-2 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            {events.map((e) => (
              <li key={e.id} className="flex flex-wrap justify-between gap-2 text-sm">
                <span>{EVENT_LABEL[e.event_type] ?? e.event_type}</span>
                <span className="text-slate-500">
                  {ACTOR_LABEL[e.actor_type] ?? e.actor_type} · {when(e.created_at)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );
}
