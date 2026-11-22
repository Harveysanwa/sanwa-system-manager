# 第三方依赖与数据来源声明（THIRD_PARTY_NOTICES）

本模块（`%SANWA_HOME%\lib\fortune\`）为 AI 控制中心内部使用的娱乐性模块。
运行时代码全部以 vendored 文件形式包含在本目录内，不依赖 npm install、不依赖任何外部 CDN。

## 运行时依赖（vendored）

### 1. lunar-javascript 1.7.8
- 用途：农历、二十四节气、干支、黄历宜忌/神煞、八字四柱/纳音/十神
- 文件：`vendor/lunar.js`（未修改）
- 作者：6tail
- 仓库：https://github.com/6tail/lunar-javascript
- 许可证：MIT（见 `vendor/lunar-javascript.LICENSE`）

### 2. cnchar 3.2.6
- 用途：汉字笔画（缺字兜底查询，姓名五格）
- 文件：`vendor/cnchar.min.js`（未修改）
- 作者：theajack
- 仓库：https://github.com/theajack/cnchar
- 许可证：MIT（见 `vendor/cnchar.LICENSE`）

### 3. cnchar-info 3.2.6
- 用途：汉字字五行（缺字兜底查询）
- 文件：`vendor/cnchar.info.min.js`（未修改）
- 作者：theajack
- 仓库：https://github.com/theajack/cnchar
- 许可证：MIT（见 `vendor/cnchar.LICENSE`）

## 数据来源

### 4. 六十四卦经传文本（卦辞/彖辞/象辞/爻辞）
- 来源：《周易》通行本，属公有领域（public domain）古籍文本
- 构建期取自 npm 包 `taoism-sdk@1.0.11` 的 `dist/data/gua64.json`（MIT，见 `vendor/taoism-sdk.LICENSE`）
- 成品：`data/lots.json`

### 5. 六十四卦白话卦意（一句话解读）
- 来源：npm 包 `dsh-xuanji@0.4.2` 的 `lib/engine/hexagrams.js`（作者 huangshengju，MIT，见 `vendor/dsh-xuanji.LICENSE`）
- 成品：`data/lots.json` 中 `plain` 字段

### 6. 汉字笔画 / 五行表（构建期提炼）
- 构建工具：cnchar 3.2.6 + cnchar-info 3.2.6（MIT）
- 构建方式：枚举 GB2312 全部 6763 个汉字 + cnchar 笔画字典，逐字查询笔画与五行，输出 `%SANWA_HOME%\data\fortune\strokes.json`（9509 字）
- 成品仅含「字符 → [笔画数, 五行]」的事实性数据，不含第三方代码

### 7. 其余白话内容
- 64 卦的事业/财运/感情/建议、姓名三才评语、模块代码与自测脚本：本模块原创，仅供娱乐

## 天气数据来源（运行时 API，不包含第三方代码）

| 来源 | 用途 | 说明 |
|---|---|---|
| https://wttr.in | 当前实时 + 3 日预报 + 自动定位经纬度 | 数据源自 World Weather Online；免费接口 |
| http://api.open-meteo.com | 未来 7 天预报（WMO 天气码） | 数据由 Open-Meteo.com 提供，采用 CC BY 4.0 许可，接口供非商业免费使用；本机按任务要求使用 HTTP |
| http://www.weather.com.cn | 7 天预报 HTML 兜底 | 中国天气网；仅当 Open-Meteo 不可用时尝试（需城市 code） |

以上数据仅作生活参考，不用于商业再分发；模块内所有天气结论均标注「仅供生活参考/仅供娱乐」。

## 依赖获取方式（构建期，非运行时）

```powershell
npm pack lunar-javascript --registry=https://registry.npmmirror.com
npm pack cnchar --registry=https://registry.npmmirror.com
npm pack cnchar-info --registry=https://registry.npmmirror.com
```

解包后仅保留 `lunar.js` / `cnchar.min.js` / `cnchar.info.min.js` 三个文件到 `vendor/`；
运行期 `require()` 相对路径加载，不需要 node_modules，不需要重新安装。

## MIT License 全文（适用于上述 MIT 许可包）

```
MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### 5. 姓名笔画数据（cnchar / cnchar-info 派生）
- 用途：姓名五格、笔画查询
- 成品：`lib/fortune/data/strokes.json`（GB2312 常用字 + 实际收录 9500+ 字）
- 来源：基于 cnchar 3.2.6 / cnchar-info 3.2.6 的字库提炼（MIT，见 `vendor/cnchar.LICENSE`）
- 说明：静态数据，不含任何个人信息；缺字时回退 cnchar 运行时查询
