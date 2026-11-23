# SPDX-License-Identifier: AGPL-3.0-only
# Start Nexora infrastructure for host-side Next.js (`npm run dev`) — no apps image build.
param(
  [ValidateSet('a', 'b', 'c')][string]$Instance = 'a',
  [string]$Project = 'nexora'
)
$ErrorActionPreference = 'Stop'
Set-Location (Resolve-Path (Join-Path $PSScriptRoot '../..'))

node deploy/scripts/prepare.mjs $Instance
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
$envFile = "deploy/instances/$Instance.env"
if (-not (Test-Path $envFile)) {
  Write-Error "Missing $envFile — run bootstrap first or copy from .env.example"
  exit 1
}
node deploy/config.mjs --file $envFile
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
node deploy/scripts/render-apisix-routes.mjs $envFile
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

New-Item -ItemType Directory -Force -Path deploy/certs | Out-Null
if (-not (Test-Path deploy/certs/.gitkeep)) { Set-Content -Path deploy/certs/.gitkeep -Value '' }

Write-Output "Starting infrastructure (project=$Project, local-admin overlay, no --profile apps)..."
# Docker Compose writes informational warnings to stderr; with $ErrorActionPreference=Stop
# PowerShell would treat those as terminating errors even when exit code is 0.
$prevEap = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
docker compose -f deploy/compose.yml -f deploy/compose.local-admin.yml --env-file $envFile -p $Project up -d
$composeExit = $LASTEXITCODE
$ErrorActionPreference = $prevEap
if ($composeExit -ne 0) { exit $composeExit }

$port = '15432'
foreach ($line in Get-Content $envFile) {
  if ($line -match '^\s*POSTGRES_HOST_PORT\s*=\s*(.+)\s*$') {
    $port = $Matches[1].Trim().Trim('"').Trim("'")
  }
}

Write-Output ""
Write-Output "Infra is up. Containers use the nexora- prefix (e.g. nexora-postgres)."
Write-Output "For host Prisma / Next, point DATABASE_URL at loopback (replace host postgres):"
Write-Output "  ...@127.0.0.1:${port}/nexora"
Write-Output ""
Write-Output "Then from repo root:"
Write-Output "  `$env:DATABASE_URL = '<APP_DATABASE_URL with postgres -> 127.0.0.1:$port>'"
Write-Output "  npm run db:migrate"
Write-Output "  npm run dev"
Write-Output ""
Write-Output "Full Docker apps stack (slow build): docker compose ... --profile apps up -d"
