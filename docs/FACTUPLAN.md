# Integración con Factuplan

> **Estado: DOCUMENTADO PARCIALMENTE (2026-10-05). `FactuplanProvider` sigue siendo un stub.**
>
> **Procedencia:** este contenido proviene de un informe de investigación sobre material oficial de Factuplan
> (referencia REST `factuplan.com.ec/docs/api`, colección Postman oficial, SDK/guías, política de privacidad y
> centro de ayuda), entregado por el equipo. **Nixgo no ha verificado cada dato directamente** (el sitio devolvió
> 403 a consultas automáticas). Antes de implementar, contrastar con la colección Postman / OpenAPI descargada.
>
> **Fuente canónica elegida:** referencia actual `factuplan.com.ec/docs/api` + su colección Postman.
> No usar `docs.factuplan.com.ec` (portal antiguo, contrato distinto) ni los ejemplos de la landing `/api`
> (usan `api.factuplan.com.ec`) mientras Factuplan no confirme su vigencia.

## Resumen

| Tema | Dato | Confianza |
|---|---|---|
| Base URL | `https://api-rest.factuplan.com.ec`, endpoints bajo `/v1/developer/*`. Test y live comparten URL; la key decide el ambiente | oficial |
| Autenticación | `X-API-Key` + `x-taxpayer-ruc` + `Content-Type: application/json`. La key es del **workspace**, no por RUC | oficial |
| Ambientes | `ak_test_*` (sandbox) / `ak_live_*` (producción) | oficial |
| Sandbox | Simulación interna completa (firma, SRI, RIDE, webhooks); **no** toca el SRI real; no requiere P12 real; comprobantes se borran cada hora | oficial |
| Multi-RUC | Soportado (SaaS multi-tenant). El RUC emisor va en `x-taxpayer-ruc` en cada operación | oficial |
| Certificado P12 | Subida por API; Factuplan extrae RUC y puede crear/vincular el contribuyente | oficial |
| Crear factura | `POST /v1/developer/invoices`; Factuplan genera XML, firma, envía al SRI y genera RIDE | oficial |
| Clave de acceso / secuencial | Los calcula y controla Factuplan (clave de 49 dígitos) | oficial |
| Consultar | `GET /v1/developer/receipts/{id}` y `/receipts/{id}/status` | oficial |
| Nota de crédito | `POST /v1/developer/credit-notes` | oficial |
| XML / RIDE | JSON con URLs, no binario | oficial |
| Webhooks | HTTPS, HMAC SHA-256 sobre cuerpo crudo, cabecera `x-factuplan-signature` | oficial |
| Idempotencia | Existe, pero el nombre del header REST está **en conflicto** entre fuentes | **no confirmado** |
| Estados | Enum completo inconsistente entre fuentes | **no confirmado** |
| Límites | 100 req/s por API key + cuota mensual del plan; tamaños máximos no publicados | oficial / no encontrado |
| Soporte | `info@factuplan.com.ec`; ventas `ventas@factuplan.com.ec` | oficial |

## Detalle

### Autenticación y claves
```
X-API-Key: ak_test_xxxxx
x-taxpayer-ruc: 0999999999001
Content-Type: application/json
```
- Las keys se crean en Dashboard → Developer → Create API key y se muestran una sola vez.
- Rotación: se recomienda revocar/regenerar desde el dashboard ante filtración. **No documentado** un mecanismo de rotación con coexistencia de dos keys.
- La key vive solo en secrets del servidor (Vercel); nunca en el navegador ni en Git.

### Multi-RUC
Una cuenta/workspace de Factuplan para todo Nixgo; `organization_id` → RUC → `x-taxpayer-ruc`.
Al subir un certificado de un RUC nuevo, y si el plan lo permite, Factuplan crea el contribuyente y lo vincula a la key.

### Certificados
- `POST /v1/developer/certificate` (`multipart/form-data`: `file` .p12/.pfx, `password`).
- Respuesta: `hasCertificate`, `isExpired`, `daysUntilExpiry`, `ruc`, `legalName`, `expiresAt`.
- Estado: `GET /v1/developer/certificate/status` (con `x-taxpayer-ruc`).
- Custodia declarada: AES-256-GCM, clave derivada por tenant (HKDF-SHA256 con RUC + salt), descifrado en memoria al firmar, contraseña no guardada en texto plano.
- Avisos por email de vencimiento a 30, 15 y 5 días.
- Encaja con la **estrategia A** de `docs/SECURITY.md` (el proveedor custodia el certificado). Nixgo solo guarda referencias (`certificate_ref`, `certificate_expires_at`), nunca el P12 ni su contraseña.

### Crear factura
`POST /v1/developer/invoices`. Ejemplo mínimo oficial:
```json
{
  "customer": { "identificationType": "RUC", "identification": "0993378150001",
                "legalName": "Empresa Demo S.A.", "email": "facturas@empresademo.ec" },
  "items": [{ "code": "SERV-001", "description": "Servicio de consultoría",
              "quantity": 1, "unitPrice": 150, "taxType": "IVA_RATE", "tax": 15 }],
  "payments": [{ "method": "20", "amount": 172.5 }]
}
```
- También admite `customerId`, dirección, teléfono, `productId`, código auxiliar, descuento, `saveToProducts`, `emissionPointId`, establecimiento/punto de emisión, `additionalInfo`, `sendEmail`, plazo/unidad del pago.
- `taxType`: `IVA_0`, `IVA_RATE`, `NOT_TAXABLE`, `EXEMPT`. Tarifas documentadas para `IVA_RATE`: 0, 5, 8, 12, 14, 15. *(Validar contra la ficha técnica vigente del SRI antes de producción; no asumir reglas fiscales.)*
- Respuesta: `{ "data": { "id": "rcpt_…", "accessKey": "…", "sequential": "000000001", "status": "PROCESSING", "total": 172.5, "source": "API" } }`.
- `PATCH /v1/developer/invoices/sequential` fija el próximo número.

### Consultar
- `GET /v1/developer/receipts/{id}` (detalle) y `GET /v1/developer/receipts/{id}/status`.
- Estados citados en `/status`: `PROCESSING`, `AUTHORIZED`, `COMPLETED`, `ERROR`, `REJECTED`. Otras fuentes mencionan además `VOIDED`, `DRAFT`, `PENDING` y estados SRI `PPR`, `AUT`, `REJECTED`, `RETURNED`.
- Ejemplo: `{ "data": { "status": "AUTHORIZED", "authorizationNumber": "…", "messages": [] } }`.

### Nota de crédito
`POST /v1/developer/credit-notes` con `invoiceAccessKey` (49 dígitos), `reason`, `items`; opcionales `emissionPointId`, `payments`, `additionalInfo`. Si la factura no existe en Factuplan, la plataforma puede importarla desde el SRI.

### RIDE y XML
- `GET /v1/developer/receipts/{id}/xml` y `/pdf` → `{ "data": { "url": "…?sig=…", "previewUrl": "…/preview/…" } }`.
- `url` firmada **caduca en 5 minutos**; `previewUrl` es permanente.
- Nixgo las sirve detrás de su propio backend (`/api/v1/invoices/:id/xml|ride`); las apps nunca ven URLs ni credenciales del proveedor.

### Webhooks
- Se configuran en Dashboard → Developer → Webhooks (URL HTTPS + secret).
- Eventos: `invoice.authorized`, `invoice.rejected`, `credit_note.authorized`, `waybill.authorized`, `withholding.authorized` (y sus `rejected`).
- Firma: cabecera `x-factuplan-signature` = HMAC-SHA256 del **cuerpo crudo** con el webhook secret; comparar en tiempo constante.
- Leer el cuerpo antes de parsearlo; responder `200` en < 5 s.
- Forma conceptual: `{ "type": "invoice.authorized", "data": { "accessKey": "…" } }`; en rechazo, `data.sriError`.
- Reintentos con backoff exponencial (detalle no publicado). Changelog menciona protección anti-replay con timestamp (cabecera/formato/tolerancia no publicados).

### Errores
```json
{ "statusCode": 422, "message": "…", "code": "INVOICE_4002", "details": ["…"] }
```
- HTTP: 400 validación · 401 key inválida · 403 permisos/plan · 404 · 422 regla de negocio o rechazo SRI · 429 límite/cuota · 500 interno.
- Códigos vistos: `AUTH_ERROR`, `RATE_LIMIT`, `API_10001`, `API_10002`, `INVOICE_4002`, `INVOICE_4003`, `CERT_3008`, `CUSTOMER_7004`, `PRODUCT_6002`, `GENERAL_0003`.
- Rechazos SRI traen `sriCode` / `sriMessage` (el SDK los distingue con `FactuplanSRIError`).
- Recomendado: backoff 500 ms, 1 s, 2 s, 4 s… para 429 y 500. **No existe** matriz oficial código → reintentable.

### Límites
- 100 peticiones/s por API key + cuota mensual de documentos según plan.
- 429 con `GENERAL_0003` (velocidad) o `API_10002` (cuota mensual). Cabeceras `X-RateLimit-Limit/Remaining/Reset`.
- Tamaños máximos (JSON, P12, ítems, `additionalInfo`, webhook): **no publicados**. No fijar números inventados.

## Pendiente de confirmar con Factuplan (info@factuplan.com.ec)

Bloquean pasar a producción; los dos primeros bloquean escribir código:

1. **Header REST de idempotencia:** `X-Idempotency-Key` (landing) vs `Idempotency-Key` (guía PHP); la colección Postman no incluye ninguno. *No implementar por intuición.*
2. **Enum completo de estados** de Receipt (`DRAFT`, `PENDING`, `PROCESSING`, `AUTHORIZED`, `COMPLETED`, `ERROR`, `REJECTED`, `VOIDED`).
3. ¿`api-rest.factuplan.com.ec` es la URL canónica y `api.factuplan.com.ec` queda obsoleta o es alias?
4. ¿Hay endpoint REST para buscar una factura por idempotency key (el SDK sí)?
5. Schema JSON completo y versionado de los webhooks.
6. Mecanismo anti-replay del webhook (cabecera, formato, tolerancia).
7. Número de reintentos de webhook y duración total.
8. Rotación de API keys: ¿pueden coexistir dos keys live?
9. Límites de payload, ítems y tamaño de P12/PFX.
10. ¿Límites específicos de sandbox?
11. Plan/contrato recomendado para decenas o cientos de RUC en un workspace.
12. ¿Hay OpenAPI/Swagger descargable para generar tipos y usarlo como contrato en CI?

## Decisiones de diseño derivadas (a confirmar antes de implementar)

- **Secuencial:** Factuplan es la fuente de verdad (calcula secuencial y clave de acceso). Para facturas vía Factuplan, Nixgo guarda los valores devueltos y **no** debe generar el suyo con `next_sequential()`; esa función queda para el proveedor `mock` o para un futuro proveedor que no lo controle. Pendiente decidir cómo conviven en `invoices.sequential` / `access_key`.
- **Estados:** guardar por separado el estado del proveedor y el del SRI (`provider_status` / `sri_status`) y mapear al `invoice_status` de Nixgo; falta una migración nueva cuando el enum esté confirmado.
- **Idempotencia propia:** mantener `unique (organization_id, idempotency_key)` en Nixgo con independencia de lo que haga Factuplan; propagar la clave a Factuplan solo cuando se confirme el header.
- **Referencias por empresa:** `provider_company_ref` = RUC (valor de `x-taxpayer-ruc`); una sola API key de workspace por ambiente en variables de entorno.
- **Sin facturas reales** hasta indicación expresa: desarrollar solo con `ak_test_*`.

## Variables de entorno (reservadas en `.env.example`)

```
FACTUPLAN_API_KEY_TEST=
FACTUPLAN_API_KEY_LIVE=
FACTUPLAN_WEBHOOK_SECRET=
```
Posible nueva variable al implementar: `FACTUPLAN_BASE_URL` (por defecto `https://api-rest.factuplan.com.ec`).

## Mapeo previsto a `BillingProvider`

| Método | Endpoint / notas |
|---|---|
| `createInvoice` | `POST /v1/developer/invoices`; propagar idempotencia solo tras confirmar header |
| `getInvoice` | `GET /receipts/{id}` y `/status`; reconciliación si se pierde un webhook |
| `createCreditNote` | `POST /v1/developer/credit-notes` (por `invoiceAccessKey`) |
| `getRide` / `getXml` | `GET /receipts/{id}/pdf` y `/xml`; descargar la URL firmada (5 min) y servirla desde Nixgo |
| `verifyWebhook` | HMAC-SHA256 del cuerpo crudo con `FACTUPLAN_WEBHOOK_SECRET`; rechazar si falta secreto o firma. Debe devolver `VerifiedWebhook` (`eventId`, `eventType`, `providerDocumentId` = `data.id`/id del receipt, `status` mapeado a `InvoiceStatus`, `result` con `accessKey`/`authorizationNumber`/`authorizedAt`/`rejectionReason` desde `data.sriError`). El receptor genérico (`src/lib/webhooks/service.ts`) ya valida y procesa idempotentemente; faltan el esquema y el `event_id` reales (pendientes 5–7 de la lista). |

Hasta que los puntos 1 y 2 estén resueltos, el desarrollo usa `MockBillingProvider` (`BILLING_PROVIDER=mock`).
