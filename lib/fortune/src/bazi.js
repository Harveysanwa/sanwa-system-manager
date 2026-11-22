'use strict';

/**
 * 八字模块：公历 → 农历 → 四柱（年月日时干支）
 * 基于 vendored lunar-javascript（6tail，MIT）的 EightChar：
 * 四柱 / 藏干 / 十神（简化） / 五行统计 / 纳音 / 长生十二宫 / 旬空 / 日主简评 / 生肖 / 起运
 * 时辰说明：按北京时间（东八区）计算，未做真太阳时（经度时差）校正。
 */

const { requireVendor, formatDate } = require('./util');

const NOTE = '仅供娱乐';
const TIME_NOTE = '按北京时间（东八区）计算，未做真太阳时（经度时差与均时差）校正；晚子时（23:00-23:59）默认流派2：日柱算当天、时柱按次日子时，切流派请在 opts.sect 传 1（日柱算次日）';

const GAN_WUXING = { 甲: '木', 乙: '木', 丙: '火', 丁: '火', 戊: '土', 己: '土', 庚: '金', 辛: '金', 壬: '水', 癸: '水' };
const ZHI_WUXING = {
  寅: '木', 卯: '木', 巳: '火', 午: '火', 辰: '土', 丑: '土', 戌: '土', 未: '土', 申: '金', 酉: '金', 亥: '水', 子: '水',
};
const ZODIAC_BY_ZHI = {
  子: '鼠', 丑: '牛', 寅: '虎', 卯: '兔', 辰: '龙', 巳: '蛇',
  午: '马', 未: '羊', 申: '猴', 酉: '鸡', 戌: '狗', 亥: '猪',
};
const YANG_GAN = new Set(['甲', '丙', '戊', '庚', '壬']);
const SHENG = { 木: '火', 火: '土', 土: '金', 金: '水', 水: '木' }; // a 生 SHENG[a]
const KE = { 木: '土', 土: '水', 水: '火', 火: '金', 金: '木' }; // a 克 KE[a]
const WUXING_KEYS = ['jin', 'mu', 'shui', 'huo', 'tu'];
const WUXING_CN = { jin: '金', mu: '木', shui: '水', huo: '火', tu: '土' };
const CN2KEY = { 金: 'jin', 木: 'mu', 水: 'shui', 火: 'huo', 土: 'tu' };

function getLunarLib() {
  return requireVendor('vendor/lunar.js');
}

function parseGender(g) {
  if (g === undefined || g === null || g === '') return { gender: 'male', inferred: true };
  const s = String(g).trim().toLowerCase();
  if (['male', 'm', '男', '1', 'boy', '乾'].includes(s)) return { gender: 'male', inferred: false };
  if (['female', 'f', '女', '0', 'girl', '坤'].includes(s)) return { gender: 'female', inferred: false };
  return null;
}

/** 解析 'YYYY-MM-DD HH:mm'（兼容 'YYYY/MM/DD HH:mm'、'YYYY-MM-DD HH:mm:ss'、纯日期、Date 对象） */
function parseBirth(birth) {
  if (birth === undefined || birth === null || birth === '') return null;
  if (birth instanceof Date) {
    if (isNaN(birth.getTime())) return null;
    const y = birth.getFullYear();
    const mo = birth.getMonth() + 1;
    const d = birth.getDate();
    const hh = birth.getHours();
    const mi = birth.getMinutes();
    const ss = birth.getSeconds();
    return {
      y, m: mo, d, hh, mi, ss,
      hasTime: true,
      normalized: `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')} ${String(hh).padStart(2, '0')}:${String(mi).padStart(2, '0')}`,
      date: birth,
    };
  }
  const s = String(birth).trim();
  const m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/.exec(s);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const hh = m[4] === undefined ? 12 : Number(m[4]);
  const mi = m[5] === undefined ? 0 : Number(m[5]);
  const ss = m[6] === undefined ? 0 : Number(m[6]);
  if (y < 1900 || y > 2200) return null;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  if (hh < 0 || hh > 23 || mi < 0 || mi > 59 || ss < 0 || ss > 59) return null;
  const dt = new Date(y, mo - 1, d, hh, mi, ss);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return {
    y, m: mo, d, hh, mi, ss,
    hasTime: m[4] !== undefined,
    normalized: `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')} ${String(hh).padStart(2, '0')}:${String(mi).padStart(2, '0')}`,
    date: dt,
  };
}

/** 日主强弱/喜用倾向的简化判断（娱乐口径，不构成专业命理结论） */
function judgeDayMaster(dayGan, wuxing) {
  const me = GAN_WUXING[dayGan];
  const shengMe = Object.keys(SHENG).find((k) => SHENG[k] === me); // 生我者
  const woSheng = SHENG[me];
  const woKe = KE[me];
  const keMe = Object.keys(KE).find((k) => KE[k] === me); // 克我者
  const cnt = (el) => (el ? wuxing[CN2KEY[el]] || 0 : 0);
  const support = cnt(me) + cnt(shengMe);
  const drain = cnt(woSheng) + cnt(woKe) + cnt(keMe);
  let strength;
  if (support >= drain + 2) strength = '偏强';
  else if (drain >= support + 2) strength = '偏弱';
  else strength = '中和';
  let likes;
  if (strength === '偏强') likes = [woKe, woSheng, keMe].filter(Boolean);
  else if (strength === '偏弱') likes = [me, shengMe].filter(Boolean);
  else likes = [me, shengMe].filter(Boolean);
  const yinYang = YANG_GAN.has(dayGan) ? '阳' : '阴';
  const comment = `日主${dayGan}${me}（${yinYang}${me}），同类（比劫+印）${support}、异类（食伤+财+官杀）${drain}，日主${strength}。`;
  return {
    gan: dayGan,
    wuxing: me,
    yinYang,
    shengMe,
    woSheng,
    woKe,
    keMe,
    support,
    drain,
    strength,
    likes,
    comment,
  };
}

/**
 * 获取八字
 * @param {{birth:string, gender?:'male'|'female', sect?:number}} opts
 */
async function getBazi(opts) {
  const options = opts && typeof opts === 'object' ? opts : {};
  const birth = parseBirth(options.birth);
  if (!birth) {
    return { ok: false, error: '出生时间格式无效，请使用 "YYYY-MM-DD HH:mm"（如 1990-01-01 08:00）' };
  }
  const genderInfo = parseGender(options.gender);
  if (!genderInfo) {
    return { ok: false, error: '性别参数无效，请使用 "male" 或 "female"' };
  }

  const L = getLunarLib();
  const solar = L.Solar.fromYmdHms(birth.y, birth.m, birth.d, birth.hh, birth.mi, birth.ss);
  const lunar = solar.getLunar();
  const ec = lunar.getEightChar();
  const sect = typeof options.sect === 'number' && (options.sect === 1 || options.sect === 2) ? options.sect : ec.getSect();
  if (sect !== ec.getSect()) ec.setSect(sect);

  const labels = ['年柱', '月柱', '日柱', '时柱'];
  const ganzhi = [ec.getYear(), ec.getMonth(), ec.getDay(), ec.getTime()];
  const gans = [ec.getYearGan(), ec.getMonthGan(), ec.getDayGan(), ec.getTimeGan()];
  const zhis = [ec.getYearZhi(), ec.getMonthZhi(), ec.getDayZhi(), ec.getTimeZhi()];
  const hides = [ec.getYearHideGan(), ec.getMonthHideGan(), ec.getDayHideGan(), ec.getTimeHideGan()];
  const ssGan = [ec.getYearShiShenGan(), ec.getMonthShiShenGan(), ec.getDayShiShenGan(), ec.getTimeShiShenGan()];
  const ssZhi = [ec.getYearShiShenZhi(), ec.getMonthShiShenZhi(), ec.getDayShiShenZhi(), ec.getTimeShiShenZhi()];
  const naYin = [ec.getYearNaYin(), ec.getMonthNaYin(), ec.getDayNaYin(), ec.getTimeNaYin()];
  const diShi = [ec.getYearDiShi(), ec.getMonthDiShi(), ec.getDayDiShi(), ec.getTimeDiShi()];
  const xunKong = [ec.getYearXunKong(), ec.getMonthXunKong(), ec.getDayXunKong(), ec.getTimeXunKong()];

  // 五行统计：天干 4 + 地支 4（地支按其本气五行）
  const wuxing = { jin: 0, mu: 0, shui: 0, huo: 0, tu: 0 };
  for (let i = 0; i < 4; i++) {
    wuxing[CN2KEY[GAN_WUXING[gans[i]]]] += 1;
    wuxing[CN2KEY[ZHI_WUXING[zhis[i]]]] += 1;
  }

  const pillars = labels.map((label, i) => {
    const ganWu = GAN_WUXING[gans[i]] || '';
    const zhiWu = ZHI_WUXING[zhis[i]] || '';
    return {
      label,
      ganzhi: ganzhi[i],
      gan: gans[i],
      wuxing: ganWu,
      zhi: zhis[i],
      ganWuxing: ganWu,
      zhiWuxing: zhiWu,
      wuxingPair: `${ganWu}${zhiWu}`,
      hideGan: (hides[i] || []).slice(),
      hideGanWuxing: (hides[i] || []).map((g) => GAN_WUXING[g] || ''),
      shiShenGan: ssGan[i],
      shiShenZhi: (ssZhi[i] || []).slice(),
      naYin: naYin[i],
      diShi: diShi[i],
      xunKong: xunKong[i],
      yinYang: YANG_GAN.has(gans[i]) ? '阳' : '阴',
    };
  });

  const missing = WUXING_KEYS.filter((k) => !wuxing[k]).map((k) => WUXING_CN[k]);
  const dayGan = gans[2];
  const dm = judgeDayMaster(dayGan, wuxing);
  const yearZhi = zhis[0];
  const zodiac = ZODIAC_BY_ZHI[yearZhi] || lunar.getYearShengXiao();

  let yun = null;
  try {
    const y = ec.getYun(genderInfo.gender === 'male' ? 1 : 0);
    const startSolar = y.getStartSolar();
    yun = {
      genderBasis: genderInfo.gender,
      forward: typeof y.isForward === 'function' ? y.isForward() : undefined,
      startAge: `${y.getStartYear()}年${y.getStartMonth()}个月${y.getStartDay()}天`,
      startDate: formatDate(new Date(startSolar.getYear(), startSolar.getMonth() - 1, startSolar.getDay())),
      note: '起运时间按传统排法估算，未做真太阳时校正',
    };
  } catch (e) { /* 起运计算失败不影响主体 */ }

  const wuxingText = WUXING_KEYS.map((k) => `${WUXING_CN[k]}${wuxing[k]}`).join(' ');
  const summary =
    `公历 ${birth.normalized}（${genderInfo.gender === 'male' ? '男' : '女'}）生，农历${lunar.toString()}。` +
    `四柱：${ganzhi.join(' ')}；日主${dayGan}${dm.wuxing}，五行 [${wuxingText}]，${missing.length ? '缺' + missing.join('、') : '五行俱全'}。` +
    `日主${dm.strength}，喜用倾向：${dm.likes.join('、')}（简化判断）。` +
    (birth.hasTime ? '已按所填时辰排四柱。' : '未填出生时刻，时柱按 12:00（午时）估算，请补全时间以提高准确度。');

  return {
    ok: true,
    birth: birth.normalized,
    birthHasTime: birth.hasTime,
    gender: genderInfo.gender,
    genderText: genderInfo.gender === 'male' ? '男' : '女',
    genderInferred: genderInfo.inferred,
    sect,
    lunar: {
      date: lunar.toString(),
      year: lunar.getYear(),
      month: Math.abs(lunar.getMonth()),
      day: lunar.getDay(),
      isLeap: lunar.getMonth() < 0,
      yearCN: lunar.getYearInChinese(),
    },
    pillars,
    fourPillars: ganzhi.slice(),
    wuxing,
    wuxingText,
    missing,
    nayin: naYin,
    dayMaster: `${dayGan}${dm.wuxing}`,
    dayMasterDetail: dm,
    zodiac,
    yearZhi,
    yun,
    taiYuan: ec.getTaiYuan ? ec.getTaiYuan() : '',
    mingGong: ec.getMingGong ? ec.getMingGong() : '',
    shenGong: ec.getShenGong ? ec.getShenGong() : '',
    xunKong,
    summary,
    timeNote: TIME_NOTE,
    note: NOTE,
    source: 'lunar-javascript',
  };
}

module.exports = { getBazi, GAN_WUXING, ZHI_WUXING, WUXING_CN, NOTE };
