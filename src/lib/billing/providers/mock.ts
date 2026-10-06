import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { buildMockPdf, buildMockXml } from "./mock-documents";
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
    // Con clave de idempotencia el id es determinista (sirve entre instancias serverless y
    // permite simular webhooks sin consultar la base): mock_<clave>.
    const result: ProviderInvoiceResult = {
      providerDocumentId: key ? `mock_${key}` : `mock_${randomUUID()}`,
      status: "processing",
    };
    this.documents.set(result.providerDocumentId, result);
    return result;
  }

  /**
   * Sin estado (las instancias serverless no comparten memoria): el SRI simulado AUTORIZA todo
   * documento mock que se le consulte. Sirve para ver el ciclo completo en desarrollo.
   */
  async getInvoice(_context: ProviderContext, id: string): Promise<ProviderInvoiceResult> {
    return {
      providerDocumentId: id,
      status: "authorized",
      accessKey: `MOCK-AK-${id}`,
      authorizationNumber: `MOCK-AUTH-${id}`,
      authorizedAt: new Date().toISOString(),
    };
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
    return {
      contentType: "application/pdf",
      body: buildMockPdf(["RIDE SIMULADO (proveedor mock)", `Documento: ${id}`, "Sin valor tributario"]),
      filename: `${id}.pdf`,
    };
  }

  async getXml(_context: ProviderContext, id: string): Promise<ProviderFile> {
    return { contentType: "application/xml", body: buildMockXml(id), filename: `${id}.xml` };
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
      accessKey?: string;
      authorizationNumber?: string;
      authorizedAt?: string;
      rejectionReason?: string;
    };
    return {
      eventId: payload.id,
      eventType: payload.type,
      providerDocumentId: payload.documentId,
      status: payload.status,
      result: {
        accessKey: payload.accessKey,
        authorizationNumber: payload.authorizationNumber,
        authorizedAt: payload.authorizedAt,
        rejectionReason: payload.rejectionReason,
      },
      payload,
    };
  }
}
