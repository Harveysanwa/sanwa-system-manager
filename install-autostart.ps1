# ============================================================================
#  Sanwa系统管理器 · 登录自启快捷方式安装脚本（用户级，无需管理员）
#  --------------------------------------------------------------------------
#  在 %APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup 创建
#  「Sanwa系统管理器.lnk」，登录 Windows 后自动在后台启动控制服务。
#
#  ⚠ 用户已批准登录自启；但按 Lead 要求本脚本【只准备、暂不执行】，
#    待迁移完成后统一安装。
#
#  用法（无需管理员）：
#    powershell -NoProfile -ExecutionPolicy Bypass -File install-autostart.ps1 -DryRun   # 只预览
#    powershell -NoProfile -ExecutionPolicy Bypass -File install-autostart.ps1           # 安装
#    powershell -NoProfile -ExecutionPolicy Bypass -File install-autostart.ps1 -Remove   # 卸载
#
#  参数：
#    -Mode hidden|cmd|node   默认 hidden：powershell 隐藏窗口执行 start-hub.ps1 -NoOpen
#                            cmd  ：快捷方式指向 start-sanwa.cmd（会弹控制台并打开浏览器）
#                            node ：快捷方式直接指向 node.exe server.js
#    -Remove                 删除 Startup 中的快捷方式
#    -DryRun                 只打印将执行的操作，不写任何文件
# ============================================================================
param(
    [ValidateSet('hidden', 'cmd', 'node')]
    [string]$Mode = 'hidden',
    [switch]$Remove,
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

$root        = $PSScriptRoot   # 本脚本位于 $env:SANWA_HOME 根目录
$startCmd    = Join-Path $root 'start-sanwa.cmd'
$startHubPs1 = Join-Path (Join-Path $root 'scripts') 'start-hub.ps1'
$serverJs    = Join-Path $root 'server.js'
$desktopHtml = '$env:USERPROFILE\Desktop\Sanwa系统管理器.html'
$startupDir  = [Environment]::GetFolderPath('Startup')
$shortcutName = 'Sanwa系统管理器.lnk'
$shortcutPath = Join-Path $startupDir $shortcutName

$powershellExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'

function Write-Info  { param([string]$Text) Write-Host ('  ' + $Text) -ForegroundColor Cyan }
function Write-Ok    { param([string]$Text) Write-Host ('  [OK] ' + $Text) -ForegroundColor Green }
function Write-Warn2 { param([string]$Text) Write-Host ('  [!] ' + $Text) -ForegroundColor Yellow }
function Write-Err2  { param([string]$Text) Write-Host ('  [X] ' + $Text) -ForegroundColor Red }

Write-Host ''
Write-Host '  Sanwa系统管理器 · 登录自启快捷方式' -ForegroundColor Magenta
Write-Host '  ------------------------------------------------------------' -ForegroundColor DarkGray
Write-Host ('  Startup 目录：' + $startupDir)
Write-Host ('  快捷方式路径：' + $shortcutPath)
Write-Host ('  模式：' + $Mode)

# ---------------------------------------------------------------- 卸载
if ($Remove) {
    if (-not (Test-Path -LiteralPath $shortcutPath)) {
        Write-Ok '未发现自启快捷方式，无需卸载。'
        exit 0
    }
    if ($DryRun) {
        Write-Info ('[DryRun] 将删除：' + $shortcutPath)
        exit 0
    }
    Remove-Item -LiteralPath $shortcutPath -Force
    Write-Ok '已删除登录自启快捷方式。'
    exit 0
}

# ---------------------------------------------------------------- 前置检查
if (-not (Test-Path -LiteralPath $startupDir)) {
    Write-Err2 ('Startup 目录不存在：' + $startupDir)
    exit 1
}
if (-not (Test-Path -LiteralPath $serverJs)) {
    Write-Err2 ('未找到服务端脚本：' + $serverJs)
    exit 1
}

$targetPath = ''
$arguments  = ''
$workingDir = $root
$windowStyle = 7   # 7 = 最小化（1=正常 3=最大化 7=最小化）

switch ($Mode) {
    'hidden' {
        if (-not (Test-Path -LiteralPath $startHubPs1)) {
            Write-Err2 ('未找到启动脚本：' + $startHubPs1)
            exit 1
        }
        $targetPath = $powershellExe
        $arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $startHubPs1 + '" -NoOpen'
        $windowStyle = 7
        $modeNote = '登录后静默启动控制服务（不打开浏览器）；需要时双击桌面 Sanwa系统管理器.html'
    }
    'cmd' {
        if (-not (Test-Path -LiteralPath $startCmd)) {
            Write-Err2 ('未找到启动 cmd：' + $startCmd)
            exit 1
        }
        $targetPath = $startCmd
        $arguments = ''
        $windowStyle = 7
        $modeNote = '登录后运行启动 cmd（会弹控制台并自动打开浏览器）'
    }
    'node' {
        $nodeExe = ''
        $cmdInfo = Get-Command node -ErrorAction SilentlyContinue
        if ($cmdInfo) { $nodeExe = $cmdInfo.Source }
        if (-not $nodeExe) {
            foreach ($c in @('C:\Program Files\nodejs\node.exe', 'C:\Program Files (x86)\nodejs\node.exe')) {
                if (Test-Path -LiteralPath $c) { $nodeExe = $c; break }
            }
        }
        if (-not $nodeExe) {
            Write-Err2 '未找到 Node.js，无法使用 -Mode node'
            exit 1
        }
        $targetPath = $nodeExe
        $arguments = '"' + $serverJs + '"'
        $windowStyle = 7
        $modeNote = '登录后直接以 node 启动服务（隐藏控制台，不打开浏览器）'
    }
}

Write-Host ''
Write-Info ('目标：' + $targetPath)
Write-Info ('参数：' + $(if ($arguments) { $arguments } else { '(无)' }))
Write-Info ('工作目录：' + $workingDir)
Write-Info ('说明：' + $modeNote)

if ($DryRun) {
    Write-Host ''
    Write-Warn2 '[DryRun] 未写入任何文件；去掉 -DryRun 即可实际创建快捷方式。'
    exit 0
}

# ---------------------------------------------------------------- 创建快捷方式
try {
    $wsh = New-Object -ComObject WScript.Shell
    $lnk = $wsh.CreateShortcut($shortcutPath)
    $lnk.TargetPath = $targetPath
    $lnk.Arguments = $arguments
    $lnk.WorkingDirectory = $workingDir
    $lnk.WindowStyle = $windowStyle
    $lnk.Description = 'Sanwa系统管理器 · 本地服务（登录自启）'
    if (Test-Path -LiteralPath $targetPath) {
        $lnk.IconLocation = $targetPath + ',0'
    }
    $lnk.Save()
} catch {
    Write-Err2 ('创建快捷方式失败：' + $_.Exception.Message)
    exit 1
}

if (-not (Test-Path -LiteralPath $shortcutPath)) {
    Write-Err2 '快捷方式创建后未找到，可能被安全软件拦截。'
    exit 1
}

Write-Ok ('已创建登录自启快捷方式：' + $shortcutPath)
Write-Info '下次登录 Windows 时将自动在后台启动 Sanwa系统管理器服务。'
Write-Info '如需立即生效：运行 $env:SANWA_HOME\scripts\start-hub.ps1'
Write-Info '如需取消：本脚本加 -Remove 参数。'
Write-Host ''
exit 0
