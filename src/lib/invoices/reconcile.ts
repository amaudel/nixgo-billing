import { logUnexpected } from "@/lib/api/errors";
import { ProviderNotImplementedError, type BillingProvider } from "@/lib/billing/providers/types";
import type { BillingEnvironment, ProviderName } from "@/lib/billing/types";
import type { InvoiceRepository } from "./service";

/** Factura en 'processing' que lleva tiempo sin resolverse (se perdió o no llegó el webhook). */
export interface StaleInvoice {
  invoiceId: string;
  organizationId: string;
  environment: BillingEnvironment;
  provider: ProviderName;
  providerDocumentId: string;
  ruc: string;
  providerCompanyRef?: string;
  certificateRef?: string;
}

export interface ReconcileRepository extends Pick<InvoiceRepository, "applyProviderResult" | "recordEvent"> {
  listStale(olderThanMinutes: number, limit: number): Promise<StaleInvoice[]>;
}

export interface ReconcileDeps {
  repo: ReconcileRepository;
  getProvider: (name: ProviderName) => BillingProvider;
}

export interface ReconcileSummary {
  checked: number;
  /** Pasaron a un estado final (autorizada/rechazada/fallida). */
  resolved: number;
  /** El proveedor sigue diciendo "en proceso": se vuelve a mirar más tarde. */
  stillProcessing: number;
  /** El proveedor aún no está implementado (Factuplan hasta la Fase 3). */
  skipped: number;
  failed: number;
}

/**
 * Pregunta al proveedor por las facturas atascadas y aplica su respuesta con la MISMA función
 * transaccional que los webhooks (solo transiciona 'pending'/'processing'; un estado final nunca
 * se pisa), así que correr esto a la vez que llegan webhooks es seguro. Un fallo en una factura
 * no detiene a las demás.
 */
export async function reconcileStaleInvoices(
  deps: ReconcileDeps,
  options: { olderThanMinutes: number; limit: number },
): Promise<ReconcileSummary> {
  const stale = await deps.repo.listStale(options.olderThanMinutes, options.limit);
  const summary: ReconcileSummary = { checked: stale.length, resolved: 0, stillProcessing: 0, skipped: 0, failed: 0 };

  for (const item of stale) {
    const event = {
      organizationId: item.organizationId,
      invoiceId: item.invoiceId,
      provider: item.provider,
      sourceApplication: "reconciler",
    };
    try {
      const provider = deps.getProvider(item.provider);
      const result = await provider.getInvoice(
        {
          organizationId: item.organizationId,
          ruc: item.ruc,
          environment: item.environment,
          providerCompanyRef: item.providerCompanyRef,
          certificateRef: item.certificateRef,
        },
        item.providerDocumentId,
      );

      // Con 'processing' también se aplica: renueva updated_at y la factura pasa al final de la cola.
      const applied = await deps.repo.applyProviderResult(item.organizationId, item.invoiceId, item.provider, result);
      await deps.repo.recordEvent({ ...event, eventType: "provider.reconciled", response: { ...result, applied } });

      if (result.status === "processing") summary.stillProcessing++;
      else if (applied) summary.resolved++;
    } catch (error) {
      if (error instanceof ProviderNotImplementedError) {
        summary.skipped++;
        continue;
      }
      summary.failed++;
      logUnexpected("reconcile", error);
      await deps.repo.recordEvent({
        ...event,
        eventType: "provider.reconcile_error",
        response: { error: error instanceof Error ? error.message : String(error) },
      });
    }
  }
  return summary;
}
