import { describe, expect, it } from "vitest";
import {
  addMemberSchema,
  createOrganizationSchema,
  emissionPointSchema,
  establishmentSchema,
} from "../src/lib/organizations/schema";

const uuid = "11111111-1111-4111-8111-111111111111";

describe("createOrganizationSchema", () => {
  const ok = { ruc: "1790000000001", legalName: "EMPRESA S.A.", tradeName: "", address: "Quito" };

  it("acepta datos válidos y trata el nombre comercial vacío como ausente", () => {
    const r = createOrganizationSchema.parse(ok);
    expect(r.tradeName).toBeUndefined();
    expect(r.ruc).toBe("1790000000001");
  });
  it("exige RUC de exactamente 13 dígitos", () => {
    for (const ruc of ["123", "179000000000A", "17900000000011", "1790 000000001", ""]) {
      expect(createOrganizationSchema.safeParse({ ...ok, ruc }).success).toBe(false);
    }
  });
  it("exige razón social y dirección", () => {
    expect(createOrganizationSchema.safeParse({ ...ok, legalName: "  " }).success).toBe(false);
    expect(createOrganizationSchema.safeParse({ ...ok, address: "" }).success).toBe(false);
  });
});

describe("establecimientos y puntos de emisión", () => {
  it("código de 3 dígitos", () => {
    const base = { organizationId: uuid, name: "Matriz", address: "x" };
    expect(establishmentSchema.safeParse({ ...base, code: "001" }).success).toBe(true);
    for (const code of ["1", "0001", "abc", ""]) {
      expect(establishmentSchema.safeParse({ ...base, code }).success).toBe(false);
    }
  });
  it("ids deben ser UUID", () => {
    expect(emissionPointSchema.safeParse({ organizationId: uuid, establishmentId: uuid, code: "001" }).success).toBe(true);
    expect(emissionPointSchema.safeParse({ organizationId: "x", establishmentId: uuid, code: "001" }).success).toBe(false);
    expect(emissionPointSchema.safeParse({ organizationId: uuid, establishmentId: "x", code: "001" }).success).toBe(false);
  });
  it("no acepta campos de secuencial: el contador no se fija desde el panel", () => {
    const r = emissionPointSchema.parse({ organizationId: uuid, establishmentId: uuid, code: "001", currentSequence: 500 });
    expect(Object.keys(r)).not.toContain("currentSequence");
  });
});

describe("addMemberSchema", () => {
  it("normaliza el correo a minúsculas y valida el rol", () => {
    const r = addMemberSchema.parse({ organizationId: uuid, email: "  Admin@Ejemplo.COM ", role: "viewer" });
    expect(r.email).toBe("admin@ejemplo.com");
  });
  it("rechaza correos inválidos y roles inventados (p. ej. administrador de plataforma)", () => {
    expect(addMemberSchema.safeParse({ organizationId: uuid, email: "no-es-correo", role: "viewer" }).success).toBe(false);
    expect(addMemberSchema.safeParse({ organizationId: uuid, email: "a@b.co", role: "platform_admin" }).success).toBe(false);
    expect(addMemberSchema.safeParse({ organizationId: uuid, email: "a@b.co", role: "" }).success).toBe(false);
  });
});
