# 脱敏与发布验证报告（SANITIZATION REPORT）

- 项目：Sanwa系统管理器（Sanwa System Manager）
- 版本：v1.5.0
- 发行形态：GitHub 公开源码发行版（Windows 10/11 + Node.js 22+，无 npm 依赖）
- 构建来源：维护者本机在线版本 `<线上应用根目录>`（**只读取**，未修改线上文件）
- 发行目录：`sanwa-system-manager/`（应用代码在仓库根）
- 生成日期：2026-11-22
- 维护者：驼学长（版权保留）

---

## 1. 复制范围

从在线版本复制并脱敏的文件：

| 路径 | 内容 | 处理 |
| --- | --- | --- |
| `server.js` | 本地 HTTP 服务（127.0.0.1） | 路径/端口环境变量化、去除个人路径文案 |
| `lib/modes.js` | 五模式引擎 | 去除 OEM 用户目录兜底、旧快捷方式名 |
| `lib/games/**` | 游戏扫描/启动编排（Steam/WeGame/Epic/独立） | 改为读 `data/games-config.json`，去除硬编码盘符与个人目录 |
| `lib/fortune/**` | 天气/黄历/抽签/八字/姓名（含 vendor 与 THIRD_PARTY_NOTICES） | 去除示例城市，路径相对化 |
| `scripts/**` | 51 个 ps1/vbs + `build-ui.js` + `game-mode-native.js` | 路径相对化、根目录/环境变量化、启动名统一 |
| `web/**` | 单文件 UI 模板与构建产物 | 个人数据/内部项目名清除，用脱敏后的示例配置重建 `index.html` |
| `tools/**` | Steam 断网辅助脚本与说明 | 路径占位符化 |
| `install-autostart.ps1` | 登录自启快捷方式 | 由 `install.ps1 -Autostart` 调用 |

新增（发行版自有）：

- `install.ps1`、`uninstall.ps1`、`start-sanwa.cmd`
- `package.json`、`.env.example`、`.gitignore`
- `data/tools.example.json`、`data/games-config.example.json`、`data/fortune.preferences.example.json`
- `lib/fortune/data/strokes.json`（姓名笔画静态数据，158,594 B，基于 cnchar/cnchar-info MIT 数据提炼；随模块交付，不含个人信息）
- `check-privacy.ps1`（发布前扫描，PS5.1 可运行、含 BOM）
- 本报告

## 2. 明确排除的内容

以下内容**未复制**（不进入公开仓库）：

- `logs/`、`tmp/`、`backup/`
- 旧版 `README.md`、升级报告、整理/迁移报告
- `data/` 个人运行数据：`profile.json`、`hub.pid`、`games.json`、`mode-state.json`、`mode-preferences.json`、`game-mode-state.json`、`pids/`、`backgrounds/`、`fortune/weather-cache.json`、`preferences.json`（姓名笔画静态数据改放 `lib/fortune/data/strokes.json` 随仓库交付，不属于运行时个人数据）
- 任何截图、日志、`.log`、`.pid`
- 游戏库扫描结果、个人游戏库存清单、个人收藏/使用记录
- 本机已安装工具的"真实路径清单"（示例配置中全部为占位符）
- 前端内嵌的迁移总览（含内部项目名/迁移日期）——已从嵌入数据中移除
- 维护者机器上的 Edge 测试 profile、测试脚本输出

## 3. 脱敏替换映射

### 3.1 个人/本机路径

| 原内容（类别） | 发行版写法 |
| --- | --- |
| 维护者 Windows 用户目录 | 脚本 `%USERPROFILE%` / `$env:USERPROFILE`；Node `process.env.USERPROFILE` |
| `<线上应用根目录>`（线上应用根） | 应用根目录：Node `__dirname`/`SANWA_HOME`；PS `$PSScriptRoot`/`$env:SANWA_HOME`；配置 `%SANWA_HOME%` |
| <线上 AI 根目录>（AI 工具根） | `%SANWA_AI_ROOT%`（默认 `%USERPROFILE%\AI`） |
| `<线上模型根目录>`（模型根） | `%SANWA_MODELS_ROOT%`（默认 `%SANWA_AI_ROOT%\models`） |
| LM Studio 个人安装路径 | `%LMSTUDIO_HOME%`（默认 `%PROGRAMFILES%\LM Studio`） |
| LibreOffice 个人安装路径 | `%PROGRAMFILES%\LibreOffice` |
| 个人 DSH 目录/可执行文件 | `%DSH_HOME%` / `%DSH_EXE%` |
| 个人便携盘/知识库/模型/摄像头等位置 | `%PORTABLE_DRIVE%` / `%KIWIX_HOME%` / `%COMFYUI_HOME%` / `%PYTHON314_HOME%` 等占位符 |
| 具体项目目录名（内部 workspace 项目） | 通用占位：`%COMFYUI_HOME%`、`%SANWA_AI_ROOT%\projects\comfyui-env` |
| 旧启动脚本名 `启动Sanwa系统管理器.cmd` | `start-sanwa.cmd` |

### 3.2 游戏库硬编码

| 原内容 | 发行版 |
| --- | --- |
| 个人 Steam 库盘符（如外置盘） | `data/games-config.json → steamLibraries`（示例留空；默认仅探测标准 Steam 安装目录） |
| 个人 WeGame 目录 | `data/games-config.json → weGameDirs`（示例留空） |
| 个人独立游戏盘符/根目录 | `data/games-config.json → roots`（示例留空；无配置不扫描个人盘） |
| 注册表提示 | `registryHints` 可关闭，默认仅读取系统注册表提示 |

### 3.3 个人信息/品牌/命名

| 处理 |
| --- |
| 维护者 Windows 用户名不再出现在任何源码、配置、脚本、模板、构建产物中 |
| 测试身份证号、测试姓名、真实城市（中/英）、真实主机名、SID：**从未复制/已删除** |
| OEM 品牌 AI 卡：`vendor-ai-advisor` / "OEM AI Advisor"（通用示例卡，可删除或替换） |
| 城市：天气缓存与示例默认值已移除；通用城市码表保留通用城市名，但不作为默认值 |
| 版权署名保留：`驼学长`（LICENSE、package.json、页脚） |
| 旧品牌/旧快捷方式：启动名统一为 `Sanwa系统管理器`；旧名仅保留一次性迁移代码（服务启动时清理旧快捷方式） |

### 3.4 运行时平台化

| 项 | 发行版行为 |
| --- | --- |
| 服务根目录 | `process.env.SANWA_HOME || __dirname` |
| 端口 | `process.env.SANWA_PORT || 9900` |
| 数据目录 | `process.env.SANWA_DATA_DIR || <root>/data` |
| 日志目录 | `process.env.SANWA_LOG_DIR || <root>/logs` |
| 桌面 HTML | 由 `install.ps1` 写入 `data/tools.json`（默认取系统"桌面"已知文件夹，兼容 OneDrive 重定向）；服务回退 `SANWA_DESKTOP` 或 `os.homedir()/Desktop` |
| 工具配置 | 仍读取 `data/tools.json`；缺失时回退 `data/tools.example.json`（首启可显示示例 UI） |
| 安装器生成配置 | 从 `data/tools.example.json` 展开 `%VAR%` 占位符生成 `data/tools.json`，并修正 `hub.root/desktopHtml/startCmd/webIndex/logsDir/scriptsDir/pidFile` |

## 4. 验证证据

### 4.1 临时目录安装 + 启动测试

在 `%TEMP%\sanwa-release-test` 复制发行目录（不含 `.git`）后执行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
```

结果：

- Node.js 检查：v24.16.0（>=22）通过
- 从 `data/tools.example.json` 生成 `data/tools.json` 成功
- 工具数量：**41 个**，分类：**10 个**
- 配置中 `%SANWA_HOME%` 已正确展开为**应用目录**（抽查 `gameMode.stateFile`、`gameMode.scripts`、Breeze 工具路径、hub 字段均正确）
- 桌面 HTML 复制成功（测试使用 `SANWA_DESKTOP` 指向临时文件，不污染真实桌面）
- `install.ps1` 退出码 0

以 `SANWA_PORT=9911` 启动：

```powershell
$env:SANWA_PORT='9911'; node server.js
```

结果：

- `GET /api/meta` → HTTP 200：`hub.name=Sanwa系统管理器`，`version=1.5.0`，`port=9911`
- `GET /api/tools` → HTTP 200：41 个工具、10 个分类
- `GET /` → HTTP 200（单文件管理界面可访问）
- `POST /api/fortune/name`（UTF-8 JSON：surname=王、given=小明）→ 200：`strokes=[4,3,8]`，五格 5/7/11/9/15，`incomplete=false`，`missing=[]`（姓名笔画静态数据已随仓库交付）
- `install.ps1` 生成的 `data/tools.json` 抽查：`hub.root`、`gameMode.stateFile`、`gameMode.scripts.enter`、Breeze 工具 exe/cwd 均为应用目录下的正确路径（`$AppHome` 修复已验证）
- 测试后已停止 9911 服务，端口释放

### 4.2 敏感信息扫描

仓库内自带发布检查脚本（UTF-8 with BOM，兼容 Windows PowerShell 5.1）：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\check-privacy.ps1
```

结果：

```text
PASS - 0 hits. Safe to publish.
```

该脚本：

- 扫描全仓库源码/配置/文档/脚本（排除 `.git`、vendor 第三方库、资产 SVG、脚本自身）
- 覆盖：维护者用户名路径、用户目录通配（允许 `%USERPROFILE%` 等占位符）、主机名/SID、测试身份证号/姓名、真实城市（中英）、线上应用根/AI 根、游戏库盘符、WeGame/独立游戏目录、真实邮箱
- 对**双反斜杠转义形式**（JSON/JS 中常见）先归一化再匹配，避免漏报
- 用户名匹配区分大小写，避免误报天文星座英文名中的字母片段

另使用独立外部扫描复核（与 `check-privacy.ps1` 相同的关键模式 + 双反斜杠归一化），结果：**0 命中**（105 个可扫描文件，不含 `.git`）。

### 4.3 构建产物与脚本健康检查

- `node --check` 全部 15 个 JS 文件：0 语法错误
- Windows PowerShell 5.1 解析全部 53 个 ps1：0 解析错误（全部为 UTF-8 with BOM）
- `node scripts/build-ui.js` 使用脱敏后的 `data/tools.example.json` 重建 `web/index.html` 成功
- 嵌入数据检查：无个人路径、无测试身份/姓名、无内部迁移总览/项目名、无游戏库存
- 文件规模：约 115 个文件（含三语文档），约 2.4 MB（不含 `.git`；不含 node_modules）

## 5. 已知限制（需使用者注意）

1. **示例路径需编辑**：`data/tools.example.json` 中 exe/cwd/目录为 `%VAR%` 占位符（install.ps1 按默认值展开），首次使用需按本机实际安装路径修改 `data/tools.json`；未安装的工具会显示"不可用/未找到"。
2. **游戏库**：默认不扫描个人盘；需要 Steam/WeGame/独立游戏目录时，复制 `data/games-config.example.json` 为 `data/games-config.json` 并填写 `steamLibraries/roots/weGameDirs`。示例配置不包含任何个人游戏库存。
3. **管理员辅助**：Steam 断网防火墙、抖音聊天守护等辅助脚本需要管理员权限手动运行；页面不会自动提权。
4. **天气**：是唯一主动外联功能（wttr.in），城市可在设置中选择或由 `data/fortune/preferences.json` 配置；不发送身份证/姓名等个人信息。
5. **隐私边界**：生日门禁数据只保存在本机（浏览器 localStorage + `data/profile.json` 的脱敏字段），身份证号只显示掩码；服务仅绑定 127.0.0.1，无遥测。
6. **平台**：当前实现面向 Windows 10/11；依赖 PowerShell 5.1、任务计划/防火墙等 Windows 能力。Node.js 最低 22。
7. **API 编码**：`/api/fortune/name` 等 JSON 接口按 UTF-8 解析；Windows PowerShell 5.1 的 `Invoke-RestMethod` 在非 UTF-8 控制台可能把中文请求体按 ANSI 发送，建议用 Node/curl 或显式 UTF-8 请求体测试。
8. **文档**：README 三语与 `docs/` 由文档维护部分提供；本报告只覆盖代码/配置/脚本的脱敏与启动验证。
9. `web/ui.template.html` 中保留对可选迁移总览数据的兼容代码，但发行版构建产物与示例数据中已不含任何迁移/个人数据。

---

## 6. 游戏库隐私清理（发布前复查追加，2026-11-22）

复查发现 `lib/games/index.js` 仍残留由维护者本机游戏库推导出的数据，已在该文件中全部清除（未改其它代码/配置/文档）：

| 原内容 | 处理 |
| --- | --- |
| `KNOWN_MAIN_EXE`（约 25 个本机游戏 exe 名强加分） | **删除**，改为空数组；识别仅依赖同名 exe、`binaries/win64`、根目录最大 exe 等通用评分 |
| `SINGLE_NAME_RE`（含多款具体游戏中英文名） | 替换为通用类型关键词：`simulator|tycoon|city builder|sandbox|single player|offline|transport|train|truck|farming|builder|strategy` 等 |
| `REGISTRY_GAME_RE`（含具体游戏名） | 仅保留通用识别词：游戏/单机/3dm/硬盘版/免安装/学习版/破解/repack/portable/GOG/Steam |
| `NAME_ZH_STEAM`（19 个本机 appid→中文名）与 `NAME_ZH_BY_DIR`（13 个本机目录→中文名） | **整段删除**，改为空对象（附注释：用户可自行维护）；未命中时 Steam 回退 appmanifest 的 `name`，独立/WeGame 回退目录名 |
| `EXCLUDE_DIR_TOKENS`（含个人化目录名与设备/备份/书籍相关词） | 替换为通用类别词（movie/video/music/photo/wallpaper/downloads/backup/documents/资料/文档/视频/音乐/照片/壁纸/备份 等） |
| 主程序评分正则中的本机游戏 exe/目录片段 | 移除，仅保留 `bin|binaries|win64|win32|x64|x86|game` |
| 注释中的个人路径/示例 appid（含具体游戏 id） | 改为 `<WeGameRoot>` 与 `steam-123456` / `wg-123` 通用占位 |
| `data/games.json`（本机游戏库存缓存） | 确认**未进入仓库**（`.gitignore` 已排除） |
| `lib/games/selftest.js` | 仓库中不存在（构建时已排除），无需同步 |

### 验证

- `node --check lib/games/index.js` → 通过
- 模块加载：`require('./lib/games')` 正常，导出 `scanGames/loadGames/saveOverrides/launchGame/steamStatus/VERSION`
- 功能回归：在隔离临时目录构造一个"通用假游戏"（同名 exe 根目录），配置 `roots` 后调用 `scanGames`：
  - `ok=true`，扫描总数 21（标准 Steam 20 + 假独立游戏 1）
  - 假游戏被识别为 `platform=standalone`、`id=dir-*`、`nameZh` 回落目录名、`mode=single`（通用单机关键词命中）
- 全仓库扫描（Lead 提供 `scan-repo.js`）：`scanned files: 106, hits: 0 — PASS: 0 hits (sanitized OK)`
- 仓库自带 `check-privacy.ps1`：此前已验证 PASS；本次改动后外部扫描与 Lead 扫描均 0 命中
- vendor 第三方库中的上游邮箱/测试数字串为许可/库内容，保留不动（不属本机个人数据）
