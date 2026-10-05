import {
  ProviderNotImplementedError,
  type BillingProvider,
  type ProviderFile,
  type ProviderInvoiceResult,
  type VerifiedWebhook,
} from "./types";

/**
 * Adaptador de Factuplan. STUB de la Fase 0.
 *
 * No se inventan endpoints: cada método se implementará cuando docs/FACTUPLAN.md
 * documente la API oficial vigente (autenticación, sandbox, multi-RUC, webhooks,
 * idempotencia y errores). Hasta entonces falla de forma explícita en lugar de
 * simular un comportamiento que no conocemos.
 */
export class FactuplanProvider implements BillingProvider {
  readonly name = "factuplan" as const;

  createInvoice(): Promise<ProviderInvoiceResult> {
    return Promise.reject(new ProviderNotImplementedError("FactuplanProvider", "createInvoice"));
  }
  getInvoice(): Promise<ProviderInvoiceResult> {
    return Promise.reject(new ProviderNotImplementedError("FactuplanProvider", "getInvoice"));
  }
  createCreditNote(): Promise<ProviderInvoiceResult> {
    return Promise.reject(new ProviderNotImplementedError("FactuplanProvider", "createCreditNote"));
  }
  getRide(): Promise<ProviderFile> {
    return Promise.reject(new ProviderNotImplementedError("FactuplanProvider", "getRide"));
  }
  getXml(): Promise<ProviderFile> {
    return Promise.reject(new ProviderNotImplementedError("FactuplanProvider", "getXml"));
  }
  verifyWebhook(): Promise<VerifiedWebhook> {
    // Sin esquema de firma documentado NO se acepta ningún webhook.
    return Promise.reject(new ProviderNotImplementedError("FactuplanProvider", "verifyWebhook"));
  }
}
