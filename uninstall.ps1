# ============================================================================
#  Sanwa系统管理器 · 卸载脚本（用户级）
#  用法：powershell -NoProfile -ExecutionPolicy Bypass -File uninstall.ps1
#  参数：-KeepData 保留 data 目录（默认也保留，避免误删用户配置）
# ============================================================================
param(
    [switch]$KeepData = $true
)
$ErrorActionPreference = 'Continue'
$root = $PSScriptRoot

Write-Host ''
Write-Host '  Sanwa系统管理器 · 卸载' -ForegroundColor Magenta
Write-Host '  ------------------------------------------------------------' -ForegroundColor DarkGray

$stopScript = Join-Path $root 'scripts\stop-hub.ps1'
if (Test-Path -LiteralPath $stopScript) {
    & powershell -NoProfile -ExecutionPolicy Bypass -File $stopScript
} else {
    Write-Host '  [!] 未找到 scripts\stop-hub.ps1，请手动结束 node server.js 进程。' -ForegroundColor Yellow
}

$autoScript = Join-Path $root 'install-autostart.ps1'
if (Test-Path -LiteralPath $autoScript) {
    & powershell -NoProfile -ExecutionPolicy Bypass -File $autoScript -Remove
}
$desktopHtml = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Sanwa系统管理器.html'
if (Test-Path -LiteralPath $desktopHtml) {
    Remove-Item -LiteralPath $desktopHtml -Force -ErrorAction SilentlyContinue
    Write-Host '  [OK] 已删除桌面 HTML' -ForegroundColor Green
}
if (-not $KeepData) {
    Remove-Item -LiteralPath (Join-Path $root 'data') -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath (Join-Path $root 'logs') -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host '  [OK] 已删除 data/ logs/' -ForegroundColor Green
} else {
    Write-Host '  [OK] 已保留 data/ 与 logs/（-KeepData:$false 可删除）' -ForegroundColor Green
}
Write-Host '  [OK] 卸载流程完成（源码目录需手动删除）' -ForegroundColor Green
Write-Host ''
