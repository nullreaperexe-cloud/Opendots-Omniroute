#Requires -Version 5.1
<#
Checks the local OpenDots CopilotKit route, Vercel Edge forwarding, and the
private OmniRoute model endpoint without ever printing secret credentials.
#>
[CmdletBinding()]
param(
  [string]$VercelOrigin = "https://opendots-omniroute.vercel.app"
)
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$envFile = Join-Path $root ".env"
if (!(Test-Path -LiteralPath $envFile)) { throw "Missing private .env." }

function ValueFor([string]$name) {
  $matched = @(Get-Content -LiteralPath $envFile | Where-Object { $_.StartsWith($name + "=") })
  if ($matched.Count -ne 1) { throw "Missing or duplicate $name in .env" }
  return $matched[0].Substring($name.Length + 1)
}
$owner = ValueFor "OWNER_TOKEN"
$gatewayKey = ValueFor "OMNIROUTE_API_KEY"
if (!$owner -or $owner.Length -lt 24) { throw "OWNER_TOKEN is missing or short." }
$origin = [uri]$VercelOrigin
if ($origin.Scheme -ne "https" -or $origin.AbsolutePath -ne "/" -or
    !$origin.Host.EndsWith(".vercel.app")) {
  throw "Expected a bare HTTPS Vercel frontend origin."
}

function Check([string]$name, [string]$url, [string]$key, [string]$requestOrigin) {
  $headers = @{ Authorization = "Bearer $key" }
  if ($requestOrigin) { $headers["Origin"] = $requestOrigin }
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $url -Method GET -Headers $headers -TimeoutSec 25
    Write-Host ("[OK] {0}: HTTP {1}, {2}" -f $name, [int]$response.StatusCode, $response.Headers["Content-Type"])
    if ($name -eq "OmniRoute models") {
      try {
        $parsed = ConvertFrom-Json -InputObject $response.Content
        if ($null -ne $parsed.data) {
          $count = @($parsed.data).Count
          Write-Host "   OmniRoute reports $count model(s)."
          if ($count -eq 0) { Write-Warning "No routable models. Connect a provider from the local OmniRoute dashboard." }
        }
      } catch { Write-Warning "Could not parse model catalog JSON." }
    }
  } catch {
    $httpResponse = $_.Exception.Response
    if ($null -ne $httpResponse) {
      Write-Warning ("{0}: HTTP {1}" -f $name, [int]$httpResponse.StatusCode)
    } else {
      Write-Warning ("{0}: No HTTP response (backend or network unavailable)." -f $name)
    }
  }
}

Check "Local CopilotKit runtime" "http://127.0.0.1:4310/api/copilotkit/info" $owner $VercelOrigin
Check "Vercel CopilotKit proxy" "$VercelOrigin/api/copilotkit/info" $owner $VercelOrigin
Check "OmniRoute models" "http://127.0.0.1:20128/v1/models" $gatewayKey ""
Write-Host "No secret token or API key was displayed. Test an actual chat once a provider is connected."
