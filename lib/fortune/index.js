'use strict';

/**
 * 玄学与天气引擎 · 统一入口
 *
 * 导出 5 个 async 函数：
 *   getWeather(opts?)                       天气（wttr.in，10 分钟缓存）
 *   getAlmanac(dateStr?)                    黄历（农历/干支/宜忌/冲煞/黄道黑道）
 *   drawLot(opts?)                          抽签（64 卦·三枚铜钱摇卦）
 *   getBazi({birth, gender})                八字（四柱/五行/纳音/日主）
 *   analyzeName({surname, given})           姓名（五格/三才/五行/评分）
 *
 * 约定：所有函数永不抛异常，失败返回 {ok:false, error}；全部结果标注「仅供娱乐」。
 * 依赖：lunar-javascript、cnchar、cnchar-info 已 vendored 到 lib\fortune\vendor\（运行时零安装）。
 * 数据：lib\fortune\data\（64 卦、静态数据）与 process.env.SANWA_HOME\data\fortune\（偏好配置/缓存/笔画表）。
 */

const { errMsg } = require('./src/util');

function wrap(name, fn) {
  return async function wrapped(...args) {
    try {
      const ret = await fn(...args);
      if (ret && typeof ret === 'object' && ret.ok === undefined) ret.ok = true;
      return ret;
    } catch (e) {
      return { ok: false, error: `${name} 执行失败：${errMsg(e)}` };
    }
  };
}

const weather = require('./src/weather');
const almanac = require('./src/almanac');
const lots = require('./src/lots');
const bazi = require('./src/bazi');
const name = require('./src/name');

const getWeather = wrap('getWeather', (opts) => weather.getWeather(opts));
const getAlmanac = wrap('getAlmanac', (dateStr) => almanac.getAlmanac(dateStr));
const drawLot = wrap('drawLot', (opts) => lots.drawLot(opts));
const getBazi = wrap('getBazi', (opts) => bazi.getBazi(opts));
const analyzeName = wrap('analyzeName', (opts) => name.analyzeName(opts));

module.exports = {
  getWeather,
  getAlmanac,
  drawLot,
  getBazi,
  analyzeName,
};
