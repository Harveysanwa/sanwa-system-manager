# 架构说明（Architecture）

> 面向想读懂、审计或二次开发本项目的人。本文描述 v1.5.0 的实际结构；具体接口字段见 [API.md](API.md)，模式规则见 [MODES.md](MODES.md)，游戏扫描见 [GAMES.md](GAMES.md)，玄学引擎见 [FORTUNE.md](FORTUNE.md)。

## 1. 设计目标

| 目标 | 做法 |
|---|---|
| 纯本地、可信 | 只监听 `127.0.0.1`；无账号、无遥测、无云依赖；后端只执行白名单脚本 |
| 零安装 | 后端只用 Node.js 标准库，不执行 `npm install`；前端单文件 HTML，无 CDN |
| 打开就能用 | 单页科幻 HUD；工具卡片一键启动 / 按需启动；模式一键切换 |
| 可扩展 | 工具、模式、主题、语言都通过配置或独立目录扩展，尽量不改核心调度代码 |
| 对 AI 友好 | 结构清晰、命名直白、注释完整，任何 AI 助手都能读懂并替你改 |

## 2. 组件图

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ 浏览器（本机）                                                                │
│  http://127.0.0.1:9900  ── 或直接双击桌面单文件 Sanwa系统管理器.html         │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │ 单文件界面（web/index.html ← 由 web/ui.template.html 构建）            │  │
│  │ HUD · 模式栏 · 工具卡片 · 游戏库 · 玄学天气 · 门禁/星空 · 设置          │  │
│  │ 主题(深/浅/绚丽) · 语言(中/英/日) · localStorage 持久化                │  │
│  └───────────────┬────────────────────────────────────────────────────────┘  │
└──────────────────┼───────────────────────────────────────────────────────────┘
                   │ HTTP/JSON（同源；file:// 时走 CORS）
┌──────────────────▼───────────────────────────────────────────────────────────┐
│ server.js（Node.js 标准库，单进程，127.0.0.1:9900）                          │
│  ┌─────────────┐ ┌──────────────┐ ┌────────────────┐ ┌────────────────────┐ │
│  │ 路由/静态页  │ │ 工具调度      │ │ 资源采集        │ │ 模式/游戏/玄学桥接  │ │
│  │ /api/*      │ │ 白名单启动    │ │ CPU/GPU/内存/   │ │ require(lib/**)    │ │
│  │ CORS/JSON   │ │ PID 归属校验  │ │ 网络/磁盘/进程  │ │ 惰性加载 + 缓存     │ │
│  └──────┬──────┘ └──────┬───────┘ └───────┬────────┘ └─────────┬──────────┘ │
│         │               │                 │                    │            │
│         │               │                 │                    │            │
│  ┌──────▼───────────────▼─────────────────▼────────────────────▼──────────┐ │
│  │ 依赖层：Windows 原生能力（只用 EXE/COM，不依赖 npm 包）                 │ │
│  │ tasklist / netstat / reg / nvidia-smi / cscript / taskkill / copy       │ │
│  │ powershell.exe（仅执行 scripts\*.ps1 预置脚本）                          │ │
│  └──────┬───────────────────────────────────────────────────────────────┬──┘ │
└─────────┼───────────────────────────────────────────────────────────────┼────┘
          │                                                               │
┌─────────▼───────────────────┐  ┌───────────────────────────┐  ┌─────────▼──────────────┐
│ lib/modes.js                │  │ lib/games/index.js        │  │ lib/fortune/index.js    │
│ 五模式引擎（Node 原生）      │  │ 游戏扫描 + 启动编排        │  │ 天气 / 黄历 / 抽签 /     │
│ 停止/启动/保护/状态落盘      │  │ Steam·WeGame·独立·Epic    │  │ 八字 / 姓名（离线计算）   │
└─────────┬───────────────────┘  └───────────┬───────────────┘  └─────────┬──────────────┘
          │                                  │                            │
┌─────────▼───────────┐  ┌───────────────────▼──────────┐  ┌──────────────▼──────────────┐
│ data/mode-state.json │  │ data/games.json              │  │ data/fortune/*（缓存/偏好）  │
│ data/mode-preferences│  │ data/games-config.json       │  │ lib/fortune/vendor（MIT 库） │
└─────────────────────┘  └──────────────────────────────┘  └──────────────────────────────┘
```

## 3. 请求与数据流

### 3.1 页面加载

1. 浏览器请求 `GET /`；
2. `server.js` 读取界面文件：优先 `data/tools.json → hub.desktopHtml`，其次 `hub.webIndex` / `web/index.html`；工具配置优先读 `data/tools.json`，缺失时回退 `data/tools.example.json`；
3. 页面加载后并行请求：
   - `GET /api/meta` —— 版本、磁盘、工具统计、日志/脚本目录；
   - `GET /api/tools` —— 工具清单（脱敏后，不含命令细节）；
   - `GET /api/status` —— 逐工具健康探测（HTTP / TCP / 进程）；
   - `GET /api/resources` —— 资源 HUD 数据（2 秒轮询，页面隐藏时暂停）；
   - `GET /api/modes/status`、`GET /api/game-mode/status`、`GET /api/games`、`GET /api/weather`、`GET /api/almanac` 等面板数据。
4. 前端把所有静态文案、模式名、工具简介按当前语言从内置 i18n 字典渲染；主题/语言/自定义背景状态来自服务端偏好 + `localStorage`。

### 3.2 启动一个工具（核心安全路径）

```
点击卡片
  │ POST /api/launch {"id":"ollama"}
  ▼
server.js
  ├─ 1. 从 data/tools.json 按 id 查找（不在白名单 → 404，忽略请求体中的一切路径/命令）
  ├─ 2. 游戏模式若激活且该工具 gameMode=stop → 409 拒绝
  ├─ 3. 健康探测：已在运行 → 只打开界面（open），不重复启动
  ├─ 4. 就绪检查：exe/目录/脚本是否存在（不存在 → 400 + 中文原因）
  ├─ 5. 按 launch.kind 执行：
  │      url  → 打开链接/目录（open-only 脚本）
  │      self → 打开控制中心界面
  │      其它 → 只执行 scripts\<id>.ps1 -Action start（spawn 隐藏窗口）
  └─ 6. 返回 {action:"launching", waitSeconds}；前端轮询 /api/status 直到 running
```

「停止」对应 `POST /api/stop`：先校验 PID 文件归属（PID + 启动时间 + 可执行路径），再执行 `scripts\<id>.ps1 -Action stop`；不是本服务启动的进程一律拒绝停止（403 `NOT_OWNED`）。

### 3.3 健康探测

| `health.type` | 探测方式 | 适用 |
|---|---|---|
| `http` | 请求约定 URL（超时 1.5s 默认） | 有 Web 界面的服务（Ollama、Open WebUI、ComfyUI 等） |
| `tcp` | TCP 连接端口 | 只监听端口的服务 |
| `process` | `tasklist` 进程名匹配 | 桌面应用 |
| `none` | 不探测；以本服务记录的进程是否存活为准 | CLI / 终端类 |

结果缓存 1 秒，避免轮询打爆 `tasklist`。进程列表按整表缓存 6 秒。

## 4. 模式引擎（lib/modes.js）

- **输入**：`data/tools.json` 的 `modes.definitions`（每个模式定义 `start[]` / `stop[]` / 名称 / 颜色 / 图标 / 说明），以及 `gameMode: stop|keep` 标记的 AI 工具集合。
- **执行**：切换模式时依次「停止 stop 列表 → 等待端口释放 → 启动 start 列表 → 等待健康检查」，然后写 `data/mode-state.json`；AI 模式额外把用户选择写入 `data/mode-preferences.json`（下次默认勾选）。
- **保护**：`modes.protected` + 内置名单（控制中心自身、DeepSeek Harness、系统进程、Steam、雷神）永不停止；杀进程按「进程名 + 可执行文件路径」双条件匹配，绝不 `taskkill /IM` 全域结束。
- **原生优先**：模式切换完全由 Node 实现，不经过 PowerShell，避免安全软件（火绒 / HIPS）拦截 AMSI 导致的崩溃；旧版「游戏模式」的 PowerShell 脚本仅作兼容路径保留，失败时也会回退到 Node 原生实现。
- **幂等**：切换到当前模式默认不做任何事；AI 模式例外——允许只更新「所选 AI」，只启动新增项。

详见 [MODES.md](MODES.md)。

## 5. 游戏库（lib/games/index.js）

```
scanGames() 只读扫描
  ├─ Steam：注册表/默认安装目录 → libraryfolders.vdf → 各库 appmanifest_*.acf（appid/名称/安装目录/大小）
  ├─ WeGame：常见安装目录 + 注册表
  ├─ Epic：Manifests 目录（只识别，不做启动编排）
  ├─ 独立/破解：data/games-config.json 的 roots（可配置）+ 目录启发式识别主 exe
  └─ 注册表卸载项兜底 → 去重排序 → 分类（region/mode/tags）→ 写 data/games.json
launchGame(id, opts)
  ├─ 境外联机 → 先拉起雷神加速器（已运行则跳过）
  ├─ 单机/破解 → 先关闭 Steam（精确进程名）→ 请求防火墙断网辅助
  ├─ 启动：Steam 用 steam://rungameid/<appid>，WeGame 用协议/客户端，独立用主 exe
  └─ 返回 actions[] 与 steamNetBlock（无管理员权限时如实 applied:false，不伪造成功）
```

分类字段（可在 UI 或用 `POST /api/games/overrides` 覆盖）：`platform`（steam / wegame / standalone / epic / unknown）、`region`（domestic / overseas / unknown）、`mode`（online / single / cracked / unknown）、`tags[]`（`accelerator-needed`、`steam-offline`、平台标签等）。

详见 [GAMES.md](GAMES.md)。

## 6. 玄学 / 天气（lib/fortune/）

- `index.js` 统一导出 5 个 async 函数：`getWeather` / `getAlmanac` / `drawLot` / `getBazi` / `analyzeName`；所有函数 try/catch 包裹，**永不抛异常**，失败返回 `{ok:false,error}`。
- 计算全部在本地：农历/节气/黄历/八字基于 vendored 的 `lunar-javascript`；汉字笔画基于构建期提炼的 `strokes.json` + vendored `cnchar`；64 卦数据随仓库分发。
- 天气是**唯一**外联：`wttr.in`（实时 + 3 日 + 自动定位）→ `api.open-meteo.com`（7 日）→ 中国天气网（兜底）；10 分钟缓存，失败时退回同城市旧缓存并标记 `stale`。
- `server.js` 对天气/黄历做二级缓存（天气 10 分钟、黄历按日期 6 小时），减少外联。

详见 [FORTUNE.md](FORTUNE.md)。

## 7. 前端：单文件、主题与 i18n

- **单文件**：`web/ui.template.html` 是源模板，`scripts/build-ui.js` 负责把当前界面资源整理为 `web/index.html`（单文件、无外部依赖）；服务启动时会把 `hub.desktopHtml`（桌面单文件）与 `web/index.html` 同步。
- **主题**：主题变量集中在 CSS 自定义属性，根节点切换 `data-theme`；三套主题（深色/浅色/动态绚丽）。动态主题使用 CSS 动画（极光/星云），并尊重 `prefers-reduced-motion`。
- **i18n**：内置三语字典（zh / en / ja），`<html lang>` 与 `localStorage` 持久化；工具卡片在 `data/tools.json` 中保留 `name`（英文）+ `nameZh`（中文）+ `i18n.en/ja` 简介。
- **门禁与星空**：身份证校验、生日解析、脱敏全部在浏览器完成；服务端只存脱敏字段。星空命名动画使用 Canvas/WebGL 风格 2D 绘制，`prefers-reduced-motion` 降级静态银河。
- **离线降级**：`/api/resources` 不可用时 HUD 显示占位；天气失败显示缓存/提示；游戏库未扫描时显示引导。

详见 [THEMES-I18N.md](THEMES-I18N.md)。

## 8. 隐私架构

1. **网络面**：只监听回环地址；无出站上报；唯一外联是天气；前端没有第三方脚本。
2. **数据面**：所有运行数据在仓库 `data/`、`logs/` 内（可用环境变量改目录），`.gitignore` 已排除；仓库发布的只有 `*.example` 占位配置。
3. **身份面**：姓名/生日/脱敏身份证只保存在本机 `data/profile.json`，用户可随时删除；完整身份证不落盘、不进日志。
4. **执行面**：只执行白名单脚本；停止只针对本服务拉起的进程；不可通过 API 传任意命令。
5. **提权面**：需要管理员权限的辅助脚本（Steam 断网）只提示或生成，不静默执行；服务本身不提权。

详见 [PRIVACY.md](PRIVACY.md)。

## 9. 无依赖设计

| 层 | 依赖 |
|---|---|
| 后端 | Node.js ≥ 22 标准库（`http` / `https` / `fs` / `path` / `os` / `net` / `crypto` / `child_process`） |
| 前端 | 原生 HTML / CSS / JS，单文件，无框架、无 CDN、无外部字体 |
| Windows 能力 | 系统自带 EXE / COM：`tasklist`、`netstat`、`reg`、`nvidia-smi`、`cscript`、`taskkill`、`powershell.exe`（仅跑预置脚本） |
| 第三方库 | 仅 vendored 到 `lib/fortune/vendor/` 的 MIT 库（lunar-javascript / cnchar / cnchar-info），运行时零安装；许可见 `THIRD_PARTY_NOTICES.md` |

设计取舍：用系统 EXE 而不是 npm 原生模块，避免编译工具链、避免 `node_modules` 体积与供应链风险；代价是只支持 Windows，且部分能力依赖系统命令的文本输出（已做容错与降级）。

## 10. 失败与降级策略

| 场景 | 行为 |
|---|---|
| 安全软件拦截 PowerShell（AMSI/火绒） | 模式切换自动重试 → Node 原生兜底；工具启动失败给出中文原因与信任区建议 |
| 端口被占用 | 健康检查显示运行状态；服务启动前检查端口并提示 |
| `nvidia-smi` 不存在 / 无独显 | GPU 仪表显示不可用，其余 HUD 正常 |
| 天气接口失败 | 旧缓存 `stale` → 7 日兜底 → 提示不可用，不影响其它功能 |
| 游戏库未扫描 | `GET /api/games` 返回空列表 + 引导，页面不报错 |
| 配置文件损坏 | 服务返回统一 JSON 错误并在日志说明；不会执行未知名脚本 |
| 桌面 HTML 不存在 | 回退到 `web/index.html`；两者都不存在时返回内置提示页 |

## 11. 扩展点

| 想扩展 | 改哪里 | 参考 |
|---|---|---|
| 新增工具卡片 | `data/tools.json` + `scripts/<id>.ps1` | [CONTRIBUTING.md](CONTRIBUTING.md) |
| 新增 / 修改模式 | `data/tools.json → modes.definitions` | [MODES.md](MODES.md) |
| 新增主题 | `web/ui.template.html` 的 CSS 变量与主题块 | [THEMES-I18N.md](THEMES-I18N.md) |
| 新增语言 | 前端 i18n 字典 + `data/tools.json` 的 `i18n` 字段 | [THEMES-I18N.md](THEMES-I18N.md) |
| 新增游戏平台 | `lib/games/index.js` 增加扫描器 + `data/games-config.json` | [GAMES.md](GAMES.md) |
| 新增玄学项 | `lib/fortune/src/` + `index.js` 导出 + 服务端桥接 | [FORTUNE.md](FORTUNE.md) |
| 新增 API | `server.js` 路由 + 本目录 `API.md` | [API.md](API.md) |

## 12. 已知边界

- **仅 Windows 10/11**：大量依赖 Windows 原生 EXE/注册表/URI 协议。
- **单用户本机**：没有鉴权层，安全前提是「只监听 127.0.0.1 且本机可信」。
- **PowerShell 依赖的旧脚本**：部分工具的启动脚本仍是 PowerShell；若被安全软件拦截，需加信任区或改用 Node 原生路径。
- **游戏启动编排是「尽力而为」**：加速器路径、平台协议、管理员断网都可能因环境不同失效，失败会如实返回原因，不会假装成功。
- **玄学内容仅供娱乐**：黄历流派、八字真太阳时、姓名康熙笔画等均未做专业级处理。
