'use strict';

/**
 * 天气模块 v2
 * - 主流程：wttr.in j1（当前实时 + 3 日中文预报 + 自动定位经纬度）
 *   → Open-Meteo HTTP（7 日预报，WMO 天气码）→ 趋势分析（升温/降温/连晴连雨/提醒）
 * - 说明：本机实测 Open-Meteo 的 HTTPS 会超时，故按任务要求使用 HTTP；
 *         wttr.in 的 lang=zh 对天气描述本地化不稳定，因此内置 WWO 天气码 → 中文描述映射。
 * - 失败回退：Open-Meteo 失败 → 中国天气网 7 天 HTML（可选，需城市 code）→ wttr 3 日（标记 forecast7Fallback）
 *             wttr 失败 → 同城市旧缓存（stale）→ 仅 7 日预报降级 → ok:false
 * - 缓存：data\fortune\weather-cache.json（TTL 10 分钟）
 * - 城市配置：data\fortune\preferences.json → {"weather":{"city":"","autoLocate":true}}
 */

const http = require('http');
const https = require('https');
const {
  dataFile, readJsonSafe, writeJsonSafe, readPreferences, toNum, round1, sleep,
} = require('./util');

const SOURCE = 'wttr.in';
const CACHE_FILE = 'weather-cache.json';
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_VERSION = 2;
const DEFAULT_TIMEOUT_MS = 8 * 1000;
const W = 'wttr.in';
const OPEN_METEO_HTTP = 'http://api.open-meteo.com/v1/forecast';
const WEATHER_CN_HOST = 'www.weather.com.cn';

/** WWO 天气代码 → 中文描述（wttr.in j1 的 weatherCode 字段） */
const WEATHER_CODE_ZH = {
  113: '晴', 116: '多云', 119: '阴', 122: '阴',
  143: '薄雾', 248: '雾', 260: '冻雾',
  176: '局部有雨', 263: '局部毛毛雨', 266: '毛毛雨', 281: '冻毛毛雨', 284: '强冻毛毛雨',
  293: '局部小雨', 296: '小雨', 299: '间歇中雨', 302: '中雨', 305: '间歇大雨', 308: '大雨',
  311: '小冻雨', 314: '中到大冻雨',
  179: '局部有雪', 182: '局部雨夹雪', 185: '局部冻雨',
  227: '吹雪', 230: '暴风雪',
  317: '小雨夹雪', 320: '中到大雨夹雪',
  323: '局部小雪', 326: '小雪', 329: '局部中雪', 332: '中雪', 335: '局部大雪', 338: '大雪',
  350: '冰粒',
  353: '小阵雨', 356: '中到大阵雨', 359: '暴雨',
  362: '小阵雨夹雪', 365: '中到大阵雨夹雪',
  368: '小阵雪', 371: '中到大阵雪',
  374: '小冰粒', 377: '中到大冰粒',
  386: '局部雷阵雨', 389: '中到大雷阵雨', 392: '局部雷雪', 395: '中到大雷雪',
};

/** 英文天气描述兜底映射（wttr.in 未返回 code 时用） */
const WEATHER_DESC_EN_ZH = {
  'Sunny': '晴', 'Clear': '晴', 'Partly cloudy': '多云', 'Cloudy': '多云', 'Overcast': '阴',
  'Mist': '薄雾', 'Fog': '雾', 'Freezing fog': '冻雾',
  'Patchy rain nearby': '局部有雨', 'Patchy rain possible': '局部有雨',
  'Light drizzle': '毛毛雨', 'Patchy light drizzle': '局部毛毛雨', 'Freezing drizzle': '冻毛毛雨',
  'Light rain': '小雨', 'Patchy light rain': '局部小雨', 'Moderate rain': '中雨',
  'Moderate rain at times': '间歇中雨', 'Heavy rain': '大雨', 'Heavy rain at times': '间歇大雨',
  'Light freezing rain': '小冻雨', 'Moderate or heavy freezing rain': '中到大冻雨',
  'Patchy snow nearby': '局部有雪', 'Patchy sleet nearby': '局部雨夹雪',
  'Blowing snow': '吹雪', 'Blizzard': '暴风雪',
  'Light sleet': '小雨夹雪', 'Moderate or heavy sleet': '中到大雨夹雪',
  'Patchy light snow': '局部小雪', 'Light snow': '小雪', 'Patchy moderate snow': '局部中雪',
  'Moderate snow': '中雪', 'Patchy heavy snow': '局部大雪', 'Heavy snow': '大雪',
  'Ice pellets': '冰粒',
  'Light rain shower': '小阵雨', 'Moderate or heavy rain shower': '中到大阵雨', 'Torrential rain shower': '暴雨',
  'Light sleet showers': '小阵雨夹雪', 'Moderate or heavy sleet showers': '中到大阵雨夹雪',
  'Light snow showers': '小阵雪', 'Moderate or heavy snow showers': '中到大阵雪',
  'Light showers of ice pellets': '小冰粒', 'Moderate or heavy showers of ice pellets': '中到大冰粒',
  'Patchy light rain with thunder': '局部雷阵雨', 'Moderate or heavy rain with thunder': '中到大雷阵雨',
  'Patchy light snow with thunder': '局部雷雪', 'Moderate or heavy snow with thunder': '中到大雷雪',
};

/**
 * WMO 天气码（Open-Meteo）→ 中文/英文描述与类型标记
 * 0 晴 / 1-2 多云 / 3 阴 / 45-48 雾 / 51-67 毛毛雨·雨 / 71-77 雪 / 80-82 阵雨 / 85-86 阵雪 / 95-99 雷暴
 */
const WMO_MAP = {
  0: { desc: '晴', descEn: 'Clear sky', isSunny: true },
  1: { desc: '多云', descEn: 'Mainly clear' },
  2: { desc: '多云', descEn: 'Partly cloudy' },
  3: { desc: '阴', descEn: 'Overcast' },
  45: { desc: '雾', descEn: 'Fog' },
  48: { desc: '雾凇', descEn: 'Depositing rime fog' },
  51: { desc: '毛毛雨', descEn: 'Light drizzle', isRain: true },
  53: { desc: '毛毛雨', descEn: 'Moderate drizzle', isRain: true },
  55: { desc: '大毛毛雨', descEn: 'Dense drizzle', isRain: true },
  56: { desc: '冻毛毛雨', descEn: 'Light freezing drizzle', isRain: true },
  57: { desc: '冻毛毛雨', descEn: 'Dense freezing drizzle', isRain: true },
  61: { desc: '小雨', descEn: 'Slight rain', isRain: true },
  63: { desc: '中雨', descEn: 'Moderate rain', isRain: true },
  65: { desc: '大雨', descEn: 'Heavy rain', isRain: true },
  66: { desc: '冻雨', descEn: 'Light freezing rain', isRain: true },
  67: { desc: '冻雨', descEn: 'Heavy freezing rain', isRain: true },
  71: { desc: '小雪', descEn: 'Slight snow', isSnow: true },
  73: { desc: '中雪', descEn: 'Moderate snow', isSnow: true },
  75: { desc: '大雪', descEn: 'Heavy snow', isSnow: true },
  77: { desc: '雪粒', descEn: 'Snow grains', isSnow: true },
  80: { desc: '小阵雨', descEn: 'Slight rain showers', isRain: true },
  81: { desc: '中阵雨', descEn: 'Moderate rain showers', isRain: true },
  82: { desc: '强阵雨', descEn: 'Violent rain showers', isRain: true },
  85: { desc: '小阵雪', descEn: 'Slight snow showers', isSnow: true },
  86: { desc: '大阵雪', descEn: 'Heavy snow showers', isSnow: true },
  95: { desc: '雷暴', descEn: 'Thunderstorm', isRain: true },
  96: { desc: '雷暴伴冰雹', descEn: 'Thunderstorm with slight hail', isRain: true },
  99: { desc: '雷暴伴冰雹', descEn: 'Thunderstorm with heavy hail', isRain: true },
};

/** 中国天气网中文天气用语 → {code(WMO), descEn, isRain, isSnow, isSunny} */
const CN_WEATHER_DESC = {
  晴: { code: 0, descEn: 'Clear', isSunny: true },
  多云: { code: 2, descEn: 'Partly cloudy' },
  阴: { code: 3, descEn: 'Overcast' },
  小雨: { code: 61, descEn: 'Light rain', isRain: true },
  中雨: { code: 63, descEn: 'Moderate rain', isRain: true },
  大雨: { code: 65, descEn: 'Heavy rain', isRain: true },
  暴雨: { code: 82, descEn: 'Rainstorm', isRain: true },
  阵雨: { code: 80, descEn: 'Showers', isRain: true },
  雷阵雨: { code: 95, descEn: 'Thunderstorm', isRain: true },
  雷雨: { code: 95, descEn: 'Thunderstorm', isRain: true },
  小雪: { code: 71, descEn: 'Light snow', isSnow: true },
  中雪: { code: 73, descEn: 'Moderate snow', isSnow: true },
  大雪: { code: 75, descEn: 'Heavy snow', isSnow: true },
  暴雪: { code: 75, descEn: 'Snowstorm', isSnow: true },
  阵雪: { code: 85, descEn: 'Snow showers', isSnow: true },
  雨夹雪: { code: 66, descEn: 'Sleet', isRain: true, isSnow: true },
  冻雨: { code: 66, descEn: 'Freezing rain', isRain: true },
  冰雹: { code: 96, descEn: 'Hail', isRain: true },
  雾: { code: 45, descEn: 'Fog' },
  霾: { code: 48, descEn: 'Haze' },
  浮尘: { code: 45, descEn: 'Dust' },
  扬沙: { code: 45, descEn: 'Sand' },
  沙尘暴: { code: 45, descEn: 'Sandstorm' },
};

const WEEK_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

/** 中国天气网城市 code（常用城市；可在 preferences.weather.cityCode 或 opts.cityCode 覆盖） */
const CITY_CODE = {
  北京: '101010100', Beijing: '101010100', 上海: '101020100', Shanghai: '101020100',
  广州: '101280101', Guangzhou: '101280101', 深圳: '101280601', Shenzhen: '101280601',
  天津: '101030100', Tianjin: '101030100', 重庆: '101040100', Chongqing: '101040100',
  杭州: '101210101', Hangzhou: '101210101', 南京: '101190101', Nanjing: '101190101',
  武汉: '101200101', Wuhan: '101200101', 成都: '101270101', Chengdu: '101270101',
  北京: '101260101', Beijing: '101260101', 昆明: '101290101', Kunming: '101290101',
  西安: '101110101', "Xi'an": '101110101', 长沙: '101250101', Changsha: '101250101',
  郑州: '101180101', Zhengzhou: '101180101', 济南: '101120101', Jinan: '101120101',
  青岛: '101120201', Qingdao: '101120201', 沈阳: '101070101', Shenyang: '101070101',
  大连: '101070201', Dalian: '101070201', 哈尔滨: '101050101', Harbin: '101050101',
  长春: '101060101', Changchun: '101060101', 石家庄: '101090101', Shijiazhuang: '101090101',
  太原: '101100101', Taiyuan: '101100101', 呼和浩特: '101080101', Hohhot: '101080101',
  兰州: '101160101', Lanzhou: '101160101', 西宁: '101150101', Xining: '101150101',
  银川: '101170101', Yinchuan: '101170101', 乌鲁木齐: '101130101', Urumqi: '101130101',
  拉萨: '101140101', Lhasa: '101140101', 南宁: '101300101', Nanning: '101300101',
  海口: '101310101', Haikou: '101310101', 南昌: '101240101', Nanchang: '101240101',
  合肥: '101220101', Hefei: '101220101', 福州: '101230101', Fuzhou: '101230101',
  厦门: '101230201', Xiamen: '101230201', 苏州: '101190401', Suzhou: '101190401',
  无锡: '101190201', Wuxi: '101190201', 宁波: '101210401', Ningbo: '101210401',
  珠海: '101280701', Zhuhai: '101280701', 佛山: '101280800', Foshan: '101280800',
  东莞: '101281601', Dongguan: '101281601', 汕头: '101280501', Shantou: '101280501',
};

const DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36 fortune-hub/2.0',
  'Accept': 'application/json,text/html,text/plain,*/*',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.5',
};

function descZhFromWwo(code, enDesc) {
  const n = Number(code);
  if (Number.isFinite(n) && WEATHER_CODE_ZH[n]) return WEATHER_CODE_ZH[n];
  if (enDesc && WEATHER_DESC_EN_ZH[enDesc]) return WEATHER_DESC_EN_ZH[enDesc];
  return enDesc || '未知';
}

function weekdayCN(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || ''));
  if (!m) return '';
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return WEEK_CN[d.getDay()] || '';
}

function pad2(n) {
  return String(n).padStart(2, '0');
}
function fmtDate(dt) {
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
}

/* ------------------------------------------------------------------ 网络请求 */

/** 单次 HTTP(S) 请求，返回 {status, headers, buffer} */
function requestOnce(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https:') ? https : http;
    let done = false;
    const req = mod.get(url, { headers: DEFAULT_HEADERS, timeout: timeoutMs }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        if (done) return;
        done = true;
        resolve({ status: res.statusCode, headers: res.headers || {}, buffer: Buffer.concat(chunks) });
      });
      res.on('error', (e) => {
        if (done) return;
        done = true;
        reject(e);
      });
    });
    req.setTimeout(timeoutMs, () => {
      if (done) return;
      done = true;
      reject(new Error(`请求超时（${timeoutMs}ms）`));
      req.destroy();
    });
    req.on('error', (e) => {
      if (done) return;
      done = true;
      reject(e);
    });
  });
}

/** 跟随 301/302/307/308 重定向的请求（最多 3 跳） */
async function fetchFollow(url, timeoutMs, maxRedirects = 3) {
  let current = url;
  for (let i = 0; i <= maxRedirects; i++) {
    const r = await requestOnce(current, timeoutMs);
    if ([301, 302, 303, 307, 308].includes(r.status) && r.headers.location && i < maxRedirects) {
      current = new URL(r.headers.location, current).href;
      continue;
    }
    if (r.status !== 200) throw new Error(`HTTP ${r.status}${r.buffer.length ? '：' + r.buffer.toString('utf8').slice(0, 100) : ''}`);
    return r;
  }
  throw new Error('重定向次数过多');
}

/** 请求文本（utf8 或自动识别 HTML 编码），失败重试 retries 次 */
async function fetchText(url, timeoutMs, opts = {}) {
  const retries = opts.retries === undefined ? 1 : opts.retries;
  const sleepMs = opts.sleepMs === undefined ? 250 : opts.sleepMs;
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const r = await fetchFollow(url, timeoutMs);
      if (opts.html) return decodeHtml(r.buffer, r.headers);
      return r.buffer.toString('utf8');
    } catch (e) {
      lastErr = e;
      if (attempt < retries) await sleep(sleepMs);
    }
  }
  throw lastErr || new Error('请求失败');
}

/** HTML 编码识别：优先声明的 charset，否则在 utf-8 / gbk 中选能正确出现“天气”的 */
function decodeHtml(buffer, headers) {
  const ctype = String((headers && headers['content-type']) || '').toLowerCase();
  const headAscii = buffer.slice(0, 2048).toString('latin1').toLowerCase();
  const metaCharset = (/charset=["']?([\w-]+)/.exec(headAscii) || [])[1] || '';
  const declared = ((ctype.match(/charset=([\w-]+)/) || [])[1] || metaCharset || '').replace('utf8', 'utf-8');
  const tryDecode = (enc) => {
    try { return new TextDecoder(enc).decode(buffer); } catch (e) { return null; }
  };
  const candidates = [];
  if (declared) candidates.push(declared);
  candidates.push('utf-8', 'gbk', 'gb18030');
  const seen = new Set();
  for (const enc of candidates) {
    if (seen.has(enc)) continue;
    seen.add(enc);
    const s = tryDecode(enc);
    if (s && (s.includes('天气') || s.includes('℃'))) return s;
  }
  const u = tryDecode('utf-8') || '';
  const g = tryDecode('gbk') || '';
  return u.split('\uFFFD').length <= g.split('\uFFFD').length ? u : g;
}

/* ------------------------------------------------------------------ 数据源实现 */

/** wttr.in j1 拉取（重试 1 次） */
async function fetchWttrJson(query, timeoutMs, forceFail) {
  if (forceFail) throw new Error('已按调试参数强制禁用 wttr.in');
  const q = query ? encodeURIComponent(query).replace(/%20/g, '+') : '';
  const text = await fetchText(`https://${W}/${q}?format=j1&lang=zh`, timeoutMs, { retries: 1 });
  const json = JSON.parse(text);
  if (!json || !json.current_condition) throw new Error('wttr.in 返回数据格式异常');
  return json;
}

/** Open-Meteo 7 日预报（HTTP，WMO 天气码） */
async function fetchOpenMeteo(lat, lon, timeoutMs, forceFail) {
  if (forceFail) throw new Error('已按调试参数强制禁用 Open-Meteo');
  const url =
    `${OPEN_METEO_HTTP}?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lon)}` +
    '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max' +
    '&timezone=auto&forecast_days=7';
  const text = await fetchText(url, timeoutMs, { retries: 0 });
  const json = JSON.parse(text);
  const daily = json && json.daily;
  if (!daily || !Array.isArray(daily.time) || !daily.time.length) throw new Error('Open-Meteo 返回数据结构异常');
  const n = daily.time.length;
  const list = [];
  for (let i = 0; i < n; i++) {
    const code = Number(daily.weather_code ? daily.weather_code[i] : NaN);
    const meta = WMO_MAP[code] || { desc: '未知', descEn: 'Unknown' };
    const maxC = round1(toNum(daily.temperature_2m_max ? daily.temperature_2m_max[i] : NaN, NaN));
    const minC = round1(toNum(daily.temperature_2m_min ? daily.temperature_2m_min[i] : NaN, NaN));
    list.push({
      date: daily.time[i],
      weekdayCN: weekdayCN(daily.time[i]),
      weekday: weekdayCN(daily.time[i]),
      code: Number.isFinite(code) ? code : null,
      desc: meta.desc,
      descEn: meta.descEn,
      maxC: Number.isFinite(maxC) ? maxC : null,
      minC: Number.isFinite(minC) ? minC : null,
      precipMM: round1(toNum(daily.precipitation_sum ? daily.precipitation_sum[i] : 0, 0)),
      precipProb: Math.round(toNum(daily.precipitation_probability_max ? daily.precipitation_probability_max[i] : 0, 0)),
      windKmh: round1(toNum(daily.wind_speed_10m_max ? daily.wind_speed_10m_max[i] : 0, 0)),
      isRain: !!meta.isRain,
      isSnow: !!meta.isSnow,
      isSunny: !!meta.isSunny,
    });
  }
  return { list, timezone: json.timezone || '', latitude: json.latitude, longitude: json.longitude, codeType: 'WMO' };
}

/** 由 wttr.in j1 的 3 日数据构造 forecast7 兜底（code 为 WWO 编码） */
function forecast7FromWttr(json) {
  const days = Array.isArray(json.weather) ? json.weather.slice(0, 7) : [];
  const list = days.map((day) => {
    const hourly = Array.isArray(day.hourly) ? day.hourly : [];
    const mid = hourly[4] || hourly[Math.floor(hourly.length / 2)] || {};
    const midEn = (mid.weatherDesc && mid.weatherDesc[0] && mid.weatherDesc[0].value) || '';
    const code = Number(mid.weatherCode);
    const en = midEn || '';
    const isRain = /rain|drizzle|shower|thunder|sleet|freezing/i.test(en) || /雨/.test(descZhFromWwo(code, en));
    const isSnow = /snow|blizzard|ice pellets/i.test(en) || /雪|冰粒/.test(descZhFromWwo(code, en));
    const isSunny = /sunny|clear/i.test(en) && !isRain && !isSnow;
    const precipMM = round1(hourly.reduce((s, h) => s + toNum(h.precipMM, 0), 0));
    const precipProb = hourly.reduce((mx, h) => Math.max(mx, toNum(h.chanceofrain, 0)), 0);
    const windKmh = hourly.reduce((mx, h) => Math.max(mx, toNum(h.windspeedKmph, 0)), 0);
    return {
      date: day.date || '',
      weekdayCN: weekdayCN(day.date),
      weekday: weekdayCN(day.date),
      code: Number.isFinite(code) ? code : null,
      desc: descZhFromWwo(code, midEn),
      descEn: midEn || descZhFromWwo(code, midEn),
      maxC: round1(toNum(day.maxtempC, NaN)),
      minC: round1(toNum(day.mintempC, NaN)),
      precipMM,
      precipProb: Math.round(precipProb),
      windKmh: round1(windKmh),
      isRain,
      isSnow,
      isSunny: !!isSunny,
    };
  });
  return { list, timezone: '', latitude: null, longitude: null, codeType: 'WWO' };
}

/** 中国天气网 7 天 HTML 解析（最后兜底） */
async function fetchWeatherCnHtml(cityCode, timeoutMs, forceFail) {
  if (forceFail) throw new Error('已按调试参数强制禁用中国天气网');
  const url = `http://${WEATHER_CN_HOST}/weather/${encodeURIComponent(cityCode)}.shtml`;
  const html = await fetchText(url, timeoutMs, { retries: 0, html: true });
  const blocks = html.match(/<li class="sky skyid[\s\S]*?<\/li>/g) || [];
  if (!blocks.length) throw new Error('中国天气网页面结构异常（未找到 7 日列表）');
  const title = (html.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '';
  const cityNameMatch = /^([\u4e00-\u9fa5]{2,8})天气预报/.exec(title.replace(/\s+/g, ''));
  const cityName = cityNameMatch ? cityNameMatch[1] : '';
  const today = new Date();
  let cursorYear = today.getFullYear();
  let cursorMonth = today.getMonth() + 1;
  let prevDay = today.getDate();
  const list = [];
  const windLevelToKmh = { 0: 1, 1: 5, 2: 8, 3: 13, 4: 20, 5: 29, 6: 39, 7: 50, 8: 62, 9: 75 };
  blocks.slice(0, 7).forEach((block, idx) => {
    const h1 = (block.match(/<h1>([\s\S]*?)<\/h1>/) || [])[1] || '';
    const dayMatch = /(\d{1,2})日/.exec(h1);
    const dayNum = dayMatch ? Number(dayMatch[1]) : null;
    let date = null;
    if (idx === 0) {
      date = fmtDate(today);
    } else if (dayNum) {
      if (dayNum < prevDay - 15) { // 跨月
        cursorMonth += 1;
        if (cursorMonth > 12) { cursorMonth = 1; cursorYear += 1; }
      }
      prevDay = dayNum;
      date = fmtDate(new Date(cursorYear, cursorMonth - 1, dayNum));
    }
    const wea = (block.match(/<p[^>]*class="wea"[^>]*>([\s\S]*?)<\/p>/) || [])[1] || '';
    const descCN = wea.replace(/<[^>]+>/g, '').trim();
    const temBlock = (block.match(/<p class="tem"[\s\S]*?<\/p>/) || [])[0] || '';
    const spans = (temBlock.match(/<span>(-?\d+)℃<\/span>/g) || []).map((s) => Number(s.replace(/[^\d-]/g, '')));
    const lows = (temBlock.match(/<i>(-?\d+)℃<\/i>/g) || []).map((s) => Number(s.replace(/[^\d-]/g, '')));
    let maxC = null;
    let minC = null;
    if (spans.length && lows.length) { maxC = spans[0]; minC = lows[0]; }
    else if (spans.length) { maxC = spans[0]; }
    else if (lows.length) { maxC = lows[0]; }
    if (maxC !== null && minC === null) minC = maxC - 6; // 今日列表仅给最高温时按经验值估算
    const winBlock = (block.match(/<p class="win"[\s\S]*?<\/p>/) || [])[0] || '';
    const levelMatch = /(\d+)级/.exec(winBlock.replace(/<[^>]+>/g, ''));
    const windKmh = levelMatch ? (windLevelToKmh[Math.min(9, Number(levelMatch[1]))] || 0) : 0;
    // 中文天气用语 → WMO 码/标记（“A转B”取首个）
    const primary = descCN.split('转')[0].replace(/[^\u4e00-\u9fa5]/g, '') || descCN;
    const meta = CN_WEATHER_DESC[primary] || CN_WEATHER_DESC[descCN] || { code: null, descEn: '', };
    list.push({
      date,
      weekdayCN: weekdayCN(date),
      weekday: weekdayCN(date),
      code: meta.code === undefined ? null : meta.code,
      desc: descCN || '未知',
      descEn: meta.descEn || '',
      maxC,
      minC,
      precipMM: null,
      precipProb: null,
      windKmh,
      isRain: !!meta.isRain || /雨/.test(descCN),
      isSnow: !!meta.isSnow || /雪/.test(descCN),
      isSunny: !!meta.isSunny || descCN === '晴',
    });
  });
  return { list, cityName, codeType: 'CN-HTML' };
}

/* ------------------------------------------------------------------ 趋势分析 */

function findRuns(list, predicate) {
  const runs = [];
  let cur = [];
  for (const item of list) {
    if (predicate(item)) {
      cur.push(item);
    } else if (cur.length) {
      runs.push(cur);
      cur = [];
    }
  }
  if (cur.length) runs.push(cur);
  return runs;
}

/** 由 forecast7 生成天气趋势 */
function computeTrend(forecast7) {
  const list = Array.isArray(forecast7) ? forecast7.filter((d) => d && d.date) : [];
  const n = list.length;
  const empty = { summary: '暂无足够的预报数据生成趋势', changes: [], rainyDays: [], sunnyDays: [], snowDays: [], alerts: [] };
  if (!n) return empty;

  const rainyDays = list.filter((d) => d.isRain).map((d) => d.date);
  const sunnyDays = list.filter((d) => d.isSunny).map((d) => d.date);
  const snowDays = list.filter((d) => d.isSnow).map((d) => d.date);

  // 相邻日最高温差 >=3°C
  const changes = [];
  for (let i = 1; i < n; i++) {
    const prev = list[i - 1].maxC;
    const cur = list[i].maxC;
    if (typeof prev !== 'number' || typeof cur !== 'number') continue;
    const delta = round1(cur - prev);
    if (Math.abs(delta) >= 3) {
      changes.push({ date: list[i].date, type: delta > 0 ? '升温' : '降温', deltaC: Math.abs(delta) });
    }
  }

  const rainRuns = findRuns(list, (d) => d.isRain);
  const sunnyRuns = findRuns(list, (d) => d.isSunny);
  const snowRuns = findRuns(list, (d) => d.isSnow);
  const longest = (runs) => runs.reduce((best, r) => (r.length > (best ? best.length : 0) ? r : best), null);
  const biggestChange = changes.length ? changes.reduce((a, b) => (b.deltaC > a.deltaC ? b : a), changes[0]) : null;

  const sunnyCount = sunnyDays.length;
  const rainyCount = rainyDays.length;
  const snowCount = snowDays.length;
  const parts = [];
  let base;
  if (snowCount >= 2) base = `未来${n}天多降雪`;
  else if (rainyCount >= Math.ceil(n * 0.5)) base = `未来${n}天以阴雨为主`;
  else if (sunnyCount >= Math.ceil(n * 0.5)) base = `未来${n}天以晴为主`;
  else if (rainyCount >= 2 && sunnyCount >= 2) base = `未来${n}天晴雨相间`;
  else if (sunnyCount >= 2) base = `未来${n}天晴好天气较多`;
  else base = `未来${n}天以多云或阴天为主`;
  parts.push(base);

  // 连续 2 天以上的晴/雨/雪
  const rainSpell = longest(rainRuns);
  const snowSpell = longest(snowRuns);
  const sunnySpell = longest(sunnyRuns);
  if (rainSpell && rainSpell.length >= 2 && !base.includes('阴雨')) {
    parts.push(`${rainSpell[0].weekdayCN}至${rainSpell[rainSpell.length - 1].weekdayCN}有雨`);
  } else if (rainyCount && !rainSpell && !base.includes('阴雨') && !base.includes('晴雨')) {
    const firstRain = list.find((d) => d.isRain);
    parts.push(`${firstRain.weekdayCN}有${firstRain.desc}`);
  }
  if (snowSpell && snowSpell.length >= 2 && !base.includes('降雪')) {
    parts.push(`${snowSpell[0].weekdayCN}至${snowSpell[snowSpell.length - 1].weekdayCN}有雪`);
  }
  if (sunnySpell && sunnySpell.length >= 2 && !base.includes('以晴为主') && sunnySpell.length < n &&
      (!biggestChange || sunnySpell[0].date !== biggestChange.date)) {
    parts.push(`${sunnySpell[0].weekdayCN}起连续${sunnySpell.length}天晴`);
  }

  // 最大温度变化写摘要
  if (biggestChange) {
    parts.push(`${weekdayCN(biggestChange.date)}起${biggestChange.type}${biggestChange.deltaC}°C`);
  } else if (parts.length === 1) {
    const maxs = list.map((d) => d.maxC).filter((x) => typeof x === 'number');
    if (maxs.length) parts.push(`最高温${Math.min(...maxs)}~${Math.max(...maxs)}°C`);
  }

  // 显著天气提醒
  const alerts = [];
  const seen = new Set();
  const pushAlert = (type, text) => {
    const key = `${type}|${text}`;
    if (seen.has(key)) return;
    seen.add(key);
    alerts.push(text);
  };
  for (const d of list) {
    if (typeof d.minC === 'number' && d.minC <= -10) pushAlert('cold', `${d.weekdayCN}最低温${d.minC}°C，极寒注意防冻`);
    if (typeof d.maxC === 'number' && d.maxC >= 35) pushAlert('hot', `${d.weekdayCN}最高温${d.maxC}°C，注意防暑降温`);
    if (d.isSnow) pushAlert('snow', `${d.weekdayCN}有降雪（${d.desc}），注意出行安全`);
    if (d.isRain && ((typeof d.precipProb === 'number' && d.precipProb >= 70) || (typeof d.precipMM === 'number' && d.precipMM >= 10))) {
      const bits = [];
      if (typeof d.precipProb === 'number') bits.push(`降雨概率${d.precipProb}%`);
      if (typeof d.precipMM === 'number' && d.precipMM > 0) bits.push(`降水${d.precipMM}mm`);
      pushAlert('rain', `${d.weekdayCN}${bits.join('、')}，注意携带雨具`);
    }
    if (typeof d.windKmh === 'number' && d.windKmh >= 40) pushAlert('wind', `${d.weekdayCN}风力较大（${Math.round(d.windKmh)}km/h），注意防风`);
  }

  return {
    summary: parts.join('，') + '。',
    changes,
    rainyDays,
    sunnyDays,
    snowDays,
    alerts: alerts.slice(0, 6),
  };
}

/* ------------------------------------------------------------------ 组装 getWeather */

/** 从 wttr.in j1 提取坐标 */
function extractCoord(json) {
  const near = json && json.nearest_area && json.nearest_area[0];
  if (!near) return null;
  const lat = toNum(near.latitude, NaN);
  const lon = toNum(near.longitude, NaN);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat: round1(lat * 1000) / 1000, lon: round1(lon * 1000) / 1000 };
}

function resolveCityCode(city, prefs, opts) {
  if (opts && opts.cityCode) return { code: String(opts.cityCode), source: 'opts.cityCode' };
  const pw = (prefs && prefs.weather) || {};
  if (pw.cityCode) return { code: String(pw.cityCode), source: 'preferences' };
  const candidates = [city, pw.city, opts && opts.resolvedCity];
  for (const c of candidates) {
    if (!c) continue;
    const s = String(c).trim();
    if (CITY_CODE[s]) return { code: CITY_CODE[s], source: '内置城市码' };
    const first = s.split(/[,\s（(]/)[0];
    if (CITY_CODE[first]) return { code: CITY_CODE[first], source: '内置城市码' };
    const en = Object.keys(CITY_CODE).find((k) => k.toLowerCase() === first.toLowerCase());
    if (en) return { code: CITY_CODE[en], source: '内置城市码' };
  }
  return null;
}

/** 标准化 wttr.in j1 响应（保持 v1 字段兼容） */
function normalizeJ1(json, meta) {
  const cur = (json.current_condition && json.current_condition[0]) || {};
  const near = (json.nearest_area && json.nearest_area[0]) || {};
  const areaName = (near.areaName && near.areaName[0] && near.areaName[0].value) || '';
  const region = (near.region && near.region[0] && near.region[0].value) || '';
  const country = (near.country && near.country[0] && near.country[0].value) || '';
  const curEn = (cur.weatherDesc && cur.weatherDesc[0] && cur.weatherDesc[0].value) || '';
  const forecast = Array.isArray(json.weather) ? json.weather.slice(0, 3) : [];
  const forecastList = forecast.map((day) => {
    const hourly = Array.isArray(day.hourly) ? day.hourly : [];
    const mid = hourly[4] || hourly[Math.floor(hourly.length / 2)] || {};
    const midEn = (mid.weatherDesc && mid.weatherDesc[0] && mid.weatherDesc[0].value) || curEn;
    const rain = hourly.reduce((max, h) => Math.max(max, toNum(h.chanceofrain, 0)), 0);
    const astro = day.astronomy && day.astronomy[0] ? day.astronomy[0] : {};
    return {
      date: day.date || '',
      minC: toNum(day.mintempC, 0),
      maxC: toNum(day.maxtempC, 0),
      desc: descZhFromWwo(mid.weatherCode, midEn),
      descEn: midEn || '',
      chanceOfRain: rain,
      uvIndex: toNum(day.uvIndex, 0),
      sunrise: astro.sunrise || '',
      sunset: astro.sunset || '',
    };
  });
  const resolvedParts = [areaName, region, country].filter((x, i, a) => x && a.indexOf(x) === i);
  return {
    ok: true,
    city: areaName || meta.query || '',
    area: region,
    country,
    resolvedCity: resolvedParts.join(', ') || meta.query || '',
    query: meta.query || 'auto',
    autoLocate: !!meta.autoLocate,
    coord: extractCoord(json),
    updatedAt: meta.fetchedAt,
    observationTime: cur.observation_time || '',
    current: {
      tempC: toNum(cur.temp_C, 0),
      feelsLikeC: toNum(cur.FeelsLikeC, 0),
      desc: descZhFromWwo(cur.weatherCode, curEn),
      descEn: curEn || '',
      weatherCode: cur.weatherCode || '',
      humidity: toNum(cur.humidity, 0),
      windKmh: toNum(cur.windspeedKmph, 0),
      windDir: cur.winddir16Point || '',
      windDirDegree: toNum(cur.winddirDegree, 0),
      pressure: toNum(cur.pressure, 0),
      visibilityKm: toNum(cur.visibility, 0),
      cloudCover: toNum(cur.cloudcover, 0),
      uvIndex: toNum(cur.uvIndex, 0),
      precipMM: toNum(cur.precipMM, 0),
    },
    forecast: forecastList,
    source: SOURCE,
    cacheTtlSec: Math.floor(CACHE_TTL_MS / 1000),
    stale: false,
    cached: false,
    note: '天气数据来自 wttr.in + Open-Meteo，仅供生活参考',
  };
}

/** 由 7 日预报截取 3 日（降级模式下用于填充兼容字段 forecast） */
function forecast3From7(forecast7) {
  return (forecast7 || []).slice(0, 3).map((d) => ({
    date: d.date,
    minC: d.minC,
    maxC: d.maxC,
    desc: d.desc,
    descEn: d.descEn,
    chanceOfRain: typeof d.precipProb === 'number' ? d.precipProb : 0,
    uvIndex: 0,
    sunrise: '',
    sunset: '',
  }));
}

function loadCache() {
  const obj = readJsonSafe(dataFile(CACHE_FILE), null);
  if (!obj || typeof obj !== 'object' || !obj.data) return null;
  return obj;
}

function saveCache(key, data) {
  writeJsonSafe(dataFile(CACHE_FILE), {
    version: CACHE_VERSION,
    key,
    fetchedAt: data.updatedAt,
    savedAt: new Date().toISOString(),
    data,
  });
}

/** 获取 7 日预报 + 趋势：Open-Meteo → 中国天气网 → wttr 3 日 */
async function buildForecast7(context) {
  const { wttrJson, coord, prefs, city, opts, timeoutMs } = context;
  const debug = opts._debug || {};
  const base = {
    forecast7: null,
    trend: null,
    forecast7Source: null,
    forecast7Fallback: false,
    forecast7CodeType: null,
  };
  // 1) 主源：Open-Meteo（需要经纬度）
  if (coord) {
    try {
      const om = await fetchOpenMeteo(coord.lat, coord.lon, timeoutMs, !!opts._forceOpenMeteoFail);
      const trend = computeTrend(om.list);
      return { ...base, forecast7: om.list, trend, forecast7Source: 'open-meteo', forecast7CodeType: om.codeType };
    } catch (e) {
      base.openMeteoError = String(e && e.message ? e.message : e);
    }
  } else {
    base.openMeteoError = '缺少经纬度（wttr.in 未返回 nearest_area）';
  }
  // 2) 中国天气网 7 天 HTML（需城市 code）
  try {
    const codeInfo = resolveCityCode(city, prefs, opts);
    if (!codeInfo) throw new Error('无对应中国天气网城市 code');
    const cn = await fetchWeatherCnHtml(codeInfo.code, timeoutMs, !!opts._forceHtmlFail);
    const trend = computeTrend(cn.list);
    return {
      ...base,
      forecast7: cn.list,
      trend,
      forecast7Source: WEATHER_CN_HOST,
      forecast7Fallback: true,
      forecast7CodeType: cn.codeType,
      cityCode: codeInfo.code,
    };
  } catch (e) {
    base.htmlError = String(e && e.message ? e.message : e);
  }
  // 3) 兜底：wttr.in 3 日
  if (wttrJson) {
    const w = forecast7FromWttr(wttrJson);
    if (w.list.length) {
      const trend = computeTrend(w.list);
      return {
        ...base,
        forecast7: w.list,
        trend,
        forecast7Source: 'wttr.in(3日)',
        forecast7Fallback: true,
        forecast7CodeType: w.codeType,
      };
    }
  }
  return base;
}

/** 为已标准化的数据补充 forecast7/trend */
function attachForecast7(data, extra) {
  data.forecast7 = extra.forecast7;
  data.trend = extra.trend;
  data.forecast7Source = extra.forecast7Source;
  data.forecast7Fallback = !!extra.forecast7Fallback;
  data.forecast7CodeType = extra.forecast7CodeType || null;
  if (extra.cityCode) data.cityCode = extra.cityCode;
  if (extra.openMeteoError) data.forecast7Error = extra.openMeteoError;
  return data;
}

/**
 * wttr.in 完全不可用且无缓存时的降级：仅返回 7 日预报（Open-Meteo 坐标来自配置，或中国天气网 HTML）
 */
async function degradedForecastOnly(opts, prefs, city, timeoutMs) {
  const pw = (prefs && prefs.weather) || {};
  const lat = toNum(opts.latitude !== undefined ? opts.latitude : pw.latitude, NaN);
  const lon = toNum(opts.longitude !== undefined ? opts.longitude : pw.longitude, NaN);
  let forecast7 = null;
  let trend = null;
  let source = null;
  let codeType = null;
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    try {
      const om = await fetchOpenMeteo(lat, lon, timeoutMs, !!opts._forceOpenMeteoFail);
      forecast7 = om.list;
      trend = computeTrend(om.list);
      source = 'open-meteo';
      codeType = om.codeType;
    } catch (e) { /* ignore */ }
  }
  if (!forecast7) {
    try {
      const codeInfo = resolveCityCode(city, prefs, opts);
      if (!codeInfo) throw new Error('无对应中国天气网城市 code');
      const cn = await fetchWeatherCnHtml(codeInfo.code, timeoutMs, !!opts._forceHtmlFail);
      forecast7 = cn.list;
      trend = computeTrend(cn.list);
      source = WEATHER_CN_HOST;
      codeType = cn.codeType;
    } catch (e) { /* ignore */ }
  }
  if (!forecast7) return null;
  return {
    ok: true,
    city: city || pw.city || '',
    area: '',
    country: '',
    resolvedCity: city || pw.city || '未知',
    query: city || 'auto',
    autoLocate: false,
    coord: Number.isFinite(lat) ? { lat, lon } : null,
    updatedAt: new Date().toISOString(),
    observationTime: '',
    current: null,
    forecast: forecast3From7(forecast7),
    forecast7: forecast7,
    trend,
    forecast7Source: source,
    forecast7Fallback: true,
    forecast7CodeType: codeType,
    source: source,
    cacheTtlSec: Math.floor(CACHE_TTL_MS / 1000),
    stale: false,
    cached: false,
    degraded: true,
    warning: 'wttr.in 当前实时天气不可用，仅返回 7 日预报（趋势可用）',
    note: '天气数据仅供生活参考',
  };
}

/**
 * 获取天气（v2：wttr.in 实时/3日 + Open-Meteo 7日 + 趋势）
 * @param {object|string} opts {city?, autoLocate?, forceRefresh?, timeoutMs?, cityCode?, latitude?, longitude?,
 *                              _forceWttrFail?, _forceOpenMeteoFail?, _forceHtmlFail?（后三者仅自测调试用）} 或直接传城市名
 */
async function getWeather(opts) {
  const options = typeof opts === 'string' ? { city: opts } : opts && typeof opts === 'object' ? opts : {};
  const prefs = readPreferences();
  const prefWeather = prefs.weather || {};
  const requestedCity = typeof options.city === 'string' ? options.city.trim() : '';
  const city = requestedCity || prefWeather.city || '';
  const autoLocate = options.autoLocate !== undefined ? !!options.autoLocate : prefWeather.autoLocate !== false;
  const forceRefresh = !!options.forceRefresh;
  const timeoutMs = toNum(options.timeoutMs, DEFAULT_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;
  const key = city ? `city:${city}` : 'auto';
  const query = city || '';

  const cache = loadCache();
  const nowMs = Date.now();
  const cacheAgeMs = cache && cache.fetchedAt ? nowMs - new Date(cache.fetchedAt).getTime() : Infinity;

  // 命中新鲜缓存（仅 v2 缓存，且包含 forecast7/trend）；兜底质量缓存超过 1 分钟后尝试静默刷新
  const freshCacheUsable =
    !forceRefresh && cache && cache.version === CACHE_VERSION && cache.key === key &&
    cacheAgeMs >= 0 && cacheAgeMs < CACHE_TTL_MS && cache.data && cache.data.forecast7;
  if (freshCacheUsable) {
    const fallbackCache = !!cache.data.forecast7Fallback;
    if (!fallbackCache || cacheAgeMs < 60 * 1000) {
      return { ...cache.data, stale: false, cached: true, cacheAgeSec: Math.floor(cacheAgeMs / 1000) };
    }
    // 兜底缓存较旧：继续往下尝试重新拉取主数据，失败时仍返回该缓存
  }

  try {
    const fetchedAt = new Date().toISOString();
    const wttrJson = await fetchWttrJson(query, timeoutMs, !!options._forceWttrFail);
    const data = normalizeJ1(wttrJson, { query: city || 'auto', autoLocate, fetchedAt });
    const coord = data.coord || extractCoord(wttrJson);
    // 中国天气网兜底需要城市名：优先请求城市，其次 wttr 解析出的实际城市（自动定位场景）
    const cityForCode = city || data.city || (data.resolvedCity || '').split(',')[0].trim();
    const extra = await buildForecast7({ wttrJson, coord, prefs, city: cityForCode, opts: options, timeoutMs });
    attachForecast7(data, extra);
    saveCache(key, data);
    return data;
  } catch (e) {
    const msg = String(e && e.message ? e.message : e);
    // a) 新鲜但为兜底的缓存：直接返回（不算 stale）
    if (freshCacheUsable) {
      return {
        ...cache.data,
        ok: true,
        stale: false,
        cached: true,
        refreshError: msg,
        warning: '主数据源暂时不可用，返回缓存中的兜底预报',
        cacheAgeSec: Math.floor(cacheAgeMs / 1000),
      };
    }
    // b) 同城市旧缓存降级
    if (cache && cache.data && cache.key === key) {
      const staleAgeSec = cacheAgeMs === Infinity ? null : Math.floor(cacheAgeMs / 1000);
      return {
        ...cache.data,
        ok: true,
        stale: true,
        cached: true,
        error: msg,
        warning: '天气接口暂时不可用，以下为最近一次缓存数据',
        updatedAt: cache.fetchedAt || cache.data.updatedAt,
        cacheAgeSec: staleAgeSec,
      };
    }
    // b) 无缓存：尝试仅 7 日预报（配置坐标 / 中国天气网 HTML）
    try {
      const degraded = await degradedForecastOnly(options, prefs, city, timeoutMs);
      if (degraded) {
        degraded.error = msg;
        return degraded;
      }
    } catch (e2) { /* ignore */ }
    return {
      ok: false,
      error: `天气数据获取失败：${msg}`,
      source: SOURCE,
      query: city || 'auto',
      city: city || '',
      stale: false,
      fetchedAt: new Date().toISOString(),
      forecast7Source: null,
      note: '天气数据来自 wttr.in + Open-Meteo，仅供生活参考',
    };
  }
}

module.exports = {
  getWeather,
  WEATHER_CODE_ZH,
  WMO_MAP,
  CITY_CODE,
  descZhFromWwo,
  computeTrend,
  forecast7FromWttr,
  fetchOpenMeteo,
  fetchWeatherCnHtml,
  decodeHtml,
  CACHE_TTL_MS,
  SOURCE,
};
