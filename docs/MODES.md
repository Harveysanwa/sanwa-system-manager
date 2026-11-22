# 五种模式（Modes）

> 「模式」= 一键把电脑调整成某类用途：该关的关、该开的开，并保护关键进程不被误杀。
> 模式定义在 `data/tools.json → modes`，由 `lib/modes.js`（纯 Node，不经过 PowerShell）执行。

## 1. 总览

| 模式 id | 名称 | 一句话 | 启动 | 关闭 |
|---|---|---|---|---|
| `normal` | 正常模式 | 手动模式，什么都不动 | — | — |
| `ai` | AI 模式 | 拉起本地 AI，停掉办公娱乐 | Ollama、LM Studio、Open WebUI、ComfyUI（**由你在弹窗中多选**） | WPS、LibreOffice、抖音聊天、汽水音乐 |
| `office` | 办公模式 | 办公/通讯/网盘就位，让出生图与娱乐 | WPS、LibreOffice、微信、钉钉、百度网盘 | ComfyUI、LM Studio、汽水音乐、抖音聊天 |
| `game` | 游戏模式 | 关掉全部 AI，把内存/显存让给游戏 | — | 全部 AI 工具（15 项） |
| `extreme` | 极端游戏模式 | 只留游戏与系统，其它能关的全关 | — | 全部 AI 工具 + 办公/社交/娱乐/云同步（共 23 项） |

> 上表为 `data/tools.example.json` 的默认定义；你可以按自己的工具清单修改。模式**不会**持久化到下次开机：每次启动都是 `normal`，避免「上次忘了退出极端模式」。

## 2. 各模式细节

### 正常模式（normal）

- 不自动启动 / 停止任何工具，所有卡片按需点击。
- 开机后默认就是此模式；AI 工具不会随开机启动。

### AI 模式（ai）

1. 点击「AI 模式」后弹出 **AI 工具多选**（带运行状态、上次选择记忆、全选 / 清空、至少选 1 个）；
2. 确认后执行：先关闭办公与娱乐应用，再启动你所选的 AI；
3. 选择会写入 `data/mode-preferences.json`，下次打开默认勾选；
4. 已在运行的 AI 不会重复启动（会标记为「已在运行」）。

**注意**：AI 服务启动慢是正常的——模型加载 + 端口监听通常需要几十秒，页面会显示「启动中… 已等待 N 秒」，超时会在日志里提示。不要连续点击。

### 办公模式（office）

- 适合白天工作：WPS / LibreOffice / 微信 / 钉钉 / 百度网盘；
- 会关闭生图（ComfyUI / LM Studio）与娱乐（抖音聊天 / 汽水音乐），把内存让给办公；
- 不会关闭微信 / 钉钉之外你手动开的其它聊天工具（未在清单内的不处理）。

### 游戏模式（game）

- 关闭全部 AI 工具（模型服务、聊天客户端、开发类服务等共 15 项），把内存 / 显存让给游戏；
- **保留**：DeepSeek Harness、控制中心自身、Steam、雷神加速器、系统进程；
- 可选：在游戏弹窗中勾选本次要启动的游戏，由 `lib/games` 做启动编排（加速器 / Steam 离线等）。

### 极端游戏模式（extreme）

- 在游戏模式基础上再关闭办公（WPS / LibreOffice）、社交娱乐（微信 / 钉钉 / 抖音聊天 / 汽水音乐）、云同步（百度网盘 / OneDrive）；
- 只保留游戏、DeepSeek Harness、控制中心、系统进程；
- **适合**：大型单机、显存吃紧、需要极限帧率的场景；
- **注意**：部分应用（带服务/驱动/自保护的客户端）可能关不掉，结果会如实列在「失败」里，不会假装成功；个别应用需要管理员权限才能停止。

## 3. 模式切换时发生了什么

```text
POST /api/modes/switch  {"mode":"game"}
  │
  ├─ 1. 读取并校验 mode（normal/ai/office/game/extreme）
  ├─ 2. 停止 stop[] 列表：按「进程名 + 可执行文件路径」双条件匹配，
  │     逐个 PID 结束；跳过受保护名单；记录关闭项与释放内存
  ├─ 3. 等待端口释放（约 1–2 秒）
  ├─ 4. 启动 start[] 列表：按定义顺序启动并等待健康检查
  │     AI 模式只启动你在弹窗里勾选的项
  ├─ 5. 写 data/mode-state.json（当前模式、lastResult：stopped/started/failed/freedMemoryMB/durationSec）
  └─ 6. 返回 {ok, mode, stopped[], started[], failed[], skipped[], freedMemoryMB, message}
```

UI 会显示停止 / 启动 / 失败清单与释放的内存；失败项会带中文原因。当前模式状态也会体现在右栏、HUD 与页头。

### 不会被关闭的东西

`lib/modes.js` 内置保护名单（与 `modes.protected` 合并），包括但不限于：

- DeepSeek Harness（`DeepSeek Harness.exe`）
- 控制中心自身（`node.exe`、`hub-self`）
- 系统进程（`explorer.exe`、`svchost.exe`、`dwm.exe`、`lsass.exe` 等）
- Steam（`steam.exe`、`steamwebhelper.exe`、`SteamService.exe`）
- 雷神加速器（`leigod*.exe`）
- 开发工具链（Node.js、Python、Git、CUDA、Visual Studio、WSL 等，按 `modes.protected` 配置）

## 4. 自定义模式

### 4.1 修改现有模式的启停清单

编辑 `data/tools.json`（首次安装由 `data/tools.example.json` 生成）：

```json
{
  "modes": {
    "default": "normal",
    "definitions": {
      "ai": {
        "name": "AI 模式",
        "description": "启动 Ollama / LM Studio / Open WebUI / ComfyUI",
        "start": ["ollama", "lmstudio", "open-webui", "comfyui"],
        "stop": ["wps", "libreoffice", "douyin-chat", "soda-music"]
      }
    },
    "protected": ["deepseek-harness", "hub-self", "steam", "leigod"]
  }
}
```

- `start` / `stop` 里写的是工具 `id`（`data/tools.json → tools[].id`），不是显示名；
- 不存在的 id 会被安全忽略；
- 受保护 id 即使写进 `stop` 也不会被关闭；
- 保存后无需重启服务：模式引擎在切换时重新读取配置（页面刷新即可看到最新 `modes`）。

### 4.2 新增一个模式

1. 在 `modes.definitions` 里加一项，例如：

```json
"workout": {
  "name": "游戏+录屏模式",
  "color": "#34d399",
  "icon": "gamepad",
  "description": "关闭 AI，启动 Steam 与视频工具",
  "start": ["steam", "video-lab"],
  "stop": ["ollama", "lmstudio", "open-webui", "comfyui"]
}
```

2. 前端模式栏的模式按钮来自 `GET /api/modes/status → definitions`，新增模式会自动出现（图标 / 颜色见定义）；
3. 若你希望模式按钮有专属交互（例如 AI 模式的多选弹窗），需要在界面模板里补充对应逻辑——可参考 `AI 模式` 的实现，或让 AI 助手按 `docs/THEMES-I18N.md` 的说明修改 `web/ui.template.html` 后运行 `node scripts/build-ui.js`。

### 4.3 「全部停止」与游戏模式的区别

| 按钮 | 作用 | 是否记录模式 | 是否自动恢复 |
|---|---|---|---|
| 全部停止（`POST /api/stop-all`） | 关闭全部可关闭的 AI / 办公 / 娱乐工具，不进入任何模式 | 否 | 否，需要手动点卡片启动 |
| 游戏模式 `POST /api/game-mode` | 进入游戏模式并记录进入前运行的服务，退出时恢复 | 是（`data/game-mode-state.json`） | 是，`POST /api/game-mode/exit` 恢复 |
| 五种模式 `POST /api/modes/switch` | 按模式定义调整 | 是（`data/mode-state.json`） | 否；切回 `normal` 也不会自动重启 |

## 5. 注意事项与限制

1. **模式不替代任务管理器**：它只处理清单内的工具，按「进程名 + 路径」精确匹配；同名但不同路径的进程不会被误杀，清单外的程序也不会被关闭。
2. **AI 模式启动慢**：模型加载、首次推理预热可能需要 30–120 秒，期间状态为 `starting`；`waitSeconds` 可在工具卡片里调整。
3. **极端模式可能需要管理员**：某些应用以管理员 / 服务方式运行，普通权限无法结束，会出现在 `failed` 列表；如需彻底关闭，请手动退出或以管理员身份处理。
4. **安全软件可能拦截**：极少数情况下火绒 / HIPS 会中断 PowerShell；模式切换本身是 Node 原生执行，不受影响；但工具启动脚本可能被拦截，请按提示将 `scripts\` 加入信任区。
5. **不要在重要工作中切换模式**：切换会关闭清单内的程序，请先保存文件。
6. **切换的原子性**：模式切换是「尽力而为」的顺序操作，中途失败会记录到 `lastResult.failed`；不会回滚已关闭的程序，需要手动恢复。
7. **并发互斥**：模式切换、游戏模式、全部停止共用一把锁，同时操作会返回 `MODE_BUSY` / `GAME_BUSY`。
