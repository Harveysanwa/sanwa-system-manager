# 发布到 GitHub 指南（维护者用）

> 当前机器状态（2026-11-22）：已安装 `git 2.56`；**未安装/未登录 `gh` CLI**；本机直连 `github.com` 的 git HTTPS 被重置（`api.github.com` 可访问）。因此提供三种上传方式，选任一即可。

## 一、发布前检查（必须）

1. 确认仓库内**没有**任何个人数据：
   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File .\check-privacy.ps1
   ```
   看到 `PASS - 0 hits` 才可发布。
2. 确认 `.gitignore` 已排除运行时数据（`data/tools.json`、`data/profile.json`、`data/backgrounds/`、`logs/`、`tmp/` 等）。
3. 如你修改了示例配置，确保所有路径均为占位符（`%USERPROFILE%`、`%SANWA_AI_ROOT%` 等），不含真实用户名/城市/游戏库存。
4. 阅读 `docs/PRIVACY.md`，确认与你的实际发布内容一致。

## 二、方式 A：GitHub 网页上传（推荐，无需 git/网络代理）

1. 打开 <https://github.com/new>，创建仓库 `sanwa-system-manager`（Public；不要勾选 README/License 模板，本项目已自带）。
2. 解压 `Sanwa-System-Manager-v1.5.0-public.zip`（或直接使用本目录）。
3. 在仓库页点击 **uploading an existing file**，把**目录内的所有文件**拖进去（不要拖外层文件夹；`.github` 隐藏目录也要包含）。
4. 提交说明建议：`release: Sanwa System Manager v1.5.0 (sanitized public release)`。
5. 仓库 **About** 填写：
   - Description: `为GTA6到来扫清一切障碍 · Windows AI+游戏+办公 本地管理`
   - Website: 留空或你的介绍页
   - Topics: `windows`, `ai`, `gaming`, `gta6`, `ollama`, `lm-studio`, `comfyui`, `system-manager`, `local-first`, `privacy`, `nodejs`
6. 创建 Release：`v1.5.0`，上传同一个 ZIP，附解压密码说明（无）。

## 三、方式 B：GitHub Desktop（图形化，自动处理 git）

1. 安装 GitHub Desktop 并登录。
2. `File → Add local repository`，选择本目录（本目录已包含 `.git` 与首个提交，会自动识别）。
3. 提交全部文件（确认 `.gitignore` 生效），点击 **Publish repository**，取消勾选 “Keep this code private”。
4. 按方式 A 的 About/Topics/Release 补充。

## 四、方式 C：命令行 git（需要能访问 github.com 的网络/代理）

> 本目录**已初始化 git 并完成首个提交**（作者：驼学长 <sanwa@users.noreply.github.com>，分支 `main`）。
> 无需再 `git init` / `git add` / `git commit`；在 GitHub 网页创建**空仓库**后，添加远程并 push 即可。

```powershell
cd "<本目录>"
git log --oneline -1        # 应看到 release: Sanwa System Manager v1.5.0
# 先在 GitHub 网页创建空仓库（不要勾选 README/License），再执行：
git remote add origin https://github.com/<your-account>/sanwa-system-manager.git
git push -u origin main
```

如需重建提交历史（例如更换作者邮箱）：

```powershell
git config user.name "你的名字"
git config user.email "你的 noreply 邮箱"
git add -A
git commit -m "release: Sanwa System Manager v1.5.0 (sanitized public release)"
```
若 `git push` 报 `Connection was reset`，可尝试：
```powershell
# 例：本机代理 127.0.0.1:7897（按你的代理端口修改）
git config --global http.proxy http://127.0.0.1:7897
git config --global https.proxy http://127.0.0.1:7897
# 或改用 SSH 远程地址（在 GitHub 仓库页 Code → SSH 中复制，替换 origin）
```

## 五、发布后的推荐操作

- 在 README 顶部补充仓库徽章/Star 引导（已预留）。
- 置顶 Issue：`Welcome! 欢迎二创/Fork，做出更好的版本`。
- 发布 Release `v1.5.0`，附 `Sanwa-System-Manager-v1.5.0-public.zip` 与校验值。
- 宣传文案（可直接复制）：
  > 为 GTA6 到来扫清一切障碍：Windows 上 AI + 游戏 + 办公的本地管理器。5 种模式一键切换、AI 按需启动、游戏库自动识别、资源 HUD、7 日天气/黄历、三主题三语言，纯本地无遥测。DeepSeek / 千问 / 豆包 / Codex / Claude / Hermes / Hermes One 都能读懂并帮你部署改造。
- 强调隐私：仓库已脱敏；用户身份证只在本机脱敏存储，任何数据不上传。
- 欢迎二创：保留 MIT 版权声明（© 驼学长）并注明来源链接。

## 六、版本与后续

- 当前版本：`1.5.0`（见 `package.json` / `CHANGELOG.md`）。
- 更新发布：修改代码后执行 `git add -A && git commit -m "..." && git tag v1.5.1 && git push --tags`，再在网页创建 Release。
- 若修改了文档中的推广语，三种语言 README 需同步更新。
