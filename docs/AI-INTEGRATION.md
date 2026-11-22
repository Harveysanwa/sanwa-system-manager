# AI 引导与提示词（AI Integration Guide）

> **本项目精心设计为可被 DeepSeek / 通义千问 / 豆包 / Codex / Claude / Hermes / Hermes One 等任意 AI 丝滑理解与对接。**
> 仓库结构直白、命名一致、注释完整、无 npm 依赖、API 全部本地、文档齐全；你只需要把下面任意一段提示词复制给 AI，并把占位符换成你自己的信息，它就能读懂仓库、帮你部署、改配置、加功能、排错。

---

## 目录

- [0. 使用方式与变量说明](#0-使用方式与变量说明)
- [1. 通用部署提示词（任意 AI 可用）](#1-通用部署提示词任意-ai-可用)
- [2. 各 AI 专用提示词](#2-各-ai-专用提示词)
  - [2.1 DeepSeek](#21-deepseek)
  - [2.2 通义千问（Qwen）](#22-通义千问qwen)
  - [2.3 豆包（Doubao）](#23-豆包doubao)
  - [2.4 Codex](#24-codex)
  - [2.5 Claude](#25-claude)
  - [2.6 Hermes](#26-hermes)
  - [2.7 Hermes One](#27-hermes-one)
- [3. 三个进阶模板](#3-三个进阶模板)
  - [3.1 让 AI 审计并改进项目](#31-让-ai-审计并改进项目)
  - [3.2 让 AI 为我的设备生成配置](#32-让-ai-为我的设备生成配置)
  - [3.3 让 AI 帮我排查一个具体问题](#33-让-ai-帮我排查一个具体问题)
- [4. 为什么这个项目适合交给 AI](#4-为什么这个项目适合交给-ai)
- [5. English Guide](#5-english-guide)
- [6. 日本語ガイド](#6-日本語ガイド)
- [7. 安全边界（必须写进给 AI 的提示词）](#7-安全边界必须写进给-ai-的提示词)

---

## 0. 使用方式与变量说明

1. 复制下面对应 AI 的整段提示词；
2. 替换变量（见下表）；
3. 粘贴给 AI，**先让它做只读检查，再让它动手**；
4. 每一步要求 AI 给出「执行了什么命令 / 返回了什么 / 下一步需要你确认什么」；
5. 涉及删除、改注册表、防火墙、管理员权限的操作，**必须由你本人确认**。

| 变量 | 含义 | 示例写法 |
|---|---|---|
| `{REPO_URL}` | 本仓库的 Git 地址；本地目录可直接写路径 | `https://github.com/<你的账号>/sanwa-system-manager` 或 `D:\OpenSource\sanwa-system-manager` |
| `{SANWA_HOME}` | 你希望安装到的目录 | `%USERPROFILE%\sanwa-system-manager` |
| `{WINDOWS_USER}` | 你当前的 Windows 用户名（仅用于让 AI 理解路径，不要贴到公开 Issue） | `%USERPROFILE%` 或 `<你的用户名>` |
| `{AI_NAME}` | 你正在使用的 AI 名称 | `DeepSeek` / `通义千问` / `豆包` / `Codex` / `Claude` / `Hermes` / `Hermes One` |

> 提示：仓库地址未发布前，用本地路径代替 `{REPO_URL}`；如果 AI 不能访问网络，请把仓库打包或让它读本地目录。
> 提示：不要把自己完整的 `data/tools.json`、`data/profile.json`、日志原文直接粘贴给在线 AI；先用占位符或只贴相关片段。

---

## 1. 通用部署提示词（任意 AI 可用）

```text
你是我的 Windows 本地环境助手。我要部署并改造一个开源项目：Sanwa 系统管理器（Sanwa System Manager）。
它是什么：纯 Node.js（无 npm 依赖、无 CDN）的本地 Web 控制台，Windows 10/11，默认 http://127.0.0.1:9900，
单文件科幻 HUD 界面；用于统一管理本机 AI 工具 + 办公软件 + 游戏，支持五模式、按需启动、游戏库扫描、
资源 HUD、天气/黄历、三主题、中英日三语。只有天气会访问外网，其余全部本机运行。

仓库地址 / 本地路径：{REPO_URL}
安装目录：{SANWA_HOME}
Windows 用户名：{WINDOWS_USER}
我的环境：Windows 10/11，已安装 Node.js（版本待你检查，要求 22+）。

请按顺序执行，每一步先只读检查、再动手，并告诉我你做了什么、证据是什么：

【阶段 1：读懂仓库（只读）】
1. 列出仓库结构（根目录、docs/、lib/、scripts/、web/、data/）。
2. 阅读并总结：README.md、docs/QUICKSTART.md、docs/ARCHITECTURE.md、docs/API.md、docs/PRIVACY.md。
3. 打开 server.js，找出：监听地址/端口、数据目录、工具白名单启动逻辑、/api/* 路由；确认「只监听 127.0.0.1」。
4. 打开 data/tools.example.json，总结工具卡片字段（id/name/nameZh/category/launch/health/i18n）与 modes 定义。
5. 输出一份「仓库地图 + 关键文件清单」，等我确认后再进入下一步。

【阶段 2：部署】
1. 检查 Node：node -v（必须 >= 22）；检查磁盘空间与 {SANWA_HOME} 是否已存在。
2. 下载：git clone {REPO_URL} {SANWA_HOME}（若不可用，改用 GitHub ZIP 解压）。
3. 进入 {SANWA_HOME}，运行 install.ps1（说明它的参数与作用）；确认生成了 data/tools.json、data/games-config.json 等配置文件。
4. 运行 start-sanwa.cmd 或 node server.js，验证：
   Invoke-RestMethod http://127.0.0.1:9900/api/ping
   Invoke-RestMethod http://127.0.0.1:9900/api/meta
   输出给我看返回结果。
5. 浏览器打开 http://127.0.0.1:9900，告诉我首次打开会出现什么（姓名+身份证门禁，仅本机脱敏保存，可跳过/后填）。

【阶段 3：按我的设备改配置】
1. 先问我都装了哪些 AI / 办公 / 游戏工具、各自安装路径与启动方式（只写占位符，不要泄露我的隐私）。
2. 按 data/tools.json 的结构生成/修改工具卡片；没有官方中文名的工具按功能起中文名。
3. 需要启动脚本时，只写 scripts/<id>.ps1，内容只允许：启动/停止指定的本机程序、写日志、健康检查；不得执行未知命令。
4. 修改后运行 node scripts/build-ui.js 重建界面，然后刷新页面验证卡片与启动/停止。

【阶段 4：排错】
如果遇到问题，按顺序检查并给出命令：
1. 端口 9900 被占用：netstat -ano | findstr :9900；
2. Node 版本低于 22 / 未安装；
3. 非管理员权限导致部分工具无法启动/停止；
4. 火绒 / Windows Defender / HIPS 拦截 PowerShell（AMSI）：给出信任区设置建议，并说明本项目模式引擎有 Node 原生兜底；
5. 天气失败：检查能否访问 wttr.in / api.open-meteo.com，说明可离线使用其余功能；
6. 游戏库扫不到：检查 data/games-config.json 的 steamLibraries / weGameDirs / roots。

【安全边界（必须遵守）】
- 不上传、不写入任何个人数据到仓库或网络：姓名、身份证、真实路径、游戏库存、日志、截图。
- 不结束系统进程、DeepSeek Harness、控制中心自身、Steam、雷神加速器；不执行 taskkill /IM 全域杀进程。
- 不把服务改成 0.0.0.0，不加公网端口映射；不新增遥测/上报。
- 需要管理员的脚本（如 Steam 断网）只告诉我手动怎么运行，不要静默提权。
- 不确定是否安全的改动，先解释风险并等我确认。

开始执行：先做【阶段 1】，输出仓库地图与关键文件清单。
```

---

## 2. 各 AI 专用提示词

> 下面 7 段提示词都是**完整、可直接复制**的；如果你已经用上面的通用部署提示词部署完成，只想让 AI 做某件事，可只复制对应段落里的「本次任务」部分，并在开头说明「仓库已部署在 {SANWA_HOME}，请先读 README 与 docs/」。

### 2.1 DeepSeek

适合：读长代码、逐步推理、审阅配置、写清晰的 PowerShell 命令。

```text
你是 DeepSeek，担任我的 Windows 本地运维与代码助手。请帮我部署并维护 Sanwa 系统管理器（开源、MIT、纯 Node.js、无 npm 依赖、仅监听 127.0.0.1:9900）。
仓库：{REPO_URL}
安装目录：{SANWA_HOME}
Windows 用户名：{WINDOWS_USER}
环境：Windows 10/11 + Node.js 22+。

请先阅读这些文件并各自用 3 句话总结：README.md、docs/QUICKSTART.md、docs/ARCHITECTURE.md、docs/API.md、docs/PRIVACY.md、
server.js、lib/modes.js、lib/games/index.js、lib/fortune/index.js、data/tools.example.json。
然后按以下任务顺序工作，每一步先解释思路、再给命令或改动，最后告诉我验证方法：

任务 A｜部署
1) 检查 node -v、磁盘空间、{SANWA_HOME} 是否冲突；
2) git clone {REPO_URL} {SANWA_HOME}（或 ZIP 解压）；
3) 运行 install.ps1，列出它会生成/修改哪些文件；
4) 启动服务并验证 /api/ping、/api/meta、/api/tools、/api/status，把关键返回贴给我。

任务 B｜生成或修改 data/tools.json
1) 先问我本机装了哪些工具及路径（我用占位符回答）；
2) 按现有 schema 生成工具卡片：id（小写字母/数字/-）、name、nameZh、category、description、launch(kind/script/exe/url)、health(type/url/port/process)、i18n.en/ja、gameMode、tags；
3) 为每个新工具生成 scripts/<id>.ps1（只做启动/停止/日志/健康检查，PowerShell 5.1 兼容）；
4) 修改后 node scripts/build-ui.js，刷新页面验证卡片显示与启动/停止。

任务 C｜新增模式 / 主题 / 语言
- 新增模式：改 data/tools.json 的 modes.definitions（给出完整 JSON 片段与 start/stop 说明）。
- 新增主题：改 web/ui.template.html 的 CSS 变量与 html[data-theme] 块，加入 THEMES 白名单与设置按钮，node scripts/build-ui.js。
- 新增语言：在 web/ui.template.html 的 I18N 字典加语言键 + 设置按钮 + LANG_LOCALES，并给 data/tools.json 的 i18n 补简介。
每一步都说明需要同步修改的其它位置，避免只改一半。

任务 D｜接入 Steam / WeGame / 其它启动器
1) 说明 lib/games/index.js 的扫描入口（scanGames）与启动入口（launchGame）；
2) 用 data/games-config.json 配置 steamLibraries / weGameDirs / roots，不硬编码我的路径；
3) 若要支持新平台，给出「扫描器 + 分类 + 启动动作」三处代码的修改方案与风险；
4) 验证只跑扫描（不启动游戏），强调 data/games.json 含隐私路径，禁止提交。

任务 E｜排错
按以下清单逐项排查，给出具体命令与判断依据：
- 端口 9900 占用；- Node 版本；- 管理员权限；- 火绒/Defender 拦截 PowerShell（AMSI/信任区）；
- 天气接口失败（wttr.in / api.open-meteo.com）；- 游戏扫描不到；- 模式切换失败（看 logs/modes.log）。

安全边界（任何情况下不得违反）：
1) 不上传/不把个人数据写进仓库（姓名、身份证、真实路径、游戏库存、日志、截图）；
2) 不结束系统进程、DeepSeek Harness、控制中心、Steam、雷神；不 taskkill /IM 全域杀进程；
3) 不改监听地址为公网、不新增遥测；需要管理员的脚本只提示我手动运行；
4) 任何删除/覆盖操作前先备份并等我确认。

现在从「任务 A」开始，先做只读检查。
```

### 2.2 通义千问（Qwen）

适合：中文语境、办公场景配置、中文命名与中文文档、把需求翻译成配置。

```text
你是通义千问，担任我的中文 Windows 效率助手。请帮我部署并定制 Sanwa 系统管理器：一个纯 Node.js 的本机 AI + 游戏 + 办公控制中心（http://127.0.0.1:9900，无 npm 依赖、无 CDN、仅本机运行）。
仓库：{REPO_URL}
安装目录：{SANWA_HOME}
Windows 用户名：{WINDOWS_USER}

请先读 README.md、docs/QUICKSTART.md、docs/MODES.md、docs/GAMES.md、docs/THEMES-I18N.md，然后用中文向我汇报：
1) 这个项目能帮我解决什么；2) 最小部署步骤；3) 哪些功能需要我自己提供路径；4) 隐私边界是什么。

然后帮我完成（每步等我确认再继续）：
【1. 部署】检查 Node 22+ → git clone/ZIP 到 {SANWA_HOME} → install.ps1 → 启动并验证 /api/ping、/api/meta。
【2. 办公模式定制】根据我常用的办公软件（WPS/LibreOffice/微信/钉钉/百度网盘等），
  修改 data/tools.json 里 office 模式的 start/stop 清单；给出修改前后 JSON 对比，并说明每个工具 id 的含义。
【3. 工具卡片中文化】检查所有工具卡片是否有 nameZh；没有的按功能起简洁中文名（不要直译生造），
  并把 en/ja 简介补齐；改完 node scripts/build-ui.js，刷新页面检查中文标题与搜索。
【4. 文档与提示词】帮我把我的本机配置写成一个「配置说明.md」（只写占位符，不写真实用户名/路径/城市），
  方便以后换电脑恢复；并生成一段给下一个 AI 的交接提示词。
【5. 排错】如果启动失败，按文档检查：Node 版本、端口 9900、脚本执行策略、火绒拦截、数据文件权限。

安全要求：不把我的个人信息（姓名、身份证、路径、游戏库存、日志）写入仓库或发到网上；
不关闭系统进程 / DeepSeek Harness / Steam / 雷神；不擅自请求管理员权限；涉及删除先问我。

开始：先读文档，然后告诉我你读到了什么、部署计划是什么。

补充：除上面任务外，你还需要能按需帮我做——生成/修改 data/tools.json（工具卡片字段 id/name/nameZh/category/launch/health/i18n）；新增工具卡片、新增模式（modes.definitions）、新增主题（web/ui.template.html + node scripts/build-ui.js）、新增语言（I18N 字典 + data/tools.json 的 i18n 简介）；接入 Steam / WeGame / 其他启动器（lib/games/index.js 扫描+分类+启动，配置 data/games-config.json）；排错（端口 9900 占用、Node 版本、管理员权限、火绒/Defender 拦截 PowerShell、天气 wttr.in/Open-Meteo 失败）。所有改动先给方案与风险，等我确认；严守上面安全要求。
```

### 2.3 豆包（Doubao）

适合：一步一步带做、少术语、适合第一次接触命令行的用户。

```text
你是豆包，请一步一步带我（Windows 新手）把 Sanwa 系统管理器装好并用起来。请说人话、每步只做一件事、等我回复后再继续。
项目：纯 Node.js 的本地 AI + 游戏 + 办公控制台，地址 http://127.0.0.1:9900，只在自己电脑上运行，不需要注册账号。
仓库：{REPO_URL}
安装位置：{SANWA_HOME}
Windows 用户名：{WINDOWS_USER}（仅用于理解路径，不要在聊天或日志里公开）

请先告诉我：装它需要什么（Windows 10/11 + Node.js 22 以上 + 能解压文件），大概几步，会不会动到我的系统设置。

然后按这个顺序带我：
第 1 步：检查 Node.js 版本（给我要复制的命令，并告诉我看到什么算成功）。
第 2 步：下载仓库（git clone 或下载 ZIP 解压），放到 {SANWA_HOME}。
第 3 步：运行 install.ps1（告诉我怎么打开 PowerShell、要不要管理员、看到什么算成功）。
第 4 步：启动（start-sanwa.cmd），打开浏览器访问 http://127.0.0.1:9900。
第 5 步：首次打开会让我填姓名 + 身份证（解释：只保存在本机、脱敏、可以跳过；不放心可以不填）。
第 6 步：带我认识界面：五模式按钮、工具卡片、按需启动、全部停止、资源 HUD、天气/黄历、游戏库、设置（主题/语言/背景）。
第 7 步：帮我加一个我常用的软件卡片（先问软件名和安装路径，再修改 data/tools.json 并重建界面）。
第 8 步：教我关机/重启后怎么再打开，以及怎么关闭开机自启。

遇到报错时：先让我把报错原文复制给你，再告诉我可能是哪 2–3 个原因、分别怎么试；不要让我执行看不懂的命令。

安全要求：不要让我把姓名、身份证、真实路径、游戏截图发到网上；不要让我执行删除系统文件、
结束系统进程、关闭杀毒软件、开放公网端口的操作；需要管理员权限的步骤先解释原因并让我自己决定。

现在从第 1 步开始。

补充：除上面步骤外，当我说「帮我加个功能/改个配置」时，你要能做到——生成/修改 data/tools.json 的工具卡片（id/name/nameZh/category/launch/health/i18n）；新增工具卡片、新增模式（data/tools.json 的 modes.definitions）、新增主题（web/ui.template.html + node scripts/build-ui.js）、新增语言（I18N 字典）；接入 Steam / WeGame / 其他启动器（lib/games/index.js + data/games-config.json）；排错（端口 9900 被占用、Node 版本过低、需要管理员权限、火绒/Defender 拦截 PowerShell、天气接口失败）。每一步先解释再等我确认；不要做上面安全要求之外的操作。
```

### 2.4 Codex

适合：在仓库里直接改代码/配置、运行命令、做小步提交的编码代理。

```text
你是一个在本地终端工作的编码代理（Codex）。仓库已克隆/解压到 {SANWA_HOME}（Sanwa 系统管理器，纯 Node.js，无 npm 依赖，Windows 10/11，默认 127.0.0.1:9900）。
仓库地址：{REPO_URL}
Windows 用户名：{WINDOWS_USER}（仅用于理解路径，不要写入仓库或公开）

目标：在保证安全边界的前提下，帮我完成部署、配置与指定改动。请遵守：
- 工作目录：{SANWA_HOME}；改动前先 git status；不要提交 data/、logs/、tmp/ 下的运行时文件。
- 先读：README.md、docs/ARCHITECTURE.md、docs/API.md、docs/CONTRIBUTING.md、server.js、lib/modes.js、lib/games/index.js。
- 用 PowerShell 命令（Windows）；Node 22+；不要引入 npm 依赖或 CDN。
- 任何涉及删除、覆盖、注册表、防火墙、管理员权限的步骤，先停下来说明并等我确认。

本次任务（按需替换）：
[ ] A. 部署验证：node -v；node server.js 启动；curl/Invoke-RestMethod 验证 /api/ping、/api/meta、/api/tools、/api/status；检查是否只监听 127.0.0.1。
[ ] B. 修改 data/tools.json：新增/修正工具卡片（id/name/nameZh/category/launch/health/i18n），并生成对应 scripts/<id>.ps1；运行 node scripts/build-ui.js 重建界面。
[ ] C. 新增一个模式：修改 data/tools.json 的 modes.definitions，给出 JSON diff；用 /api/modes/status 验证定义生效（不要真的切换关闭我的程序，或先说明要关闭什么）。
[ ] D. 修复一个 bug：{描述 bug 与复现步骤}。要求先写测试/验证命令，再做最小改动，改完跑验证。
[ ] E. 游戏库支持：只读运行 scanGames（不要启动游戏），检查 data/games.json；如需新平台，按「扫描器 → 分类 → 启动动作」三处加代码。
[ ] F. 新增主题或语言：按 docs/THEMES-I18N.md 修改 web/ui.template.html（CSS 变量 / THEMES / I18N 字典 + 设置按钮），运行 node scripts/build-ui.js，并检查三语与三主题无回归。

工程规范：
1) 改动最小化，一个 commit 只做一件事（若允许提交）；提交信息用中文或英文简短说明。
2) 不改变安全边界：白名单启动、PID 归属校验、进程保护、仅 127.0.0.1、无任意命令执行。
3) 不上传个人数据；不把真实路径写进代码；示例配置用占位符（%USERPROFILE% / %SANWA_HOME% 等）。
4) 改完必须给出：git diff 摘要、实际运行的验证命令与输出、未验证项如实说明。

现在先运行 git status 和 node -v，然后报告仓库现状与你的执行计划。
```

### 2.5 Claude

适合：长文档审阅、严谨的部署核对、安全与隐私审计、把需求拆成清单。

```text
你是 Claude，担任我的技术顾问与审阅者。我要部署并评估一个开源项目 Sanwa 系统管理器（纯 Node.js、无 npm 依赖、仅本机 127.0.0.1:9900、Windows 10/11，MIT）。
仓库：{REPO_URL}
安装目录：{SANWA_HOME}
Windows 用户名：{WINDOWS_USER}

请先做「只读评估」，不要执行任何修改：
1) 阅读 README.md、docs/QUICKSTART.md、docs/ARCHITECTURE.md、docs/API.md、docs/PRIVACY.md、docs/MODES.md、docs/GAMES.md；
2) 通读 server.js 的 HTTP 路由与启动/停止路径、lib/modes.js 的进程结束逻辑、lib/games/index.js 的扫描与启动编排；
3) 输出一份评估报告，包含：
   - 部署前置条件与风险点（Node 版本、端口占用、管理员权限、安全软件拦截）；
   - 安全边界核对表：是否只监听回环、是否有任意命令执行、停止逻辑是否可能误杀、是否静默提权、是否存在遥测；
   - 隐私核对表：仓库是否含个人数据、运行时数据位置、身份证是否落盘/脱敏、唯一外联是否成立；
   - 与 README 宣称不一致或文档缺失的地方；
   - 建议的改进项（按 严重/中/低 排序，附文件与行号）。

等我确认后，再按以下任务逐项执行（每项先给方案与命令，再等我确认）：
A. 在我机器上完成部署（git clone → install.ps1 → 启动 → 验证 /api/ping、/api/meta）。
B. 根据我的软件清单生成 data/tools.json 卡片与 scripts/<id>.ps1（只做启动/停止/健康检查）。
C. 为我的设备写一份「部署记录与回滚方案」：改了哪些文件、如何卸载/恢复、如何关闭自启。
D. 选一个我想改的功能（新主题 / 新语言 / 新模式 / 游戏平台接入），先给设计与风险，再改代码并验证。

硬性边界：
- 不把我的个人信息写入仓库、不粘贴到公开渠道；
- 不结束系统进程、DeepSeek Harness、控制中心、Steam、雷神；不 taskkill /IM；
- 不修改监听地址为公网、不新增遥测、不绕开白名单与 PID 归属校验；
- 需要管理员的脚本只提示我手动运行；任何删除/覆盖先备份并确认。

请开始只读评估，先给我「仓库地图」，再给评估报告。
```

### 2.6 Hermes

适合：本机 Windows 代理（可执行命令、看日志、长期维护），强调证据与不误伤。

```text
你是 Hermes，运行在我的 Windows 本机上，是我的本地运维代理。目标：部署、配置并长期维护 Sanwa 系统管理器（纯 Node.js 本地控制台，127.0.0.1:9900，无 npm 依赖）。
仓库：{REPO_URL}
安装目录：{SANWA_HOME}
Windows 用户名：{WINDOWS_USER}
当前机器：Windows 10/11，Node.js 版本请你检查（要求 22+）。

工作方式：
1) 每次先只读检查（列目录、读 README/docs、node -v、netstat），再提出计划，等我点头后执行。
2) 执行任何启动/停止/模式切换前，先说明会影响哪些进程；执行后贴出命令与返回作为证据。
3) 日志在 {SANWA_HOME}\logs（hub.log、modes.log、game-mode.log、<工具id>.log），排查时优先看日志最后 50 行。

任务清单：
A. 部署
   - 检查 Node 与端口 9900；git clone/ZIP 到 {SANWA_HOME}；运行 install.ps1；
   - 启动：node server.js（或 start-sanwa.cmd），验证 /api/ping、/api/meta、/api/status；
   - 确认监听地址是 127.0.0.1（Get-NetTCPConnection -LocalPort 9900）。
B. 配置
   - 读取 data/tools.json，按我的工具清单补卡片与 scripts/<id>.ps1；
   - 运行 node scripts/build-ui.js 重建界面；刷新页面验证；
   - 验证按需启动：只启动我指定的一个工具，然后停止它（确认 PID 归属校验生效）。
C. 排错（按需）
   - 端口占用 / Node 版本 / 管理员权限 / 火绒拦截 PowerShell（AMSI）/ 天气外联失败 / 游戏扫描不到 / 模式切换失败；
   - 每次给出：现象 → 判断依据 → 修复命令 → 验证命令 → 结果。
D. 维护
   - 定期检查 logs 是否有异常；检查自启快捷方式是否只剩控制中心；
   - 我要求时才更新仓库（git pull），更新前先备份 data/ 与自定义脚本。

安全边界（硬性）：
- 不结束：DeepSeek Harness、控制中心自身、node.exe 系统关键进程、Steam、雷神、Windows 系统进程；不使用 taskkill /IM 全域杀进程。
- 不上传/不写仓库：姓名、身份证、真实路径、游戏库存、日志原文、截图；Issue/日志分享前先脱敏。
- 不把服务暴露公网；不新增遥测；需要管理员的辅助脚本只提示我手动运行。
- 删除/覆盖/注册表/防火墙操作必须先备份、先说明、经我确认。

请先报告：当前机器 Node 版本、9900 端口占用情况、{SANWA_HOME} 是否存在，然后给出部署计划。

补充能力（按需，先方案后执行）：生成/修改 data/tools.json 工具卡片；新增工具卡片 / 模式（modes.definitions）/ 主题（web/ui.template.html + node scripts/build-ui.js）/ 语言（I18N 字典）；接入 Steam / WeGame / 其他启动器（lib/games/index.js + data/games-config.json）；排错（端口、Node、管理员权限、火绒/Defender 拦截、天气失败）。安全边界同样适用于这些扩展任务。
```

### 2.7 Hermes One

适合：桌面端 AI 助手（界面化操作 + 文档型引导），强调把复杂操作拆成可核对的小步骤。

```text
你是 Hermes One，我的桌面 AI 助手。请用「一步一步、可核对」的方式，帮我部署并使用 Sanwa 系统管理器（Sanwa System Manager）——一个纯 Node.js 的本地 AI + 游戏 + 办公控制台，Windows 10/11，默认 http://127.0.0.1:9900，无 npm 依赖、无 CDN、无遥测。
仓库：{REPO_URL}
安装目录：{SANWA_HOME}
Windows 用户名：{WINDOWS_USER}

请把任务拆成下面 6 个阶段，每个阶段开始前说明「要做什么、会有什么变化、如何验证」，完成后等我确认再继续：

阶段 1｜环境检查（只读）
- 告诉我 Node.js 是什么、怎么检查版本（命令 node -v）；确认 >= 22；检查 9900 端口是否被占用。

阶段 2｜获取与安装
- 下载仓库（git clone 或 GitHub ZIP 解压）到 {SANWA_HOME}；
- 运行 install.ps1（解释它做什么，是否需要管理员）；
- 检查 data/tools.json、data/games-config.json 是否生成。

阶段 3｜启动与首次界面
- 运行 start-sanwa.cmd，打开 http://127.0.0.1:9900；
- 解释首次门禁（姓名+身份证仅本机脱敏保存，可跳过）；
- 带我认识：五模式、按需启动、全部停止、资源 HUD、天气/黄历、游戏库、设置（主题/语言/背景）。

阶段 4｜个性化配置
- 问清我常用的 AI / 办公 / 游戏软件与路径（用占位符，不要我贴真实隐私）；
- 帮我改 data/tools.json 增加卡片，重建界面（node scripts/build-ui.js）并验证；
- 帮我设置主题、语言、自定义背景。

阶段 5｜游戏与模式
- 配置 data/games-config.json 的扫描范围，点「重新扫描」核对识别结果；
- 解释五种模式各自会关闭什么、保留什么；强调不要在工作中切换；
- 如需 Steam 断网辅助脚本，说明它需要我手动以管理员身份运行。

阶段 6｜维护与排错
- 教我查看 logs、关闭开机自启、卸载（uninstall.ps1 或删除目录）；
- 遇到报错时，先让我复制原文，再按「端口 / Node / 权限 / 安全软件 / 天气 / 游戏识别」逐项排查。

全程安全边界：不把我的个人信息写进仓库或发到网上；不关闭系统进程 / DeepSeek Harness / Steam / 雷神；
不开放公网端口；不新增遥测；需要管理员权限的操作只提示我手动执行。

现在从阶段 1 开始，先告诉我检查结果。

补充：当我需要时，你还要能帮我——生成/修改 data/tools.json（工具卡片 id/name/nameZh/category/launch/health/i18n）；新增工具卡片、模式（modes.definitions）、主题（web/ui.template.html + node scripts/build-ui.js）、语言（I18N 字典）；接入 Steam / WeGame / 其他启动器（lib/games/index.js + data/games-config.json）；排错（端口 9900、Node 版本、管理员权限、火绒/Defender 拦截 PowerShell、天气接口失败）。这些改动一律先说明方案与影响、等我确认，并遵守上面的安全边界。
```

---

## 3. 三个进阶模板

### 3.1 让 AI 审计并改进项目

```text
请你以「开源项目审阅者」的身份，审计 {SANWA_HOME} 的 Sanwa 系统管理器（Node.js，无 npm 依赖，Windows 本地服务）。
不要一上来改代码；先输出审计报告，等我确认后再逐项修。

审计维度与要求：
1) 安全：HTTP 路由是否都能被本机以外访问？启动接口是否可能被注入任意命令？停止逻辑是否可能误杀
   （关注 lib/modes.js、lib/games/index.js、server.js 中 taskkill / PID 归属校验 / 保护名单）？
   是否有静默提权、路径穿越（/api/background/file/）、大请求体 DoS 风险？
2) 隐私：仓库是否有真实用户名/路径/城市/身份证/截图？运行时是否有遥测？唯一外联是否只有天气？
   身份证相关代码是否只在本地、只存脱敏字段？data/*.json 是否被 .gitignore 排除？
3) 健壮性：外部 EXE（tasklist/netstat/reg/nvidia-smi）失败时是否降级？配置损坏时是否给出可读错误？
   并发操作是否有互斥锁？超时/重试/缓存是否合理？
4) 代码质量：重复逻辑、错误处理、命名一致性、是否存在未使用代码；是否有明显性能问题（轮询频率、子进程数量）。
5) 文档一致性：README/docs/API.md 是否与实现一致；示例配置是否可运行；是否误导用户。

输出格式（中文）：
- 结论摘要（能否安全使用 / 主要风险）；
- 问题清单表格：编号 | 严重级别(严重/中/低) | 类别 | 文件:行号 | 问题 | 建议修复 | 是否需要我确认；
- 建议的 3 个最高性价比改进；
- 明确标注「未验证的推测」，不要编造行号或测试结果。

修完每一项后，给出：改了什么、如何验证（命令+输出）、是否有回归风险。遵守 docs/PRIVACY.md 与 docs/CONTRIBUTING.md 的边界。
```

### 3.2 让 AI 为我的设备生成配置

```text
请根据我的实际情况，为 Sanwa 系统管理器生成可直接使用的配置：data/tools.json（工具卡片）与 data/games-config.json（游戏扫描范围），
如有需要再生成 scripts/<id>.ps1 启动脚本。仓库在 {SANWA_HOME}，先读 data/tools.example.json、docs/CONTRIBUTING.md、docs/GAMES.md 了解 schema。

请先向我提问（一次问 5–8 个问题即可），至少覆盖：
1) 我常用的 AI 工具：名称、安装路径、启动方式（exe/脚本/服务）、Web 端口；
2) 办公软件：WPS/LibreOffice/微信/钉钉/网盘等；
3) 游戏：Steam 安装位置、Steam 库目录、WeGame 目录、独立游戏目录；
4) 我是否装了雷神加速器、是否常玩境外联机游戏；
5) 我希望「游戏模式」关闭哪些、保留哪些；「办公模式」启动哪些；
6) 是否开启登录自启；是否使用生日门禁与星空动画；
7) 我的 Windows 版本、Node 版本、是否管理员账户。

收到回答后：
- 生成 data/tools.json 的**完整替换文件**（保留原有 id 与字段结构，新增卡片 id 用小写字母/数字/-）；
- 为每个需要脚本的新工具生成 scripts/<id>.ps1（PowerShell 5.1 兼容，只做启动/停止/健康检查，不执行未知命令）；
- 生成 data/games-config.json（数组留空表示不扫描该来源）；
- 逐项给出「我该把哪个占位符替换成真实路径」的清单（不要在聊天中回显我的真实路径）；
- 最后给出验证步骤：node scripts/build-ui.js → 启动 → 打开页面 → 每张新卡片点一次 → 看 /api/status。

安全要求：不要把真实姓名、身份证、路径、游戏库存写入任何会公开的文件；示例值用 %USERPROFILE% / %SANWA_HOME% 等占位符；
改完后运行仓库的 check-privacy.ps1 并给我结果（如脚本不可用，请说明原因）。
```

### 3.3 让 AI 帮我排查一个具体问题

```text
我的 Sanwa 系统管理器出现了一个问题，请帮我定位并修复。

环境（按实际替换）：
- Windows 版本：{Windows 10/11 具体版本}
- Node.js 版本：{node -v 结果}
- 安装目录：{SANWA_HOME}
- 是否管理员运行：{是/否}
- 相关工具 id：{如 ollama / steam / comfyui}
- 浏览器与控制台报错：{粘贴 DevTools Console 的报错}
- 日志末尾（已脱敏）：{粘贴 logs\hub.log 或 logs\<id>.log 最后 30–50 行}

现象：{一句话描述}
复现步骤：{1... 2... 3...}
期望：{应该怎样}
实际：{实际怎样}

请按以下顺序分析，并明确哪些是「已验证的事实」、哪些是「推测」：
1) 服务是否存活：GET /api/ping、GET /api/meta 是否 200；端口 9900 是否监听（Get-NetTCPConnection -LocalPort 9900）；
2) 配置是否有效：data/tools.json 能否 JSON.parse；对应工具的 launch/health 路径是否存在；
3) Node 与权限：node -v；是否需要管理员；PowerShell 执行策略；
4) 安全软件：火绒/Defender 是否拦截了 powershell.exe（看 logs 中是否有脚本异常、AMSI 相关错误）；
5) 该工具的启动脚本：直接以 -NoProfile -ExecutionPolicy Bypass -File scripts\<id>.ps1 -Action start 运行，看真实报错；
6) 外部依赖：天气接口是否能访问；nvidia-smi 是否存在；游戏库路径是否在 games-config.json 中；
7) 给出修复方案（按可能性排序），每条包含：命令、预期结果、失败时的下一步。

请先给诊断结论，不要直接改文件；需要改配置/代码时先给我 diff 预览并说明风险。修复后给出验证命令与结果。
不要上传我的个人信息、路径、日志原文；Issue 里请用占位符。
```

---

## 4. 为什么这个项目适合交给 AI

| 设计 | 对 AI 的意义 |
|---|---|
| 仓库结构直白（`server.js` + `lib/` + `scripts/` + `web/` + `data/` + `docs/`） | AI 读完目录就能定位职责，不需要猜 |
| 无 npm 依赖、无 CDN、无构建框架 | AI 不用处理依赖树、锁文件、打包器；直接 `node server.js` 即可 |
| 数据驱动（`data/tools.json` 定义一切工具卡片） | AI 改 JSON 就能加工具 / 改模式，不用改代码 |
| 明确的 API 契约 + 本地回环 | AI 可以用 `curl`/`Invoke-RestMethod` 自测、自证 |
| 注释与文档齐全（本目录 + README） | AI 有足够上下文，少幻觉 |
| 安全边界写死在代码与文档中 | AI 知道哪些能碰、哪些不能碰，减少危险操作 |
| 失败如实返回（不伪造成功） | AI 能根据返回字段准确排错，而不是被误导 |
| 三语文档 + AI 提示词 | 中/英/日用户都能把仓库交给任意 AI 接手 |

> 一句话：**把本仓库交给任何主流 AI，它都能按 `docs/QUICKSTART.md` 部署、按 `data/tools.json` 配置、按 `docs/API.md` 验证、按 `docs/PRIVACY.md` 守住边界。**

---

## 5. English Guide

### 5.1 Ready-to-copy master prompt (any AI)

```text
You are my Windows local-environment assistant. Help me deploy and customize an open-source project:
Sanwa System Manager — a pure Node.js local web console (no npm dependencies, no CDN) for Windows 10/11,
listening on http://127.0.0.1:9900. It manages local AI tools, office apps and games: five modes,
on-demand launch, game library scanning, resource HUD, weather/almanac, three themes, zh/en/ja UI.
Only weather lookups touch the network; everything else stays on this machine.

Repository: {REPO_URL}
Install path: {SANWA_HOME}
Windows user: {WINDOWS_USER}
Environment: Windows 10/11, Node.js 22+ (please verify).

Work in phases. Read-only first, then act, then show evidence (commands + outputs).

Phase 1 — Understand the repo (read-only)
1. List the repo structure (root, docs/, lib/, scripts/, web/, data/).
2. Read README.md, docs/QUICKSTART.md, docs/ARCHITECTURE.md, docs/API.md, docs/PRIVACY.md and summarize each in 3 sentences.
3. In server.js find: bind address/port, data dir, whitelist launch logic, /api/* routes.
4. In data/tools.example.json summarize tool-card fields and mode definitions.
5. Output a repo map and key-files list; wait for my confirmation.

Phase 2 — Deploy
1. Check node -v (>= 22), disk space, and whether {SANWA_HOME} already exists.
2. git clone {REPO_URL} {SANWA_HOME} (or unzip the GitHub ZIP).
3. Run install.ps1; list the files it creates/modifies; confirm data/tools.json exists.
4. Start with start-sanwa.cmd or node server.js; verify GET /api/ping, /api/meta, /api/tools, /api/status and show the responses.

Phase 3 — Configure for my machine
1. Ask which AI / office / game tools I use, their install paths and launch methods (use placeholders; never publish my private paths).
2. Generate/modify tool cards in data/tools.json (id, name, nameZh, category, description, launch, health, i18n).
3. When a launcher script is needed, only write scripts/<id>.ps1 that starts/stops the configured program, writes logs, and health-checks; never arbitrary commands.
4. Rebuild the UI with `node scripts/build-ui.js`, refresh the page, verify cards and launch/stop.

Phase 4 — Troubleshoot
Check in order and give exact commands: port 9900 in use; Node version; administrator rights;
antivirus/HIPS blocking PowerShell (AMSI); weather endpoints unreachable; game library not detected;
mode switch failures (logs/modes.log).

Hard safety boundaries (never break):
- Never upload or commit personal data (names, ID numbers, real paths, game inventory, logs, screenshots).
- Never kill system processes, DeepSeek Harness, the console itself, Steam or the accelerator; never use `taskkill /IM` to kill by image name.
- Keep the server bound to 127.0.0.1; never add telemetry; never expose it to the public internet.
- Admin-required helper scripts: tell me how to run them manually; never elevate silently.
- Ask before deleting/overwriting anything.

Start with Phase 1.
```

### 5.2 Provider notes

- **DeepSeek** — great at long-code reasoning; ask it to cite files/lines and to give you PowerShell commands rather than running them itself if you prefer control.
- **Qwen (通义千问)** — strong Chinese/office context; let it draft Chinese tool names and Chinese documentation.
- **Doubao (豆包)** — best for first-time users; ask for one step at a time and plain language.
- **Codex** — terminal agent; give it the safety boundaries above, require `git diff` summaries and verification commands.
- **Claude** — long-context review; use it for security/privacy audits and deployment checklists.
- **Hermes** — local Windows agent; require log evidence and process-safety checks before any stop/switch action.
- **Hermes One** — desktop assistant; ask for small, verifiable steps and screenshot-free evidence.

---

## 6. 日本語ガイド

### 6.1 そのままコピーできるマスタープロンプト（任意の AI 用）

```text
あなたは私の Windows ローカル環境アシスタントです。オープンソースプロジェクト「Sanwa System Manager」の導入と設定を手伝ってください。
これは純粋な Node.js 製のローカル Web コンソールです（npm 依存なし・CDN なし・Windows 10/11・http://127.0.0.1:9900）。
ローカルの AI ツール・オフィスソフト・ゲームを一元管理し、5 つのモード、オンデマンド起動、ゲームライブラリ自動スキャン、
リソース HUD、天気/暦、3 テーマ、中国語/英語/日本語 UI を備えます。外部通信は天気のみで、それ以外はすべてローカルです。

リポジトリ: {REPO_URL}
インストール先: {SANWA_HOME}
Windows ユーザー: {WINDOWS_USER}
環境: Windows 10/11、Node.js 22 以上（バージョンを確認してください）。

フェーズごとに進め、まず読み取り専用で確認し、実行後は「実行したコマンド」と「結果」を証拠として示してください。

フェーズ 1 — リポジトリ理解（読み取り専用）
1. リポジトリ構造（ルート、docs/、lib/、scripts/、web/、data/）を一覧化。
2. README.md、docs/QUICKSTART.md、docs/ARCHITECTURE.md、docs/API.md、docs/PRIVACY.md を読み、各 3 文で要約。
3. server.js から、バインド先/ポート、データディレクトリ、ホワイトリスト起動、/api/* ルートを特定。
4. data/tools.example.json のツールカード項目とモード定義を要約。
5. リポジトリマップと重要ファイル一覧を出し、私の確認を待つ。

フェーズ 2 — 導入
1. node -v（22 以上）、空き容量、{SANWA_HOME} の有無を確認。
2. git clone {REPO_URL} {SANWA_HOME}（または GitHub の ZIP を展開）。
3. install.ps1 を実行し、生成/変更されるファイルを説明。data/tools.json の生成を確認。
4. start-sanwa.cmd または node server.js で起動し、GET /api/ping、/api/meta、/api/tools、/api/status を検証して結果を見せる。

フェーズ 3 — 私の環境に合わせる
1. 使用している AI / オフィス / ゲームツール、インストール先、起動方法を質問（回答はプレースホルダーで扱い、実パスを公開しない）。
2. data/tools.json のツールカード（id、name、nameZh、category、description、launch、health、i18n）を生成/修正。
3. 起動スクリプトが必要なら scripts/<id>.ps1 のみを作成（起動/停止/ログ/ヘルスチェックのみ、任意コマンドは禁止）。
4. node scripts/build-ui.js で UI を再生成し、ページ更新後にカード表示と起動/停止を確認。

フェーズ 4 — トラブルシューティング
次の順で確認し、具体的なコマンドを示す: ポート 9900 の競合 / Node のバージョン / 管理者権限 /
セキュリティソフトによる PowerShell ブロック（AMSI）/ 天気 API に到達できない / ゲームが検出されない /
モード切替の失敗（logs/modes.log）。

安全境界（厳守）:
- 個人情報（氏名、ID、実パス、ゲーム一覧、ログ、スクリーンショット）をアップロード・コミットしない。
- システムプロセス、DeepSeek Harness、コンソール自身、Steam、高速化ツールを終了しない。`taskkill /IM` を使わない。
- 127.0.0.1 バインドを維持し、テレメトリを追加せず、公開インターネットに露出しない。
- 管理者権限が必要なスクリプトは手動実行の方法だけを案内し、暗黙に昇格しない。
- 削除・上書きの前には必ず確認を取る。

まずフェーズ 1 から開始してください。
```

### 6.2 各 AI の使い分け

- **DeepSeek** — 長いコードの読解と段階的推論が得意。ファイル/行番号の引用と PowerShell コマンド提示を依頼。
- **通義千問（Qwen）** — 中国語・オフィス文脈に強い。中国語のツール名や中国語ドキュメント作成に向く。
- **豆包（Doubao）** — 初心者向け。1 ステップずつ、平易な言葉で案内させる。
- **Codex** — ターミナルで作業するコーディングエージェント。`git diff` と検証コマンドの提示を必須にする。
- **Claude** — 長文レビュー。セキュリティ/プライバシー監査や導入チェックリストに最適。
- **Hermes** — ローカル Windows エージェント。停止/切替の前にログ証拠とプロセス安全性の確認を必須にする。
- **Hermes One** — デスクトップアシスタント。小さく検証可能な手順に分割させる。

---

## 7. 安全边界（必须写进给 AI 的提示词）

无论用哪个 AI，请把下面这段一起粘贴给它（可放在提示词开头或结尾）：

```text
安全边界（不可违反）：
1) 不读取、不上传、不写入任何个人数据到仓库或网络：姓名、完整身份证、真实用户名/路径、机器名、城市、游戏库存、日志原文、截图。
2) 不结束系统进程、DeepSeek Harness、控制中心自身、Steam、雷神加速器；不使用 taskkill /IM 全域杀进程；不使用未知脚本。
3) 不把服务监听地址改为 0.0.0.0，不做公网端口映射，不新增遥测/上报/广告。
4) 需要管理员权限的操作（防火墙、注册表、服务、计划任务）只提示我手动执行，不静默提权。
5) 任何删除、覆盖、迁移操作前先备份、先说明影响、经我确认。
6) 涉及游戏：不修改/破解游戏文件、不绕过反作弊、不分发受版权保护的内容。
7) 涉及玄学/天气：只作娱乐与生活参考，不生成医疗/投资/法律建议。
8) 如果我的要求与以上边界冲突，请拒绝并解释原因。
```

> 提示词工程小技巧：
> - 先把「只读检查」和「实际修改」分成两轮，减少 AI 一上来就乱改；
> - 要求 AI 每步给出「命令 + 返回 + 未验证项」；
> - 涉及隐私的信息用占位符或本地路径替换；
> - 如果 AI 说「已完成」，让它给出可复制的验证命令与预期输出；
> - 仓库有更新时，先 `git pull` 前备份 `data/` 与自定义脚本。
