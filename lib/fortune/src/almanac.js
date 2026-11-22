'use strict';

/**
 * 黄历模块：基于 vendored lunar-javascript（6tail，MIT）
 * 农历/干支/生肖/节气/星期/周数/宜忌/冲煞/建除十二神/黄道黑道/吉神凶煞/彭祖百忌/节日
 * 口径说明：黄历展示按「年以立春当日换年、月以节气当日换月、日以公历日」的常用通书口径。
 */

const { requireVendor, parseDate, formatDate, isoWeek, uniq } = require('./util');

const NOTE = '仅供娱乐';

/** 星期中文 */
const WEEK_CN = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

const ZODIAC_BY_ZHI = {
  子: '鼠', 丑: '牛', 寅: '虎', 卯: '兔', 辰: '龙', 巳: '蛇',
  午: '马', 未: '羊', 申: '猴', 酉: '鸡', 戌: '狗', 亥: '猪',
};

function getLunarLib() {
  return requireVendor('vendor/lunar.js');
}

function fmtJieQi(jq) {
  if (!jq || typeof jq.getName !== 'function') return null;
  const solar = jq.getSolar();
  const name = jq.getName();
  return {
    name,
    date: solar.toYmd(),
    datetime: `${solar.toYmd()} ${String(solar.getHour()).padStart(2, '0')}:${String(solar.getMinute()).padStart(2, '0')}`,
    isJie: typeof jq.isJie === 'function' ? jq.isJie() : undefined,
    isQi: typeof jq.isQi === 'function' ? jq.isQi() : undefined,
  };
}

/**
 * 获取黄历
 * @param {string} [dateStr] 'YYYY-MM-DD'，缺省为今天
 */
async function getAlmanac(dateStr) {
  const parsed = parseDate(dateStr);
  if (!parsed) {
    return { ok: false, error: `日期格式无效：${dateStr}，请使用 YYYY-MM-DD` };
  }
  const { y, m, d } = parsed;
  const L = getLunarLib();
  const Solar = L.Solar;
  const solar = Solar.fromYmdHms(y, m, d, 12, 0, 0);
  const lunar = solar.getLunar();

  const monthRaw = lunar.getMonth(); // 闰月为负数
  const isLeap = monthRaw < 0;
  const lunarMonth = Math.abs(monthRaw);
  const monthCnRaw = lunar.getMonthInChinese(); // 正/二/…/十/冬/腊（闰月为“闰二”）
  const monthCN = `${monthCnRaw}月`; // “十月” / “闰二月”
  const dayCN = lunar.getDayInChinese();

  const solarTermName = lunar.getJieQi() || '';
  // 当天之后的下一节气（wholeDay=true：若当天稍晚才有节气，也取再下一个）
  const nextJq = fmtJieQi(lunar.getNextJieQi(true));
  const prevJq = fmtJieQi(lunar.getPrevJieQi(true));

  const chongZodiac = lunar.getDayChongShengXiao();
  // 冲的干支：从 getDayChongDesc（形如 “(甲午)马”）解析完整干支；缺失时退回“冲干+生肖”
  let chongGanZhi = '';
  try {
    const desc = String(lunar.getDayChongDesc() || '');
    const mm = /\(([^)]+)\)/.exec(desc);
    chongGanZhi = mm ? mm[1] : '';
  } catch (e) { chongGanZhi = ''; }
  if (!chongGanZhi) chongGanZhi = `${(lunar.getDayChongGan && lunar.getDayChongGan()) || ''}${ZODIAC_BY_ZHI[chongZodiac] || ''}`;
  const shaDirection = lunar.getDaySha();

  const tianShenType = lunar.getDayTianShenType(); // 黄道 / 黑道
  const tianShen = lunar.getDayTianShen();
  const tianShenLuck = lunar.getDayTianShenLuck && lunar.getDayTianShenLuck();

  const festivals = uniq([
    ...(solar.getFestivals() || []),
    ...(solar.getOtherFestivals() || []),
    ...(lunar.getFestivals() || []),
    ...(lunar.getOtherFestivals() || []),
  ]);

  const week = solar.getWeek(); // 0=周日
  const weekInYear = isoWeek(y, m, d);

  let pengzu = null;
  try {
    pengzu = { gan: lunar.getPengZuGan(), zhi: lunar.getPengZuZhi() };
  } catch (e) { /* ignore */ }

  const yi = (lunar.getDayYi() || []).filter(Boolean);
  const ji = (lunar.getDayJi() || []).filter(Boolean);
  const jiShen = (lunar.getDayJiShen() || []).filter(Boolean);
  const xiongSha = (lunar.getDayXiongSha() || []).filter(Boolean);

  let nineStar = null;
  try {
    const ys = lunar.getYearNineStar();
    const ds = lunar.getDayNineStar();
    nineStar = {
      year: ys && typeof ys.toString === 'function' ? ys.toString() : '',
      day: ds && typeof ds.toString === 'function' ? ds.toString() : '',
    };
  } catch (e) { /* ignore */ }

  return {
    ok: true,
    date: formatDate(new Date(y, m - 1, d)),
    solar: {
      y,
      m,
      d,
      weekday: week,
      weekCN: WEEK_CN[week] || '',
      weekShortCN: solar.getWeekInChinese(),
      weekInYear: weekInYear.week,
      isoWeekYear: weekInYear.year,
      xingZuo: solar.getXingZuo ? solar.getXingZuo() : '',
    },
    lunar: {
      year: lunar.getYear(),
      month: lunarMonth,
      day: lunar.getDay(),
      isLeap,
      monthCN,
      dayCN,
      fullCN: lunar.toString(),
      yearCN: lunar.getYearInChinese ? lunar.getYearInChinese() : '',
    },
    ganzhi: {
      year: lunar.getYearInGanZhiByLiChun(),
      yearBySpring: lunar.getYearInGanZhi(),
      month: lunar.getMonthInGanZhi(),
      day: lunar.getDayInGanZhi(),
      monthInChinese: monthCnRaw,
    },
    zodiac: lunar.getYearShengXiaoByLiChun ? lunar.getYearShengXiaoByLiChun() : lunar.getYearShengXiao(),
    zodiacBySpring: lunar.getYearShengXiao(),
    zodiacByLiChun: lunar.getYearShengXiaoByLiChun ? lunar.getYearShengXiaoByLiChun() : lunar.getYearShengXiao(),
    dayAnimal: lunar.getDayShengXiao ? lunar.getDayShengXiao() : '',
    solarTerm: solarTermName,
    currentJieQi: solarTermName,
    nextSolarTerm: nextJq,
    prevSolarTerm: prevJq,
    huangdao: tianShenType === '黄道',
    dayGod: tianShen,
    dayGodType: tianShenType,
    dayGodLuck: tianShenLuck,
    zhixing: lunar.getZhiXing(),
    yi,
    ji,
    chong: `冲${chongZodiac}${chongGanZhi ? `(${chongGanZhi})` : ''}`,
    sha: `煞${shaDirection}`,
    chongZodiac,
    chongGanzhi: chongGanZhi,
    shaDirection,
    jishen: jiShen,
    xiongsha: xiongSha,
    pengzu,
    xiu: {
      name: lunar.getXiu(),
      luck: lunar.getXiuLuck ? lunar.getXiuLuck() : '',
      song: lunar.getXiuSong ? lunar.getXiuSong() : '',
      zheng: lunar.getZheng ? lunar.getZheng() : '',
      animal: lunar.getAnimal ? lunar.getAnimal() : '',
    },
    yueXiang: lunar.getYueXiang ? lunar.getYueXiang() : '',
    nineStar,
    festivals,
    note: NOTE,
    source: 'lunar-javascript',
    ruleNote: '年按立春当日、月按节气当日换柱（通书口径）；八字四柱请用 getBazi（按节气精确时刻）',
  };
}

module.exports = { getAlmanac, NOTE };
