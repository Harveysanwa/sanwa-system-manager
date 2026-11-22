# Pull Request

<!--
感谢贡献！提交前请确认：
1. 已阅读 docs/CONTRIBUTING.md 与 docs/PRIVACY.md；
2. 代码改动不包含任何个人数据、真实路径、机器名、城市、身份证或截图；
3. 行为变更已同步更新文档（README / docs / CHANGELOG）；
4. 没有提交 data/ 运行时数据、logs/、tmp/、node_modules/。
-->

## 变更说明（What & Why）

<!-- 这个 PR 解决了什么问题？关联 Issue：Closes #... -->

## 变更类型（Type）

- [ ] 修复 Bug（fix）
- [ ] 新功能（feat）
- [ ] 工具卡片 / 配置示例（tools）
- [ ] 文档 / 提示词（docs）
- [ ] 主题 / 多语言 / UI（ui）
- [ ] 重构 / 性能（refactor / perf）
- [ ] 其他（chore / ci）

## 影响范围（Scope）

- [ ] `server.js`（本地 API）
- [ ] `lib/modes.js`（模式引擎）
- [ ] `lib/games/`（游戏库与启动编排）
- [ ] `lib/fortune/`（天气 / 黄历 / 抽签 / 八字 / 姓名）
- [ ] `scripts/`（启动 / 停止 / 自启 / 构建 UI 脚本）
- [ ] `web/` 或 UI 模板
- [ ] `data/*.example`（示例配置）
- [ ] 文档（README / docs / CHANGELOG / ROADMAP）
- [ ] `.github/`

## 测试与验证（Testing）

请写明你实际执行过的验证，没有执行的项目请如实标注「未测试」：

- [ ] 本机 `node server.js` 启动成功，`GET /api/meta` 返回 200
- [ ] `GET /api/ping` / `GET /api/version` 正常
- [ ] 相关页面在新浏览器中无 Console 报错
- [ ] 若改动界面：在 1920×1080 与 1200 宽度下检查布局
- [ ] 若改动多语言：中文 / English / 日本語 均检查
- [ ] 若改动模式：正常→目标模式→正常往返切换成功
- [ ] 若改动游戏库：只运行扫描（不启动游戏）验证数据
- [ ] 其他：

验证环境：

- Windows 版本：
- Node.js 版本（`node -v`）：
- 浏览器：

## 安全与隐私自查（Safety & Privacy）

- [ ] 仓库内**没有**新增真实用户名、计算机名、城市、身份证、邮箱、手机号、游戏库存截图
- [ ] 新增路径均为占位符（如 `%USERPROFILE%`、`%SANWA_HOME%`）或可配置项
- [ ] 未新增遥测 / 上报 / 云端接口（天气等既有外联除外）
- [ ] 未放宽「仅监听 127.0.0.1」与工具白名单启动等安全边界
- [ ] 未新增 `taskkill /IM` 类全域杀进程逻辑；进程保护名单仍有效
- [ ] 如涉及管理员脚本，已注明「需用户手动以管理员身份运行」，不在服务中静默提权
- [ ] 已运行 `check-privacy.ps1` 并通过（维护者可要求提供输出）

## 文档（Docs）

- [ ] 已更新受影响的 README / docs 页面
- [ ] 已在 `CHANGELOG.md` 的 `Unreleased` 或对应版本下记录
- [ ] 新增功能已补充到 `docs/API.md`（如涉及接口）

## 许可证（License）

- [ ] 我同意本 PR 以 MIT License 授权，并保留版权声明 © 驼学长
- [ ] PR 中的代码 / 文本为本人原创，或已注明来源与兼容许可证

## 其他说明（Notes for reviewers）
