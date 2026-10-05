# Guía de integración para aplicaciones consumidoras

> **Estado (Fase 1):** `POST /api/v1/invoices`, `GET /api/v1/invoices` y `GET /api/v1/invoices/:id` están implementados y operan contra el proveedor `mock` (las facturas quedan en `processing`; no hay autorización real hasta las Fases 2–3). Lo demás es contrato previsto.

Una app consumidora (p. ej. NidoCerca) solo necesita Nixgo Billing. **No** debe saber cómo funciona Factuplan ni el SRI, cómo se firma el XML ni dónde está el certificado.

## Autenticación

```
Authorization: Bearer nb_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

- Claves `nb_test_…` operan en el ambiente de pruebas; `nb_live_…` en producción.
- Cada clave pertenece a una empresa y una aplicación. Se muestra una sola vez al crearla; guárdala como secreto de servidor (nunca en frontend).

## Crear factura

```http
POST /api/v1/invoices
Authorization: Bearer nb_live_xxxxxx
Idempotency-Key: nidocerca_payment_92839
Content-Type: application/json
```

```json
{
  "establishmentCode": "001",
  "emissionPointCode": "001",
  "issueDate": "2026-10-05",
  "externalReference": "payment_92839",
  "customer": {
    "identificationType": "cedula",
    "identification": "0912345678",
    "legalName": "Juan Pérez",
    "email": "juan@example.com"
  },
  "items": [
    { "sku": "PLAN-PRO", "description": "Suscripción mensual", "quantity": 1, "unitPrice": 25.0, "discount": 0, "taxRate": 15 }
  ]
}
```

> Los valores de `identificationType` y `taxRate` están sujetos a la especificación vigente del SRI; se confirmarán al implementar `src/lib/tax/ecuador/`.

Respuesta `202 Accepted` (la autorización es asíncrona). Devuelve la factura completa:

```json
{
  "id": "6f1c…", "number": "001-001-000000123", "status": "processing", "environment": "test",
  "issueDate": "2026-10-05", "currency": "USD", "externalReference": "payment_92839",
  "totals": { "subtotal": 25, "discount": 0, "tax": 3.75, "total": 28.75 },
  "accessKey": null, "authorization": null, "rejectionReason": null,
  "customer": { "...": "..." }, "items": [ { "...": "..." } ], "createdAt": "…"
}
```

- `taxRate` es **obligatorio** en cada ítem (no se asume IVA). `issueDate` es opcional (por omisión, hoy en `America/Guayaquil`).
- Los totales los calcula Nixgo (centavos, redondeo por línea): `subtotal` es la base tras descuentos y `total = subtotal + tax`. *Provisional hasta validar la normativa del SRI.*
- El cuerpo es estricto: campos desconocidos (p. ej. `organizationId`) se rechazan con `422`. La empresa y el ambiente salen de la API key.
- Máximo 100 ítems y 256 KB por petición.

## Idempotencia

`Idempotency-Key` es obligatorio (1–200 caracteres imprimibles, sin espacios). Reintentar con la misma clave y el mismo cuerpo devuelve la factura original (no crea otra) con `200` y la cabecera `Idempotent-Replayed: true`. La misma clave con un cuerpo distinto responde `422 idempotency_conflict`. Las claves de pruebas y producción son independientes.

Si el proveedor falla (`502 provider_error`), la factura queda `pending`: **reintenta con la misma `Idempotency-Key`** y se reanuda sin duplicarla.

## Consultar estado

```
GET /api/v1/invoices/:id        → factura completa (misma forma que arriba)
GET /api/v1/invoices            → { data: [...], hasMore }   filtros: status, externalReference, limit (1–100, def. 20), offset
GET /api/v1/invoices/:id/ride   → PDF   (previsto, Fase 2)
GET /api/v1/invoices/:id/xml    → XML   (previsto, Fase 2)
```

Estados: `draft`, `pending`, `processing`, `authorized`, `rejected`, `failed`, `voided`. Haz *polling* con backoff o (futuro) suscríbete a webhooks de Nixgo hacia tu app.

## Errores

JSON uniforme `{ "error": { "code": "…", "message": "…", "details": [...] } }` (`details` solo en validación: ruta y mensaje, nunca el valor recibido).

| HTTP | `code` | Cuándo |
|---|---|---|
| 400 | `invalid_json` | cuerpo no es JSON |
| 401 | `unauthorized` | key ausente, mal formada, revocada o de otro ambiente (mismo mensaje en todos los casos) |
| 403 | `forbidden` | empresa inactiva o la key no tiene el permiso (`invoices:read` / `invoices:write`) |
| 404 | `not_found` | no existe, o pertenece a otra empresa/ambiente |
| 409 | `provider_not_configured` | producción sin proveedor configurado |
| 413 | `payload_too_large` | cuerpo > 256 KB |
| 422 | `validation_error`, `idempotency_key_required`, `idempotency_conflict` | datos inválidos / cabecera faltante / misma clave con otro cuerpo |
| 429 | `rate_limited` | 120 peticiones/min por key (`Retry-After`, `X-RateLimit-*`) |
| 501 | `provider_not_implemented` | el proveedor de la empresa aún no existe (Factuplan) |
| 502 | `provider_error` | el proveedor falló: reintentar con la misma `Idempotency-Key` |
| 500/503 | `internal_error`, `service_unavailable` | error interno / sin configuración |

## Otros endpoints previstos

`POST /api/v1/credit-notes` · `GET|POST /api/v1/customers` · `GET /api/v1/organizations/:id`
