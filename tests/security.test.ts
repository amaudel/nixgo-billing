import { describe, expect, it } from "vitest";
import {
  generateApiKey,
  hashApiKey,
  isWellFormedApiKey,
  parseBearerApiKey,
} from "../src/lib/security/api-keys";
import { redactSecrets } from "../src/lib/security/sanitize";

describe("api keys", () => {
  it("genera claves con el formato nb_<env>_<secreto> y hash determinista", () => {
    const a = generateApiKey("test");
    const b = generateApiKey("live");
    expect(a.key).toMatch(/^nb_test_/);
    expect(b.key).toMatch(/^nb_live_/);
    expect(a.key).not.toBe(generateApiKey("test").key);
    expect(a.hash).toBe(hashApiKey(a.key));
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.key.startsWith(a.prefix)).toBe(true);
    expect(isWellFormedApiKey(a.key)).toBe(true);
  });

  it("no contiene la clave completa en el hash ni en el prefijo", () => {
    const { key, hash, prefix } = generateApiKey("live");
    expect(hash).not.toContain(key);
    expect(prefix.length).toBeLessThan(key.length);
  });

  it("parsea solo cabeceras Bearer con una clave bien formada", () => {
    const { key } = generateApiKey("test");
    expect(parseBearerApiKey(`Bearer ${key}`)).toBe(key);
    expect(parseBearerApiKey(`bearer ${key}`)).toBe(key);
    expect(parseBearerApiKey("Bearer abc")).toBeNull();
    expect(parseBearerApiKey(key)).toBeNull();
    expect(parseBearerApiKey(null)).toBeNull();
  });
});

describe("redactSecrets", () => {
  it("oculta claves sensibles a cualquier profundidad", () => {
    const out = redactSecrets({
      ruc: "1790000000001",
      password: "x",
      nested: { certificatePassword: "y", apiKey: "z", list: [{ token: "t" }] },
      authorization: "Bearer abc",
    });
    expect(out).toEqual({
      ruc: "1790000000001",
      password: "[REDACTED]",
      nested: { certificatePassword: "[REDACTED]", apiKey: "[REDACTED]", list: [{ token: "[REDACTED]" }] },
      authorization: "[REDACTED]",
    });
  });

  it("oculta API keys de Nixgo incrustadas en textos", () => {
    const { key } = generateApiKey("live");
    expect(redactSecrets({ note: `usa ${key} ahora` })).toEqual({ note: "usa [REDACTED] ahora" });
  });

  it("no confunde 'passport' con una contraseña", () => {
    expect(redactSecrets({ identificationType: "passport" })).toEqual({ identificationType: "passport" });
  });
});
