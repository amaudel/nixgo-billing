@AGENTS.md

# Nixgo Billing — reglas permanentes

Servicio de facturación electrónica multiempresa para Ecuador. Lee `docs/ARCHITECTURE.md` antes de cambios estructurales.

## Arquitectura
- **API-first y multi-tenant.** Toda tabla de negocio lleva `organization_id`; los hijos usan FK compuesta `(id, organization_id)`.
- **No acoplar el negocio a Factuplan.** Solo `src/lib/billing/providers/` conoce a un proveedor. El resto usa la interfaz `BillingProvider` y `getBillingProvider()`.
- Las apps consumidoras nunca llaman a Factuplan; se autentican con API keys de Nixgo (`nb_test_…` / `nb_live_…`).
- Lógica específica de Ecuador/SRI vive en `src/lib/tax/ecuador/`, separada del dominio general. No asumir reglas fiscales: se implementan solo con la especificación vigente.
- No inventar endpoints de Factuplan: primero documentarlos en `docs/FACTUPLAN.md` desde la documentación oficial.

## Seguridad (innegociable)
- **RLS obligatorio** en toda tabla nueva, con privilegios mínimos (`revoke` a anon/authenticated y `grant` explícito). Denegar por defecto.
- El cliente `service role` (`src/lib/supabase/admin.ts`) salta RLS: solo en rutas server-to-server y siempre filtrando por `organization_id` ya resuelto.
- Nunca exponer ni registrar secretos: API keys completas, contraseñas, P12/PFX, tokens. Pasar todo payload a `redactSecrets()` antes de guardarlo o loguearlo.
- API keys: solo se guarda el hash SHA-256; la clave completa se muestra una vez.
- Certificados: por empresa, nunca globales, nunca en Git/frontend/localStorage. Sin criptografía artesanal; la estrategia se documenta en `docs/SECURITY.md` antes de implementarla.
- Validar toda entrada en backend con Zod. Webhooks: verificar firma sobre el cuerpo crudo y procesar de forma idempotente.

## Código
- TypeScript estricto; sin `any` salvo justificación. Validación con Zod en los bordes.
- Migraciones versionadas en `supabase/migrations/` (nunca editar una ya aplicada; crear una nueva).
- No modificar producción sin pruebas. Trabajar con `mock`/sandbox; no emitir facturas reales hasta indicación expresa.
- Antes de dar algo por terminado: `npm run check`.
- Commits pequeños y descriptivos.
- Next.js 16: `middleware` ahora es `proxy` (`src/proxy.ts`). Consultar `node_modules/next/dist/docs/` ante dudas.

## Documentación
Actualizar `docs/` y este archivo cuando cambie la arquitectura, el modelo de datos o la seguridad.
