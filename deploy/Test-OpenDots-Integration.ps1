#Requires -Version 5.1
<#
Safe end-to-end diagnostics for OpenDots, Vercel -> Tailscale routing, and
the selected private AI gateway endpoint. The optional completion test makes an actual
upstream model request. Neither token nor generated content is printed.
#>
[CmdletBinding()]
param(
  [string]$VercelOrigin = "https://opendots-omniroute.vercel.app",
  [string]$FunnelOrigin = "https://kanish.tail7524cf.ts.net",
  [switch]$TestCompletion
)
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$envFile = Join-Path $root ".env"
if (!(Test-Path -LiteralPath $envFile)) { throw "Missing private .env." }

function ValueFor([string]$name, [switch]$Optional) {
  $matched = @(Get-Content -LiteralPath $envFile | Where-Object { $_.StartsWith($name + "=") })
  if ($matched.Count -gt 1 -or ($matched.Count -ne 1 -and !$Optional)) {
    throw "Missing or duplicate $name in .env"
  }
  if ($matched.Count -eq 0) { return "" }
  return $matched[0].Substring($name.Length + 1)
}
$owner = ValueFor "OWNER_TOKEN"
$freeKey = ValueFor "FREELLMAPI_API_KEY" -Optional
$usingFreeLLMAPI = ![string]::IsNullOrWhiteSpace($freeKey)
$gatewayName = if ($usingFreeLLMAPI) { "FreeLLMAPI" } else { "OmniRoute" }
$gatewayKey = if ($usingFreeLLMAPI) { $freeKey } else { ValueFor "OMNIROUTE_API_KEY" }
$gatewayPort = if ($usingFreeLLMAPI) { 3001 } else { 20128 }
$gatewayModelName = if ($usingFreeLLMAPI) { "FREELLMAPI_MODEL" } else { "OMNIROUTE_MODEL" }
if (!$owner -or $owner.Length -lt 24) { throw "OWNER_TOKEN is missing or short." }
foreach ($originText in @($VercelOrigin, $FunnelOrigin)) {
  $originUrl = [uri]$originText
  if ($originUrl.Scheme -ne "https" -or $originUrl.AbsolutePath -ne "/" -or
      $originUrl.Query -or $originUrl.Fragment) {
    throw "Expected a bare HTTPS origin."
  }
}
if (!$gatewayKey) { throw "$gatewayName API key is not configured." }

function Check([string]$name, [string]$url, [string]$key, [string]$requestOrigin) {
  $headers = @{ Authorization = "Bearer $key" }
  if ($requestOrigin) { $headers["Origin"] = $requestOrigin }
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $url -Method GET -Headers $headers -TimeoutSec 25
    $contentType = [string]$response.Headers["Content-Type"]
    $marker = [string]$response.Headers["X-OpenDots-Route"]
    if ($contentType -notmatch "(?i)json") {
      Write-Warning ("{0}: HTTP {1} but unexpected content type {2}. The frontend may have returned HTML instead of the backend API." -f $name, [int]$response.StatusCode, $contentType)
    } else {
      try {
        $json = ConvertFrom-Json -InputObject $response.Content -ErrorAction Stop
        if ($null -eq $json) { throw "Empty JSON" }
        Write-Host ("[OK] {0}: HTTP {1}, valid JSON, {2}" -f $name, [int]$response.StatusCode, $contentType)
      } catch {
        Write-Warning ("{0}: HTTP {1}, JSON parsing FAILED; this is not a successful API check." -f $name, [int]$response.StatusCode)
      }
    }
    if ($name -eq "Vercel CopilotKit proxy") {
      $cdnMarker = [string]$response.Headers["X-OpenDots-Route"]
      if ($cdnMarker -eq "external-funnel-v3") {
        Write-Host "   Confirmed new Vercel external-origin rewrite response marker."
      } else {
        Write-Warning "External rewrite response marker absent; verify that production points to the latest commit."
      }
    }
    if ($name -eq "$gatewayName models") {
      try {
        $parsed = ConvertFrom-Json -InputObject $response.Content
        $count = @($parsed.data).Count
        Write-Host "   $gatewayName advertises $count model(s); real completion and account quotas still require testing."
      } catch { Write-Warning "Could not parse model catalog JSON." }
    }
  } catch {
    $httpResponse = $_.Exception.Response
    if ($null -ne $httpResponse) {
      $contentType = [string]$httpResponse.Headers["Content-Type"]
      $marker = [string]$httpResponse.Headers["X-OpenDots-Route"]
      Write-Warning ("{0}: HTTP {1}, content-type={2}, proxy-marker={3}" -f
        $name, [int]$httpResponse.StatusCode, $contentType,
        $(if ($marker) { $marker } else { "none" }))
    } else {
      Write-Warning ("{0}: No HTTP response (backend or network unavailable)." -f $name)
    }
  }
}

Check "Local CopilotKit runtime" "http://127.0.0.1:4310/api/copilotkit/info" $owner $VercelOrigin
Check "Public Tailscale CopilotKit runtime" "$FunnelOrigin/api/copilotkit/info" $owner $VercelOrigin
Check "Vercel CopilotKit proxy" "$VercelOrigin/api/copilotkit/info" $owner $VercelOrigin
Check "$gatewayName models" "http://127.0.0.1:$gatewayPort/v1/models" $gatewayKey ""

if ($TestCompletion) {
  $model = ValueFor $gatewayModelName -Optional
  if (!$model) { $model = if ($usingFreeLLMAPI) { "auto:smart" } else { "auto" } }
  $body = @{
    model = $model
    messages = @(@{ role = "user"; content = "Hello. Reply with one short sentence in Hindi." })
    max_tokens = 120
    stream = $false
  } | ConvertTo-Json -Depth 8 -Compress
  try {
    $headers = @{ Authorization = "Bearer $gatewayKey" }
    $result = Invoke-RestMethod -Uri "http://127.0.0.1:$gatewayPort/v1/chat/completions" -Method POST -Headers $headers -ContentType "application/json" -Body $body -TimeoutSec 90
    $content = [string]$result.choices[0].message.content
    if ([string]::IsNullOrWhiteSpace($content)) {
      Write-Warning "$gatewayName completion returned no assistant text."
    } else {
      Write-Host ("[OK] Actual $gatewayName chat completion returned non-empty assistant text (model requested: {0})." -f $model)
    }
  } catch {
    $httpResponse = $_.Exception.Response
    if ($null -ne $httpResponse) {
      Write-Warning ("$gatewayName actual completion failed: HTTP {0}. Check upstream account, quota, and model routing." -f [int]$httpResponse.StatusCode)
    } else {
      Write-Warning "$gatewayName actual completion failed without an HTTP response. Check local gateway connectivity."
    }
  }
}
Write-Host "Diagnostics finished. No owner token, API key or model response content was displayed."
