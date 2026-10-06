# Integración con Factuplan

> **Estado: documentado y parcialmente verificado (2026-10-06). `FactuplanProvider` sigue siendo un stub** (responde 501).
> La Fase 3 empieza cuando se decidan los puntos de la sección [Decisiones pendientes](#decisiones-pendientes-antes-de-implementar) y se pruebe contra un sandbox real.

## Cómo se verificó cada dato

| Marca | Significa |
|---|---|
| **[SDK]** | Leído por Claude en el **código fuente del SDK oficial** `factuplan@0.21.0` (paquete `factuplan` en npm, "Official Factuplan SDK", licencia MIT) el 2026-10-06. Es la fuente más fiable de que se dispone: son nombres de endpoints, cabeceras y tipos reales. |
| **[Informe]** | Lo dicen los informes de investigación que se nos entregaron (sin enlaces verificables). Tratar como hipótesis hasta probarlo en sandbox. |
| **[Abierto]** | Sin evidencia oficial. Hay que probarlo en sandbox o preguntarlo a Factuplan. |

> Los informes se contradijeron entre sí. El segundo, que cita el código del SDK, tenía razón en la firma de webhooks; el primero se equivocó (ver correcciones abajo). El SDK **no** es una especificación completa de la API (no cubre, por ejemplo, el comportamiento ante errores ni la semántica de campos), pero sí fija lo que enumera.

## Correcciones a la versión anterior de este documento

1. **Firma de webhooks (error grave, ya corregido):** no es `HMAC(secreto, cuerpo)`. Es `HMAC(secreto, "{t}.{cuerpo}")` con cabecera `t=…,v1=…` y tolerancia de 300 s. Una verificación basada en la versión anterior habría **rechazado todos los webhooks reales**. [SDK]
2. **Idempotencia:** la versión anterior decía que el SDK la soportaba. **Falso**: el SDK no envía ninguna cabecera de idempotencia (solo `x-api-key`, `x-taxpayer-ruc`, `Accept` y `Content-Type`) y tampoco reintenta. [SDK]
3. **Forma del webhook:** no es `{type, data:{accessKey}}`; ver más abajo. [SDK]
4. **Estados:** faltaban `RECEIVED_SRI` y `RETURNED`. [SDK]

## Contrato verificado [SDK]

### Conexión
- Base: `https://api-rest.factuplan.com.ec/v1` (valor por defecto del SDK). Las rutas de abajo van bajo `/v1`.
- Cabeceras: `x-api-key: <ak_test_… | ak_live_…>`, `x-taxpayer-ruc: <RUC de 13 dígitos>` (selecciona la empresa), `Accept: application/json`, `Content-Type: application/json`.
- Timeout por defecto del SDK: 30 s. El SDK no reintenta nada.
- Respuesta correcta: JSON con `data` (y `meta` si es listado paginado) o sin envoltura. 204 = sin contenido.
- Error: el SDK lee `json.error ?? json` con `message`, `code` y `details`. 401 → autenticación; 429 → límite de peticiones; el resto, error genérico con `statusCode`, `code`, `details`.

### Endpoints
| Método y ruta | Uso |
|---|---|
| `POST /developer/invoices` | Crear factura (Factuplan genera XML, firma, envía al SRI y genera el RIDE) |
| `GET /developer/invoices` | Listar (filtros: `ruc` del cliente, `status`, `dateFrom`, `dateTo`, `page`, `limit` ≤ 100) |
| `GET /developer/receipts/{id}` | Detalle |
| `GET /developer/receipts/{id}/status` | Estado: `{ id, status, accessKey?, authorizationNumber?, authorizationDate? }` |
| `GET /developer/receipts/{id}/xml` · `/pdf` | `{ url, previewUrl? }`: `url` es una URL prefirmada de S3 que **expira en 5 minutos**; `previewUrl` es permanente |
| `POST /developer/receipts/{id}/void` | Anular (`{ reason }`) |
| `POST /developer/invoices/{id}/retry` | Reintentar el flujo de un comprobante que no llegó a autorizarse |
| `PATCH /developer/invoices/sequential` | `{ branchCode, emissionCode, invoiceSequential }`: fija el próximo secuencial |
| `POST /developer/credit-notes` | Nota de crédito (referencia la factura por `invoiceAccessKey`); `POST …/credit-notes/{id}/retry`; `PATCH …/credit-notes/sequential` |
| `POST /developer/certificate` (multipart `file`, `password`) | Subir P12; si el RUC del certificado no existe en el workspace y el plan lo permite, crea el contribuyente |
| `PUT /developer/certificate` (multipart `file`, `password`, `ruc`) | Reemplazar el P12 de un contribuyente existente |
| `GET /developer/certificate/status` | `{ hasCertificate, isExpired?, daysUntilExpiry?, ruc?, legalName?, expiresAt? }` |
| `GET /developer/taxpayers` · `POST …/link` · `POST …/unlink` | Contribuyentes vinculados a la API key |
| `GET /developer/usage` | Uso del plan |
| `POST /developer/invoices/import` | Importar una factura ya autorizada por el SRI (por clave de acceso) |

### Crear factura (`CreateInvoiceInput`)
```
establishment?  "001"        emissionPoint? "001"      emissionPointId? uuid
customer: { identificationType: "RUC"|"CEDULA"|"PASSPORT"|"FINAL_CONSUMER"|"EXTERIOR",
            identification, legalName, email?, address?, phone?, saveToContacts? }
items: [{ code, auxiliaryCode?, description, quantity, unitPrice, discount?,
          taxType?: "IVA_0"|"IVA_RATE"|"NOT_TAXABLE"|"EXEMPT",
          tax?: número (válidos 0, 5, 8, 12, 14, 15; por omisión 15) }]
payments?: [{ method, amount, term?, timeUnit?: "dias"|"meses"|"anios" }]
additionalInfo?: Record<string,string>     sendEmail? (por omisión true)     retenciones?: [...]
```
- Respuesta: `{ id, accessKey, sequential, status, total }`. La **clave de acceso y el secuencial los calcula Factuplan.**
- Correspondencia con Nixgo: `establishmentCode` → `establishment`, `emissionPointCode` → `emissionPoint`; tipos de identificación `ruc/cedula/passport/final_consumer/foreign_id` → `RUC/CEDULA/PASSPORT/FINAL_CONSUMER/EXTERIOR`.
- ⚠️ `sendEmail` es **true por omisión**: Nixgo debe enviarlo explícitamente (`false`) salvo que se quiera que Factuplan escriba al cliente final.
- ⚠️ La tarifa solo admite 0, 5, 8, 12, 14, 15. Una tarifa distinta debe rechazarse en el adaptador antes de enviar.

### Estados de un comprobante [SDK + README del SDK]
Aparecen: `DRAFT`, `PENDING`, `PROCESSING`, `RECEIVED_SRI` (enviado al SRI, falta confirmar la autorización), `AUTHORIZED`, `REJECTED`, `RETURNED`, `ERROR`, `VOIDED` y, según el README, "completo" (`COMPLETED`: autorizado y con RIDE generado). El campo `status` es un `string` libre en los tipos: **la lista no está garantizada como cerrada.**

Reglas de `retry` (README del SDK):
| Estado | Acción | Efecto |
|---|---|---|
| `ERROR`, `REJECTED`, `RETURNED` | `reprocess` | Regenera el XML y lo reenvía al SRI |
| `RECEIVED_SRI` | `authorize` | Vuelve a consultar la autorización |
| Autorizado sin PDF | `pdf` | Regenera solo el RIDE |

- ⚠️ En `REJECTED`/`RETURNED` el comprobante se regenera con una **clave de acceso nueva** y los mismos datos; si el rechazo fue por datos inválidos, vuelve a fallar y hay que emitir uno corregido.
- Un comprobante se descuenta del plan **una sola vez, al autorizarse**; reintentar no cobra dos veces. Completo, en proceso o anulado → el reintento da 400.
- ⚠️ Puede existir un estado "autorizado sin PDF": el RIDE puede no estar listo en cuanto llega `AUTHORIZED`.

### Webhooks [SDK]
- Cabecera `x-factuplan-signature` con formato `t=<segundos Unix>,v1=<hex>[,v1=<hex>…]` (puede haber varias firmas `v1`).
- Verificación: rechazar si falta secreto o cabecera; `|ahora − t| ≤ 300 s`; `esperado = hex( HMAC_SHA256(secreto, "{t}.{cuerpoCrudo}") )`; aceptar si alguna `v1` coincide, con comparación en tiempo constante.
- Cuerpo (`WebhookEvent`):
```json
{ "id": "…", "event": "…", "timestamp": "…",
  "data": { "receiptId": "…", "type": "…", "accessKey": "…", "authorizationNumber": "…",
            "documentNumber": "…", "total": "…", "customerName": "…", "customerIdentification": "…" },
  "webhookId": "…", "attempt": 1 }
```
- Nixgo deduplica por `id` (identificador del evento) y localiza la factura por `data.receiptId` = `id` del comprobante en Factuplan.
- El SDK ofrece `verifyReceipt(receiptId)` (`GET /receipts/{id}`) como "segunda capa": confirmar que el comprobante existe antes de actuar.

## Reportado, sin verificar [Informe]
- Nombres de evento: `invoice.authorized`, `invoice.rejected`, `invoice.error`, `credit_note.*`, `debit_note.*`, `withholding.*`, `waybill.*`, `purchase_settlement.*` y genéricos `receipt.authorized|rejected|error` (a veces llegan dos eventos por documento: el específico y el genérico). El SDK no los enumera.
- Cabeceras adicionales `X-Factuplan-Event`, `X-Factuplan-Delivery`, `X-Factuplan-Webhook-Id`: **no aparecen en el SDK**; no depender de ellas.
- Reintentos de webhooks: 7 reintentos (8 entregas) con retroceso 30 s, 1, 2, 4, 8, 16, 32 min (~1 h); solo 2xx cuenta como entregado; tras varias entregas fallidas seguidas **se desactiva el webhook** y se avisa por correo; no hay reenvío manual público.
- Límites: 100 peticiones/s por key (429, `GENERAL_0003`) y cuota mensual por plan (429, `API_10002`); el sandbox (`ak_test_*`) **no consume cuota**, borra los comprobantes **cada hora**, no envía al SRI real y no necesita un P12 real.
- Las keys se crean en el panel (Developer → Create API key, se muestran una vez), son del workspace, sin scopes ni expiración conocidos; no hay endpoints para gestionarlas.
- Formato de errores `{statusCode, message, code, details}` con códigos `INVOICE_xxxx`, `CERT_xxxx`, `AUTH_ERROR`, `GENERAL_0003`, `API_10002`, `CERT_3008`, …; rechazos del SRI con `sriCode`/`sriMessage`; sin catálogo público ni clasificación de reintentables.
- Soporte: info@factuplan.com.ec · ventas: ventas@factuplan.com.ec.

## Abierto [Abierto]
- **Idempotencia del `POST /invoices`**: no hay evidencia de que exista (el SDK no la usa). Probar en sandbox si algún header (`Idempotency-Key` / `X-Idempotency-Key`) evita duplicados. Mientras tanto, **asumir que NO existe**.
- Semántica de `discount` (¿monto o porcentaje por ítem?), decimales admitidos en `quantity`/`unitPrice`, formato de `payments.method` (¿códigos de la tabla de formas de pago del SRI?) y valores por omisión si no se envía `payments`.
- Límites de tamaño (JSON, ítems, `additionalInfo`, P12); límites propios del sandbox.
- Lista cerrada de estados y de eventos; esquema versionado de webhooks.
- Planes: cuántos RUC incluye cada uno y el costo de uno adicional.
- Rotación de keys: coexistencia de dos keys live.
- OpenAPI/Swagger descargable (el SDK y la colección Postman son lo más cercano).
- Cómo provocar un rechazo controlado en sandbox.

## Decisiones pendientes antes de implementar

1. **Duplicados por falta de idempotencia (el más importante).** Hoy Nixgo, si el proveedor falla (p. ej. *timeout* después de que Factuplan ya creó la factura), **reenvía** la factura al reintentar con la misma `Idempotency-Key`. Con Factuplan eso puede **emitir dos facturas al SRI** (un secuencial consumido y un comprobante real duplicado). Opciones: (a) no reenviar automáticamente si el resultado es incierto y resolverlo antes consultando `GET /invoices` (cliente + fecha + total) o `additionalInfo` con el id de Nixgo; (b) confirmar en sandbox que existe un header de idempotencia. Se decide tras probar (b).
2. **Secuencial y clave de acceso: Factuplan manda.** `next_sequential()` de Nixgo no debe usarse con este proveedor (el contador de Nixgo y el de Factuplan divergirían o chocarían con `unique (emission_point_id, sequential)`). Propuesta: reservar la factura sin secuencial y guardar el que devuelve Factuplan.
3. **Webhooks de documentos ajenos.** Si el workspace también emite por otros canales (el panel de Factuplan), llegarán eventos de comprobantes que Nixgo no conoce. Hoy un documento desconocido responde 404 → Factuplan reintenta y, según el informe, puede **desactivar el webhook**. Propuesta: 404 solo si el evento es reciente (posible carrera con nuestra propia creación); 200 "ignorado" si es antiguo, y ignorar siempre tipos que Nixgo no gestiona (notas de crédito, retenciones…).
4. **Correspondencia de estados (propuesta):** `PENDING`/`PROCESSING`/`RECEIVED_SRI` → `processing`; `AUTHORIZED`/`COMPLETED` → `authorized`; `REJECTED`/`RETURNED` → `rejected`; `ERROR` → `failed` (¿transitorio? el `retry` permite reprocesar); `VOIDED` → `voided`; `DRAFT` → `pending`. Un estado desconocido **no debe** cambiar la factura (queda `processing` y la reconciliación lo vuelve a mirar).
5. **Reintentar un rechazo cambia la clave de acceso.** Nixgo trata `rejected` como final. Propuesta inicial: no exponer `retry`; ante un rechazo, emitir una factura corregida.
6. **RIDE no siempre listo en `AUTHORIZED`:** la descarga debe tolerar "aún sin PDF" (reintentar después) y las URL prefirmadas caducan a los 5 min (descargar en el momento, no guardar la URL).
7. **Formas de pago y descuentos** son reglas fiscales del SRI: esperan la investigación de la especificación vigente (`src/lib/tax/ecuador/`) antes de exponerlas en la API de Nixgo.
8. **Certificados:** estrategia A (`docs/SECURITY.md`): el P12 lo carga la empresa en Factuplan; Nixgo guarda solo la referencia y la fecha (`GET /certificate/status` permite alertar la expiración).

## Variables de entorno (reservadas en `.env.example`)
```
FACTUPLAN_API_KEY_TEST=      # ak_test_… (una por workspace)
FACTUPLAN_API_KEY_LIVE=      # ak_live_…
FACTUPLAN_WEBHOOK_SECRET=    # secreto de firma del webhook configurado en el panel
```
Posible `FACTUPLAN_BASE_URL` (por defecto `https://api-rest.factuplan.com.ec/v1`).

## Mapeo previsto a `BillingProvider`

| Método | Endpoint / notas |
|---|---|
| `createInvoice` | `POST /developer/invoices` con `x-taxpayer-ruc` = RUC de la empresa; `sendEmail:false`; validar tarifa ∈ {0,5,8,12,14,15}. **Ver decisión 1** (duplicados) y 2 (secuencial) |
| `getInvoice` | `GET /developer/receipts/{id}/status` (y `/receipts/{id}` si hace falta el detalle); aplicar la correspondencia de estados |
| `createCreditNote` | `POST /developer/credit-notes` por `invoiceAccessKey`; Fase 3 posterior |
| `getRide` / `getXml` | `GET /developer/receipts/{id}/pdf|xml` → descargar la `url` prefirmada en el momento y servir el archivo desde Nixgo |
| `verifyWebhook` | Esquema `t=…,v1=…` de arriba; **nunca** aceptar sin secreto; deduplicar por `id` del cuerpo |

Hasta resolver estos puntos, el desarrollo usa `MockBillingProvider` (`BILLING_PROVIDER=mock`).
