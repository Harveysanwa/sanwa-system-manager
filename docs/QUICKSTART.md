# 快速开始（Quickstart）

> 简体中文（English version below / 英文版见下方）
> 目标：5 分钟内在一台 Windows 10/11 上把 Sanwa 系统管理器跑起来。

---

# 中文版

## 1. 环境要求

| 项目 | 要求 | 检查命令 |
|---|---|---|
| 操作系统 | Windows 10 / 11（x64） | `winver` |
| Node.js | **22 或更高**（推荐 LTS） | `node -v` |
|  PowerShell | Windows 自带 5.1 即可 | `$PSVersionTable.PSVersion` |
| 磁盘 | 约 10 MB（不含你自己的 AI 程序 / 模型 / 游戏） | — |
| 权限 | 普通用户即可；部分辅助功能需要管理员（会单独说明） | — |
| 浏览器 | 较新的 Edge / Chrome | — |

不需要：Python、npm install、数据库、Docker、联网安装依赖、注册账号。

## 2. 下载

### 方式 A：git clone（推荐，便于更新）

```powershell
git clone <REPO_URL> "$env:USERPROFILE\sanwa-system-manager"
cd "$env:USERPROFILE\sanwa-system-manager"
```

### 方式 B：GitHub ZIP

1. 打开仓库页 → `Code` → `Download ZIP`；
2. 解压到例如 `%USERPROFILE%\sanwa-system-manager`；
3. 确认解压后**根目录**能看到 `server.js`、`install.ps1`、`start-sanwa.cmd`（不要多套一层文件夹）。

> 路径建议：使用简短、不含特殊符号的路径（例如 `%USERPROFILE%\sanwa-system-manager`）；`%USERPROFILE%` 即你的用户目录，请按实际展开后的路径操作，不要在脚本里写死某一台机器的用户目录。

### 目录说明

```text
sanwa-system-manager\
├── server.js              # 本地服务（Node 标准库）
├── install.ps1            # 安装（生成 data\tools.json、复制桌面界面）
├── uninstall.ps1          # 卸载（停服务、删自启与桌面界面）
├── start-sanwa.cmd        # 一键启动并打开浏览器
├── package.json           # 元数据与 npm scripts（无 dependencies）
├── lib\                   # 模式引擎 / 游戏库 / 玄学天气模块
├── scripts\               # 工具启动脚本、构建 UI、自启 VBS
├── web\                   # 界面模板与构建产物（单文件）
├── data\                  # 配置（运行时生成 tools.json；示例 *.example）
├── tools\                 # Steam 断网辅助脚本（管理员用）
├── docs\                  # 文档
└── CHANGELOG.md / ROADMAP.md / LICENSE
```

安装后 `data\` 下会出现 `tools.json`（你的工具清单）、`games.json`（扫描缓存）、`profile.json`（脱敏生日资料）等运行时文件，均已被 `.gitignore` 排除，不要提交。

## 3. 安装 Node.js（已装可跳过）

1. 打开 <https://nodejs.org/> 下载 **LTS**（≥ 22）；
2. 安装时保持勾选 **Add to PATH**；
3. 重新打开 PowerShell，验证：

```powershell
node -v      # 期望 v22.x 或更高
npm -v       # 可选；本项目不需要 npm 安装依赖
```

如果 `node -v` 报「不是内部或外部命令」：重装 Node 并勾选 Add to PATH，或重启终端 / 电脑。

## 4. 运行安装脚本

在仓库根目录打开 PowerShell（在文件夹空白处按住 Shift + 右键 →「在此处打开 PowerShell 窗口」），执行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
```

### install.ps1 参数

| 参数 | 说明 |
|---|---|
| `-Autostart` | 同时创建登录自启快捷方式（**可选**；只启动控制中心服务，不启动任何 AI 工具） |
| `-Force` | 覆盖已存在的 `data\tools.json`（会丢失你之前的手工修改，谨慎） |
| `-Port <n>` | 端口（默认 9900）；用于生成配置里的端口占位符，实际监听端口以环境变量 `SANWA_PORT` 为准（见第 7 节） |

`install.ps1` 会做这些事（不会修改系统设置、不需要管理员）：

1. 检查 Node.js ≥ 22；
2. 创建 `data\`、`data\pids\`、`logs\`；
3. 从 `data\tools.example.json` 展开占位符，生成 `data\tools.json`；
4. 把 `web/index.html` 复制到桌面，生成 `Sanwa系统管理器.html`；
5. 如加 `-Autostart`，创建登录自启快捷方式。

看到 `[OK] 安装完成。` 即成功。

## 5. 首次配置（重要）

### 5.1 编辑 `data\tools.json`

`install.ps1` 已按默认值展开占位符，但你仍需要把**你自己软件的真实安装路径**填进去。常用占位符：

| 占位符 | 安装时展开为 | 说明 |
|---|---|---|
| `%USERPROFILE%` | 当前用户的主目录（由系统展开） | 用户目录 |
| `%APPDATA%` / `%LOCALAPPDATA%` | 对应配置目录 | — |
| `%PROGRAMFILES%` / `%PROGRAMFILES(X86)%` | 程序目录 | — |
| `%SANWA_HOME%` | 本仓库所在目录 | 应用根 |
| `%SANWA_AI_ROOT%` | 默认 `%USERPROFILE%\AI` | AI 程序根（可用环境变量覆盖） |
| `%SANWA_MODELS_ROOT%` | 默认 `%SANWA_AI_ROOT%\models` | 模型根 |
| `%LMSTUDIO_HOME%`、`%DSH_HOME%`、`%COMFYUI_HOME%`、`%KIWIX_HOME%`、`%PYTHON314_HOME%` 等 | 默认按常见安装位置 | 可用环境变量覆盖 |

> 另外，文档示例中会用 `%SYSTEMDRIVE%` 表示**系统盘根目录**（通常是 `C:`）；`install.ps1` 不会展开这个占位符，真正写入 `data/tools.json` 时请直接写实际盘符路径（如 `D:\Apps\...`）。

示例（`data\tools.json` 中的工具卡片片段）：

```json
{
  "id": "my-tool",
  "name": "My Tool",
  "nameZh": "我的工具",
  "category": "system",
  "launch": {
    "kind": "exe",
    "exe": "%USERPROFILE%\\AppData\\Local\\Programs\\MyTool\\mytool.exe",
    "cwd": "%USERPROFILE%\\AppData\\Local\\Programs\\MyTool",
    "waitSeconds": 30
  },
  "health": { "type": "tcp", "port": 12345 }
}
```

- 想用系统盘以外的盘：直接写 `D:\Apps\MyTool\...`；示例中的 `D:\` 只是示意，替换成你的实际盘符即可。
- 改完后如果界面没更新：运行 `node .\scripts\build-ui.js` 重建，再刷新页面（或重启服务）。
- 若 `data\tools.json` 已存在，`install.ps1` 会跳过生成；想重新生成用 `-Force`（先备份）。

### 5.2 配置游戏库（可选）

```powershell
Copy-Item .\data\games-config.example.json .\data\games-config.json
```

按 [GAMES.md](GAMES.md) 填写 `steamLibraries` / `weGameDirs` / `roots`；不配置时只自动探测标准 Steam 安装目录。

### 5.3 配置天气城市（可选）

```powershell
New-Item -ItemType Directory -Force .\data\fortune | Out-Null
Copy-Item .\data\fortune.preferences.example.json .\data\fortune\preferences.json
```

编辑 `city`（留空自动定位）；详见 [FORTUNE.md](FORTUNE.md)。

## 6. 启动与停止

### 启动

- **方式 A（推荐）**：双击仓库根目录的 `start-sanwa.cmd`。它会在后台最小化启动本地服务，并自动打开浏览器 `http://127.0.0.1:9900/`。
- **方式 B（手动 / 看日志）**：在仓库根目录执行：

```powershell
node .\server.js
```

终端里会显示监听地址；保持窗口打开即保持服务运行；`Ctrl + C` 停止。

- **方式 C（离线打开界面）**：双击桌面 `Sanwa系统管理器.html`（`file://` 打开）。注意：界面数据仍需本地服务在运行；服务未启动时页面会显示「本地控制服务未运行」提示。

### 停止

```powershell
# 使用自带脚本（推荐）
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\stop-hub.ps1

# 或查看 PID 后结束
Get-Content .\data\hub.pid
# 输出示例：{ "pid": 12345, ... } —— 用这个 PID
Stop-Process -Id <pid>
```

### 首次打开

浏览器打开后会出现「生日门禁」：填写姓名 + 18 位身份证（用于生日倒计时 / 生日礼花 / 以你命名一颗星）。身份证**只在浏览器端校验并脱敏**，服务端只保存姓名、生日、脱敏号码，完整号码不落盘、不上传；也可以跳过或之后填写。详见 [PRIVACY.md](PRIVACY.md)。

## 7. 修改端口（`SANWA_PORT`）

服务端与 `start-sanwa.cmd` 都读取环境变量 `SANWA_PORT`，默认 `9900`。

**临时（仅当前 PowerShell 窗口）**：

```powershell
$env:SANWA_PORT = "9901"
node .\server.js
# 访问 http://127.0.0.1:9901/
```

**永久（用户级环境变量，需新开终端 / 重新登录生效）**：

```powershell
setx SANWA_PORT 9901
# 重新打开终端
node .\server.js
```

> 说明：`install.ps1 -Port 9901` 会把配置里的 `%SANWA_PORT%` 占位符展开为 9901（用于界面显示的 apiBase），但**不会**自动设置环境变量；要让服务真正监听新端口，请同时设置 `SANWA_PORT`。
> 端口修改后，桌面 HTML 仍可打开，但它连接的是新端口地址——建议直接访问 `http://127.0.0.1:<新端口>/`。

## 8. 开机自启开关

| 方式 | 操作 |
|---|---|
| 安装时开启 | `install.ps1 -Autostart` |
| 页面里开关 | 界面「设置 / 按需启动」→ 开机自启开关（调用 `POST /api/autostart`） |
| 手动安装 | `powershell -NoProfile -ExecutionPolicy Bypass -File .\install-autostart.ps1`（`-Mode hidden` 默认静默） |
| 关闭 | `powershell -NoProfile -ExecutionPolicy Bypass -File .\install-autostart.ps1 -Remove` |

- 快捷方式位置：`%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Sanwa系统管理器.lnk`；
- 只启动控制中心这个轻量服务（127.0.0.1:9900），**不会启动任何 AI 工具**；AI 工具始终按需点击启动。

## 9. 卸载

```powershell
# 1) 停止服务
powershell -NoProfile -ExecutionPolicy Bypass -File .\uninstall.ps1
```

`uninstall.ps1` 行为：

1. 调用 `scripts\stop-hub.ps1` 停止服务；
2. 删除登录自启快捷方式；
3. 删除桌面 `Sanwa系统管理器.html`；
4. 默认**保留** `data\` 与 `logs\`（防止误删你的配置）；要一起删除：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\uninstall.ps1 -KeepData:$false
```

5. 最后手动删除整个安装目录（源码目录不会被自动删除）。

> 如使用过 Steam 断网辅助：先以管理员运行 `tools\steam-net-on.ps1` 清理防火墙规则。你的 AI 程序、模型、游戏不会被删除。

## 10. 常见问题（快速版）

| 现象 | 处理 |
|---|---|
| `node -v` 找不到命令 | 安装 Node 22+ 并勾选 Add to PATH，重启终端 |
| 端口被占用 | `netstat -ano \| findstr :9900` 找到进程；或设置 `SANWA_PORT` 换端口 |
| 页面显示「本地控制服务未运行」 | 服务没启动：双击 `start-sanwa.cmd` 或 `node server.js` |
| 卡片是灰的 / 提示不可启动 | `data/tools.json` 里路径是占位符或路径不存在，改成真实路径 |
| 脚本被安全软件拦截 | 把 `scripts\` 加入信任区；模式切换有 Node 原生兜底 |
| 游戏扫不到 | 配置 `data\games-config.json` 后重新扫描 |
| 天气显示不出来 | 检查网络能否访问 wttr.in / api.open-meteo.com；不影响其它功能 |

更多问题见 [FAQ.md](FAQ.md)。

---

# English Version

## 1. Requirements

| Item | Requirement | Check |
|---|---|---|
| OS | Windows 10 / 11 (x64) | `winver` |
| Node.js | **22+** (LTS recommended) | `node -v` |
| PowerShell | Built-in 5.1 is fine | `$PSVersionTable.PSVersion` |
| Disk | ~10 MB (excluding your own AI apps/models/games) | — |
| Privileges | Standard user; some optional helpers need admin (explained separately) | — |
| Browser | Recent Edge / Chrome | — |

No Python, no `npm install`, no database, no Docker, no account.

## 2. Download

```powershell
# Option A: git clone (recommended)
git clone <REPO_URL> "$env:USERPROFILE\sanwa-system-manager"
cd "$env:USERPROFILE\sanwa-system-manager"

# Option B: download the GitHub ZIP and extract it so that
# server.js / install.ps1 / start-sanwa.cmd are directly in the folder root.
```

### Folder overview

```text
sanwa-system-manager\
├── server.js              # local service (Node stdlib)
├── install.ps1            # installer (generates data\tools.json, copies desktop UI)
├── uninstall.ps1          # uninstaller (stops service, removes autostart/desktop UI)
├── start-sanwa.cmd        # start + open browser
├── package.json           # metadata and npm scripts (no dependencies)
├── lib\                   # modes / game library / fortune-weather modules
├── scripts\               # tool launchers, UI build, autostart VBS
├── web\                   # UI template and built single-file UI
├── data\                  # configs (tools.json generated at install; *.example samples)
├── tools\                 # Steam network-block helpers (admin)
├── docs\                  # documentation
└── CHANGELOG.md / ROADMAP.md / LICENSE
```

After installation, `data\` will contain runtime files such as `tools.json`, `games.json` and `profile.json`. They are git-ignored — never commit them.

## 3. Install Node.js (skip if already installed)

1. Download the **LTS (≥ 22)** build from <https://nodejs.org/>;
2. Keep **Add to PATH** checked during installation;
3. Reopen PowerShell and verify: `node -v` → `v22.x` or newer.

## 4. Run the installer

From the repository root:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
```

| Parameter | Meaning |
|---|---|
| `-Autostart` | Also create a logon autostart shortcut (optional; only starts the lightweight local service, never your AI tools) |
| `-Force` | Overwrite an existing `data\tools.json` (loses your manual edits; back up first) |
| `-Port <n>` | Port used when expanding the `%SANWA_PORT%` placeholder in generated config (default 9900); the actual listener uses the `SANWA_PORT` env var |

The installer: checks Node ≥ 22 → creates `data\`, `data\pids\`, `logs\` → generates `data\tools.json` from `data\tools.example.json` with placeholders expanded → copies `web/index.html` to your Desktop as `Sanwa系统管理器.html` → optionally creates a logon shortcut. It does not require admin and does not change system settings.

## 5. First configuration

1. Edit `data\tools.json`: replace placeholder paths (`%USERPROFILE%`, `%PROGRAMFILES%`, `%SANWA_AI_ROOT%`, `%LMSTUDIO_HOME%`, …) with paths that exist on your machine. Use `%USERPROFILE%\...` for your home directory — never hardcode a real username in files you might publish.
2. Optional: `Copy-Item .\data\games-config.example.json .\data\games-config.json` and configure Steam/WeGame/standalone roots (see [GAMES.md](GAMES.md)).
3. Optional: create `data\fortune\preferences.json` from `data\fortune.preferences.example.json` to set your weather city.

After edits run `node .\scripts\build-ui.js` to rebuild the UI, then refresh the page.

## 6. Start / stop

```powershell
# Start (recommended): double-click start-sanwa.cmd (starts the service minimized and opens the browser)
# Or run in a terminal:
node .\server.js

# Stop:
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\stop-hub.ps1
```

On first open you will see the birthday gate (name + 18-digit ID). The ID is validated and masked **in the browser only**; the server stores name, birthday and a masked ID; the full ID is never written to disk or uploaded. You may skip it. See [PRIVACY.md](PRIVACY.md).

## 7. Change the port (`SANWA_PORT`)

```powershell
# Temporary (current shell only)
$env:SANWA_PORT = "9901"
node .\server.js
# open http://127.0.0.1:9901/

# Persistent (new terminals/logon)
setx SANWA_PORT 9901
```

`install.ps1 -Port 9901` only expands the placeholder in the generated config; set the `SANWA_PORT` environment variable to change the actual listening port.

## 8. Autostart

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install-autostart.ps1          # enable (hidden mode)
powershell -NoProfile -ExecutionPolicy Bypass -File .\install-autostart.ps1 -Remove  # disable
```

Shortcut: `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Sanwa系统管理器.lnk`. Only the local service starts at logon — no AI tools.

## 9. Uninstall

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\uninstall.ps1
# also delete data/ and logs/:
powershell -NoProfile -ExecutionPolicy Bypass -File .\uninstall.ps1 -KeepData:$false
```

This stops the service, removes the autostart shortcut and the desktop HTML; `data/` and `logs/` are kept by default. Delete the source folder manually afterwards. If you used the Steam network-block helper, run `tools\steam-net-on.ps1` as admin to remove the firewall rules.

## 10. Quick troubleshooting

| Symptom | Fix |
|---|---|
| `node -v` not found | Install Node 22+, check Add to PATH, reopen terminal |
| Port 9900 in use | `netstat -ano \| findstr :9900`; or set `SANWA_PORT` |
| Page says local service is not running | Start the service (`start-sanwa.cmd` / `node server.js`) |
| Cards greyed out | Fix placeholder paths in `data\tools.json` |
| Antivirus blocks scripts | Add `scripts\` to the trust list; mode switching has a Node-native fallback |
| Games not detected | Configure `data\games-config.json`, then rescan |
| Weather unavailable | Check access to wttr.in / api.open-meteo.com; other features still work |

More: [FAQ.md](FAQ.md).
