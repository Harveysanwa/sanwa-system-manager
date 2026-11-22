# AGENTS.md · 面向 AI 编码助手的项目指南

> 本文件面向 Codex、Claude Code、Cursor、Hermes、DeepSeek、通义千问、豆包 等能读取仓库的 AI 编码助手。
> 人类用户请先读 [README.md](README.md) 与 [docs/QUICKSTART.md](docs/QUICKSTART.md)。

## 项目是什么

Sanwa 系统管理器（Sanwa System Manager）是 **Windows 10/11 上的本地 AI + 办公 + 游戏统一控制台**：
纯 Node.js（无 npm 依赖、无 CDN）本地服务（默认 `127.0.0.1:9900`）+ 单文件 HTML 科幻 HUD。

关键事实：

- 运行平台：Windows 10/11；Node.js ≥ 22；默认端口 `SANWA_PORT=9900`（仅监听本机回环）。
- 应用根目录：仓库根（`server.js` 所在目录），可用环境变量 `SANWA_HOME` 覆盖。
- 数据目录：`data/`（运行时生成 `tools.json`、`profile.json`、`games.json` 等，已 `.gitignore`）。
- 零第三方运行时依赖；`lib/fortune/vendor/` 下为 MIT 许可的 vendored 库（lunar-javascript、cnchar）。
- 隐私：无遥测、无账号；唯一主动外联是天气（wttr.in / Open-Meteo / 中国天气网）；身份证只在浏览器本地校验与脱敏存储。
- 版权：© 驼学长，MIT License。

## 仓库结构（关键路径）

```
server.js                  本地 HTTP 服务 + 全部 /api/* 路由
lib/modes.js               五模式引擎（normal/ai/office/game/extreme）
lib/games/index.js         游戏库扫描 + 启动编排（Steam/WeGame/独立/Epic）
lib/fortune/               天气 / 黄历 / 抽签 / 八字 / 姓名（离线为主）
scripts/*.ps1              工具启动/停止脚本（占位符配置驱动）
scripts/build-ui.js        从 ui.template.html 构建 web/index.html
web/ui.template.html       单文件 UI 源
data/*.example.json        示例配置（复制为 data/tools.json 后编辑）
install.ps1 / uninstall.ps1 / start-sanwa.cmd
docs/                      三语文档、API、架构、隐私、AI 引导
check-privacy.ps1          发布前隐私扫描（维护者）
```

## 常用命令（PowerShell）

```powershell
node --version                                  # 需要 >= 22
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1   # 生成 data/tools.json + 桌面入口
$env:SANWA_PORT=9900; node server.js            # 启动（默认 9900）
node scripts/build-ui.js                        # 修改 UI 模板后重建 web/index.html
powershell -NoProfile -ExecutionPolicy Bypass -File .\check-privacy.ps1   # 发布前隐私扫描（必须 PASS）
```

## 修改代码时的硬性约束

1. **不要引入 npm 依赖**；只用 Node.js 标准库与 Windows 原生 EXE/COM（`tasklist`、`netstat`、`reg`、`nvidia-smi`、`cscript`）。
2. **不要硬编码个人路径**：使用 `%USERPROFILE%`、`%LOCALAPPDATA%`、`%PROGRAMFILES%`、`%SANWA_AI_ROOT%` 等占位符；本地绝对路径只能出现在用户自己的 `data/tools.json`（已被 gitignore）。
3. **不要提交**：`data/` 运行时文件、`logs/`、`tmp/`、`backup/`、截图、真实游戏清单、真实城市/用户名/身份证。
4. **只监听 `127.0.0.1`**；不要加遥测、上传、外部 API（天气除外，且必须可降级）。
5. 模式/停止引擎必须使用**白名单**，永不结束 DeepSeek Harness、Sanwa 自身、Steam、雷神加速器与系统进程。
6. 涉及管理员权限的操作（防火墙、计划任务、系统设置）必须显式提示用户并给出手动脚本，不得静默提权。
7. 修改 UI 文案时同步 `README.md` / `README.en.md` / `README.ja.md` 与 `docs/` 对应章节；新增/修改 API 时同步 `docs/API.md`。
8. 提交前运行 `check-privacy.ps1`，并确保 `node --check` 通过。

## 给 AI 的推荐工作流

1. 先只读：`README.md` → `docs/QUICKSTART.md` → `docs/ARCHITECTURE.md` → `docs/API.md` → `docs/PRIVACY.md`。
2. 读 `data/tools.example.json` 理解工具卡片与模式配置。
3. 需要部署/改造/排错时，使用 [docs/AI-INTEGRATION.md](docs/AI-INTEGRATION.md) 中的提示词模板（含 DeepSeek / 千问 / 豆包 / Codex / Claude / Hermes / Hermes One 专用版本）。
4. 涉及用户机器数据时，先让用户确认；不要要求用户把完整 `data/profile.json`、日志或身份证发到公网。
5. 输出每一步"做了什么 / 证据 / 下一步"，方便用户审计。

## PR 检查清单

- [ ] 无个人路径/姓名/城市/游戏库存/截图
- [ ] `check-privacy.ps1` PASS
- [ ] `node --check` 全部 JS 通过
- [ ] 文档与三语 README 同步
- [ ] 新增功能有最小自测说明
