# 常见问题（FAQ）

> 先看这里，90% 的问题都有答案。更多细节见 [QUICKSTART.md](QUICKSTART.md)、[MODES.md](MODES.md)、[GAMES.md](GAMES.md)、[FORTUNE.md](FORTUNE.md)、[PRIVACY.md](PRIVACY.md)、[API.md](API.md)。

## 安装与启动

**Q1：需要什么环境？**
Windows 10 / 11（x64），Node.js **22 或更高**，约 10 MB 磁盘空间（不含你自己的 AI 程序与游戏）。不需要 Python、不需要 npm install、不需要数据库、不需要联网安装依赖。

**Q2：怎么安装？**
下载仓库 → 解压到任意目录（建议不含中文/空格的路径，例如 `%USERPROFILE%\sanwa-system-manager`）→ 在该目录运行 `install.ps1` → 双击 `start-sanwa.cmd`（或 `node server.js`）→ 浏览器打开 `http://127.0.0.1:9900`。完整步骤见 [QUICKSTART.md](QUICKSTART.md)。

**Q3：双击 `start-sanwa.cmd` 窗口闪一下就没了？**
通常是 Node.js 没装或不在 PATH。打开 PowerShell 执行 `node -v`：如果报「不是内部或外部命令」，请先安装 Node.js 22+（安装时勾选 Add to PATH），再重试；也可在 `start-sanwa.cmd` 上右键 →「编辑」查看它调用的命令手动执行，把报错发到 Issue。

**Q4：端口 9900 被占用怎么办？**
查看占用进程：

```powershell
Get-NetTCPConnection -LocalPort 9900 -State Listen | Select-Object OwningProcess
# 或
netstat -ano | findstr :9900
```

可以结束占用进程，或给控制中心换端口：设置环境变量 `SANWA_PORT=9901` 后重启服务（同时要以新端口访问页面）。详见 [QUICKSTART.md](QUICKSTART.md) 的端口修改。

**Q5：可以开机自启吗？**
可以，但**只启动控制中心这个轻量服务**（127.0.0.1:9900），不会启动任何 AI 工具。安装时加 `-Autostart` 参数（`install.ps1 -Autostart`）即可创建登录自启快捷方式，也可以在页面「设置 / 按需启动」里一键开关；手动管理用 `install-autostart.ps1`（`-Remove` 关闭）。卸载/关闭方法见 [QUICKSTART.md](QUICKSTART.md)。

**Q6：支持 Windows 7 / macOS / Linux 吗？**
不支持。大量功能依赖 Windows 原生能力（`tasklist`、`reg`、URI 协议、防火墙、开始菜单快捷方式等）。在其它系统上最多只能运行部分页面，不保证可用。

## 界面与使用

**Q7：第一次打开要求填姓名 + 身份证，安全吗？可以不填吗？**
这是本机的「生日门禁 / 生日倒计时 / 以你命名一颗星」功能。身份证**只在浏览器端校验并脱敏**，服务端只保存姓名、生日、脱敏后的号码（如 `1101**********1234`），完整号码不落盘、不写日志、不上传；也可直接跳过或稍后填写。详见 [PRIVACY.md](PRIVACY.md)。

**Q8：怎么删除我填写的生日/身份信息？**
关闭服务 → 删除 `data/profile.json` → 重新打开页面即可恢复首次门禁。背景图删除 `data/backgrounds/`，天气城市删除 `data/fortune/preferences.json`，全部运行数据直接删除 `data/` 与 `logs/` 即可（不影响程序本身）。

**Q9：模式按钮点不动 / 切换很慢？**
- 同一时间只允许一个模式 / 游戏模式 / 全部停止操作（互斥锁），等当前操作完成；
- AI 模式会等待每个 AI 服务健康检查通过，模型加载慢时可能 30–120 秒，属正常；
- 失败项会列在结果里并带原因；可查看 `logs/modes.log`。

**Q10：为什么「全部停止」之后还有程序在跑？**
只停止 `data/tools.json` 清单内、且能被识别到的进程；清单外程序、以管理员/服务方式运行的程序可能关不掉（会出现在 `failed` 列表）。保护名单（DeepSeek Harness、控制中心、系统进程、Steam、雷神）永远不会被关闭。

**Q11：界面元素错位 / 字体模糊？**
请使用较新的 Edge / Chrome，并在 100% 缩放、1920×1080 或 3440×1440 下查看；若使用浏览器缩放或系统缩放非 100%，可能出现个别像素级错位，可反馈截图（注意脱敏）。

**Q12：三种语言和主题在哪里切换？**
右上角「设置（⚙）」→ 主题（深色 / 浅色 / 动态绚丽）、语言（中文 / English / 日本語）、自定义背景（上传 / URL / 遮罩浓度 / 还原）。

**Q13：可以用手机/另一台电脑打开吗？**
默认不可以，服务只监听 `127.0.0.1`。**不建议**改成局域网或公网访问——本项目没有登录鉴权，暴露后任何人都能控制你的本机程序。如确有需要，请自行加 VPN / 带鉴权的反向代理，并自行承担风险。

## 功能与配置

**Q14：怎么添加我自己的工具？**
编辑 `data/tools.json`，按现有卡片格式增加一项，并创建对应的 `scripts/<id>.ps1`（负责启动/停止/写日志），然后刷新页面。详细模板与字段说明见 [CONTRIBUTING.md](CONTRIBUTING.md) 与 [ARCHITECTURE.md](ARCHITECTURE.md)。

**Q15：为什么有的卡片是灰的 / 提示「当前不可一键启动」？**
卡片会检查配置的路径 / 脚本 / URL 是否存在。先在 `data/tools.json` 里把 `launch.exe`、`launch.url`、`launch.script` 或 `paths` 改成你本机的真实路径（示例配置里是占位符）。

**Q16：AI 工具太多了，能不能只启动我选的？**
可以。AI 模式支持多选启动；日常也可以用「按需启动」：开机不启动任何 AI 工具，点哪张卡片启动哪个。另有「全部停止」一键清场。

**Q17：游戏库扫不到我的游戏？**
检查 `data/games-config.json` 的 `steamLibraries` / `weGameDirs` / `roots` 是否包含你的安装位置；Steam 游戏需要 `appmanifest_*.acf`；独立游戏需要目录顶层含主 exe。修改后点「重新扫描」。详见 [GAMES.md](GAMES.md)。

**Q18：游戏启动前会不会自动开加速器、关 Steam？**
按分类自动编排：境外联机游戏会尝试拉起雷神加速器；单机 / 破解游戏会先关闭 Steam，并「请求」防火墙断网（需要管理员辅助脚本，见 [GAMES.md](GAMES.md)）。分类可以在游戏库中手动覆盖。

**Q19：Steam 断网脚本安全吗？怎么恢复？**
它只创建针对 Steam 客户端进程的 Windows 防火墙出站规则 `Sanwa-Steam-Block`，需要你手动以管理员身份运行；恢复用 `tools/steam-net-on.ps1`。断网期间 Steam 无法下载/更新/联机，请按需使用。详见 [GAMES.md](GAMES.md)。

**Q20：天气显示不出来 / 城市不对？**
天气是唯一外联功能，需要能访问 `wttr.in` / `api.open-meteo.com`（或中国天气网兜底）。城市不对时在 `data/fortune/preferences.json` 手动填写 `city`（留空则按出口 IP 自动定位，可能不准）。断网时天气面板降级，其它功能不受影响。详见 [FORTUNE.md](FORTUNE.md)。

**Q21：黄历 / 八字 / 姓名 / 抽签准吗？**
所有结果**仅供娱乐**。黄历来自传统规则库，不同通书流派会有差异；八字未做真太阳时校正；姓名采用简体笔画而非康熙字典笔画；抽签是纯随机。详见 [FORTUNE.md](FORTUNE.md)。

## 安全与隐私

**Q22：这个项目会上传我的数据吗？**
不会。没有账号、没有遥测、没有统计上报；除天气查询（只带城市/坐标）外，所有数据都在本机。详见 [PRIVACY.md](PRIVACY.md)。

**Q23：仓库里为什么没有截图？**
为了避免泄露个人信息，README 只使用**手绘 SVG 横幅**与 ASCII 架构图，不放真实界面截图；如果你要展示，请自行截图并确认没有暴露路径、账号、游戏库存等信息。

**Q24：为什么不用 npm 依赖 / 不用 CDN？**
减少供应链风险与安装门槛：后端只用 Node 标准库，前端单文件、无外部资源；农历/汉字库以 vendored 文件随仓库分发（MIT，见 `THIRD_PARTY_NOTICES.md`）。代价是部分能力依赖 Windows 系统命令。

**Q25：安全软件（火绒 / Windows Defender）拦截怎么办？**
项目会执行 PowerShell 启动脚本，部分安全软件会拦截（AMSI / 脚本防护）。可把 `scripts\` 目录加入信任区；模式切换有 Node 原生兜底，不依赖 PowerShell。不要为了运行本项目而关闭杀毒软件。

## 排错与维护

**Q26：日志在哪里？**
`logs/hub.log`（服务）、`logs/modes.log`（模式）、`logs/game-mode.log`（游戏模式）、`logs/<工具id>.log`（各工具启动脚本）。向 Issue 粘贴前请**脱敏**（删除用户名、路径、机器名、城市等）。

**Q27：怎么更新？**
备份 `data/` 与你自己写的 `scripts/*.ps1` → 用新版本覆盖程序文件（保留 `data/`）→ 运行 `install.ps1` 检查配置 → 重启服务。若跨越多个大版本，先读 `CHANGELOG.md`。仓库若使用 git 管理，可 `git pull`。

**Q28：怎么卸载？**
关闭服务 → 运行 `uninstall.ps1`（如提供）删除自启快捷方式 → 删除整个安装目录。你的 AI 工具、游戏、模型文件不会被删除；防火墙规则如已启用，请用 `tools/steam-net-on.ps1` 清理。

**Q29：服务启动后页面空白 / 显示「界面文件尚未生成」？**
先运行 `node scripts/build-ui.js` 重建界面，再重启服务；或直接使用仓库自带的 `web/index.html`。若仍空白，打开浏览器 DevTools 看 Console 报错。

**Q30：为什么模式切换 / 停止工具失败？**
常见原因：进程以管理员启动（普通权限杀不掉）、安全软件拦截、进程名与配置不符、端口被别家程序占用。查看 `logs/modes.log` 与页面失败清单的原因；必要时以管理员身份运行控制中心（注意：这会扩大权限，请自行评估）。

## 贡献与二次创作

**Q31：我可以 Fork / 二次创作 / 商用吗？**
可以。项目是 MIT License，版权 © 驼学长。欢迎 Fork、改主题、加工具、做更好的版本；请保留版权声明与许可证，并注明来源。详见 [CONTRIBUTING.md](CONTRIBUTING.md) 与 `LICENSE`。

**Q32：可以用 AI 帮我改这个项目吗？**
非常欢迎，本项目就是为 AI 友好而设计的。`docs/AI-INTEGRATION.md` 提供了 DeepSeek / 通义千问 / 豆包 / Codex / Claude / Hermes / Hermes One 等可直接复制的提示词。AI 生成的代码请自行验证后再提 PR。

**Q33：提 Issue / PR 有什么要求？**
使用 `.github/ISSUE_TEMPLATE` 模板；不要包含个人隐私；PR 需通过 `check-privacy.ps1`、说明验证方式，并更新文档/CHANGELOG。详见 [CONTRIBUTING.md](CONTRIBUTING.md)。
