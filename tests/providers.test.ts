import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { getBillingProvider } from "../src/lib/billing/providers";
import { MockBillingProvider } from "../src/lib/billing/providers/mock";
import {
  ProviderNotImplementedError,
  WebhookSignatureError,
  type ProviderInvoiceRequest,
} from "../src/lib/billing/providers/types";

const request: ProviderInvoiceRequest = {
  context: { organizationId: "org-1", ruc: "1790000000001", environment: "test", idempotencyKey: "k1" },
  issueDate: "2026-10-05",
  establishmentCode: "001",
  emissionPointCode: "001",
  sequential: 1,
  currency: "USD",
  customer: { identificationType: "cedula", identification: "0000000000", legalName: "Cliente" },
  items: [],
  totals: { subtotal: 0, discount: 0, tax: 0, total: 0 },
};

describe("registro de proveedores", () => {
  it("resuelve proveedores por nombre y reutiliza la instancia", () => {
    expect(getBillingProvider("mock").name).toBe("mock");
    expect(getBillingProvider("mock")).toBe(getBillingProvider("mock"));
  });

  it("Factuplan falla explícitamente mientras sea un stub", async () => {
    const provider = getBillingProvider("factuplan");
    await expect(provider.createInvoice(request)).rejects.toBeInstanceOf(ProviderNotImplementedError);
    await expect(provider.verifyWebhook("{}", new Headers())).rejects.toBeInstanceOf(
      ProviderNotImplementedError,
    );
  });
});

describe("MockBillingProvider", () => {
  it("es idempotente por clave de idempotencia", async () => {
    const provider = new MockBillingProvider("s");
    const a = await provider.createInvoice(request);
    const b = await provider.createInvoice(request);
    expect(a.providerDocumentId).toBe(b.providerDocumentId);
  });

  it("valida la firma del webhook", async () => {
    const provider = new MockBillingProvider("secret");
    const body = JSON.stringify({ id: "evt_1", type: "invoice.authorized", documentId: "d1", status: "authorized" });
    const signature = createHmac("sha256", "secret").update(body).digest("hex");

    const ok = await provider.verifyWebhook(body, new Headers({ "x-mock-signature": signature }));
    expect(ok.eventId).toBe("evt_1");
    expect(ok.status).toBe("authorized");

    await expect(provider.verifyWebhook(body, new Headers({ "x-mock-signature": "bad" }))).rejects.toBeInstanceOf(
      WebhookSignatureError,
    );
    await expect(provider.verifyWebhook(body, new Headers())).rejects.toBeInstanceOf(WebhookSignatureError);
  });

  it("rechaza todo webhook si no hay secreto configurado", async () => {
    const provider = new MockBillingProvider("");
    const body = "{}";
    const signature = createHmac("sha256", "").update(body).digest("hex");
    await expect(provider.verifyWebhook(body, new Headers({ "x-mock-signature": signature }))).rejects.toBeInstanceOf(
      WebhookSignatureError,
    );
  });
});
