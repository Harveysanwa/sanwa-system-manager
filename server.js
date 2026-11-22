#!/usr/bin/env node
/**
 * Sanwa系统管理器 · 本地启动服务
 * ------------------------------------------------------------------
 * 纯 Node.js 标准库实现，无任何 npm 依赖。
 * 绑定：127.0.0.1:9900（只允许本机访问，绝不监听外网）
 *
 * 职责：
 *   - 静态提供桌面单文件 UI（优先读取桌面 HTML，并同步到 web/index.html）
 *   - /api/meta     盘容量、服务版本、工具统计
 *   - /api/tools    工具清单（已脱敏，不含可执行命令细节）
 *   - /api/status   逐工具健康探测（HTTP / TCP / 进程）
 *   - /api/launch   按 tools.json 白名单启动工具（只执行预置脚本，不接受任意命令）
 *   - /api/stop     仅停止「由本控制中心启动」的进程
 *   - /api/logs     读取日志尾部
 *   - 全部响应带 CORS，供 file:// 打开的桌面 HTML 调用
 *
 * 安全约束：
 *   - 只接受 tools.json 中存在的 id；请求体中的路径/参数一律忽略
 *   - 启动动作只允许执行 <SANWA_HOME>\scripts\<id>.ps1 预置脚本
 *   - 不停止非本服务拉起的进程（由启动脚本通过 pid 文件 + 启动时间 + 可执行路径三重校验）
 *
 * 运行：node <SANWA_HOME>\server.js
 */

'use strict';

const http = require('http');
const https = require('https');
const net = require('net');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const path = require('path');
const { spawn, execFile } = require('child_process');

// ---------------------------------------------------------------- 常量

const HUB_ROOT = process.env.SANWA_HOME ? path.resolve(process.env.SANWA_HOME) : __dirname;
const DATA_DIR = process.env.SANWA_DATA_DIR ? path.resolve(process.env.SANWA_DATA_DIR) : path.join(HUB_ROOT, 'data');
const LOGS_DIR = process.env.SANWA_LOG_DIR ? path.resolve(process.env.SANWA_LOG_DIR) : path.join(HUB_ROOT, 'logs');
const SCRIPTS_DIR = path.join(HUB_ROOT, 'scripts');
const PIDS_DIR = path.join(DATA_DIR, 'pids');
const TOOLS_CONFIG_PATH = path.join(DATA_DIR, 'tools.json');
const EXAMPLE_CONFIG_PATH = path.join(DATA_DIR, 'tools.example.json');
const CONFIG_PATH = fs.existsSync(TOOLS_CONFIG_PATH) ? TOOLS_CONFIG_PATH : EXAMPLE_CONFIG_PATH;
const HUB_PID_FILE = path.join(DATA_DIR, 'hub.pid');
const GAME_STATE_FILE = path.join(DATA_DIR, 'game-mode-state.json');
const GAME_MARKER = '##GAMEJSON##';
const STARTUP_DIR = path.join(
  process.env.APPDATA || path.join(process.env.USERPROFILE || (process.env.USERPROFILE || process.env.PUBLIC || ''), 'AppData', 'Roaming'),
  'Microsoft',
  'Windows',
  'Start Menu',
  'Programs',
  'Startup'
);
const AUTOSTART_LNK = path.join(STARTUP_DIR, 'Sanwa系统管理器.lnk');
const AUTOSTART_VBS = path.join(SCRIPTS_DIR, 'autostart-create.vbs');
const AUTOSTART_TASKS = ['Hermes-LMStudio-Preload', 'DSH Hermes LMS Watchdog', 'QianwenUpdater'];

const HOST = '127.0.0.1';
const PORT = Number(process.env.SANWA_PORT) > 0 ? Number(process.env.SANWA_PORT) : 9900;
const HUB_VERSION = '1.5.0';
const DEFAULT_TOOL_WAIT_SEC = 45;
const STATUS_PROBE_CACHE_MS = 1000;
const PROCESS_CACHE_MS = 6000;
const LAUNCH_COOLDOWN_MS = 1500;

const PS_EXE = process.env.SystemRoot
  ? path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  : 'powershell.exe';

// 五种模式引擎（lib/modes.js；加载失败不影响其它功能）
let modesEngine = null;
try {
  modesEngine = require(path.join(HUB_ROOT, 'lib', 'modes.js'));
} catch (err) {
  console.log('[hub] 模式引擎加载失败: ' + (err && err.message ? err.message : err));
}

const startedAt = new Date();
const launches = new Map();       // id -> {state, startedAt, timeoutMs}
const lastLaunchAt = new Map();   // id -> timestamp（防抖）
const probeCache = new Map();     // id -> {at, result}
let processCache = { at: 0, set: null };
let configCache = { mtimeMs: 0, size: -1, data: null, error: null };
let uiSyncNote = '尚未同步';
let gameOpLock = null;                                  // 'enter' | 'exit' | null
let gamePreviewCache = { at: 0, data: null };           // 游戏模式候选预览缓存

// ---------------------------------------------------------------- 小工具

function nowStamp() {
  const d = new Date();
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  );
}

function isoLocal() {
  const d = new Date();
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}` +
    `${sign}${p(Math.floor(Math.abs(off) / 60))}:${p(Math.abs(off) % 60)}`
  );
}

function ensureDirs() {
  for (const dir of [DATA_DIR, LOGS_DIR, SCRIPTS_DIR, PIDS_DIR]) {
    try { fs.mkdirSync(dir, { recursive: true }); } catch (_) { /* ignore */ }
  }
}

function writeLog(level, message) {
  const line = `${nowStamp()} [${level}] ${message}\n`;
  try {
    ensureDirs();
    fs.appendFile(path.join(LOGS_DIR, 'hub.log'), line, () => {});
  } catch (_) { /* ignore */ }
  // 同时输出到控制台（便于前台调试）
  const tag = `[hub]`;
  if (level === 'error') console.error(tag, message);
  else if (level === 'warn') console.warn(tag, message);
  else console.log(tag, message);
}

function json(res, statusCode, payload) {
  setCommonHeaders(res);
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function setCommonHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', 'no-store');
}

function readJsonBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        const err = new Error('请求体过大');
        err.statusCode = 413;
        reject(err);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (_) {
        const err = new Error('请求体不是合法 JSON');
        err.statusCode = 400;
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function setStatusError(statusCode, code, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.code = code;
  return err;
}

// ---------------------------------------------------------------- 配置

function loadConfig() {
  let st;
  try {
    st = fs.statSync(CONFIG_PATH);
  } catch (_) {
    return {
      data: null,
      error: `未找到配置文件 ${CONFIG_PATH}，请先运行 scripts/build-ui.js 或恢复 data/tools.json`,
    };
  }
  if (configCache.data && st.mtimeMs === configCache.mtimeMs && st.size === configCache.size) {
    return { data: configCache.data, error: null };
  }
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8').replace(/^\uFEFF/, '');
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object' || !Array.isArray(data.tools)) {
      throw new Error('tools.json 缺少 tools 数组');
    }
    const seen = new Set();
    const tools = [];
    for (const t of data.tools) {
      if (!t || typeof t !== 'object') continue;
      const id = String(t.id || '').trim().toLowerCase();
      if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(id)) {
        writeLog('warn', `忽略非法工具 id: ${JSON.stringify(t.id)}`);
        continue;
      }
      if (seen.has(id)) {
        writeLog('warn', `忽略重复工具 id: ${id}`);
        continue;
      }
      seen.add(id);
      t.id = id;
      tools.push(t);
    }
    data.tools = tools;
    data.hub = Object.assign(
      {
        name: 'Sanwa系统管理器',
        version: HUB_VERSION,
        host: HOST,
        port: PORT,
        root: HUB_ROOT,
        desktopHtml: process.env.SANWA_DESKTOP || path.join(os.homedir(), 'Desktop', 'Sanwa系统管理器.html'),
        webIndex: path.join(HUB_ROOT, 'web', 'index.html'),
        logsDir: LOGS_DIR,
        scriptsDir: SCRIPTS_DIR,
        startCmd: path.join(HUB_ROOT, 'start-sanwa.cmd'),
      },
      data.hub || {}
    );
    configCache = { mtimeMs: st.mtimeMs, size: st.size, data, error: null };
    return { data, error: null };
  } catch (err) {
    const msg = `读取 tools.json 失败: ${err.message}`;
    configCache = { mtimeMs: st.mtimeMs, size: st.size, data: null, error: msg };
    writeLog('error', msg);
    return { data: null, error: msg };
  }
}

function requireConfig() {
  const { data, error } = loadConfig();
  if (!data) throw setStatusError(500, 'CONFIG_ERROR', error || '配置文件不可用');
  return data;
}

function findTool(config, id) {
  return config.tools.find((t) => t.id === id) || null;
}

function categoryName(config, catId) {
  const list = Array.isArray(config.categories) ? config.categories : [];
  const hit = list.find((c) => c.id === catId);
  return hit ? hit.name : catId;
}

// 中文显示名（优先 nameZh，其次英文 name / id）
function toolDisplayName(tool) {
  if (!tool) return '';
  return tool.nameZh || tool.name || tool.id || '';
}

function toolPidFile(id) {
  return path.join(PIDS_DIR, `${id}.json`);
}

function isPidFilePresent(id) {
  try { return fs.existsSync(toolPidFile(id)); } catch (_) { return false; }
}

function readOwnedPidRecord(id) {
  try {
    const raw = fs.readFileSync(toolPidFile(id), 'utf8').replace(/^\uFEFF/, '');
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

function isPidAlive(pid) {
  const n = Number(pid);
  if (!Number.isInteger(n) || n <= 0) return false;
  try {
    process.kill(n, 0); // Windows 下 signal 0 仅探测进程是否存在
    return true;
  } catch (err) {
    return err.code === 'EPERM'; // 有进程但无权限访问，也算存在
  }
}

// 返回「由本控制中心记录且仍在运行」的进程信息；无则 null
function ownedProcessInfo(id) {
  const record = readOwnedPidRecord(id);
  if (!record) return null;
  if (record.kind === 'service') {
    return { pid: null, service: record.service, record };
  }
  if (isPidAlive(record.pid)) return { pid: Number(record.pid), record };
  return null;
}

// ---------------------------------------------------------------- 健康探测

function httpProbe(url, timeoutMs) {
  return new Promise((resolve) => {
    const started = Date.now();
    let done = false;
    const finish = (state, detail) => {
      if (done) return;
      done = true;
      resolve({ state, detail, latencyMs: Date.now() - started });
    };
    let target;
    try {
      target = new URL(url);
      if (!/^https?:$/.test(target.protocol)) throw new Error('协议不支持');
    } catch (_) {
      return finish('unknown', '健康检查 URL 无效');
    }
    const lib = target.protocol === 'https:' ? https : http;
    let req;
    try {
      req = lib.get(
        {
          hostname: target.hostname,
          port: target.port || (target.protocol === 'https:' ? 443 : 80),
          path: `${target.pathname}${target.search}`,
          timeout: timeoutMs,
          headers: { 'User-Agent': 'Sanwa-Probe/1.0', Accept: '*/*' },
        },
        (res) => {
          res.resume();
          // 只要拿到 HTTP 响应（含 401/403）就说明服务活着
          finish('running', `HTTP ${res.statusCode}`);
        }
      );
      req.on('timeout', () => {
        try { req.destroy(); } catch (_) {}
        finish('unknown', '探测超时');
      });
      req.on('error', (err) => {
        if (['ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH', 'ENETUNREACH', 'EADDRNOTAVAIL'].includes(err.code)) {
          finish('stopped', '端口未监听');
        } else {
          finish('unknown', `探测失败 ${err.code || ''}`.trim());
        }
      });
    } catch (_) {
      finish('unknown', '探测发起失败');
    }
  });
}

function tcpProbe(port, timeoutMs) {
  return new Promise((resolve) => {
    const started = Date.now();
    let done = false;
    const finish = (state, detail) => {
      if (done) return;
      done = true;
      resolve({ state, detail, latencyMs: Date.now() - started });
    };
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      return finish('unknown', '端口配置无效');
    }
    const sock = net.connect({ host: HOST, port });
    sock.setTimeout(timeoutMs);
    sock.once('connect', () => {
      sock.destroy();
      finish('running', `TCP ${port} 已监听`);
    });
    sock.once('timeout', () => {
      sock.destroy();
      finish('unknown', '连接超时');
    });
    sock.once('error', (err) => {
      if (['ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH', 'ENETUNREACH'].includes(err.code)) {
        finish('stopped', '端口未监听');
      } else {
        finish('unknown', `探测失败 ${err.code || ''}`.trim());
      }
    });
  });
}

function execFileAsync(file, args, options) {
  return new Promise((resolve, reject) => {
    execFile(file, args, options, (err, stdout, stderr) => {
      if (err) {
        if (err.code === 1 && !stderr) {
          // tasklist 有时以 1 退出但 stdout 有效，交给上层判断
        }
        return reject(err);
      }
      resolve({ stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

async function listProcesses() {
  if (processCache.set && Date.now() - processCache.at < PROCESS_CACHE_MS) {
    return processCache.set;
  }
  try {
    const { stdout } = await execFileAsync(
      'tasklist.exe',
      ['/FO', 'CSV', '/NH'],
      { windowsHide: true, timeout: 5000, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8' }
    );
    const set = new Set();
    for (const line of stdout.split(/\r?\n/)) {
      const m = line.match(/^"([^"]+)"/);
      if (m) set.add(m[1].toLowerCase());
      else if (line.trim()) {
        const first = line.split(',')[0].replace(/"/g, '').trim();
        if (first) set.add(first.toLowerCase());
      }
    }
    if (set.size > 0) processCache = { at: Date.now(), set };
    return set;
  } catch (err) {
    writeLog('warn', `读取进程列表失败: ${err.message}`);
    return null;
  }
}

async function processProbe(names) {
  const started = Date.now();
  const wanted = (Array.isArray(names) ? names : [])
    .map((n) => String(n || '').trim().toLowerCase())
    .filter(Boolean)
    .map((n) => (n.endsWith('.exe') ? n : `${n}.exe`));
  if (!wanted.length) return { state: 'unknown', detail: '未配置进程名', latencyMs: 0 };
  const set = await listProcesses();
  if (!set) return { state: 'unknown', detail: '无法读取进程列表', latencyMs: Date.now() - started };
  const hit = wanted.find((n) => set.has(n));
  return hit
    ? { state: 'running', detail: `进程 ${hit} 正在运行`, latencyMs: Date.now() - started }
    : { state: 'stopped', detail: '进程未运行', latencyMs: Date.now() - started };
}

async function probeTool(tool) {
  const cached = probeCache.get(tool.id);
  if (cached && Date.now() - cached.at < STATUS_PROBE_CACHE_MS) return cached.result;
  const health = tool.health || {};
  let result;
  const timeout = Number(health.timeoutMs) > 0 ? Number(health.timeoutMs) : 1500;
  if (health.type === 'http' && health.url) {
    result = await httpProbe(health.url, timeout);
  } else if (health.type === 'tcp' && health.port) {
    result = await tcpProbe(Number(health.port), timeout);
  } else if (health.type === 'process') {
    result = await processProbe(health.process);
  } else {
    result = { state: 'unknown', detail: '未配置健康检查', latencyMs: 0 };
  }
  probeCache.set(tool.id, { at: Date.now(), result });
  return result;
}

function invalidateProbe(id) {
  probeCache.delete(id);
}

// ---------------------------------------------------------------- 工具状态

async function computeStates(config) {
  const tools = config.tools;
  const results = await Promise.all(tools.map((t) => probeTool(t)));
  const states = {};
  for (let i = 0; i < tools.length; i++) {
    const tool = tools[i];
    const probe = results[i];
    let state = probe.state;
    let detail = probe.detail;
    const healthType = (tool.health && tool.health.type) || 'none';
    const ownedInfo = ownedProcessInfo(tool.id);
    const launch = launches.get(tool.id);
    if (state === 'running') {
      if (launch) launches.delete(tool.id);
    } else if (healthType === 'none' && ownedInfo) {
      // 无健康检查的工具（如 Python 终端）：以控制中心记录的进程是否存活为准
      state = 'running';
      detail = `控制中心拉起的进程运行中（PID ${ownedInfo.pid}）`;
      if (launch) launches.delete(tool.id);
    } else if (launch && launch.state === 'starting') {
      const elapsed = Date.now() - launch.startedAt;
      const timeoutMs = launch.timeoutMs || (DEFAULT_TOOL_WAIT_SEC + 30) * 1000;
      if (elapsed > timeoutMs) {
        launches.delete(tool.id);
        state = 'stopped';
        detail = '启动超时，请打开日志排查';
        writeLog('warn', `工具 ${tool.id} 启动超时`);
      } else {
        state = 'starting';
        detail = `启动中… 已等待 ${Math.round(elapsed / 1000)} 秒`;
      }
    }
    const kind = (tool.launch && tool.launch.kind) || 'none';
    const readiness = launchReadiness(tool);
    states[tool.id] = {
      id: tool.id,
      state,
      detail,
      latencyMs: probe.latencyMs || 0,
      checkedBy: healthType,
      url: typeof tool.url === 'string' ? tool.url : '',
      ownedByHub: !!ownedInfo,
      canStop: !!ownedInfo && kind !== 'self' && kind !== 'none',
      canLaunch: readiness.ready,
      draft: !!tool.draft,
    };
  }
  return states;
}

// ---------------------------------------------------------------- 进程启动

function spawnScriptDetached(scriptFile, extraArgs) {
  return new Promise((resolve) => {
    if (!fs.existsSync(scriptFile)) {
      return resolve({ ok: false, message: `缺少脚本 ${path.basename(scriptFile)}` });
    }
    let child;
    try {
      child = spawn(
        PS_EXE,
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptFile, ...extraArgs],
        { cwd: HUB_ROOT, windowsHide: true, detached: false, stdio: 'ignore' }
      );
    } catch (err) {
      return resolve({ ok: false, message: `启动脚本失败: ${err.message}` });
    }
    child.on('error', (err) => writeLog('error', `脚本 ${path.basename(scriptFile)} 执行失败: ${err.message}`));
    child.unref();
    return resolve({ ok: true, pid: child.pid });
  });
}

function runScriptCaptured(scriptFile, extraArgs, timeoutMs = 20000) {
  return new Promise((resolve) => {
    if (!fs.existsSync(scriptFile)) {
      return resolve({ code: -1, stdout: '', stderr: `缺少脚本 ${path.basename(scriptFile)}` });
    }
    execFile(
      PS_EXE,
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptFile, ...extraArgs],
      { cwd: HUB_ROOT, windowsHide: true, timeout: timeoutMs, maxBuffer: 2 * 1024 * 1024, encoding: 'utf8' },
      (err, stdout, stderr) => {
        const code = err ? (typeof err.code === 'number' ? err.code : -1) : 0;
        resolve({ code, stdout: stdout || '', stderr: stderr || '' });
      }
    );
  });
}

function lastMeaningfulLine(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  return lines.length ? lines[lines.length - 1] : '';
}

function validOpenTarget(target) {
  const value = String(target || '').trim();
  if (!value) return null;
  if (/^https?:\/\/[^\s]+$/i.test(value)) return value;
  try {
    if (path.isAbsolute(value) && fs.existsSync(value)) return value;
  } catch (_) { /* ignore */ }
  return null;
}

async function openTarget(target) {
  const safe = validOpenTarget(target);
  if (!safe) return { ok: false, message: '打开地址无效' };
  const scriptFile = path.join(SCRIPTS_DIR, 'open-only.ps1');
  const r = await spawnScriptDetached(scriptFile, ['-Url', safe]);
  if (!r.ok) return { ok: false, message: r.message };
  writeLog('info', `打开 ${safe}`);
  return { ok: true };
}

// ---------------------------------------------------------------- 游戏模式

function readGameState() {
  try {
    const raw = fs.readFileSync(GAME_STATE_FILE, 'utf8').replace(/^\uFEFF/, '');
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

function gameModePolicies(config) {
  const stop = [];
  const keep = [];
  for (const t of config.tools) {
    const item = { id: t.id, name: toolDisplayName(t) };
    if (t.gameMode === 'stop') stop.push(item);
    else keep.push(item);
  }
  return {
    stop,
    keep,
    protectNames: ['DeepSeek Harness', 'Sanwa系统管理器服务 (127.0.0.1:9900)'],
    note: '进入游戏模式只关闭 gameMode=stop 的 AI 服务/应用；DSH 与控制中心永远保留',
  };
}

// 提取脚本崩溃时更有意义的一行（火绒 AMSI 钩子偶发 AccessViolation）
function summarizeScriptFailure(combined) {
  const lines = String(combined || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const hit = lines.find((l) =>
    /AccessViolation|AMSI|AmsiScanBuffer|Unhandled Exception|ExceptionWhenSetting|ParserError|Cannot process the command|不能识别|无法识别/.test(l)
  );
  const text = hit || lines[lines.length - 1] || '脚本未返回结构化结果';
  return text.length > 260 ? `${text.slice(0, 260)}…` : text;
}

// 执行游戏模式脚本并解析末尾 ##GAMEJSON##{...}
function runGameScript(scriptName, args, timeoutMs) {
  return new Promise((resolve) => {
    const scriptPath = path.join(SCRIPTS_DIR, scriptName);
    if (!fs.existsSync(scriptPath)) {
      return resolve({ ok: false, code: -1, result: null, console: '', message: `缺少脚本 scripts/${scriptName}` });
    }
    execFile(
      PS_EXE,
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, ...args],
      { cwd: HUB_ROOT, windowsHide: true, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8' },
      (err, stdout, stderr) => {
        const code = err ? (typeof err.code === 'number' ? err.code : (err.killed ? -2 : -1)) : 0;
        const combined = `${stdout || ''}\n${stderr || ''}`;
        const idx = combined.lastIndexOf(GAME_MARKER);
        let result = null;
        let consoleText = combined.trim();
        if (idx >= 0) {
          consoleText = combined.slice(0, idx).trim();
          const tail = combined.slice(idx + GAME_MARKER.length).split(/\r?\n/)[0] || '';
          try {
            result = JSON.parse(tail.trim());
          } catch (_) {
            result = null;
          }
        }
        const message = result
          ? (result.message || (result.ok === false ? '脚本报告失败' : '脚本执行完成'))
          : summarizeScriptFailure(combined);
        resolve({ ok: !!result, code, result, console: consoleText, message });
      }
    );
  });
}

// ---------------------------------------------------------------- 游戏模式 · Node 原生兜底
// 火绒 AMSI 钩子会让 PowerShell 偶发 AccessViolation 崩溃；原生实现只调用 tasklist/netstat/taskkill/explorer，
// 不经过 PowerShell，因此不受 AMSI 影响。PowerShell 脚本仍保留为第一选择，失败时自动降级。
const GAME_NATIVE = path.join(SCRIPTS_DIR, 'game-mode-native.js');

function runGameNative(mode, timeoutMs) {
  return new Promise((resolve) => {
    if (!fs.existsSync(GAME_NATIVE)) {
      return resolve({ ok: false, code: -1, result: null, message: '缺少 scripts/game-mode-native.js' });
    }
    execFile(
      process.execPath,
      [GAME_NATIVE, mode],
      { cwd: HUB_ROOT, windowsHide: true, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8' },
      (err, stdout, stderr) => {
        const combined = `${stdout || ''}\n${stderr || ''}`;
        const idx = combined.lastIndexOf(GAME_MARKER);
        let result = null;
        if (idx >= 0) {
          const tail = combined.slice(idx + GAME_MARKER.length).split(/\r?\n/)[0] || '';
          try { result = JSON.parse(tail.trim()); } catch (_) { result = null; }
        }
        if (!result) {
          const msg = summarizeScriptFailure(combined);
          return resolve({ ok: false, code: -1, result: null, message: `Node 原生兜底异常：${msg}` });
        }
        resolve({ ok: !!result, code: 0, result, message: result.message || '' });
      }
    );
  });
}

async function coreServicesUpNow() {
  try {
    const config = requireConfig();
    const st = readGameState() || {};
    const ids = Array.isArray(st.toolsRunningBefore)
      ? st.toolsRunningBefore
      : (Array.isArray(st.closedIds) ? st.closedIds : []);
    const ports = [];
    for (const id of ids) {
      const t = (config.tools || []).find((x) => x.id === id);
      const p = t && t.health && t.health.port;
      if (p) ports.push(Number(p));
    }
    if (!ports.length) return false;
    const rs = await Promise.all(ports.map((p) => tcpProbe(p, 700)));
    return rs.every((r) => r.state === 'running');
  } catch (_) {
    return false;
  }
}

async function getGamePreview(force) {
  if (!force && gamePreviewCache.data && Date.now() - gamePreviewCache.at < 8000) {
    return gamePreviewCache.data;
  }
  const r = await runGameScript('game-mode.ps1', ['-DryRun'], 60000);
  let data = (r.ok && r.result) ? r.result : null;
  if (!data) {
    // 兜底：PowerShell 被火绒 AMSI 打断时改用 Node 原生预演
    const nr = await runGameNative('preview', 90000);
    if (nr.result) {
      data = nr.result;
      data.engine = data.engine || 'node-native';
      data.warning = 'PowerShell 预演被安全软件中断，已改用 Node 原生预演';
      writeLog('warn', '游戏模式预演：PowerShell 异常，已改用 Node 原生预演');
    }
  }
  if (!data) {
    const cached = gamePreviewCache.data;
    if (cached && Array.isArray(cached.candidates) && cached.candidates.length) {
      data = Object.assign({}, cached, { warning: '预演服务异常，显示最近一次缓存结果' });
    } else {
      data = {
        ok: false,
        candidates: [],
        totalMemoryMB: 0,
        totalVramMB: 0,
        totalProcesses: 0,
        message: r.message || '游戏模式预演失败',
      };
    }
  }
  gamePreviewCache = { at: Date.now(), data };
  return data;
}

// 脚本崩溃兜底：读取「已落盘且确实生效」的进入状态
function gameStateEnteredRecently() {
  const st = readGameState();
  if (!st || st.active !== true) return null;
  const ids = (Array.isArray(st.toolsRunningBefore) && st.toolsRunningBefore.length)
    ? st.toolsRunningBefore
    : (Array.isArray(st.closedIds) ? st.closedIds : []);
  if (!ids.length) return null;
  return st;
}

async function allGamePortsFreeNow(config) {
  const ports = (config.gameMode && Array.isArray(config.gameMode.portsToWait))
    ? config.gameMode.portsToWait
    : [11434, 1234, 8188, 8080, 8137, 9123];
  const results = await Promise.all(ports.map((p) => tcpProbe(Number(p), 600)));
  return results.every((r) => r.state !== 'running');
}

function buildRecoveredEnterPayload(state, warning) {
  const ids = Array.isArray(state.toolsRunningBefore) ? state.toolsRunningBefore : [];
  return {
    ok: true,
    active: true,
    recovered: true,
    warning,
    enteredAt: state.enteredAt || '',
    closedTools: Array.isArray(state.closedTools) ? state.closedTools : [],
    closedIds: ids,
    toolsRunningBefore: ids,
    freedMemoryMB: state.freedMemoryMB || 0,
    freedVramMB: state.freedVramMB || 0,
    totalProcesses: state.totalProcesses || 0,
    portReleaseOk: state.portReleaseOk !== false,
    protected: state.protected || null,
    statePhase: state.phase || '',
    message: warning ? `已进入游戏模式（${warning}）` : '已进入游戏模式',
  };
}

async function apiGameStatus(res) {
  const config = requireConfig();
  const state = readGameState();
  if (state && state.active === true) {
    return json(res, 200, {
      ok: true,
      active: true,
      enteredAt: state.enteredAt || '',
      closedTools: Array.isArray(state.closedTools) ? state.closedTools : [],
      closedIds: Array.isArray(state.toolsRunningBefore) ? state.toolsRunningBefore : [],
      freedMemoryMB: state.freedMemoryMB || 0,
      freedVramMB: state.freedVramMB || 0,
      gpuUsedAfterMB: state.gpuUsedAfterMB,
      totalProcesses: state.totalProcesses || 0,
      portReleaseOk: state.portReleaseOk !== false,
      protected: state.protected || null,
      toolPolicies: gameModePolicies(config),
      busy: !!gameOpLock,
      at: isoLocal(),
    });
  }
  const preview = await getGamePreview(false);
  return json(res, 200, {
    ok: true,
    active: false,
    candidates: preview.candidates || [],
    totalMemoryMB: preview.totalMemoryMB || 0,
    totalVramMB: preview.totalVramMB || 0,
    totalProcesses: preview.totalProcesses || 0,
    gpuTotalUsedMB: preview.gpuTotalUsedMB,
    protected: preview.protected || null,
    lastSession: state
      ? {
          exitedAt: state.exitedAt || '',
          restored: (state.restore && state.restore.restored) || [],
          failed: (state.restore && state.restore.failed) || [],
        }
      : null,
    toolPolicies: gameModePolicies(config),
    busy: !!gameOpLock,
    at: isoLocal(),
  });
}

async function apiGameEnter(req, res) {
  if (gameOpLock) throw setStatusError(409, 'GAME_BUSY', '游戏模式切换正在进行中，请稍候');
  const config = requireConfig();
  const body = await readJsonBody(req);
  if (body && body.dryRun === true) {
    const preview = await getGamePreview(true);
    if (preview && Array.isArray(preview.candidates)) {
      return json(res, 200, preview);
    }
    throw setStatusError(500, 'GAME_SCRIPT', (preview && preview.message) || '游戏模式预演失败');
  }
  gameOpLock = 'enter';
  writeLog('info', '游戏模式：开始关闭 AI 服务/应用');
  try {
    let lastMessage = '';
    for (let attempt = 1; attempt <= 2; attempt++) {
      const r = await runGameScript('game-mode.ps1', [], 180000);
      if (r.result && r.result.ok !== false) {
        // 脚本正常返回
        if (attempt > 1) {
          r.result.warning = r.result.warning || '首次脚本执行被中断（疑似火绒/HIPS 拦截 PowerShell），已自动重试成功';
          writeLog('warn', '游戏模式：首次执行异常，自动重试成功');
        } else if (r.result.resumed) {
          r.result.warning = r.result.warning || '检测到上次进入未完成，已断点续跑完成';
          writeLog('warn', '游戏模式：检测到未完成的进入操作，已断点续跑完成');
        }
        probeCache.clear();
        gamePreviewCache = { at: 0, data: null };
        writeLog('info', `游戏模式：${r.result.message || '已进入'}`);
        return json(res, 200, r.result);
      }

      lastMessage = r.message || '脚本执行异常';
      // 兜底 1：脚本崩溃但状态已落盘且确实生效（端口已释放 / 已记录 portReleaseOk）
      const st = gameStateEnteredRecently();
      if (st) {
        const portsFree = await allGamePortsFreeNow(config);
        if (portsFree || st.portReleaseOk === true) {
          probeCache.clear();
          gamePreviewCache = { at: 0, data: null };
          const warning = '脚本进程异常退出（疑似火绒/HIPS 拦截 PowerShell），但状态已落盘且服务已关闭';
          writeLog('warn', `游戏模式：${warning}`);
          return json(res, 200, buildRecoveredEnterPayload(st, warning));
        }
      }

      if (attempt === 1) {
        writeLog('warn', `游戏模式：脚本首次执行异常（${lastMessage}），重新检测候选项后自动重试一次`);
        await getGamePreview(true).catch(() => null);
      }
    }

    // 兜底 2：Node 原生执行（彻底绕开 PowerShell / 火绒 AMSI 崩溃）
    const nativeR = await runGameNative('enter', 180000);
    if (nativeR.result && nativeR.result.ok !== false) {
      probeCache.clear();
      gamePreviewCache = { at: 0, data: null };
      nativeR.result.engine = nativeR.result.engine || 'node-native';
      nativeR.result.warning = nativeR.result.warning || 'PowerShell 脚本被安全软件中断，已由 Node 原生兜底完成';
      writeLog('warn', '游戏模式：PowerShell 脚本异常，已改用 Node 原生兜底并成功');
      return json(res, 200, nativeR.result);
    }
    if (nativeR.message) lastMessage = nativeR.message;

    throw setStatusError(
      500,
      'GAME_SCRIPT',
      `进入游戏模式失败：${lastMessage}。可能是火绒/HIPS 拦截 PowerShell 进程导致（AMSI 钩子偶发崩溃）。建议：① 在页面上点「重试」；` +
        '② 将 ' + path.join(HUB_ROOT, 'scripts') + ' 加入火绒信任区/白名单；③ 查看 ' + path.join(HUB_ROOT, 'logs', 'game-mode.log')
    );
  } finally {
    gameOpLock = null;
  }
}

async function apiGameExit(req, res) {
  if (gameOpLock) throw setStatusError(409, 'GAME_BUSY', '游戏模式切换正在进行中，请稍候');
  await readJsonBody(req).catch(() => ({}));
  gameOpLock = 'exit';
  writeLog('info', '游戏模式：开始恢复服务');
  try {
    let lastMessage = '';
    for (let attempt = 1; attempt <= 2; attempt++) {
      const r = await runGameScript('game-mode-restore.ps1', [], 360000);
      if (r.result && r.result.ok !== false) {
        probeCache.clear();
        gamePreviewCache = { at: 0, data: null };
        const failedCount = Array.isArray(r.result.failed) ? r.result.failed.length : 0;
        if (attempt > 1) r.result.warning = r.result.warning || '首次恢复脚本被中断（疑似火绒/HIPS），已自动重试成功';
        writeLog(failedCount ? 'warn' : 'info', `游戏模式退出：${r.result.message || ''}`);
        return json(res, 200, r.result);
      }
      lastMessage = r.message || '恢复脚本执行异常';
      // 自愈 1：状态已显示退出（脚本可能崩溃于写回前/后）
      const st = readGameState();
      if (st && st.active !== true) {
        probeCache.clear();
        gamePreviewCache = { at: 0, data: null };
        writeLog('warn', '游戏模式：恢复脚本中断，但状态已落盘为退出');
        return json(res, 200, {
          ok: true,
          active: false,
          recovered: true,
          restored: [],
          skipped: [],
          failed: [],
          warning: '恢复脚本进程被安全软件中断，但状态已落盘为退出',
          message: '已退出游戏模式（服务已恢复）',
        });
      }
      // 自愈 2：状态仍 active，但服务端口已全部恢复 → 写回退出状态
      if (st && st.active === true && (await coreServicesUpNow())) {
        st.active = false;
        st.exitedAt = isoLocal();
        st.phase = 'exited';
        try { fs.writeFileSync(GAME_STATE_FILE, JSON.stringify(st, null, 2), 'utf8'); } catch (_) {}
        probeCache.clear();
        gamePreviewCache = { at: 0, data: null };
        writeLog('warn', '游戏模式：脚本中断但服务已全部恢复，已自愈写回退出状态');
        return json(res, 200, {
          ok: true,
          active: false,
          recovered: true,
          restored: [],
          skipped: [],
          failed: [],
          protected: st.protected || null,
          warning: '恢复脚本被安全软件中断，但服务已全部恢复，状态已自愈',
          message: '已退出游戏模式（服务已恢复）',
        });
      }
      if (attempt === 1) writeLog('warn', `游戏模式：恢复脚本异常（${lastMessage}），自动重试一次`);
    }
    // 兜底：Node 原生恢复（不经过 PowerShell，不受 AMSI 影响）
    const nativeR = await runGameNative('exit', 420000);
    if (nativeR.result) {
      probeCache.clear();
      gamePreviewCache = { at: 0, data: null };
      nativeR.result.engine = nativeR.result.engine || 'node-native';
      nativeR.result.warning = nativeR.result.warning || 'PowerShell 恢复脚本被安全软件中断，已由 Node 原生兜底完成';
      writeLog('warn', '游戏模式：PowerShell 恢复脚本异常，已改用 Node 原生兜底');
      return json(res, 200, nativeR.result);
    }
    throw setStatusError(
      500,
      'GAME_SCRIPT',
      `恢复服务失败：${lastMessage}${nativeR.message ? '；' + nativeR.message : ''}。请手动点击各工具卡片「启动」，或查看 ${HUB_ROOT}\\logs\\game-mode.log`
    );
  } finally {
    gameOpLock = null;
  }
}

// ---------------------------------------------------------------- 全部停止（不进入游戏模式）

async function apiStopAll(req, res) {
  if (gameOpLock) throw setStatusError(409, 'GAME_BUSY', '有其它资源操作正在进行中，请稍候');
  await readJsonBody(req).catch(() => ({}));
  gameOpLock = 'stopall';
  writeLog('info', '全部停止：开始关闭 AI 服务/应用');
  try {
    const nativeR = await runGameNative('stopall', 240000);
    if (nativeR.result && nativeR.result.ok !== false) {
      probeCache.clear();
      gamePreviewCache = { at: 0, data: null };
      writeLog('info', `全部停止：${nativeR.result.message || ''}`);
      return json(res, 200, nativeR.result);
    }
    throw setStatusError(
      500,
      'STOP_ALL_FAILED',
      `全部停止失败：${nativeR.message || '未知错误'}（Node 原生路径，不经 PowerShell；可查看 ${HUB_ROOT}\\logs\\game-mode.log）`
    );
  } finally {
    gameOpLock = null;
  }
}

// ---------------------------------------------------------------- 开机自启（VBScript 创建，避免 PowerShell / AMSI）

function getAutostartStatus() {
  let enabled = false;
  try { enabled = fs.existsSync(AUTOSTART_LNK); } catch (_) { /* ignore */ }
  return {
    enabled,
    path: AUTOSTART_LNK,
    disabledTasks: AUTOSTART_TASKS,
    note: 'AI 工具不会随开机启动；仅控制中心这个轻量服务（127.0.0.1:9900）会随登录启动。',
  };
}

function apiAutostartStatus(res) {
  json(res, 200, Object.assign({ ok: true }, getAutostartStatus()));
}

async function apiAutostartSet(req, res) {
  const body = await readJsonBody(req);
  if (typeof body.enabled !== 'boolean') {
    throw setStatusError(400, 'BAD_BODY', '请求体需为 {"enabled": true|false}');
  }
  const want = body.enabled;
  const before = getAutostartStatus().enabled;
  if (want === before) {
    return json(res, 200, Object.assign({ ok: true, changed: false, message: `开机自启已${want ? '开启' : '关闭'}` }, getAutostartStatus()));
  }

  if (want) {
    if (!fs.existsSync(AUTOSTART_VBS)) {
      throw setStatusError(500, 'VBS_MISSING', '缺少 scripts/autostart-create.vbs，无法创建自启快捷方式');
    }
    const cscript = process.env.SystemRoot
      ? path.join(process.env.SystemRoot, 'System32', 'cscript.exe')
      : 'cscript.exe';
    const startHub = path.join(SCRIPTS_DIR, 'start-hub.ps1');
    const r = await new Promise((resolve) => {
      try {
        execFile(
          cscript,
          ['//nologo', AUTOSTART_VBS, AUTOSTART_LNK, PS_EXE, startHub, HUB_ROOT, 'Sanwa系统管理器 · 本地服务（登录自启，仅启动 9900 小服务）'],
          { windowsHide: true, timeout: 20000, maxBuffer: 1024 * 1024, encoding: 'utf8' },
          (err, stdout, stderr) => {
            const code = err ? (typeof err.code === 'number' ? err.code : -1) : 0;
            resolve({ code, stdout: stdout || '', stderr: stderr || '' });
          }
        );
      } catch (err) {
        resolve({ code: -1, stdout: '', stderr: String(err && err.message) });
      }
    });
    const enabledNow = fs.existsSync(AUTOSTART_LNK);
    // 火绒等安全软件可能让 cscript 崩溃（AccessViolation，退出码非 0），但快捷方式已成功创建；
    // 因此以「lnk 是否真实存在」为准，退出码非 0 只记警告。
    if (!enabledNow) {
      try { if (fs.existsSync(AUTOSTART_LNK)) fs.unlinkSync(AUTOSTART_LNK); } catch (_) { /* 回滚残留 */ }
      writeLog('error', `开启开机自启失败 code=${r.code} ${(r.stderr || r.stdout || '').slice(0, 300)}`);
      throw setStatusError(
        500,
        'AUTOSTART_ENABLE_FAILED',
        '开启开机自启失败（cscript/VBScript 可能被安全软件拦截）。可改用 ${HUB_ROOT}\\install-autostart.ps1 手动开启。'
      );
    }
    if (r.code !== 0) {
      writeLog('warn', `cscript 退出码 ${r.code}（可能被火绒 AMSI 类拦截），但 Startup 快捷方式已创建，按成功处理`);
    }
    writeLog('info', '开机自启已开启（Startup 快捷方式已创建）');
    return json(res, 200, Object.assign({ ok: true, changed: true, message: '已开启开机自启（仅启动控制中心小服务）' }, getAutostartStatus()));
  }

  try {
    if (fs.existsSync(AUTOSTART_LNK)) fs.unlinkSync(AUTOSTART_LNK);
  } catch (err) {
    throw setStatusError(500, 'AUTOSTART_DISABLE_FAILED', `关闭开机自启失败：${err.message}`);
  }
  if (fs.existsSync(AUTOSTART_LNK)) {
    throw setStatusError(500, 'AUTOSTART_DISABLE_FAILED', '关闭开机自启失败：Startup 快捷方式仍存在');
  }
  writeLog('info', '开机自启已关闭（已删除 Startup 快捷方式）');
  return json(res, 200, Object.assign({ ok: true, changed: true, message: '已关闭开机自启' }, getAutostartStatus()));
}

// ---------------------------------------------------------------- 最近操作日志（右栏展示）
function apiActivity(res, query) {
  const limit = Math.max(1, Math.min(50, Number((query && query.get('limit')) || 10)));
  let lines = [];
  try {
    const text = fs.readFileSync(path.join(LOGS_DIR, 'hub.log'), 'utf8');
    lines = text.split(/\r?\n/).filter(Boolean);
  } catch (_) { /* ignore */ }
  const items = [];
  for (let i = lines.length - 1; i >= 0 && items.length < limit; i--) {
    const m = lines[i].match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) \[(\w+)\] (.*)$/);
    if (m) items.push({ at: `${m[1]} ${m[2]}`, level: m[3], text: m[4] });
  }
  json(res, 200, { ok: true, items });
}

// ---------------------------------------------------------------- 五种模式 API（normal / ai / office / game / extreme）
let modeOpLock = false;

async function apiModesStatus(res) {
  if (!modesEngine) throw setStatusError(503, 'MODES_ENGINE_MISSING', '模式引擎未加载（lib/modes.js 缺失或语法错误）');
  const data = await modesEngine.getStatus();
  json(res, 200, data);
}

async function apiModesSwitch(req, res) {
  if (!modesEngine) throw setStatusError(503, 'MODES_ENGINE_MISSING', '模式引擎未加载（lib/modes.js 缺失或语法错误）');
  if (modeOpLock) throw setStatusError(409, 'MODE_BUSY', '模式切换正在进行中，请稍候');
  const body = await readJsonBody(req);
  const mode = String((body && body.mode) || '').trim().toLowerCase();
  if (!mode) throw setStatusError(400, 'BAD_BODY', '请提供 mode（normal / ai / office / game / extreme）');
  const start = Array.isArray(body && body.start) ? body.start.map((x) => String(x || '').trim()).filter(Boolean) : null;
  if (mode === 'ai' && start && start.length === 0) {
    throw setStatusError(400, 'EMPTY_AI_SELECTION', 'AI 模式至少需要选择 1 个 AI 工具');
  }
  modeOpLock = true;
  writeLog('info', `模式切换请求：${mode}${start ? '（AI 选择：' + start.join(',') + '）' : ''}`);
  try {
    const r = await modesEngine.switchMode(mode, { start: start || undefined });
    probeCache.clear();
    gamePreviewCache = { at: 0, data: null };
    writeLog(r.ok ? 'info' : 'warn', `模式切换：${r.message || ''}`);
    return json(res, 200, r);
  } catch (err) {
    if (err && err.code === 'UNKNOWN_MODE') throw setStatusError(400, 'UNKNOWN_MODE', err.message);
    if (err && err.code === 'EMPTY_AI_SELECTION') throw setStatusError(400, 'EMPTY_AI_SELECTION', err.message);
    writeLog('error', `模式切换失败：${err && err.message ? err.message : err}`);
    throw setStatusError(500, 'MODE_SWITCH_FAILED', String((err && err.message) || err));
  } finally {
    modeOpLock = false;
  }
}

// ---------------------------------------------------------------- 生日门禁资料（仅脱敏字段，不存完整身份证、不写日志）
const PROFILE_FILE = path.join(DATA_DIR, 'profile.json');

function readProfile() {
  try { return JSON.parse(fs.readFileSync(PROFILE_FILE, 'utf8')); } catch (_) { return null; }
}

function apiProfileGet(res) {
  const p = readProfile();
  json(res, 200, { ok: true, profile: p || null });
}

async function apiProfilePost(req, res) {
  const body = await readJsonBody(req);
  const name = String((body && body.name) || '').trim();
  const birth = String((body && body.birth) || '').trim();
  const idMasked = String((body && body.idMasked) || '').trim();
  const gender = String((body && (body.gender || body.sex)) || '').trim().toLowerCase();
  if (!name || name.length > 40) throw setStatusError(400, 'BAD_NAME', '姓名需为 1-40 个字符');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birth)) throw setStatusError(400, 'BAD_BIRTH', 'birth 需为 YYYY-MM-DD');
  if (!/^\d{4}\*{6,}[0-9X]{4}$/.test(idMasked) && !/^\d{6}\*{6,}[0-9X]{4}$/.test(idMasked)) {
    throw setStatusError(400, 'BAD_MASK', 'idMasked 需为脱敏格式（如 3301**********1234）');
  }
  // 只保存脱敏字段；即使前端误传完整 id 也一律丢弃
  const oldProfile = readProfile() || {};
  let star = null;
  if (body && body.star && typeof body.star === 'object') {
    const s = body.star;
    const starId = String(s.starId || '').trim();
    const starName = String(s.starName || '').trim();
    const constellation = String(s.constellation || '').trim();
    const spectralColor = String(s.spectralColor || '').trim();
    if (/^SANWA-[0-9A-Z]{6}$/.test(starId) && starName && starName.length <= 60 &&
        constellation.length <= 40 && spectralColor.length <= 20) {
      star = { starId, starName, constellation, spectralColor };
    }
  } else if (oldProfile && oldProfile.star) {
    star = oldProfile.star;
  }
  const profile = {
    name,
    birth,
    idMasked,
    gender: gender === 'female' || gender === '女' ? 'female' : (gender === 'male' || gender === '男' ? 'male' : ''),
    star: star || null,
    updatedAt: new Date().toISOString(),
  };
  fs.mkdirSync(path.dirname(PROFILE_FILE), { recursive: true });
  fs.writeFileSync(PROFILE_FILE, JSON.stringify(profile, null, 2), 'utf8');
  return json(res, 200, { ok: true, profile });
}

// ---------------------------------------------------------------- 自定义背景（≤8MB，png/jpg/jpeg/webp，magic bytes 校验）
const BG_DIR = path.join(DATA_DIR, 'backgrounds');
const PREFERENCES_FILE = path.join(DATA_DIR, 'preferences.json');

function readPreferences() {
  try { return JSON.parse(fs.readFileSync(PREFERENCES_FILE, 'utf8')); } catch (_) { return {}; }
}
function writePreferences(prefs) {
  fs.mkdirSync(path.dirname(PREFERENCES_FILE), { recursive: true });
  fs.writeFileSync(PREFERENCES_FILE, JSON.stringify(Object.assign({}, prefs, { updatedAt: new Date().toISOString() }), null, 2), 'utf8');
}
function backgroundState() {
  const prefs = readPreferences();
  const bg = (prefs && prefs.background) || null;
  if (!bg || (!bg.file && !bg.url)) return { ok: true, enabled: false, url: '', strength: 45, uploadedAt: '' };
  return {
    ok: true,
    enabled: true,
    url: bg.file ? ('/api/background/file/' + encodeURIComponent(bg.file)) : String(bg.url || ''),
    servedUrl: bg.file ? ('/api/background/file/' + encodeURIComponent(bg.file)) : String(bg.url || ''),
    strength: typeof bg.strength === 'number' ? bg.strength : 45,
    uploadedAt: bg.uploadedAt || '',
    kind: bg.file ? 'file' : 'url',
  };
}
function detectImageExt(buf) {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return 'png';
  if (buf.length >= 3 && buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return 'jpg';
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}
function apiBackgroundState(res) {
  json(res, 200, backgroundState());
}
async function apiBackgroundSet(req, res) {
  const body = await readJsonBody(req, 12 * 1024 * 1024);
  const prefs = readPreferences();
  const prev = (prefs && prefs.background) || {};
  // 仅更新强度/遮罩
  if (body && body.strength !== undefined && !body.dataUrl && !body.url) {
    const strength = Math.max(0, Math.min(100, Number(body.strength) || 45));
    if (!prev.file && !prev.url) return json(res, 200, backgroundState());
    prefs.background = Object.assign({}, prev, { strength });
    writePreferences(prefs);
    writeLog('info', `背景遮罩强度更新：${strength}%`);
    return json(res, 200, backgroundState());
  }
  const strength = Math.max(0, Math.min(100, Number(body && body.strength) || 45));
  if (body && typeof body.url === 'string' && body.url.trim()) {
    const u = body.url.trim();
    if (!/^https?:\/\//i.test(u) && !/^data:image\//i.test(u)) {
      throw setStatusError(400, 'BAD_URL', '背景 URL 需为 http(s) 图片地址');
    }
    prefs.background = { url: u, strength, uploadedAt: new Date().toISOString() };
    writePreferences(prefs);
    writeLog('info', '自定义背景已设置为 URL');
    return json(res, 200, backgroundState());
  }
  const dataUrl = String((body && body.dataUrl) || '');
  const m = dataUrl.match(/^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=]+)$/i);
  if (!m) throw setStatusError(400, 'BAD_IMAGE', '请上传 PNG/JPG/WebP 图片（base64 dataURL）');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 8 * 1024 * 1024) throw setStatusError(413, 'IMAGE_TOO_LARGE', '背景图片不能超过 8MB');
  const ext = detectImageExt(buf);
  if (!ext) throw setStatusError(400, 'BAD_IMAGE', '图片 magic bytes 校验失败（仅支持 PNG/JPG/WebP）');
  const hash = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 20);
  const fileName = `${hash}.${ext}`;
  fs.mkdirSync(BG_DIR, { recursive: true });
  fs.writeFileSync(path.join(BG_DIR, fileName), buf);
  prefs.background = { file: fileName, strength, uploadedAt: new Date().toISOString() };
  writePreferences(prefs);
  writeLog('info', `自定义背景已保存：${fileName}（${(buf.length / 1024).toFixed(0)} KB）`);
  return json(res, 200, backgroundState());
}
function apiBackgroundClear(res) {
  const prefs = readPreferences();
  const prev = (prefs && prefs.background) || {};
  if (prev.file) {
    try { fs.unlinkSync(path.join(BG_DIR, prev.file)); } catch (_) { /* ignore */ }
  }
  prefs.background = null;
  writePreferences(prefs);
  writeLog('info', '自定义背景已清除');
  return json(res, 200, { ok: true, enabled: false, url: '', strength: 45 });
}
function serveBackgroundFile(res, name) {
  const safe = path.basename(decodeURIComponent(String(name || '')));
  if (!/^[a-f0-9]{16,64}\.(png|jpg|jpeg|webp)$/i.test(safe)) {
    throw setStatusError(404, 'NOT_FOUND', '背景文件不存在');
  }
  const file = path.join(BG_DIR, safe);
  if (!fs.existsSync(file)) throw setStatusError(404, 'NOT_FOUND', '背景文件不存在');
  const ext = path.extname(safe).toLowerCase();
  const type = ext === '.png' ? 'image/png' : (ext === '.webp' ? 'image/webp' : 'image/jpeg');
  const buf = fs.readFileSync(file);
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': buf.length, 'Cache-Control': 'public, max-age=86400' });
  res.end(buf);
  return undefined;
}

// ---------------------------------------------------------------- 游戏库（games 模块桥接，未就绪时 503）
const GAMES_INDEX = path.join(HUB_ROOT, 'lib', 'games', 'index.js');
let gamesCache = { at: 0, data: null };

function loadGamesModule() {
  try {
    if (!fs.existsSync(GAMES_INDEX)) return null;
    return require(GAMES_INDEX);
  } catch (err) {
    writeLog('warn', `游戏库模块加载失败：${err && err.message ? err.message : err}`);
    return null;
  }
}

async function apiGames(res) {
  const mod = loadGamesModule();
  if (!mod || typeof mod.loadGames !== 'function') {
    throw setStatusError(503, 'GAMES_LOADING', '游戏库模块加载中');
  }
  if (gamesCache.data && Date.now() - gamesCache.at < 15000) return json(res, 200, gamesCache.data);
  const data = await mod.loadGames();
  const payload = Object.assign({ ok: true }, data || {});
  gamesCache = { at: Date.now(), data: payload };
  return json(res, 200, payload);
}

async function apiGamesScan(req, res) {
  const mod = loadGamesModule();
  if (!mod || typeof mod.scanGames !== 'function') {
    throw setStatusError(503, 'GAMES_LOADING', '游戏库模块加载中');
  }
  const data = await mod.scanGames();
  const payload = Object.assign({ ok: true }, data || {});
  gamesCache = { at: Date.now(), data: payload };
  writeLog('info', `游戏库扫描：${(payload.games || []).length} 款`);
  return json(res, 200, payload);
}

async function apiGamesLaunch(req, res) {
  const mod = loadGamesModule();
  if (!mod || typeof mod.launchGame !== 'function') {
    throw setStatusError(503, 'GAMES_LOADING', '游戏库模块加载中');
  }
  const body = await readJsonBody(req);
  const id = String((body && body.id) || '').trim();
  if (!id) throw setStatusError(400, 'BAD_BODY', '请提供游戏 id');
  const opts = {
    accelerator: String((body && body.accelerator) || 'auto'),
    steamMode: String((body && body.steamMode) || 'auto'),
    dryRun: body && body.dryRun === true,
  };
  const r = await mod.launchGame(id, opts);
  writeLog('info', `游戏启动编排：${id}（accelerator=${opts.accelerator}, steamMode=${opts.steamMode}, dryRun=${opts.dryRun}）`);
  return json(res, 200, Object.assign({ ok: true }, r || {}));
}

async function apiGamesOverrides(req, res) {
  const mod = loadGamesModule();
  if (!mod || typeof mod.saveOverrides !== 'function') {
    throw setStatusError(503, 'GAMES_LOADING', '游戏库模块加载中');
  }
  const body = await readJsonBody(req);
  const id = String((body && body.id) || '').trim();
  if (!id) throw setStatusError(400, 'BAD_BODY', '请提供游戏 id');
  const patch = {};
  for (const k of ['region', 'mode', 'tags']) {
    if (body && body[k] !== undefined) patch[k] = body[k];
  }
  // games 模块 saveOverrides(overridesObject) 需要 { id: patch } 形式
  const overrides = {};
  overrides[id] = patch;
  const r = await mod.saveOverrides(overrides);
  gamesCache = { at: 0, data: null };
  const ok = !r || r.ok !== false;
  return json(res, ok ? 200 : 500, Object.assign({ ok }, r || {}));
}

// ---------------------------------------------------------------- 玄学 / 天气接口（fortune 模块桥接，未就绪时 503）
const FORTUNE_INDEX = path.join(HUB_ROOT, 'lib', 'fortune', 'index.js');

function loadFortune() {
  try {
    if (!fs.existsSync(FORTUNE_INDEX)) return null;
    return require(FORTUNE_INDEX);
  } catch (err) {
    writeLog('warn', `玄学引擎加载失败：${err && err.message ? err.message : err}`);
    return null;
  }
}

const fortuneCache = {
  weather: { at: 0, data: null },
  almanac: new Map(), // date -> {at,data}
};

async function callFortune(fnName, args) {
  const mod = loadFortune();
  if (!mod || typeof mod[fnName] !== 'function') {
    throw setStatusError(503, 'FORTUNE_LOADING', '玄学引擎加载中');
  }
  let result;
  try {
    result = await mod[fnName].apply(mod, args || []);
  } catch (err) {
    writeLog('warn', `玄学接口 ${fnName} 异常：${err && err.message ? err.message : err}`);
    throw setStatusError(502, 'FORTUNE_ERROR', `玄学接口异常：${(err && err.message) || err}`);
  }
  if (!result || result.ok === false) {
    throw setStatusError(503, 'FORTUNE_ERROR', (result && (result.error || result.message)) || '玄学引擎暂时不可用');
  }
  return result;
}

async function apiWeather(res) {
  if (fortuneCache.weather.data && Date.now() - fortuneCache.weather.at < 10 * 60 * 1000) {
    return json(res, 200, Object.assign({}, fortuneCache.weather.data, { ok: true, cached: true }));
  }
  const r = await callFortune('getWeather', []);
  const data = Object.assign({ ok: true }, r);
  fortuneCache.weather = { at: Date.now(), data };
  return json(res, 200, data);
}

async function apiAlmanac(res, query) {
  const today = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const fallback = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  const date = String((query && query.get('date')) || fallback);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw setStatusError(400, 'BAD_DATE', 'date 需为 YYYY-MM-DD');
  const hit = fortuneCache.almanac.get(date);
  if (hit && Date.now() - hit.at < 6 * 60 * 60 * 1000) {
    return json(res, 200, Object.assign({}, hit.data, { ok: true, date, cached: true }));
  }
  const r = await callFortune('getAlmanac', [date]);
  const data = Object.assign({ ok: true, date }, r);
  fortuneCache.almanac.set(date, { at: Date.now(), data });
  return json(res, 200, data);
}

async function apiFortuneDraw(req, res) {
  await readJsonBody(req).catch(() => ({}));
  const r = await callFortune('drawLot', []);
  return json(res, 200, r);
}

async function apiFortuneBazi(req, res) {
  const body = await readJsonBody(req);
  if (!body || !body.birth) throw setStatusError(400, 'BAD_BODY', '请提供出生时间 birth（如 1990-01-01 08:00）');
  const r = await callFortune('getBazi', [{ birth: String(body.birth), gender: String(body.gender || '') }]);
  return json(res, 200, r);
}

async function apiFortuneName(req, res) {
  const body = await readJsonBody(req);
  const surname = String((body && body.surname) || '').trim();
  const given = String((body && body.given) || '').trim();
  if (!surname || !given) throw setStatusError(400, 'BAD_BODY', '请提供姓氏与名字（surname / given）');
  const r = await callFortune('analyzeName', [{ surname, given }]);
  return json(res, 200, r);
}

const REG_EXE = process.env.SystemRoot
  ? path.join(process.env.SystemRoot, 'System32', 'reg.exe')
  : 'reg.exe';
const NVIDIA_SMI = process.env.SystemRoot
  ? path.join(process.env.SystemRoot, 'System32', 'nvidia-smi.exe')
  : 'nvidia-smi.exe';

const resourcesCache = {
  cpuStatic: { at: 0, data: null },
  gpu: { at: 0, data: null },
  cpuSample: { times: null, usagePct: 0, at: 0, cores: [] },
  pidNames: { at: 0, map: null },
};

function execFileCapture(file, args, timeoutMs) {
  return new Promise((resolve) => {
    try {
      execFile(
        file,
        args,
        { windowsHide: true, timeout: timeoutMs || 5000, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8' },
        (err, stdout) => resolve(String(stdout || ''))
      );
    } catch (_) {
      resolve('');
    }
  });
}

function parseNumField(value) {
  const s = String(value == null ? '' : value).trim();
  if (!s || /n\/a/i.test(s) || s === '-') return null;
  const cleaned = s.replace(/[^\d.\-]/g, '');
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

async function getCpuStatic() {
  if (resourcesCache.cpuStatic.data && Date.now() - resourcesCache.cpuStatic.at < 3600000) {
    return resourcesCache.cpuStatic.data;
  }
  let model = '';
  let regMHz = 0;
  try {
    const out = await execFileCapture(
      REG_EXE,
      ['query', 'HKLM\\HARDWARE\\DESCRIPTION\\System\\CentralProcessor\\0'],
      5000
    );
    const nameMatch = out.match(/ProcessorNameString\s+REG_SZ\s+(.+)/);
    if (nameMatch) model = nameMatch[1].trim();
    const mhzMatch = out.match(/~MHz\s+REG_DWORD\s+0x([0-9a-fA-F]+)/);
    if (mhzMatch) regMHz = parseInt(mhzMatch[1], 16);
  } catch (_) { /* ignore */ }

  let threads = 1;
  let speed = 0;
  try {
    const cpus = os.cpus();
    threads = cpus.length || 1;
    speed = Math.round((cpus[0] && cpus[0].speed) || 0);
    if (!model && cpus[0] && cpus[0].model) model = cpus[0].model;
  } catch (_) { /* ignore */ }

  const data = {
    model: model || 'Unknown CPU',
    cores: threads,
    threads,
    maxMHz: regMHz > 0 ? regMHz : speed,
    currentMHz: speed > 0 ? speed : regMHz,
  };
  resourcesCache.cpuStatic = { at: Date.now(), data };
  return data;
}

// os.cpus() 两次采样差值计算占用率（间隔 >= 1 秒，避免陡跳）
function getCpuUsagePct() {
  let sample;
  try {
    sample = os.cpus().map((c) => Object.assign({}, c.times));
  } catch (_) {
    return 0;
  }
  const now = Date.now();
  if (!resourcesCache.cpuSample.times) {
    resourcesCache.cpuSample = { times: sample, usagePct: 0, at: now };
    return 0;
  }
  if (now - resourcesCache.cpuSample.at < 1000) {
    return resourcesCache.cpuSample.usagePct;
  }
  const prev = resourcesCache.cpuSample.times;
  const n = Math.min(prev.length, sample.length);
  let idleDelta = 0;
  let totalDelta = 0;
  const cores = [];
  for (let i = 0; i < n; i++) {
    const p = prev[i];
    const c = sample[i];
    const pTotal = p.user + p.nice + p.sys + p.idle + p.irq;
    const cTotal = c.user + c.nice + c.sys + c.idle + c.irq;
    const iDelta = c.idle - p.idle;
    const tDelta = cTotal - pTotal;
    idleDelta += iDelta;
    totalDelta += tDelta;
    let cpct = tDelta > 0 ? 100 - (iDelta / tDelta) * 100 : 0;
    if (!Number.isFinite(cpct)) cpct = 0;
    cores.push(Math.max(0, Math.min(100, Math.round(cpct * 10) / 10)));
  }
  let pct = totalDelta > 0 ? 100 - (idleDelta / totalDelta) * 100 : 0;
  if (!Number.isFinite(pct)) pct = 0;
  pct = Math.max(0, Math.min(100, Math.round(pct * 10) / 10));
  resourcesCache.cpuSample = { times: sample, usagePct: pct, at: now, cores };
  return pct;
}

function getCpuUsageDetails() {
  const usagePct = getCpuUsagePct();
  return {
    usagePct,
    coresUsage: Array.isArray(resourcesCache.cpuSample.cores) ? resourcesCache.cpuSample.cores.slice() : [],
  };
}

// 网络速率：netstat -e 两次差分（纯 EXE）
let netPrev = null;
async function getNetStats() {
  const netstat = process.env.SystemRoot
    ? path.join(process.env.SystemRoot, 'System32', 'netstat.exe')
    : 'netstat.exe';
  let out = '';
  try {
    out = await execFileCapture(netstat, ['-e'], 5000);
  } catch (_) { /* ignore */ }
  // 第一行数据行（Bytes/字节/乱码首列）形如：Bytes  123456  654321
  let rx = null;
  let tx = null;
  for (const line of out.split(/\r?\n/)) {
    const m = line.match(/^\s*\S+\s+([\d,]+)\s+([\d,]+)\s*$/);
    if (m) {
      rx = Number(m[1].replace(/,/g, ''));
      tx = Number(m[2].replace(/,/g, ''));
      break;
    }
  }
  const now = Date.now();
  if (!Number.isFinite(rx) || !Number.isFinite(tx)) {
    return { available: false, upMbps: 0, downMbps: 0, rxBytes: 0, txBytes: 0 };
  }
  let upMbps = 0;
  let downMbps = 0;
  if (netPrev) {
    const dt = Math.max(0.2, (now - netPrev.at) / 1000);
    downMbps = Math.max(0, ((rx - netPrev.rx) * 8) / 1e6 / dt);
    upMbps = Math.max(0, ((tx - netPrev.tx) * 8) / 1e6 / dt);
  }
  netPrev = { at: now, rx, tx };
  const round2 = (v) => Math.round(v * 100) / 100;
  return { available: true, upMbps: round2(upMbps), downMbps: round2(downMbps), rxBytes: rx, txBytes: tx };
}

async function getPidNameMap() {
  if (resourcesCache.pidNames.map && Date.now() - resourcesCache.pidNames.at < 6000) {
    return resourcesCache.pidNames.map;
  }
  const tasklist = process.env.SystemRoot
    ? path.join(process.env.SystemRoot, 'System32', 'tasklist.exe')
    : 'tasklist.exe';
  const out = await execFileCapture(tasklist, ['/FO', 'CSV', '/NH'], 6000);
  const map = new Map();
  for (const line of out.split(/\r?\n/)) {
    const m = line.match(/^"([^"]+)","(\d+)"/);
    if (m) map.set(Number(m[2]), m[1].replace(/\.exe$/i, ''));
  }
  if (map.size > 0) resourcesCache.pidNames = { at: Date.now(), map };
  return map;
}

async function getGpuInfo() {
  if (resourcesCache.gpu.data && Date.now() - resourcesCache.gpu.at < 1500) {
    return resourcesCache.gpu.data;
  }
  const base = {
    available: false,
    name: '',
    driver: '',
    vramTotalMB: null,
    vramUsedMB: null,
    vramFreeMB: null,
    utilPct: null,
    tempC: null,
    powerW: null,
    fanPct: null,
    processes: [],
  };
  let out = '';
  try {
    out = await execFileCapture(
      NVIDIA_SMI,
      [
        '--query-gpu=name,driver_version,memory.total,memory.used,memory.free,utilization.gpu,temperature.gpu,power.draw,fan.speed',
        '--format=csv,noheader,nounits',
      ],
      6000
    );
  } catch (_) { /* ignore */ }

  const firstLine = out.trim().split(/\r?\n/).filter((l) => l.trim())[0] || '';
  if (!firstLine) {
    resourcesCache.gpu = { at: Date.now(), data: base };
    return base;
  }
  const parts = firstLine.split(',').map((s) => s.trim());
  const gpu = Object.assign({}, base, { available: true });
  if (parts.length >= 2) {
    gpu.name = parts[0];
    gpu.driver = parts[1];
  }
  if (parts.length >= 9) {
    gpu.vramTotalMB = parseNumField(parts[2]);
    gpu.vramUsedMB = parseNumField(parts[3]);
    gpu.vramFreeMB = parseNumField(parts[4]);
    gpu.utilPct = parseNumField(parts[5]);
    gpu.tempC = parseNumField(parts[6]);
    gpu.powerW = parseNumField(parts[7]);
    gpu.fanPct = parseNumField(parts[8]);
  }

  // GPU 进程：WDDM 下 used_memory 返回 [N/A]，此时 usedMB=null，前端显示 "—"
  let procOut = '';
  try {
    procOut = await execFileCapture(
      NVIDIA_SMI,
      ['--query-compute-apps=pid,process_name,used_memory', '--format=csv,noheader,nounits'],
      6000
    );
  } catch (_) { /* ignore */ }
  if (procOut.trim()) {
    const pidNames = await getPidNameMap();
    const procs = [];
    for (const line of procOut.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const segs = line.split(',');
      if (segs.length < 2) continue;
      const pid = Number(segs[0].trim());
      if (!Number.isInteger(pid) || pid <= 0) continue;
      const procPath = segs.slice(1, -1).join(',').trim();
      const usedRaw = segs[segs.length - 1].trim();
      const usedMB = /n\/a/i.test(usedRaw) ? null : parseNumField(usedRaw);
      let name = pidNames && pidNames.get(pid);
      if (!name) {
        name = procPath ? path.basename(procPath) : `PID ${pid}`;
        name = name.replace(/\.exe$/i, '');
      }
      procs.push({ pid, name, usedMB });
    }
    gpu.processes = procs.slice(0, 12);
  }

  resourcesCache.gpu = { at: Date.now(), data: gpu };
  return gpu;
}

function readGameModeSummary() {
  const st = readGameState();
  if (!st) {
    return { active: false, enteredAt: '', exitedAt: '', freedMemoryMB: 0, freedVramMB: 0, restoredCount: 0 };
  }
  const restore = st.restore || {};
  return {
    active: st.active === true,
    enteredAt: st.enteredAt || '',
    exitedAt: st.exitedAt || '',
    freedMemoryMB: Number(st.freedMemoryMB) || 0,
    freedVramMB: Number(st.freedVramMB) || 0,
    restoredCount: Array.isArray(restore.restored) ? restore.restored.length : 0,
  };
}

async function apiResources(res) {
  const config = requireConfig(); // 确保 tools.json 可读（配置异常时返回统一错误）
  const cpuStatic = await getCpuStatic();
  const gpu = await getGpuInfo();
  const net = await getNetStats();
  let totalBytes = 0;
  let freeBytes = 0;
  try {
    totalBytes = os.totalmem();
    freeBytes = os.freemem();
  } catch (_) { /* ignore */ }
  const usedBytes = Math.max(0, totalBytes - freeBytes);
  let hostname = '';
  let uptimeSec = 0;
  let osName = '';
  let release = '';
  try {
    hostname = os.hostname();
    uptimeSec = Math.round(os.uptime());
    osName = typeof os.version === 'function' ? os.version() : os.type();
    release = os.release();
  } catch (_) { /* ignore */ }

  const disks = readDisks().map((d) => ({
    id: d.id,
    label: d.label,
    totalBytes: d.totalBytes || 0,
    freeBytes: d.freeBytes || 0,
    usedPct: typeof d.usedPercent === 'number' ? d.usedPercent : 0,
  }));

  const cpuUsage = getCpuUsageDetails();
  let currentMode = 'normal';
  let modeSince = '';
  try {
    const modeState = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'mode-state.json'), 'utf8'));
    if (modeState && modeState.mode) { currentMode = modeState.mode; modeSince = modeState.since || ''; }
  } catch (_) { /* ignore */ }

  json(res, 200, {
    ok: true,
    host: {
      name: hostname,
      uptimeSec,
      os: osName || '',
      release: release || '',
      platform: `${process.platform} ${process.arch}`,
    },
    cpu: Object.assign({}, cpuStatic, cpuUsage),
    memory: {
      totalBytes,
      usedBytes,
      freeBytes,
      usedPct: totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 1000) / 10 : 0,
    },
    gpu,
    net,
    disks,
    gameMode: readGameModeSummary(),
    mode: { current: currentMode, since: modeSince },
    hub: { version: HUB_VERSION, pid: process.pid, coreConfig: config.tools.length },
    at: isoLocal(),
  });
}

// ---------------------------------------------------------------- 脱敏输出

// 判断工具当前是否「可启动/可打开」：只做存在性检查，不执行任何命令
function launchReadiness(tool) {
  const launch = tool.launch || {};
  const kind = launch.kind || 'none';
  if (kind === 'none') {
    return { ready: false, kind, reason: launch.note || '未配置启动方式' };
  }
  if (kind === 'self' || kind === 'service') {
    return { ready: true, kind, reason: '' };
  }
  if (kind === 'appx') {
    return { ready: true, kind, reason: '' };
  }
  if (kind === 'url') {
    const target = launch.url || tool.url;
    if (validOpenTarget(target)) return { ready: true, kind, reason: '' };
    return { ready: false, kind, reason: `打开目标不存在：${target || '(空)'}` };
  }
  if (kind === 'exe') {
    const exe = launch.exe;
    if (!exe) return { ready: false, kind, reason: '未配置可执行文件路径' };
    try {
      if (fs.existsSync(exe)) return { ready: true, kind, reason: '' };
    } catch (_) { /* ignore */ }
    return { ready: false, kind, reason: `可执行文件不存在：${exe}` };
  }
  if (kind === 'script') {
    const script = launch.script;
    if (!script) return { ready: false, kind, reason: '未配置启动脚本' };
    const abs = path.isAbsolute(script) ? script : path.join(SCRIPTS_DIR, script);
    try {
      if (fs.existsSync(abs)) return { ready: true, kind, reason: '' };
    } catch (_) { /* ignore */ }
    return { ready: false, kind, reason: `启动脚本不存在：${abs}` };
  }
  return { ready: false, kind, reason: `未知启动方式：${kind}` };
}

function publicTools(config) {
  return config.tools.map((t) => {
    const kind = (t.launch && t.launch.kind) || 'none';
    const health = t.health || {};
    const readiness = launchReadiness(t);
    const launchUrl = (t.launch && typeof t.launch.url === 'string') ? t.launch.url : '';
    return {
      id: t.id,
      name: t.name || t.id,
      nameZh: t.nameZh || '',
      i18n: t.i18n || null,
      category: t.category || 'system',
      categoryName: categoryName(config, t.category || 'system'),
      version: t.version || '',
      description: t.description || '',
      icon: t.icon || 'tool',
      tags: Array.isArray(t.tags) ? t.tags : [],
      url: typeof t.url === 'string' ? t.url : '',
      openUrl: kind === 'url' ? (launchUrl || t.url || '') : (typeof t.url === 'string' ? t.url : ''),
      statusText: t.statusText || null,
      draft: !!t.draft,
      badge: t.badge || '',
      gameMode: t.gameMode || 'keep',
      paths: t.paths || null,
      notes: Array.isArray(t.notes) ? t.notes : [],
      actionLabel: (t.launch && t.launch.actionLabel) || '',
      launchKind: kind,
      canLaunch: readiness.ready,
      launchReady: readiness.ready,
      launchReason: readiness.ready ? '' : readiness.reason,
      healthType: health.type || 'none',
      healthPort: health.port || null,
    };
  });
}

// ---------------------------------------------------------------- 磁盘信息

function diskInfo(id, label) {
  const root = `${id}:\\`;
  try {
    const s = fs.statfsSync(root);
    const totalBytes = Number(s.blocks) * Number(s.bsize);
    const freeBytes = Number(s.bavail) * Number(s.bsize);
    const usedBytes = Math.max(0, totalBytes - freeBytes);
    return {
      id,
      label,
      root,
      available: true,
      totalBytes,
      freeBytes,
      usedBytes,
      usedPercent: totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 1000) / 10 : 0,
    };
  } catch (err) {
    return { id, label, root, available: false, error: err.code || err.message };
  }
}

function readDisks() {
  return [diskInfo('C', '系统盘'), diskInfo('D', '软件与数据'), diskInfo('I', 'AI 仓库')];
}

// ---------------------------------------------------------------- UI 同步

function fallbackHtml() {
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>Sanwa系统管理器 · 界面缺失</title>
<style>body{background:#0b0f1a;color:#dbe4ff;font-family:"Microsoft YaHei",sans-serif;padding:48px;line-height:1.8}
code{background:#161d2f;padding:2px 6px;border-radius:4px}</style></head>
<body><h1>界面文件尚未生成</h1>
<p>请先运行：<code>node ${HUB_ROOT}\\scripts\\build-ui.js</code> 生成桌面 HTML 与 web/index.html。</p>
<p>或双击 <code>${HUB_ROOT}\\start-sanwa.cmd</code>。</p></body></html>`;
}

function ensureUiSync() {
  try {
    const { data } = loadConfig();
    const hub = (data && data.hub) || {};
    const desktopHtml = hub.desktopHtml || process.env.SANWA_DESKTOP || path.join(os.homedir(), 'Desktop', 'Sanwa系统管理器.html');
    const webIndex = hub.webIndex || path.join(HUB_ROOT, 'web', 'index.html');
    if (!fs.existsSync(desktopHtml)) {
      uiSyncNote = '桌面 HTML 不存在，将使用 web/index.html';
      return;
    }
    const desktopContent = fs.readFileSync(desktopHtml, 'utf8');
    let webContent = null;
    try { webContent = fs.readFileSync(webIndex, 'utf8'); } catch (_) {}
    if (webContent !== desktopContent) {
      fs.mkdirSync(path.dirname(webIndex), { recursive: true });
      fs.writeFileSync(webIndex, desktopContent, 'utf8');
      uiSyncNote = `已同步桌面 HTML → web/index.html (${nowStamp()})`;
      writeLog('info', uiSyncNote);
    } else {
      uiSyncNote = '两者内容一致';
    }
  } catch (err) {
    uiSyncNote = `同步失败: ${err.message}`;
    writeLog('warn', uiSyncNote);
  }
}

function readUiHtml() {
  let hub = {};
  try { hub = requireConfig().hub || {}; } catch (_) {}
  const candidates = [];
  if (hub.desktopHtml) candidates.push(hub.desktopHtml);
  if (hub.webIndex) candidates.push(hub.webIndex);
  candidates.push(path.join(HUB_ROOT, 'web', 'index.html'));
  for (const file of candidates) {
    try {
      if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8');
    } catch (_) { /* next */ }
  }
  return fallbackHtml();
}

// ---------------------------------------------------------------- API 实现

function apiMeta(res) {
  const config = requireConfig();
  const hub = config.hub;
  let uiDesktop = { path: hub.desktopHtml, exists: false };
  try {
    const st = fs.statSync(hub.desktopHtml);
    uiDesktop = { path: hub.desktopHtml, exists: true, size: st.size, mtime: st.mtime.toISOString() };
  } catch (_) {}
  let uiWeb = { path: hub.webIndex, exists: false };
  try {
    const st2 = fs.statSync(hub.webIndex);
    uiWeb = { path: hub.webIndex, exists: true, size: st2.size, mtime: st2.mtime.toISOString() };
  } catch (_) {}
  json(res, 200, {
    ok: true,
    generatedAt: isoLocal(),
    hub: {
      name: hub.name,
      version: hub.version,
      host: HOST,
      port: PORT,
      apiBase: `http://${HOST}:${PORT}`,
      pid: process.pid,
      node: process.version,
      platform: `${process.platform} ${process.arch}`,
      startedAt: startedAt.toISOString(),
      uptimeSec: Math.round((Date.now() - startedAt.getTime()) / 1000),
      root: HUB_ROOT,
      desktopHtml: hub.desktopHtml,
      webIndex: hub.webIndex,
      startCmd: hub.startCmd,
      logsDir: LOGS_DIR,
      scriptsDir: SCRIPTS_DIR,
    },
    disks: readDisks(),
    tools: {
      total: config.tools.length,
      draft: config.tools.filter((t) => t.draft).length,
      categories: (config.categories || []).map((c) => ({
        id: c.id,
        name: c.name,
        count: config.tools.filter((t) => t.category === c.id).length,
      })),
    },
    ui: { desktop: uiDesktop, web: uiWeb, syncNote: uiSyncNote },
  });
}

function apiTools(res) {
  const config = requireConfig();
  json(res, 200, {
    ok: true,
    generatedAt: isoLocal(),
    version: config.hub.version,
    toolBookVersion: config.toolBookVersion || '',
    isDraft: !!config.draft,
    categories: config.categories || [],
    tools: publicTools(config),
    hub: {
      name: config.hub.name,
      version: config.hub.version,
      host: HOST,
      port: PORT,
      apiBase: `http://${HOST}:${PORT}`,
      desktopHtml: config.hub.desktopHtml,
      startCmd: config.hub.startCmd,
    },
  });
}

async function apiStatus(res) {
  const config = requireConfig();
  const states = await computeStates(config);
  json(res, 200, {
    ok: true,
    at: isoLocal(),
    hub: { version: config.hub.version, port: PORT, uptimeSec: Math.round((Date.now() - startedAt.getTime()) / 1000) },
    states,
  });
}

async function apiLaunch(req, res) {
  const config = requireConfig();
  const body = await readJsonBody(req);
  const id = String(body.id || '').trim().toLowerCase();
  const tool = findTool(config, id);
  if (!tool) throw setStatusError(404, 'UNKNOWN_TOOL', '未知工具 id（不在白名单内）');

  // 游戏模式期间：被暂停的工具不允许通过 API 拉起
  const gameState = readGameState();
  if (gameState && gameState.active === true && tool.gameMode === 'stop') {
    throw setStatusError(
      409,
      'GAME_MODE_ACTIVE',
      `当前处于游戏模式，${toolDisplayName(tool)} 已被暂停；请先退出游戏模式再启动`
    );
  }

  const kind = (tool.launch && tool.launch.kind) || 'none';
  const now = Date.now();
  if (launches.has(id) && launches.get(id).state === 'starting' && now - launches.get(id).startedAt < 120000) {
    return json(res, 200, {
      ok: true,
      action: 'pending',
      state: 'starting',
      message: `${toolDisplayName(tool)} 正在启动中，请稍候…`,
    });
  }
  if (lastLaunchAt.has(id) && now - lastLaunchAt.get(id) < LAUNCH_COOLDOWN_MS) {
    return json(res, 200, { ok: true, action: 'pending', state: 'starting', message: '操作过于频繁，请稍候重试' });
  }

  // 1) 已在运行：打开界面
  const probe = await probeTool(tool);
  const healthType = (tool.health && tool.health.type) || 'none';
  const ownedAlive = (healthType === 'none') ? ownedProcessInfo(id) : null;
  if (probe.state === 'running' || ownedAlive) {
    invalidateProbe(id);
    let message = `${toolDisplayName(tool)} 已在运行`;
    if (tool.url) {
      const opened = await openTarget(tool.url);
      if (opened.ok) message += '，已为你打开界面';
      else message += '，但打开界面失败：' + opened.message;
    } else if (ownedAlive) {
      message += `（进程运行中，PID ${ownedAlive.pid}；该应用无网页界面，请查看任务栏窗口）`;
    } else {
      message += '（该应用无网页界面，请查看任务栏窗口）';
    }
    return json(res, 200, { ok: true, action: 'open', state: 'running', message });
  }

  // 2) 启动前置检查：未配置 / 可执行文件或脚本缺失时直接给出中文原因（不进入 starting）
  const readiness = launchReadiness(tool);
  if (!readiness.ready) {
    throw setStatusError(400, 'NOT_READY', `${toolDisplayName(tool)} 当前不可一键启动：${readiness.reason}`);
  }

  // 3) 只打开目标（URL / 文件夹）：不跟踪进程，直接打开
  if (kind === 'url') {
    const target = (tool.launch && tool.launch.url) || tool.url;
    const opened = await openTarget(target);
    if (!opened.ok) throw setStatusError(500, 'OPEN_FAILED', `打开失败：${opened.message}`);
    const isFolder = !/^https?:\/\//i.test(String(target));
    return json(res, 200, {
      ok: true,
      action: 'open',
      state: 'unknown',
      message: isFolder ? `已打开目录：${target}` : `已打开链接：${target}`,
    });
  }

  // 4) 控制中心自身：只打开界面，不重复启动
  if (kind === 'self') {
    const target = config.hub.desktopHtml && fs.existsSync(config.hub.desktopHtml) ? config.hub.desktopHtml : tool.url;
    const opened = await openTarget(target);
    return json(res, opened.ok ? 200 : 500, {
      ok: opened.ok,
      action: 'open',
      state: 'running',
      message: opened.ok ? '控制中心界面已打开' : `打开界面失败：${opened.message}`,
    });
  }

  // 5) 通过预置脚本启动（只允许 scripts/<id>.ps1）
  const scriptFile = path.join(SCRIPTS_DIR, `${id}.ps1`);
  if (!fs.existsSync(scriptFile)) {
    throw setStatusError(500, 'SCRIPT_MISSING', `缺少启动脚本 scripts/${id}.ps1，无法启动 ${toolDisplayName(tool)}`);
  }
  const waitSeconds = Number(tool.launch && tool.launch.waitSeconds) > 0 ? Number(tool.launch.waitSeconds) : DEFAULT_TOOL_WAIT_SEC;
  launches.set(id, { state: 'starting', startedAt: now, timeoutMs: (waitSeconds + 30) * 1000 });
  lastLaunchAt.set(id, now);
  invalidateProbe(id);
  const spawned = await spawnScriptDetached(scriptFile, ['-Action', 'start']);
  if (!spawned.ok) {
    launches.delete(id);
    throw setStatusError(500, 'LAUNCH_FAILED', spawned.message);
  }
  writeLog('info', `launch ${id}（脚本 ${path.basename(scriptFile)}，pid ${spawned.pid}）`);
  return json(res, 200, {
    ok: true,
    action: 'launching',
    state: 'starting',
    message: `正在启动 ${toolDisplayName(tool)}…`,
    waitSeconds,
  });
}

async function apiStop(req, res) {
  const config = requireConfig();
  const body = await readJsonBody(req);
  const id = String(body.id || '').trim().toLowerCase();
  const tool = findTool(config, id);
  if (!tool) throw setStatusError(404, 'UNKNOWN_TOOL', '未知工具 id（不在白名单内）');
  const kind = (tool.launch && tool.launch.kind) || 'none';
  if (kind === 'none') throw setStatusError(400, 'NOT_CONFIGURED', `${toolDisplayName(tool)} 未配置启动方式，无需停止`);
  if (kind === 'self') {
    throw setStatusError(403, 'FORBIDDEN_SELF', '出于安全考虑，控制中心不会停止自己的服务进程。请使用 scripts\\stop-hub.ps1');
  }
  if (!isPidFilePresent(id)) {
    throw setStatusError(
      403,
      'NOT_OWNED',
      `${toolDisplayName(tool)} 不是由 Sanwa系统管理器启动的，出于安全考虑不会停止它`
    );
  }
  const scriptFile = path.join(SCRIPTS_DIR, `${id}.ps1`);
  const r = await runScriptCaptured(scriptFile, ['-Action', 'stop'], 25000);
  const combined = `${r.stdout}\n${r.stderr}`.trim();
  const message = lastMeaningfulLine(combined) || (r.code === 0 ? `${toolDisplayName(tool)} 已停止` : `${toolDisplayName(tool)} 停止失败`);
  if (r.code === 0) {
    invalidateProbe(id);
    launches.delete(id);
    writeLog('info', `stop ${id}: ${message}`);
    return json(res, 200, { ok: true, action: 'stopped', state: 'stopped', message });
  }
  if (r.code === 2) {
    writeLog('warn', `stop ${id} 被拒绝: ${message}`);
    return json(res, 403, { ok: false, action: 'stopped', state: 'running', message });
  }
  writeLog('error', `stop ${id} 失败: ${message}`);
  return json(res, 500, { ok: false, action: 'stop-failed', message });
}

function readLogTail(file, maxLines) {
  let stat;
  try { stat = fs.statSync(file); } catch (_) { return { exists: false, lines: [] }; }
  const maxBytes = 128 * 1024;
  const start = Math.max(0, stat.size - maxBytes);
  let text = '';
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const len = stat.size - start;
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, start);
      text = buf.toString('utf8');
    } finally {
      fs.closeSync(fd);
    }
  } catch (err) {
    return { exists: true, error: err.message, lines: [] };
  }
  if (start > 0) {
    const idx = text.indexOf('\n');
    if (idx >= 0) text = text.slice(idx + 1);
  }
  // 去掉可能残留的 UTF-8 BOM（Windows PowerShell 写日志时可能带 BOM）
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  return { exists: true, total: lines.length, lines: lines.slice(-maxLines) };
}

function apiLogs(res, query) {
  const config = requireConfig();
  const id = String(query.get('id') || '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(id)) throw setStatusError(400, 'BAD_ID', '日志 id 非法');
  const allowed = new Set(config.tools.map((t) => t.id));
  allowed.add('hub');
  if (!allowed.has(id)) throw setStatusError(404, 'UNKNOWN_TOOL', '未知工具 id（不在白名单内）');
  const limitRaw = Number(query.get('lines') || 200);
  const maxLines = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 1), 1000) : 200;
  const file = path.join(LOGS_DIR, `${id}.log`);
  const tail = readLogTail(file, maxLines);
  json(res, 200, {
    ok: true,
    id,
    file,
    exists: tail.exists,
    lines: tail.lines,
    note: tail.exists ? '' : '暂无日志（该工具可能从未由控制中心启动）',
  });
}

// ---------------------------------------------------------------- 路由

async function route(req, res) {
  setCommonHeaders(res);
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  const url = new URL(req.url || '/', `http://${HOST}:${PORT}`);
  const pathname = decodeURIComponent(url.pathname);
  const method = req.method || 'GET';

  if (method === 'GET') {
    switch (pathname) {
      case '/api/meta':
        return apiMeta(res);
      case '/api/tools':
        return apiTools(res);
      case '/api/status':
        return apiStatus(res);
      case '/api/resources':
        return apiResources(res);
      case '/api/game-mode/status':
        return apiGameStatus(res);
      case '/api/autostart':
        return apiAutostartStatus(res);
      case '/api/modes/status':
        return apiModesStatus(res);
      case '/api/weather':
        return apiWeather(res);
      case '/api/almanac':
        return apiAlmanac(res, url.searchParams);
      case '/api/activity':
        return apiActivity(res, url.searchParams);
      case '/api/games':
        return apiGames(res);
      case '/api/background/state':
        return apiBackgroundState(res);
      case '/api/profile':
        return apiProfileGet(res);
      case '/api/logs':
        return apiLogs(res, url.searchParams);
      case '/api/ping':
        return json(res, 200, { ok: true, hub: HUB_VERSION, at: isoLocal(), pid: process.pid });
      case '/api/version':
        return json(res, 200, { ok: true, hub: HUB_VERSION, node: process.version, startedAt: startedAt.toISOString() });
      case '/':
      case '/index.html': {
        const html = readUiHtml();
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
        return undefined;
      }
      case '/favicon.ico':
        res.writeHead(204);
        res.end();
        return undefined;
      default:
        if (pathname.indexOf('/api/background/file/') === 0) {
          return serveBackgroundFile(res, pathname.slice('/api/background/file/'.length));
        }
        throw setStatusError(404, 'NOT_FOUND', `未找到接口或文件：${pathname}`);
    }
  }

  if (method === 'POST') {
    switch (pathname) {
      case '/api/launch':
        return apiLaunch(req, res);
      case '/api/stop':
        return apiStop(req, res);
      case '/api/stop-all':
        return apiStopAll(req, res);
      case '/api/autostart':
        return apiAutostartSet(req, res);
      case '/api/modes/switch':
        return apiModesSwitch(req, res);
      case '/api/fortune/draw':
        return apiFortuneDraw(req, res);
      case '/api/fortune/bazi':
        return apiFortuneBazi(req, res);
      case '/api/fortune/name':
        return apiFortuneName(req, res);
      case '/api/games/scan':
        return apiGamesScan(req, res);
      case '/api/games/launch':
        return apiGamesLaunch(req, res);
      case '/api/games/overrides':
        return apiGamesOverrides(req, res);
      case '/api/profile':
        return apiProfilePost(req, res);
      case '/api/background':
        return apiBackgroundSet(req, res);
      case '/api/background/clear':
        return apiBackgroundClear(res);
      case '/api/game-mode':
        return apiGameEnter(req, res);
      case '/api/game-mode/exit':
        return apiGameExit(req, res);
      default:
        throw setStatusError(404, 'NOT_FOUND', `未找到接口：${pathname}`);
    }
  }

  throw setStatusError(405, 'METHOD_NOT_ALLOWED', `不支持的请求方法：${method}`);
}

// ---------------------------------------------------------------- 启动/退出

function writePidFile() {
  try {
    ensureDirs();
    fs.writeFileSync(
      HUB_PID_FILE,
      JSON.stringify({ pid: process.pid, port: PORT, host: HOST, startedAt: startedAt.toISOString(), version: HUB_VERSION }, null, 2),
      'utf8'
    );
  } catch (err) {
    writeLog('warn', `写入 hub.pid 失败: ${err.message}`);
  }
}

function removePidFile() {
  try {
    if (fs.existsSync(HUB_PID_FILE)) {
      const raw = fs.readFileSync(HUB_PID_FILE, 'utf8');
      let pid = null;
      try { pid = JSON.parse(raw).pid; } catch (_) {}
      if (pid === process.pid) fs.unlinkSync(HUB_PID_FILE);
    }
  } catch (_) { /* ignore */ }
}

function shutdown(code) {
  writeLog('info', 'Sanwa系统管理器服务正在退出…');
  removePidFile();
  server.close(() => process.exit(code));
  setTimeout(() => process.exit(code), 1500).unref();
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
process.on('uncaughtException', (err) => {
  writeLog('error', `未捕获异常: ${err && err.stack ? err.stack : err}`);
});
process.on('unhandledRejection', (err) => {
  writeLog('error', `未处理的 Promise 拒绝: ${err && err.stack ? err.stack : err}`);
});

ensureDirs();
const initialConfig = loadConfig();
if (initialConfig.error) {
  console.error(`[hub] 配置告警：${initialConfig.error}`);
} else {
  console.log(`[hub] 已加载 ${initialConfig.data.tools.length} 个工具配置（v${initialConfig.data.hub.version}）`);
}
ensureUiSync();

const server = http.createServer((req, res) => {
  route(req, res).catch((err) => {
    const statusCode = err.statusCode || 500;
    if (statusCode >= 500) writeLog('error', `请求处理异常 ${req.method} ${req.url}: ${err.message}`);
    if (!res.headersSent) {
      json(res, statusCode, {
        ok: false,
        error: err.code || 'INTERNAL_ERROR',
        message: err.message || '服务内部错误',
      });
    } else {
      try { res.end(); } catch (_) {}
    }
  });
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[hub] 端口 ${HOST}:${PORT} 已被占用：Sanwa系统管理器可能已经在运行。`);
    console.error('[hub] 可直接打开桌面“Sanwa系统管理器.html”，或运行 scripts\\stop-hub.ps1 重新启动。');
  } else if (err.code === 'EACCES') {
    console.error(`[hub] 无权限绑定 ${HOST}:${PORT}（端口 <1024 需要管理员权限）。`);
  } else {
    console.error('[hub] 服务启动失败:', err);
  }
  removePidFile();
  process.exit(1);
});

// 旧版 Startup 快捷方式 AI控制中心.lnk → Sanwa系统管理器.lnk（一次性更名）
function migrateAutostartShortcut() {
  try {
    const oldLnk = path.join(STARTUP_DIR, 'AI控制中心.lnk');
    if (!fs.existsSync(oldLnk)) return;
    if (fs.existsSync(AUTOSTART_LNK)) {
      fs.unlinkSync(oldLnk);
      writeLog('info', '已删除旧 Startup 快捷方式 AI控制中心.lnk（新版已存在）');
    } else {
      fs.renameSync(oldLnk, AUTOSTART_LNK);
      writeLog('info', 'Startup 快捷方式已更名：AI控制中心.lnk → ' + path.basename(AUTOSTART_LNK));
    }
  } catch (err) {
    writeLog('warn', 'Startup 快捷方式更名失败：' + (err && err.message ? err.message : err));
  }
}

server.listen(PORT, HOST, () => {
  migrateAutostartShortcut();
  writePidFile();
  // 预热 CPU 采样与网络差分（第一次 /api/resources 即可返回有意义的速率）
  try { getCpuUsagePct(); } catch (_) { /* ignore */ }
  try { getNetStats().catch(() => {}); } catch (_) { /* ignore */ }
  console.log('');
  console.log('  ╔══════════════════════════════════════════╗');
  console.log(`  ║   Sanwa系统管理器 · 本地服务 v${HUB_VERSION}            ║`);
  console.log('  ╚══════════════════════════════════════════╝');
  console.log(`  地址   http://${HOST}:${PORT}/`);
  console.log(`  目录   ${HUB_ROOT}`);
  console.log(`  日志   ${path.join(LOGS_DIR, 'hub.log')}`);
  console.log(`  PID    ${process.pid}   Node ${process.version}`);
  console.log('  停止   node server.js 所在窗口 Ctrl+C，或运行 scripts\\stop-hub.ps1');
  console.log('');
  writeLog('info', `服务启动 http://${HOST}:${PORT}/ pid=${process.pid} node=${process.version} ui=${uiSyncNote}`);
});
