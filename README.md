# Nixgo Billing

Plataforma SaaS multiempresa de facturación electrónica para Ecuador. Es el servicio central de facturación de mis aplicaciones web (NidoCerca, restaurantes, inventario, veterinarias, etc.).

```
Aplicación cliente → Nixgo Billing API → Provider Adapter → Factuplan → SRI
```

Las apps cliente solo conocen Nixgo Billing; nunca llaman a Factuplan ni conocen el SRI ni los certificados. El proveedor se puede sustituir (Security Data, integración directa con el SRI…) sin tocar a los consumidores.

**Estado: Fase 0 (fundación).** No emite facturas reales: el proveedor activo por defecto es `mock` y `FactuplanProvider` es un stub. Ver [docs/ROADMAP.md](docs/ROADMAP.md).

## Stack

Next.js 16 (App Router) · TypeScript estricto · Tailwind CSS 4 · Supabase (Postgres + Auth + RLS) · Zod · Vitest · Vercel.

## Requisitos

- Node.js 20.19+ (probado con 24)
- Docker Desktop (para Supabase local)
- Supabase CLI (`npm i -g supabase`)

## Puesta en marcha local

```bash
npm install
supabase start                 # levanta Postgres/Auth locales y aplica supabase/migrations
cp .env.example .env.local     # completar con las claves que imprime `supabase start`
npm run dev                    # http://localhost:3000
```

Variables mínimas en `.env.local`: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`. Las de Factuplan se dejan vacías hasta la Fase 3.

Auto-registro deshabilitado: crea el primer usuario en Supabase Studio (Authentication → Users) y conviértelo en administrador de plataforma — ver [docs/DATABASE.md](docs/DATABASE.md#bootstrap).

## Scripts

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo |
| `npm run build` | Build de producción |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm test` | Vitest |
| `npm run check` | typecheck + lint + tests |

## Documentación

- [ARCHITECTURE.md](docs/ARCHITECTURE.md) · [DATABASE.md](docs/DATABASE.md) · [SECURITY.md](docs/SECURITY.md)
- [FACTUPLAN.md](docs/FACTUPLAN.md) · [INTEGRATION.md](docs/INTEGRATION.md) · [ROADMAP.md](docs/ROADMAP.md)
- Reglas permanentes del proyecto: [CLAUDE.md](CLAUDE.md)

## Seguridad

Nunca se versionan API keys, certificados P12/PFX, contraseñas ni `.env*` (salvo `.env.example`). Ver [docs/SECURITY.md](docs/SECURITY.md).
