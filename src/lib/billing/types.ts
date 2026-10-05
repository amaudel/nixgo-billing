/** Tipos de dominio, independientes de cualquier proveedor y de la normativa de un país. */

export const INVOICE_STATUSES = [
  "draft",
  "pending",
  "processing",
  "authorized",
  "rejected",
  "failed",
  "voided",
] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export type BillingEnvironment = "test" | "production";
export type ProviderName = "mock" | "factuplan";

export type IdentificationType = "ruc" | "cedula" | "passport" | "final_consumer" | "foreign_id";

export interface InvoiceCustomer {
  identificationType: IdentificationType;
  identification: string;
  legalName: string;
  email?: string;
  phone?: string;
  address?: string;
}

export interface InvoiceItem {
  sku?: string;
  description: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  taxRate: number;
  taxAmount: number;
  total: number;
}

export interface InvoiceTotals {
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
}
