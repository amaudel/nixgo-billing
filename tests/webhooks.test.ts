import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MockBillingProvider } from "../src/lib/billing/providers/mock";
import { FactuplanProvider } from "../src/lib/billing/providers/factuplan";
import {
  receiveWebhook,
  type WebhookDeps,
  type WebhookOutcome,
  type WebhookRepository,
} from "../src/lib/webhooks/service";

const SECRET = "test-secret";
const sign = (body: string, secret = SECRET) => createHmac("sha256", secret).update(body).digest("hex");
const signedHeaders = (body: string) => new Headers({ "x-mock-signature": sign(body) });

function setup(outcome: WebhookOutcome = "applied") {
  const calls: Parameters<WebhookRepository["processEvent"]>[0][] = [];
  const repo: WebhookRepository = {
    async processEvent(input) {
      calls.push(input);
      return outcome;
    },
  };
  const deps: WebhookDeps = {
    repo,
    getProvider: (name) => (name === "mock" ? new MockBillingProvider(SECRET) : new FactuplanProvider()),
  };
  return { deps, calls };
}

const event = (extra: object = {}) =>
  JSON.stringify({ id: "evt_1", type: "invoice.authorized", documentId: "mock_abc", status: "authorized", ...extra });

describe("receiveWebhook", () => {
  it("con firma válida procesa el evento y pasa los datos al repositorio", async () => {
    const { deps, calls } = setup();
    const body = event({
      accessKey: "MOCK-AK",
      authorizationNumber: "MOCK-AUTH-1",
      authorizedAt: "2026-10-05T12:00:00Z",
    });
    await expect(receiveWebhook(deps, "mock", body, signedHeaders(body))).resolves.toEqual({ outcome: "applied" });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      provider: "mock",
      eventId: "evt_1",
      providerDocumentId: "mock_abc",
      status: "authorized",
      accessKey: "MOCK-AK",
      authorizationNumber: "MOCK-AUTH-1",
      authorizedAt: "2026-10-05T12:00:00Z",
    });
  });

  it("firma inválida o ausente → 401 y NO toca la base de datos", async () => {
    const { deps, calls } = setup();
    const body = event();
    for (const headers of [new Headers(), new Headers({ "x-mock-signature": sign(body, "otro-secreto") })]) {
      await expect(receiveWebhook(deps, "mock", body, headers)).rejects.toMatchObject({ status: 401 });
    }
    expect(calls).toHaveLength(0);
  });

  it("la firma se calcula sobre el cuerpo CRUDO: alterarlo la invalida", async () => {
    const { deps, calls } = setup();
    const body = event();
    const headers = signedHeaders(body);
    await expect(receiveWebhook(deps, "mock", body.replace("authorized", "rejected"), headers)).rejects.toMatchObject({
      status: 401,
    });
    expect(calls).toHaveLength(0);
  });

  it("sin secreto configurado se rechaza todo", async () => {
    const calls: unknown[] = [];
    const deps: WebhookDeps = {
      repo: { async processEvent(i) { calls.push(i); return "applied"; } },
      getProvider: () => new MockBillingProvider(""),
    };
    const body = event();
    await expect(receiveWebhook(deps, "mock", body, new Headers({ "x-mock-signature": sign(body, "") }))).rejects.toMatchObject({ status: 401 });
    expect(calls).toHaveLength(0);
  });

  it("Factuplan sin implementar → 501 (no acepta ningún webhook)", async () => {
    const { deps, calls } = setup();
    await expect(receiveWebhook(deps, "factuplan", "{}", new Headers())).rejects.toMatchObject({
      status: 501,
      code: "provider_not_implemented",
    });
    expect(calls).toHaveLength(0);
  });

  it("firma válida pero JSON roto → 400", async () => {
    const { deps } = setup();
    const body = "{no es json";
    await expect(receiveWebhook(deps, "mock", body, signedHeaders(body))).rejects.toMatchObject({
      status: 400,
      code: "invalid_webhook",
    });
  });

  it("valida el contenido aunque la firma sea correcta", async () => {
    const { deps, calls } = setup();
    for (const bad of [
      JSON.stringify({ type: "x", documentId: "d" }), // sin id de evento
      JSON.stringify({ id: "e", documentId: "d" }), // sin tipo
      event({ status: "inventado" }), // estado fuera del dominio
      event({ authorizedAt: "ayer" }), // fecha inválida
      event({ id: "x".repeat(201) }), // id demasiado largo
    ]) {
      await expect(receiveWebhook(deps, "mock", bad, signedHeaders(bad))).rejects.toMatchObject({ status: 400 });
    }
    expect(calls).toHaveLength(0);
  });

  it("sanitiza el payload antes de guardarlo", async () => {
    const { deps, calls } = setup();
    const body = event({ token: "abc", nested: { password: "p", apiKey: "k" }, note: "ok" });
    await receiveWebhook(deps, "mock", body, signedHeaders(body));
    expect(calls[0].payload).toMatchObject({
      id: "evt_1",
      token: "[REDACTED]",
      nested: { password: "[REDACTED]", apiKey: "[REDACTED]" },
      note: "ok",
    });
  });

  it("no toma la empresa del cuerpo: el repositorio no recibe ningún organization_id", async () => {
    const { deps, calls } = setup();
    const body = event({ organizationId: "otra-empresa", organization_id: "otra" });
    await receiveWebhook(deps, "mock", body, signedHeaders(body));
    expect(Object.keys(calls[0])).not.toContain("organizationId");
  });

  it.each(["unchanged", "duplicate", "ignored"] as const)("el resultado %s responde OK", async (outcome) => {
    const { deps } = setup(outcome);
    const body = event();
    await expect(receiveWebhook(deps, "mock", body, signedHeaders(body))).resolves.toEqual({ outcome });
  });

  it("documento desconocido → 404 para que el proveedor reintente", async () => {
    const { deps } = setup("not_found");
    const body = event();
    await expect(receiveWebhook(deps, "mock", body, signedHeaders(body))).rejects.toMatchObject({ status: 404 });
  });
});

describe("MockBillingProvider (id de documento)", () => {
  it("es determinista a partir de la clave de idempotencia", async () => {
    const provider = new MockBillingProvider("s");
    const request = {
      context: { organizationId: "o", ruc: "1790000000001", environment: "test" as const, idempotencyKey: "inv-1" },
      issueDate: "2026-10-05", establishmentCode: "001", emissionPointCode: "001", sequential: 1, currency: "USD",
      customer: { identificationType: "cedula" as const, identification: "1", legalName: "x" },
      items: [], totals: { subtotal: 0, discount: 0, tax: 0, total: 0 },
    };
    expect((await provider.createInvoice(request)).providerDocumentId).toBe("mock_inv-1");
    expect((await new MockBillingProvider("s").createInvoice(request)).providerDocumentId).toBe("mock_inv-1");
  });
});
