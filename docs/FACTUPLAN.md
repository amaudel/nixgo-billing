# Integración con Factuplan

> **Estado: SIN DOCUMENTAR.** `FactuplanProvider` es un stub que falla explícitamente. No se han inventado endpoints.
> Intento de consulta de la documentación pública (2026-10-05): el sitio `factuplan.com.ec` devolvió 403 a consultas automáticas y la búsqueda web no estuvo disponible. Hay que obtener la documentación oficial vigente (portal de desarrolladores o ejecutivo de cuenta) y completar este archivo **antes** de implementar `FactuplanProvider`.

## Checklist a completar desde la documentación oficial

| Tema | Pregunta a responder | Dato |
|---|---|---|
| Base URL | ¿Producción y sandbox? | _pendiente_ |
| Autenticación | ¿Header, formato, rotación de claves? ¿Una clave por cuenta o por empresa? | _pendiente_ |
| Sandbox | ¿Entorno separado? ¿Conexión al SRI de pruebas? ¿Límites? | _pendiente_ |
| Multi-RUC | ¿Cómo se registran varias empresas bajo una cuenta? ¿Qué identificador se envía en cada petición? | _pendiente_ |
| Certificados | ¿Carga por API o por panel? ¿Cómo se asocia a un RUC? ¿Aviso de expiración? | _pendiente_ |
| Crear factura | Endpoint, payload, quién genera secuencial y clave de acceso | _pendiente_ |
| Consultar factura | Endpoint y estados posibles ↔ `InvoiceStatus` | _pendiente_ |
| Nota de crédito | Endpoint y payload | _pendiente_ |
| RIDE / XML | Endpoints y formato de respuesta (URL vs binario) | _pendiente_ |
| Webhooks | Eventos, esquema de firma, reintentos, cabeceras | _pendiente_ |
| Idempotencia | ¿Soporta clave de idempotencia? Si no, cómo evitar duplicados | _pendiente_ |
| Errores | Códigos, formato, rechazos del SRI vs errores técnicos, reintentable o no | _pendiente_ |
| Límites | Rate limits, tamaños | _pendiente_ |

## Variables de entorno (ya reservadas en `.env.example`)

```
FACTUPLAN_API_KEY_TEST=
FACTUPLAN_API_KEY_LIVE=
FACTUPLAN_WEBHOOK_SECRET=
```

## Mapeo previsto a `BillingProvider`

| Método | Notas |
|---|---|
| `createInvoice` | Propagar `idempotencyKey`; mapear respuesta → `ProviderInvoiceResult` |
| `getInvoice` | Reconciliación si se pierde un webhook |
| `createCreditNote` | Fase 3 |
| `getRide` / `getXml` | Proxy desde Nixgo: la app cliente nunca recibe URLs/credenciales del proveedor |
| `verifyWebhook` | Firma sobre cuerpo crudo con `FACTUPLAN_WEBHOOK_SECRET`; rechazar si falta |

Hasta que esté documentado, el desarrollo usa `MockBillingProvider` (`BILLING_PROVIDER=mock`).
