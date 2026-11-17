# SPDX-License-Identifier: AGPL-3.0-only
param([ValidateSet('a', 'b', 'c')][string]$Instance = 'a')
$ErrorActionPreference = 'Stop'
Set-Location (Resolve-Path (Join-Path $PSScriptRoot '../..'))
node deploy/scripts/prepare.mjs $Instance
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
$envFile = "deploy/instances/$Instance.env"
node deploy/config.mjs --file $envFile
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
docker compose -f deploy/compose.yml --env-file $envFile -p "nexora-$Instance" config -q
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Output "Ready: docker compose -f deploy/compose.yml --env-file $envFile -p nexora-$Instance up -d --build"
