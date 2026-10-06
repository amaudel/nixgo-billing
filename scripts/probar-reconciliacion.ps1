# Prueba de humo de la reconciliacion (Windows PowerShell 5.1 o superior).
# Uso:  powershell -ExecutionPolicy Bypass -File scripts\probar-reconciliacion.ps1 -Key nb_test_XXXX -CronSecret TU_CRON_SECRET
# Requiere: app corriendo, API key de PRUEBAS y CRON_SECRET (16+ caracteres) definido en .env.local
# (reinicia npm run dev despues de agregarlo).
param(
  [Parameter(Mandatory = $true)][string]$Key,
  [Parameter(Mandatory = $true)][string]$CronSecret,
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

$auth = @{ Authorization = "Bearer $Key" }
$cron = @{ Authorization = "Bearer $CronSecret" }
$stamp = Get-Date -Format "yyyyMMddHHmmss"

Write-Host "`n1. Una factura que se queda 'en proceso' (como si se hubiera perdido el webhook)" -ForegroundColor Cyan
$cuerpo = '{"establishmentCode":"001","emissionPointCode":"001","customer":{"identificationType":"cedula","identification":"0912345678","legalName":"Juan Perez"},"items":[{"description":"Reconciliacion de prueba","quantity":1,"unitPrice":10,"taxRate":15}]}'
$r = Invoke-Api POST "/api/v1/invoices" @{ Authorization = "Bearer $Key"; "Idempotency-Key" = "rec-$stamp" } $cuerpo
Check "factura creada -> 202 processing" ($r.Status -eq 202 -and $r.Json.status -eq "processing") "(status $($r.Status))"
if (-not $r.Json -or -not $r.Json.id) { Write-Host "`nNo se pudo crear la factura." -ForegroundColor Red; exit 1 }
$id = $r.Json.id

Write-Host "`n2. Seguridad del endpoint" -ForegroundColor Cyan
$x = Invoke-Api GET "/api/cron/reconcile?olderThanMinutes=0"
Check "sin secreto -> 401" ($x.Status -eq 401) "(status $($x.Status); si es 503, falta CRON_SECRET en .env.local)"
$x = Invoke-Api GET "/api/cron/reconcile?olderThanMinutes=0" @{ Authorization = "Bearer secreto-incorrecto-123456" }
Check "secreto incorrecto -> 401" ($x.Status -eq 401) "(status $($x.Status))"
$x = Invoke-Api GET "/api/cron/reconcile?olderThanMinutes=-5" $cron
Check "parametro invalido -> 422" ($x.Status -eq 422) "(status $($x.Status))"
$x = Invoke-Api GET "/api/v1/invoices" $cron
Check "el secreto del cron NO sirve como API key -> 401" ($x.Status -eq 401) "(status $($x.Status))"

Write-Host "`n3. Con menos de 10 minutos de antiguedad no se toca" -ForegroundColor Cyan
$x = Invoke-Api GET "/api/cron/reconcile" $cron
Check "reconciliacion normal -> 200" ($x.Status -eq 200) "(status $($x.Status))"
$g = Invoke-Api GET "/api/v1/invoices/$id" $auth
Check "la factura reciente sigue processing" ($g.Json.status -eq "processing") "(es $($g.Json.status))"

Write-Host "`n4. Forzar la reconciliacion (olderThanMinutes=0)" -ForegroundColor Cyan
$x = Invoke-Api GET "/api/cron/reconcile?olderThanMinutes=0&limit=100" $cron
Check "200 con resumen" ($x.Status -eq 200 -and $x.Json.checked -ge 1) "(status $($x.Status): $($x.Json | ConvertTo-Json -Compress))"
Check "al menos una resuelta, ninguna fallida" ($x.Json.resolved -ge 1 -and $x.Json.failed -eq 0) "($($x.Json | ConvertTo-Json -Compress))"
$g = Invoke-Api GET "/api/v1/invoices/$id" $auth
Check "la factura quedo authorized" ($g.Json.status -eq "authorized") "(es $($g.Json.status))"
Check "con numero de autorizacion" ([bool]$g.Json.authorization.number) ""
Write-Host "         resumen: $($x.Json | ConvertTo-Json -Compress)"

Write-Host "`n5. Una segunda pasada no vuelve a tocarla" -ForegroundColor Cyan
$y = Invoke-Api GET "/api/cron/reconcile?olderThanMinutes=0&limit=100" $cron
$g2 = Invoke-Api GET "/api/v1/invoices/$id" $auth
Check "sigue authorized con el mismo numero" ($g2.Json.status -eq "authorized" -and $g2.Json.authorization.number -eq $g.Json.authorization.number) ""

Write-Host ""
if ($script:fallas -eq 0) { Write-Host "TODO BIEN: $($script:total) de $($script:total) pruebas pasaron." -ForegroundColor Green }
else { Write-Host "$($script:fallas) de $($script:total) pruebas fallaron." -ForegroundColor Red }
