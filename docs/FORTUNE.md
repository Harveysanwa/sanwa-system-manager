# 玄学与天气（Fortune & Weather）

> 面板：天气（实时 + 7 日 + 趋势）、黄历、抽签（64 卦）、八字、姓名分析。
> 代码：`lib/fortune/`；配置：`data/fortune/preferences.json`；缓存：`data/fortune/weather-cache.json`。
> **除天气外全部离线计算；所有内容仅供娱乐，不构成任何决策、医疗、投资或法律建议。**

## 1. 功能一览

| 功能 | 接口 | 是否联网 | 说明 |
|---|---|---|---|
| 天气 | `GET /api/weather` | **是**（唯一外联） | 实时 + 3 日 + 7 日预报 + 升温/降温/连晴/连雨/降雪趋势摘要 |
| 黄历 | `GET /api/almanac?date=YYYY-MM-DD` | 否 | 农历、干支、生肖、节气、宜忌、冲煞、黄道黑道、建除十二神、吉神凶煞、彭祖百忌、节日 |
| 抽签 | `POST /api/fortune/draw` | 否 | 64 卦 · 三枚铜钱摇卦（6 爻），含卦辞/象辞/爻辞/白话/建议，纯随机 |
| 八字 | `POST /api/fortune/bazi` | 否 | 四柱、五行统计、纳音、日主、生肖、大运起运等 |
| 姓名 | `POST /api/fortune/name` | 否 | 五格剖象、三才、五行、笔画、评分（缺字优雅降级） |

所有结果都带 `note: "仅供娱乐"`（天气为「天气数据来自 …，仅供生活参考」）。

## 2. 天气：数据源与降级

| 优先级 | 数据源 | 协议 | 用途 |
|---|---|---|---|
| 1 | `wttr.in` | HTTPS | 实时天气 + 3 日预报 + 自动定位（出口 IP） |
| 2 | `api.open-meteo.com` | HTTP | 7 日预报（主源；WMO 天气码） |
| 3 | `www.weather.com.cn` | HTTP | 7 日预报兜底（HTML 解析，需要城市 code） |
| 4 | 本地缓存 | — | 10 分钟 TTL；接口失败时用同城市旧缓存并标记 `stale` |
| 5 | wttr 3 日构造 | — | 7 日数据缺失时的最后兜底，标记 `forecast7Fallback:true` |

- **趋势摘要**（`trend`）：相邻日最高温差 ≥ 3°C 记为升温 / 降温；连续 ≥ 2 天晴 / 雨 / 雪生成摘要；极端高温 / 低温 / 明显降雨 / 降雪 / 大风生成 `alerts`。
- **超时与缓存**：单次请求 8 秒超时；服务端再缓存 10 分钟（页面轮询不会频繁外联）。
- **离线可用性**：断网时天气显示缓存或「暂不可用」，其余玄学功能完全离线可用。

## 3. 城市与定位配置

首次安装**不会**自动生成天气偏好，需要手动创建（或复制示例）：

```powershell
New-Item -ItemType Directory -Force .\data\fortune | Out-Null
Copy-Item .\data\fortune.preferences.example.json .\data\fortune\preferences.json
```

```json
{
  "weather": {
    "city": "",
    "cityCode": "",
    "autoLocate": true,
    "latitude": null,
    "longitude": null
  }
}
```

| 字段 | 说明 |
|---|---|
| `city` | 城市名（中英文均可，如「北京」「Shanghai」）；留空且 `autoLocate=true` 时自动定位 |
| `autoLocate` | 是否允许自动定位；定位由 wttr.in 根据出口 IP 推断，**可能不是你的真实位置** |
| `cityCode` | 可选，中国天气网城市 code（如北京 `101010100`），仅用于第 3 级 HTML 兜底 |
| `latitude` / `longitude` | 可选，Open-Meteo 兜底坐标；不填时用 wttr.in 返回的坐标 |

- 修改后刷新页面即可生效（天气缓存 10 分钟，必要时等待下一次刷新）。
- **隐私提示**：城市偏好保存在本机 `data/fortune/preferences.json`，已在 `.gitignore` 中；不需要时删除该文件即恢复自动定位。

## 4. 黄历

- 输入：`date`（`YYYY-MM-DD`，缺省今天，本机时区）；非法日期返回 400。
- 口径：干支年、月按「立春 / 节气当日」换年换月（通书口径）；`zodiac` 同立春口径，另给 `zodiacBySpring`（春节口径）。
- 内容：农历日期、干支、生肖、节气与下一个节气、宜忌、冲煞、黄道黑道、值神、建除十二神、吉神凶煞、彭祖百忌、星宿、月相、九星、节日。
- 来源：vendored `lunar-javascript` 的传统规则实现；不同通书流派可能有出入，页面仅作参考。
- 页面支持「前一天 / 后一天 / 回到今天」；日期导航使用本地日期格式化，避免 UTC 偏移。

## 5. 抽签（64 卦）

- 方式：每爻投 3 枚铜钱（背=3、字=2），自下而上摇 6 爻得本卦；老阴（6）/ 老阳（9）为动爻，变出变卦。
- 返回：本卦 / 变卦、卦辞、彖辞、象辞（大象 + 小象）、爻辞、白话、事业 / 财运 / 感情、建议、娱乐性评分（`judgement.level` ∈ 大吉 / 吉 / 中吉 / 小吉 / 平 / 凶）。
- 随机源：`crypto` 随机数；每次结果不同，**不代表任何预测**。

## 6. 八字

- 输入：`birth`（`YYYY-MM-DD HH:mm`，纯日期按 12:00 午时估算）、`gender`（male / female / 男 / 女）。
- 返回：四柱（干支 + 藏干 + 十神 + 纳音 + 地势 + 旬空）、五行统计与缺失、日主强弱简评、生肖、起运信息、胎元 / 命宫 / 身宫等。
- **限制**：按北京时间计算，**未做真太阳时（经度时差 / 均时差）校正**；日主强弱与喜用为简化口径。字段 `timeNote` 会标注这一点。

## 7. 姓名分析

- 输入：`surname`（1–2 个汉字）、`given`（1–3 个汉字）。
- 返回：逐字笔画与五行、五格（天 / 人 / 地 / 外 / 总）、三才配置、数理吉凶、综合评分与等级、缺字提示。
- 笔画表：**`lib/fortune/data/strokes.json` 随仓库交付**（静态数据，构建时由 cnchar 3.2.6 / cnchar-info 3.2.6（MIT）提炼，覆盖常用汉字；来源与许可见 `lib/fortune/THIRD_PARTY_NOTICES.md` 与 `lib/fortune/vendor/cnchar.LICENSE`）；运行时也兼容旧的 `data/fortune/strokes.json`。查不到的字会降级并标记 `incomplete:true`，不报错。
- **限制**：采用**简体本字笔画**，未做康熙字典繁体 / 部首补偿；81 数理吉凶为常见版本，仅供娱乐。

## 8. 调用示例

```powershell
# 天气（自动定位）
Invoke-RestMethod http://127.0.0.1:9900/api/weather | ConvertTo-Json -Depth 6

# 指定日期黄历
Invoke-RestMethod 'http://127.0.0.1:9900/api/almanac?date=2026-11-22' | ConvertTo-Json -Depth 6

# 抽签
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:9900/api/fortune/draw -ContentType 'application/json' -Body '{}' | ConvertTo-Json -Depth 6

# 八字
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:9900/api/fortune/bazi -ContentType 'application/json' `
  -Body '{"birth":"1990-01-01 08:00","gender":"male"}' | ConvertTo-Json -Depth 6

# 姓名
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:9900/api/fortune/name -ContentType 'application/json' `
  -Body '{"surname":"王","given":"小明"}' | ConvertTo-Json -Depth 6
```

完整字段见 [API.md](API.md)；引擎内部说明见 [`lib/fortune/README.md`](../lib/fortune/README.md)。

## 9. 免责声明

1. 黄历宜忌、八字、姓名数理、抽签结果均来自传统民俗规则或随机数，**仅供娱乐**；
2. 不同流派、不同资料会得出不同结论，本项目不主张任何「准确性」；
3. 请勿据此做医疗、投资、婚恋、法律等重大决定；
4. 天气数据来自第三方（wttr.in / Open-Meteo / 中国天气网），可能存在延迟或误差，出行请以官方气象预报为准。

## 10. FAQ

**Q：为什么天气一直显示「暂不可用」？**
多为网络无法访问 wttr.in / Open-Meteo；可在设置里更换城市再试，或有缓存时会显示旧数据。玄学功能不受影响。

**Q：我没有填城市，为什么显示的天气不是本地？**
自动定位是根据出口 IP 推断的，可能落到运营商出口城市。请手动填写城市名。

**Q：黄历和手机 App / 老黄历对不上？**
不同通书的宜忌、干支口径（立春 vs 春节）可能不同；本项目按立春 / 节气口径，且页面会同时给出两种生肖口径。

**Q：八字需要真太阳时吗？**
专业命理通常需要；本项目未做经度/均时差校正，结果只作娱乐参考。

**Q：姓名笔画为什么和我查的康熙字典不一样？**
本项目用简体本字笔画，未做康熙字典繁体笔画与部首补偿；这是已知限制。

**Q：这些数据会上传吗？**
不会。除天气查询（只带城市/坐标）外，所有计算在本机完成；输入不会写入仓库或发送到第三方。
