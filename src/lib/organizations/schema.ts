import { z } from "zod";

/** Los formularios envían "" para campos vacíos: se tratan como ausentes. */
const optionalText = (max: number) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.string().trim().max(max).optional());

// Solo formato (13 dígitos). La validación fiscal del RUC (dígito verificador, tipos de
// contribuyente) pertenece a src/lib/tax/ecuador/ y se implementa con la especificación vigente.
export const createOrganizationSchema = z.object({
  ruc: z.string().trim().regex(/^\d{13}$/, "El RUC debe tener 13 dígitos"),
  legalName: z.string().trim().min(1, "Indica la razón social").max(300),
  tradeName: optionalText(300),
  address: z.string().trim().min(1, "Indica la dirección").max(300),
});

export const establishmentSchema = z.object({
  organizationId: z.uuid("Empresa inválida"),
  code: z.string().trim().regex(/^\d{3}$/, "El código debe tener 3 dígitos (p. ej. 001)"),
  name: z.string().trim().min(1, "Indica el nombre").max(200),
  address: z.string().trim().min(1, "Indica la dirección").max(300),
});

export const emissionPointSchema = z.object({
  organizationId: z.uuid("Empresa inválida"),
  establishmentId: z.uuid("Establecimiento inválido"),
  code: z.string().trim().regex(/^\d{3}$/, "El código debe tener 3 dígitos (p. ej. 001)"),
});

export const ORG_ROLES = ["organization_admin", "billing_user", "viewer"] as const;
export const ROLE_LABEL: Record<(typeof ORG_ROLES)[number], string> = {
  organization_admin: "Administrador",
  billing_user: "Facturación",
  viewer: "Solo lectura",
};

export const addMemberSchema = z.object({
  organizationId: z.uuid("Empresa inválida"),
  email: z.string().trim().toLowerCase().pipe(z.email("Correo inválido")).pipe(z.string().max(254)),
  role: z.enum(ORG_ROLES),
});

const optionalRef = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9._:/-]{1,200}$/, "Solo letras, números y . _ : / - (una referencia, nunca una contraseña ni un archivo)")
    .optional(),
);

/**
 * Configuración del proveedor por empresa y ambiente. Solo REFERENCIAS. Producción exige un
 * proveedor real y una confirmación explícita: emite facturas con validez tributaria.
 */
export const providerConfigSchema = z
  .object({
    organizationId: z.uuid("Empresa inválida"),
    environment: z.enum(["test", "production"]),
    provider: z.enum(["mock", "factuplan"]),
    providerCompanyRef: optionalRef,
    certificateRef: optionalRef,
    certificateExpiresAt: z.preprocess((v) => (v === "" ? undefined : v), z.iso.date("Fecha inválida").optional()),
    confirmProduction: z.preprocess((v) => v === "on", z.boolean()),
  })
  .superRefine((value, ctx) => {
    if (value.environment !== "production") return;
    if (value.provider === "mock") {
      ctx.addIssue({ code: "custom", path: ["provider"], message: "Producción no puede usar el proveedor simulado (mock)." });
    }
    if (!value.confirmProduction) {
      ctx.addIssue({
        code: "custom",
        path: ["confirmProduction"],
        message: "Marca la confirmación: producción emite facturas con validez tributaria.",
      });
    }
  });
