# Kills whatever process is listening on the given TCP port. Used by
# `make kill-auth-server` to free :3010 when a previous `pnpm start` /
# `nest start --watch` run didn't exit cleanly and is still holding it,
# blocking a fresh start-auth-server/start-no-watch run.
#
# No-op (not an error) if nothing is listening -- this is meant to be safe
# to run speculatively "just in case" before starting a server.

param(
    [Parameter(Mandatory = $true)]
    [int]$Port
)

$pids = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique

if (-not $pids) {
    Write-Host "[kill-port] Nothing listening on :$Port."
    exit 0
}

foreach ($processId in $pids) {
    Write-Host "[kill-port] Killing PID $processId on :$Port"
    Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
}
