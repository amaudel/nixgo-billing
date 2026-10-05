import type { InvoiceStatus } from "@/lib/billing/types";

const STATUS: Record<InvoiceStatus, { label: string; className: string }> = {
  authorized: { label: "Autorizada", className: "bg-emerald-50 text-emerald-700 ring-emerald-600/20" },
  processing: { label: "Procesando", className: "bg-sky-50 text-sky-700 ring-sky-600/20" },
  pending: { label: "Pendiente", className: "bg-amber-50 text-amber-700 ring-amber-600/20" },
  rejected: { label: "Rechazada", className: "bg-red-50 text-red-700 ring-red-600/20" },
  failed: { label: "Error", className: "bg-rose-50 text-rose-800 ring-rose-600/20" },
  draft: { label: "Borrador", className: "bg-slate-100 text-slate-600 ring-slate-500/20" },
  voided: { label: "Anulada", className: "bg-slate-100 text-slate-500 ring-slate-500/20" },
};

export function StatusBadge({ status }: { status: InvoiceStatus }) {
  const s = STATUS[status];
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${s.className}`}>
      {s.label}
    </span>
  );
}

export const statusLabel = (status: InvoiceStatus) => STATUS[status].label;
