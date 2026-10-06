import type { ProviderFile } from "@/lib/billing/providers/types";

export type FileKind = "ride" | "xml";

const CONTENT_TYPE: Record<FileKind, string> = { ride: "application/pdf", xml: "application/xml" };

/**
 * Respuesta de descarga. El tipo de contenido y el nombre los fija Nixgo, nunca el proveedor:
 * un proveedor no puede servir `text/html` desde nuestro dominio ni inyectar cabeceras.
 */
export function fileResponse(file: ProviderFile, number: string | null, kind: FileKind, headers: Record<string, string> = {}) {
  const base = (number ?? "factura").replace(/[^0-9A-Za-z-]/g, "") || "factura";
  const body = typeof file.body === "string" ? file.body : new Uint8Array(file.body).buffer;
  return new Response(body, {
    headers: {
      ...headers,
      "Content-Type": CONTENT_TYPE[kind],
      "Content-Disposition": `attachment; filename="${base}.${kind === "ride" ? "pdf" : "xml"}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
