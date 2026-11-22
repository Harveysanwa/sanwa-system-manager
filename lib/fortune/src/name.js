'use strict';

/**
 * 姓名模块：五格剖象 + 三才配置 + 字五行 + 评分
 * 笔画数据：lib\fortune\data\strokes.json（静态数据，构建时由 cnchar + cnchar-info 提炼，覆盖 GB2312 常用字 6763 个，实际收录 9500+ 字；来源与许可见 vendor/cnchar.LICENSE）
 * 运行时缺字降级：先查笔画表，再尝试 vendored cnchar（vendor/cnchar.min.js + cnchar.info.min.js）；
 * 仍查不到则记入 missing[]，不抛异常。
 * 说明：五格笔画采用简体本字笔画（非康熙字典笔画），数理吉凶取自常见 81 数理表，仅供娱乐。
 */

const fs = require('fs');
const path = require('path');
const {
  requireVendor, loadStaticData, dataFile, readJsonSafe, clamp,
} = require('./util');

const NOTE = '仅供娱乐';
const STROKE_BASIS = '简体笔画（cnchar 数据，非康熙字典繁体笔画）';

/** 常见五格 81 数理吉凶：J=吉 B=半吉 X=凶 */
const SHULI_GRADE = {
  1: 'J', 2: 'X', 3: 'J', 4: 'X', 5: 'J', 6: 'J', 7: 'J', 8: 'J', 9: 'X', 10: 'X',
  11: 'J', 12: 'X', 13: 'J', 14: 'X', 15: 'J', 16: 'J', 17: 'J', 18: 'J', 19: 'X', 20: 'X',
  21: 'J', 22: 'X', 23: 'J', 24: 'J', 25: 'J', 26: 'X', 27: 'B', 28: 'X', 29: 'J', 30: 'B',
  31: 'J', 32: 'J', 33: 'J', 34: 'X', 35: 'J', 36: 'X', 37: 'J', 38: 'B', 39: 'J', 40: 'X',
  41: 'J', 42: 'B', 43: 'X', 44: 'X', 45: 'J', 46: 'X', 47: 'J', 48: 'J', 49: 'X', 50: 'X',
  51: 'B', 52: 'J', 53: 'B', 54: 'X', 55: 'B', 56: 'X', 57: 'J', 58: 'B', 59: 'X', 60: 'X',
  61: 'J', 62: 'X', 63: 'J', 64: 'X', 65: 'J', 66: 'X', 67: 'J', 68: 'J', 69: 'X', 70: 'X',
  71: 'B', 72: 'X', 73: 'J', 74: 'X', 75: 'B', 76: 'X', 77: 'B', 78: 'B', 79: 'X', 80: 'X', 81: 'J',
};
const GRADE_TEXT = { J: '吉', B: '半吉', X: '凶' };
const GRADE_SCORE = { J: 92, B: 72, X: 52 };

/** 数理五行：个位 1/2 木、3/4 火、5/6 土、7/8 金、9/0 水 */
function shuliWuxing(n) {
  const last = Math.abs(Number(n)) % 10;
  if (last === 1 || last === 2) return '木';
  if (last === 3 || last === 4) return '火';
  if (last === 5 || last === 6) return '土';
  if (last === 7 || last === 8) return '金';
  return '水';
}

const SHENG = { 木: '火', 火: '土', 土: '金', 金: '水', 水: '木' };
const KE = { 木: '土', 土: '水', 水: '火', 火: '金', 金: '木' };

function relation(a, b) {
  if (!a || !b) return '未知';
  if (a === b) return '比和';
  if (SHENG[a] === b) return '相生';
  if (KE[a] === b) return '相克';
  if (SHENG[b] === a) return '相生';
  if (KE[b] === a) return '相克';
  return '未知';
}

/** 三才配置（天格/人格/地格五行）吉凶：以相邻生克简化判断 */
function judgeSancai(tianW, renW, diW) {
  const r1 = relation(tianW, renW);
  const r2 = relation(renW, diW);
  const good = (r) => r === '相生' || r === '比和';
  const bad = (r) => r === '相克';
  const nGood = (good(r1) ? 1 : 0) + (good(r2) ? 1 : 0);
  const nBad = (bad(r1) ? 1 : 0) + (bad(r2) ? 1 : 0);
  let luck;
  if (nBad === 0) luck = '吉';
  else if (nBad === 2) luck = '凶';
  else luck = '中平';
  const config = `${tianW}${renW}${diW}`;
  let desc;
  if (luck === '吉') desc = `三才配置${config}：天气场与人格、人格与地格相生或比和，基础稳固、人缘与行动配合较顺。`;
  else if (luck === '凶') desc = `三才配置${config}：上下气场相克较多，行事易受牵制，宜以柔和与耐心化解。`;
  else desc = `三才配置${config}：生克参半，顺境与阻力并存，扬长避短可渐入佳境。`;
  return { tian: tianW, ren: renW, di: diW, config, luck, relations: { tianRen: r1, renDi: r2 }, desc };
}

let _strokeTable = null;
let _strokeTableTried = false;

/** 加载 data\fortune\strokes.json（首次调用读文件，之后内存缓存） */
function getStrokeTable() {
  if (_strokeTableTried) return _strokeTable;
  _strokeTableTried = true;
  // 优先读取随模块交付的静态笔画表 lib/fortune/data/strokes.json；
  // 兼容旧版运行时数据目录 data/fortune/strokes.json。
  const candidates = [path.join(__dirname, '..', 'data', 'strokes.json'), dataFile('strokes.json')];
  const file = candidates.find((f) => { try { return fs.existsSync(f); } catch (e) { return false; } }) || candidates[0];
  let obj = null;
  try {
    if (fs.existsSync(file)) obj = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    obj = null;
  }
  _strokeTable = obj && obj.chars && typeof obj.chars === 'object' ? obj.chars : null;
  return _strokeTable;
}

let _cnchar = null;
let _cncharTried = false;

/** 懒加载 vendored cnchar 作为缺字的兜底笔画/五行来源 */
function getCnchar() {
  if (_cncharTried) return _cnchar;
  _cncharTried = true;
  try {
    const c = requireVendor('vendor/cnchar.min.js');
    try {
      const info = requireVendor('vendor/cnchar.info.min.js');
      if (info && typeof c.use === 'function') c.use(info);
    } catch (e) { /* info 插件加载失败不影响笔画查询 */ }
    _cnchar = c;
  } catch (e) {
    _cnchar = null;
  }
  return _cnchar;
}

/** 查单字 {stroke, wuxing, source} */
function lookupChar(ch) {
  const strokeTable = getStrokeTable();
  if (strokeTable && Object.prototype.hasOwnProperty.call(strokeTable, ch)) {
    const entry = strokeTable[ch];
    if (Array.isArray(entry)) {
      const stroke = Number(entry[0]) || 0;
      const wuxing = entry[1] || '';
      return { stroke, wuxing: wuxing || shuliWuxing(stroke), wuxingSource: wuxing ? '字五行' : '数理五行', source: 'strokes.json' };
    }
  }
  const c = getCnchar();
  if (c) {
    let stroke = 0;
    try {
      const r = c.stroke(ch);
      stroke = Array.isArray(r) ? Number(r[0]) : Number(r);
      if (!Number.isFinite(stroke)) stroke = 0;
    } catch (e) { stroke = 0; }
    let wuxing = '';
    try {
      const inf = c.info(ch);
      if (Array.isArray(inf) && inf[0] && inf[0].fiveElement) wuxing = inf[0].fiveElement;
    } catch (e) { wuxing = ''; }
    if (stroke > 0) {
      return { stroke, wuxing: wuxing || shuliWuxing(stroke), wuxingSource: wuxing ? '字五行' : '数理五行', source: 'cnchar(vendor)' };
    }
  }
  return { stroke: 0, wuxing: '', wuxingSource: '缺', source: 'missing' };
}

/** 五格计算（支持单/复姓、单/双/多名） */
function calcWuge(strokes, surnameLen, givenLen) {
  const total = strokes.reduce((a, b) => a + b, 0);
  const sumFirst = (arr) => arr.reduce((a, b) => a + b, 0);
  const surnameStrokes = strokes.slice(0, surnameLen);
  const givenStrokes = strokes.slice(surnameLen);
  const tian = sumFirst(surnameStrokes) + (surnameLen === 1 ? 1 : 0);
  const ren = (surnameStrokes[surnameLen - 1] || 0) + (givenStrokes[0] || 0);
  const di = sumFirst(givenStrokes) + (givenLen === 1 ? 1 : 0);
  const zong = total;
  const wai = zong - ren + (surnameLen === 1 ? 1 : 0) + (givenLen === 1 ? 1 : 0);
  return { tian, ren, di, wai, zong };
}

function gradeOfScore(score) {
  if (score >= 90) return 'A+';
  if (score >= 85) return 'A';
  if (score >= 78) return 'B+';
  if (score >= 70) return 'B';
  if (score >= 62) return 'C+';
  if (score >= 55) return 'C';
  return 'D';
}
function gradeTextOfScore(score) {
  if (score >= 90) return '大吉';
  if (score >= 85) return '吉';
  if (score >= 78) return '中吉';
  if (score >= 70) return '小吉';
  if (score >= 55) return '中平';
  return '欠佳';
}

/**
 * 姓名分析
 * @param {{surname:string, given:string, given2?:string}} opts
 */
async function analyzeName(opts) {
  const options = opts && typeof opts === 'object' ? opts : {};
  const surname = options.surname === undefined || options.surname === null ? '' : String(options.surname).trim();
  const given = options.given === undefined || options.given === null ? '' : String(options.given).trim();
  if (!surname || !given) {
    return { ok: false, error: '姓名参数无效：surname 与 given 均不能为空（如 {surname:"张", given:"三"}）' };
  }
  const surnameChars = Array.from(surname);
  const givenChars = Array.from(given);
  if (surnameChars.length > 2) {
    return { ok: false, error: '暂只支持单姓或复姓（1-2 个汉字）' };
  }
  if (givenChars.length > 3) {
    return { ok: false, error: '名字最多支持 3 个汉字' };
  }
  const allChars = [...surnameChars, ...givenChars];
  const missing = [];
  const chars = allChars.map((ch, i) => {
    const info = lookupChar(ch);
    if (!info.stroke) missing.push(ch);
    return {
      char: ch,
      stroke: info.stroke,
      wuxing: info.wuxing,
      wuxingSource: info.wuxingSource,
      source: info.source,
      position: i < surnameChars.length ? '姓' : '名',
      index: i,
    };
  });

  const wuge = calcWuge(chars.map((c) => c.stroke), surnameChars.length, givenChars.length);
  const wugeWuxing = {
    tian: shuliWuxing(wuge.tian),
    ren: shuliWuxing(wuge.ren),
    di: shuliWuxing(wuge.di),
    wai: shuliWuxing(wuge.wai),
    zong: shuliWuxing(wuge.zong),
  };
  const shuli = {};
  for (const k of ['tian', 'ren', 'di', 'wai', 'zong']) {
    const num = wuge[k];
    const grade = SHULI_GRADE[Math.min(81, Math.max(1, num))] || 'X';
    shuli[k] = { num, grade, gradeText: GRADE_TEXT[grade] };
  }
  const sancai = judgeSancai(wugeWuxing.tian, wugeWuxing.ren, wugeWuxing.di);

  // 综合分：五格数理加权 + 三才调整
  const weights = { tian: 0.15, ren: 0.3, di: 0.2, wai: 0.15, zong: 0.2 };
  let score = 0;
  for (const k of Object.keys(weights)) score += GRADE_SCORE[shuli[k].grade] * weights[k];
  score += sancai.luck === '吉' ? 5 : sancai.luck === '凶' ? -8 : -2;
  score = Math.round(clamp(score, 30, 99));

  const nameWuxingCount = {};
  for (const c of chars) {
    if (c.wuxing) nameWuxingCount[c.wuxing] = (nameWuxingCount[c.wuxing] || 0) + 1;
  }
  const nameWuxingText = Object.keys(nameWuxingCount).length
    ? Object.entries(nameWuxingCount).map(([k, v]) => `${k}${v}`).join(' ')
    : '五行未知';

  const grade = gradeOfScore(score);
  const gradeText = gradeTextOfScore(score);
  const incomplete = missing.length > 0;
  const parts = [
    `「${surname}${given}」`,
    `五格：天格${wuge.tian}(${shuli.tian.gradeText}) 人格${wuge.ren}(${shuli.ren.gradeText}) 地格${wuge.di}(${shuli.di.gradeText}) 外格${wuge.wai}(${shuli.wai.gradeText}) 总格${wuge.zong}(${shuli.zong.gradeText})`,
    `三才${sancai.config}（${sancai.luck}），字五行：${nameWuxingText}`,
    `综合评分 ${score} 分，等级 ${grade}（${gradeText}）`,
  ];
  if (incomplete) parts.push(`缺字笔画未收录：${missing.join('、')}（已按 0 画降级计算，结果仅供参考）`);

  return {
    ok: true,
    surname,
    given,
    fullName: `${surname}${given}`,
    chars,
    strokes: chars.map((c) => c.stroke),
    totalStrokes: wuge.zong,
    wuge,
    wugeWuxing,
    shuli,
    sancai,
    nameWuxing: nameWuxingCount,
    nameWuxingText,
    score,
    grade,
    gradeText,
    summary: parts.join('；') + '。',
    missing,
    incomplete,
    strokeBasis: STROKE_BASIS,
    note: NOTE,
    source: 'cnchar 笔画 + 五格剖象 81 数理',
    ruleNote: '五格剖象为常见姓名学娱乐算法；笔画采用简体本字笔画，未做康熙字典部首补偿，结果不构成取名建议',
  };
}

module.exports = { analyzeName, SHULI_GRADE, shuliWuxing, calcWuge, NOTE };
