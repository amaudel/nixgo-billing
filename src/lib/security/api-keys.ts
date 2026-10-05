import { createHash, randomBytes } from "node:crypto";

export type ApiKeyEnvironment = "test" | "live";

const KEY_PATTERN = /^nb_(test|live)_[A-Za-z0-9_-]{43}$/;

export interface GeneratedApiKey {
  /** Clave completa: mostrarla UNA sola vez y no guardarla. */
  key: string;
  /** Prefijo no secreto para identificarla en la UI (p. ej. nb_test_ab12cd34). */
  prefix: string;
  /** SHA-256 hex: lo único que se persiste. */
  hash: string;
}

/**
 * Las claves son aleatorias de 256 bits, por lo que un hash rápido (SHA-256) es
 * adecuado; no se usa bcrypt/argon2, que son para contraseñas de baja entropía.
 */
export function generateApiKey(environment: ApiKeyEnvironment): GeneratedApiKey {
  const secret = randomBytes(32).toString("base64url"); // 43 caracteres
  const key = `nb_${environment}_${secret}`;
  return { key, prefix: key.slice(0, 16), hash: hashApiKey(key) };
}

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function isWellFormedApiKey(key: string): boolean {
  return KEY_PATTERN.test(key);
}

/** Extrae la clave de "Authorization: Bearer nb_xxx". */
export function parseBearerApiKey(header: string | null): string | null {
  const match = header?.match(/^Bearer\s+(\S+)$/i);
  const key = match?.[1];
  return key && isWellFormedApiKey(key) ? key : null;
}
