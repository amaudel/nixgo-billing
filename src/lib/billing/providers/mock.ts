import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import {
  WebhookSignatureError,
  type BillingProvider,
  type ProviderContext,
  type ProviderFile,
  type ProviderInvoiceRequest,
  type ProviderInvoiceResult,
  type VerifiedWebhook,
} from "./types";

/**
 * Proveedor en memoria para desarrollo y tests. NO habla con ningún servicio externo
 * y NO genera claves de acceso reales: todo lo que devuelve lleva el prefijo MOCK.
 */
export class MockBillingProvider implements BillingProvider {
  readonly name = "mock" as const;
  private readonly documents = new Map<string, ProviderInvoiceResult>();

  constructor(private readonly webhookSecret: string = process.env.MOCK_WEBHOOK_SECRET ?? "") {}

  async createInvoice(request: ProviderInvoiceRequest): Promise<ProviderInvoiceResult> {
    const key = request.context.idempotencyKey;
    if (key) {
      const existing = this.documents.get(`idem:${key}`);
      if (existing) return existing;
    }
    const result: ProviderInvoiceResult = {
      providerDocumentId: `mock_${randomUUID()}`,
      status: "processing",
    };
    this.documents.set(result.providerDocumentId, result);
    if (key) this.documents.set(`idem:${key}`, result);
    return result;
  }

  async getInvoice(_context: ProviderContext, id: string): Promise<ProviderInvoiceResult> {
    const doc = this.documents.get(id);
    if (!doc) throw new Error(`Documento mock no encontrado: ${id}`);
    return doc;
  }

  async createCreditNote(): Promise<ProviderInvoiceResult> {
    const result: ProviderInvoiceResult = {
      providerDocumentId: `mock_${randomUUID()}`,
      status: "processing",
    };
    this.documents.set(result.providerDocumentId, result);
    return result;
  }

  async getRide(_context: ProviderContext, id: string): Promise<ProviderFile> {
    return { contentType: "text/plain", body: `MOCK RIDE ${id}`, filename: `${id}.txt` };
  }

  async getXml(_context: ProviderContext, id: string): Promise<ProviderFile> {
    return { contentType: "application/xml", body: `<mock id="${id}"/>`, filename: `${id}.xml` };
  }

  async verifyWebhook(rawBody: string, headers: Headers): Promise<VerifiedWebhook> {
    const received = headers.get("x-mock-signature") ?? "";
    const expected = createHmac("sha256", this.webhookSecret).update(rawBody).digest("hex");
    const a = Buffer.from(received);
    const b = Buffer.from(expected);
    if (!this.webhookSecret || a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new WebhookSignatureError();
    }
    const payload = JSON.parse(rawBody) as {
      id: string;
      type: string;
      documentId?: string;
      status?: VerifiedWebhook["status"];
    };
    return {
      eventId: payload.id,
      eventType: payload.type,
      providerDocumentId: payload.documentId,
      status: payload.status,
      payload,
    };
  }
}
