import { describe, expect, it } from "vitest";
import { fileResponse } from "../src/lib/api/file-response";
import { buildMockPdf, buildMockXml } from "../src/lib/billing/providers/mock-documents";
import { FactuplanProvider } from "../src/lib/billing/providers/factuplan";
import { MockBillingProvider } from "../src/lib/billing/providers/mock";
import type { BillingProvider, ProviderFile } from "../src/lib/billing/providers/types";
import { downloadDocument } from "../src/lib/invoices/service";

const tenant = { organizationId: "org-1", ruc: "1790000000001", environment: "test" as const };
const authorized = { status: "authorized", provider: "mock" as const, providerDocumentId: "mock_abc" };

function deps(provider: BillingProvider = new MockBillingProvider("s")) {
  return {
    repo: { getProviderSelection: async () => ({ provider: "mock" as const, providerCompanyRef: "ref-1" }) },
    getProvider: (name: "mock" | "factuplan") => (name === "mock" ? provider : new FactuplanProvider()),
  };
}

describe("PDF simulado", () => {
  const text = new TextDecoder().decode(buildMockPdf(["Linea 1 (con) paréntesis \\ y ñ", "Linea 2"]));

  it("es un PDF bien formado: cabecera, EOF y xref con desplazamientos exactos", () => {
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
    const startxref = Number(text.match(/startxref\n(\d+)\n/)![1]);
    expect(text.slice(startxref, startxref + 4)).toBe("xref");
    const offsets = [...text.slice(startxref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    expect(offsets).toHaveLength(5);
    offsets.forEach((offset, i) => expect(text.slice(offset, offset + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`));
  });

  it("escapa los paréntesis y barras, y reemplaza lo que no es ASCII", () => {
    expect(text).toContain("\\(con\\)");
    expect(text).toContain("\\\\");
    expect(text).not.toMatch(/[^\x00-\x7F]/);
  });

  it("Length del stream coincide con su contenido", () => {
    const len = Number(text.match(/\/Length (\d+)/)![1]);
    const stream = text.match(/stream\n([\s\S]*?)\nendstream/)![1];
    expect(stream.length).toBe(len);
  });
});

describe("XML simulado", () => {
  it("escapa el identificador y marca el documento como simulado", () => {
    const xml = buildMockXml('a"<b>&');
    expect(xml).toContain("&quot;&lt;b&gt;&amp;");
    expect(xml).toContain("SIMULADO");
  });
});

describe("downloadDocument", () => {
  it("entrega el RIDE y el XML de una factura autorizada", async () => {
    const ride = await downloadDocument(deps(), tenant, authorized, "ride");
    expect(ride.contentType).toBe("application/pdf");
    expect(ride.body).toBeInstanceOf(Uint8Array);
    const xml = await downloadDocument(deps(), tenant, authorized, "xml");
    expect(String(xml.body)).toContain("mock_abc");
  });

  it.each(["draft", "pending", "processing", "rejected", "failed", "voided"])("%s → 409 (sin comprobante válido)", async (status) => {
    await expect(downloadDocument(deps(), tenant, { ...authorized, status }, "ride")).rejects.toMatchObject({
      status: 409,
      code: "invoice_not_authorized",
    });
  });

  it("sin documento del proveedor → 409", async () => {
    await expect(downloadDocument(deps(), tenant, { ...authorized, providerDocumentId: null }, "xml")).rejects.toMatchObject({ status: 409 });
  });

  it("pasa solo el contexto necesario al proveedor", async () => {
    const provider = new MockBillingProvider("s");
    const seen: unknown[] = [];
    const original = provider.getRide.bind(provider);
    provider.getRide = (ctx, id) => (seen.push(ctx), original(ctx, id));
    await downloadDocument(deps(provider), tenant, authorized, "ride");
    expect(seen[0]).toEqual({ ...tenant, providerCompanyRef: "ref-1", certificateRef: undefined });
  });

  it("Factuplan sin implementar → 501; error del proveedor → 502 (sin filtrar el detalle)", async () => {
    await expect(downloadDocument(deps(), tenant, { ...authorized, provider: "factuplan" }, "ride")).rejects.toMatchObject({ status: 501 });
    const broken = new MockBillingProvider("s");
    broken.getXml = async () => {
      throw new Error("secret=abc connection refused");
    };
    const error = await downloadDocument(deps(broken), tenant, authorized, "xml").catch((e) => e);
    expect(error).toMatchObject({ status: 502, code: "provider_error" });
    expect(String(error.message)).not.toContain("abc");
  });
});

describe("fileResponse", () => {
  const evil: ProviderFile = { contentType: "text/html", body: "<script>alert(1)</script>", filename: 'x"\r\nSet-Cookie: a=b' };

  it("el tipo y el nombre los fija Nixgo, no el proveedor", async () => {
    const res = fileResponse(evil, "001-001-000000001", "xml");
    expect(res.headers.get("content-type")).toBe("application/xml");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="001-001-000000001.xml"');
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("sanea el número usado como nombre de archivo y sirve bytes intactos", async () => {
    const pdf = buildMockPdf(["x"]);
    const res = fileResponse({ contentType: "application/pdf", body: pdf, filename: "a" }, '../../x"; y', "ride");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="xy.pdf"');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(pdf);
  });

  it("sin número usa un nombre genérico", () => {
    expect(fileResponse(evil, null, "ride").headers.get("content-disposition")).toBe('attachment; filename="factura.pdf"');
  });
});
