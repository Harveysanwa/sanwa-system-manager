# 贡献指南（Contributing）

> 先谢谢你有兴趣让 Sanwa 系统管理器变得更好！
> 本项目是 MIT 开源的 Windows 本地工具，欢迎 **Fork / 二次创作 / 改主题 / 加工具 / 提 PR**；也欢迎用 AI 帮你写代码（见 [AI-INTEGRATION.md](AI-INTEGRATION.md)）。
> 提交任何内容前，请先读 [PRIVACY.md](PRIVACY.md) 的隐私要求与 [ARCHITECTURE.md](ARCHITECTURE.md) 的安全边界。

---

## 1. 行为准则（简要）

- 尊重所有参与者，不进行人身攻击、歧视、骚扰；
- 不讨论/传播盗版、破解教程、外挂、作弊、绕过反作弊；
- 不发布他人隐私信息（姓名、身份证、路径、截图等）；
- 对事不对人，技术分歧用证据与复现说话；
- 违反者可能被移出讨论或封禁。

## 2. 开始之前

1. 搜索已有 [Issues]（含已关闭）与 [Pull Requests]，避免重复；
2. 小改动（文档、错别字、工具卡片）可直接 PR；较大的功能 / 架构改动请先开 Issue 讨论；
3. 本项目**只支持 Windows 10/11 + Node.js 22+**，不引入 npm 运行时依赖、不引入 CDN；
4. 如果你用 AI 生成代码，请自行验证，并在 PR 里注明「AI 辅助 + 已人工验证」；
5. 不要提交任何运行时数据（`data/`、`logs/`、`tmp/`）或你的本机配置。

## 3. 目录结构

```text
sanwa-system-manager/
├── server.js                  # 本地 HTTP 服务（Node 标准库，127.0.0.1:9900）
├── install.ps1 / uninstall.ps1
├── start-sanwa.cmd            # 一键启动并打开页面
├── package.json               # 仅元数据与脚本，无 dependencies
├── check-privacy.ps1          # 发布前脱敏扫描
├── lib/
│   ├── modes.js               # 五模式引擎（纯 Node）
│   ├── games/index.js         # 游戏库扫描与启动编排
│   └── fortune/               # 天气 / 黄历 / 抽签 / 八字 / 姓名
│       ├── index.js
│       ├── src/               # 各实现
│       ├── vendor/            # vendored MIT 库（勿改，保留 LICENSE）
│       └── data/lots.json     # 64 卦数据
├── scripts/
│   ├── _common.ps1            # 工具启停公共逻辑（读 tools.json）
│   ├── build-ui.js            # 生成 web/index.html
│   ├── start-hub.ps1 / stop-hub.ps1
│   ├── autostart-create.vbs
│   ├── game-mode*.ps1
│   └── <tool-id>.ps1          # 每个工具一个薄封装
├── web/
│   ├── ui.template.html       # 界面源模板（改这个）
│   └── index.html             # 构建产物（不要直接改）
├── data/
│   ├── tools.example.json     # 工具卡片示例（面板数据来源）
│   ├── games-config.example.json
│   └── fortune.preferences.example.json
├── tools/                     # Steam 断网辅助脚本（管理员用）
├── docs/                      # 文档（本目录）
└── .github/                   # Issue / PR 模板
```

## 4. 本地开发环境

```powershell
# 1) 安装 Node.js 22+（已安装可跳过）
node -v

# 2) 获取代码
git clone <你的 fork 地址> sanwa-system-manager
cd sanwa-system-manager

# 3) 生成配置（复制示例）
Copy-Item .\data\tools.example.json .\data\tools.json
Copy-Item .\data\games-config.example.json .\data\games-config.json

# 4) 启动服务
node .\server.js
# 或双击 start-sanwa.cmd（会自动打开浏览器）

# 5) 改完界面模板后重建
node .\scripts\build-ui.js
```

- 不需要 `npm install`；`package.json` 的 `dependencies` 必须保持为空。
- 测试地址：<http://127.0.0.1:9900>；接口自测：
  ```powershell
  Invoke-RestMethod http://127.0.0.1:9900/api/ping
  Invoke-RestMethod http://127.0.0.1:9900/api/meta | ConvertTo-Json -Depth 4
  Invoke-RestMethod http://127.0.0.1:9900/api/tools | ConvertTo-Json -Depth 4
  ```
- 语法检查（无需启动）：
  ```powershell
  node --check .\server.js
  node --check .\lib\modes.js
  node --check .\lib\games\index.js
  node --check .\lib\fortune\index.js
  node --check .\scripts\build-ui.js
  ```

## 5. 添加一个工具卡片（最常见贡献）

### 5.1 在 `data/tools.example.json` 增加卡片

字段说明（完整示例）：

```json
{
  "id": "my-tool",
  "name": "My Tool",
  "nameZh": "我的工具",
  "category": "system",
  "version": "1.0.0",
  "description": "这个工具是做什么的，监听哪个端口、有什么用途。",
  "icon": "tool",
  "tags": ["本地服务", "示例"],
  "url": "http://127.0.0.1:12345/",
  "health": {
    "type": "http",
    "url": "http://127.0.0.1:12345/health",
    "port": 12345,
    "timeoutMs": 1500
  },
  "launch": {
    "kind": "exe",
    "exe": "%USERPROFILE%\\AppData\\Local\\Programs\\MyTool\\mytool.exe",
    "args": [],
    "cwd": "%USERPROFILE%\\AppData\\Local\\Programs\\MyTool",
    "env": {},
    "windowStyle": "normal",
    "waitSeconds": 30,
    "openAfterReady": true
  },
  "notes": ["需要先安装官方客户端", "首次启动较慢"],
  "statusText": {
    "running": "我的工具运行中",
    "stopped": "我的工具未启动",
    "starting": "正在启动我的工具…",
    "unknown": "状态未知"
  },
  "gameMode": "stop",
  "i18n": {
    "en": { "description": "Short English description of the tool." },
    "ja": { "description": "ツールの短い日本語説明。" }
  }
}
```

**字段约定**

| 字段 | 必填 | 说明 |
|---|---|---|
| `id` | ✅ | 小写字母/数字/`-`，≤ 64 字符；必须与 `scripts/<id>.ps1` 同名 |
| `name` / `nameZh` | ✅ | 英文名 / 中文名（卡片主标题用中文名） |
| `category` | ✅ | 必须是 `categories[]` 中已存在的 id |
| `description` / `i18n` | ✅ | 中文简介 + 英日简介；英文/日文缺失会回退中文 |
| `health` | 建议 | `type`: `http` / `tcp` / `process` / `none`；决定运行状态检测方式 |
| `launch.kind` | ✅ | `exe` / `script` / `url` / `service` / `appx` / `self` / `none` |
| `launch.exe` / `script` / `url` / `service` | ✅ | 按 kind 提供；路径请用占位符或环境变量，不要写真实用户名 |
| `gameMode` | 建议 | `stop`（游戏模式关闭）/ `keep`（保留） |

### 5.2 创建启动脚本 `scripts/<id>.ps1`

大多数工具只需一个薄封装（参考 `scripts/ollama.ps1`）：

```powershell
# ============================================================================
#  Sanwa系统管理器 · <工具名> 启动脚本
#  用法：powershell -NoProfile -ExecutionPolicy Bypass -File <id>.ps1
#        可选参数：-Action start|stop|restart   -NoOpen   -DryRun
# ============================================================================
param(
    [ValidateSet('start','stop','restart')][string]$Action = 'start',
    [switch]$NoOpen,
    [switch]$DryRun
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '_common.ps1')
try {
    $code = Invoke-ToolAction -Id '<id>' -Action $Action -NoOpen:$NoOpen -DryRun:$DryRun
} catch {
    Write-Host ('  [X] 执行失败：' + $_.Exception.Message) -ForegroundColor Red
    Write-ToolLog -Id '<id>' -Message ('执行失败：' + $_.Exception.Message)
    $code = 1
}
exit $code
```

- `id` 必须与 `tools.json` 完全一致；
- 薄封装由 `_common.ps1` 的 `Invoke-ToolAction` 按 `launch.kind` 执行启动/停止/健康检查，**不要**在脚本里写任意命令或 `taskkill /IM`；
- 需要特殊逻辑时，在 `_common.ps1` 增加通用函数，而不是复制粘贴；
- 脚本必须兼容 Windows PowerShell 5.1（不要用 PowerShell 7 专属语法）。

### 5.3 验证

1. `node scripts/build-ui.js` 重建界面；
2. 刷新页面，确认卡片出现、中文名/英文名/简介正确；
3. 点「启动」→ 看状态变为运行中；点「停止」→ 状态停止（仅停止本服务启动的进程）；
4. `GET /api/tools` 与 `GET /api/status` 返回该卡片；
5. 三语言切换检查简介；
6. 运行 `check-privacy.ps1`（见第 8 节）。

## 6. 其它常见贡献

### 6.1 新增模式

修改 `data/tools.example.json → modes.definitions`，给出 `start` / `stop` 的 `id` 列表；受保护工具不会被关闭。参考 [MODES.md](MODES.md)。

### 6.2 新增主题 / 语言

修改 `web/ui.template.html`（CSS 变量、`THEMES` 白名单、`I18N` 字典、设置按钮），然后 `node scripts/build-ui.js`。详细步骤见 [THEMES-I18N.md](THEMES-I18N.md)。

### 6.3 游戏平台支持

在 `lib/games/index.js` 中按「扫描器 → 分类 → 启动动作」三段式增加；扫描必须只读，启动动作失败要如实返回。配置项放 `data/games-config.example.json`，不要硬编码真实路径。参考 [GAMES.md](GAMES.md)。

### 6.4 新增 API

在 `server.js` 的路由表与实现中加入，保持 JSON 契约、错误码一致，并更新 [API.md](API.md)。注意安全：只允许本机、只接受白名单 id、不执行任意命令。

## 7. 提交规范

- 一个 PR 只做一件事；提交信息简洁、说明「为什么」；
- 推荐前缀：`fix:` / `feat:` / `docs:` / `ui:` / `tools:` / `chore:`；
- 修改界面请附**脱敏后**截图或文字说明（能描述清楚可不截图）；
- 行为变更必须同步更新 `CHANGELOG.md` 与相关文档；
- 不要提交 `data/` 下的运行时文件、`logs/`、`tmp/`、`node_modules/`。

## 8. 隐私与发布检查

```powershell
# 发布前 / 提 PR 前运行
npm run check:privacy
# 等价于：powershell -NoProfile -ExecutionPolicy Bypass -File .\check-privacy.ps1
# 期望输出：PASS - 0 hits
```

- 新增文档 / 示例配置**不得**包含真实用户名、计算机名、城市、身份证、路径、游戏库存、邮箱、手机号；
- 新增路径请用 `%USERPROFILE%`、`%SANWA_HOME%` 等占位符；
- 新增截图请先检查桌面、路径栏、账号信息；
- 如果扫描脚本在你环境报编码错误（Windows PowerShell 5.1 对无 BOM 的 UTF-8 脚本敏感），请改用 PowerShell 7 运行，或在 Issue 里反馈。

## 9. 安全与隐私红线（PR 会被拒绝的情形）

- 新增遥测、统计、广告、云端上传接口；
- 新增任意命令执行接口，或放宽工具白名单 / PID 归属校验；
- 把监听地址改为 `0.0.0.0` / 公网暴露；
- 静默提权、静默修改注册表 / 防火墙 / 计划任务；
- 使用 `taskkill /IM` 或按进程名全域杀进程；
- 结束系统进程、DeepSeek Harness、控制中心自身、Steam、雷神加速器；
- 内置游戏破解、外挂、反作弊绕过、版权内容分发；
- 提交个人数据、真实路径、截图或他人隐私。

## 10. 许可证

- 提交的代码与文档默认以 **MIT License** 授权，并保留版权声明 © 驼学长；
- 引用第三方代码/文本必须注明来源且许可证兼容（MIT / Apache-2.0 / 公有领域等），并在 `THIRD_PARTY_NOTICES.md` 记录；
- 不要引入 GPL 等与 MIT 不兼容的代码到核心路径。

## 11. 交流

- Bug：使用 `.github/ISSUE_TEMPLATE/bug_report.md`；
- 功能：使用 `.github/ISSUE_TEMPLATE/feature_request.md`；
- PR：使用 `.github/pull_request_template.md`；
- 想用 AI 协助：直接复制 [AI-INTEGRATION.md](AI-INTEGRATION.md) 中的提示词。

再次感谢你的贡献！🎉
