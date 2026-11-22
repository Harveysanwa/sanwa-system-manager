'use strict';

/**
 * 抽签模块：六十四卦 · 三枚铜钱摇卦
 * - 每爻投 3 枚铜钱：背=3、字=2，三枚之和得 6/7/8/9（老阴/少阳/少阴/老阳）
 * - 自下而上摇 6 爻，得本卦；有动爻（6/9）则阴阳互变得变卦
 * 卦辞/彖辞/象辞/爻辞取自《周易》通行本（公有领域文本），白话卦意为原创/开源 MIT 数据。
 */

const crypto = require('crypto');
const { loadStaticData, formatDateTime } = require('./util');

const NOTE = '仅供娱乐';
const COIN_NAMES = { 3: '背', 2: '字' };
const LINE_TYPE = { 6: '老阴', 7: '少阳', 8: '少阴', 9: '老阳' };

let _index = null;

function getIndex() {
  if (_index) return _index;
  const data = loadStaticData('lots.json');
  const byKey = new Map();
  const byNumber = new Map();
  for (const h of data.hexagrams) {
    byKey.set(h.key, h);
    byNumber.set(h.n, h);
  }
  _index = { list: data.hexagrams, byKey, byNumber };
  return _index;
}

/** 投三枚铜钱 → 6/7/8/9 */
function tossLine() {
  const coins = [];
  let sum = 0;
  for (let i = 0; i < 3; i++) {
    const heads = crypto.randomInt(0, 2) === 1; // 50% 背/字
    const v = heads ? 3 : 2;
    coins.push(COIN_NAMES[v]);
    sum += v;
  }
  return { coins, value: sum, type: LINE_TYPE[sum] };
}

/** 由「自下而上的 6 爻阴阳(1/0)」查卦 */
function lookupByLines(bottomToTop) {
  const { byKey } = getIndex();
  const upperTB = [bottomToTop[5], bottomToTop[4], bottomToTop[3]].join('');
  const lowerTB = [bottomToTop[2], bottomToTop[1], bottomToTop[0]].join('');
  return byKey.get(upperTB + lowerTB) || null;
}

const POS_NAMES = ['初', '二', '三', '四', '五', '上'];
const POS_CN = ['第一爻', '第二爻', '第三爻', '第四爻', '第五爻', '第六爻'];

function yaoName(pos, isYang) {
  const num = isYang ? '九' : '六';
  if (pos === 0) return `初${num}`;
  if (pos === 5) return `上${num}`;
  return `${num}${POS_NAMES[pos]}`;
}

function levelOf(score) {
  if (score >= 90) return '大吉';
  if (score >= 80) return '吉';
  if (score >= 70) return '中吉';
  if (score >= 60) return '小吉';
  if (score >= 50) return '平';
  return '凶';
}

function hexBrief(h) {
  return {
    number: h.n,
    name: h.name,
    fullName: h.fullName,
    symbol: h.symbol,
    upper: h.upper.name,
    lower: h.lower.name,
    judgement: { level: h.level, score: h.score },
    guaCi: h.guaCi,
    plain: h.plain,
    advice: h.advice,
  };
}

/**
 * 抽签（三枚铜钱摇卦）
 * @param {object} [opts]
 * @param {number} [opts.seedHint] 保留参数（当前使用 crypto 真随机，不使用种子）
 */
async function drawLot(opts) {
  const options = opts && typeof opts === 'object' ? opts : {};
  const { list } = getIndex();

  // 摇卦：自下而上 6 爻
  const tosses = [];
  for (let i = 0; i < 6; i++) tosses.push(tossLine());
  const values = tosses.map((t) => t.value);
  const benLines = values.map((v) => (v === 7 || v === 9 ? 1 : 0));
  const ben = lookupByLines(benLines);
  if (!ben) throw new Error('卦象查找失败（内部数据错误）');

  const moving = [];
  const castDetail = values.map((v, i) => {
    const movingFlag = v === 6 || v === 9;
    if (movingFlag) moving.push(i + 1);
    return {
      position: i + 1,
      positionName: POS_CN[i],
      coins: tosses[i].coins,
      value: v,
      type: LINE_TYPE[v],
      yinYang: benLines[i] === 1 ? '阳' : '阴',
      lineName: yaoName(i, benLines[i] === 1),
      moving: movingFlag,
      yaoCi: (ben.yaoCi && ben.yaoCi[i]) || '',
    };
  });

  // 变卦：老阴(6)→阳、老阳(9)→阴
  let changed = null;
  let changedDetail = null;
  if (moving.length > 0) {
    const changedValues = values.map((v) => (v === 6 ? 7 : v === 9 ? 8 : v));
    const changedLines = changedValues.map((v) => (v === 7 || v === 9 ? 1 : 0));
    const ch = lookupByLines(changedLines);
    if (ch) {
      changed = hexBrief(ch);
      changedDetail = {
        movingCount: moving.length,
        movingPositions: moving.slice(),
        movingLines: castDetail.filter((x) => x.moving).map((x) => ({ position: x.position, lineName: x.lineName, type: x.type, yaoCi: x.yaoCi })),
        changedName: ch.fullName,
        changedNumber: ch.n,
        changedLines: changedLines,
        changedSymbol: ch.symbol,
      };
    }
  } else {
    changedDetail = { movingCount: 0, movingPositions: [], movingLines: [] };
  }

  // 随机补充一句与本卦相关的吉语/提醒（增加仪式感，内容取自本卦建议）
  const extraTip = (ben.advice || '').slice(0, 60);
  const judgement = { level: ben.level || levelOf(ben.score), score: ben.score };
  const interpretation = [
    ben.plain,
    changed ? `变卦为「${changed.fullName}」：${changed.plain}` : '六爻安静，无动爻，以本卦卦意为主。',
  ].join(' ');
  const advice = changed
    ? `本卦建议：${ben.advice} 变卦提示：${changed.advice}`
    : ben.advice;

  return {
    ok: true,
    at: formatDateTime(new Date()),
    atISO: new Date().toISOString(),
    method: '三枚铜钱摇卦',
    number: ben.n,
    name: ben.name,
    fullName: ben.fullName,
    symbol: ben.symbol,
    upper: ben.upper.name,
    lower: ben.lower.name,
    upperTrigram: ben.upper,
    lowerTrigram: ben.lower,
    lines: values,
    coinTosses: castDetail.map((x) => x.coins),
    cast: castDetail,
    movingLines: moving,
    changed,
    changedDetail,
    judgement,
    guaCi: ben.guaCi,
    xiang: { da: ben.xiangDa, xiao: ben.xiangXiao },
    tuan: ben.tuan,
    yaoCi: ben.yaoCi,
    poem: ben.guaCi,
    interpretation,
    plain: ben.plain,
    career: ben.career,
    wealth: ben.wealth,
    love: ben.love,
    advice,
    tip: extraTip,
    note: NOTE,
    source: '通行本《周易》六十四卦',
    seedHint: options.seedHint,
    dataCount: list.length,
  };
}

module.exports = { drawLot, lookupByLines, yaoName, NOTE };
