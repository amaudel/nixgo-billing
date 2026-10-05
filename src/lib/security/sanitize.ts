const SENSITIVE_KEY = /(password|passwd|secret|token|api[-_]?key|authorization|cookie|p12|pfx|certificate|private[-_]?key|signature)/i;
const API_KEY_VALUE = /nb_(test|live)_[A-Za-z0-9_-]{10,}/g;
const REDACTED = "[REDACTED]";

/**
 * Copia profunda con secretos reemplazados. Obligatoria antes de guardar cualquier
 * payload/response en billing_events o webhook_events, o de escribirlo en logs.
 */
export function redactSecrets(value: unknown, depth = 0): unknown {
  if (depth > 12) return REDACTED;
  if (typeof value === "string") return value.replace(API_KEY_VALUE, REDACTED);
  if (Array.isArray(value)) return value.map((v) => redactSecrets(v, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        SENSITIVE_KEY.test(k) ? REDACTED : redactSecrets(v, depth + 1),
      ]),
    );
  }
  return value;
}
