# ============================================================================
#  Sanwa系统管理器 · dingtalk 启动脚本（由 build 自动生成，如手改请同步 tools.json）
#  幂等：已运行则跳过并打开界面；未运行则启动 -> 等待就绪 -> 打开界面。
#  用法：powershell -NoProfile -ExecutionPolicy Bypass -File dingtalk.ps1
#        可选参数：-Action start|stop|restart   -NoOpen 只启动不打开界面   -DryRun 只打印不执行
# ============================================================================
param(
    [ValidateSet('start','stop','restart')][string]$Action = 'start',
    [switch]$NoOpen,
    [switch]$DryRun
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '_common.ps1')
try {
    $code = Invoke-ToolAction -Id 'dingtalk' -Action $Action -NoOpen:$NoOpen -DryRun:$DryRun
} catch {
    Write-Host ('  [X] 执行失败：' + $_.Exception.Message) -ForegroundColor Red
    Write-ToolLog -Id 'dingtalk' -Message ('执行失败：' + $_.Exception.Message)
    $code = 1
}
exit $code
