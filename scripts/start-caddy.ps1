# Ensures the local Caddy reverse proxy is running before dev servers start,
# so https://auth-dev.milissai.com and https://auth-api-dev.milissai.com
# work without a manual step every session.
#
# This machine runs ONE shared Caddy instance on :443/:2019 across multiple
# repos (this one plus content-social-automation today), config combined at
# ~/.caddy/Caddyfile, which imports each repo's own Caddyfile (including
# this repo's -- see ./Caddyfile at repo root for the actual routes). We
# point at the shared file here instead of the repo-root one so starting
# Caddy from this repo doesn't clobber other repos' routes.
#
# Binding to :443 requires elevation on Windows, so when Caddy isn't already
# up this launches it in a new elevated, detached window (one UAC prompt).
# If Caddy is already running, this is a no-op — no prompt, no relaunch.
#
# This proxy is optional (see README.md §6b) — Caddy not being installed
# must never block `pnpm dev` for the plain `localhost` setup, so a missing
# binary or a failed launch only warns here instead of throwing.

$caddyfile = Join-Path $env:USERPROFILE '.caddy\Caddyfile'
$caddyDir = Split-Path -Parent $caddyfile

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

if (-not (Get-Command caddy -ErrorAction SilentlyContinue)) {
    Write-Warning '[start-caddy] caddy not found on PATH — skipping the optional prod-hostname proxy (see README.md §6b). `pnpm dev` will continue against plain localhost ports.'
    exit 0
}

Write-Host '[start-caddy] Caddy not running — starting elevated (Caddyfile: '"$caddyfile"')...'

try {
    Start-Process -FilePath 'caddy' `
        -ArgumentList @('run', '--config', "`"$caddyfile`"") `
        -WorkingDirectory $repoRoot `
        -Verb RunAs `
        -WindowStyle Normal `
        -ErrorAction Stop
} catch {
    Write-Warning ('[start-caddy] Failed to launch Caddy ({0}) — skipping the optional prod-hostname proxy. pnpm dev will continue against plain localhost ports.' -f $_)
    exit 0
}

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
