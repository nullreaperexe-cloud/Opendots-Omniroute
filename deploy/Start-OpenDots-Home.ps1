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
# Tailscale on Windows normally installs to Program Files without adding its
# CLI directory to PATH. Handle that standard location as well as PATH installs.
function Get-TailscaleExe {
  $cmd = Get-Command "tailscale.exe" -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $locations = @()
  if (${env:ProgramFiles}) {
    $locations += (Join-Path ${env:ProgramFiles} "Tailscale\tailscale.exe")
  }
  if (${env:ProgramFiles(x86)}) {
    $locations += (Join-Path ${env:ProgramFiles(x86)} "Tailscale\tailscale.exe")
  }
  foreach ($location in $locations) {
    if (Test-Path -LiteralPath $location -PathType Leaf) { return $location }
  }
  throw "Tailscale CLI not found in PATH or Program Files. Install Tailscale for Windows first."
}
$tailscaleExe = Get-TailscaleExe
$funnelStatus = (& $tailscaleExe funnel status | Out-String)
if ($LASTEXITCODE -ne 0) {
  throw "Unable to check Tailscale Funnel. Sign in to Tailscale and enable Funnel."
}
if ($funnelStatus -notlike "*$backend*") {
  throw "Funnel is not pointing to expected URL $backend. Run Tailscale Funnel for port 4310 first."
}
Write-Host "Tailscale Funnel verified: $backend"
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
if (Test-Path -LiteralPath $envFile -PathType Leaf) {
  # Do not rotate local owner tokens on every restart; preserve the exact same
  # browser/owner credentials and avoid breaking persisted sessions.
  $originSettings = @(Get-Content -LiteralPath $envFile | Where-Object { $_ -match '^APP_ORIGIN=' })
  if ($originSettings.Count -ne 1 -or
      !$originSettings[0].Contains($frontend) -or
      !$originSettings[0].Contains($backend)) {
    throw "Existing private .env has an APP_ORIGIN mismatch. Update that key locally to '$frontend,$backend' without sharing or deleting other secrets."
  }
  Write-Host "Reusing existing private .env; preserving all credentials."
} else {
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
  [System.IO.File]::WriteAllText($envFile, $envText + [Environment]::NewLine, [System.Text.Encoding]::ASCII)
  Write-Host "Generated private .env. Never upload this file."
}


# Only start FreeLLMAPI when the user explicitly configured its unified key.
# Legacy OmniRoute installations continue to boot exactly as before.
$freeKeyLines = @(Get-Content -LiteralPath $envFile |
  Where-Object { $_.StartsWith('FREELLMAPI_API_KEY=') })
if ($freeKeyLines.Count -gt 1) {
  throw 'Duplicate FREELLMAPI_API_KEY in private .env.'
}
$useFreeLLMAPI = ($freeKeyLines.Count -eq 1 -and
  $freeKeyLines[0].Substring('FREELLMAPI_API_KEY='.Length).Trim().Length -gt 0)
if ($useFreeLLMAPI) {
  $encryption = @(Get-Content -LiteralPath $envFile |
    Where-Object { $_.StartsWith('FREELLMAPI_ENCRYPTION_KEY=') })
  if ($encryption.Count -ne 1 -or
      $encryption[0].Substring('FREELLMAPI_ENCRYPTION_KEY='.Length) -notmatch '^[a-fA-F0-9]{64}
  try {
    & docker compose -f docker-compose.yml -f deploy/compose-home.yml config --quiet
    if ($LASTEXITCODE -ne 0) { throw "Docker Compose validation failed." }

    # Pull, NEVER build, the version-pinned upstream OmniRoute runtime.
    if ($useFreeLLMAPI) {
      & docker compose -f docker-compose.yml -f deploy/compose-home.yml --profile freellmapi pull redis omniroute freellmapi
    } else {
      & docker compose -f docker-compose.yml -f deploy/compose-home.yml pull redis omniroute
    }
    if ($LASTEXITCODE -ne 0) { throw "Could not pull private gateway or Redis images." }

    # These two small project services still build locally; OmniRoute does NOT.
    & docker compose -f docker-compose.yml -f deploy/compose-home.yml build browser opendots
    if ($LASTEXITCODE -ne 0) { throw "OpenDots or browser image build failed." }

    if ($useFreeLLMAPI) {
      & docker compose -f docker-compose.yml -f deploy/compose-home.yml --profile freellmapi up -d --no-build redis omniroute freellmapi browser opendots
    } else {
      & docker compose -f docker-compose.yml -f deploy/compose-home.yml up -d --no-build redis omniroute browser opendots
    }
    if ($LASTEXITCODE -ne 0) { throw "Docker Compose services did not start successfully." }
    & docker compose -f docker-compose.yml -f deploy/compose-home.yml ps
    if ($LASTEXITCODE -ne 0) { throw "Unable to read service status." }
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
) {
    throw 'FREELLMAPI_ENCRYPTION_KEY is missing or invalid. Run Setup-FreeLLMAPI.ps1 once.'
  }
  Write-Host 'FreeLLMAPI gateway configured; enabling optional private Docker service.'
}

try {
  Push-Location $repoRoot
  try {
    & docker compose -f docker-compose.yml -f deploy/compose-home.yml config --quiet
    if ($LASTEXITCODE -ne 0) { throw "Docker Compose validation failed." }

    # Pull, NEVER build, the version-pinned upstream OmniRoute runtime.
    & docker compose -f docker-compose.yml -f deploy/compose-home.yml pull redis omniroute
    if ($LASTEXITCODE -ne 0) { throw "Could not pull prebuilt OmniRoute / Redis images." }

    # These two small project services still build locally; OmniRoute does NOT.
    & docker compose -f docker-compose.yml -f deploy/compose-home.yml build browser opendots
    if ($LASTEXITCODE -ne 0) { throw "OpenDots or browser image build failed." }

    & docker compose -f docker-compose.yml -f deploy/compose-home.yml up -d --no-build redis omniroute browser opendots
    if ($LASTEXITCODE -ne 0) { throw "Docker Compose services did not start successfully." }
    & docker compose -f docker-compose.yml -f deploy/compose-home.yml ps
    if ($LASTEXITCODE -ne 0) { throw "Unable to read service status." }
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
