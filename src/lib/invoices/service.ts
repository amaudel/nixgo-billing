import { ApiError, logUnexpected } from "@/lib/api/errors";
import { computeTotals, TotalsError } from "@/lib/billing/totals";
import {
  ProviderNotImplementedError,
  type BillingProvider,
  type ProviderInvoiceRequest,
  type ProviderInvoiceResult,
} from "@/lib/billing/providers/types";
import type { BillingEnvironment, ProviderName } from "@/lib/billing/types";
import { todayInEcuador } from "@/lib/data/format";
import { hashRequest } from "./canonical";
import type { CreateInvoiceInput, ListInvoicesQuery } from "./schema";
import type { InvoiceDetail, InvoiceSummary } from "./types";

export interface ProviderSelection {
  provider: ProviderName;
  providerCompanyRef?: string;
  certificateRef?: string;
}

export interface InvoiceEvent {
  organizationId: string;
  invoiceId: string;
  eventType: string;
  provider: ProviderName;
  sourceApplication: string;
  request?: unknown;
  response?: unknown;
}

/** Acceso a datos que necesita el servicio. La implementación real usa service role. */
export interface InvoiceRepository {
  getProviderSelection(organizationId: string, environment: BillingEnvironment): Promise<ProviderSelection | null>;
  createDraft(input: {
    organizationId: string;
    environment: BillingEnvironment;
    provider: ProviderName;
    apiKeyId: string;
    sourceApplication: string;
    idempotencyKey: string;
    requestHash: string;
    invoice: unknown;
  }): Promise<{ replayed: boolean; invoiceId: string }>;
  getDetail(organizationId: string, environment: BillingEnvironment, invoiceId: string): Promise<InvoiceDetail | null>;
  list(organizationId: string, environment: BillingEnvironment, query: ListInvoicesQuery): Promise<InvoiceSummary[]>;
  applyProviderResult(
    organizationId: string,
    invoiceId: string,
    provider: ProviderName,
    result: ProviderInvoiceResult,
  ): Promise<boolean>;
  recordEvent(event: InvoiceEvent): Promise<void>;
}

export interface InvoiceServiceDeps {
  repo: InvoiceRepository;
  getProvider: (name: ProviderName) => BillingProvider;
  now?: () => Date;
}

export interface Tenant {
  organizationId: string;
  ruc: string;
  environment: BillingEnvironment;
  apiKeyId: string;
  applicationName: string;
}

export async function createInvoice(
  deps: InvoiceServiceDeps,
  tenant: Tenant,
  idempotencyKey: string,
  input: CreateInvoiceInput,
): Promise<{ invoice: InvoiceDetail; replayed: boolean }> {
  const { repo } = deps;

  // Producción exige proveedor configurado explícitamente; las pruebas caen en el mock.
  const selection =
    (await repo.getProviderSelection(tenant.organizationId, tenant.environment)) ??
    (tenant.environment === "test" ? { provider: "mock" as const } : null);
  if (!selection) {
    throw new ApiError(409, "provider_not_configured", "La empresa no tiene proveedor configurado para producción");
  }

  let computed;
  try {
    computed = computeTotals(input.items);
  } catch (error) {
    if (error instanceof TotalsError) throw new ApiError(422, "validation_error", error.message);
    throw error;
  }

  const draft = await repo.createDraft({
    organizationId: tenant.organizationId,
    environment: tenant.environment,
    provider: selection.provider,
    apiKeyId: tenant.apiKeyId,
    sourceApplication: tenant.applicationName,
    idempotencyKey,
    // Huella del cuerpo tal como llegó (antes de rellenar la fecha por omisión).
    requestHash: hashRequest(input),
    invoice: {
      establishment_code: input.establishmentCode,
      emission_point_code: input.emissionPointCode,
      issue_date: input.issueDate ?? todayInEcuador(deps.now?.()),
      external_reference: input.externalReference ?? null,
      customer: {
        identification_type: input.customer.identificationType,
        identification: input.customer.identification,
        legal_name: input.customer.legalName,
        email: input.customer.email ?? null,
        phone: input.customer.phone ?? null,
        address: input.customer.address ?? null,
      },
      totals: computed.totals,
      items: computed.items.map((i) => ({
        sku: i.sku ?? null,
        description: i.description,
        quantity: i.quantity,
        unit_price: i.unitPrice,
        discount: i.discount,
        tax_rate: i.taxRate,
        tax_amount: i.taxAmount,
        total: i.total,
      })),
    },
  });

  let invoice = await requireDetail(repo, tenant, draft.invoiceId);

  // Solo una factura 'pending' (reserva hecha, proveedor aún no confirmó) llega al proveedor.
  // Un reintento con la misma clave la reanuda; el resto de estados se devuelve tal cual.
  if (invoice.status === "pending") {
    await sendToProvider(deps, tenant, selection, invoice);
    invoice = await requireDetail(repo, tenant, draft.invoiceId);
  }
  return { invoice, replayed: draft.replayed };
}

async function sendToProvider(
  deps: InvoiceServiceDeps,
  tenant: Tenant,
  selection: ProviderSelection,
  invoice: InvoiceDetail,
) {
  const { repo } = deps;
  const provider = deps.getProvider(selection.provider);
  const request: ProviderInvoiceRequest = {
    context: {
      organizationId: tenant.organizationId,
      ruc: tenant.ruc,
      environment: tenant.environment,
      providerCompanyRef: selection.providerCompanyRef,
      certificateRef: selection.certificateRef,
      // El id de la factura es estable y único entre empresas: sirve de idempotencia hacia el proveedor.
      idempotencyKey: invoice.id,
    },
    issueDate: invoice.issue_date,
    establishmentCode: invoice.establishment_code,
    emissionPointCode: invoice.emission_point_code,
    sequential: invoice.sequential ?? 0,
    currency: invoice.currency,
    customer: {
      identificationType: invoice.customer.identification_type,
      identification: invoice.customer.identification,
      legalName: invoice.customer.legal_name,
      email: invoice.customer.email ?? undefined,
      phone: invoice.customer.phone ?? undefined,
      address: invoice.customer.address ?? undefined,
    },
    items: invoice.items.map((i) => ({
      sku: i.sku ?? undefined,
      description: i.description,
      quantity: i.quantity,
      unitPrice: i.unit_price,
      discount: i.discount,
      taxRate: i.tax_rate,
      taxAmount: i.tax_amount,
      total: i.total,
    })),
    totals: { subtotal: invoice.subtotal, discount: invoice.discount, tax: invoice.tax, total: invoice.total },
    externalReference: invoice.external_reference ?? undefined,
  };

  const event = {
    organizationId: tenant.organizationId,
    invoiceId: invoice.id,
    provider: selection.provider,
    sourceApplication: tenant.applicationName,
  };

  let result: ProviderInvoiceResult;
  try {
    result = await provider.createInvoice(request);
  } catch (error) {
    // La factura queda 'pending': reintentar con la misma Idempotency-Key la reanuda.
    await repo.recordEvent({
      ...event,
      eventType: "provider.error",
      response: { error: error instanceof Error ? error.message : String(error) },
    });
    if (error instanceof ProviderNotImplementedError) {
      throw new ApiError(501, "provider_not_implemented", "El proveedor de la empresa aún no está disponible");
    }
    logUnexpected("provider.createInvoice", error);
    throw new ApiError(502, "provider_error", "El proveedor de facturación no respondió; reintenta con la misma Idempotency-Key");
  }

  await repo.applyProviderResult(tenant.organizationId, invoice.id, selection.provider, result);
  await repo.recordEvent({
    ...event,
    eventType: "provider.invoice_submitted",
    // El contexto (RUC, referencias) no se registra: solo lo que el proveedor devolvió.
    response: result,
  });
}

async function requireDetail(repo: InvoiceRepository, tenant: Tenant, invoiceId: string) {
  const invoice = await repo.getDetail(tenant.organizationId, tenant.environment, invoiceId);
  if (!invoice) throw new Error(`Factura ${invoiceId} no encontrada tras crearla`);
  return invoice;
}

export async function getInvoice(deps: InvoiceServiceDeps, tenant: Tenant, invoiceId: string) {
  const invoice = await deps.repo.getDetail(tenant.organizationId, tenant.environment, invoiceId);
  if (!invoice) throw new ApiError(404, "not_found", "Factura no encontrada");
  return invoice;
}

export async function listInvoices(deps: InvoiceServiceDeps, tenant: Tenant, query: ListInvoicesQuery) {
  const rows = await deps.repo.list(tenant.organizationId, tenant.environment, query);
  return { invoices: rows.slice(0, query.limit), hasMore: rows.length > query.limit };
}
