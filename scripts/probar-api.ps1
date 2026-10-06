# Prueba de humo de la API de facturas (Windows PowerShell 5.1 o superior).
# Uso:  powershell -ExecutionPolicy Bypass -File scripts\probar-api.ps1 -Key nb_test_XXXX
# Requiere la app corriendo (npm run dev) y una API key de PRUEBAS creada en el panel.
param(
  [Parameter(Mandatory = $true)][string]$Key,
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
    return @{ Status = [int]$r.StatusCode; Headers = $r.Headers; Json = ($r.Content | ConvertFrom-Json) }
  } catch {
    $resp = $_.Exception.Response
    if (-not $resp) { throw }
    $text = ""
    try { $text = (New-Object System.IO.StreamReader($resp.GetResponseStream())).ReadToEnd() } catch { }
    $json = $null
    try { $json = $text | ConvertFrom-Json } catch { }
    return @{ Status = [int]$resp.StatusCode; Headers = $resp.Headers; Json = $json }
  }
}

function Check([string]$Nombre, [bool]$Condicion, [string]$Detalle = "") {
  $script:total++
  if ($Condicion) { Write-Host "  OK     $Nombre" -ForegroundColor Green }
  else { $script:fallas++; Write-Host "  FALLA  $Nombre  $Detalle" -ForegroundColor Red }
}

$auth = @{ Authorization = "Bearer $Key" }
$idem = "prueba-" + (Get-Date -Format "yyyyMMddHHmmss")
$headersPost = @{ Authorization = "Bearer $Key"; "Idempotency-Key" = $idem }

$cuerpo = '{"establishmentCode":"001","emissionPointCode":"001","externalReference":"pago_1","customer":{"identificationType":"cedula","identification":"0912345678","legalName":"Juan Perez","email":"juan@example.com"},"items":[{"description":"Suscripcion mensual","quantity":1,"unitPrice":25,"taxRate":15}]}'
$cuerpoOtro = $cuerpo.Replace('"unitPrice":25', '"unitPrice":30')
$cuerpoSinIva = '{"establishmentCode":"001","emissionPointCode":"001","customer":{"identificationType":"cedula","identification":"0912345678","legalName":"Juan Perez"},"items":[{"description":"x","quantity":1,"unitPrice":1}]}'

Write-Host "`n1. Seguridad" -ForegroundColor Cyan
$r = Invoke-Api GET "/api/v1/invoices"
Check "sin clave -> 401" ($r.Status -eq 401) "(status $($r.Status))"
$r = Invoke-Api GET "/api/v1/invoices" @{ Authorization = "Bearer nb_test_abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG" }
Check "clave inventada -> 401" ($r.Status -eq 401) "(status $($r.Status))"

Write-Host "`n2. Crear factura" -ForegroundColor Cyan
$r = Invoke-Api POST "/api/v1/invoices" $headersPost $cuerpo
Check "crear -> 202" ($r.Status -eq 202) "(status $($r.Status): $($r.Json | ConvertTo-Json -Compress -Depth 4))"
$id = $null
if ($r.Json) {
  $id = $r.Json.id
  Check "estado processing" ($r.Json.status -eq "processing") "(es $($r.Json.status))"
  Check "numero 001-001-#########" ([bool]($r.Json.number -match '^001-001-\d{9}$')) "(es $($r.Json.number))"
  Check "total 28.75 (25 + IVA 15%)" ($r.Json.totals.total -eq 28.75) "(es $($r.Json.totals.total))"
  Check "no expone el proveedor" (-not ($r.Json | ConvertTo-Json -Depth 6).Contains("mock")) ""
  Write-Host "         id: $id   numero: $($r.Json.number)"
}

Write-Host "`n3. Idempotencia" -ForegroundColor Cyan
$r2 = Invoke-Api POST "/api/v1/invoices" $headersPost $cuerpo
Check "repetir misma peticion -> 200" ($r2.Status -eq 200) "(status $($r2.Status))"
Check "cabecera Idempotent-Replayed" ($r2.Headers["Idempotent-Replayed"] -eq "true") ""
Check "devuelve la MISMA factura" ($id -and $r2.Json.id -eq $id) ""
$r3 = Invoke-Api POST "/api/v1/invoices" $headersPost $cuerpoOtro
Check "misma clave con otro cuerpo -> 422" ($r3.Status -eq 422 -and $r3.Json.error.code -eq "idempotency_conflict") "(status $($r3.Status))"
$r4 = Invoke-Api POST "/api/v1/invoices" @{ Authorization = "Bearer $Key" } $cuerpo
Check "sin Idempotency-Key -> 422" ($r4.Status -eq 422) "(status $($r4.Status))"
$r5 = Invoke-Api POST "/api/v1/invoices" @{ Authorization = "Bearer $Key"; "Idempotency-Key" = "$idem-b" } $cuerpoSinIva
Check "sin taxRate -> 422 (no se asume IVA)" ($r5.Status -eq 422 -and $r5.Json.error.code -eq "validation_error") "(status $($r5.Status))"

Write-Host "`n4. Consultar" -ForegroundColor Cyan
if ($id) {
  $g = Invoke-Api GET "/api/v1/invoices/$id" $auth
  Check "consultar por id -> 200" ($g.Status -eq 200 -and $g.Json.id -eq $id) "(status $($g.Status))"
}
$l = Invoke-Api GET "/api/v1/invoices?limit=5" $auth
Check "listar -> 200" ($l.Status -eq 200) "(status $($l.Status))"
if ($id -and $l.Json) { Check "la lista incluye la factura" (@($l.Json.data | Where-Object { $_.id -eq $id }).Count -eq 1) "" }
$n = Invoke-Api GET "/api/v1/invoices/00000000-0000-4000-8000-000000000000" $auth
Check "id inexistente -> 404" ($n.Status -eq 404) "(status $($n.Status))"

Write-Host ""
if ($script:fallas -eq 0) { Write-Host "TODO BIEN: $($script:total) de $($script:total) pruebas pasaron." -ForegroundColor Green }
else { Write-Host "$($script:fallas) de $($script:total) pruebas fallaron." -ForegroundColor Red }
