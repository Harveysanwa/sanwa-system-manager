# ============================================================================
#  Sanwa系统管理器 · PowerShell 公共函数库
#  兼容 Windows PowerShell 5.1（本机实际可用的 PowerShell）
#  被 scripts\*.ps1 脚本点源引用：. (Join-Path $PSScriptRoot '_common.ps1')
# ============================================================================

$ErrorActionPreference = 'Stop'

# 让写入 stdout 的中文以 UTF-8 编码（Node 服务端按 UTF-8 解码）
try {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    $OutputEncoding = [System.Text.Encoding]::UTF8
} catch { }

# ------------------------------------------------------------------ 路径常量

if ($env:SANWA_HOME) { $script:HubRoot = [System.IO.Path]::GetFullPath($env:SANWA_HOME) } else { $script:HubRoot = Split-Path -Parent $PSScriptRoot }
if (-not $env:SANWA_HOME) { $env:SANWA_HOME = $script:HubRoot }
if (-not $env:SANWA_AI_ROOT) { $env:SANWA_AI_ROOT = Join-Path $env:USERPROFILE 'AI' }
if (-not $env:SANWA_MODELS_ROOT) { $env:SANWA_MODELS_ROOT = Join-Path $env:SANWA_AI_ROOT 'models' }
if (-not $env:SANWA_PORT) { $env:SANWA_PORT = '9900' }
$script:HubPort = [int]$env:SANWA_PORT
$script:DataDir     = if ($env:SANWA_DATA_DIR) { [System.IO.Path]::GetFullPath($env:SANWA_DATA_DIR) } else { Join-Path $HubRoot 'data' }
$script:ConfigPath  = Join-Path $DataDir 'tools.json'
$script:LogsDir     = if ($env:SANWA_LOG_DIR) { [System.IO.Path]::GetFullPath($env:SANWA_LOG_DIR) } else { Join-Path $HubRoot 'logs' }
$script:PidsDir     = Join-Path $DataDir 'pids'
$script:DesktopHtml = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Sanwa系统管理器.html'
$script:HubUrl      = ('http://127.0.0.1:' + $script:HubPort + '/')
$script:HubScripts  = Join-Path $HubRoot 'scripts'

# 确保基础目录存在
foreach ($dir in @($DataDir, $LogsDir, $PidsDir)) {
    if (-not (Test-Path -LiteralPath $dir)) {
        try { New-Item -ItemType Directory -Force -Path $dir | Out-Null } catch { }
    }
}

# ------------------------------------------------------------------ 日志

function Write-ToolLog {
    param(
        [string]$Id = 'hub',
        [string]$Message
    )
    try {
        if (-not (Test-Path -LiteralPath $LogsDir)) {
            New-Item -ItemType Directory -Force -Path $LogsDir | Out-Null
        }
        $line = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + ' ' + $Message
        Add-Content -LiteralPath (Join-Path $LogsDir ($Id + '.log')) -Value $line -Encoding UTF8
    } catch { }
}

function Write-Step  { param([string]$Text) Write-Host ('  [>] ' + $Text) -ForegroundColor Cyan }
function Write-Ok    { param([string]$Text) Write-Host ('  [OK] ' + $Text) -ForegroundColor Green }
function Write-Warn  { param([string]$Text) Write-Host ('  [!] ' + $Text) -ForegroundColor Yellow }
function Write-Fail  { param([string]$Text) Write-Host ('  [X] ' + $Text) -ForegroundColor Red }

# ------------------------------------------------------------------ 配置读取

function Expand-EnvTree {
    param($Node)
    if ($null -eq $Node) { return $null }
    if ($Node -is [string]) { return [Environment]::ExpandEnvironmentVariables($Node) }
    if ($Node -is [System.Collections.IEnumerable] -and -not ($Node -is [string])) {
        $arr = @()
        foreach ($x in $Node) { $arr += Expand-EnvTree $x }
        return ,$arr
    }
    if ($Node -is [System.Management.Automation.PSCustomObject]) {
        $copy = [ordered]@{}
        foreach ($p in $Node.PSObject.Properties) { $copy[$p.Name] = Expand-EnvTree $p.Value }
        return [pscustomobject]$copy
    }
    return $Node
}

function Read-HubConfig {
    if (-not (Test-Path -LiteralPath $ConfigPath)) {
        throw ('未找到工具配置文件：' + $ConfigPath)
    }
    $raw = [System.IO.File]::ReadAllText($ConfigPath, [System.Text.Encoding]::UTF8)
    $cfg = $raw | ConvertFrom-Json
    $cfg = Expand-EnvTree $cfg
    if (-not $cfg.tools) { throw 'tools.json 缺少 tools 数组' }
    return $cfg
}

function Get-ToolConfig {
    param($Config, [string]$Id)
    foreach ($t in @($Config.tools)) {
        if ($t.id -eq $Id) { return $t }
    }
    return $null
}

function Get-ToolUrl {
    param($Tool)
    if ($null -eq $Tool) { return '' }
    if ($Tool.launch -and $Tool.launch.url) { return [string]$Tool.launch.url }
    if ($Tool.url) { return [string]$Tool.url }
    return ''
}

# ------------------------------------------------------------------ 健康检查

function Test-TcpHealth {
    param([int]$Port, [int]$TimeoutMs = 1200)
    if ($Port -le 0 -or $Port -gt 65535) { return 'unknown' }
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $iar = $client.BeginConnect('127.0.0.1', $Port, $null, $null)
        $ok = $iar.AsyncWaitHandle.WaitOne($TimeoutMs, $false)
        if ($ok -and $client.Connected) { return 'running' }
        return 'stopped'
    } catch {
        return 'stopped'
    } finally {
        try { $client.Close() } catch { }
    }
}

function Test-HttpHealth {
    param([string]$Url, [int]$TimeoutMs = 1500)
    if (-not $Url) { return 'unknown' }
    try {
        $req = [System.Net.HttpWebRequest]::Create($Url)
        $req.Proxy = $null
        $req.Timeout = $TimeoutMs
        $req.ReadWriteTimeout = $TimeoutMs
        $req.Method = 'GET'
        $req.UserAgent = 'Sanwa-PS-Probe/1.0'
        $resp = $req.GetResponse()
        $resp.Close()
        return 'running'
    } catch [System.Net.WebException] {
        if ($_.Exception.Response) {
            # 401 / 403 / 500 等：能收到 HTTP 响应即说明服务活着
            try { $_.Exception.Response.Close() } catch { }
            return 'running'
        }
        return 'stopped'
    } catch {
        return 'unknown'
    }
}

function Test-ProcessHealth {
    param($Names)
    $list = @($Names)
    foreach ($n in $list) {
        $name = [string]$n
        if (-not $name) { continue }
        if ($name.ToLower().EndsWith('.exe')) {
            $name = [System.IO.Path]::GetFileNameWithoutExtension($name)
        }
        if (Get-Process -Name $name -ErrorAction SilentlyContinue) { return 'running' }
    }
    return 'stopped'
}

function Get-ToolHealth {
    param($Tool)
    if ($null -eq $Tool) { return 'unknown' }
    $h = $Tool.health
    if ($null -eq $h -or -not $h.type) { return 'unknown' }
    $timeout = 1500
    if ($h.timeoutMs) { $timeout = [int]$h.timeoutMs }
    switch ([string]$h.type) {
        'http'    { return (Test-HttpHealth -Url ([string]$h.url) -TimeoutMs $timeout) }
        'tcp'     { return (Test-TcpHealth -Port ([int]$h.port) -TimeoutMs $timeout) }
        'process' { return (Test-ProcessHealth -Names $h.process) }
        default   { return 'unknown' }
    }
}

# ------------------------------------------------------------------ 打开界面

function Open-Target {
    param([string]$Target)
    if (-not $Target) { throw '要打开的目标为空' }
    if ($Target -match '^https?://') {
        Start-Process -FilePath $Target | Out-Null
        return
    }
    if (Test-Path -LiteralPath $Target) {
        $item = Get-Item -LiteralPath $Target
        if ($item.PSIsContainer) {
            Start-Process -FilePath 'explorer.exe' -ArgumentList ('"' + $item.FullName + '"') | Out-Null
        } else {
            Start-Process -FilePath $item.FullName | Out-Null
        }
        return
    }
    throw ('无法打开（目标不存在或格式不支持）：' + $Target)
}

# ------------------------------------------------------------------ 进程记录

function Get-ToolPidFile {
    param([string]$Id)
    return (Join-Path $PidsDir ($Id + '.json'))
}

function Save-ToolPidRecord {
    param(
        [string]$Id,
        [int]$ProcessId,
        [string]$ExePath,
        [string]$StartTime
    )
    $record = [ordered]@{
        id         = $Id
        pid        = $ProcessId
        exe        = $ExePath
        startedAt  = $StartTime
        startedBy  = 'Sanwa'
        recordedAt = (Get-Date).ToString('o')
    }
    $json = $record | ConvertTo-Json -Compress
    $file = Get-ToolPidFile -Id $Id
    $enc = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($file, $json, $enc)
}

function Save-ServicePidRecord {
    param([string]$Id, [string]$ServiceName)
    $record = [ordered]@{
        id         = $Id
        kind       = 'service'
        service    = $ServiceName
        startedAt  = (Get-Date).ToString('o')
        startedBy  = 'Sanwa'
    }
    $json = $record | ConvertTo-Json -Compress
    $enc = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText((Get-ToolPidFile -Id $Id), $json, $enc)
}

function Read-ToolPidRecord {
    param([string]$Id)
    $file = Get-ToolPidFile -Id $Id
    if (-not (Test-Path -LiteralPath $file)) { return $null }
    try {
        $raw = [System.IO.File]::ReadAllText($file, [System.Text.Encoding]::UTF8)
        return ($raw | ConvertFrom-Json)
    } catch {
        return $null
    }
}

# ------------------------------------------------------------------ 停止（仅限本服务拉起的进程）

function Stop-OwnedProcess {
    param([string]$Id)

    $record = Read-ToolPidRecord -Id $Id
    if ($null -eq $record) {
        Write-Warn ('「' + $Id + '」不是由 Sanwa系统管理器启动的，出于安全考虑不会停止它。')
        return 2
    }

    # Windows 服务型
    if ($record.kind -eq 'service') {
        $svcName = [string]$record.service
        try {
            Stop-Service -Name $svcName -Force -ErrorAction Stop
            Remove-Item -LiteralPath (Get-ToolPidFile -Id $Id) -Force
            Write-Ok ('服务 ' + $svcName + ' 已停止。')
            Write-ToolLog -Id $Id -Message ('已停止 Windows 服务 ' + $svcName)
            return 0
        } catch {
            Write-Fail ('停止服务失败：' + $_.Exception.Message)
            Write-ToolLog -Id $Id -Message ('停止服务失败：' + $_.Exception.Message)
            return 3
        }
    }

    $targetPid = [int]$record.pid
    if ($targetPid -le 0) {
        Remove-Item -LiteralPath (Get-ToolPidFile -Id $Id) -Force -ErrorAction SilentlyContinue
        Write-Warn '启动记录损坏，已清理。'
        return 0
    }

    $proc = Get-Process -Id $targetPid -ErrorAction SilentlyContinue
    if (-not $proc) {
        Remove-Item -LiteralPath (Get-ToolPidFile -Id $Id) -Force -ErrorAction SilentlyContinue
        Write-Ok '进程已经不存在，已清理启动记录。'
        Write-ToolLog -Id $Id -Message '进程已不存在，已清理启动记录'
        return 0
    }

    # 安全校验一：可执行文件名
    $expectedExe = [string]$record.exe
    if ($expectedExe) {
        $expectedName = [System.IO.Path]::GetFileNameWithoutExtension($expectedExe)
        if ($proc.ProcessName -and $expectedName -and ($proc.ProcessName -ne $expectedName)) {
            Write-Warn ('PID ' + $targetPid + ' 当前是「' + $proc.ProcessName + '」，与记录的「' + $expectedName + '」不符，为安全起见不停止。')
            return 2
        }
    }

    # 安全校验二：完整路径（仅当记录中是完整路径时才校验）
    try {
        $actualPath = $proc.Path
        if ($actualPath -and $expectedExe -and [System.IO.Path]::IsPathRooted($expectedExe)) {
            $a = [System.IO.Path]::GetFullPath($actualPath)
            $b = [System.IO.Path]::GetFullPath($expectedExe)
            if ($a -ne $b) {
                Write-Warn '检测到 PID 已被其它进程复用（可执行路径不匹配），为安全起见不停止。'
                return 2
            }
        }
    } catch { }

    # 安全校验三：启动时间（防止 PID 复用）
    try {
        $recordedAt = [datetime]::Parse([string]$record.startedAt, [System.Globalization.CultureInfo]::InvariantCulture, [System.Globalization.DateTimeStyles]::RoundtripKind)
        $diff = [math]::Abs((($proc.StartTime) - $recordedAt).TotalSeconds)
        if ($diff -gt 180) {
            Write-Warn '检测到进程启动时间与记录不符（PID 可能被复用），为安全起见不停止。'
            return 2
        }
    } catch { }

    Write-Step ('正在停止 ' + $Id + '（PID ' + $targetPid + ' 及其子进程）…')
    $taskkill = Join-Path $env:SystemRoot 'System32\taskkill.exe'
    try {
        & $taskkill /PID $targetPid /T /F 2>&1 | Out-Null
    } catch { }
    Start-Sleep -Milliseconds 600
    $still = Get-Process -Id $targetPid -ErrorAction SilentlyContinue
    if ($still) {
        Write-Fail ('PID ' + $targetPid + ' 未能停止，可能需要管理员权限。')
        Write-ToolLog -Id $Id -Message ('taskkill 未能停止 PID ' + $targetPid)
        return 3
    }
    Remove-Item -LiteralPath (Get-ToolPidFile -Id $Id) -Force -ErrorAction SilentlyContinue
    Write-Ok ($Id + ' 已停止。')
    Write-ToolLog -Id $Id -Message ('已停止 PID ' + $targetPid)
    return 0
}

# ------------------------------------------------------------------ 启动 exe

function ConvertTo-ArgString {
    param($ArgsList)
    $parts = @()
    foreach ($a in @($ArgsList)) {
        $s = [string]$a
        if ($s -eq '') { continue }
        if ($s -match '[\s"]') {
            $parts += ('"' + $s.Replace('"', '\"') + '"')
        } else {
            $parts += $s
        }
    }
    return ($parts -join ' ')
}

function Start-ToolExe {
    param($Tool, [switch]$DryRun)

    $launch = $Tool.launch
    $exe = [string]$launch.exe
    if (-not $exe) {
        Write-Fail '启动配置缺少 exe 路径。'
        return 3
    }
    if (-not (Test-Path -LiteralPath $exe)) {
        Write-Fail ('未找到可执行文件：' + $exe)
        Write-Warn '请确认对应磁盘（如外置盘）已连接，或等待阶段2更新为真实路径。'
        Write-ToolLog -Id $Tool.id -Message ('启动失败：未找到 exe ' + $exe)
        return 3
    }

    $cwd = [string]$launch.cwd
    if (-not $cwd -or -not (Test-Path -LiteralPath $cwd)) {
        $cwd = Split-Path -Parent $exe
    }
    $argString = ConvertTo-ArgString -ArgsList $launch.args
    $windowStyle = 'normal'
    if ($launch.windowStyle) { $windowStyle = [string]$launch.windowStyle }
    $method = ''
    if ($launch.method) { $method = [string]$launch.method }

    # 环境变量（只作用于本次启动的进程）
    if ($launch.env) {
        foreach ($prop in $launch.env.PSObject.Properties) {
            try { Set-Item -Path ('env:' + $prop.Name) -Value ([string]$prop.Value) } catch { }
        }
    }

    if ($DryRun) {
        Write-Host ('  [DryRun] 将执行：' + $exe + ' ' + $argString) -ForegroundColor DarkGray
        Write-Host ('  [DryRun] 工作目录：' + $cwd + '，窗口样式：' + $windowStyle + '，方式：' + $(if ($method) { $method } else { 'start-process' })) -ForegroundColor DarkGray
        return 0
    }

    # explorer.exe 拉起方式：某些 Electron 应用用 Start-Process 直接启动会静默退出（LM Studio 实测）
    if ($method -eq 'explorer') {
        Write-Step ('通过 explorer 拉起：' + $exe)
        try {
            Start-Process -FilePath (Join-Path $env:SystemRoot 'explorer.exe') -ArgumentList (Quote-ProcessArg $exe) | Out-Null
        } catch {
            Write-Fail ('explorer 拉起失败：' + $_.Exception.Message)
            Write-ToolLog -Id $Tool.id -Message ('explorer 拉起失败：' + $_.Exception.Message)
            return 3
        }
        $baseName = [System.IO.Path]::GetFileNameWithoutExtension($exe)
        $proc = $null
        for ($i = 0; $i -lt 12; $i++) {
            Start-Sleep -Milliseconds 700
            $proc = Get-Process -Name $baseName -ErrorAction SilentlyContinue | Select-Object -First 1
            if ($proc) { break }
        }
        if ($null -eq $proc) {
            Write-Warn 'explorer 已发起，但未在预期时间内发现进程（可能正在启动或被安全软件拦截）。'
            Write-ToolLog -Id $Tool.id -Message ('explorer 拉起后未发现进程：' + $exe)
            return 0
        }
        Save-ProcessPidRecord -Id $Tool.id -Proc $proc
        Write-ToolLog -Id $Tool.id -Message ('已通过 explorer 拉起 pid=' + $proc.Id + ' exe=' + $exe)
        Write-Ok ('已通过 explorer 拉起（PID ' + $proc.Id + '）。')
        return 0
    }

    Write-Step ('启动：' + $exe)
    if ($argString) { Write-Host ('        参数：' + $argString) -ForegroundColor DarkGray }
    try {
        if ($argString) {
            $proc = Start-Process -FilePath $exe -ArgumentList $argString -WorkingDirectory $cwd -WindowStyle $windowStyle -PassThru
        } else {
            $proc = Start-Process -FilePath $exe -WorkingDirectory $cwd -WindowStyle $windowStyle -PassThru
        }
    } catch {
        Write-Fail ('启动失败：' + $_.Exception.Message)
        Write-ToolLog -Id $Tool.id -Message ('启动失败：' + $_.Exception.Message)
        return 3
    }

    if ($null -eq $proc) {
        Write-Warn '进程已发起（无法获取 PID），停止功能可能不可用。'
        Write-ToolLog -Id $Tool.id -Message '进程已发起，未获取到 PID'
        return 0
    }

    $startTimeStr = $null
    try { $startTimeStr = (Get-Process -Id $proc.Id -ErrorAction Stop).StartTime.ToString('o') } catch { $startTimeStr = (Get-Date).ToString('o') }
    Save-ToolPidRecord -Id $Tool.id -ProcessId $proc.Id -ExePath $exe -StartTime $startTimeStr
    Write-ToolLog -Id $Tool.id -Message ('已启动 pid=' + $proc.Id + ' exe=' + $exe)
    Write-Ok ('已发起启动（PID ' + $proc.Id + '）。')
    return 0
}

# ------------------------------------------------------------------ 启动 MSIX 应用（shell:AppsFolder）

function Start-ToolAppx {
    param($Tool, [switch]$DryRun)

    $launch = $Tool.launch
    $appId = ''
    if ($launch.appxAppId) { $appId = [string]$launch.appxAppId }
    if (-not $appId) {
        $match = ''
        if ($launch.appxMatch) { $match = [string]$launch.appxMatch }
        if (-not $match) {
            Write-Fail 'launch.kind=appx 但未配置 appxAppId/appxMatch。'
            return 3
        }
        try {
            $apps = Get-StartApps -ErrorAction Stop
            $hit = $apps | Where-Object { $_.Name -match [regex]::Escape($match) } | Select-Object -First 1
            if ($hit) { $appId = [string]$hit.AppID }
        } catch { }
        if (-not $appId) {
            Write-Fail ('无法解析 MSIX 应用 AppID（匹配：' + $match + '）。')
            return 3
        }
    }

    if ($DryRun) {
        Write-Host ('  [DryRun] 将启动 MSIX 应用：shell:AppsFolder\' + $appId) -ForegroundColor DarkGray
        return 0
    }

    Write-Step ('启动 MSIX 应用：' + $appId)
    try {
        Start-Process -FilePath (Join-Path $env:SystemRoot 'explorer.exe') -ArgumentList ('shell:AppsFolder\' + $appId) | Out-Null
    } catch {
        Write-Fail ('MSIX 应用启动失败：' + $_.Exception.Message)
        Write-ToolLog -Id $Tool.id -Message ('MSIX 应用启动失败：' + $_.Exception.Message)
        return 3
    }
    Write-ToolLog -Id $Tool.id -Message ('已发起 MSIX 应用启动：' + $appId)
    Write-Ok 'MSIX 应用启动请求已发出。'
    return 0
}

# ------------------------------------------------------------------ 等待就绪

function Wait-ToolReady {
    param($Tool, [int]$TimeoutSec = 30)

    $healthType = ''
    if ($Tool.health -and $Tool.health.type) { $healthType = [string]$Tool.health.type }
    if ($healthType -eq 'none' -or $healthType -eq '') {
        Start-Sleep -Seconds 2
        Write-Warn '该工具没有配置端口/进程探测，已发起启动，请查看应用窗口。'
        return $true
    }
    if ($TimeoutSec -le 0) { $TimeoutSec = 30 }

    Write-Step ('等待 ' + $Tool.name + ' 就绪（最多 ' + $TimeoutSec + ' 秒）…')
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    $dots = 0
    while ((Get-Date) -lt $deadline) {
        if ((Get-ToolHealth -Tool $Tool) -eq 'running') {
            Write-Host ''
            Write-Ok ($Tool.name + ' 已就绪。')
            return $true
        }
        Start-Sleep -Milliseconds 1000
        Write-Host '.' -NoNewline
        $dots = $dots + 1
        if ($dots % 30 -eq 0) {
            Write-Host (' ' + [int]((Get-Date) - $deadline.AddSeconds(-$TimeoutSec)).TotalSeconds + 's') -ForegroundColor DarkGray
        }
    }
    Write-Host ''
    Write-Warn ('等待超时（' + $TimeoutSec + ' 秒）：' + $Tool.name + ' 可能仍在启动，也可能是启动失败。')
    Write-Warn ('请稍后刷新控制中心；日志：' + (Join-Path $LogsDir ($Tool.id + '.log')))
    Write-ToolLog -Id $Tool.id -Message ('等待就绪超时（' + $TimeoutSec + ' 秒）')
    return $false
}

# ------------------------------------------------------------------ 依赖启动

function Invoke-ToolDependencies {
    param($Config, $Tool, [switch]$DryRun)
    if (-not $Tool.launch -or -not $Tool.launch.dependsOn) { return 0 }
    foreach ($depId in @($Tool.launch.dependsOn)) {
        $depTool = Get-ToolConfig -Config $Config -Id ([string]$depId)
        if ($null -eq $depTool) {
            Write-Warn ('未找到依赖工具配置：' + $depId + '，已跳过。')
            continue
        }
        $state = Get-ToolHealth -Tool $depTool
        if ($state -eq 'running') {
            Write-Ok ('依赖 ' + $depTool.name + ' 已在运行。')
            continue
        }
        Write-Step ('先启动依赖：' + $depTool.name)
        if ($DryRun) {
            Write-Host ('  [DryRun] 将启动依赖 ' + $depId) -ForegroundColor DarkGray
            continue
        }
        $code = Invoke-ToolAction -Id ([string]$depId) -Action 'start' -NoOpen -IsDependency
        if ($code -ne 0) {
            Write-Fail ('依赖 ' + $depTool.name + ' 启动失败，已中止。')
            return $code
        }
        $waitSec = 45
        if ($depTool.launch -and $depTool.launch.waitSeconds) { $waitSec = [int]$depTool.launch.waitSeconds }
        if (-not (Wait-ToolReady -Tool $depTool -TimeoutSec $waitSec)) {
            Write-Fail ('依赖 ' + $depTool.name + ' 未能就绪，已中止。')
            return 3
        }
    }
    return 0
}

# ------------------------------------------------------------------ 启动脚本解析

function Resolve-ToolScriptPath {
    param([string]$ScriptPath)
    if (-not $ScriptPath) { return $null }
    if ([System.IO.Path]::IsPathRooted($ScriptPath)) { return $ScriptPath }
    return (Join-Path $HubScripts $ScriptPath)
}

function Test-OpenAfterReady {
    param($Launch)
    if ($null -eq $Launch) { return $true }
    $hasProp = @($Launch.PSObject.Properties.Name) -contains 'openAfterReady'
    if (-not $hasProp) { return $true }
    return [bool]$Launch.openAfterReady
}

function Quote-ProcessArg {
    param([string]$Value)
    $s = [string]$Value
    if ($s -eq '') { return '""' }
    if ($s -match '[\s"]') {
        return ('"' + $s.Replace('"', '\"') + '"')
    }
    return $s
}

function Save-ProcessPidRecord {
    param([string]$Id, $Proc)
    if ($null -eq $Proc) { return }
    $exePath = ''
    try { $exePath = [string]$Proc.Path } catch { }
    if (-not $exePath) {
        try { $exePath = [string](Get-Process -Id $Proc.Id -ErrorAction Stop).Path } catch { }
    }
    $startTimeStr = ''
    try {
        $startTimeStr = (Get-Process -Id $Proc.Id -ErrorAction Stop).StartTime.ToString('o')
    } catch {
        $startTimeStr = (Get-Date).ToString('o')
    }
    Save-ToolPidRecord -Id $Id -ProcessId $Proc.Id -ExePath $exePath -StartTime $startTimeStr
}

# ------------------------------------------------------------------ 主入口

function Invoke-ToolAction {
    param(
        [Parameter(Mandatory = $true)][string]$Id,
        [ValidateSet('start', 'stop', 'restart')][string]$Action = 'start',
        [switch]$NoOpen,
        [switch]$DryRun,
        [switch]$IsDependency
    )

    $config = Read-HubConfig
    $tool = Get-ToolConfig -Config $config -Id $Id
    if ($null -eq $tool) {
        Write-Fail ('未知工具 id：「' + $Id + '」（不在白名单内）')
        return 3
    }
    if (-not $IsDependency) {
        Write-Host ''
        Write-Host ('  Sanwa系统管理器 · ' + $tool.name) -ForegroundColor Magenta
        Write-Host ('  ------------------------------------------------') -ForegroundColor DarkGray
    }

    # ---- 停止 ----
    if ($Action -eq 'stop') {
        if ($DryRun) {
            Write-Host ('  [DryRun] 将停止 ' + $tool.name) -ForegroundColor DarkGray
            return 0
        }
        return (Stop-OwnedProcess -Id $Id)
    }

    # ---- 已运行：直接打开 ----
    $state = Get-ToolHealth -Tool $tool
    if ($state -eq 'running' -and $Action -ne 'restart') {
        Write-Ok ($tool.name + ' 已在运行，无需重复启动。')
        Write-ToolLog -Id $Id -Message '已在运行，跳过启动'
        $url = Get-ToolUrl -Tool $tool
        if ($url -and -not $NoOpen) {
            if ($DryRun) {
                Write-Host ('  [DryRun] 将打开界面：' + $url) -ForegroundColor DarkGray
            } else {
                try {
                    Open-Target -Target $url
                    Write-Ok ('已打开界面：' + $url)
                } catch {
                    Write-Warn ('打开界面失败：' + $_.Exception.Message)
                }
            }
        }
        return 0
    }

    if ($Action -eq 'restart') {
        if ($DryRun) {
            Write-Host ('  [DryRun] 将先停止再启动 ' + $tool.name + '（不执行真实停止）') -ForegroundColor DarkGray
        } else {
            Write-Step ('先停止 ' + $tool.name + '…')
            $stopCode = Stop-OwnedProcess -Id $Id
            if ($stopCode -eq 2) {
                Write-Fail '该进程不是由控制中心启动的，不能自动重启（以免影响你正在使用的服务）。'
                return 2
            }
            Start-Sleep -Milliseconds 800
        }
    }

    $launch = $tool.launch
    $kind = 'none'
    if ($launch -and $launch.kind) { $kind = [string]$launch.kind }
    $openAfterReady = Test-OpenAfterReady -Launch $launch

    # ---- 未配置启动方式 ----
    if ($kind -eq 'none') {
        $note = ''
        if ($launch -and $launch.note) { $note = [string]$launch.note }
        Write-Fail ('「' + $tool.name + '」当前不可一键启动。' + $(if ($note) { ' 原因：' + $note } else { '' }))
        $url = Get-ToolUrl -Tool $tool
        if ($url) { Write-Host ('  可手动打开：' + $url) -ForegroundColor DarkGray }
        return 3
    }

    # ---- 依赖顺序 ----
    $depCode = Invoke-ToolDependencies -Config $config -Tool $tool -DryRun:$DryRun
    if ($depCode -ne 0) { return $depCode }

    # ---- 控制中心自身：只打开界面 ----
    if ($kind -eq 'self') {
        $target = $script:DesktopHtml
        if (-not (Test-Path -LiteralPath $target)) { $target = $script:HubUrl }
        if ($DryRun) {
            Write-Host ('  [DryRun] 将打开控制中心：' + $target) -ForegroundColor DarkGray
            return 0
        }
        Open-Target -Target $target
        Write-Ok '控制中心界面已打开。'
        return 0
    }

    # ---- 只打开 URL ----
    if ($kind -eq 'url') {
        $url = Get-ToolUrl -Tool $tool
        if (-not $url) {
            Write-Fail 'launch.kind=url 但未配置 url。'
            return 3
        }
        if ($DryRun) {
            Write-Host ('  [DryRun] 将打开：' + $url) -ForegroundColor DarkGray
            return 0
        }
        Open-Target -Target $url
        Write-Ok ('已打开：' + $url)
        return 0
    }

    # ---- Windows 服务 ----
    if ($kind -eq 'service') {
        $svcName = ''
        if ($launch.service) { $svcName = [string]$launch.service }
        if (-not $svcName) { Write-Fail 'launch.kind=service 但未配置服务名。'; return 3 }
        if ($DryRun) {
            Write-Host ('  [DryRun] 将启动 Windows 服务：' + $svcName) -ForegroundColor DarkGray
            return 0
        }
        try {
            Start-Service -Name $svcName -ErrorAction Stop
        } catch {
            Write-Fail ('启动服务失败：' + $_.Exception.Message)
            Write-ToolLog -Id $Id -Message ('启动服务失败：' + $_.Exception.Message)
            return 3
        }
        Save-ServicePidRecord -Id $Id -ServiceName $svcName
        Write-Ok ('服务 ' + $svcName + ' 已启动。')
        $waitSec = 30
        if ($launch.waitSeconds) { $waitSec = [int]$launch.waitSeconds }
        $ready = Wait-ToolReady -Tool $tool -TimeoutSec $waitSec
        $url = Get-ToolUrl -Tool $tool
        if ($ready -and $openAfterReady -and $url -and -not $NoOpen) {
            try { Open-Target -Target $url; Write-Ok ('已打开界面：' + $url) } catch { Write-Warn ('打开界面失败：' + $_.Exception.Message) }
        }
        if ($ready) { return 0 } else { return 1 }
    }

    # ---- MSIX 应用（shell:AppsFolder，用于 Codex 桌面版等商店应用） ----
    if ($kind -eq 'appx') {
        $code = Start-ToolAppx -Tool $tool -DryRun:$DryRun
        if ($code -ne 0 -or $DryRun) { return $code }
        $waitSec = 30
        if ($launch.waitSeconds) { $waitSec = [int]$launch.waitSeconds }
        $ready = Wait-ToolReady -Tool $tool -TimeoutSec $waitSec
        if ($ready) { return 0 } else { return 1 }
    }

    # ---- 调用外部启动脚本（.ps1 / .bat / .cmd / .exe） ----
    if ($kind -eq 'script') {
        $inner = ''
        if ($launch.script) { $inner = [string]$launch.script }
        if (-not $inner) { Write-Fail 'launch.kind=script 但未配置 script。'; return 3 }
        $innerPath = Resolve-ToolScriptPath -ScriptPath $inner
        if (-not (Test-Path -LiteralPath $innerPath)) {
            Write-Fail ('未找到启动脚本：' + $innerPath)
            Write-Warn '可能是迁移尚未完成或路径已变化，请等待迁移完成后再试。'
            Write-ToolLog -Id $Id -Message ('未找到启动脚本 ' + $innerPath)
            return 3
        }
        $windowStyle = 'hidden'
        if ($launch.windowStyle) { $windowStyle = [string]$launch.windowStyle }
        $extraArgs = @()
        if ($launch.scriptArgs) { foreach ($sa in @($launch.scriptArgs)) { $extraArgs += [string]$sa } }
        if ($DryRun) {
            Write-Host ('  [DryRun] 将执行启动脚本：' + $innerPath) -ForegroundColor DarkGray
            Write-Host ('  [DryRun] 窗口样式：' + $windowStyle) -ForegroundColor DarkGray
            return 0
        }
        $ext = [System.IO.Path]::GetExtension($innerPath).ToLower()
        $scriptDir = Split-Path -Parent $innerPath
        Write-Step ('执行启动脚本：' + $innerPath)
        $proc = $null
        try {
            if ($ext -eq '.ps1') {
                $psExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
                $argLine = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Quote-ProcessArg $innerPath)) + $extraArgs
                $proc = Start-Process -FilePath $psExe -ArgumentList $argLine -WorkingDirectory $scriptDir -WindowStyle $windowStyle -PassThru
            } elseif ($ext -eq '.bat' -or $ext -eq '.cmd') {
                $cmdLine = @('/c', (Quote-ProcessArg $innerPath)) + $extraArgs
                $proc = Start-Process -FilePath $env:ComSpec -ArgumentList $cmdLine -WorkingDirectory $scriptDir -WindowStyle $windowStyle -PassThru
            } elseif ($ext -eq '.exe') {
                $proc = Start-Process -FilePath $innerPath -ArgumentList $extraArgs -WorkingDirectory $scriptDir -WindowStyle $windowStyle -PassThru
            } else {
                Write-Fail ('不支持的启动脚本类型：' + $ext)
                return 3
            }
        } catch {
            Write-Fail ('启动脚本执行失败：' + $_.Exception.Message)
            Write-ToolLog -Id $Id -Message ('启动脚本执行失败：' + $_.Exception.Message)
            return 3
        }
        Save-ProcessPidRecord -Id $Id -Proc $proc
        Write-ToolLog -Id $Id -Message ('已执行启动脚本 ' + $innerPath + ' pid=' + $proc.Id)
        Write-Ok ('启动脚本已执行（PID ' + $proc.Id + '）。')
        $waitSec = 60
        if ($launch.waitSeconds) { $waitSec = [int]$launch.waitSeconds }
        $ready = Wait-ToolReady -Tool $tool -TimeoutSec $waitSec
        $url = Get-ToolUrl -Tool $tool
        if ($ready -and $openAfterReady -and $url -and -not $NoOpen) {
            try { Open-Target -Target $url; Write-Ok ('已打开界面：' + $url) } catch { Write-Warn ('打开界面失败：' + $_.Exception.Message) }
        }
        if ($ready) { return 0 } else { return 1 }
    }

    # ---- 默认：exe ----
    if ($kind -eq 'exe') {
        $code = Start-ToolExe -Tool $tool -DryRun:$DryRun
        if ($code -ne 0 -or $DryRun) { return $code }
        $waitSec = 45
        if ($launch.waitSeconds) { $waitSec = [int]$launch.waitSeconds }
        $ready = Wait-ToolReady -Tool $tool -TimeoutSec $waitSec
        $url = Get-ToolUrl -Tool $tool
        if ($ready -and $openAfterReady -and $url -and -not $NoOpen) {
            try {
                Open-Target -Target $url
                Write-Ok ('已打开界面：' + $url)
                Write-ToolLog -Id $Id -Message ('已打开界面 ' + $url)
            } catch {
                Write-Warn ('打开界面失败：' + $_.Exception.Message)
            }
        }
        if ($ready) { return 0 } else { return 1 }
    }

    Write-Fail ('不支持的启动方式：' + $kind)
    return 3
}
