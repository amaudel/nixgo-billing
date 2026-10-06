# Prueba de humo de RIDE (PDF) y XML (Windows PowerShell 5.1 o superior).
# Uso:  powershell -ExecutionPolicy Bypass -File scripts\probar-documentos.ps1 -Key nb_test_XXXX
# Requiere: app corriendo, API key de PRUEBAS y MOCK_WEBHOOK_SECRET igual a -Secret (para autorizar la factura).
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
    return @{ Status = [int]$r.StatusCode; Headers = $r.Headers; Raw = $r.Content }
  } catch {
    $resp = $_.Exception.Response
    if (-not $resp) { throw }
    $text = ""
    try { $text = (New-Object System.IO.StreamReader($resp.GetResponseStream())).ReadToEnd() } catch { }
    return @{ Status = [int]$resp.StatusCode; Headers = $resp.Headers; Raw = $text }
  }
}

function Check([string]$Nombre, [bool]$Condicion, [string]$Detalle = "") {
  $script:total++
  if ($Condicion) { Write-Host "  OK     $Nombre" -ForegroundColor Green }
  else { $script:fallas++; Write-Host "  FALLA  $Nombre  $Detalle" -ForegroundColor Red }
}

function Get-Firma([string]$Cuerpo) {
  $hmac = New-Object System.Security.Cryptography.HMACSHA256
  $hmac.Key = [Text.Encoding]::UTF8.GetBytes($Secret)
  return (($hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes($Cuerpo)) | ForEach-Object { $_.ToString("x2") }) -join "")
}

$auth = @{ Authorization = "Bearer $Key" }
$stamp = Get-Date -Format "yyyyMMddHHmmss"

Write-Host "`n1. Una factura nueva todavia no tiene comprobante" -ForegroundColor Cyan
$cuerpo = '{"establishmentCode":"001","emissionPointCode":"001","customer":{"identificationType":"cedula","identification":"0912345678","legalName":"Juan Perez"},"items":[{"description":"Documentos de prueba","quantity":1,"unitPrice":10,"taxRate":15}]}'
$r = Invoke-Api POST "/api/v1/invoices" @{ Authorization = "Bearer $Key"; "Idempotency-Key" = "doc-$stamp" } $cuerpo
Check "factura creada -> 202" ($r.Status -eq 202) "(status $($r.Status))"
$id = ($r.Raw | ConvertFrom-Json).id
if (-not $id) { Write-Host "`nNo se pudo crear la factura." -ForegroundColor Red; exit 1 }
$x = Invoke-Api GET "/api/v1/invoices/$id/ride" $auth
Check "RIDE antes de autorizar -> 409" ($x.Status -eq 409) "(status $($x.Status))"
$x = Invoke-Api GET "/api/v1/invoices/$id/xml" $auth
Check "XML antes de autorizar -> 409" ($x.Status -eq 409) "(status $($x.Status))"

Write-Host "`n2. Se autoriza (webhook firmado del proveedor simulado)" -ForegroundColor Cyan
$evento = '{"id":"evt-doc-' + $stamp + '","type":"invoice.authorized","documentId":"mock_' + $id + '","status":"authorized","authorizationNumber":"MOCK-AUTH-' + $stamp + '","accessKey":"MOCK-AK-' + $stamp + '"}'
$w = Invoke-Api POST "/api/webhooks/mock" @{ "x-mock-signature" = (Get-Firma $evento) } $evento
Check "webhook -> 200" ($w.Status -eq 200) "(status $($w.Status): $($w.Raw))"

Write-Host "`n3. Descargas" -ForegroundColor Cyan
$ride = Invoke-Api GET "/api/v1/invoices/$id/ride" $auth
Check "RIDE -> 200" ($ride.Status -eq 200) "(status $($ride.Status))"
Check "tipo application/pdf" ([string]$ride.Headers["Content-Type"] -like "application/pdf*") "(es $($ride.Headers['Content-Type']))"
Check "se descarga como adjunto con numero de factura" ([string]$ride.Headers["Content-Disposition"] -match 'attachment; filename="001-001-\d{9}\.pdf"') "(es $($ride.Headers['Content-Disposition']))"
$bytes = [byte[]]$ride.Raw
Check "es un PDF (empieza por %PDF)" ([Text.Encoding]::ASCII.GetString($bytes, 0, 5) -eq "%PDF-") ""
$archivo = Join-Path $env:TEMP "ride-prueba.pdf"
[IO.File]::WriteAllBytes($archivo, $bytes)
Write-Host "         guardado en: $archivo   (abrelo para verlo)"

$xml = Invoke-Api GET "/api/v1/invoices/$id/xml" $auth
Check "XML -> 200" ($xml.Status -eq 200) "(status $($xml.Status))"
Check "tipo application/xml" ([string]$xml.Headers["Content-Type"] -like "application/xml*") "(es $($xml.Headers['Content-Type']))"
Check "contiene el documento" ([string]$xml.Raw -like "*mock_$id*") ""

Write-Host "`n4. Seguridad" -ForegroundColor Cyan
$x = Invoke-Api GET "/api/v1/invoices/$id/ride"
Check "sin clave -> 401" ($x.Status -eq 401) "(status $($x.Status))"
$x = Invoke-Api GET "/api/v1/invoices/00000000-0000-4000-8000-000000000000/ride" $auth
Check "factura inexistente -> 404" ($x.Status -eq 404) "(status $($x.Status))"
$x = Invoke-Api GET "/api/v1/invoices/no-es-uuid/xml" $auth
Check "id mal formado -> 404" ($x.Status -eq 404) "(status $($x.Status))"

Write-Host ""
if ($script:fallas -eq 0) { Write-Host "TODO BIEN: $($script:total) de $($script:total) pruebas pasaron." -ForegroundColor Green }
else { Write-Host "$($script:fallas) de $($script:total) pruebas fallaron." -ForegroundColor Red }
