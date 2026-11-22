# ============================================================================
#  Sanwa系统管理器 · 停止服务
#  只停止「本控制中心」的 Node 进程（校验命令行包含 server.js，避免误杀其它 node）。
#  用法：powershell -NoProfile -ExecutionPolicy Bypass -File stop-hub.ps1
# ============================================================================
param(
    [int]$Port = 9900
)

$ErrorActionPreference = 'Stop'

$root     = Split-Path -Parent $PSScriptRoot
$serverJs = Join-Path $root 'server.js'
$pidFile  = Join-Path (Join-Path $root 'data') 'hub.pid'

function Test-HubPort {
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $iar = $client.BeginConnect('127.0.0.1', $Port, $null, $null)
        $ok = $iar.AsyncWaitHandle.WaitOne(800, $false)
        if ($ok -and $client.Connected) { return $true }
        return $false
    } catch {
        return $false
    } finally {
        try { $client.Close() } catch { }
    }
}

function Get-ProcCmdLine {
    param([int]$ProcId)
    try {
        $info = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $ProcId) -ErrorAction SilentlyContinue
        if ($info) { return [string]$info.CommandLine }
    } catch { }
    return ''
}

Write-Host ''
Write-Host '  Sanwa系统管理器 · 停止服务' -ForegroundColor Magenta
Write-Host '  -------------------------------------------------' -ForegroundColor DarkGray

if (-not (Test-HubPort)) {
    Write-Host '  [OK] 控制服务当前未在运行。' -ForegroundColor Green
    if (Test-Path -LiteralPath $pidFile) {
        try { Remove-Item -LiteralPath $pidFile -Force } catch { }
    }
    exit 0
}

# 优先使用 pid 文件，其次按监听端口反查
$targetPid = 0
if (Test-Path -LiteralPath $pidFile) {
    try {
        $raw = [System.IO.File]::ReadAllText($pidFile, [System.Text.Encoding]::UTF8)
        $rec = $raw | ConvertFrom-Json
        $targetPid = [int]$rec.pid
    } catch { $targetPid = 0 }
}
if ($targetPid -le 0) {
    try {
        $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($conn) { $targetPid = [int]$conn.OwningProcess }
    } catch { }
}
if ($targetPid -le 0) {
    Write-Host '  [X] 端口 9900 被占用，但无法确定所属进程。' -ForegroundColor Red
    exit 1
}

$proc = Get-Process -Id $targetPid -ErrorAction SilentlyContinue
if (-not $proc) {
    Write-Host '  [OK] 进程已不存在，清理记录后退出。' -ForegroundColor Green
    try { Remove-Item -LiteralPath $pidFile -Force } catch { }
    exit 0
}

$cmdLine = Get-ProcCmdLine -ProcId $targetPid
if (-not $cmdLine -or ($cmdLine -notmatch 'server\.js')) {
    Write-Host ('  [X] 监听 9900 的进程（PID ' + $targetPid + '，' + $proc.ProcessName + '）不是本控制中心，') -ForegroundColor Red
    Write-Host '      出于安全考虑不会停止它。' -ForegroundColor Red
    exit 2
}
if ($proc.ProcessName -ne 'node') {
    Write-Host ('  [X] PID ' + $targetPid + ' 不是 node 进程（' + $proc.ProcessName + '），出于安全考虑不会停止它。') -ForegroundColor Red
    exit 2
}

Write-Host ('  [>] 正在停止控制服务（PID ' + $targetPid + '）…')
try {
    Stop-Process -Id $targetPid -Force -ErrorAction Stop
} catch {
    Write-Host ('  [X] 停止失败：' + $_.Exception.Message) -ForegroundColor Red
    exit 3
}

$deadline = (Get-Date).AddSeconds(8)
while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 300
    if (-not (Test-HubPort)) { break }
}
if (Test-HubPort) {
    Write-Host '  [X] 服务端口仍在监听，可能未完全退出。' -ForegroundColor Red
    exit 3
}

try { Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue } catch { }
Write-Host '  [OK] 控制服务已停止。' -ForegroundColor Green
Write-Host ''
exit 0
