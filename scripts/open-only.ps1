# ============================================================================
#  只打开 URL / 文件 / 文件夹（不启动任何组件）
#  用法：powershell -NoProfile -ExecutionPolicy Bypass -File open-only.ps1 -Url "http://127.0.0.1:8188/"
#      也可以传绝对路径（文件用默认程序打开，文件夹用资源管理器打开）
#  加 -DryRun 只打印不打开（供自测使用）
# ============================================================================
param(
    [Parameter(Mandatory = $true)][string]$Url,
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '_common.ps1')

try {
    if ($DryRun) {
        Write-Host ('  [DryRun] 将打开：' + $Url) -ForegroundColor DarkGray
        exit 0
    }
    Open-Target -Target $Url
    Write-ToolLog -Id 'hub' -Message ('open-only: 已打开 ' + $Url)
    exit 0
} catch {
    Write-Host ('  [X] 打开失败：' + $_.Exception.Message) -ForegroundColor Red
    Write-ToolLog -Id 'hub' -Message ('open-only 失败：' + $_.Exception.Message)
    exit 1
}
