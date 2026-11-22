#!/usr/bin/env node
// AI 控制中心 · 五种模式引擎（纯 Node；模式切换不经过 PowerShell）
// 五模式：normal(正常) / ai(AI) / office(办公) / game(游戏) / extreme(极端游戏)
// 开关流程：停 stop 目标 → 等待释放 → 启动 start 目标 → 写 data/mode-state.json
// 保护：DeepSeek Harness / 控制中心 / Steam / 雷神 / 系统进程永不关闭
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const net = require('net');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');

const HUB_ROOT = path.resolve(__dirname, '..');
const CONFIG_FILE = path.join(HUB_ROOT, 'data', 'tools.json');
const MODE_STATE_FILE = path.join(HUB_ROOT, 'data', 'mode-state.json');
const PREFERENCES_FILE = path.join(HUB_ROOT, 'data', 'mode-preferences.json');
const MODE_LOG = path.join(HUB_ROOT, 'logs', 'modes.log');
const PROC_SNAPSHOT_VBS = path.join(HUB_ROOT, 'scripts', 'proc-snapshot.vbs');
const PROC_SNAP_DIR = path.join(HUB_ROOT, 'tmp');
const STARTUP_LNK = path.join(
  process.env.APPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming'),
  'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'Sanwa系统管理器.lnk'
);

const CACHE_MS = 1500;
const PROTECTED_NAMES = [
  /^DeepSeek Harness\.exe$/i, /^node\.exe$/i, /^powershell\.exe$/i, /^pwsh\.exe$/i,
  /^explorer\.exe$/i, /^cmd\.exe$/i, /^conhost\.exe$/i, /^svchost\.exe$/i, /^dwm\.exe$/i,
  /^winlogon\.exe$/i, /^wininit\.exe$/i, /^Registry\.exe$/i, /^System\.exe$/i,
  /^csrss\.exe$/i, /^lsass\.exe$/i, /^smss\.exe$/i, /^services\.exe$/i, /^taskhostw\.exe$/i,
  /^steam\.exe$/i, /^steamwebhelper\.exe$/i, /^SteamService\.exe$/i,
  /^leigod\.exe$/i, /^leigod_launcher\.exe$/i, /^LeigodAcc\.exe$/i,
];
// 受保护路径（任何命中的进程都不允许被杀）
const PROTECTED_PATH_TOKENS = [
  '\\DeepSeek Harness.exe',
  '\\AI\\Hub\\',
  '\\Steam\\',
  '\\LeiGod_Acc\\',
  '\\Windows\\System32\\',
  '\\Windows\\explorer.exe',
];

// 常见 AI 进程名回退（tools.json 中旧工具未配置 procNames 时使用）
const FALLBACK_PROC = {
  ollama: ['ollama.exe', 'ollama app.exe'],
  lmstudio: ['LM Studio.exe', 'llama-server.exe'],
  'open-webui': [], // 通过 8080 端口识别
  'codex-desktop': ['ChatGPT.exe', 'codex.exe'],
  comfyui: [], // 通过 8188 端口识别（python.exe 不可全局杀）
  'breeze-tts-2': ['breeze-server.exe'],
  'breeze-studio': ['breeze-studio.exe'],
  'hermes-cn-desktop': ['hermes-agent-cn-desktop.exe'],
  kimi: ['Kimi.exe'],
  qianwen: ['qianwen.exe'],
  doubao: ['Doubao.exe'],
  workbuddy: ['WorkBuddy.exe'],
  pptmaster: ['PPTMaster.exe', 'ppt-master.exe'],
  'hermes-cli': [],
  'codex-local-cli': [],
  'codex-sandbox-service': ['codex-windows-sandbox-service.exe'],
  'deepseek-harness': ['DeepSeek Harness.exe'],
  'hub-self': [],
};

function log(msg) {
  try {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const ts = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    fs.appendFileSync(MODE_LOG, `${ts} [modes] ${msg}\r\n`, 'utf8');
  } catch (_) { /* ignore */ }
}

function run(cmd, args, timeout) {
  return new Promise((resolve) => {
    try {
      execFile(cmd, args, { windowsHide: true, timeout: timeout || 30000, maxBuffer: 16 * 1024 * 1024, encoding: 'utf8' }, (err, stdout, stderr) => {
        const code = err ? (typeof err.code === 'number' ? err.code : -1) : 0;
        resolve({ code, stdout: stdout || '', stderr: stderr || '' });
      });
    } catch (err) {
      resolve({ code: -1, stdout: '', stderr: String(err && err.message) });
    }
  });
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); } catch (_) { return fallback; }
}
function writeJson(file, data) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (err) {
    log(`写入失败 ${file}: ${err.message}`);
    return false;
  }
}
function nowIso() { return new Date().toISOString(); }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function tasklist() {
  const r = await run('tasklist.exe', ['/FO', 'CSV', '/NH'], 8000);
  const list = [];
  for (const line of r.stdout.split(/\r?\n/)) {
    const m = line.match(/^"([^"]+)","(\d+)","[^"]*","[^"]*","([\d,]+)\s*K"/);
    if (m) list.push({ name: m[1], pid: Number(m[2]), memMB: Number(m[3].replace(/,/g, '')) / 1024 });
  }
  return list;
}

async function netstat() {
  const r = await run('netstat.exe', ['-ano', '-p', 'tcp'], 10000);
  const ports = new Map();
  for (const line of r.stdout.split(/\r?\n/)) {
    const m = line.match(/^\s*TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)/i);
    if (m) {
      const port = Number(m[1]);
      const pid = Number(m[2]);
      if (!ports.has(port)) ports.set(port, []);
      if (!ports.get(port).includes(pid)) ports.get(port).push(pid);
    }
  }
  return ports;
}

let snapCache = { at: 0, procs: null, ports: null };
async function snapshot(force) {
  if (!force && snapCache.procs && Date.now() - snapCache.at < CACHE_MS) return snapCache;
  const [procs, ports] = await Promise.all([tasklist(), netstat()]);
  snapCache = { at: Date.now(), procs, ports };
  return snapCache;
}
function invalidateCache() { snapCache = { at: 0, procs: null, ports: null }; }

function isProtectedName(name) {
  const n = String(name || '').trim();
  return PROTECTED_NAMES.some((re) => re.test(n));
}

function isProtectedPath(p) {
  const s = String(p || '').toLowerCase();
  if (!s) return false;
  return PROTECTED_PATH_TOKENS.some((tok) => s.includes(tok.toLowerCase()));
}

// 纯 EXE（cscript+WMI）读取进程可执行路径；cscript 可能被安全软件在退出时打断，但快照文件已完整写入
let procSnapCache = { at: 0, index: null };
async function procSnapshot(force) {
  if (!force && procSnapCache.index && Date.now() - procSnapCache.at < 5000) {
    return procSnapCache.index;
  }
  if (!fs.existsSync(PROC_SNAPSHOT_VBS)) return null;
  try { fs.mkdirSync(PROC_SNAP_DIR, { recursive: true }); } catch (_) { /* ignore */ }
  const outFile = path.join(PROC_SNAP_DIR, `proc-snap-${process.pid}-${Date.now()}.txt`);
  const cscript = process.env.SystemRoot
    ? path.join(process.env.SystemRoot, 'System32', 'cscript.exe')
    : 'cscript.exe';
  await new Promise((resolve) => {
    try {
      execFile(cscript, ['//nologo', PROC_SNAPSHOT_VBS, outFile], {
        windowsHide: true, timeout: 35000, maxBuffer: 1024 * 1024, encoding: 'utf8',
      }, () => resolve());
    } catch (_) { resolve(); }
  });
  let text = '';
  try { text = fs.readFileSync(outFile, 'utf8'); } catch (_) { return null; }
  try { fs.unlinkSync(outFile); } catch (_) { /* ignore */ }
  const index = new Map();
  for (const line of text.split(/\r?\n/)) {
    const parts = line.split('|');
    if (parts.length < 4) continue;
    const pid = Number(parts[0]);
    if (!Number.isInteger(pid) || pid <= 0) continue;
    const name = parts[1] || '';
    const exePath = parts[2] || '';
    const memBytes = Number(parts[3]) || 0;
    index.set(pid, { name, path: exePath, memMB: memBytes / 1048576 });
  }
  if (index.size > 0) procSnapCache = { at: Date.now(), index };
  return index.size > 0 ? index : null;
}

function toolProcNames(tool) {
  const names = [];
  if (Array.isArray(tool.procNames)) names.push(...tool.procNames);
  if (tool.health && tool.health.type === 'process') {
    const hp = tool.health.process;
    if (Array.isArray(hp)) names.push(...hp);
    else if (hp) names.push(hp);
  }
  if (!names.length && FALLBACK_PROC[tool.id]) names.push(...FALLBACK_PROC[tool.id]);
  return Array.from(new Set(names.map((n) => String(n || '').trim()).filter(Boolean)));
}

function portOf(tool) {
  const port = tool.health && Number(tool.health.port);
  return port > 0 ? port : 0;
}

function toolRunning(tool, snap) {
  if (!tool) return false;
  const port = portOf(tool);
  if (port && snap.ports.has(port)) return true;
  const names = toolProcNames(tool).map((n) => n.toLowerCase());
  if (!names.length) return false;
  return snap.procs.some((p) => names.includes(p.name.toLowerCase()));
}

function pidSetForTool(tool, snap, includePortOwners) {
  const pids = new Set();
  const names = toolProcNames(tool).map((n) => n.toLowerCase());
  for (const p of snap.procs) {
    if (names.includes(p.name.toLowerCase()) && !isProtectedName(p.name)) pids.add(p.pid);
  }
  const port = portOf(tool);
  if (includePortOwners !== false && port && snap.ports.has(port)) {
    for (const pid of snap.ports.get(port)) {
      const p = snap.procs.find((x) => x.pid === pid);
      if (!p || !isProtectedName(p.name)) pids.add(pid);
    }
  }
  return pids;
}

function probePort(port, timeoutMs) {
  return new Promise((resolve) => {
    const sock = net.connect({ host: '127.0.0.1', port: Number(port) });
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      try { sock.destroy(); } catch (_) { /* ignore */ }
      resolve(ok);
    };
    sock.setTimeout(timeoutMs || 1200);
    sock.once('connect', () => finish(true));
    sock.once('timeout', () => finish(false));
    sock.once('error', () => finish(false));
  });
}

function probeHttp(url, timeoutMs) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok) => { if (!done) { done = true; resolve(ok); } };
    try {
      const req = http.get(url, { timeout: timeoutMs || 1500 }, (res) => {
        res.resume();
        finish(res.statusCode >= 200 && res.statusCode < 500);
      });
      req.on('timeout', () => { try { req.destroy(); } catch (_) { /* ignore */ } finish(false); });
      req.on('error', () => finish(false));
    } catch (_) { finish(false); }
  });
}

async function toolUp(tool) {
  const health = tool.health || {};
  if (health.type === 'http' && health.url) return probeHttp(health.url, health.timeoutMs || 1500);
  if (health.type === 'tcp' && health.port) return probePort(health.port, health.timeoutMs || 1200);
  const snap = await snapshot(true);
  return toolRunning(tool, snap);
}

async function waitToolUp(tool, timeoutMs) {
  const deadline = Date.now() + Math.max(5000, timeoutMs || 60000);
  while (Date.now() < deadline) {
    if (await toolUp(tool)) return true;
    await sleep(1000);
  }
  return false;
}

async function waitPortFree(port, timeoutMs) {
  const deadline = Date.now() + Math.max(2000, timeoutMs || 15000);
  while (Date.now() < deadline) {
    if (!(await probePort(port, 800))) return true;
    await sleep(500);
  }
  return false;
}

function toolPaths(tool) {
  return Array.isArray(tool.procPaths)
    ? tool.procPaths.map((s) => String(s || '').toLowerCase()).filter(Boolean)
    : [];
}

// 双条件匹配：进程名命中 + 可执行文件路径包含（路径来自 procSnapshot）
async function resolveKillPids(tool, pathIndex) {
  const snap = await snapshot(true);
  const pids = new Map(); // pid -> {name,path,memMB}
  const names = toolProcNames(tool).map((n) => n.toLowerCase());
  const paths = toolPaths(tool);
  if (paths.length) {
    const idx = pathIndex || await procSnapshot();
    if (!idx) {
      log(`[warn] 进程路径快照不可用，${tool.id} 降级为「进程名」匹配（仍排除受保护进程）`);
      for (const p of snap.procs) {
        if (names.includes(p.name.toLowerCase()) && !isProtectedName(p.name)) {
          pids.set(p.pid, { name: p.name, path: '', memMB: p.memMB });
        }
      }
    } else {
      for (const [pid, info] of idx) {
        if (isProtectedName(info.name) || isProtectedPath(info.path)) continue;
        const nm = String(info.name || '').toLowerCase();
        if (!names.includes(nm)) continue;
        const p = String(info.path || '').toLowerCase();
        if (!paths.some((tok) => p.includes(tok))) continue;
        pids.set(pid, info);
      }
    }
  } else {
    for (const pid of pidSetForTool(tool, snap, true)) {
      const p = snap.procs.find((x) => x.pid === pid);
      if (p) pids.set(pid, { name: p.name, path: '', memMB: p.memMB });
    }
  }
  return { pids, snap };
}

async function killTool(tool, pathIndex) {
  const first = await resolveKillPids(tool, pathIndex);
  if (!first.pids.size) {
    return {
      id: tool.id, name: tool.nameZh || tool.name || tool.id,
      nameZh: tool.nameZh || tool.name || tool.id, nameEn: tool.name || tool.id,
      running: false, processCount: 0, killedPids: [], memoryMB: 0,
    };
  }
  let memoryMB = 0;
  for (const info of first.pids.values()) memoryMB += info.memMB || 0;
  const killedPids = [];
  for (const pid of first.pids.keys()) {
    const r = await run('taskkill.exe', ['/PID', String(pid), '/T', '/F'], 20000);
    log(`kill ${tool.id} pid=${pid} name=${(first.pids.get(pid) || {}).name || ''} code=${r.code}`);
    killedPids.push(pid);
  }
  // 第二轮补杀：Electron / 守护进程可能延迟 spawn；重新取快照，仍按双条件匹配
  await sleep(1000);
  const second = await resolveKillPids(tool, undefined);
  for (const [pid, info] of second.pids) {
    if (killedPids.includes(pid)) continue;
    await run('taskkill.exe', ['/PID', String(pid), '/T', '/F'], 20000);
    log(`kill ${tool.id} 第二轮 pid=${pid} name=${info.name || ''}`);
    killedPids.push(pid);
    memoryMB += info.memMB || 0;
  }
  const port = portOf(tool);
  let portReleased = true;
  if (port) portReleased = await waitPortFree(port, 20000);
  await sleep(500);
  invalidateCache();
  return {
    id: tool.id,
    name: tool.nameZh || tool.name || tool.id,
    nameZh: tool.nameZh || tool.name || tool.id,
    nameEn: tool.name || tool.id,
    running: true,
    processCount: killedPids.length,
    killedPids,
    memoryMB: Math.round(memoryMB),
    portReleased,
    port: port || null,
  };
}

function envForTool(tool) {
  const env = {};
  const cfg = (tool.launch && tool.launch.env) || {};
  for (const k of Object.keys(cfg)) env[k] = String(cfg[k]);
  return env;
}

function psQuote(s) { return `"${String(s).replace(/"/g, '\\"')}"`; }

async function startOpenWebUI(tool) {
  const base = path.join(process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Local'), 'OpenWebUI');
  const venv = path.join(base, 'venv');
  const data = path.join(base, 'data');
  const cache = path.join(base, 'cache');
  const secretFile = path.join(base, '.webui_secret_key');
  const openWebui = path.join(venv, 'Scripts', 'open-webui.exe');
  if (!fs.existsSync(openWebui)) throw new Error('Open WebUI 可执行文件不存在：' + openWebui);
  for (const dir of [data, cache]) fs.mkdirSync(dir, { recursive: true });
  let secret = '';
  try { secret = fs.readFileSync(secretFile, 'utf8').trim(); } catch (_) { /* ignore */ }
  if (!secret) {
    secret = crypto.randomBytes(32).toString('base64');
    fs.writeFileSync(secretFile, secret, 'utf8');
  }
  const env = Object.assign({}, process.env, {
    DATA_DIR: data,
    OLLAMA_BASE_URL: 'http://localhost:11434',
    WEBUI_AUTH: 'False',
    WEBUI_SECRET_KEY: secret,
    HOST: '127.0.0.1',
    PORT: '8080',
    BYPASS_EMBEDDING_AND_RETRIEVAL: 'False',
    RAG_EMBEDDING_ENGINE: '',
    RAG_EMBEDDING_MODEL: 'sentence-transformers/all-MiniLM-L6-v2',
    RAG_TOP_K: '3',
    RAG_TOP_K_RERANKER: '3',
    RAG_FULL_CONTEXT: 'False',
    RAG_OLLAMA_BASE_URL: 'http://localhost:11434',
    RAG_EMBEDDING_MODEL_AUTO_UPDATE: 'False',
    HF_HOME: path.join(cache, 'huggingface'),
    SENTENCE_TRANSFORMERS_HOME: path.join(cache, 'sentence-transformers'),
    HTTP_PROXY: 'http://127.0.0.1:7897',
    HTTPS_PROXY: 'http://127.0.0.1:7897',
    NO_PROXY: 'localhost,127.0.0.1,::1',
    no_proxy: 'localhost,127.0.0.1,::1',
  });
  spawn(openWebui, ['serve', '--host', '127.0.0.1', '--port', '8080'], {
    cwd: base, env, detached: true, stdio: 'ignore', windowsHide: true,
  }).unref();
  log(`已原生启动 Open WebUI（venv open-webui.exe serve，8080）`);
}

async function startTool(tool) {
  const L = tool.launch || {};
  if (tool.id === 'open-webui') return startOpenWebUI(tool);
  const kind = L.kind || 'none';
  if (kind === 'self') throw new Error('控制中心自身不需要启动');
  if (tool.id === 'comfyui') {
    const exe = L.exe;
    if (!exe || !fs.existsSync(exe)) throw new Error('ComfyUI python 不存在');
    const cwd = L.cwd || path.dirname(exe);
    spawn(exe, L.args || [], {
      cwd, detached: true, stdio: 'ignore', windowsHide: true,
      env: Object.assign({}, process.env, { PYTHONPATH: '' }, envForTool(tool)),
    }).unref();
    log('已原生启动 ComfyUI（venv python）');
    return;
  }
  if (kind === 'appx' || L.method === 'explorer') {
    if (kind === 'appx') {
      spawn('explorer.exe', ['shell:AppsFolder\\' + (L.appxAppId || '')], { detached: true, stdio: 'ignore' }).unref();
    } else {
      if (!fs.existsSync(L.exe || '')) throw new Error('可执行文件不存在：' + L.exe);
      spawn('explorer.exe', [L.exe], { detached: true, stdio: 'ignore' }).unref();
    }
    log(`已通过 explorer 启动 ${tool.id}`);
    return;
  }
  if (kind === 'exe') {
    if (!L.exe || !fs.existsSync(L.exe)) throw new Error('可执行文件不存在：' + L.exe);
    const hidden = L.windowStyle === 'hidden';
    spawn(L.exe, L.args || [], {
      cwd: L.cwd || path.dirname(L.exe),
      env: Object.assign({}, process.env, envForTool(tool)),
      detached: true,
      stdio: 'ignore',
      windowsHide: hidden,
    }).unref();
    log(`已启动 exe：${tool.id} -> ${L.exe}`);
    return;
  }
  if (kind === 'script') {
    const script = L.script || '';
    if (/\.(cmd|bat)$/i.test(script)) {
      spawn('cmd.exe', ['/c', script], { cwd: HUB_ROOT, detached: true, stdio: 'ignore', windowsHide: L.windowStyle === 'hidden' }).unref();
      log(`已通过 cmd 启动 ${tool.id}`);
      return;
    }
    throw new Error('该工具启动脚本需要 PowerShell，模式引擎不调用 PowerShell');
  }
  if (kind === 'url') {
    spawn('cmd.exe', ['/c', 'start', '', L.url || tool.url || ''], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    log(`已打开链接 ${tool.id}`);
    return;
  }
  throw new Error(`工具 ${tool.id} 未配置可用的启动方式（kind=${kind}）`);
}

function configOrThrow() {
  const config = readJson(CONFIG_FILE, null);
  if (!config || !Array.isArray(config.tools)) throw new Error('无法读取 data/tools.json');
  return config;
}

function defaultModeState() {
  return { mode: 'normal', since: nowIso(), updatedAt: nowIso(), lastResult: null };
}
function readModeState() {
  const st = readJson(MODE_STATE_FILE, null);
  if (!st || !st.mode) return defaultModeState();
  return st;
}
function writeModeState(state) {
  state.updatedAt = nowIso();
  return writeJson(MODE_STATE_FILE, state);
}

function readPreferences() {
  const st = readJson(PREFERENCES_FILE, null);
  if (!st || typeof st !== 'object') return { aiSelection: [] };
  return { aiSelection: Array.isArray(st.aiSelection) ? st.aiSelection.slice() : [] };
}
function writePreferences(prefs) {
  return writeJson(PREFERENCES_FILE, Object.assign({ updatedAt: nowIso() }, prefs));
}

function modeDefs(config) {
  const defs = (config.modes && config.modes.definitions) || {};
  return defs;
}

function sanitizeStopIds(config, ids, defs) {
  const list = Array.isArray(ids) ? ids : [];
  const protectedIds = new Set([
    ...((config.modes && config.modes.protected) || []),
    'hub-self', 'deepseek-harness', 'codex-sandbox-service', 'steam', 'leigod',
  ]);
  const tools = new Map(config.tools.map((t) => [t.id, t]));
  const out = [];
  for (const id of list) {
    if (protectedIds.has(id)) continue;
    if (!tools.has(id)) continue;
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

function sanitizeStartIds(config, ids) {
  const list = Array.isArray(ids) ? ids : [];
  const tools = new Map(config.tools.map((t) => [t.id, t]));
  return list.filter((id) => tools.has(id));
}

function summarizeMode(def) {
  const mode = def;
  return {
    name: mode.name || '',
    color: mode.color || '#22d3ee',
    icon: mode.icon || 'spark',
    description: mode.description || '',
    start: Array.isArray(mode.start) ? mode.start.slice() : [],
    stop: Array.isArray(mode.stop) ? mode.stop.slice() : [],
  };
}

function startupAudit(config) {
  const items = Array.isArray(config.startupAudit) ? config.startupAudit : [];
  const hubEnabled = fs.existsSync(STARTUP_LNK);
  return items.map((it) => {
    if (it.kind === 'hub-autostart') {
      return Object.assign({}, it, { status: hubEnabled ? 'enabled' : 'disabled', enabled: hubEnabled, path: STARTUP_LNK });
    }
    return Object.assign({}, it);
  });
}

async function runningSnapshot() {
  const snap = await snapshot(true);
  const tools = [];
  const config = configOrThrow();
  for (const tool of config.tools) {
    if (toolRunning(tool, snap)) {
      tools.push({
        id: tool.id,
        name: tool.name,
        nameZh: tool.nameZh || tool.name || tool.id,
        category: tool.category || 'system',
        gameMode: tool.gameMode || 'keep',
      });
    }
  }
  return { snap, tools };
}

async function getStatus(force) {
  const config = configOrThrow();
  const defs = modeDefs(config);
  const state = readModeState();
  if (!defs[state.mode]) state.mode = 'normal';
  const preferences = readPreferences();
  const running = await runningSnapshot();
  const protectedPids = running.snap.procs.filter((p) => isProtectedName(p.name)).map((p) => p.name);
  return {
    ok: true,
    current: { mode: state.mode, since: state.since, updatedAt: state.updatedAt, lastResult: state.lastResult || null },
    definitions: Object.keys(defs).reduce((acc, key) => {
      acc[key] = summarizeMode(defs[key]);
      return acc;
    }, {}),
    modes: ['normal', 'ai', 'office', 'game', 'extreme'],
    runningTools: running.tools,
    runningCount: running.tools.length,
    startupAudit: startupAudit(config),
    preferences: preferences,
    aiTools: config.tools.filter((t) => t.gameMode === 'stop').map((t) => ({
      id: t.id,
      name: t.name,
      nameZh: t.nameZh || t.name || t.id,
      category: t.category || 'system',
    })),
    protected: {
      note: 'DeepSeek Harness、控制中心、Steam、雷神加速器与系统进程永不关闭',
      names: ['DeepSeek Harness.exe', 'node.exe', 'explorer.exe', 'powershell.exe', 'Steam', 'LeiGod'],
      sampleProtected: Array.from(new Set(protectedPids)).slice(0, 12),
    },
    at: nowIso(),
  };
}

async function switchMode(mode, options) {
  const opts = options || {};
  const startedAt = Date.now();
  const m = String(mode || '').trim().toLowerCase();
  const config = configOrThrow();
  const defs = modeDefs(config);
  if (!defs[m]) {
    const err = new Error(`未知模式：${m}（可选：${Object.keys(defs).join(' / ')}）`);
    err.code = 'UNKNOWN_MODE';
    throw err;
  }
  const def = defs[m];
  const state = readModeState();
  const requestedAiStart = m === 'ai' && Array.isArray(opts.start) && opts.start.filter(Boolean).length > 0;
  if (state.mode === m && !requestedAiStart) {
    return {
      ok: true,
      unchanged: true,
      mode: m,
      modeName: def.name || m,
      since: state.since,
      stopped: [],
      started: [],
      failed: [],
      skipped: [],
      freedMemoryMB: 0,
      durationSec: 0,
      message: `当前已是${def.name || m}，无需切换`,
    };
  }

  const stopIds = sanitizeStopIds(config, def.stop, defs);
  const aiCandidateIds = config.tools.filter((t) => t.gameMode === 'stop').map((t) => t.id);
  let startIds;
  let aiSelection = null;
  if (m === 'ai') {
    const requested = Array.isArray(opts.start) ? opts.start.map((x) => String(x || '').trim()).filter(Boolean) : null;
    if (requested && requested.length) {
      aiSelection = requested.filter((id) => aiCandidateIds.includes(id));
      if (!aiSelection.length) {
        const err = new Error('AI 模式至少需要选择 1 个有效的 AI 工具');
        err.code = 'EMPTY_AI_SELECTION';
        throw err;
      }
    } else {
      const prefs = readPreferences();
      const prefValid = (prefs.aiSelection || []).filter((id) => aiCandidateIds.includes(id));
      aiSelection = prefValid.length ? prefValid : (def.start || []).slice();
    }
    startIds = sanitizeStartIds(config, aiSelection);
  } else {
    startIds = sanitizeStartIds(config, def.start);
  }
  const toolsById = new Map(config.tools.map((t) => [t.id, t]));
  log(`模式切换 ${state.mode} -> ${m}：stop=[${stopIds.join(',')}] start=[${startIds.join(',')}]`);

  const stopped = [];
  const skipped = [];
  const failed = [];
  let freedMemoryMB = 0;

  // 1) 停止目标（按「进程名 + 可执行文件路径」双条件匹配，逐个 PID 结束，绝不 taskkill /IM 全域乱杀）
  for (const id of stopIds) {
    const tool = toolsById.get(id);
    if (!tool) continue;
    try {
      const r = await killTool(tool);
      if (r.running) {
        stopped.push({
          id,
          nameZh: tool.nameZh || tool.name || id,
          nameEn: tool.name || id,
          processCount: r.processCount || (r.killedPids ? r.killedPids.length : 0),
          memoryMB: r.memoryMB || 0,
          portReleased: r.portReleased !== false,
        });
        freedMemoryMB += r.memoryMB || 0;
      } else {
        skipped.push({ id, nameZh: tool.nameZh || tool.name || id, reason: '未在运行' });
      }
    } catch (err) {
      failed.push({ id, nameZh: tool.nameZh || tool.name || id, reason: String(err && err.message ? err.message : err) });
    }
  }
  if (stopped.length) await sleep(1200);
  invalidateCache();

  // 2) 启动目标（按定义顺序，等待健康检查）
  const started = [];
  for (const id of startIds) {
    const tool = toolsById.get(id);
    if (!tool) continue;
    const snap = await snapshot(true);
    if (toolRunning(tool, snap)) {
      skipped.push({ id, nameZh: tool.nameZh || tool.name || id, reason: '已在运行' });
      continue;
    }
    const t0 = Date.now();
    try {
      await startTool(tool);
    } catch (err) {
      failed.push({ id, nameZh: tool.nameZh || tool.name || id, reason: String(err && err.message ? err.message : err) });
      continue;
    }
    const waitSec = Number(tool.launch && tool.launch.waitSeconds) > 0 ? Number(tool.launch.waitSeconds) : 60;
    const up = await waitToolUp(tool, Math.min(waitSec + 20, 260) * 1000);
    const sec = Math.round((Date.now() - t0) / 1000);
    if (up) {
      started.push({ id, nameZh: tool.nameZh || tool.name || id, ok: true, seconds: sec });
      log(`启动成功 ${id}（${sec}s）`);
    } else {
      failed.push({ id, nameZh: tool.nameZh || tool.name || id, reason: `启动超时（${sec}s）` });
      log(`启动超时 ${id}（${sec}s）`);
    }
    invalidateCache();
  }

  const snapAfter = await snapshot(true);
  const dshAlive = snapAfter.procs.some((p) => /^DeepSeek Harness\.exe$/i.test(p.name));
  const hubAlive = snapAfter.procs.some((p) => /^node\.exe$/i.test(p.name));
  // 非游戏服务（办公/社交/娱乐/云同步）关闭数量
  const aiStopSet = new Set(config.tools.filter((t) => t.gameMode === 'stop').map((t) => t.id));
  const nonGameStopped = stopped.filter((x) => !aiStopSet.has(x.id));
  const durationSec = Math.round((Date.now() - startedAt) / 1000);
  const ok = failed.length === 0 && dshAlive && hubAlive;
  const nextState = {
    mode: m,
    since: nowIso(),
    updatedAt: nowIso(),
    lastResult: {
      at: nowIso(),
      from: state.mode,
      to: m,
      stopped: stopped.map((x) => x.id),
      started: started.map((x) => x.id),
      failed: failed.map((x) => x.id),
      freedMemoryMB: Math.round(freedMemoryMB),
      durationSec,
    },
  };
  writeModeState(nextState);
  if (m === 'ai' && aiSelection) writePreferences({ aiSelection: aiSelection.slice() });
  // 幂等/重入：当前已是目标模式时也要支持「更新 AI 选择」并只启动新增项
  log(`模式切换完成 -> ${m}：stopped=${stopped.length} started=${started.length} failed=${failed.length} freed=${Math.round(freedMemoryMB)}MB 用时=${durationSec}s`);
  const parts = [`已切换到${def.name || m}`];
  if (m === 'ai') parts.push(`已启动所选的 ${started.length + skipped.filter((s) => startIds.includes(s.id)).length} 个 AI 工具`);
  if (stopped.length) parts.push(`关闭 ${stopped.length} 项`);
  if (m === 'extreme') parts.push(`已关闭 ${nonGameStopped.length} 项非游戏服务`);
  if (started.length && m !== 'ai') parts.push(`启动 ${started.length} 项`);
  return {
    ok,
    mode: m,
    modeName: def.name || m,
    since: nextState.since,
    stopped,
    started,
    failed,
    skipped,
    freedMemoryMB: Math.round(freedMemoryMB),
    closedNonGameCount: nonGameStopped.length,
    durationSec,
    protected: { dshAlive, hubAlive },
    message: ok
      ? parts.join('，')
      : `已切换到${def.name || m}，但有 ${failed.length} 项失败${dshAlive ? '' : '（警告：DeepSeek Harness 状态异常）'}`,
  };
}

module.exports = {
  HUB_ROOT,
  MODE_STATE_FILE,
  readModeState,
  writeModeState,
  getStatus,
  switchMode,
  modeDefs,
  startupAudit,
};
