import { z } from "zod";
import { IDENTIFICATION_TYPES, INVOICE_STATUSES } from "@/lib/billing/types";

/** Forma en que las funciones SQL devuelven una factura (snake_case); se valida en el borde. */
const customerRow = z.object({
  identification_type: z.enum(IDENTIFICATION_TYPES),
  identification: z.string(),
  legal_name: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  address: z.string().nullable(),
});

const itemRow = z.object({
  sku: z.string().nullable(),
  description: z.string(),
  quantity: z.number(),
  unit_price: z.number(),
  discount: z.number(),
  tax_rate: z.number(),
  tax_amount: z.number(),
  total: z.number(),
});

const common = {
  id: z.string(),
  status: z.enum(INVOICE_STATUSES),
  environment: z.enum(["test", "production"]),
  establishment_code: z.string(),
  emission_point_code: z.string(),
  sequential: z.number().nullable(),
  issue_date: z.string(),
  currency: z.string(),
  external_reference: z.string().nullable(),
  subtotal: z.number(),
  discount: z.number(),
  tax: z.number(),
  total: z.number(),
  access_key: z.string().nullable(),
  authorization_number: z.string().nullable(),
  authorized_at: z.string().nullable(),
  rejection_reason: z.string().nullable(),
  created_at: z.string(),
};

export const invoiceDetailSchema = z.object({
  ...common,
  provider: z.enum(["mock", "factuplan"]).nullable(),
  provider_document_id: z.string().nullable(),
  customer: customerRow,
  items: z.array(itemRow),
});
export type InvoiceDetail = z.infer<typeof invoiceDetailSchema>;

export const invoiceSummarySchema = z.object({
  ...common,
  customer_identification: z.string(),
  customer_legal_name: z.string(),
});
export type InvoiceSummary = z.infer<typeof invoiceSummarySchema>;

export const draftResultSchema = z.object({ replayed: z.boolean(), invoice_id: z.string() });
