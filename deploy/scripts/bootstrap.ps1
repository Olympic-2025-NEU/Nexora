# SPDX-License-Identifier: AGPL-3.0-only
param([ValidateSet('a', 'b', 'c')][string]$Instance = 'a')
$ErrorActionPreference = 'Stop'
Set-Location (Resolve-Path (Join-Path $PSScriptRoot '../..'))
node deploy/scripts/prepare.mjs $Instance
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
$envFile = "deploy/instances/$Instance.env"
node deploy/config.mjs --file $envFile
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
node deploy/scripts/render-apisix-routes.mjs $envFile
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
# Empty certs dir so Compose can mount ./certs even before mkcert runs.
New-Item -ItemType Directory -Force -Path deploy/certs | Out-Null
if (-not (Test-Path deploy/certs/.gitkeep)) { Set-Content -Path deploy/certs/.gitkeep -Value '' }
docker compose -f deploy/compose.yml --env-file $envFile -p "nexora-$Instance" --profile apps config -q
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Output "Ready: docker compose -f deploy/compose.yml --env-file $envFile -p nexora-$Instance --profile apps up -d --build"
