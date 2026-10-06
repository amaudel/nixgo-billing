import { z } from "zod";
import { IDENTIFICATION_TYPES, INVOICE_STATUSES } from "@/lib/billing/types";

/** true si el número tiene a lo sumo `places` decimales (tolerando el error de coma flotante). */
const maxDecimals = (places: number) => (n: number) => {
  const scale = 10 ** places;
  return Math.abs(n * scale - Math.round(n * scale)) < 1e-6;
};

const money = (label: string) =>
  z
    .number()
    .min(0)
    .max(1_000_000_000)
    .refine(maxDecimals(2), `${label}: máximo 2 decimales`);

const itemSchema = z.strictObject({
  sku: z.string().trim().min(1).max(64).optional(),
  description: z.string().trim().min(1).max(300),
  quantity: z.number().positive().max(1_000_000).refine(maxDecimals(6), "quantity: máximo 6 decimales"),
  unitPrice: z.number().min(0).max(1_000_000_000).refine(maxDecimals(6), "unitPrice: máximo 6 decimales"),
  discount: money("discount").default(0),
  // Obligatoria a propósito: no se asume una tarifa de IVA por omisión.
  taxRate: z.number().min(0).max(100).refine(maxDecimals(2), "taxRate: máximo 2 decimales"),
});

const customerSchema = z.strictObject({
  identificationType: z.enum(IDENTIFICATION_TYPES),
  identification: z.string().trim().min(1).max(20),
  legalName: z.string().trim().min(1).max(300),
  email: z.email().max(254).optional(),
  phone: z.string().trim().min(1).max(30).optional(),
  address: z.string().trim().min(1).max(300).optional(),
});

export const createInvoiceSchema = z.strictObject({
  establishmentCode: z.string().regex(/^\d{3}$/, "Debe tener 3 dígitos"),
  emissionPointCode: z.string().regex(/^\d{3}$/, "Debe tener 3 dígitos"),
  issueDate: z.iso.date().optional(),
  externalReference: z.string().trim().min(1).max(128).optional(),
  customer: customerSchema,
  items: z.array(itemSchema).min(1).max(100),
});
export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;

/** Idempotency-Key: 1–200 caracteres imprimibles sin espacios. */
export const idempotencyKeySchema = z.string().regex(/^[\x21-\x7E]{1,200}$/, "Idempotency-Key inválida");

export const listInvoicesQuerySchema = z.object({
  status: z.enum(INVOICE_STATUSES).optional(),
  externalReference: z.string().min(1).max(128).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
});
export type ListInvoicesQuery = z.infer<typeof listInvoicesQuerySchema>;
