# 玄学与天气引擎（fortune-engine）

纯 Node.js（CommonJS）模块，运行时零依赖安装，供 AI 控制中心接入天气、黄历、抽签、八字、姓名五项功能。
**所有结果仅用于娱乐，不构成任何决策/医疗/投资建议。**

- 模块入口：`%SANWA_HOME%\lib\fortune\index.js`
- 配置/缓存数据：`%SANWA_HOME%\data\fortune\`
- 自测脚本：`%SANWA_HOME%\lib\fortune\selftest.js`
- 样例输出：`%SANWA_HOME%\lib\fortune\samples.json`

## 快速使用

```js
const fortune = require('<SANWA_HOME>/lib/fortune'); // 或 require('<SANWA_HOME>\\lib\\fortune\\index.js')

const weather = await fortune.getWeather();                        // 自动定位
const weather2 = await fortune.getWeather({ city: '北京' });        // 指定城市
const almanac = await fortune.getAlmanac();                        // 今天
const almanac2 = await fortune.getAlmanac('2026-11-22');
const lot = await fortune.drawLot();                               // 三枚铜钱摇卦
const bazi = await fortune.getBazi({ birth: '1990-01-01 08:00', gender: 'male' });
const name = await fortune.analyzeName({ surname: '王', given: '小明' });
```

约定：所有函数均为 **async，永不抛异常**，失败返回 `{ ok:false, error:'原因' }`。
成功返回均带 `ok:true` 与 `note:'仅供娱乐'`（天气为 `note:'天气数据来自 wttr.in，仅供生活参考'`）。

## 5 个 API

### 1. getWeather(opts?) → 天气（v2：实时 + 3 日 + 7 日 + 趋势）

| 参数 | 类型 | 说明 |
|---|---|---|
| `opts.city` | string | 城市名（中英文均可，如 `北京` / `Beijing`）；空则自动定位 |
| `opts.autoLocate` | boolean | 是否允许自动定位（默认取 preferences.json） |
| `opts.forceRefresh` | boolean | 忽略缓存强制刷新 |
| `opts.timeoutMs` | number | 单次请求超时，默认 8000ms |
| `opts.cityCode` | string | 可选，中国天气网城市 code（如北京 `101260101`），用于 HTML 兜底 |
| `opts.latitude` / `opts.longitude` | number | 可选，wttr.in 不可用时 Open-Meteo 仅预报降级所需坐标 |
| `opts._forceWttrFail` / `_forceOpenMeteoFail` / `_forceHtmlFail` | boolean | **仅自测调试用**，强制某数据源失败以验证兜底链路 |
| 也可直接传字符串 | string | `getWeather('北京')` 等价于 `{city:'北京'}` |

- **数据源（v2）**：
  1. `https://wttr.in/<city>?format=j1&lang=zh`（Node 原生 https，超时 8s，失败重试 1 次）→ `current` 实时 + `forecast` 3 日中文描述 + `coord` 自动定位经纬度；
  2. `http://api.open-meteo.com/v1/forecast?...`（**HTTP**；本机实测 HTTPS 超时）→ `forecast7` 未来 7 天（WMO 天气码）；
  3. 兜底 A：`http://www.weather.com.cn/weather/<code>.shtml` 7 天 HTML（自动跟随 301 到 https，编码自动识别 utf-8/gbk，正则解析 7 个 `<li class="sky skyid">`）；
  4. 兜底 B：用 wttr.in 3 日数据构造 `forecast7`（标记 `forecast7Fallback:true`）。
- 缓存：`data\fortune\weather-cache.json`，TTL 10 分钟；接口失败且存在**同一城市**的旧缓存时返回 `stale:true`；兜底质量缓存超过 1 分钟后会静默尝试刷新主源
- 城市配置：`data\fortune\preferences.json` → `{"weather":{"city":"","autoLocate":true}}`（可额外可选字段：`cityCode`、`latitude`、`longitude`）
- 关键字段：
  - 兼容 v1：`{ok, city, area, country, resolvedCity, updatedAt, current:{tempC,feelsLikeC,desc,humidity,windKmh,windDir,pressure,visibilityKm,cloudCover,uvIndex,...}, forecast:[{date,minC,maxC,desc,chanceOfRain,...}]×3, source:'wttr.in', stale, cached}`
  - v2 新增：`coord:{lat,lon}`、`forecast7:[{date, weekdayCN, weekday, code, desc, descEn, maxC, minC, precipMM, precipProb, windKmh, isRain, isSnow, isSunny}]`、
    `forecast7Source:'open-meteo'|'www.weather.com.cn'|'wttr.in(3日)'`、`forecast7Fallback:boolean`、`forecast7CodeType:'WMO'|'WWO'|'CN-HTML'`、
    `trend:{summary, changes:[{date,type:'升温'|'降温',deltaC}], rainyDays:[date], sunnyDays:[date], snowDays:[date], alerts:[string]}`
- `desc` 内置 WWO 天气代码（当前/3 日）与 **WMO 天气码**（7 日）→ 中文描述映射，保留 `descEn` 英文原文
- 趋势规则：相邻日最高温差 ≥3°C 记为升温/降温（`changes`）；连续 ≥2 天晴/雨/雪写入摘要（如「未来7天以阴雨为主，周日至周三有雨，周四起升温6.9°C。」）；极寒/高温/明显降雨/降雪/大风写入 `alerts`
- 降级链：Open-Meteo 失败 → 中国天气网 7 天 → wttr 3 日；wttr 失败 → 同城市旧缓存 stale → 仅 7 日预报（`degraded:true, current:null`）→ `ok:false`

### 2. getAlmanac(dateStr?) → 黄历

- `dateStr`：`'YYYY-MM-DD'`（也宽松接受 `YYYY/M/D`、`YYYY.M.D`），缺省今天（本机时区）
- 返回：`{ok, date, solar:{y,m,d,weekday,weekCN,weekInYear,...}, lunar:{year,month,day,isLeap,monthCN,dayCN,fullCN,...}, ganzhi:{year,yearBySpring,month,day}, zodiac, zodiacBySpring, zodiacByLiChun, solarTerm, nextSolarTerm:{name,date,datetime}, prevSolarTerm, huangdao, dayGod, dayGodType, dayGodLuck, zhixing, yi[], ji[], chong, sha, chongZodiac, chongGanzhi, shaDirection, jishen[], xiongsha[], pengzu:{gan,zhi}, xiu, yueXiang, nineStar, festivals[], note:'仅供娱乐'}`
- 宜忌、建除十二神、黄道黑道十二神、吉神凶煞、彭祖百忌、节日均来自 `lunar-javascript` 的传统规则实现
- **口径**：干支年月按「年以立春当日换年、月以节气当日换月」（通书口径），日按公历日；`zodiac` 同为立春口径，另给 `zodiacBySpring`（春节口径）。八字四柱请用 `getBazi`（按节气精确时刻）

### 3. drawLot(opts?) → 抽签（64 卦 · 三枚铜钱摇卦）

- 随机方式：每爻投 3 枚铜钱（背=3、字=2），自下而上摇 6 爻得本卦；出现老阴(6)/老阳(9)为动爻，阴阳互变得变卦
- 返回：`{ok, at, method:'三枚铜钱摇卦', number, name, fullName, symbol, upper, lower, lines:[6 个 6/7/8/9], coinTosses, cast:[{position,coins,value,type,lineName,moving,yaoCi}], movingLines:[1-6], changed:null|{number,name,fullName,symbol,upper,lower,judgement,guaCi,plain,advice}, changedDetail, judgement:{level,score}, guaCi, xiang:{da,xiao}, tuan, yaoCi[], poem, interpretation, plain, career, wealth, love, advice, note:'仅供娱乐'}`
- 64 卦数据：卦序/卦名/全名/上下卦/卦辞/彖辞/象辞（大象+小象）/爻辞/白话卦意/事业/财运/感情/建议；文本见 `lib\fortune\data\lots.json`
- `judgement.level` ∈ `大吉|吉|中吉|小吉|平|凶`，`score` 1-100（娱乐性评分）

### 4. getBazi({birth, gender}) → 八字

| 参数 | 类型 | 说明 |
|---|---|---|
| `birth` | string / Date | `'YYYY-MM-DD HH:mm'`（兼容 `YYYY-MM-DD HH:mm:ss`、纯日期按 12:00 午时估算） |
| `gender` | string | `'male'` / `'female'`（兼容 男/女、m/f）；缺省按 male 并在 `genderInferred:true` 标注 |
| `sect` | number | 可选 1/2：晚子时流派（默认 2 = 晚子时日柱算当天、时柱按次日子时；传 1 = 晚子时日柱算次日） |

- 返回：`{ok, birth, gender, lunar, pillars:[{label,ganzhi,gan,ganWuxing,zhi,zhiWuxing,hideGan[],shiShenGan,shiShenZhi[],naYin,diShi,xunKong}×4], fourPillars[], wuxing:{jin,mu,shui,huo,tu}, wuxingText, missing[], nayin[], dayMaster, dayMasterDetail, zodiac, yun:{startAge,startDate,...}, taiYuan, mingGong, shenGong, xunKong, summary, timeNote, note:'仅供娱乐'}`
- 五行统计：4 天干 + 4 地支（地支按本气五行），`missing` 为个数为 0 的五行
- 日主简评：按同类/异类力量给出 `偏强/中和/偏弱` 与喜用倾向（简化口径）
- **时辰校正说明**：按北京时间（东八区）计算，**未做真太阳时（经度时差/均时差）校正**；`timeNote` 字段已标注

### 5. analyzeName({surname, given}) → 姓名

- `surname`：1-2 个汉字（单姓/复姓）；`given`：1-3 个汉字
- 返回：`{ok, surname, given, fullName, chars:[{char,stroke,wuxing,position,index}], strokes[], totalStrokes, wuge:{tian,ren,di,wai,zong}, wugeWuxing, shuli:{...}, sancai:{tian,ren,di,config,luck,desc}, nameWuxing, nameWuxingText, score, grade, gradeText, summary, missing[], incomplete, strokeBasis, note:'仅供娱乐'}`
- 五格公式：天格=姓笔画(+1 单姓)；人格=姓末字+名首字；地格=名笔画(+1 单名)；总格=全部笔画；外格=总格−人格+(单姓?1:0)+(单名?1:0)
- 三才：由天格/人格/地格数理五行（1/2 木、3/4 火、5/6 土、7/8 金、9/0 水）按相邻生克简化判断吉/中平/凶
- 评分：81 数理吉凶加权 + 三才调整，`grade` ∈ A+/A/B+/B/C+/C/D
- 笔画表：`data\fortune\strokes.json`（构建自 cnchar + cnchar-info，覆盖 GB2312 6763 字，实际收录 9509 字，含常用繁体字）
- **缺字优雅降级**：笔画表查不到的字再尝试 vendored cnchar；仍查不到则 `stroke=0` 计入 `missing[]`，返回 `incomplete:true`，不报错
- **限制**：五格笔画采用**简体本字笔画**（非康熙字典繁体笔画），未做氵/忄/王…等部首康熙补偿；81 数理吉凶取自常见表，仅供娱乐

## 依赖与体积（全部已 vendored，运行时零安装、无 npm 依赖）

| 文件 | 大小 | 来源 / 许可 |
|---|---|---|
| `vendor/lunar.js` | 426 KB | lunar-javascript 1.7.8（6tail，MIT）农历/节气/黄历/八字 |
| `vendor/cnchar.min.js` | 75 KB | cnchar 3.2.6（theajack，MIT）汉字笔画/拼音，缺字兜底 |
| `vendor/cnchar.info.min.js` | 132 KB | cnchar-info 3.2.6（theajack，MIT）字五行，缺字兜底 |
| `data/lots.json` | 84 KB | 64 卦数据（周易通行本公有领域文本 + MIT 白话卦意） |
| `data/fortune/strokes.json` | 159 KB | 构建时由 cnchar 提炼（9509 字笔画+五行） |
| 代码（index+src+selftest） | 约 150 KB | 本模块（天气 v2 含 Open-Meteo/中国天气网兜底解析） |
| **模块合计** | **约 0.88 MB** | 无 node_modules、无网络依赖（天气除外） |

依赖获取方式（构建期）：`npm pack lunar-javascript / cnchar / cnchar-info / dsh-xuanji / taoism-sdk --registry=https://registry.npmmirror.com`，解包后仅保留所需单文件到 `vendor/`；**运行时不需要 npm install，也不需要联网下载库**。第三方声明见 `THIRD_PARTY_NOTICES.md`。

天气数据来源：wttr.in（World Weather Online 数据）、[Open-Meteo.com](https://open-meteo.com/)（数据 CC BY 4.0，接口非商业免费）、中国天气网（兜底）。

## 数据文件（%SANWA_HOME%\data\fortune\）

| 文件 | 说明 |
|---|---|
| `preferences.json` | 天气城市偏好 `{"weather":{"city":"","autoLocate":true}}`（可选 `cityCode`/`latitude`/`longitude`），不存在时自动创建 |
| `weather-cache.json` | 天气缓存 v2（10 分钟 TTL，含 forecast7/trend，失败降级用） |
| `strokes.json` | 汉字笔画+五行表（姓名分析用，随模块交付） |

## 自测

```powershell
node %SANWA_HOME%\lib\fortune\selftest.js
```

当前结果：**23/23 通过**。覆盖：
- 2026-11-22 农历十月十四、干支丙午/己亥/庚子、小雪、冲马(甲午)、煞南、值神白虎、建除「除」
- 已知日期交叉核对：2024-02-10 春节（正月初一/甲辰/龙）、2024-06-10 端午、2024-09-17 中秋、2024-02-09 除夕、2023-03-22 闰二月初一、2024-02-04 立春
- 干支自洽：五虎遁（月干）、五鼠遁（时干）独立校验
- 八字 1990-01-01 08:00 → 己巳 丙子 丙寅 壬辰（日主丙火，五行缺金）；2026-11-22 12:00 → 丙午 己亥 庚子 壬午；立春时刻前后年月柱切换正确
- 天气 v2：真实返回 wttr.in + Open-Meteo 7 日（断言 `forecast7` 长度=7、WMO 字段、`trend` 结构）；缓存命中含 forecast7/trend；**合成数据趋势算法校验**（≥3°C 升温降温、连晴、极寒/高温/降雨/降雪提醒）；Open-Meteo 失败→中国天气网兜底（`forecast7Fallback:true`）；全兜底→wttr 3 日；wttr 失败→stale 旧缓存；无实时数据→仅 7 日预报降级；超时安全降级
- 抽签结构、64 卦映射自洽、动爻/变卦逻辑、30 次抽取随机性
- 姓名 张三/李四/王小明的五格与笔画精确值、复姓五格、缺字降级
- 非法参数全部返回 `{ok:false,error}` 不抛异常

## 安全与稳定性

- 所有导出函数 try/catch 包裹，永不抛异常
- 仅写 `lib\fortune\` 与 `data\fortune\`，不触碰 server.js / web / tools.json / scripts 等其它文件
- 不调用 PowerShell / cmd，不依赖外部 CDN（jsdelivr 等）；运行期网络访问仅：wttr.in（https）、api.open-meteo.com（http）、www.weather.com.cn（http，仅兜底）
- 缓存/配置写入采用「临时文件 + rename」，避免写坏；并发调用安全（模块内部无共享可变业务状态）

## 已知限制（如实说明）

1. **天气 v2**：Open-Meteo 按任务要求使用 HTTP（本机 HTTPS 会超时），若网络策略仅允许 HTTPS 则会走中国天气网/wttr 兜底并标记 `forecast7Fallback:true`；wttr.in 中文描述、WMO 中文描述均为本地映射；自动定位基于 wttr.in 出口 IP，可能不是本机真实位置；中国天气网兜底依赖内置城市码（可用 `cityCode` 覆盖），其 HTML 结构变化会导致该兜底失效（仍会退回 wttr 3 日）
2. 黄历宜忌等来自 lunar-javascript 规则，不同通书流派可能有出入；干支年月为立春口径，与农历年（春节口径）在每年 1-2 月初的十几天内会不同，字段已同时给出
3. 八字未做真太阳时校正；日主强弱/喜用为简化口径，不构成专业命理结论
4. 姓名五格采用简体笔画（非康熙字典笔画），81 数理表为常见版本，评分仅供娱乐
5. 抽签为纯随机（crypto 随机数），不代表任何预测；所有输出带「仅供娱乐」
