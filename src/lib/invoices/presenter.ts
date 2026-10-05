import { formatInvoiceNumber } from "@/lib/data/format";
import type { InvoiceDetail, InvoiceSummary } from "./types";

/**
 * Representación pública. NO expone nada del proveedor (ni su nombre ni sus ids): las apps
 * consumidoras no deben saber qué proveedor hay detrás.
 */
type Row = Pick<
  InvoiceSummary,
  | "id" | "status" | "environment" | "establishment_code" | "emission_point_code" | "sequential"
  | "issue_date" | "currency" | "external_reference" | "subtotal" | "discount" | "tax" | "total"
  | "access_key" | "authorization_number" | "authorized_at" | "rejection_reason" | "created_at"
>;

function base(row: Row) {
  return {
    id: row.id,
    number: row.sequential == null ? null : formatInvoiceNumber(row.establishment_code, row.emission_point_code, row.sequential),
    status: row.status,
    environment: row.environment,
    issueDate: row.issue_date,
    currency: row.currency,
    externalReference: row.external_reference,
    totals: { subtotal: row.subtotal, discount: row.discount, tax: row.tax, total: row.total },
    accessKey: row.access_key,
    authorization: row.authorization_number
      ? { number: row.authorization_number, authorizedAt: row.authorized_at }
      : null,
    rejectionReason: row.rejection_reason,
    createdAt: row.created_at,
  };
}

export function presentInvoice(detail: InvoiceDetail) {
  return {
    ...base(detail),
    customer: {
      identificationType: detail.customer.identification_type,
      identification: detail.customer.identification,
      legalName: detail.customer.legal_name,
      email: detail.customer.email,
      phone: detail.customer.phone,
      address: detail.customer.address,
    },
    items: detail.items.map((i) => ({
      sku: i.sku,
      description: i.description,
      quantity: i.quantity,
      unitPrice: i.unit_price,
      discount: i.discount,
      taxRate: i.tax_rate,
      taxAmount: i.tax_amount,
      total: i.total,
    })),
  };
}

export function presentInvoiceSummary(summary: InvoiceSummary) {
  return {
    ...base(summary),
    customer: { identification: summary.customer_identification, legalName: summary.customer_legal_name },
  };
}
