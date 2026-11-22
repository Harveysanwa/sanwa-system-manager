#!/usr/bin/env node
// AI 控制中心 · 游戏模式 Node 原生实现（绕开 PowerShell / 火绒 AMSI 崩溃）
// 用法：node game-mode-native.js enter|exit|preview|stopall|status
// 输出末尾：##GAMEJSON##{...}
'use strict';

const fs = require('fs');
const path = require('path');
const net = require('net');
const { execFile, spawn } = require('child_process');

const HUB_ROOT = path.resolve(__dirname, '..');
const CONFIG_FILE = path.join(HUB_ROOT, 'data', 'tools.json');
const STATE_FILE = path.join(HUB_ROOT, 'data', 'game-mode-state.json');
const LOG_FILE = path.join(HUB_ROOT, 'logs', 'game-mode.log');
const MARKER = '##GAMEJSON##';
const PS_EXE = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';

const CORE_PORTS = [11434, 1234, 8188, 8080, 8137, 9123];
const PROTECTED_NAMES = /^(DeepSeek Harness\.exe|node\.exe|powershell\.exe|pwsh\.exe|explorer\.exe|cmd\.exe|conhost\.exe|svchost\.exe|dwm\.exe|winlogon\.exe|wininit\.exe|Registry\.exe|System\.exe|csrss\.exe|lsass\.exe|smss\.exe)$/i;
const NAME_PATTERNS = {
  ollama: ['ollama.exe', 'ollama app.exe'],
  lmstudio: ['LM Studio.exe', 'llama-server.exe'],
  'codex-desktop': ['ChatGPT.exe', 'codex.exe'],
  'breeze-tts-2': ['breeze-server.exe'],
  'breeze-studio': ['breeze-studio.exe'],
  'hermes-cn-desktop': ['hermes-agent-cn-desktop.exe'],
  kimi: ['Kimi.exe'],
  qianwen: ['qianwen.exe'],
  doubao: ['Doubao.exe'],
  workbuddy: ['WorkBuddy.exe'],
  pptmaster: ['PPTMaster.exe', 'ppt-master.exe'],
};

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function nowIso() { return new Date().toISOString(); }
function log(msg) {
  try {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const ts = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    fs.appendFileSync(LOG_FILE, `${ts} [native] ${msg}\r\n`, 'utf8');
  } catch (_) { /* ignore */ }
}
function run(cmd, args, timeout) {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, timeout: timeout || 30000, maxBuffer: 16 * 1024 * 1024, encoding: 'utf8' }, (err, stdout, stderr) => {
      const code = err ? (typeof err.code === 'number' ? err.code : -1) : 0;
      resolve({ code, stdout: stdout || '', stderr: stderr || '' });
    });
  });
}
function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); } catch (_) { return fallback; }
}
function writeState(state) {
  try { fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8'); } catch (_) { /* ignore */ }
}
function readState() { return readJson(STATE_FILE, null); }

async function tasklist() {
  const r = await run('tasklist.exe', ['/FO', 'CSV', '/NH']);
  const out = [];
  for (const line of r.stdout.split(/\r?\n/)) {
    const m = line.match(/^"([^"]+)","(\d+)","[^"]*","[^"]*","([\d,]+)\s*K"/);
    if (m) out.push({ name: m[1], pid: Number(m[2]), memMB: Number(m[3].replace(/,/g, '')) / 1024 });
  }
  return out;
}
async function netstat() {
  const r = await run('netstat.exe', ['-ano', '-p', 'tcp']);
  const map = {};
  for (const line of r.stdout.split(/\r?\n/)) {
    const m = line.match(/^\s*TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)/i);
    if (m) {
      const port = Number(m[1]);
      if (!map[port]) map[port] = [];
      map[port].push(Number(m[2]));
    }
  }
  return map;
}
async function wmicProcesses() {
  const r = await run('wmic.exe', ['process', 'get', 'ProcessId,Name,ExecutablePath,CommandLine', '/format:csv'], 25000);
  if (r.code !== 0) return [];
  const rows = [];
  for (const line of r.stdout.split(/\r?\n/)) {
    const s = line.trim();
    if (!s || /^Node,|^Name,/i.test(s)) continue;
    const parts = s.split(',');
    if (parts.length < 5) continue;
    const name = parts[1];
    const cmdline = parts.slice(2, parts.length - 2).join(',');
    const pid = parts[parts.length - 2];
    const execPath = parts[parts.length - 1];
    if (!/^\d+$/.test(pid)) continue;
    rows.push({ name, cmdline, path: execPath, pid: Number(pid) });
  }
  return rows;
}
function probePort(port, timeoutMs) {
  return new Promise((resolve) => {
    const sock = net.connect({ host: '127.0.0.1', port });
    let done = false;
    const fin = (v) => { if (!done) { done = true; sock.destroy(); resolve(v); } };
    sock.setTimeout(timeoutMs || 800);
    sock.on('connect', () => fin(true));
    sock.on('timeout', () => fin(false));
    sock.on('error', () => fin(false));
  });
}
async function waitPortsClosed(ports, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const results = await Promise.all(ports.map((p) => probePort(p)));
    if (results.every((v) => v === false)) return true;
    await sleep(1200);
  }
  return false;
}
async function waitPort(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probePort(port)) return true;
    await sleep(1200);
  }
  return false;
}
function dshAliveFrom(list) {
  return list.some((p) => /^DeepSeek Harness\.exe$/i.test(p.name));
}
async function hubAlive() { return probePort(9900, 700); }

function stopToolsOf(config) {
  const tools = Array.isArray(config.tools) ? config.tools : [];
  return tools.filter((t) => t.gameMode === 'stop');
}

// 统一侦测：返回哪些 stop 工具正在运行、需要杀掉哪些进程（不执行任何 kill）
async function collectTargets(config) {
  const stopTools = stopToolsOf(config);
  const prev = readState();
  const beforeRunning = (prev && prev.active === true && Array.isArray(prev.toolsRunningBefore)) ? prev.toolsRunningBefore : [];

  const tl = await tasklist();
  const ns = await netstat();
  const wm = await wmicProcesses();

  const kills = new Map();
  const hitTools = new Set();
  const nameKills = new Set();

  const addKill = (pid, toolId, name, memMB) => {
    if (!pid || PROTECTED_NAMES.test(name || '')) return;
    if (!kills.has(pid)) kills.set(pid, { toolId, name: name || '', memMB: memMB || 0 });
  };

  for (const t of stopTools) {
    const pats = (NAME_PATTERNS[t.id] || []).map((s) => s.toLowerCase());
    const port = t.health && t.health.port;
    let hit = false;
    if (port && ns[String(port)]) {
      for (const pid of ns[String(port)]) {
        const p = tl.find((x) => x.pid === pid);
        if (p) { addKill(p.pid, t.id, p.name, p.memMB); hit = true; }
        else { addKill(pid, t.id, t.name, 0); hit = true; }
      }
    }
    for (const p of tl) {
      if (pats.includes(p.name.toLowerCase())) { addKill(p.pid, t.id, p.name, p.memMB); hit = true; }
    }
    for (const w of wm) {
      const cl = `${w.cmdline || ''} ${w.path || ''}`;
      let match = false;
      if (t.id === 'comfyui') match = /python/i.test(w.name) && /--port\s+8188|main\.py/i.test(cl);
      else if (t.id === 'open-webui') match = /open-?webui/i.test(cl);
      else if (t.id === 'breeze-studio') match = /breeze-studio/i.test(cl);
      else if (t.id === 'hermes-cli') match = /python/i.test(w.name) && /cli\.py/i.test(cl) && /hermes/i.test(cl);
      else if (t.id === 'pptmaster') match = /pptmast/i.test(cl);
      if (match) { addKill(w.pid, t.id, w.name, 0); hit = true; }
    }
    if (hit) hitTools.add(t.id);
    for (const pat of (NAME_PATTERNS[t.id] || [])) {
      if (tl.some((p) => p.name.toLowerCase() === pat.toLowerCase())) nameKills.add(pat);
    }
  }
  for (const id of beforeRunning) hitTools.add(id);
  const activeToolIds = Array.from(new Set([...hitTools]));
  const memBefore = Array.from(kills.values()).reduce((a, b) => a + (b.memMB || 0), 0);
  return { stopTools, kills, nameKills, activeToolIds, memBefore, tasklist: tl };
}

function candidatesPayload(collect, dsh, hub) {
  return collect.activeToolIds.map((id) => {
    const t = collect.stopTools.find((x) => x.id === id) || { name: id };
    const procs = Array.from(collect.kills.values()).filter((v) => v.toolId === id);
    return {
      id,
      name: t.nameZh || t.name || id,
      category: t.category || 'system',
      memoryMB: Math.round(procs.reduce((a, b) => a + (b.memMB || 0), 0)),
      vramMB: 0,
      processCount: procs.length,
      processes: procs.map((v) => ({ name: v.name, memoryMB: Math.round(v.memMB || 0) })),
    };
  });
}

// 执行 kill + 等待端口释放（enter / stopall 共用）
async function killTargets(collect) {
  const { kills, nameKills } = collect;
  for (const [pid, info] of kills) {
    log(`强制结束 pid=${pid} name=${info.name}`);
    await run('taskkill.exe', ['/PID', String(pid), '/T', '/F'], 20000);
  }
  const killedNames = new Set(Array.from(kills.values()).map((v) => (v.name || '').toLowerCase()));
  for (const nm of nameKills) {
    if (killedNames.has(nm.toLowerCase())) continue;
    log(`按映像名结束 ${nm}`);
    await run('taskkill.exe', ['/IM', nm, '/T', '/F'], 20000);
  }
  return await waitPortsClosed(CORE_PORTS, 30000);
}

async function previewMode() {
  const config = readJson(CONFIG_FILE, null);
  if (!config) throw new Error('无法读取 tools.json');
  const collect = await collectTargets(config);
  const dsh = dshAliveFrom(collect.tasklist);
  const hub = await hubAlive();
  const candidates = candidatesPayload(collect, dsh, hub);
  return {
    ok: true,
    dryRun: true,
    engine: 'node-native',
    candidates,
    totalMemoryMB: Math.round(collect.memBefore),
    totalVramMB: 0,
    totalProcesses: collect.kills.size,
    protected: { dshAlive: dsh, hubAlive: hub },
    message: candidates.length
      ? `预演：将关闭 ${candidates.length} 个 AI 服务/应用，预计释放约 ${(collect.memBefore / 1024).toFixed(1)} GB 内存`
      : '预演：当前没有正在运行的 AI 服务/应用',
  };
}

async function enterMode() {
  const config = readJson(CONFIG_FILE, null);
  if (!config) throw new Error('无法读取 tools.json');
  const collect = await collectTargets(config);
  const { stopTools, kills, nameKills, activeToolIds, memBefore } = collect;

  log(`进入游戏模式（native）：候选工具 ${activeToolIds.join(',') || '(无)'}；将结束进程 ${kills.size} 个`);
  const portReleaseOk = await killTargets(collect);

  const tl2 = await tasklist();
  const dsh = dshAliveFrom(tl2);
  const hub = await hubAlive();
  const freedMemoryMB = Math.round(memBefore);
  const state = {
    active: true,
    engine: 'node-native',
    enteredAt: nowIso(),
    toolsRunningBefore: activeToolIds,
    closedIds: activeToolIds,
    closedTools: candidatesPayload(collect, dsh, hub),
    freedMemoryMB,
    freedVramMB: 0,
    totalProcesses: kills.size,
    portReleaseOk,
    protected: { dshAlive: dsh, hubAlive: hub },
    phase: 'entered',
  };
  writeState(state);
  log(`游戏模式已进入（native）：关闭工具=${activeToolIds.join(',') || '(无)'}；释放内存=${freedMemoryMB}MB；端口释放=${portReleaseOk}；DSH存活=${dsh}；hub存活=${hub}`);
  return {
    ok: portReleaseOk && dsh && hub,
    active: true,
    engine: 'node-native',
    enteredAt: state.enteredAt,
    closedIds: activeToolIds,
    closedTools: state.closedTools,
    freedMemoryMB,
    freedVramMB: 0,
    totalProcesses: kills.size,
    portReleaseOk,
    protected: { dshAlive: dsh, hubAlive: hub },
    message: activeToolIds.length
      ? `已关闭 ${activeToolIds.length} 个 AI 服务/应用，释放约 ${(freedMemoryMB / 1024).toFixed(1)} GB 内存`
      : '当前没有正在运行的 AI 服务，已进入游戏模式',
  };
}

// 全部停止：关闭所有 gameMode=stop 的工具，但**不进入游戏模式**（不写 active=true / 不改游戏模式状态）
async function stopAllMode() {
  const config = readJson(CONFIG_FILE, null);
  if (!config) throw new Error('无法读取 tools.json');

  const closedIdList = [];
  const mergedById = new Map();
  let totalProcesses = 0;
  let freedMemoryMB = 0;
  let portReleaseOk = true;

  // 多轮清扫：Electron 类应用（如 Codex 桌面版）被杀后可能延迟 spawn 子进程，需要补刀
  for (let sweep = 1; sweep <= 4; sweep++) {
    const collect = await collectTargets(config);
    const { kills, activeToolIds, memBefore } = collect;
    if (kills.size === 0) {
      if (sweep === 1) log('全部停止（native）：当前没有正在运行的 AI 服务/应用');
      break;
    }
    log(`全部停止（native）第 ${sweep} 轮：候选工具 ${activeToolIds.join(',') || '(无)'}；结束进程 ${kills.size} 个`);
    portReleaseOk = await killTargets(collect);
    const payload = candidatesPayload(collect, true, true);
    for (const c of payload) {
      const prev = mergedById.get(c.id);
      if (prev) {
        prev.memoryMB = Math.round((prev.memoryMB || 0) + (c.memoryMB || 0));
        prev.processCount = (prev.processCount || 0) + (c.processCount || 0);
        prev.processes = (prev.processes || []).concat(c.processes || []);
      } else {
        mergedById.set(c.id, c);
        closedIdList.push(c.id);
      }
    }
    totalProcesses += kills.size;
    freedMemoryMB += Math.round(memBefore);
    await sleep(2500);
  }

  const tl2 = await tasklist();
  const dsh = dshAliveFrom(tl2);
  const hub = await hubAlive();
  const closedTools = Array.from(mergedById.values());
  log(`全部停止完成（native）：关闭工具=${closedIdList.join(',') || '(无)'}；释放内存=${freedMemoryMB}MB；端口释放=${portReleaseOk}；DSH存活=${dsh}；hub存活=${hub}`);
  return {
    ok: portReleaseOk && dsh && hub,
    active: false,
    gameMode: false,
    engine: 'node-native',
    closedIds: closedIdList,
    closedTools,
    freedMemoryMB,
    freedVramMB: 0,
    totalProcesses,
    portReleaseOk,
    protected: { dshAlive: dsh, hubAlive: hub },
    message: closedIdList.length
      ? `已全部停止 ${closedIdList.length} 个 AI 服务/应用，释放约 ${(freedMemoryMB / 1024).toFixed(1)} GB 内存`
      : '当前没有正在运行的 AI 服务/应用',
  };
}

async function startTool(tool) {
  const L = tool.launch || {};
  const id = tool.id;
  if (id === 'comfyui') {
    const base = process.env.COMFYUI_HOME || (L.cwd ? path.dirname(L.cwd) : '');
    if (!base) throw new Error('ComfyUI 路径未配置：请设置 COMFYUI_HOME 或 tools.json 的 launch.cwd');
    const exe = path.join(base, '.venv', 'Scripts', 'python.exe');
    const cwd = path.join(base, 'ComfyUI');
    if (!fs.existsSync(exe)) throw new Error('ComfyUI python 不存在');
    const env = Object.assign({}, process.env, { PYTHONPATH: '' });
    spawn(exe, ['-s', 'main.py', '--windows-standalone-build', '--lowvram', '--reserve-vram', '0.6', '--port', '8188'], { cwd, detached: true, stdio: 'ignore', windowsHide: true, env }).unref();
    log('native 已启动 ComfyUI');
    return;
  }
  if (L.kind === 'appx') {
    const appId = L.appxAppId || 'OpenAI.Codex_2p2nqsd0c76g0!App';
    spawn('explorer.exe', ['shell:AppsFolder\\' + appId], { detached: true, stdio: 'ignore' }).unref();
    log(`native 已通过 explorer 启动 appx：${appId}`);
    return;
  }
  if (L.method === 'explorer' && L.exe) {
    spawn('explorer.exe', [L.exe], { detached: true, stdio: 'ignore' }).unref();
    log(`native 已通过 explorer 启动：${L.exe}`);
    return;
  }
  if (L.kind === 'exe' && L.exe) {
    if (!fs.existsSync(L.exe)) throw new Error(`可执行文件不存在：${L.exe}`);
    spawn(L.exe, Array.isArray(L.args) ? L.args : [], { cwd: L.cwd || undefined, detached: true, stdio: 'ignore', windowsHide: true }).unref();
    log(`native 已启动：${L.exe}`);
    return;
  }
  if (L.kind === 'script') {
    const toolScript = path.join(__dirname, `${id}.ps1`);
    if (!fs.existsSync(toolScript)) throw new Error(`缺少启动脚本 ${id}.ps1`);
    spawn(PS_EXE, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', toolScript, '-Action', 'start', '-NoOpen'], { cwd: HUB_ROOT, detached: true, stdio: 'ignore', windowsHide: true }).unref();
    log(`native 已通过工具脚本启动：${id}.ps1`);
    return;
  }
  throw new Error('该工具没有可用的自动启动方式');
}

async function exitMode() {
  const config = readJson(CONFIG_FILE, null);
  if (!config) throw new Error('无法读取 tools.json');
  const st = readState() || {};
  const ids = Array.isArray(st.toolsRunningBefore) ? st.toolsRunningBefore : (Array.isArray(st.closedIds) ? st.closedIds : []);
  const restored = [];
  const skipped = [];
  const failed = [];
  log(`退出游戏模式（native）：准备恢复 ${ids.join(',') || '(无)'}`);
  for (const id of ids) {
    const tool = (config.tools || []).find((x) => x.id === id);
    if (!tool) { skipped.push({ id, name: id, reason: '工具不在配置中' }); continue; }
    const displayName = tool.nameZh || tool.name || id;
    const port = tool.health && tool.health.port;
    if (port && await probePort(port)) {
      skipped.push({ id, name: displayName, reason: '已在运行，跳过' });
      log(`跳过 ${id}（端口 ${port} 已就绪）`);
      continue;
    }
    if (!port) {
      const tl = await tasklist();
      const pats = (NAME_PATTERNS[id] || []).map((s) => s.toLowerCase());
      if (pats.some((p) => tl.some((x) => x.name.toLowerCase() === p))) {
        skipped.push({ id, name: displayName, reason: '已在运行，跳过' });
        continue;
      }
    }
    const t0 = Date.now();
    try {
      await startTool(tool);
    } catch (err) {
      failed.push({ id, name: displayName, reason: String(err && err.message ? err.message : err) });
      log(`恢复失败 ${id}：${err.message || err}`);
      continue;
    }
    let up = true;
    if (port) up = await waitPort(Number(port), 180000);
    const sec = Math.round((Date.now() - t0) / 1000);
    if (up) {
      restored.push({ id, name: displayName, seconds: sec });
      log(`已恢复 ${id}（${sec} 秒）`);
    } else {
      failed.push({ id, name: displayName, reason: `启动超时（${sec}s）` });
      log(`恢复超时 ${id}`);
    }
  }
  const tl2 = await tasklist();
  const dsh = dshAliveFrom(tl2);
  const hub = await hubAlive();
  st.active = false;
  st.exitedAt = nowIso();
  st.phase = 'exited';
  st.restore = { engine: 'node-native', restored, skipped, failed, dshAlive: dsh, hubAlive: hub };
  writeState(st);
  const okAll = failed.length === 0;
  log(`退出游戏模式（native）：恢复=${restored.map((x) => x.id).join(',') || '(无)'}；跳过=${skipped.map((x) => x.id).join(',') || '(无)'}；失败=${failed.map((x) => x.id).join(',') || '(无)'}`);
  return {
    ok: okAll,
    active: false,
    engine: 'node-native',
    exitedAt: st.exitedAt,
    restored,
    skipped,
    failed,
    protected: { dshAlive: dsh, hubAlive: hub },
    message: okAll
      ? (restored.length ? `已退出游戏模式，恢复了 ${restored.length} 个服务` : '已退出游戏模式（服务本就在运行）')
      : `已退出游戏模式，但 ${failed.length} 个服务恢复失败：${failed.map((f) => f.name).join('、')}`,
  };
}

(async () => {
  const mode = (process.argv[2] || '').toLowerCase();
  let result;
  try {
    if (mode === 'enter') result = await enterMode();
    else if (mode === 'exit') result = await exitMode();
    else if (mode === 'preview') result = await previewMode();
    else if (mode === 'stopall') result = await stopAllMode();
    else if (mode === 'status') result = { ok: true, active: readState() ? readState().active === true : false };
    else result = { ok: false, message: `未知模式：${mode}` };
  } catch (err) {
    result = { ok: false, message: String(err && err.message ? err.message : err) };
    log(`native 异常：${result.message}`);
  }
  if (!result || typeof result !== 'object') result = { ok: false, message: 'native 无结果' };
  if (typeof result.message === 'string' && result.message.length > 300) result.message = result.message.slice(0, 300);
  console.log(MARKER + JSON.stringify(result));
  process.exit(result.ok ? 0 : 2);
})();
