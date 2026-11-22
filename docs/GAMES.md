# 游戏库与启动编排（Games）

> 功能：自动扫描本机游戏（Steam / WeGame / 独立 / Epic 识别）→ 分类（平台 / 境内境外 / 单机联机破解）→ 按需启动编排（加速器 / Steam 离线 / 管理员断网辅助）。
> 代码：`lib/games/index.js`；缓存：`data/games.json`；配置：`data/games-config.json`。

## 1. 扫描原理（只读）

扫描**绝不启动、关闭或修改**任何游戏。四种来源：

| 来源 | 识别方式 | 说明 |
|---|---|---|
| **Steam** | `libraryfolders.vdf` 列出所有 Steam 库 → 每个库的 `appmanifest_<appid>.acf` 读取 `appid` / `name` / `installdir` / `SizeOnDisk`，再在安装目录内定位主 exe | 支持多库、多盘；标准安装目录与注册表 SteamPath 都会检查 |
| **WeGame** | `data/games-config.json → weGameDirs` 指定目录 + 常见安装目录 + 注册表卸载项 | 从目录名/可执行文件识别游戏 |
| **独立 / 破解** | `data/games-config.json → roots` 指定的盘符或目录，只在其**顶层**寻找含主 exe 的游戏目录；带排除词（资料/影视/音乐/备份/壁纸/教程/缓存等）与噪音 exe 过滤 | 支持非 Steam 安装的硬盘版 / 学习版 / 绿色版 |
| **Epic** | `C:\ProgramData\Epic\EpicGamesLauncher\Data\Manifests` | 仅**识别**（当前不做 Epic 启动编排） |
| **注册表兜底** | 卸载项中包含游戏关键词的条目（可关闭 `registryHints`） | 用于补充独立目录扫不到的游戏 |

扫描结果会做：主 exe 评分与选择（跳过 `unins*` / `setup` / `redist` / `crash` / `launcher` 等噪音）、按安装目录去重、按平台与中文名排序，然后写入 `data/games.json`。

## 2. 分类字段

| 字段 | 取值 | 默认规则（可覆盖） |
|---|---|---|
| `platform` | `steam` / `wegame` / `standalone` / `epic` / `unknown` | 由来源决定 |
| `region` | `domestic`（境内）/ `overseas`（境外）/ `unknown` | Steam、Epic 默认境外；WeGame 默认境内；独立目录默认未知 |
| `mode` | `online`（联机）/ `single`（单机）/ `cracked`（破解）/ `unknown` | Steam、WeGame 默认联机；独立目录默认破解；名称命中单机库（模拟/建造/单机大作）时改为单机 |
| `tags` | 字符串数组 | 自动补充 `accelerator-needed`（境外联机）、`steam-offline`（单机/破解）、平台标签等 |
| `id` | `steam-<appid>` / `wg-<appid>` / `dir-<hash>` 等 | 用于启动、覆盖与深链 |
| `name` / `nameZh` | 名称 | 已知游戏会补中文名，其余可用覆盖修正 |
| `installDir` / `exe` / `appid` / `sizeGB` | 安装信息 | 只读扫描得到 |

> 分类是**启发式**的，不保证 100% 正确。最可靠的做法是扫描后在游戏库里对个别游戏点「编辑分类」，通过 `POST /api/games/overrides` 写入 `data/games.json → overrides`；覆盖优先于自动规则。

## 3. 启动编排规则（launchGame）

```text
POST /api/games/launch {"id":"steam-1174180","accelerator":"auto","steamMode":"auto"}
  │
  ├─ 1) 加速器（accelerator：auto / on / off）
  │      境外 + 联机 → 需要：若雷神未运行则拉起 leigod_launcher.exe（已运行跳过）
  │      境内 / 单机 / 破解 / 未知 → 不需要
  │      找不到雷神安装目录 → 返回 accelerator.ok=false 与原因（不报错中断游戏启动）
  │
  ├─ 2) Steam 离线（steamMode：auto / offline / block / off）
  │      单机 / 破解 → 需要：精确结束 steam.exe / steamwebhelper.exe / SteamService.exe
  │                     然后「请求」防火墙断网（管理员辅助，见下）
  │      在线游戏 → 保持 Steam 联网
  │
  ├─ 3) 启动
  │      Steam 游戏 → steam://rungameid/<appid>（交给 Steam 客户端）
  │      WeGame 游戏 → WeGame 协议 / 客户端 / 直接 exe（按可用信息降级）
  │      独立游戏 → 直接启动主 exe（工作目录=游戏目录）
  │
  └─ 4) 返回 {ok, game, actions[], steamNetBlock, message, dryRun}
```

- **演练**：`dryRun: true` 只返回「计划做什么」，不真的启动 / 关闭任何东西，适合第一次验证。
- **如实返回**：某个环节失败（例如找不到加速器）只影响该环节，其余步骤继续；消息里会写明失败原因。
- **不误伤**：Steam 只按精确进程名结束；雷神只拉起、不关闭；DeepSeek Harness / 控制中心 / 系统进程永不触碰。

## 4. Steam 断网辅助脚本（管理员用）

单机 / 破解游戏希望 Steam 进入**离线模式**时，编排会请求断网，但 Windows 防火墙规则需要管理员权限：

- 服务**不会**静默提权，也不会伪造成功。非管理员时返回：
  ```json
  {"steamNetBlock":{"requested":true,"applied":false,"reason":"需要管理员权限","helper":"%SANWA_HOME%\\tools\\steam-net-off.ps1"}}
  ```
- 需要时手动以管理员身份运行（把 `%SANWA_HOME%` 换成仓库实际路径）：

```powershell
# 以管理员身份打开 PowerShell
powershell -NoProfile -ExecutionPolicy Bypass -File "%SANWA_HOME%\tools\steam-net-off.ps1"
```

- 恢复联网：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "%SANWA_HOME%\tools\steam-net-on.ps1"
```

- 规则名：`Sanwa-Steam-Block`（只 Block Steam 客户端进程的出站流量，不影响浏览器 / 其它程序）。
- 更多说明见 [`tools/README-steam-block.md`](../tools/README-steam-block.md)。

> 风险提示：断网期间 Steam 无法下载 / 更新 / 联机；关闭 Steam 前请保存进度；不用时务必恢复。是否使用该辅助功能由你自行决定并承担风险。

## 5. 自定义扫描范围

复制示例配置（首次安装通常由 `install.ps1` 自动生成）：

```powershell
Copy-Item .\data\games-config.example.json .\data\games-config.json
```

编辑 `data/games-config.json`：

```json
{
  "steamLibraries": [
    "D:\\SteamLibrary",
    "E:\\Games\\SteamLibrary"
  ],
  "weGameDirs": [
    "D:\\WeGameApps"
  ],
  "roots": [
    "D:\\Games",
    "E:\\Games",
    "F:\\"
  ],
  "registryHints": true
}
```

| 字段 | 说明 |
|---|---|
| `steamLibraries` | 额外的 Steam 库目录（会与 `libraryfolders.vdf` 自动发现的库合并） |
| `weGameDirs` | WeGame 游戏安装目录列表 |
| `roots` | 独立游戏扫描的根目录（只扫描其顶层含 exe 的目录） |
| `registryHints` | 是否用注册表卸载项兜底（默认 `true`；扫描慢可关） |

- 数组留空时：Steam 仅自动探测标准安装位置；独立游戏不扫描其它盘（**不会**全盘乱扫）。
- 修改配置后，在页面点「重新扫描」或 `POST /api/games/scan` 即可生效。
- 扫描是只读的；`data/games.json` 只是缓存，删除后重新扫描即可重建。

## 6. 常见问题（FAQ）

**Q1：某款游戏没被识别？**
先确认它在已配置的 `steamLibraries` / `weGameDirs` / `roots` 下；独立游戏需要目录内含主 exe。Steam 游戏请确认 `appmanifest_*.acf` 完整。可在 `roots` 里加上游戏所在盘符（如 `"F:\\"`）后重新扫描；仍不行时用 Issue 反馈（附**脱敏后**的目录结构，不要贴游戏库存全文）。

**Q2：识别到了但主 exe 不对 / 启动没反应？**
游戏目录里可能有 `launcher.exe`、`crashhandler.exe` 等干扰项。本项目会优先匹配已知主程序名并跳过噪音 exe，但无法覆盖所有游戏；可在 `data/games.json` 的 `overrides` 中修正，或直接给项目提 Issue 增加识别规则。

**Q3：为什么启动前要先关 Steam？**
单机 / 破解游戏若在 Steam 联网状态下启动，可能触发更新或校验导致启动失败；先关 Steam（必要时断网）再启动，能提高成功率。在线游戏则相反——保持 Steam 运行。

**Q4：雷神加速器没有被拉起？**
编排会检测常见安装路径下的 `leigod_launcher.exe`；若你装在其它位置，需要自行修改 `lib/games/index.js` 中的路径常量（或等待后续版本支持配置）。找不到时会返回原因，但游戏仍会尝试启动。

**Q5：断网脚本为什么没生效？**
它需要**管理员权限**，且由你手动运行。服务以普通用户运行时会在结果里如实标注 `applied:false`。按第 4 节操作后可在「高级安全 Windows Defender 防火墙 → 出站规则」看到 `Sanwa-Steam-Block`。

**Q6：扫描会启动游戏或 Steam 吗？**
不会。扫描只读文件系统与注册表；启动只在你点击游戏 / 确认启动时发生。

**Q7：`data/games.json` 能提交到 GitHub 吗？**
**不能**。它包含本机安装目录、游戏清单等隐私信息，`.gitignore` 已排除。公开截图或 Issue 时也不要粘贴。

**Q8：WeGame 游戏启动后要求重新登录？**
WeGame 部分游戏缺少 `game_id` 时只能打开客户端或直接启动 exe，可能无法自动完成登录态；这种情况请在 WeGame 客户端内启动一次。

**Q9：Epic / GOG / Xbox 游戏支持吗？**
当前版本：Epic 仅扫描识别，不做启动编排；GOG / Xbox 未专门支持。欢迎贡献扫描器（见 [CONTRIBUTING.md](CONTRIBUTING.md)）。
