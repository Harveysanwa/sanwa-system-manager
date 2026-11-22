# Steam 断网辅助脚本（管理员用，不会自动执行）

本目录下的 `steam-net-off.ps1` / `steam-net-on.ps1` 由 `%SANWA_HOME%\lib\games\index.js`
的 `launchGame()` 按需**生成但绝不自动执行**（除非 Sanwa 系统管理器本身以管理员身份运行）。

## 用途

单机/破解游戏按需启动时，编排会先关闭 Steam，并"请求"阻断 Steam 客户端网络，
让 Steam 下次启动进入**离线模式**（不检查更新、不联网验证）。Windows 防火墙规则需要
管理员权限，因此：

- 当前用户非管理员时，`launchGame()` 会如实返回
  `steamNetBlock: { requested:true, applied:false, reason:'需要管理员权限', helper:'%SANWA_HOME%\tools\steam-net-off.ps1' }`
  —— 不会伪造成功。
- 想让断网真正生效，请在需要时以管理员身份手动运行下面脚本。

## 管理员运行方法

开始菜单 → 输入 `PowerShell` → 右键 **以管理员身份运行**，然后：

```powershell
# 1) 阻断 Steam 出站网络（创建防火墙规则 Sanwa-Steam-Block）
powershell -NoProfile -ExecutionPolicy Bypass -File "%SANWA_HOME%\tools\steam-net-off.ps1"

# 2) 查看规则
Get-NetFirewallRule -DisplayName 'Sanwa-Steam-Block' | Format-Table Name,Direction,Action,Enabled

# 3) 恢复网络（删除规则）
powershell -NoProfile -ExecutionPolicy Bypass -File "%SANWA_HOME%\tools\steam-net-on.ps1"
```

## 脚本行为

| 脚本 | 行为 |
| --- | --- |
| `steam-net-off.ps1` | 对 `steam.exe`、`steamwebhelper.exe` 各建一条**出站 Block** 规则（DisplayName = `Sanwa-Steam-Block`）；重复运行会先清理旧规则；支持 `-Remove`；`-SteamDir` 可指定 Steam 安装目录。 |
| `steam-net-on.ps1` | 删除所有 `Sanwa-Steam-Block` 规则，恢复 Steam 联网。 |

## 注意

- 规则只针对 Steam 客户端进程，不影响浏览器/其它程序；但断网期间 Steam 无法下载/更新、无法进入在线模式。
- 关闭 Steam 前记得保存进度；断网后再次启动 Steam 会提示以**离线模式**运行。
- 不需要断网时请务必执行 `steam-net-on.ps1` 恢复。
- 脚本均为 ASCII 内容 + `#requires -Version 5.1`，兼容 Windows PowerShell 5.1。
