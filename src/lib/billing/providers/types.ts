import type {
  BillingEnvironment,
  InvoiceCustomer,
  InvoiceItem,
  InvoiceStatus,
  InvoiceTotals,
  ProviderName,
} from "../types";

/** Datos del tenant que el proveedor necesita. Nunca contiene secretos ni certificados. */
export interface ProviderContext {
  organizationId: string;
  ruc: string;
  environment: BillingEnvironment;
  /** Referencia de la empresa en el proveedor (p. ej. id de compañía), si aplica. */
  providerCompanyRef?: string;
  /** Referencia opaca al certificado custodiado por el proveedor. */
  certificateRef?: string;
  /** Clave de idempotencia a propagar al proveedor si lo soporta. */
  idempotencyKey?: string;
}

export interface ProviderInvoiceRequest {
  context: ProviderContext;
  issueDate: string; // YYYY-MM-DD
  establishmentCode: string;
  emissionPointCode: string;
  sequential: number;
  currency: string;
  customer: InvoiceCustomer;
  items: InvoiceItem[];
  totals: InvoiceTotals;
  externalReference?: string;
}

export interface ProviderInvoiceResult {
  providerDocumentId: string;
  status: InvoiceStatus;
  accessKey?: string;
  authorizationNumber?: string;
  authorizedAt?: string; // ISO 8601
  rejectionReason?: string;
}

export interface ProviderCreditNoteRequest {
  context: ProviderContext;
  originalProviderDocumentId: string;
  reason: string;
  issueDate: string;
  items: InvoiceItem[];
  totals: InvoiceTotals;
}

export interface ProviderFile {
  contentType: string;
  /** Contenido del archivo (XML como texto o PDF como bytes). */
  body: Uint8Array | string;
  filename: string;
}

export interface VerifiedWebhook {
  /** Id único del evento en el proveedor: base de la idempotencia. */
  eventId: string;
  eventType: string;
  providerDocumentId?: string;
  status?: InvoiceStatus;
  result?: Partial<ProviderInvoiceResult>;
  /** Payload ya parseado, para auditoría (se sanitiza antes de guardar). */
  payload: unknown;
}

/**
 * Contrato único entre Nixgo Billing y cualquier proveedor fiscal.
 * El resto de la aplicación SOLO depende de esta interfaz.
 */
export interface BillingProvider {
  readonly name: ProviderName;
  createInvoice(request: ProviderInvoiceRequest): Promise<ProviderInvoiceResult>;
  getInvoice(context: ProviderContext, providerDocumentId: string): Promise<ProviderInvoiceResult>;
  createCreditNote(request: ProviderCreditNoteRequest): Promise<ProviderInvoiceResult>;
  getRide(context: ProviderContext, providerDocumentId: string): Promise<ProviderFile>;
  getXml(context: ProviderContext, providerDocumentId: string): Promise<ProviderFile>;
  /** Valida la firma sobre el cuerpo CRUDO. Debe lanzar WebhookSignatureError si es inválida. */
  verifyWebhook(rawBody: string, headers: Headers): Promise<VerifiedWebhook>;
}

export class ProviderNotImplementedError extends Error {
  constructor(provider: string, method: string) {
    super(`${provider}.${method} no está implementado todavía (ver docs/FACTUPLAN.md)`);
    this.name = "ProviderNotImplementedError";
  }
}

export class WebhookSignatureError extends Error {
  constructor(message = "Firma de webhook inválida") {
    super(message);
    this.name = "WebhookSignatureError";
  }
}
