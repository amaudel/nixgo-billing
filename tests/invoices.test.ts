import { describe, expect, it } from "vitest";
import { ApiError } from "../src/lib/api/errors";
import { RateLimiter } from "../src/lib/api/rate-limit";
import { computeTotals, TotalsError } from "../src/lib/billing/totals";
import { MockBillingProvider } from "../src/lib/billing/providers/mock";
import { FactuplanProvider } from "../src/lib/billing/providers/factuplan";
import type { BillingProvider, ProviderInvoiceResult } from "../src/lib/billing/providers/types";
import { canonicalJson, hashRequest } from "../src/lib/invoices/canonical";
import { presentInvoice } from "../src/lib/invoices/presenter";
import { createInvoiceSchema, idempotencyKeySchema } from "../src/lib/invoices/schema";
import {
  createInvoice,
  getInvoice,
  listInvoices,
  type InvoiceRepository,
  type InvoiceServiceDeps,
  type Tenant,
} from "../src/lib/invoices/service";
import type { InvoiceDetail } from "../src/lib/invoices/types";

const body = {
  establishmentCode: "001",
  emissionPointCode: "001",
  issueDate: "2026-10-05",
  externalReference: "pay_1",
  customer: { identificationType: "cedula", identification: "0912345678", legalName: "Juan Pérez" },
  items: [{ description: "Plan", quantity: 1, unitPrice: 25, taxRate: 15 }],
};
const parse = (b: unknown = body) => createInvoiceSchema.parse(b);

describe("computeTotals", () => {
  const item = { description: "x", quantity: 1, unitPrice: 25, discount: 0, taxRate: 15 };

  it("calcula subtotal, impuesto y total en centavos exactos", () => {
    const { totals, items } = computeTotals([item]);
    expect(totals).toEqual({ subtotal: 25, discount: 0, tax: 3.75, total: 28.75 });
    expect(items[0]).toMatchObject({ taxAmount: 3.75, total: 28.75 });
  });

  it("no acumula error de coma flotante", () => {
    // 0.1 + 0.2 sería 0.30000000000000004 en float
    const { totals } = computeTotals([
      { ...item, unitPrice: 0.1, taxRate: 0 },
      { ...item, unitPrice: 0.2, taxRate: 0 },
    ]);
    expect(totals.total).toBe(0.3);
  });

  it("redondea half-up por línea y soporta cantidades/precios con 6 decimales", () => {
    // 3 × 0.333333 = 0.999999 → 1.00 ; IVA 15% de 1.00 = 0.15
    const { totals } = computeTotals([{ ...item, quantity: 3, unitPrice: 0.333333 }]);
    expect(totals).toEqual({ subtotal: 1, discount: 0, tax: 0.15, total: 1.15 });
    // 0.005 → 0.01 (half-up)
    expect(computeTotals([{ ...item, unitPrice: 0.005, taxRate: 0 }]).totals.subtotal).toBe(0.01);
  });

  it("aplica el descuento antes del impuesto", () => {
    const { totals } = computeTotals([{ ...item, unitPrice: 100, discount: 10, taxRate: 10 }]);
    expect(totals).toEqual({ subtotal: 90, discount: 10, tax: 9, total: 99 });
  });

  it("rechaza un descuento mayor que la línea", () => {
    expect(() => computeTotals([{ ...item, discount: 30 }])).toThrow(TotalsError);
  });
});

describe("validación de entrada", () => {
  it("acepta el ejemplo de la guía de integración", () => {
    expect(createInvoiceSchema.safeParse(body).success).toBe(true);
  });

  it("rechaza campos desconocidos (contrato estricto)", () => {
    expect(createInvoiceSchema.safeParse({ ...body, organizationId: "otra-empresa" }).success).toBe(false);
  });

  it("exige taxRate explícito: no se asume IVA", () => {
    const noRate = { ...body, items: [{ description: "Plan", quantity: 1, unitPrice: 25 }] };
    expect(createInvoiceSchema.safeParse(noRate).success).toBe(false);
  });

  it("limita decimales, cantidades y número de ítems", () => {
    const bad = (item: object) =>
      createInvoiceSchema.safeParse({ ...body, items: [{ ...body.items[0], ...item }] }).success;
    expect(bad({ discount: 1.005 })).toBe(false);
    expect(bad({ quantity: 0 })).toBe(false);
    expect(bad({ quantity: 1.1234567 })).toBe(false);
    expect(bad({ unitPrice: -1 })).toBe(false);
    expect(bad({ taxRate: 101 })).toBe(false);
    expect(bad({ unitPrice: 1.1 })).toBe(true);
    expect(createInvoiceSchema.safeParse({ ...body, items: [] }).success).toBe(false);
    expect(createInvoiceSchema.safeParse({ ...body, items: Array(101).fill(body.items[0]) }).success).toBe(false);
  });

  it("valida códigos, fecha y correo", () => {
    expect(createInvoiceSchema.safeParse({ ...body, establishmentCode: "1" }).success).toBe(false);
    expect(createInvoiceSchema.safeParse({ ...body, issueDate: "05/10/2026" }).success).toBe(false);
    expect(
      createInvoiceSchema.safeParse({ ...body, customer: { ...body.customer, email: "no-es-correo" } }).success,
    ).toBe(false);
  });

  it("Idempotency-Key: imprimible, sin espacios y de 1 a 200", () => {
    expect(idempotencyKeySchema.safeParse("nidocerca_payment_92839").success).toBe(true);
    expect(idempotencyKeySchema.safeParse("").success).toBe(false);
    expect(idempotencyKeySchema.safeParse("con espacio").success).toBe(false);
    expect(idempotencyKeySchema.safeParse("x".repeat(201)).success).toBe(false);
  });
});

describe("huella de la petición", () => {
  it("no depende del orden de las claves", () => {
    expect(hashRequest({ a: 1, b: { c: 2, d: 3 } })).toBe(hashRequest({ b: { d: 3, c: 2 }, a: 1 }));
    expect(canonicalJson({ b: 1, a: undefined })).toBe('{"b":1}');
  });
  it("cambia si cambia el contenido", () => {
    expect(hashRequest(parse())).not.toBe(hashRequest(parse({ ...body, externalReference: "pay_2" })));
  });
});

describe("RateLimiter", () => {
  it("permite hasta el límite y luego bloquea con Retry-After", () => {
    const rl = new RateLimiter(2, 60_000);
    expect(rl.check("k", 0).allowed).toBe(true);
    expect(rl.check("k", 1).allowed).toBe(true);
    const blocked = rl.check("k", 2);
    expect(blocked).toMatchObject({ allowed: false, remaining: 0 });
    expect(blocked.retryAfter).toBeGreaterThan(0);
  });
  it("cuenta cada clave por separado y reinicia la ventana", () => {
    const rl = new RateLimiter(1, 1000);
    expect(rl.check("a", 0).allowed).toBe(true);
    expect(rl.check("b", 0).allowed).toBe(true);
    expect(rl.check("a", 10).allowed).toBe(false);
    expect(rl.check("a", 1001).allowed).toBe(true);
  });
  it("acota la memoria", () => {
    const rl = new RateLimiter(5, 1000, 3);
    for (let i = 0; i < 20; i++) rl.check(`k${i}`, 0);
    expect(rl.check("nueva", 0).allowed).toBe(true);
  });
});

// ---------------------------------------------------------------- servicio con repositorio en memoria
function fakeRepo(opts: { providerConfig?: Record<string, { provider: "mock" | "factuplan" }> } = {}) {
  const invoices = new Map<string, InvoiceDetail & { organizationId: string }>();
  const idem = new Map<string, { hash: string; invoiceId: string }>();
  const events: { eventType: string; invoiceId: string; response?: unknown }[] = [];
  let seq = 0;

  const repo: InvoiceRepository = {
    async getProviderSelection(org, env) {
      return opts.providerConfig?.[`${org}:${env}`] ?? null;
    },
    async createDraft(i) {
      const key = `${i.organizationId}:${i.environment}:${i.idempotencyKey}`;
      const existing = idem.get(key);
      if (existing) {
        if (existing.hash !== i.requestHash) {
          throw new ApiError(422, "idempotency_conflict", "conflicto");
        }
        return { replayed: true, invoiceId: existing.invoiceId };
      }
      const inv = i.invoice as {
        establishment_code: string; emission_point_code: string; issue_date: string;
        external_reference: string | null;
        customer: InvoiceDetail["customer"]; totals: Record<string, number>; items: InvoiceDetail["items"];
      };
      const id = `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;
      invoices.set(id, {
        organizationId: i.organizationId,
        id, status: "pending", environment: i.environment, provider: i.provider, provider_document_id: null,
        establishment_code: inv.establishment_code, emission_point_code: inv.emission_point_code,
        sequential: seq, issue_date: inv.issue_date, currency: "USD", external_reference: inv.external_reference,
        subtotal: inv.totals.subtotal, discount: inv.totals.discount, tax: inv.totals.tax, total: inv.totals.total,
        access_key: null, authorization_number: null, authorized_at: null, rejection_reason: null,
        created_at: "2026-10-05T00:00:00Z", customer: inv.customer, items: inv.items,
      });
      idem.set(key, { hash: i.requestHash, invoiceId: id });
      return { replayed: false, invoiceId: id };
    },
    async getDetail(org, env, id) {
      const inv = invoices.get(id);
      return inv && inv.organizationId === org && inv.environment === env ? inv : null;
    },
    async list(org, env, q) {
      return [...invoices.values()]
        .filter((i) => i.organizationId === org && i.environment === env && (!q.status || i.status === q.status))
        .slice(0, q.limit + 1)
        .map((i) => ({ ...i, customer_identification: i.customer.identification, customer_legal_name: i.customer.legal_name }));
    },
    async applyProviderResult(org, id, provider, r: ProviderInvoiceResult) {
      const inv = invoices.get(id);
      if (!inv || inv.organizationId !== org || !["pending", "processing"].includes(inv.status)) return false;
      inv.status = r.status;
      inv.provider_document_id = r.providerDocumentId;
      return true;
    },
    async recordEvent(e) {
      events.push({ eventType: e.eventType, invoiceId: e.invoiceId, response: e.response });
    },
  };
  return { repo, invoices, events };
}

const tenantA: Tenant = { organizationId: "org-a", ruc: "1790000000001", environment: "test", apiKeyId: "key-a", applicationName: "app" };
const tenantB: Tenant = { ...tenantA, organizationId: "org-b", ruc: "1790000000002", apiKeyId: "key-b" };

function deps(repo: InvoiceRepository, provider: BillingProvider = new MockBillingProvider("s")): InvoiceServiceDeps {
  return { repo, getProvider: (name) => (name === "mock" ? provider : new FactuplanProvider()) };
}

describe("createInvoice (servicio)", () => {
  it("crea la factura, la envía al proveedor y queda en processing", async () => {
    const { repo, events } = fakeRepo();
    const { invoice, replayed } = await createInvoice(deps(repo), tenantA, "k1", parse());
    expect(replayed).toBe(false);
    expect(invoice.status).toBe("processing");
    expect(invoice.provider_document_id).toMatch(/^mock_/);
    expect(invoice.total).toBe(28.75);
    expect(events.map((e) => e.eventType)).toEqual(["provider.invoice_submitted"]);
  });

  it("un reintento con la misma clave no crea otra factura ni vuelve a llamar al proveedor", async () => {
    const { repo, invoices } = fakeRepo();
    let calls = 0;
    const provider = new MockBillingProvider("s");
    const original = provider.createInvoice.bind(provider);
    provider.createInvoice = (r) => (calls++, original(r));

    const first = await createInvoice(deps(repo, provider), tenantA, "k1", parse());
    const second = await createInvoice(deps(repo, provider), tenantA, "k1", parse());
    expect(second.replayed).toBe(true);
    expect(second.invoice.id).toBe(first.invoice.id);
    expect(invoices.size).toBe(1);
    expect(calls).toBe(1);
  });

  it("la misma clave con otro cuerpo es conflicto (422)", async () => {
    const { repo } = fakeRepo();
    await createInvoice(deps(repo), tenantA, "k1", parse());
    await expect(
      createInvoice(deps(repo), tenantA, "k1", parse({ ...body, externalReference: "otra" })),
    ).rejects.toMatchObject({ status: 422, code: "idempotency_conflict" });
  });

  it("si el proveedor falla, la factura queda pending y el reintento la reanuda", async () => {
    const { repo, invoices, events } = fakeRepo();
    const flaky = new MockBillingProvider("s");
    let fail = true;
    const original = flaky.createInvoice.bind(flaky);
    flaky.createInvoice = async (r) => {
      if (fail) throw new Error("timeout con token=abc123");
      return original(r);
    };

    await expect(createInvoice(deps(repo, flaky), tenantA, "k1", parse())).rejects.toMatchObject({
      status: 502,
      code: "provider_error",
    });
    expect([...invoices.values()][0].status).toBe("pending");
    expect(events.some((e) => e.eventType === "provider.error")).toBe(true);

    fail = false;
    const retry = await createInvoice(deps(repo, flaky), tenantA, "k1", parse());
    expect(retry.replayed).toBe(true);
    expect(retry.invoice.status).toBe("processing");
    expect(invoices.size).toBe(1);
  });

  it("producción exige proveedor configurado; pruebas usa mock por omisión", async () => {
    const { repo } = fakeRepo();
    await expect(
      createInvoice(deps(repo), { ...tenantA, environment: "production" }, "k1", parse()),
    ).rejects.toMatchObject({ status: 409, code: "provider_not_configured" });
    await expect(createInvoice(deps(repo), tenantA, "k1", parse())).resolves.toBeTruthy();
  });

  it("con Factuplan sin implementar responde 501 y deja la factura pending", async () => {
    const { repo, invoices } = fakeRepo({ providerConfig: { "org-a:test": { provider: "factuplan" } } });
    await expect(createInvoice(deps(repo), tenantA, "k1", parse())).rejects.toMatchObject({
      status: 501,
      code: "provider_not_implemented",
    });
    expect([...invoices.values()][0].status).toBe("pending");
  });

  it("descuento mayor que la línea → 422 antes de tocar la base", async () => {
    const { repo, invoices } = fakeRepo();
    const bad = parse({ ...body, items: [{ ...body.items[0], discount: 99 }] });
    await expect(createInvoice(deps(repo), tenantA, "k1", bad)).rejects.toMatchObject({ status: 422 });
    expect(invoices.size).toBe(0);
  });
});

describe("aislamiento entre empresas y ambientes (servicio)", () => {
  it("una empresa no puede leer ni listar facturas de otra", async () => {
    const { repo } = fakeRepo();
    const { invoice } = await createInvoice(deps(repo), tenantA, "k1", parse());
    await expect(getInvoice(deps(repo), tenantB, invoice.id)).rejects.toMatchObject({ status: 404 });
    expect((await listInvoices(deps(repo), tenantB, { limit: 20, offset: 0 })).invoices).toHaveLength(0);
    expect((await listInvoices(deps(repo), tenantA, { limit: 20, offset: 0 })).invoices).toHaveLength(1);
  });

  it("una key de pruebas no ve facturas de producción", async () => {
    const { repo } = fakeRepo({ providerConfig: { "org-a:production": { provider: "mock" } } });
    const prod = { ...tenantA, environment: "production" as const };
    const { invoice } = await createInvoice(deps(repo), prod, "k1", parse());
    await expect(getInvoice(deps(repo), tenantA, invoice.id)).rejects.toMatchObject({ status: 404 });
  });

  it("hasMore se calcula con limit+1", async () => {
    const { repo } = fakeRepo();
    for (const k of ["a", "b", "c"]) await createInvoice(deps(repo), tenantA, k, parse({ ...body, externalReference: k }));
    const page = await listInvoices(deps(repo), tenantA, { limit: 2, offset: 0 });
    expect(page.invoices).toHaveLength(2);
    expect(page.hasMore).toBe(true);
  });
});

describe("presentInvoice", () => {
  it("no expone nada del proveedor y formatea el número", async () => {
    const { repo } = fakeRepo();
    const { invoice } = await createInvoice(deps(repo), tenantA, "k1", parse());
    const out = presentInvoice(invoice);
    expect(out.number).toBe("001-001-000000001");
    const text = JSON.stringify(out);
    expect(text).not.toContain("mock_");
    expect(text).not.toContain("provider");
    expect(out.totals.total).toBe(28.75);
  });
});
