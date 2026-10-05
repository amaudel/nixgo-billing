import "server-only";
import { getBillingProvider } from "@/lib/billing/providers";
import { createInvoiceRepository } from "./repository";
import type { InvoiceServiceDeps } from "./service";

/** Dependencias reales del servicio de facturas (service role + registro de proveedores). */
export function invoiceServiceDeps(): InvoiceServiceDeps {
  return { repo: createInvoiceRepository(), getProvider: getBillingProvider };
}
