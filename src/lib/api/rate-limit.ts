/**
 * Límite de peticiones por API key, ventana fija en memoria.
 * LIMITACIÓN CONOCIDA: es por instancia (en serverless cada instancia cuenta aparte), por lo que
 * es una protección de mejor esfuerzo, no un límite global exacto. Para un límite estricto habrá
 * que moverlo a un almacén compartido (Fase 4).
 */
export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Segundos hasta que se reinicia la ventana. */
  retryAfter: number;
}

export class RateLimiter {
  private readonly windows = new Map<string, { start: number; count: number }>();

  constructor(
    private readonly limit = 120,
    private readonly windowMs = 60_000,
    private readonly maxKeys = 10_000,
  ) {}

  check(key: string, now = Date.now()): RateLimitResult {
    let entry = this.windows.get(key);
    if (!entry || now - entry.start >= this.windowMs) {
      if (this.windows.size >= this.maxKeys) this.prune(now);
      entry = { start: now, count: 0 };
      this.windows.set(key, entry);
    }
    entry.count += 1;
    const retryAfter = Math.max(1, Math.ceil((entry.start + this.windowMs - now) / 1000));
    return {
      allowed: entry.count <= this.limit,
      limit: this.limit,
      remaining: Math.max(0, this.limit - entry.count),
      retryAfter,
    };
  }

  private prune(now: number) {
    for (const [key, entry] of this.windows) {
      if (now - entry.start >= this.windowMs) this.windows.delete(key);
    }
    // Si sigue lleno (muchas claves activas), se descarta lo más antiguo para acotar memoria.
    if (this.windows.size >= this.maxKeys) {
      const oldest = this.windows.keys().next().value;
      if (oldest !== undefined) this.windows.delete(oldest);
    }
  }
}

export const apiRateLimiter = new RateLimiter();
