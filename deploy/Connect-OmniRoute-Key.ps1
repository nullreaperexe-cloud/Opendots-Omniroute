#Requires -Version 5.1
<#
Connects the user's locally created OmniRoute Endpoint API key to OpenDots.
The key is entered through a hidden local prompt, never printed or uploaded.
Requires an OmniRoute provider and Endpoint to already be configured through
the loopback-only dashboard http://127.0.0.1:20128.
#>
[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$envFile = Join-Path $root ".env"
if (!(Test-Path -LiteralPath $envFile -PathType Leaf)) {
  throw "Missing private .env. Run Start-OpenDots-Home.ps1 first."
}

Write-Host "Open OmniRoute dashboard locally: http://127.0.0.1:20128"
Write-Host "1. Providers: connect an eligible provider with your OWN credentials."
Write-Host "2. Endpoints/API Keys: create an Endpoint key with chat permission."
Write-Host "3. Paste that Endpoint key at the hidden prompt below."
$secure = Read-Host "OmniRoute Endpoint API key (hidden)" -AsSecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  $apiKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
}
if (!$apiKey -or $apiKey -notmatch '^[A-Za-z0-9_.~-]{16,}$') {
  throw "Invalid Endpoint key format; do not use your OpenDots OWNER_TOKEN or a provider key here."
}
if ($apiKey -eq "private-internal-router") {
  throw "This is only the template placeholder. Create an actual OmniRoute Endpoint key."
}

# Preserve every other setting, especially OWNER_TOKEN, browser credentials,
# and APP_ORIGIN. Do not echo private file contents to the terminal.
$lines = @(Get-Content -LiteralPath $envFile)
$keyFound = $false
$enforcementFound = $false
for ($i = 0; $i -lt $lines.Count; $i++) {
  if ($lines[$i] -match '^OMNIROUTE_API_KEY=') {
    $lines[$i] = "OMNIROUTE_API_KEY=$apiKey"
    $keyFound = $true
  } elseif ($lines[$i] -match '^OMNIROUTE_REQUIRE_API_KEY=') {
    $lines[$i] = "OMNIROUTE_REQUIRE_API_KEY=true"
    $enforcementFound = $true
  }
}
if (!$keyFound) { $lines += "OMNIROUTE_API_KEY=$apiKey" }
if (!$enforcementFound) { $lines += "OMNIROUTE_REQUIRE_API_KEY=true" }
[IO.File]::WriteAllText(
  $envFile,
  ($lines -join [Environment]::NewLine) + [Environment]::NewLine,
  [Text.Encoding]::ASCII
)
$apiKey = $null
Write-Host "Saved OmniRoute Endpoint key locally (hidden). Existing owner and browser tokens preserved."

Push-Location $root
try {
  & docker compose -f docker-compose.yml -f deploy/compose-home.yml config --quiet
  if ($LASTEXITCODE -ne 0) { throw "Compose configuration is invalid." }
  & docker compose -f docker-compose.yml -f deploy/compose-home.yml up -d --no-build --force-recreate omniroute opendots
  if ($LASTEXITCODE -ne 0) { throw "Services failed to restart. Check Docker Desktop." }
  & docker compose -f docker-compose.yml -f deploy/compose-home.yml ps
} finally {
  Pop-Location
}
Write-Host "OmniRoute Endpoint authorization is enabled. Test chat after configuring a working provider/model."
