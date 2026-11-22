# ============================================================================
#  Sanwa系统管理器 · 游戏模式（退出 / 恢复）
#  --------------------------------------------------------------------------
#  作用：读取 data\game-mode-state.json，只恢复「进入游戏模式前正在运行」的工具；
#        启动前先做端口/进程探活，避免重复启动；按 ollama → lmstudio → 其它 顺序。
#  安全：复用 scripts\<id>.ps1 / _common 的启动逻辑；不打开浏览器界面。
#  用法：powershell -NoProfile -ExecutionPolicy Bypass -File game-mode-restore.ps1 [-DryRun]
#  输出：末尾一行 ##GAMEJSON##{...}
# ============================================================================
param(
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '_common.ps1')

$STATE_FILE = Join-Path $DataDir 'game-mode-state.json'
$LOG_ID = 'game-mode'
$JSON_MARK = '##GAMEJSON##'

function Write-GameLog {
    param([string]$Message)
    Write-ToolLog -Id $LOG_ID -Message $Message
}

function Write-GameJson {
    param($Object)
    $json = $Object | ConvertTo-Json -Depth 10 -Compress
    Write-Output ($JSON_MARK + $json)
}

function Test-HubAlive {
    try {
        $req = [System.Net.HttpWebRequest]::Create('http://127.0.0.1:9900/api/ping')
        $req.Proxy = $null
        $req.Timeout = 2000
        $resp = $req.GetResponse()
        $resp.Close()
        return $true
    } catch { return $false }
}

function Test-DshAlive {
    $procs = @(Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue)
    return ($procs.Count -gt 0)
}

function Get-LastToolLog {
    param([string]$Id, [int]$Lines = 3)
    $file = Join-Path $LogsDir ($Id + '.log')
    if (-not (Test-Path -LiteralPath $file)) { return '' }
    try {
        $all = @(Get-Content -LiteralPath $file -Tail $Lines -ErrorAction Stop)
        return ($all -join ' / ')
    } catch { return '' }
}

function Test-ToolRunningAfterStart {
    param($Tool)
    if ((Get-ToolHealth -Tool $Tool) -eq 'running') { return $true }
    # 无健康检查的工具（如 Hermes CLI / Codex CLI）：用 pid 记录判断是否拉起
    $rec = Read-ToolPidRecord -Id $Tool.id
    if ($null -ne $rec -and $rec.pid) {
        $proc = Get-Process -Id ([int]$rec.pid) -ErrorAction SilentlyContinue
        if ($proc) { return $true }
    }
    return $false
}

# ---------------------------------------------------------------- 主流程

if (-not (Test-Path -LiteralPath $STATE_FILE)) {
    Write-GameJson ([ordered]@{ ok = $true; active = $false; noop = $true; restored = @(); skipped = @(); failed = @(); message = '当前未处于游戏模式（无状态文件）' })
    exit 0
}

$state = $null
try {
    $raw = [System.IO.File]::ReadAllText($STATE_FILE, [System.Text.Encoding]::UTF8)
    $state = $raw | ConvertFrom-Json
} catch {
    Write-GameJson ([ordered]@{ ok = $false; error = 'STATE'; message = ('状态文件解析失败：' + $_.Exception.Message); restored = @(); skipped = @(); failed = @() })
    exit 3
}

if ($state.active -ne $true) {
    Write-GameJson ([ordered]@{
        ok = $true; active = $false; noop = $true
        restored = @(); skipped = @(); failed = @()
        message = '当前未处于游戏模式'
        lastExitedAt = $state.exitedAt
    })
    exit 0
}

$config = Read-HubConfig
$toolMap = @{}
$toolIndex = @{}
$i = 0
foreach ($t in @($config.tools)) {
    $toolMap[[string]$t.id] = $t
    $toolIndex[[string]$t.id] = $i
    $i = $i + 1
}

$priority = @{ 'ollama' = 0; 'lmstudio' = 1 }
$candidateIds = @()
foreach ($id in @($state.toolsRunningBefore)) {
    if ($id) { $candidateIds += [string]$id }
}
$candidateIds = $candidateIds | Sort-Object -Property @{ Expression = {
        $id = [string]$_
        $p = 50
        if ($priority.ContainsKey($id)) { $p = [int]$priority[$id] }
        return $p
    } }, @{ Expression = {
        $id = [string]$_
        $idx = 999
        if ($toolIndex.ContainsKey($id)) { $idx = [int]$toolIndex[$id] }
        return $idx
    } }

$restored = @()
$skipped = @()
$failed = @()
$results = @()

Write-Host ''
Write-Host '  Sanwa系统管理器 · 退出游戏模式（恢复服务）' -ForegroundColor Magenta
Write-Host '  ------------------------------------------------------------' -ForegroundColor DarkGray
if ($candidateIds.Count -eq 0) {
    Write-Host '  [OK] 进入游戏模式前没有正在运行的 AI 服务，无需恢复。' -ForegroundColor Green
}

$dryList = @()
foreach ($id in $candidateIds) {
    $id = [string]$id
    if (-not $toolMap.ContainsKey($id)) {
        $failed += [ordered]@{ id = $id; name = $id; reason = 'tools.json 中已不存在该工具' }
        $results += [ordered]@{ id = $id; result = 'failed'; reason = 'tools.json 中已不存在该工具'; seconds = 0 }
        Write-Host ('  [X] ' + $id + '：配置已不存在，无法恢复') -ForegroundColor Red
        continue
    }
    $tool = $toolMap[$id]
    $kind = 'none'
    if ($tool.launch -and $tool.launch.kind) { $kind = [string]$tool.launch.kind }

    if ((Get-ToolHealth -Tool $tool) -eq 'running') {
        $skipped += [ordered]@{ id = $id; name = $tool.name; reason = '已在运行，跳过' }
        $results += [ordered]@{ id = $id; result = 'skipped'; reason = '已在运行，跳过'; seconds = 0 }
        Write-Host ('  [=] ' + $tool.name + '：已在运行，跳过') -ForegroundColor DarkGray
        continue
    }

    if ($kind -eq 'none' -or $kind -eq 'url') {
        $reason = '该工具没有自动启动方式，请手动打开'
        $failed += [ordered]@{ id = $id; name = $tool.name; reason = $reason }
        $results += [ordered]@{ id = $id; result = 'failed'; reason = $reason; seconds = 0 }
        Write-Host ('  [X] ' + $tool.name + '：' + $reason) -ForegroundColor Red
        continue
    }

    if ($DryRun) {
        $dryList += [ordered]@{ id = $id; name = $tool.name; kind = $kind }
        $results += [ordered]@{ id = $id; result = 'dryrun'; reason = '将启动'; seconds = 0 }
        Write-Host ('  [DryRun] 将启动 ' + $tool.name + '（' + $kind + '）') -ForegroundColor DarkGray
        continue
    }

    Write-Host ('  [>] 正在恢复 ' + $tool.name + '（' + $kind + '）…') -ForegroundColor Cyan
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $code = 3
    try {
        $code = Invoke-ToolAction -Id $id -Action 'start' -NoOpen
    } catch {
        $code = 3
        Write-GameLog ('恢复异常 ' + $id + '：' + $_.Exception.Message)
    }
    $sw.Stop()
    Start-Sleep -Milliseconds 500
    $running = Test-ToolRunningAfterStart -Tool $tool
    $seconds = [int]$sw.Elapsed.TotalSeconds
    if ($running) {
        $restored += [ordered]@{ id = $id; name = $tool.name; seconds = $seconds }
        $results += [ordered]@{ id = $id; result = 'restored'; reason = ''; seconds = $seconds }
        Write-Host ('  [OK] ' + $tool.name + ' 已恢复（' + $seconds + ' 秒）') -ForegroundColor Green
        Write-GameLog ('已恢复 ' + $id + '（' + $seconds + ' 秒）')
    } else {
        $tail = Get-LastToolLog -Id $id -Lines 3
        $reason = '启动未就绪（脚本返回码 ' + $code + '）'
        if ($tail) { $reason = $reason + '；日志：' + $tail }
        $failed += [ordered]@{ id = $id; name = $tool.name; reason = $reason }
        $results += [ordered]@{ id = $id; result = 'failed'; reason = $reason; seconds = $seconds }
        Write-Host ('  [X] ' + $tool.name + ' 恢复失败：' + $reason) -ForegroundColor Red
        Write-GameLog ('恢复失败 ' + $id + '：' + $reason)
    }
}

$dshAlive = Test-DshAlive
$hubAlive = Test-HubAlive

# 更新状态文件（保留历史，active=false）
# 注意：ConvertFrom-Json 得到的是 PSCustomObject，不能用 $state.xxx = 添加新属性
#       （会被 PowerShell 报 ExceptionWhenSetting），必须新建 ordered 字典整体写回。
$exitedAt = (Get-Date).ToString('o')
$newState = [ordered]@{
    active = $false
    enteredAt = $state.enteredAt
    exitedAt = $exitedAt
    toolsRunningBefore = @($state.toolsRunningBefore)
    closedTools = $state.closedTools
    freedMemoryMB = $state.freedMemoryMB
    freedVramMB = $state.freedVramMB
    gpuUsedBeforeMB = $state.gpuUsedBeforeMB
    gpuUsedAfterMB = $state.gpuUsedAfterMB
    totalProcesses = $state.totalProcesses
    closeFailures = $state.closeFailures
    portReleaseOk = $state.portReleaseOk
    ports = $state.ports
    protected = $state.protected
    hubPid = $state.hubPid
    restore = [ordered]@{
        restored = $restored
        skipped = $skipped
        failed = $failed
        results = $results
        dshAlive = $dshAlive
        hubAlive = $hubAlive
    }
}
$stateWriteError = ''
try {
    $stateJson = $newState | ConvertTo-Json -Depth 12
    $enc = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($STATE_FILE, $stateJson, $enc)
} catch {
    $stateWriteError = $_.Exception.Message
    Write-GameLog ('状态文件写入失败：' + $stateWriteError)
}
Write-GameLog ('退出游戏模式：恢复=' + (@($restored | ForEach-Object { $_.id }) -join ',') + '；跳过=' + (@($skipped | ForEach-Object { $_.id }) -join ',') + '；失败=' + (@($failed | ForEach-Object { $_.id }) -join ','))

Write-Host ''
if ($restored.Count -gt 0) {
    Write-Host ('  [OK] 已恢复 ' + $restored.Count + ' 个服务：' + ((@($restored | ForEach-Object { $_.name })) -join '、')) -ForegroundColor Green
}
if ($skipped.Count -gt 0) {
    Write-Host ('  [=] 跳过 ' + $skipped.Count + ' 个（本来就在运行）：' + ((@($skipped | ForEach-Object { $_.name })) -join '、')) -ForegroundColor DarkGray
}
if ($failed.Count -gt 0) {
    Write-Host ('  [X] 恢复失败 ' + $failed.Count + ' 个：') -ForegroundColor Red
    foreach ($f in $failed) { Write-Host ('      - ' + $f.name + '：' + $f.reason) -ForegroundColor Red }
}
if (-not $dshAlive) { Write-Host '  [!] 警告：未检测到 DeepSeek Harness 进程（可能本就没有运行）。' -ForegroundColor Yellow }
if (-not $hubAlive) { Write-Host '  [X] 严重：控制中心自身 9900 无响应！' -ForegroundColor Red }

$okAll = ($failed.Count -eq 0) -and ($stateWriteError -eq '')
$result = [ordered]@{
    ok = $okAll
    active = $false
    exitedAt = $exitedAt
    restored = $restored
    skipped = $skipped
    failed = $failed
    results = $results
    stateWriteError = $stateWriteError
    protected = [ordered]@{ dshAlive = $dshAlive; hubAlive = $hubAlive }
    message = $(if ($okAll) { '已退出游戏模式，服务已恢复' } else { '已退出游戏模式，但有 ' + $failed.Count + ' 个服务恢复失败' })
}
Write-GameJson $result
if (-not $hubAlive) { exit 3 }
if ($stateWriteError -ne '') { exit 2 }
if ($failed.Count -gt 0) { exit 2 }
exit 0
