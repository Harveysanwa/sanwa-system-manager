# ============================================================================
#  Sanwa系统管理器 · 游戏模式（进入）
#  --------------------------------------------------------------------------
#  作用：关闭 tools.json 中 gameMode="stop" 且当前正在运行的 AI 服务/应用，
#        释放内存与显存；DeepSeek Harness 与控制中心自身（9900）永远保留。
#  安全：只杀「白名单特征匹配」的进程；先 CloseMainWindow 优雅关闭，2 秒后
#        残留才强制结束；绝不杀 DSH / hub node / explorer / powershell / 系统进程。
#  用法：powershell -NoProfile -ExecutionPolicy Bypass -File game-mode.ps1 [-DryRun]
#  输出：末尾一行 ##GAMEJSON##{...} 供 server.js 解析；同时写 logs\game-mode.log
# ============================================================================
param(
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '_common.ps1')

$STATE_FILE = Join-Path $DataDir 'game-mode-state.json'
$LOG_ID = 'game-mode'
$PORTS_TO_WAIT = @(11434, 1234, 8188, 8080, 8137, 9123)
$JSON_MARK = '##GAMEJSON##'

# 永远不杀的进程名（小写，不含 .exe）
$PROTECT_NAMES = @(
    'deepseek harness', 'system', 'idle', 'registry', 'smss', 'csrss', 'wininit', 'winlogon',
    'services', 'lsass', 'svchost', 'dwm', 'fontdrvhost', 'explorer', 'powershell', 'pwsh',
    'cmd', 'conhost', 'ctfmon', 'sihost', 'taskhostw', 'runtimebroker', 'searchhost',
    'startmenuexperiencehost', 'shellexperiencehost', 'codex-windows-sandbox-service',
    'msiexec', 'mousocoreworker'
)
# 永远不杀的路径特征
$PROTECT_PATH_PARTS = @('$env:SANWA_HOME', '\AI\Hub\')
# 允许杀掉 WindowsApps 内进程的例外工具
$WINDOWSAPPS_ALLOWED_TOOL = 'codex-desktop'

# ---------------------------------------------------------------- 工具函数

function Write-GameLog {
    param([string]$Message)
    Write-ToolLog -Id $LOG_ID -Message $Message
}

function Write-GameJson {
    param($Object)
    $json = $Object | ConvertTo-Json -Depth 10 -Compress
    Write-Output ($JSON_MARK + $json)
}

function Get-GpuPerPidMB {
    $map = @{}
    try {
        $samples = (Get-Counter '\GPU Process Memory(*)\Dedicated Usage' -ErrorAction Stop).CounterSamples
        foreach ($s in $samples) {
            if ($s.InstanceName -match 'pid_(\d+)') {
                $procId = [int]$Matches[1]
                if (-not $map.ContainsKey($procId)) { $map[$procId] = 0.0 }
                $map[$procId] = $map[$procId] + [double]$s.CookedValue
            }
        }
    } catch { }
    return $map
}

function Get-GpuTotalUsedMB {
    try {
        $smi = Join-Path $env:SystemRoot 'System32\nvidia-smi.exe'
        if (-not (Test-Path -LiteralPath $smi)) { return -1 }
        $out = & $smi '--query-gpu=memory.used' '--format=csv,noheader,nounits' 2>$null
        $first = ''
        if ($out) { $first = ([string]($out | Select-Object -First 1)).Trim() }
        $num = 0.0
        if ($first -and [double]::TryParse($first, [ref]$num)) { return $num }
    } catch { }
    return -1
}

function Get-AllProcesses {
    $list = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue
    $out = @()
    foreach ($p in $list) {
        if ($null -eq $p) { continue }
        if ([int]$p.ProcessId -le 4) { continue }
        $out += $p
    }
    return $out
}

# 每个工具一个「进程特征」规则：names 必中；cmd/path 任一命中（为空则只看名字）
function Get-ProcessRules {
    return @{
        'ollama' = @{ names = @('ollama', 'ollama app'); cmd = @(); path = @('\\Ollama\\', '\\apps\\Ollama\\') }
        'lmstudio' = @{ names = @('LM Studio'); cmd = @(); path = @() }
        'comfyui' = @{
            names = @('python', 'pythonw', 'python.exe', 'pythonw.exe')
            cmd = @('--port\s+8188', 'windows-standalone-build')
            path = @('comfyui')
        }
        'open-webui' = @{
            names = @('open-webui', 'open_webui', 'python', 'pythonw')
            cmd = @('OpenWebUI', 'open-webui', 'open_webui')
            path = @('OpenWebUI')
        }
        'breeze-tts-2' = @{ names = @('breeze-server', 'breeze-cli', 'breeze-convert'); cmd = @(); path = @('breeze-tts-2') }
        'breeze-studio' = @{ names = @('breeze-studio', 'python', 'pythonw'); cmd = @('breeze-studio'); path = @('breeze-studio') }
        'hermes-cli' = @{
            names = @('python', 'pythonw', 'hermes')
            cmd = @('hermes-agent', 'hermes\\cli\.py', '\\hermes\\bin\\')
            path = @('\\hermes\\', 'HermesAgent')
        }
        'hermes-cn-desktop' = @{ names = @('hermes-agent-cn-desktop'); cmd = @(); path = @() }
        'pptmaster' = @{ names = @('ppt-master', 'PPTMaster', 'python', 'pythonw'); cmd = @('PPTMaster'); path = @('PPTMaster') }
        'codex-desktop' = @{ names = @('ChatGPT', 'codex'); cmd = @(); path = @('WindowsApps\\OpenAI\.Codex') }
        'codex-local-cli' = @{ names = @('node'); cmd = @('@openai\\codex', 'codex\.js'); path = @() }
        'kimi' = @{ names = @('Kimi'); cmd = @(); path = @() }
        'qianwen' = @{ names = @('qianwen', 'new_qianwen', 'qianwen_proxy', 'new_qianwen_proxy'); cmd = @(); path = @() }
        'doubao' = @{ names = @('Doubao', 'doubao'); cmd = @(); path = @() }
        'workbuddy' = @{ names = @('WorkBuddy', 'workbuddy'); cmd = @(); path = @() }
    }
}

function Test-ProtectedProcess {
    param($Proc, $ToolId)

    $name = [string]$Proc.Name
    if (-not $name) { return $true }
    $base = $name.ToLower()
    if ($base.EndsWith('.exe')) { $base = $base.Substring(0, $base.Length - 4) }
    if ($PROTECT_NAMES -contains $base) { return $true }

    $path = ''
    try { $path = [string]$Proc.ExecutablePath } catch { $path = '' }
    $cmd = ''
    try { $cmd = [string]$Proc.CommandLine } catch { $cmd = '' }
    if ($path) {
        foreach ($part in $PROTECT_PATH_PARTS) {
            if ($path.ToLower().Contains($part.ToLower())) { return $true }
        }
        if ($path.ToLower().StartsWith('c:\windows\')) { return $true }
        if ($path.ToLower().StartsWith('c:\program files\windowsapps\') -and $ToolId -ne $WINDOWSAPPS_ALLOWED_TOOL) { return $true }
        if ($path.ToLower().StartsWith('c:\program files\') -and $ToolId -ne $WINDOWSAPPS_ALLOWED_TOOL) { return $true }
    }
    if ($cmd -and $cmd.ToLower().Contains((Join-Path $HubRoot 'server.js').ToLower())) { return $true }
    if ($base -eq 'node') {
        if (-not ($ToolId -eq 'codex-local-cli')) { return $true }
    }
    return $false
}

function Find-ToolProcesses {
    param($Tool, $Rules, $AllProcs)

    $rule = $Rules[$Tool.id]
    if ($null -eq $rule) { return @() }

    $matched = @()
    foreach ($p in $AllProcs) {
        $name = [string]$p.Name
        if (-not $name) { continue }
        $base = $name.ToLower()
        if ($base.EndsWith('.exe')) { $base = $base.Substring(0, $base.Length - 4) }

        $nameHit = $false
        foreach ($n in $rule.names) {
            if ($base -eq ([string]$n).ToLower()) { $nameHit = $true; break }
        }
        if (-not $nameHit) { continue }

        $cmd = ''
        try { $cmd = [string]$p.CommandLine } catch { $cmd = '' }
        $path = ''
        try { $path = [string]$p.ExecutablePath } catch { $path = '' }

        $condHit = $false
        $hasCond = (($rule.cmd.Count + $rule.path.Count) -gt 0)
        if (-not $hasCond) {
            $condHit = $true
        } else {
            foreach ($pattern in $rule.cmd) {
                if ($cmd -match $pattern) { $condHit = $true; break }
            }
            if (-not $condHit) {
                foreach ($pattern in $rule.path) {
                    if ($path -match $pattern) { $condHit = $true; break }
                }
            }
        }
        if (-not $condHit) { continue }
        if (Test-ProtectedProcess -Proc $p -ToolId $Tool.id) { continue }
        $matched += $p
    }
    return $matched
}

function Build-Candidates {
    param($Config, $AllProcs, $GpuMap)

    $rules = Get-ProcessRules
    $candidates = @()
    $totalMem = 0.0
    $totalVram = 0.0
    $totalProc = 0
    foreach ($tool in @($Config.tools)) {
        $mode = ''
        if ($tool.gameMode) { $mode = [string]$tool.gameMode }
        if ($mode -ne 'stop') { continue }
        $procs = @(Find-ToolProcesses -Tool $tool -Rules $rules -AllProcs $AllProcs)
        if ($procs.Count -eq 0) { continue }

        $items = @()
        $memMB = 0.0
        $vramMB = 0.0
        foreach ($p in $procs) {
            $wsMB = 0.0
            if ($p.WorkingSetSize) { $wsMB = [math]::Round(([double]$p.WorkingSetSize) / 1MB, 1) }
            $vMB = 0.0
            $procId = [int]$p.ProcessId
            if ($GpuMap.ContainsKey($procId)) { $vMB = [math]::Round($GpuMap[$procId] / 1MB, 1) }
            $exePath = ''
            try { $exePath = [string]$p.ExecutablePath } catch { $exePath = '' }
            $items += [ordered]@{
                pid = $procId
                name = [string]$p.Name
                path = $exePath
                memoryMB = $wsMB
                vramMB = $vMB
            }
            $memMB = $memMB + $wsMB
            $vramMB = $vramMB + $vMB
        }
        $memMB = [math]::Round($memMB, 1)
        $vramMB = [math]::Round($vramMB, 1)
        $totalMem = $totalMem + $memMB
        $totalVram = $totalVram + $vramMB
        $totalProc = $totalProc + $items.Count
        $candidates += [ordered]@{
            id = [string]$tool.id
            name = [string]$tool.name
            category = [string]$tool.category
            memoryMB = $memMB
            vramMB = $vramMB
            processCount = $items.Count
            processes = $items
        }
    }
    return [ordered]@{
        candidates = $candidates
        totalMemoryMB = [math]::Round($totalMem, 1)
        totalVramMB = [math]::Round($totalVram, 1)
        totalProcesses = $totalProc
    }
}

function Wait-PortsFree {
    param([int[]]$Ports, [int]$TimeoutSec = 20)
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        $allFree = $true
        foreach ($port in $Ports) {
            if ((Test-TcpHealth -Port $port -TimeoutMs 300) -eq 'running') { $allFree = $false; break }
        }
        if ($allFree) { return $true }
        Start-Sleep -Milliseconds 500
    }
    return $false
}

function Get-PortStates {
    param([int[]]$Ports)
    $states = [ordered]@{}
    foreach ($port in $Ports) {
        $states[[string]$port] = ((Test-TcpHealth -Port $port -TimeoutMs 300) -eq 'running')
    }
    return $states
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
    if ($procs.Count -eq 0) { return $false }
    return $true
}

# ---------------------------------------------------------------- 主流程

try {
    $config = Read-HubConfig
} catch {
    Write-GameJson ([ordered]@{ ok = $false; error = 'CONFIG'; message = $_.Exception.Message })
    exit 3
}

$allProcs = Get-AllProcesses
$gpuMap = Get-GpuPerPidMB
$gpuBefore = Get-GpuTotalUsedMB
$built = Build-Candidates -Config $config -AllProcs $allProcs -GpuMap $gpuMap

$protectedInfo = [ordered]@{
    dshAlive = (Test-DshAlive)
    hubAlive = (Test-HubAlive)
}

if ($DryRun) {
    Write-Host ''
    Write-Host '  Sanwa系统管理器 · 游戏模式（预演，不关闭任何进程）' -ForegroundColor Magenta
    Write-Host '  ------------------------------------------------------------' -ForegroundColor DarkGray
    if ($built.candidates.Count -eq 0) {
        Write-Host '  [OK] 当前没有需要关闭的 AI 服务/应用。' -ForegroundColor Green
    } else {
        foreach ($c in $built.candidates) {
            Write-Host ('  - {0,-18} 进程 {1} 个  内存 {2} MB  显存 {3} MB' -f $c.name, $c.processCount, $c.memoryMB, $c.vramMB) -ForegroundColor Cyan
        }
        Write-Host ('  合计：进程 {0} 个，内存约 {1} MB，显存约 {2} MB' -f $built.totalProcesses, $built.totalMemoryMB, $built.totalVramMB) -ForegroundColor Yellow
    }
    Write-Host ('  保留：DeepSeek Harness（存活={0}）、Sanwa系统管理器 9900（存活={1}）' -f $protectedInfo.dshAlive, $protectedInfo.hubAlive) -ForegroundColor DarkGray
    Write-Host ''
    Write-GameJson ([ordered]@{
        ok = $true
        dryRun = $true
        candidates = $built.candidates
        totalMemoryMB = $built.totalMemoryMB
        totalVramMB = $built.totalVramMB
        totalProcesses = $built.totalProcesses
        gpuTotalUsedMB = $gpuBefore
        protected = $protectedInfo
        at = (Get-Date).ToString('o')
    })
    exit 0
}


# ---------------------------------------------------------------- 状态文件工具

function Write-GameStateFile {
    param($StateObject)
    $json = $StateObject | ConvertTo-Json -Depth 12
    $enc = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($STATE_FILE, $json, $enc)
}

# 读取既有状态（用于断点续跑/幂等）
$existingState = $null
if (Test-Path -LiteralPath $STATE_FILE) {
    try {
        $raw = [System.IO.File]::ReadAllText($STATE_FILE, [System.Text.Encoding]::UTF8)
        $existingState = $raw | ConvertFrom-Json
    } catch {
        $existingState = $null
    }
}

# ---- 已在游戏模式：完整状态直接返回；closing（上次崩溃）则断点续跑 ----
$resumeMode = $false
$resumeEnteredAt = ''
$resumeToolsBefore = @()
$resumeClosedTools = @()
if ($existingState -and $existingState.active -eq $true) {
    $existingPhase = ''
    if (@($existingState.PSObject.Properties.Name) -contains 'phase') {
        $existingPhase = [string]$existingState.phase
    }
    if ($existingPhase -eq 'active') {
        Write-Host ('  [!] 已处于游戏模式（进入时间：' + $existingState.enteredAt + '），不重复关闭。') -ForegroundColor Yellow
        Write-GameJson ([ordered]@{
            ok = $true
            alreadyActive = $true
            active = $true
            enteredAt = $existingState.enteredAt
            closedTools = $existingState.closedTools
            freedMemoryMB = $existingState.freedMemoryMB
            freedVramMB = $existingState.freedVramMB
            message = '已处于游戏模式'
        })
        exit 0
    }
    # phase 不是 active：上次脚本在关闭过程中崩溃，按断点续跑处理
    $resumeMode = $true
    $resumeEnteredAt = [string]$existingState.enteredAt
    if ($existingState.toolsRunningBefore) { $resumeToolsBefore = @($existingState.toolsRunningBefore) }
    if ($existingState.closedTools) { $resumeClosedTools = @($existingState.closedTools) }
    Write-Host '  [>] 检测到上次进入未完成（断点续跑），继续关闭剩余服务…' -ForegroundColor Yellow
    Write-GameLog ('检测到未完成的进入操作（phase=' + $existingPhase + '），开始断点续跑')
}

Write-Host ''
Write-Host '  Sanwa系统管理器 · 进入游戏模式' -ForegroundColor Magenta
Write-Host '  ------------------------------------------------------------' -ForegroundColor DarkGray
Write-GameLog ('进入游戏模式：候选工具 ' + (($built.candidates | ForEach-Object { $_.id }) -join ',') + $(if ($resumeMode) { '（续跑）' } else { '' }))

$candidateIds = @($built.candidates | ForEach-Object { $_.id })
if (($built.candidates.Count -eq 0) -and (-not $resumeMode)) {
    Write-Host '  [OK] 当前没有需要关闭的 AI 服务/应用，无需进入游戏模式。' -ForegroundColor Green
    Write-GameJson ([ordered]@{
        ok = $true
        active = $false
        noop = $true
        message = '当前没有需要关闭的 AI 服务/应用'
        protected = $protectedInfo
    })
    exit 0
}

$enteredAt = (Get-Date).ToString('o')
if ($resumeMode -and $resumeEnteredAt) { $enteredAt = $resumeEnteredAt }

# 合并历史已关闭项与本次待关闭项
$mergedClosedTools = @()
$mergedIds = @()
foreach ($c in $resumeClosedTools) {
    if (-not ($mergedIds -contains [string]$c.id)) {
        $mergedClosedTools += $c
        $mergedIds += [string]$c.id
    }
}
foreach ($c in $built.candidates) {
    if (-not ($mergedIds -contains [string]$c.id)) {
        $mergedClosedTools += $c
        $mergedIds += [string]$c.id
    }
}
$toolsBefore = @()
if ($resumeToolsBefore.Count -gt 0) {
    $toolsBefore = $resumeToolsBefore
} else {
    foreach ($c in $mergedClosedTools) { $toolsBefore += [string]$c.id }
}

# ---- 写前状态：先落盘 active=true / phase=closing（脚本中途崩溃也能退出恢复、重试可续跑）----
$earlyState = [ordered]@{
    active = $true
    phase = 'closing'
    enteredAt = $enteredAt
    toolsRunningBefore = $toolsBefore
    closedTools = $mergedClosedTools
    freedMemoryMB = $built.totalMemoryMB
    freedVramMB = $built.totalVramMB
    totalProcesses = $built.totalProcesses
    closeFailures = @()
    portReleaseOk = $false
    hubPid = $PID
    writeAhead = $true
    resumed = $resumeMode
}
try {
    Write-GameStateFile -StateObject $earlyState
    Write-GameLog '写前状态已落盘：active=true phase=closing'
} catch {
    Write-Fail ('状态文件写入失败，已中止（未关闭任何进程）：' + $_.Exception.Message)
    Write-GameLog ('写前状态失败，中止：' + $_.Exception.Message)
    Write-GameJson ([ordered]@{
        ok = $false
        active = $false
        error = 'STATE_WRITE'
        message = '状态文件写入失败，已中止（未关闭任何进程）'
    })
    exit 3
}

# ---- 关闭前快照（用于内存/显存统计）----
$beforeProcs = @{}
foreach ($c in $built.candidates) {
    foreach ($p in $c.processes) { $beforeProcs[[int]$p.pid] = $p }
}

# 1) 优雅关闭：对匹配进程尝试 CloseMainWindow
if ($built.candidates.Count -gt 0) {
    Write-Host ('  [>] 正在优雅关闭 ' + $built.candidates.Count + ' 组 AI 服务/应用…') -ForegroundColor Cyan
    foreach ($procId in @($beforeProcs.Keys)) {
        $gp = Get-Process -Id $procId -ErrorAction SilentlyContinue
        if ($null -eq $gp) { continue }
        try {
            if ($gp.MainWindowHandle -ne 0) {
                if (-not $gp.CloseMainWindow()) { }
            }
        } catch { }
    }
    Start-Sleep -Seconds 2
} else {
    Write-Host '  [=] 没有需要继续关闭的进程（可能上次已关闭完毕）。' -ForegroundColor DarkGray
}

# 2) 强制结束残留（重新匹配，避免误杀新进程）
$closeFailures = @()
$allProcs2 = Get-AllProcesses
$gpuMap2 = Get-GpuPerPidMB
$rebuilt = Build-Candidates -Config $config -AllProcs $allProcs2 -GpuMap $gpuMap2
$killMap = @{}
foreach ($c in $rebuilt.candidates) {
    foreach ($p in $c.processes) { $killMap[[int]$p.pid] = $p }
}
foreach ($procId in @($killMap.Keys)) {
    $gp = Get-Process -Id $procId -ErrorAction SilentlyContinue
    if ($null -eq $gp) { continue }
    try {
        Stop-Process -Id $procId -Force -ErrorAction Stop
        Write-GameLog ('已强制结束 pid=' + $procId + ' name=' + $gp.ProcessName)
    } catch {
        $closeFailures += [ordered]@{ pid = $procId; name = $gp.ProcessName; reason = $_.Exception.Message }
        Write-GameLog ('强制结束失败 pid=' + $procId + '：' + $_.Exception.Message)
    }
}

# 3) 等待端口释放（20 秒）
Write-Host '  [>] 等待端口释放（最多 20 秒）…' -ForegroundColor Cyan
$portsFree = Wait-PortsFree -Ports $PORTS_TO_WAIT -TimeoutSec 20
$portStates = Get-PortStates -Ports $PORTS_TO_WAIT
$portReleaseOk = $portsFree
foreach ($port in $PORTS_TO_WAIT) {
    if ($portStates[[string]$port]) { $portReleaseOk = $false }
}
Start-Sleep -Milliseconds 500

# 4) 保护对象核验 + 显存统计
$dshAlive = Test-DshAlive
$hubAlive = Test-HubAlive
$gpuAfter = Get-GpuTotalUsedMB
$freedVram = 0.0
if (($gpuBefore -ge 0) -and ($gpuAfter -ge 0)) {
    $freedVram = [math]::Round(($gpuBefore - $gpuAfter), 1)
    if ($freedVram -lt 0) { $freedVram = 0 }
}
$closedVramSum = 0.0
$freedRam = 0.0
$totalProcCount = 0
foreach ($c in $mergedClosedTools) {
    $freedRam = $freedRam + [double]$c.memoryMB
    $closedVramSum = $closedVramSum + [double]$c.vramMB
    $totalProcCount = $totalProcCount + [int]$c.processCount
}
$freedRam = [math]::Round($freedRam, 1)
if ($freedVram -le 0) { $freedVram = [math]::Round($closedVramSum, 1) }
$closedIds = @($mergedClosedTools | ForEach-Object { [string]$_.id })

# 5) 最终状态落盘 phase=active
$stateWriteError = ''
$finalState = [ordered]@{
    active = $true
    phase = 'active'
    enteredAt = $enteredAt
    toolsRunningBefore = $toolsBefore
    closedTools = $mergedClosedTools
    closedIds = $closedIds
    freedMemoryMB = $freedRam
    freedVramMB = $freedVram
    gpuUsedBeforeMB = $gpuBefore
    gpuUsedAfterMB = $gpuAfter
    totalProcesses = $totalProcCount
    closeFailures = $closeFailures
    portReleaseOk = $portReleaseOk
    ports = $portStates
    protected = [ordered]@{ dshAlive = $dshAlive; hubAlive = $hubAlive; dshPort = 1156; hubPort = 9900 }
    hubPid = $PID
    writeAhead = $true
    resumed = $resumeMode
}
try {
    Write-GameStateFile -StateObject $finalState
} catch {
    $stateWriteError = $_.Exception.Message
    Write-GameLog ('最终状态写入失败（写前状态仍保留，可退出恢复）：' + $stateWriteError)
}
Write-GameLog ('游戏模式已进入' + $(if ($resumeMode) { '（续跑完成）' } else { '' }) + '：关闭工具=' + ($closedIds -join ',') + '；释放内存=' + $freedRam + 'MB；显存=' + $freedVram + 'MB；DSH存活=' + $dshAlive + '；hub存活=' + $hubAlive + $(if ($stateWriteError) { '；最终状态写入失败=' + $stateWriteError } else { '' }))

# 6) 人类可读输出
Write-Host ''
Write-Host ('  [OK] 已关闭 {0} 组 AI 服务/应用（{1} 个进程），释放约 {2} GB 内存。' -f $closedIds.Count, $totalProcCount, [math]::Round($freedRam / 1024, 2)) -ForegroundColor Green
if ($freedVram -gt 0) {
    Write-Host ('  [OK] 显存释放约 {0} MB（GPU {1} MB -> {2} MB）。' -f $freedVram, $gpuBefore, $gpuAfter) -ForegroundColor Green
}
if (-not $dshAlive) { Write-Host '  [!] 警告：未检测到 DeepSeek Harness 进程（可能本就没有运行）。' -ForegroundColor Yellow }
if (-not $hubAlive) { Write-Host '  [X] 严重：控制中心自身 9900 无响应！' -ForegroundColor Red }
if (-not $portReleaseOk) {
    $busyPorts = @()
    foreach ($port in $PORTS_TO_WAIT) { if ($portStates[[string]$port]) { $busyPorts += $port } }
    Write-Host ('  [!] 以下端口仍在监听：' + ($busyPorts -join ', ')) -ForegroundColor Yellow
}
foreach ($f in $closeFailures) {
    Write-Host ('  [!] 进程结束失败：pid=' + $f.pid + ' ' + $f.name + '（' + $f.reason + '）') -ForegroundColor Yellow
}

$result = [ordered]@{
    ok = $true
    active = $true
    resumed = $resumeMode
    enteredAt = $enteredAt
    closedTools = $mergedClosedTools
    closedIds = $closedIds
    toolsRunningBefore = $toolsBefore
    freedMemoryMB = $freedRam
    freedVramMB = $freedVram
    gpuUsedBeforeMB = $gpuBefore
    gpuUsedAfterMB = $gpuAfter
    totalProcesses = $totalProcCount
    closeFailures = $closeFailures
    portReleaseOk = $portReleaseOk
    ports = $portStates
    protected = $finalState.protected
    stateWriteError = $stateWriteError
    message = ('已关闭 ' + $closedIds.Count + ' 组进程，释放约 ' + [math]::Round($freedRam / 1024, 2) + ' GB 内存' + $(if ($resumeMode) { '（断点续跑完成）' } else { '' }))
}
Write-GameJson $result
if (-not $hubAlive) { exit 3 }
exit 0
