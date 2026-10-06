import { describe, expect, it } from "vitest";
import { FactuplanProvider } from "../src/lib/billing/providers/factuplan";
import { MockBillingProvider } from "../src/lib/billing/providers/mock";
import type { BillingProvider, ProviderContext } from "../src/lib/billing/providers/types";
import {
  reconcileStaleInvoices,
  type ReconcileDeps,
  type StaleInvoice,
} from "../src/lib/invoices/reconcile";

const item = (n: number, over: Partial<StaleInvoice> = {}): StaleInvoice => ({
  invoiceId: `inv-${n}`,
  organizationId: "org-1",
  environment: "test",
  provider: "mock",
  providerDocumentId: `mock_${n}`,
  ruc: "1790000000001",
  providerCompanyRef: "ref-1",
  ...over,
});

function setup(stale: StaleInvoice[], opts: { provider?: BillingProvider; applied?: boolean } = {}) {
  const applied: { org: string; id: string; status: string }[] = [];
  const events: { eventType: string; invoiceId: string; sourceApplication: string; response?: unknown }[] = [];
  const asked: { olderThanMinutes: number; limit: number }[] = [];
  const deps: ReconcileDeps = {
    repo: {
      async listStale(olderThanMinutes, limit) {
        asked.push({ olderThanMinutes, limit });
        return stale;
      },
      async applyProviderResult(org, id, _provider, result) {
        applied.push({ org, id, status: result.status });
        return opts.applied ?? true;
      },
      async recordEvent(e) {
        events.push(e);
      },
    },
    getProvider: (name) => opts.provider ?? (name === "mock" ? new MockBillingProvider("s") : new FactuplanProvider()),
  };
  return { deps, applied, events, asked };
}

const run = (deps: ReconcileDeps) => reconcileStaleInvoices(deps, { olderThanMinutes: 10, limit: 25 });

describe("reconcileStaleInvoices", () => {
  it("sin facturas atascadas no hace nada", async () => {
    const { deps, applied } = setup([]);
    await expect(run(deps)).resolves.toEqual({ checked: 0, resolved: 0, stillProcessing: 0, skipped: 0, failed: 0 });
    expect(applied).toHaveLength(0);
  });

  it("aplica la respuesta del proveedor y deja un evento de auditoría", async () => {
    const { deps, applied, events } = setup([item(1), item(2)]);
    const summary = await run(deps);
    expect(summary).toMatchObject({ checked: 2, resolved: 2, failed: 0 });
    expect(applied.map((a) => [a.id, a.status])).toEqual([["inv-1", "authorized"], ["inv-2", "authorized"]]);
    expect(events.map((e) => e.eventType)).toEqual(["provider.reconciled", "provider.reconciled"]);
    expect(events[0].sourceApplication).toBe("reconciler");
  });

  it("pasa a los parámetros de la consulta y solo el contexto necesario al proveedor", async () => {
    const seen: ProviderContext[] = [];
    const provider = new MockBillingProvider("s");
    const original = provider.getInvoice.bind(provider);
    provider.getInvoice = (ctx, id) => (seen.push(ctx), original(ctx, id));
    const { deps, asked } = setup([item(1, { certificateRef: "cert-ref" })], { provider });
    await reconcileStaleInvoices(deps, { olderThanMinutes: 30, limit: 7 });
    expect(asked).toEqual([{ olderThanMinutes: 30, limit: 7 }]);
    expect(seen[0]).toEqual({
      organizationId: "org-1",
      ruc: "1790000000001",
      environment: "test",
      providerCompanyRef: "ref-1",
      certificateRef: "cert-ref",
    });
  });

  it("si el proveedor sigue 'processing' lo cuenta aparte y la reaplica (renueva su turno)", async () => {
    const provider = new MockBillingProvider("s");
    provider.getInvoice = async (_c, id) => ({ providerDocumentId: id, status: "processing" });
    const { deps, applied } = setup([item(1)], { provider });
    expect(await run(deps)).toMatchObject({ checked: 1, resolved: 0, stillProcessing: 1 });
    expect(applied).toHaveLength(1);
  });

  it("si un webhook ya la resolvió (la base no cambia nada) no cuenta como resuelta por reconciliación", async () => {
    const { deps } = setup([item(1)], { applied: false });
    expect(await run(deps)).toMatchObject({ checked: 1, resolved: 0, failed: 0 });
  });

  it("Factuplan sin implementar se omite sin error ni evento", async () => {
    const { deps, events } = setup([item(1, { provider: "factuplan" })]);
    expect(await run(deps)).toMatchObject({ checked: 1, skipped: 1, failed: 0 });
    expect(events).toHaveLength(0);
  });

  it("un fallo en una factura no detiene a las demás y queda registrado", async () => {
    const provider = new MockBillingProvider("s");
    const original = provider.getInvoice.bind(provider);
    provider.getInvoice = async (ctx, id) => {
      if (id === "mock_1") throw new Error("timeout token=abc");
      return original(ctx, id);
    };
    const { deps, applied, events } = setup([item(1), item(2)], { provider });
    expect(await run(deps)).toMatchObject({ checked: 2, resolved: 1, failed: 1 });
    expect(applied.map((a) => a.id)).toEqual(["inv-2"]);
    expect(events.map((e) => e.eventType)).toEqual(["provider.reconcile_error", "provider.reconciled"]);
  });
});

describe("MockBillingProvider.getInvoice", () => {
  it("no necesita estado: autoriza cualquier documento mock y es estable entre instancias", async () => {
    const ctx: ProviderContext = { organizationId: "o", ruc: "1790000000001", environment: "test" };
    const a = await new MockBillingProvider("s").getInvoice(ctx, "mock_x");
    const b = await new MockBillingProvider("s").getInvoice(ctx, "mock_x");
    expect(a).toMatchObject({ providerDocumentId: "mock_x", status: "authorized", authorizationNumber: "MOCK-AUTH-mock_x" });
    expect(b.accessKey).toBe(a.accessKey);
  });
});
