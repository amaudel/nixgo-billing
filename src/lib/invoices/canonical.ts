import { createHash } from "node:crypto";

/** JSON con claves ordenadas: el mismo contenido produce siempre la misma cadena. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Huella del cuerpo YA validado: detecta la misma Idempotency-Key con otro contenido. */
export function hashRequest(body: unknown): string {
  return createHash("sha256").update(canonicalJson(body)).digest("hex");
}
