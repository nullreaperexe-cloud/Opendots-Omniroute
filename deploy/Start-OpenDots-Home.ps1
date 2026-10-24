#Requires -Version 5.1
<#
Local free Windows host bootstrap. Run only on your OWN trusted Windows machine
after installing Docker Desktop and signing into Tailscale Personal.
The script NEVER buys cloud services, deploys to Vercel, prints owner secrets,
or publicly exposes the OmniRoute dashboard.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$FunnelUrl,
  [string]$VercelOrigin = "https://opendots-omniroute-zeta.vercel.app"
)
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Parse-Https-Origin([string]$value, [bool]$mustBeTailscale) {
  try {
    $uri = [uri]$value
    if ($uri.Scheme -ne "https" -or $uri.UserInfo -or
        $uri.AbsolutePath -ne "/" -or $uri.Query -or $uri.Fragment -or
        $uri.Port -ne 443) { throw "Invalid HTTPS origin" }
    if ($mustBeTailscale -and !$uri.Host.EndsWith(".ts.net")) {
      throw "Must use an exact *.ts.net Tailscale Funnel hostname"
    }
    if (!$mustBeTailscale -and !$uri.Host.EndsWith(".vercel.app")) {
      throw "Expected a Vercel frontend hostname"
    }
    return $uri.GetLeftPart([System.UriPartial]::Authority)
  } catch {
    throw "Expected an HTTPS origin with no path, query, fragment or port: $value"
  }
}
$backend = Parse-Https-Origin $FunnelUrl $true
$frontend = Parse-Https-Origin $VercelOrigin $false
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$envFile = Join-Path $repoRoot ".env"
$composeBase = Join-Path $repoRoot "docker-compose.yml"
$composeOverride = Join-Path $repoRoot "deploy/compose-home.yml"
if (!(Test-Path $composeBase) -or !(Test-Path $composeOverride)) {
  throw "Missing Compose files; run this from the correct Git repository."
}
if (!(Get-Command docker -ErrorAction SilentlyContinue)) {
  throw "Docker Desktop is required; install it and enable Linux containers/WSL2."
}
& docker compose version | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Docker Compose V2 is not available." }

function New-Secret {
  $bytes = New-Object byte[] 32
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  return (-join ($bytes | ForEach-Object { $_.ToString("x2") }))
}
if (Test-Path $envFile) {
  throw "A private .env already exists. Not overwriting credentials. Set APP_ORIGIN to '$frontend,$backend' yourself."
}
$ownerToken = New-Secret
$browserSecret = New-Secret
$bridgeSecret = New-Secret
$envText = @"
OWNER_TOKEN=$ownerToken
BROWSER_SECRET=$browserSecret
OMNIROUTE_WS_BRIDGE_SECRET=$bridgeSecret
OMNIROUTE_API_KEY=private-internal-router
OMNIROUTE_MODEL=auto
AGENT_BACKEND_DOMAIN=localhost
APP_ORIGIN=$frontend,$backend
WEB_SEARCH_PROVIDER=browser
"@
try {
  [System.IO.File]::WriteAllText($envFile, $envText + [Environment]::NewLine, [System.Text.Encoding]::ASCII)
  Push-Location $repoRoot
  try {
    & docker compose -f docker-compose.yml -f deploy/compose-home.yml config --quiet
    if ($LASTEXITCODE -ne 0) { throw "Docker Compose validation failed." }
    & docker compose -f docker-compose.yml -f deploy/compose-home.yml up -d --build redis omniroute browser opendots
    if ($LASTEXITCODE -ne 0) { throw "Docker Compose services did not start successfully." }
    & docker compose -f docker-compose.yml -f deploy/compose-home.yml ps
  } finally { Pop-Location }
} catch {
  Write-Warning "The secure .env has been kept for troubleshooting. Do NOT upload it."
  throw
}
Write-Host "Local OpenDots backend should now be accessible at http://127.0.0.1:4310"
Write-Host "The required Tailscale public origin is $backend"
Write-Host "If not already enabled, Tailscale Funnel must expose local TCP port 4310."
Write-Host "The separate Vercel environment OPENDOTS_BACKEND_ORIGIN must be $backend"
Write-Host "Keep the PC and Docker Desktop running; provider accounts are still required for AI."
