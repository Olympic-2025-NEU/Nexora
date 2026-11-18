# SPDX-License-Identifier: AGPL-3.0-only
# gen-local-certs.ps1 — Generate mkcert TLS certificates for local Nexora stack.
#
# Requires: mkcert (https://github.com/FiloSottile/mkcert)
#   Install via: winget install FiloSottile.mkcert
#             OR: choco install mkcert
#             OR: scoop install mkcert
#
# Output: deploy\certs\local.pem and deploy\certs\local-key.pem
# These files are gitignored. Run once per machine.
#
# Usage: .\deploy\scripts\gen-local-certs.ps1
#        Run from the repository root (e.g. e:\Working\Nexora\nexora)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$CertsDir = Join-Path $ScriptDir "..\certs"
$CertsDir = Resolve-Path $CertsDir

Write-Host "==> Checking mkcert installation..." -ForegroundColor Cyan
try {
    $null = Get-Command mkcert -ErrorAction Stop
} catch {
    Write-Error @"
ERROR: mkcert not found. Install via one of:
  winget install FiloSottile.mkcert
  choco install mkcert
  scoop install mkcert

See: https://github.com/FiloSottile/mkcert
"@
    exit 1
}

Write-Host "==> Installing local CA (may prompt for UAC)..." -ForegroundColor Cyan
mkcert -install

Write-Host "==> Generating certificates in $CertsDir ..." -ForegroundColor Cyan
Push-Location $CertsDir
try {
    mkcert `
      -cert-file local.pem `
      -key-file local-key.pem `
      localhost `
      "*.localhost" `
      127.0.0.1 `
      "::1"
} finally {
    Pop-Location
}

Write-Host ""
Write-Host "SUCCESS: Certificates generated:" -ForegroundColor Green
Write-Host "  $CertsDir\local.pem"
Write-Host "  $CertsDir\local-key.pem"
Write-Host ""
Write-Host "Mount these in docker-compose via:" -ForegroundColor Yellow
Write-Host "  volumes:"
Write-Host "    - ./certs/local.pem:/usr/local/apisix/conf/certs/local.pem:ro"
Write-Host "    - ./certs/local-key.pem:/usr/local/apisix/conf/certs/local-key.pem:ro"
Write-Host ""
Write-Host "Set in .env:" -ForegroundColor Yellow
Write-Host '  PUBLIC_BASE_URL=https://127.0.0.1:${GATEWAY_HTTPS_PORT:-19443}'
Write-Host ""
Write-Host "NODE_EXTRA_CA_CERTS (for Node.js to trust local CA):" -ForegroundColor Yellow
$caRoot = (mkcert -CAROOT).Trim()
Write-Host "  `$env:NODE_EXTRA_CA_CERTS = '$caRoot\rootCA.pem'"
