---
name: Bug 报告（Bug report）
about: 报告可复现的问题，帮助 Sanwa 系统管理器变得更稳定
title: "[Bug] "
labels: bug
assignees: ""
---

<!--
感谢反馈！提交前请先：
1. 搜索已有 Issue，避免重复；
2. 确认使用的是最新版本（README / CHANGELOG 中的版本号）；
3. 阅读 docs/FAQ.md 与 docs/QUICKSTART.md。
⚠️ 请勿粘贴姓名、完整身份证号、真实用户名路径、机器名、城市、账号等隐私信息；日志请先脱敏。
-->

## 环境（Environment）

- Sanwa 版本：`v1.5.x`（页脚 / `GET /api/meta` 中可见）
- Windows 版本：Windows 10 / Windows 11（具体版本号，如 23H2）
- Node.js 版本：`node -v` 的结果（要求 ≥ 22）
- 浏览器：Edge / Chrome 版本
- 启动方式：`start-sanwa.cmd` / 手动 `node server.js` / 开机自启
- 是否管理员运行：是 / 否
- 安全软件：火绒 / Windows Defender / 其他（如有）

## 问题描述（What happened）

<!-- 一句话说明发生了什么 -->

## 复现步骤（Steps to reproduce）

1.
2.
3.

## 期望行为（Expected）

## 实际行为（Actual）

## 日志 / 报错（Logs）

<!--
将以下文件的最后 30–80 行粘贴到代码块中（先脱敏）：
- logs\hub.log
- logs\<工具id>.log
- 浏览器 DevTools → Console 的报错
并注明大致发生时间。没有日志可写「无」。
-->

```text
（粘贴脱敏后的日志）
```

## 截图 / 录屏（可选）

<!-- 请避免截到桌面文件、账号、身份证等信息；也可以只描述界面异常。 -->

## 已尝试的排查（Tried）

- [ ] 重启控制中心 / 重启电脑
- [ ] 重新运行 `install.ps1`
- [ ] 检查 `data/tools.json` 中对应工具的路径
- [ ] 查看 docs/FAQ.md 对应条目

## 其他补充（Additional context）
