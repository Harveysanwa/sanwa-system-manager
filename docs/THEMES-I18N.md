# 主题、多语言与自定义外观（Themes & i18n）

> 相关文件：`web/ui.template.html`（源模板）、`web/index.html`（构建产物）、`scripts/build-ui.js`（构建脚本）、`data/tools.json`（工具卡片与 i18n 简介）、`data/preferences.json`（背景偏好）、`data/backgrounds/`（上传的背景图）。
> 入口：页面右上角 **设置（⚙）**。

## 1. 三种主题

| 主题 | `data-theme` | 风格 | 适用 |
|---|---|---|---|
| 深色（默认） | `dark` | 深空蓝黑 + 青色 HUD 光效 | 夜间 / 游戏 / 长时间使用 |
| 浅色 | `light` | 白蓝渐变、深色文字、对比度单独校正 | 白天 / 办公 / 投影 |
| 动态绚丽 | `aurora` | 极光与星云渐变、缓慢呼吸动效 | 展示 / 直播 / 氛围 |

- 切换方式：设置 → 主题 → 深色 / 浅色 / 动态绚丽；
- 持久化：写入 `localStorage` 的 `sanwa.theme`，下次打开自动恢复；
- 实现：所有颜色集中在 CSS 自定义属性（`--theme-bg`、`--theme-text`、`--theme-panel` 等），根节点 `html[data-theme]` 切换；浅色主题对门禁、HUD、卡片、弹窗、游戏库、玄学面板逐项覆盖，保证可读性；
- 动效尊重系统设置：`prefers-reduced-motion: reduce` 时关闭极光动画与转场。

## 2. 自定义背景

设置 → 自定义背景：

| 能力 | 说明 |
|---|---|
| 上传图片 | PNG / JPG / WebP，≤ 8 MB；服务端校验 magic bytes 后保存到 `data/backgrounds/`（文件名=内容哈希） |
| 图片 URL | 填写 `https://…` 图片地址（也支持 `data:image/...` 粘贴） |
| 遮罩浓度 | 0–100 调节背景遮罩强度，保证文字可读 |
| 还原默认 | 删除背景文件与偏好，恢复默认背景 |
| 自适应 | `background-size: cover` + 半透明遮罩 / 毛玻璃，任意主题下按钮与文字保持可读 |

- 偏好保存在服务端 `data/preferences.json`（`background` 字段）并在前端 `localStorage` 的 `sanwa.background` 缓存，刷新后仍生效；
- `data/preferences.json` 与 `data/backgrounds/` 已在 `.gitignore` 中，不会提交；
- 背景图片不会上传到任何服务器，只存在你自己电脑的 `data/backgrounds/`。

## 3. 三语言（简体中文 / English / 日本語）

| 语言 | 代码 | `<html lang>` | 说明 |
|---|---|---|---|
| 简体中文 | `zh` | `zh-CN` | 默认语言 |
| English | `en` | `en` | 全界面英文 |
| 日本語 | `ja` | `ja` | 全界面日文 |

- 切换：设置 → 语言；持久化到 `localStorage` 的 `sanwa.lang`；
- 覆盖范围：页头 / 页脚 / 模式名与说明 / 面板标题 / 按钮 / HUD 标签 / 门禁与加载屏 / 游戏库 / 设置 / 玄学面板等静态文案；
- 工具卡片：始终显示「中文名 + 英文名」；简介按当前语言取 `data/tools.json → tools[].i18n.en/ja.description`，缺失时回退中文 `description`；
- 日期与数字：使用对应 locale 格式化（`zh-CN` / `en` / `ja`）；
- 实现：前端内置 `I18N` 字典（`I18N.zh / en / ja`），DOM 用 `data-i18n="key"` 标记，渲染时按 `t(key)` 取词，找不到时回退中文。

## 4. 新增一种语言

以新增 `ko`（한국어）为例：

1. **前端字典**：在 `web/ui.template.html` 的 `I18N` 对象中加入 `ko`，把 `zh` 的键完整翻译（可以先复制 `en` 再翻译）。键名必须与 `zh` 一致。
2. **语言按钮**：在设置面板的语言选项区（`#langOpts`）增加一个按钮：

```html
<button type="button" class="set-opt" data-lang-opt="ko">한국어</button>
```

3. **locale 映射**：在 `LANG_LOCALES` 中加 `ko: 'ko-KR'`。
4. **工具简介（可选）**：在 `data/tools.json` 的每个工具里加：

```json
"i18n": {
  "en": { "description": "Local LLM runtime" },
  "ja": { "description": "ローカル LLM ランタイム" },
  "ko": { "description": "로컬 LLM 런타임" }
}
```

5. **重新构建界面**：

```powershell
node .\scripts\build-ui.js
```

6. 刷新页面（`Ctrl+F5`）→ 设置 → 语言，验证：页头、模式、卡片、门禁、游戏库、玄学面板、弹窗中无残留中文；`document.documentElement.lang` 正确。
7. 在 `README` 的语言切换处补充新语言链接，并更新 `CHANGELOG.md`。

> 不想改代码？也可以直接把「新增一种语言」的提示词交给 AI（见 [AI-INTEGRATION.md](AI-INTEGRATION.md)）。

## 5. 新增 / 修改主题

1. 在 `web/ui.template.html` 中定义主题变量块，例如：

```css
html[data-theme="forest"] body {
  background: radial-gradient(80% 60% at 50% 0%, rgba(52,211,153,.10), transparent 60%), #04110c;
  color: #d1fae5;
}
html[data-theme="forest"] .panel,
html[data-theme="forest"] .hud,
html[data-theme="forest"] .card {
  background: rgba(6, 26, 20, .9);
  border-color: rgba(52, 211, 153, .18);
}
```

2. 加入主题白名单：`var THEMES = ['dark','light','aurora','forest'];`
3. 在设置面板加按钮：`<button type="button" class="set-opt" data-theme-opt="forest">森林</button>`
4. 为新增主题检查所有组件：门禁、加载屏、HUD、工具卡片、模式栏、弹窗、游戏库、玄学面板、日志弹窗、浅色/深色对比度。
5. 重新构建并刷新验证：三种主题 + 自定义背景组合下文字可读、无 Console 报错。
6. 更新本文档与 `CHANGELOG.md`。

> 主题色建议沿用现有命名（`--theme-bg`、`--theme-text`、`--theme-panel`、`--theme-line` 等），避免只写死某一处的颜色导致部分组件不适配。

## 6. 「以你命名一颗星」与生日外观

- 首次录入姓名 + 身份证后播放星空命名动画（星空 → 姓名升起 → 流星 → 带名字的星 → 银河）；
- 星名编号格式 `SANWA-XXXXXX`，星座与光谱色由前端生成；银河徽章常驻标题旁，可点击重播、查看星卡；
- 生日当天全屏礼花每天触发一次（`localStorage` 的 `sanwa.fireworks.date` 记录），可关闭；
- `prefers-reduced-motion: reduce` 时降级为静态银河，不播放动画；
- 身份证全程在浏览器端校验与脱敏，服务端只保存脱敏字段（见 [PRIVACY.md](PRIVACY.md)）。

## 7. 构建与发布注意事项

| 事项 | 说明 |
|---|---|
| 改模板而不是改产物 | 编辑 `web/ui.template.html`，然后运行 `node scripts/build-ui.js` 生成 `web/index.html`；直接改 `web/index.html` 会在下次构建时丢失 |
| 数据注入 | 构建脚本会把 `data/tools.json`（不存在时用 `data/tools.example.json`）的工具清单与元数据注入界面；发行版仓库必须用**脱敏后的配置**构建，避免把本机路径写进 HTML |
| 桌面单文件 | `install.ps1` 会把构建产物复制到桌面（`data/tools.json → hub.desktopHtml`）；服务启动时会同步桌面 HTML 与 `web/index.html` |
| 语言一致性 | 新增文案时三种语言同时补；缺键会回退中文，但会显得不专业 |
| 无外部资源 | 不要引入 CDN 字体 / 图标 / 脚本；图片请内联或放本地 assets，保持单文件离线可用 |

## 8. 无障碍（Accessibility）现状

- 主题对比度：浅色主题对正文与按钮做了单独校正；动态主题保留高对比描边。
- 动效：尊重 `prefers-reduced-motion`（星空动画、极光动画、转场）。
- 键盘：主要按钮为原生 `<button>`，可 Tab 聚焦；弹窗使用原生 `<dialog>`。
- 已知不足：HUD 仪表为装饰性信息，尚未全部加 `aria-label`；欢迎贡献改进（见 [CONTRIBUTING.md](CONTRIBUTING.md)）。
