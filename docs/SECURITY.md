# Seguridad

## Secretos
- Nunca en Git: `.env*` (salvo `.env.example`), `*.p12`, `*.pfx`, `*.pem`, `*.key` están en `.gitignore`.
- Variables separadas por ambiente: `FACTUPLAN_API_KEY_TEST`, `FACTUPLAN_API_KEY_LIVE`, `FACTUPLAN_WEBHOOK_SECRET`. En Vercel se definen como variables de entorno por entorno (Preview/Production), no en código.
- `SUPABASE_SERVICE_ROLE_KEY` solo en servidor; `admin.ts` importa `server-only`.

## Autenticación y autorización
- Panel: Supabase Auth (email/contraseña, auto-registro deshabilitado). El proxy hace comprobación optimista; cada página valida con `getUser()` y RLS.
- API: `Authorization: Bearer nb_<test|live>_<43 caracteres base64url>` (256 bits). Se guarda solo SHA-256 (`api_keys.key_hash`); la clave completa se muestra una única vez. Cada key está ligada a organización, aplicación, ambiente y permisos, con `last_used_at` y revocación.
- Una key `test` solo opera sobre el ambiente de pruebas de su empresa; una `live` sobre producción.

## Aislamiento entre empresas
RLS en todas las tablas + FK compuestas `(id, organization_id)` + filtrado explícito en el backend con service role. Ver `docs/DATABASE.md`.

## Auditoría y logs
- `billing_events` es append-only y registra actor (usuario/API key/proveedor/sistema), aplicación origen, resultado y cambios de estado.
- Todo payload/response pasa por `redactSecrets()` (`src/lib/security/sanitize.ts`) antes de persistirse o loguearse. Nunca se registran API keys completas, contraseñas ni material de certificados.

## Webhooks
Verificar la firma sobre el cuerpo crudo con comparación en tiempo constante, rechazar si no hay secreto configurado, y deduplicar por `(provider, event_id)`. Guardar el historial en `webhook_events`.

## Cabeceras HTTP
Configuradas en `next.config.ts`: `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, HSTS. **Pendiente:** Content-Security-Policy con nonces (ver guía de CSP de Next.js) antes de producción.

## Rate limiting
`/api/v1/*`: 120 peticiones/min por API key (`src/lib/api/rate-limit.ts`, ventana fija **en memoria**). Limitación conocida: en serverless cada instancia cuenta por separado, así que es protección de mejor esfuerzo. **Pendiente (Fase 4):** almacén compartido (Upstash/Vercel KV), límite por IP para intentos con claves inválidas y límite en `/api/webhooks/*`.

## API pública (`/api/v1`)
- Autenticación en `src/lib/api/auth.ts`: hash SHA-256 → fila de `api_keys` + organización; exige clave `active`, ambiente coherente con el prefijo (`nb_test_`↔`test`, `nb_live_`↔`production`), empresa `active` y *scope* (`invoices:read` / `invoices:write`). Todo fallo de identidad responde el mismo `401` genérico.
- La empresa y el ambiente salen **solo** de la key; el cuerpo no puede indicarlos (validación estricta: campos desconocidos → 422).
- Cuerpo máximo 256 KB; errores inesperados → `500` genérico (el detalle se registra sanitizado, sin cuerpo ni cabeceras).
- Producción exige proveedor configurado explícitamente en `organization_provider_configs`; sin él, `409`. Las pruebas usan `mock`.
- Gestión de claves en el panel (`/api-keys`): crear/revocar solo `organization_admin` o admin de plataforma; la clave completa se muestra una vez y solo se persiste el hash.

## Certificados de firma electrónica (CRÍTICO)

Cada empresa usa **su propio** certificado; nunca uno global. Estrategia propuesta (a validar antes de implementar):

| Opción | Descripción | Recomendación |
|---|---|---|
| **A. Custodia del proveedor** | La empresa carga el P12 directamente en Factuplan (o lo hacemos con un flujo directo navegador→proveedor). Nixgo guarda solo `certificate_ref` y fecha de expiración. | **Fase 0–3.** Nixgo nunca toca el P12 ni su clave. |
| B. Custodia propia | P12 y contraseña cifrados con KMS/Vault gestionado (envelope encryption), descifrado solo en memoria al firmar. | Solo si se integra el SRI directamente (Fase 5+). Requiere diseño propio y revisión. |

Reglas comunes: sin criptografía artesanal (usar KMS/Supabase Vault/librerías estándar), nunca en Git, frontend ni localStorage, nunca en logs, contraseña separada del archivo, y rotación/expiración monitorizada (`certificate_expires_at`).

**Pendiente de confirmar con Factuplan:** si permite carga de certificado vía API o solo desde su panel, y cómo se asocia un certificado a cada RUC (ver `docs/FACTUPLAN.md`).
