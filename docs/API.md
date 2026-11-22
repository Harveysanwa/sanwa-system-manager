# 本地 API（API Reference）

> 所有接口由本机 `server.js` 提供，默认地址 **`http://127.0.0.1:9900`**（端口可用环境变量 `SANWA_PORT` 修改）。
> 本文件按 v1.5.0 的 `server.js` 实际实现编写；字段以代码为准，示例中的路径/名称均为占位符。

## 1. 通用约定

| 项目 | 说明 |
|---|---|
| 基础地址 | `http://127.0.0.1:9900`（只监听回环地址，不对外网提供） |
| 协议 | HTTP/1.1，请求与响应均为 JSON（`Content-Type: application/json; charset=utf-8`） |
| 鉴权 | **无**（仅限本机使用；见第 10 节安全说明） |
| CORS | `Access-Control-Allow-Origin: *`、允许 `GET, POST, OPTIONS`（为了 `file://` 打开的桌面 HTML 能调用） |
| 请求体 | JSON（**UTF-8 编码**，中文参数请确保客户端按 UTF-8 发送）；普通接口上限 **64 KB**，背景图接口上限 **12 MB**（图片本身 ≤ 8 MB） |
| 时间格式 | 多数 `at` 字段为本地 ISO（如 `2026-11-22T15:30:00+08:00`）；`startedAt` 等为 UTC ISO（`2026-11-22T07:30:00.000Z`） |
| 缓存 | 响应头 `Cache-Control: no-store`；`/api/background/file/<name>` 有 86400 秒缓存 |

### 错误响应

非 2xx 时返回统一结构：

```json
{
  "ok": false,
  "error": "UNKNOWN_TOOL",
  "message": "未知工具 id（不在白名单内）"
}
```

常见状态码与错误码：

| HTTP | 典型 `error` | 场景 |
|---|---|---|
| 400 | `BAD_BODY` / `BAD_NAME` / `BAD_BIRTH` / `BAD_DATE` / `BAD_ID` / `NOT_READY` / `UNKNOWN_MODE` / `EMPTY_AI_SELECTION` | 参数不合法、工具不可启动、AI 模式未选工具 |
| 403 | `NOT_OWNED` / `FORBIDDEN_SELF` | 试图停止非本服务启动的进程 / 停止控制中心自身 |
| 404 | `UNKNOWN_TOOL` / `NOT_FOUND` | 未知工具 id / 未知接口或文件 |
| 405 | `METHOD_NOT_ALLOWED` | 方法不支持 |
| 409 | `GAME_BUSY` / `MODE_BUSY` / `GAME_MODE_ACTIVE` | 并发操作冲突 / 游戏模式下尝试启动被暂停的工具 |
| 413 | `IMAGE_TOO_LARGE` | 背景图超过 8 MB |
| 500 | `CONFIG_ERROR` / `LAUNCH_FAILED` / `SCRIPT_MISSING` / `GAME_SCRIPT` / `STOP_ALL_FAILED` / `MODE_SWITCH_FAILED` | 配置或执行异常 |
| 502/503 | `FORTUNE_ERROR` / `FORTUNE_LOADING` / `GAMES_LOADING` / `MODES_ENGINE_MISSING` | 子模块未加载或异常 |

### PowerShell 调用模板

```powershell
$base = 'http://127.0.0.1:9900'
Invoke-RestMethod "$base/api/ping"
Invoke-RestMethod -Method Post -Uri "$base/api/launch" -ContentType 'application/json' -Body '{"id":"ollama"}'
```

---

## 2. 系统与状态

### 2.1 `GET /api/ping` — 存活检查

```json
{ "ok": true, "hub": "1.5.0", "at": "2026-11-22T15:30:00+08:00", "pid": 12345 }
```

### 2.2 `GET /api/version` — 版本信息

```json
{ "ok": true, "hub": "1.5.0", "node": "v24.16.0", "startedAt": "2026-11-22T07:30:00.000Z" }
```

### 2.3 `GET /api/meta` — 元信息、磁盘、工具统计、界面同步状态

```json
{
  "ok": true,
  "generatedAt": "2026-11-22T15:30:00+08:00",
  "hub": {
    "name": "Sanwa系统管理器",
    "version": "1.5.0",
    "host": "127.0.0.1",
    "port": 9900,
    "apiBase": "http://127.0.0.1:9900",
    "pid": 12345,
    "node": "v24.16.0",
    "platform": "win32 x64",
    "startedAt": "2026-11-22T07:30:00.000Z",
    "uptimeSec": 120,
    "root": "<SANWA_HOME>",
    "desktopHtml": "%USERPROFILE%\\Desktop\\Sanwa系统管理器.html",
    "webIndex": "<SANWA_HOME>\\web\\index.html",
    "startCmd": "<SANWA_HOME>\\start-sanwa.cmd",
    "logsDir": "<SANWA_HOME>\\logs",
    "scriptsDir": "<SANWA_HOME>\\scripts"
  },
  "disks": [
    { "id": "C", "label": "系统盘", "root": "C:\\", "available": true,
      "totalBytes": 320000000000, "freeBytes": 190000000000, "usedPercent": 40.6 }
  ],
  "tools": {
    "total": 41,
    "draft": 0,
    "categories": [ { "id": "system", "name": "系统服务", "count": 13 } ]
  },
  "ui": {
    "desktop": { "path": "%USERPROFILE%\\Desktop\\Sanwa系统管理器.html", "exists": true, "size": 382000, "mtime": "2026-11-22T07:00:00.000Z" },
    "web": { "path": "<SANWA_HOME>\\web\\index.html", "exists": true, "size": 382000, "mtime": "2026-11-22T07:00:00.000Z" },
    "syncNote": "两者内容一致"
  }
}
```

> 磁盘固定检查 C / D / I 三个盘（不存在的盘 `available:false`）。

### 2.4 `GET /api/resources` — 资源 HUD 数据

```json
{
  "ok": true,
  "host": { "name": "<HOSTNAME>", "uptimeSec": 86400, "os": "Windows 11 ...", "release": "10.0.26100", "platform": "win32 x64" },
  "cpu": { "model": "Example CPU", "cores": 24, "threads": 24, "maxMHz": 5600, "currentMHz": 3200,
           "usagePct": 12.5, "coresUsage": [8.1, 10.2, "…"] },
  "memory": { "totalBytes": 68000000000, "usedBytes": 24000000000, "freeBytes": 44000000000, "usedPct": 35.3 },
  "gpu": {
    "available": true, "name": "Example GPU", "driver": "000.00",
    "vramTotalMB": 16384, "vramUsedMB": 2048, "vramFreeMB": 14336,
    "utilPct": 5, "tempC": 42, "powerW": 35.5, "fanPct": 30,
    "processes": [ { "pid": 4321, "name": "example", "usedMB": 512 } ]
  },
  "net": { "available": true, "upMbps": 0.12, "downMbps": 1.5, "rxBytes": 123456789, "txBytes": 98765432 },
  "disks": [ { "id": "C", "label": "系统盘", "totalBytes": 320000000000, "freeBytes": 190000000000, "usedPct": 40.6 } ],
  "gameMode": { "active": false, "enteredAt": "", "exitedAt": "", "freedMemoryMB": 0, "freedVramMB": 0, "restoredCount": 0 },
  "mode": { "current": "normal", "since": "2026-11-22T07:30:00.000Z" },
  "hub": { "version": "1.5.0", "pid": 12345, "coreConfig": 41 },
  "at": "2026-11-22T15:30:00+08:00"
}
```

说明：

- GPU 依赖 `nvidia-smi`；不存在或无独显时 `available:false`，其它字段为 `null` / 空数组；
- `net` 由 `netstat -e` 两次采样差分得出；首次调用速率可能为 0；
- CPU 占用率两次采样间隔 ≥ 1 秒（服务启动时会预热一次）。

---

## 3. 工具（Tools）

### 3.1 `GET /api/tools` — 工具清单（脱敏）

```json
{
  "ok": true,
  "generatedAt": "2026-11-22T15:30:00+08:00",
  "version": "1.5.0",
  "toolBookVersion": "1.5.0",
  "isDraft": false,
  "categories": [ { "id": "system", "name": "系统服务" } ],
  "tools": [
    {
      "id": "ollama",
      "name": "Ollama",
      "nameZh": "本地大模型引擎",
      "i18n": { "en": { "description": "..." }, "ja": { "description": "..." } },
      "category": "system",
      "categoryName": "系统服务",
      "version": "0.40.16",
      "description": "本地 GGUF 大模型推理服务（:11434）…",
      "icon": "brain",
      "tags": ["本地模型", "LLM"],
      "url": "http://127.0.0.1:11434/",
      "openUrl": "http://127.0.0.1:11434/",
      "statusText": { "running": "Ollama 服务运行中", "stopped": "Ollama 未启动" },
      "draft": false,
      "badge": "",
      "gameMode": "stop",
      "paths": { "current": "%USERPROFILE%\\AppData\\Local\\Programs\\Ollama", "target": "%SANWA_AI_ROOT%\\apps\\Ollama" },
      "notes": ["…"],
      "actionLabel": "",
      "launchKind": "exe",
      "canLaunch": true,
      "launchReady": true,
      "launchReason": "",
      "healthType": "http",
      "healthPort": 11434
    }
  ],
  "hub": {
    "name": "Sanwa系统管理器",
    "version": "1.5.0",
    "host": "127.0.0.1",
    "port": 9900,
    "apiBase": "http://127.0.0.1:9900",
    "desktopHtml": "%USERPROFILE%\\Desktop\\Sanwa系统管理器.html",
    "startCmd": "<SANWA_HOME>\\start-sanwa.cmd"
  }
}
```

> 安全设计：返回的是**脱敏后的 public 字段**，不包含 `launch.exe` / `launch.script` / `launch.args` 等可执行细节。
> 配置读取顺序：`data/tools.json`（安装时生成）→ `data/tools.example.json`（回退）；两者都不存在时返回 500 `CONFIG_ERROR`。

### 3.2 `GET /api/status` — 逐工具健康状态

```json
{
  "ok": true,
  "at": "2026-11-22T15:30:00+08:00",
  "hub": { "version": "1.5.0", "port": 9900, "uptimeSec": 120 },
  "states": {
    "ollama": {
      "id": "ollama",
      "state": "running",
      "detail": "HTTP 200",
      "latencyMs": 23,
      "checkedBy": "http",
      "url": "http://127.0.0.1:11434/",
      "ownedByHub": false,
      "canStop": false,
      "canLaunch": true,
      "draft": false
    }
  }
}
```

`state` 取值：`running` / `stopped` / `starting` / `unknown`。结果缓存 1 秒。

### 3.3 `POST /api/launch` — 启动 / 打开工具

请求：

```json
{ "id": "ollama" }
```

可能的响应：

```json
{ "ok": true, "action": "launching", "state": "starting", "message": "正在启动 本地大模型引擎…", "waitSeconds": 30 }
{ "ok": true, "action": "open", "state": "running", "message": "本地大模型引擎 已在运行，已为你打开界面" }
{ "ok": true, "action": "pending", "state": "starting", "message": "操作过于频繁，请稍候重试" }
```

行为要点：

1. `id` 必须存在于 `data/tools.json`（否则 404 `UNKNOWN_TOOL`），请求体中的路径/参数一律忽略；
2. 游戏模式激活且该工具 `gameMode=stop` → 409 `GAME_MODE_ACTIVE`；
3. 已在运行 → 只打开界面，不重复启动；
4. 未配置 / 文件或脚本缺失 → 400 `NOT_READY`，`message` 给出中文原因；
5. 真正启动时只执行 `scripts/<id>.ps1 -Action start`（`kind=url/self` 等除外）；
6. 防抖：同一工具 1.5 秒内重复请求返回 `pending`。

### 3.4 `POST /api/stop` — 停止由本服务启动的工具

请求：`{ "id": "ollama" }`

```json
{ "ok": true, "action": "stopped", "state": "stopped", "message": "Ollama 已停止" }
```

安全限制：

- 只允许停止 **由本服务启动**（PID 文件 + 启动时间 + 可执行路径三重校验）的进程，否则 403 `NOT_OWNED`；
- 不允许停止控制中心自身（403 `FORBIDDEN_SELF`）；
- 未配置启动方式的工具 → 400 `NOT_CONFIGURED`。

### 3.5 `POST /api/stop-all` — 全部停止（不进入游戏模式）

请求：`{}`（无字段）

```json
{
  "ok": true,
  "active": false,
  "gameMode": false,
  "engine": "node-native",
  "closedIds": ["ollama", "lmstudio"],
  "closedTools": [ { "id": "ollama", "name": "Ollama", "nameZh": "本地大模型引擎", "memoryMB": 2048, "processCount": 2, "processes": [] } ],
  "freedMemoryMB": 2048,
  "freedVramMB": 0,
  "totalProcesses": 2,
  "portReleaseOk": true,
  "protected": { "dshAlive": true, "hubAlive": true },
  "message": "已全部停止 2 个 AI 服务/应用，释放约 2.0 GB 内存"
}
```

- 只关闭 `gameMode=stop` 的工具；不写 `active=true`、不改变模式状态；
- 与模式切换 / 游戏模式共用互斥锁，冲突时 409 `GAME_BUSY`。

### 3.6 `GET /api/logs?id=<toolId>&lines=<n>` — 读取工具日志尾部

- `id`：工具 id 或 `hub`；`lines`：1–1000，默认 200。

```json
{
  "ok": true,
  "id": "ollama",
  "file": "<SANWA_HOME>\\logs\\ollama.log",
  "exists": true,
  "lines": ["2026-11-22 15:30:00 已启动…"],
  "note": ""
}
```

### 3.7 `GET /api/activity?limit=<n>` — 最近操作日志（右栏展示）

`limit` 1–50，默认 10。

```json
{ "ok": true, "items": [ { "at": "2026-11-22 15:30:00", "level": "info", "text": "launch ollama（脚本 ollama.ps1）" } ] }
```

---

## 4. 五种模式（Modes）

### 4.1 `GET /api/modes/status` — 当前模式与定义

```json
{
  "ok": true,
  "current": { "mode": "normal", "since": "2026-11-22T07:30:00.000Z", "updatedAt": "…", "lastResult": null },
  "definitions": {
    "normal": { "name": "正常模式", "color": "#22d3ee", "icon": "spark", "description": "手动模式…", "start": [], "stop": [] },
    "ai": { "name": "AI 模式", "color": "#a78bfa", "icon": "brain", "description": "…", "start": ["ollama"], "stop": ["wps"] }
  },
  "modes": ["normal", "ai", "office", "game", "extreme"],
  "runningTools": [ { "id": "ollama", "name": "Ollama", "nameZh": "本地大模型引擎", "category": "system", "gameMode": "stop" } ],
  "runningCount": 1,
  "startupAudit": [ { "group": "保留/正常", "name": "AI 控制中心（登录自启）", "kind": "hub-autostart", "status": "enabled", "enabled": true, "path": "…" } ],
  "preferences": { "aiSelection": ["ollama", "lmstudio"] },
  "aiTools": [ { "id": "ollama", "name": "Ollama", "nameZh": "本地大模型引擎", "category": "system" } ],
  "protected": { "note": "…", "names": ["DeepSeek Harness.exe", "node.exe", "..."], "sampleProtected": [] },
  "at": "2026-11-22T15:30:00+08:00"
}
```

### 4.2 `POST /api/modes/switch` — 切换模式

请求：

```json
{ "mode": "ai", "start": ["ollama", "lmstudio"] }
```

- `mode`：`normal` / `ai` / `office` / `game` / `extreme`；
- `start`：仅 `ai` 模式使用，指定本次要启动的 AI 工具 id（至少 1 个；不传则用上次记忆或默认定义）。

响应（成功切换）：

```json
{
  "ok": true,
  "mode": "ai",
  "modeName": "AI 模式",
  "since": "2026-11-22T07:40:00.000Z",
  "stopped": [ { "id": "wps", "nameZh": "WPS", "nameEn": "WPS Office", "processCount": 1, "memoryMB": 512, "portReleased": true } ],
  "started": [ { "id": "ollama", "nameZh": "本地大模型引擎", "ok": true, "seconds": 6 } ],
  "failed": [],
  "skipped": [ { "id": "lmstudio", "nameZh": "本地模型工作台", "reason": "已在运行" } ],
  "freedMemoryMB": 512,
  "closedNonGameCount": 1,
  "durationSec": 14,
  "protected": { "dshAlive": true, "hubAlive": true },
  "message": "已切换到AI 模式，已启动所选的 2 个 AI 工具，关闭 1 项"
}
```

- 切换到当前模式：`unchanged:true`，不做操作（AI 模式可只更新选择）；
- 互斥：并发切换返回 409 `MODE_BUSY`；
- 失败项在 `failed[]` 中带原因，不会伪造成功。

---

## 5. 游戏模式（Game Mode）

> 与「五模式」里的 `game`（`/api/modes/switch`）是两套机制：游戏模式会记录进入前运行的服务，退出时恢复；`POST /api/game-mode` 使用 `scripts/game-mode.ps1` / Node 原生兜底。

### 5.1 `GET /api/game-mode/status`

未激活：

```json
{
  "ok": true,
  "active": false,
  "candidates": [ { "id": "ollama", "name": "Ollama", "nameZh": "本地大模型引擎", "category": "system",
                    "memoryMB": 2048, "vramMB": 0, "processCount": 2, "processes": [] } ],
  "totalMemoryMB": 2048,
  "totalVramMB": 0,
  "totalProcesses": 2,
  "gpuTotalUsedMB": 2048,
  "protected": { "dshAlive": true, "hubAlive": true },
  "lastSession": null,
  "toolPolicies": { "stop": [], "keep": [] },
  "busy": false,
  "at": "2026-11-22T15:30:00+08:00"
}
```

已激活时返回 `active:true`、`enteredAt`、`closedTools`、`closedIds`、`freedMemoryMB`、`freedVramMB`、`totalProcesses`、`portReleaseOk`、`protected` 等字段。

### 5.2 `POST /api/game-mode` — 进入游戏模式

- 请求 `{}`：执行进入（关闭 AI 服务/应用，保留 DeepSeek Harness、控制中心、Steam、雷神）；
- 请求 `{"dryRun":true}`：只预演，返回 `candidates[]`、`totalMemoryMB`、`message`，不关闭任何东西。

响应示例：

```json
{
  "ok": true,
  "active": true,
  "engine": "node-native",
  "enteredAt": "2026-11-22T07:45:00.000Z",
  "closedIds": ["ollama", "lmstudio"],
  "closedTools": [ { "id": "ollama", "memoryMB": 2048, "processCount": 2 } ],
  "freedMemoryMB": 2048,
  "freedVramMB": 0,
  "totalProcesses": 2,
  "portReleaseOk": true,
  "protected": { "dshAlive": true, "hubAlive": true },
  "message": "已关闭 2 个 AI 服务/应用，释放约 2.0 GB 内存"
}
```

失败时：409 `GAME_BUSY`（正在切换）或 500 `GAME_SCRIPT`（含中文排查建议）。

### 5.3 `POST /api/game-mode/exit` — 退出游戏模式并恢复服务

请求 `{}`。响应示例：

```json
{
  "ok": true,
  "active": false,
  "restored": [ { "id": "ollama", "name": "本地大模型引擎", "seconds": 5 } ],
  "skipped": [],
  "failed": [],
  "message": "已退出游戏模式，恢复了 1 个服务"
}
```

安全软件中断脚本时服务会自愈或改用 Node 原生恢复，并在 `warning` 字段说明。

---

## 6. 游戏库（Games）

### 6.1 `GET /api/games` — 读取扫描缓存

```json
{
  "ok": true,
  "games": [
    {
      "id": "steam-<appid>",
      "name": "Example Game",
      "nameZh": "示例游戏",
      "platform": "steam",
      "installDir": "D:\\Games\\ExampleGame",
      "exe": "D:\\Games\\ExampleGame\\game.exe",
      "appid": 123456,
      "sizeGB": 42.5,
      "region": "overseas",
      "mode": "online",
      "tags": ["online", "overseas", "steam-library", "accelerator-needed"],
      "detectedBy": "steam",
      "lastSeen": "2026-11-22T07:00:00.000Z"
    }
  ],
  "stats": { "total": 1, "steam": 1, "wegame": 0, "standalone": 0, "epic": 0, "unknown": 0,
             "domestic": 0, "overseas": 1, "regionUnknown": 0,
             "online": 1, "single": 0, "cracked": 0, "modeUnknown": 0, "scanMs": 1200, "steamLibraries": 1 },
  "scannedAt": "2026-11-22T07:00:00.000Z",
  "updatedAt": "2026-11-22T07:00:00.000Z",
  "overrides": {},
  "source": "<SANWA_HOME>\\data\\games.json",
  "version": 1
}
```

未扫描过时返回 `ok:false` + 空列表（`error` 说明），页面显示引导。

### 6.2 `POST /api/games/scan` — 重新扫描

请求 `{}`。只读扫描，不启动任何游戏。响应在 `GET /api/games` 基础上增加：

```json
{
  "ok": true,
  "games": [],
  "stats": {},
  "scannedAt": "2026-11-22T07:50:00.000Z",
  "durationMs": 1520,
  "warnings": ["未配置 data/games-config.json 的 roots，跳过独立游戏目录扫描"],
  "steamLibraries": ["C:\\Program Files (x86)\\Steam"],
  "overrides": {},
  "scannedFile": "<SANWA_HOME>\\data\\games.json"
}
```

### 6.3 `POST /api/games/launch` — 启动编排

请求：

```json
{ "id": "steam-<appid>", "accelerator": "auto", "steamMode": "auto", "dryRun": false }
```

| 字段 | 取值 | 默认 |
|---|---|---|
| `id` | 游戏 id | 必填 |
| `accelerator` | `auto` / `on` / `off` | `auto` |
| `steamMode` | `auto` / `offline` / `block` / `off` | `auto` |
| `dryRun` | 布尔 | `false` |

响应：

```json
{
  "ok": true,
  "game": { "id": "steam-<appid>", "nameZh": "示例游戏", "platform": "steam", "region": "overseas", "mode": "online" },
  "actions": [
    { "type": "accelerator", "ok": true, "alreadyRunning": false, "note": "已拉起雷神加速器" },
    { "type": "game-launch", "ok": true, "method": "steam-uri", "target": "steam://rungameid/<appid>" }
  ],
  "steamNetBlock": null,
  "dryRun": false,
  "message": "《示例游戏》启动已下发；平台=steam / 境外 / 联机；加速器=已拉起；Steam=保持运行（联网）",
  "launch": { "type": "game-launch", "ok": true, "method": "steam-uri", "target": "steam://rungameid/<appid>" },
  "accelerator": { "needed": true, "reason": "境外联机游戏", "mode": "auto" },
  "steamOffline": { "requested": false, "reason": "在线游戏保持 Steam 联网", "mode": "auto" },
  "helper": null
}
```

单机/破解游戏可能包含：

```json
{
  "type": "steam-offline",
  "ok": true,
  "alreadyStopped": false,
  "killed": [1234],
  "failed": [],
  "note": "已关闭 Steam"
},
{ "type": "game-launch", "ok": true, "method": "exe", "target": "D:\\Games\\ExampleGame\\game.exe" }
```

以及 `steamNetBlock`：

```json
{ "requested": true, "applied": false, "admin": false, "reason": "需要管理员权限",
  "helper": "<SANWA_HOME>\\tools\\steam-net-off.ps1", "note": "当前用户非管理员，未修改防火墙…" }
```

> 非管理员时 **不会** 伪造断网成功；`applied:false` 是如实返回。

### 6.4 `POST /api/games/overrides` — 覆盖分类

请求（只合并传入的字段；`null` 表示删除覆盖）：

```json
{ "id": "steam-<appid>", "region": "domestic", "mode": "single", "tags": ["单机"] }
```

```json
{ "ok": true, "overrides": { "steam-<appid>": { "region": "domestic", "mode": "single", "tags": ["单机"] } }, "updatedAt": "…", "message": "已合并保存 1 项覆盖" }
```

允许覆盖字段：`region`（domestic/overseas/unknown）、`mode`（online/single/cracked/unknown）、`tags`（字符串数组）、`nameZh`（`lib/games` 内部支持，接口只透传 region/mode/tags）。

---

## 7. 玄学与天气（Fortune & Weather）

### 7.1 `GET /api/weather` — 天气（实时 + 3 日 + 7 日 + 趋势）

```json
{
  "ok": true,
  "city": "<城市>",
  "area": "<区域>",
  "country": "China",
  "resolvedCity": "<城市>",
  "coord": { "lat": 0, "lon": 0 },
  "current": { "tempC": 18, "feelsLikeC": 17, "desc": "晴", "humidity": 45, "windKmh": 12, "windDir": "北风", "pressure": 1012, "visibilityKm": 10, "cloudCover": 10, "uvIndex": 3 },
  "forecast": [ { "date": "2026-11-23", "minC": 10, "maxC": 20, "desc": "晴", "chanceOfRain": "0" } ],
  "forecast7": [
    { "date": "2026-11-23", "weekdayCN": "周一", "weekday": "Mon", "code": 0, "desc": "晴", "descEn": "Clear sky",
      "maxC": 20, "minC": 10, "precipMM": 0, "precipProb": 0, "windKmh": 12, "isRain": false, "isSnow": false, "isSunny": true }
  ],
  "forecast7Source": "open-meteo",
  "forecast7Fallback": false,
  "trend": {
    "summary": "未来7天以晴为主，周四起降温 5°C。",
    "changes": [ { "date": "2026-11-27", "type": "降温", "deltaC": 5 } ],
    "rainyDays": [], "sunnyDays": ["2026-11-23"], "snowDays": [], "alerts": []
  },
  "source": "wttr.in",
  "stale": false,
  "cached": false,
  "updatedAt": "2026-11-22T15:30:00+08:00",
  "note": "天气数据来自 wttr.in，仅供生活参考"
}
```

失败时：503 `FORTUNE_ERROR`（含原因），不影响其它接口。

### 7.2 `GET /api/almanac?date=YYYY-MM-DD` — 黄历

缺省今天；`date` 非法 → 400 `BAD_DATE`。

```json
{
  "ok": true,
  "date": "2026-11-22",
  "solar": { "y": 2026, "m": 11, "d": 22, "weekday": 6, "weekCN": "星期六" },
  "lunar": { "year": 2026, "month": 10, "day": 14, "isLeap": false, "monthCN": "十月", "dayCN": "十四", "fullCN": "二〇二六年十月十四" },
  "ganzhi": { "year": "丙午", "yearBySpring": "丙午", "month": "己亥", "day": "庚子" },
  "zodiac": "马",
  "solarTerm": "小雪",
  "nextSolarTerm": { "name": "大雪", "date": "2026-12-07" },
  "huangdao": "白虎",
  "dayGod": "白虎",
  "dayGodType": "黑道",
  "zhixing": "除",
  "yi": ["祭祀", "出行"],
  "ji": ["动土", "开仓"],
  "chong": "马",
  "sha": "南",
  "jishen": ["…"],
  "xiongsha": ["…"],
  "pengzu": { "gan": "…", "zhi": "…" },
  "xiu": "…",
  "yueXiang": "…",
  "nineStar": "…",
  "festivals": [],
  "note": "仅供娱乐"
}
```

### 7.3 `POST /api/fortune/draw` — 抽签（64 卦）

请求 `{}`。

```json
{
  "ok": true,
  "at": "2026-11-22T15:30:00+08:00",
  "method": "三枚铜钱摇卦",
  "number": 1,
  "name": "乾",
  "fullName": "乾为天",
  "symbol": "䷀",
  "upper": "乾", "lower": "乾",
  "lines": [7, 7, 7, 7, 7, 7],
  "movingLines": [],
  "changed": null,
  "guaCi": "元亨利贞。",
  "xiang": { "da": "天行健，君子以自强不息。", "xiao": "…" },
  "yaoCi": ["…"],
  "judgement": { "level": "大吉", "score": 92 },
  "plain": "…", "career": "…", "wealth": "…", "love": "…", "advice": "…",
  "note": "仅供娱乐"
}
```

### 7.4 `POST /api/fortune/bazi` — 八字

请求：

```json
{ "birth": "1990-01-01 08:00", "gender": "male" }
```

```json
{
  "ok": true,
  "birth": "1990-01-01 08:00",
  "gender": "male",
  "lunar": "…",
  "pillars": [ { "label": "年柱", "ganzhi": "己巳", "gan": "己", "ganWuxing": "土", "zhi": "巳", "zhiWuxing": "火", "naYin": "大林木" } ],
  "fourPillars": ["己巳", "丙子", "丙寅", "壬辰"],
  "wuxing": { "jin": 0, "mu": 1, "shui": 1, "huo": 3, "tu": 3 },
  "wuxingText": "…",
  "missing": ["金"],
  "nayin": ["…"],
  "dayMaster": "丙火",
  "dayMasterDetail": "…",
  "zodiac": "蛇",
  "timeNote": "按北京时间计算，未做真太阳时校正",
  "note": "仅供娱乐"
}
```

### 7.5 `POST /api/fortune/name` — 姓名分析

请求：

```json
{ "surname": "王", "given": "小明" }
```

```json
{
  "ok": true,
  "surname": "王", "given": "小明", "fullName": "王小明",
  "chars": [ { "char": "王", "stroke": 4, "wuxing": "土", "position": "姓" } ],
  "strokes": [4, 3, 8],
  "totalStrokes": 15,
  "wuge": { "tian": 5, "ren": 7, "di": 11, "wai": 9, "zong": 15 },
  "wugeWuxing": { "tian": "土", "ren": "金", "di": "木", "wai": "水", "zong": "土" },
  "sancai": { "config": "土金木", "luck": "吉", "desc": "…" },
  "score": 84,
  "grade": "B+",
  "gradeText": "…",
  "summary": "…",
  "missing": [],
  "incomplete": false,
  "note": "仅供娱乐"
}
```

---

## 8. 个人资料与背景（Profile & Background）

### 8.1 `GET /api/profile` — 读取脱敏资料

```json
{
  "ok": true,
  "profile": {
    "name": "<姓名>",
    "birth": "1990-01-01",
    "idMasked": "1101**********1234",
    "gender": "male",
    "star": { "starId": "SANWA-A1B2C3", "starName": "<姓名>", "constellation": "…", "spectralColor": "…" },
    "updatedAt": "2026-11-22T07:00:00.000Z"
  }
}
```

未录入时 `profile:null`。

### 8.2 `POST /api/profile` — 保存脱敏资料

请求：

```json
{
  "name": "<姓名>",
  "birth": "1990-01-01",
  "idMasked": "1101**********1234",
  "gender": "male",
  "star": { "starId": "SANWA-A1B2C3", "starName": "<姓名>", "constellation": "…", "spectralColor": "…" }
}
```

- `name` 1–40 字符；`birth` 必须 `YYYY-MM-DD`；`idMasked` 必须是脱敏格式（如 `1101**********1234` / `1101**********123X`）；完整身份证不会被接收/保存；
- 响应 `{ "ok": true, "profile": { …同 GET… } }`；
- 该接口不写日志。

### 8.3 `GET /api/background/state` — 背景状态

```json
{ "ok": true, "enabled": true, "url": "/api/background/file/<hash>.jpg", "servedUrl": "/api/background/file/<hash>.jpg", "strength": 45, "uploadedAt": "…", "kind": "file" }
```

无背景：`{ "ok": true, "enabled": false, "url": "", "strength": 45, "uploadedAt": "" }`。

### 8.4 `POST /api/background` — 设置背景

三种请求形式：

```json
{ "dataUrl": "data:image/png;base64,<...>", "strength": 45 }
{ "url": "https://example.com/bg.jpg", "strength": 60 }
{ "strength": 30 }
```

- `dataUrl` 仅支持 PNG / JPG / WebP，≤ 8 MB，服务端校验 magic bytes；
- `url` 仅支持 `http(s)` 或 `data:image/`；
- 只传 `strength` 时仅调整遮罩浓度（0–100）；
- 成功返回同 `GET /api/background/state`。

### 8.5 `POST /api/background/clear` — 清除背景

```json
{ "ok": true, "enabled": false, "url": "", "strength": 45 }
```

### 8.6 `GET /api/background/file/<name>` — 读取背景图

- `name` 必须匹配 `^[a-f0-9]{16,64}\.(png|jpg|jpeg|webp)$`，否则 404；
- 响应为图片二进制，`Cache-Control: public, max-age=86400`。

---

## 9. 静态页面

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/`、`/index.html` | 单文件 HUD 界面（`text/html`） |
| GET | `/favicon.ico` | 204 空响应 |

界面文件来源优先级：`data/tools.json → hub.desktopHtml` → `hub.webIndex` → `web/index.html`；都不存在时返回内置提示页。

---

## 10. 安全说明（重要）

1. **无鉴权、CORS 开放**：为了让 `file://` 打开的桌面 HTML 也能调用，接口没有 Token 校验且 `Access-Control-Allow-Origin: *`。这意味着**本机上任何网页**理论上都能调用这些接口。请：
   - 不要用浏览器同时打开不可信的网页并长时间保留控制中心运行；
   - 不要将服务暴露到局域网/公网；
   - 若你需要更强隔离，可修改 `server.js` 的 CORS 与增加 Token 校验（欢迎 PR）。
2. **只监听 127.0.0.1**：`HOST` 常量固定为回环地址，不提供修改为 `0.0.0.0` 的配置。
3. **启动白名单**：`/api/launch` 只接受 `data/tools.json` 的 `id`，只执行 `scripts/<id>.ps1` 预置脚本，不接受任意命令/路径。
4. **停止归属校验**：`/api/stop` 只停止本服务启动的进程（PID 文件 + 启动时间 + 可执行路径）。
5. **敏感数据不上传**：`POST /api/profile` 只接收脱敏字段；`data/profile.json` 只在本机。
6. **请求体上限**：普通接口 64 KB，背景图 12 MB；超限返回 413。

---

## 11. 可能的扩展接口（贡献方向）

当前没有实现、但社区常提出的接口（欢迎贡献，需同步更新本文件）：

- `GET /api/diagnostics` — 一键诊断报告（Node/端口/脚本/安全软件）；
- `GET /api/tools/export` — 导出工具卡片片段；
- `POST /api/games/profile` — 游戏启动档案；
- `POST /api/system/tray` — 托盘/小组件状态。

> 新增接口请遵守：JSON 契约、错误码一致、仅本机、不执行任意命令，并在 `CHANGELOG.md` 记录。
