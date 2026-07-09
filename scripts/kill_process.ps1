param (
    [Parameter(Mandatory=$true, HelpMessage="Enter the port number to clear")]
    [int]$Port
)

Write-Host "Searching for active connections on port $Port..." -ForegroundColor Cyan

# Find connections bound to the target port
$connections = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue

if ($connections) {
    # Extract unique process IDs (PIDs) using the port
    $pids = $connections.OwningProcess | Select-Object -Unique
    
    foreach ($pid in $pids) {
        try {
            $proc = Get-Process -Id $pid -ErrorAction SilentlyContinue
            if ($proc) {
                Write-Host "Found process '$($proc.Name)' (PID: $pid) on port $Port. Terminating..." -ForegroundColor Yellow
                Stop-Process -Id $pid -Force
                Write-Host "[SUCCESS] Terminated process on port $Port." -ForegroundColor Green
            }
        }
        catch {
            Write-Error "Failed to terminate PID $pid. Ensure you are running PowerShell as Administrator."
        }
    }
} else {
    Write-Host "[INFO] No active processes are using port $Port." -ForegroundColor Green
}
