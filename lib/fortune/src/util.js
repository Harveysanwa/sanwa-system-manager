'use strict';

/**
 * 玄学与天气引擎 · 通用工具
 * 说明：本文件只读写 process.env.SANWA_HOME\data\fortune\ 目录（配置/缓存），不调用 PowerShell，不访问外部 CDN。
 */

const fs = require('fs');
const path = require('path');

/** lib\fortune 目录（本模块根目录） */
const MODULE_DIR = path.resolve(__dirname, '..');
/** 数据目录 process.env.SANWA_HOME\data\fortune */
const DATA_DIR = path.resolve(MODULE_DIR, '../../data/fortune');

/** 依赖懒加载缓存（require 只执行一次，这里再缓存一次取用） */
const requireCache = Object.create(null);

/** 相对模块根目录 require 本地 vendored 依赖 */
function requireVendor(rel) {
  const key = 'vendor:' + rel;
  if (!requireCache[key]) requireCache[key] = require(path.join(MODULE_DIR, rel));
  return requireCache[key];
}

/** 读取 lib\fortune\data 下的静态数据（内存缓存） */
function loadStaticData(name) {
  const key = 'data:' + name;
  if (!requireCache[key]) {
    const file = path.join(MODULE_DIR, 'data', name);
    requireCache[key] = JSON.parse(fs.readFileSync(file, 'utf8'));
  }
  return requireCache[key];
}

function ensureDataDir() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    return true;
  } catch (e) {
    return false;
  }
}

/** 安全读取 JSON，文件不存在/损坏时返回 fallback */
function readJsonSafe(file, fallback) {
  try {
    const text = fs.readFileSync(file, 'utf8');
    return JSON.parse(text);
  } catch (e) {
    return fallback;
  }
}

/** 安全写入 JSON（先写临时文件再 rename，减少写坏风险），失败返回 false 不抛异常 */
function writeJsonSafe(file, value) {
  try {
    if (!ensureDataDir()) return false;
    const suffix = `${process.pid}.${Date.now()}.${Math.floor(Math.random() * 1e6)}`;
    const tmp = `${file}.${suffix}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
    try {
      fs.renameSync(tmp, file);
    } catch (e) {
      // Windows 下 rename 覆盖偶发失败时退回直接写
      fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf8');
      try { fs.unlinkSync(tmp); } catch (e2) { /* ignore */ }
    }
    return true;
  } catch (e) {
    return false;
  }
}

function dataFile(name) {
  return path.join(DATA_DIR, name);
}

/** 默认偏好配置 */
const DEFAULT_PREFERENCES = {
  weather: { city: '', autoLocate: true },
};

/**
 * 读取偏好配置 data\fortune\preferences.json；不存在则创建默认文件。
 * 文件损坏时返回默认值（不覆盖用户文件）。
 */
function readPreferences() {
  ensureDataDir();
  const file = dataFile('preferences.json');
  if (!fs.existsSync(file)) {
    writeJsonSafe(file, DEFAULT_PREFERENCES);
    return JSON.parse(JSON.stringify(DEFAULT_PREFERENCES));
  }
  const raw = readJsonSafe(file, null);
  if (!raw || typeof raw !== 'object') return JSON.parse(JSON.stringify(DEFAULT_PREFERENCES));
  const weather = raw.weather && typeof raw.weather === 'object' ? raw.weather : {};
  return {
    ...raw,
    weather: {
      ...weather,
      city: typeof weather.city === 'string' ? weather.city : '',
      autoLocate: weather.autoLocate !== false,
    },
  };
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

/** 本地日期 YYYY-MM-DD */
function formatDate(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** 本地日期时间 YYYY-MM-DD HH:mm:ss */
function formatDateTime(d) {
  return `${formatDate(d)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

/** 解析 YYYY-MM-DD（或 Date 对象），失败返回 null */
function parseDate(dateStr) {
  if (dateStr === undefined || dateStr === null || dateStr === '') {
    return { y: new Date().getFullYear(), m: new Date().getMonth() + 1, d: new Date().getDate() };
  }
  if (dateStr instanceof Date && !isNaN(dateStr.getTime())) {
    return { y: dateStr.getFullYear(), m: dateStr.getMonth() + 1, d: dateStr.getDate() };
  }
  const s = String(dateStr).trim();
  const m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (y < 1900 || y > 2200) return null;
  if (mo < 1 || mo > 12) return null;
  if (d < 1 || d > 31) return null;
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return { y, m: mo, d };
}

/** ISO 周数 {year, week}（周一起算，第 1 周含 1 月 4 日） */
function isoWeek(y, m, d) {
  const date = new Date(Date.UTC(y, m - 1, d));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date - yearStart) / 86400000 + 1) / 7);
  return { year: date.getUTCFullYear(), week };
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

function uniq(arr) {
  return Array.from(new Set(arr.filter((x) => x !== undefined && x !== null && x !== '')));
}

function toNum(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function errMsg(e) {
  if (!e) return '未知错误';
  return String(e && e.message ? e.message : e);
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  MODULE_DIR,
  DATA_DIR,
  requireVendor,
  loadStaticData,
  ensureDataDir,
  dataFile,
  readJsonSafe,
  writeJsonSafe,
  readPreferences,
  DEFAULT_PREFERENCES,
  pad2,
  formatDate,
  formatDateTime,
  parseDate,
  isoWeek,
  clamp,
  round1,
  uniq,
  toNum,
  errMsg,
  sleep,
};
