# Ensures the local Caddy reverse proxy (Caddyfile at repo root) is running
# before dev servers start, so https://auth-dev.milissai.com and
# https://auth-api-dev.milissai.com work without a manual step every session.
#
# Binding to :443 requires elevation on Windows, so when Caddy isn't already
# up this launches it in a new elevated, detached window (one UAC prompt).
# If Caddy is already running, this is a no-op — no prompt, no relaunch.

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$caddyfile = Join-Path $repoRoot 'Caddyfile'

function Test-CaddyRunning {
    try {
        Invoke-RestMethod -Uri 'http://localhost:2019/config/' -TimeoutSec 2 -ErrorAction Stop | Out-Null
        return $true
    } catch {
        return $false
    }
}

if (Test-CaddyRunning) {
    Write-Host '[start-caddy] Caddy already running — skipping.'
    exit 0
}

Write-Host '[start-caddy] Caddy not running — starting elevated (Caddyfile: '"$caddyfile"')...'

Start-Process -FilePath 'caddy' `
    -ArgumentList @('run', '--config', "`"$caddyfile`"") `
    -WorkingDirectory $repoRoot `
    -Verb RunAs `
    -WindowStyle Normal

# Give it a moment to bind :443 before the rest of `pnpm dev` proceeds.
$deadline = (Get-Date).AddSeconds(15)
while (-not (Test-CaddyRunning)) {
    if ((Get-Date) -gt $deadline) {
        Write-Warning '[start-caddy] Caddy did not report ready within 15s — continuing anyway.'
        break
    }
    Start-Sleep -Milliseconds 500
}

Write-Host '[start-caddy] Caddy is up.'
