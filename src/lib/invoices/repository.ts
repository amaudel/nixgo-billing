import "server-only";
import { z } from "zod";
import { ApiError } from "@/lib/api/errors";
import type { ProviderName } from "@/lib/billing/types";
import { redactSecrets } from "@/lib/security/sanitize";
import { createAdminClient } from "@/lib/supabase/admin";
import type { StaleInvoice } from "./reconcile";
import type { InvoiceRepository } from "./service";
import { draftResultSchema, invoiceDetailSchema, invoiceSummarySchema } from "./types";

const providerConfigSchema = z.object({
  provider: z.enum(["mock", "factuplan"]),
  provider_company_ref: z.string().nullable(),
  certificate_ref: z.string().nullable(),
});

/** Mensajes que lanzan las funciones SQL → errores de la API. */
function mapDatabaseError(message: string): ApiError | null {
  switch (message) {
    case "idempotency_conflict":
      return new ApiError(422, "idempotency_conflict", "La Idempotency-Key ya se usó con un cuerpo distinto");
    case "establishment_not_found":
      return new ApiError(422, "validation_error", "establishmentCode no existe para esta empresa");
    case "emission_point_not_found":
      return new ApiError(422, "validation_error", "emissionPointCode no existe para ese establecimiento");
    default:
      return null;
  }
}

/**
 * Acceso a datos con service role. TODA consulta lleva organization_id (y ambiente) ya resueltos
 * desde la API key; la RLS no protege este camino.
 */
const staleSchema = z.array(
  z.object({
    id: z.string(),
    organization_id: z.string(),
    environment: z.enum(["test", "production"]),
    provider: z.enum(["mock", "factuplan"]),
    provider_document_id: z.string(),
    ruc: z.string(),
    provider_company_ref: z.string().nullable(),
    certificate_ref: z.string().nullable(),
  }),
);

export function createInvoiceRepository(): InvoiceRepository & {
  listStale(olderThanMinutes: number, limit: number): Promise<StaleInvoice[]>;
} {
  const admin = createAdminClient();

  return {
    async getProviderSelection(organizationId, environment) {
      const { data, error } = await admin
        .from("organization_provider_configs")
        .select("provider, provider_company_ref, certificate_ref")
        .eq("organization_id", organizationId)
        .eq("environment", environment)
        .maybeSingle();
      if (error) throw new Error(`provider_configs: ${error.message}`);
      if (!data) return null;
      const row = providerConfigSchema.parse(data);
      return {
        provider: row.provider,
        providerCompanyRef: row.provider_company_ref ?? undefined,
        certificateRef: row.certificate_ref ?? undefined,
      };
    },

    async createDraft(input) {
      const { data, error } = await admin.rpc("create_invoice_draft", {
        p_organization_id: input.organizationId,
        p_environment: input.environment,
        p_provider: input.provider,
        p_api_key_id: input.apiKeyId,
        p_source_application: input.sourceApplication,
        p_idempotency_key: input.idempotencyKey,
        p_request_hash: input.requestHash,
        p_invoice: input.invoice,
      });
      if (error) throw mapDatabaseError(error.message) ?? new Error(`create_invoice_draft: ${error.message}`);
      const result = draftResultSchema.parse(data);
      return { replayed: result.replayed, invoiceId: result.invoice_id };
    },

    async getDetail(organizationId, environment, invoiceId) {
      const { data, error } = await admin.rpc("invoice_detail", {
        p_organization_id: organizationId,
        p_environment: environment,
        p_invoice_id: invoiceId,
      });
      if (error) throw new Error(`invoice_detail: ${error.message}`);
      return data ? invoiceDetailSchema.parse(data) : null;
    },

    async list(organizationId, environment, query) {
      const { data, error } = await admin.rpc("invoice_list", {
        p_organization_id: organizationId,
        p_environment: environment,
        p_status: query.status ?? null,
        p_external_reference: query.externalReference ?? null,
        p_limit: query.limit,
        p_offset: query.offset,
      });
      if (error) throw new Error(`invoice_list: ${error.message}`);
      return z.array(invoiceSummarySchema).parse(data);
    },

    async applyProviderResult(organizationId, invoiceId, provider: ProviderName, result) {
      const { data, error } = await admin.rpc("apply_provider_result", {
        p_organization_id: organizationId,
        p_invoice_id: invoiceId,
        p_provider: provider,
        p_provider_document_id: result.providerDocumentId,
        p_status: result.status,
        p_access_key: result.accessKey ?? null,
        p_authorization_number: result.authorizationNumber ?? null,
        p_authorized_at: result.authorizedAt ?? null,
        p_rejection_reason: result.rejectionReason ?? null,
      });
      if (error) throw new Error(`apply_provider_result: ${error.message}`);
      return data === true;
    },

    async listStale(olderThanMinutes, limit) {
      const { data, error } = await admin.rpc("invoices_to_reconcile", {
        p_older_than_minutes: olderThanMinutes,
        p_limit: limit,
      });
      if (error) throw new Error(`invoices_to_reconcile: ${error.message}`);
      return staleSchema.parse(data).map((r) => ({
        invoiceId: r.id,
        organizationId: r.organization_id,
        environment: r.environment,
        provider: r.provider,
        providerDocumentId: r.provider_document_id,
        ruc: r.ruc,
        providerCompanyRef: r.provider_company_ref ?? undefined,
        certificateRef: r.certificate_ref ?? undefined,
      }));
    },

    async recordEvent(event) {
      const { error } = await admin.from("billing_events").insert({
        organization_id: event.organizationId,
        invoice_id: event.invoiceId,
        event_type: event.eventType,
        provider: event.provider,
        actor_type: "system",
        source_application: event.sourceApplication,
        // Regla de seguridad: todo payload se sanitiza aquí, en el único punto de escritura.
        request: event.request === undefined ? null : redactSecrets(event.request),
        response: event.response === undefined ? null : redactSecrets(event.response),
      });
      // La auditoría no debe tumbar la operación ya hecha, pero tampoco pasar en silencio.
      if (error) console.error("[api] billing_events:", redactSecrets(error.message));
    },
  };
}
