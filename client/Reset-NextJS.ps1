$port = 3000
$tcpConnections = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
if ($tcpConnections) {
    foreach ($conn in $tcpConnections) {
        Write-Host "Killing zombie Next.js server (PID: $($conn.OwningProcess)) on port $port..."
        Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue
    }
}
Write-Host "Wiping corrupted .next cache..."
Remove-Item -Recurse -Force .next -ErrorAction SilentlyContinue
Write-Host "Starting Next.js securely..."
npm run dev
