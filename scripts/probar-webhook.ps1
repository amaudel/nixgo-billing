# Prueba de humo de los webhooks (Windows PowerShell 5.1 o superior).
# Uso:  powershell -ExecutionPolicy Bypass -File scripts\probar-webhook.ps1 -Key nb_test_XXXX
# Requiere: app corriendo (npm run dev), una API key de PRUEBAS, y que MOCK_WEBHOOK_SECRET de
# .env.local coincida con -Secret (por defecto el valor de .env.example).
param(
  [Parameter(Mandatory = $true)][string]$Key,
  [string]$Secret = "dev-only-mock-secret",
  [string]$BaseUrl = "http://localhost:3000"
)

$ErrorActionPreference = "Stop"
$script:fallas = 0
$script:total = 0

function Invoke-Api {
  param([string]$Method, [string]$Path, [hashtable]$Headers = @{}, [string]$Body = $null)
  $params = @{ Method = $Method; Uri = "$BaseUrl$Path"; Headers = $Headers; UseBasicParsing = $true }
  if ($Body) { $params.Body = $Body; $params.ContentType = "application/json" }
  try {
    $r = Invoke-WebRequest @params
    return @{ Status = [int]$r.StatusCode; Json = ($r.Content | ConvertFrom-Json) }
  } catch {
    $resp = $_.Exception.Response
    if (-not $resp) { throw }
    $text = ""
    try { $text = (New-Object System.IO.StreamReader($resp.GetResponseStream())).ReadToEnd() } catch { }
    $json = $null
    try { $json = $text | ConvertFrom-Json } catch { }
    return @{ Status = [int]$resp.StatusCode; Json = $json }
  }
}

function Check([string]$Nombre, [bool]$Condicion, [string]$Detalle = "") {
  $script:total++
  if ($Condicion) { Write-Host "  OK     $Nombre" -ForegroundColor Green }
  else { $script:fallas++; Write-Host "  FALLA  $Nombre  $Detalle" -ForegroundColor Red }
}

# Firma HMAC-SHA256 (hex) del cuerpo crudo, como lo haria el proveedor.
function Get-Firma([string]$Cuerpo) {
  $hmac = New-Object System.Security.Cryptography.HMACSHA256
  $hmac.Key = [Text.Encoding]::UTF8.GetBytes($Secret)
  $bytes = $hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes($Cuerpo))
  return (($bytes | ForEach-Object { $_.ToString("x2") }) -join "")
}

function Send-Webhook([string]$Cuerpo, [string]$Firma, [string]$Proveedor = "mock") {
  $h = @{}
  if ($Firma) { $h["x-mock-signature"] = $Firma }
  return Invoke-Api POST "/api/webhooks/$Proveedor" $h $Cuerpo
}

$auth = @{ Authorization = "Bearer $Key" }
$stamp = Get-Date -Format "yyyyMMddHHmmss"

Write-Host "`n1. Crear una factura para autorizarla despues" -ForegroundColor Cyan
$cuerpoFactura = '{"establishmentCode":"001","emissionPointCode":"001","customer":{"identificationType":"cedula","identification":"0912345678","legalName":"Juan Perez"},"items":[{"description":"Webhook de prueba","quantity":1,"unitPrice":10,"taxRate":15}]}'
$r = Invoke-Api POST "/api/v1/invoices" @{ Authorization = "Bearer $Key"; "Idempotency-Key" = "wh-$stamp" } $cuerpoFactura
Check "factura creada -> 202" ($r.Status -eq 202) "(status $($r.Status))"
if (-not $r.Json -or -not $r.Json.id) { Write-Host "`nNo se pudo crear la factura; no se puede seguir." -ForegroundColor Red; exit 1 }
$id = $r.Json.id
$doc = "mock_$id"
Check "estado inicial processing" ($r.Json.status -eq "processing") "(es $($r.Json.status))"
Write-Host "         id: $id"

Write-Host "`n2. Seguridad del webhook" -ForegroundColor Cyan
$cuerpo = '{"id":"evt-' + $stamp + '-1","type":"invoice.authorized","documentId":"' + $doc + '","status":"authorized","accessKey":"MOCK-AK-' + $stamp + '","authorizationNumber":"MOCK-AUTH-' + $stamp + '","authorizedAt":"2026-10-05T12:00:00Z"}'
$w = Send-Webhook $cuerpo ""
Check "sin firma -> 401" ($w.Status -eq 401) "(status $($w.Status))"
$w = Send-Webhook $cuerpo "0000000000000000000000000000000000000000000000000000000000000000"
Check "firma falsa -> 401" ($w.Status -eq 401) "(status $($w.Status))"
$g = Invoke-Api GET "/api/v1/invoices/$id" $auth
Check "la factura NO cambio con avisos falsos" ($g.Json.status -eq "processing") "(es $($g.Json.status))"
$w = Send-Webhook $cuerpo (Get-Firma $cuerpo) "inventado"
Check "proveedor desconocido -> 404" ($w.Status -eq 404) "(status $($w.Status))"

Write-Host "`n3. Autorizar con un webhook firmado" -ForegroundColor Cyan
$w = Send-Webhook $cuerpo (Get-Firma $cuerpo)
Check "webhook valido -> 200 applied" ($w.Status -eq 200 -and $w.Json.outcome -eq "applied") "(status $($w.Status): $($w.Json | ConvertTo-Json -Compress))"
$g = Invoke-Api GET "/api/v1/invoices/$id" $auth
Check "factura ahora authorized" ($g.Json.status -eq "authorized") "(es $($g.Json.status))"
Check "numero de autorizacion guardado" ($g.Json.authorization.number -eq "MOCK-AUTH-$stamp") "(es $($g.Json.authorization.number))"
Check "clave de acceso guardada" ($g.Json.accessKey -eq "MOCK-AK-$stamp") "(es $($g.Json.accessKey))"

Write-Host "`n4. Idempotencia y estados finales" -ForegroundColor Cyan
$w = Send-Webhook $cuerpo (Get-Firma $cuerpo)
Check "el mismo evento otra vez -> duplicate" ($w.Status -eq 200 -and $w.Json.outcome -eq "duplicate") "(status $($w.Status): $($w.Json | ConvertTo-Json -Compress))"
$rechazo = '{"id":"evt-' + $stamp + '-2","type":"invoice.rejected","documentId":"' + $doc + '","status":"rejected","rejectionReason":"intento tardio"}'
$w = Send-Webhook $rechazo (Get-Firma $rechazo)
Check "un rechazo tardio no pisa lo autorizado" ($w.Status -eq 200 -and $w.Json.outcome -eq "unchanged") "(status $($w.Status): $($w.Json | ConvertTo-Json -Compress))"
$g = Invoke-Api GET "/api/v1/invoices/$id" $auth
Check "sigue authorized" ($g.Json.status -eq "authorized") "(es $($g.Json.status))"

Write-Host "`n5. Documento desconocido" -ForegroundColor Cyan
$raro = '{"id":"evt-' + $stamp + '-3","type":"invoice.authorized","documentId":"mock_no-existe-' + $stamp + '","status":"authorized"}'
$w = Send-Webhook $raro (Get-Firma $raro)
Check "documento desconocido -> 404 (el proveedor reintentaria)" ($w.Status -eq 404) "(status $($w.Status))"
$malo = '{"id":"evt-' + $stamp + '-4","type":"invoice.authorized","documentId":"' + $doc + '","status":"inventado"}'
$w = Send-Webhook $malo (Get-Firma $malo)
Check "estado invalido con firma correcta -> 400" ($w.Status -eq 400) "(status $($w.Status))"

Write-Host ""
if ($script:fallas -eq 0) { Write-Host "TODO BIEN: $($script:total) de $($script:total) pruebas pasaron." -ForegroundColor Green }
else { Write-Host "$($script:fallas) de $($script:total) pruebas fallaron." -ForegroundColor Red }
