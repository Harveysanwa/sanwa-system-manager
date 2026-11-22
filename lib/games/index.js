#!/usr/bin/env node
// Sanwa 系统管理器 · 游戏库识别与启动编排引擎（纯 Node.js，无 PowerShell 依赖）
//
// 职责：
//   1) scanGames()      真实扫描 Steam / WeGame / Epic / 注册表 / 独立游戏目录，只读、不启动任何程序
//   2) loadGames()      读取 data/games.json 缓存（已合并用户覆盖）
//   3) saveOverrides()  合并写回 data/games.json 的 overrides（UI 修改 region/mode/tags/nameZh 用）
//   4) launchGame()     按需启动编排：雷神加速器 / Steam 离线（关 Steam + 请求防火墙断网）/ 平台启动
//   5) steamStatus()    查询 Steam 进程（只读）
//
// 安全约定：
//   - 扫描阶段只读文件、reg.exe 只读查询、tasklist 只读；绝不启动/关闭任何游戏或 Steam
//   - taskkill 仅针对名字精确匹配 steam.exe / steamwebhelper.exe / SteamService.exe 的 PID
//   - 断网请求在非管理员下如实返回 applied:false（不伪造成功），并生成管理员辅助脚本（只写不执行）
//   - 不结束 Steam 之外的进程（雷神只拉起、不关闭；DSH/hub/node 永不触碰）
//
// 数据文件 data/games.json 结构：
//   { version, updatedAt, scannedAt, durationMs, stats, games, overrides }
//   overrides: { "<game id>": { region, mode, tags, nameZh } } —— 覆盖优先于启发式
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync, execFileSync } = require('child_process');

const MODULE_VERSION = '1.0.0';
const HUB_ROOT = path.resolve(__dirname, '..', '..');
const DATA_DIR = path.join(HUB_ROOT, 'data');
const GAMES_FILE = path.join(DATA_DIR, 'games.json');
const GAMES_CONFIG_FILE = path.join(DATA_DIR, 'games-config.json');
function loadGamesConfig() {
  const defaults = { steamLibraries: [], roots: [], weGameDirs: [], registryHints: true };
  try {
    const raw = fs.readFileSync(GAMES_CONFIG_FILE, 'utf8').replace(/^\uFEFF/, '');
    const cfg = JSON.parse(raw);
    return {
      steamLibraries: Array.isArray(cfg.steamLibraries) ? cfg.steamLibraries.filter(Boolean) : [],
      roots: Array.isArray(cfg.roots) ? cfg.roots.filter(Boolean) : [],
      weGameDirs: Array.isArray(cfg.weGameDirs) ? cfg.weGameDirs.filter(Boolean) : [],
      registryHints: cfg.registryHints !== false,
    };
  } catch (_) {
    return defaults;
  }
}
const GAMES_CONFIG = loadGamesConfig();
const TOOLS_DIR = path.join(HUB_ROOT, 'tools');
const HELPER_NET_OFF = path.join(TOOLS_DIR, 'steam-net-off.ps1');
const HELPER_NET_ON = path.join(TOOLS_DIR, 'steam-net-on.ps1');
const HELPER_README = path.join(TOOLS_DIR, 'README-steam-block.md');

// ---------------------------------------------------------------- 环境常量
const STEAM_DEFAULT_DIR = 'C:\\Program Files (x86)\\Steam';
const LEIGOD_DIR = 'C:\\Program Files (x86)\\LeiGod_Acc';
const LEIGOD_LAUNCHER = path.join(LEIGOD_DIR, 'leigod_launcher.exe');
const LEIGOD_MAIN = path.join(LEIGOD_DIR, 'leigod.exe');
const WEGAME_CLIENT_CANDIDATES = [
  'C:\\Program Files (x86)\\WeGame\\wegame.exe',
  'C:\\Program Files\\WeGame\\wegame.exe',
];
const EPIC_MANIFEST_DIRS = [
  'C:\\ProgramData\\Epic\\EpicGamesLauncher\\Data\\Manifests',
  'C:\\ProgramData\\Epic\\EpicGamesLauncher\\Data\\Manifests\\Win32',
];
// 独立游戏扫描的顶层根目录（由 data/games-config.json 的 roots 提供；默认空，不扫描个人盘）
const DEFAULT_STANDALONE_ROOTS = [];

// 非游戏目录排除（小写包含匹配）。避免把资料/影视/音乐/备份/平台库当成游戏。
const EXCLUDE_DIR_TOKENS = [
  // 通用类别词（小写包含匹配）：避免把影视/音乐/资料/备份/平台库当游戏
  'movie', 'video', 'music', 'photo', 'wallpaper', 'downloads', 'backup',
  'documents', 'doc', 'docs', '资料', '文档', '视频', '音乐', '照片', '壁纸', '备份', '素材', '教程',
  'steamlibrary', 'wegameapps', 'common_apps', 'rail_apps', 'node_modules',
  'local llm model', 'program files', '$recycle.bin', 'system volume information',
  'windows', 'temp', 'tmp', 'cache',
];
// 独立游戏内部搜索时跳过的噪音目录（避免进入安装器/依赖/缓存）
const NOISE_DIR_RE = /^(install|installers?|setup|redist|_commonredist|__installer|directx|dx|dx9|dx11|dotnet|\.net|runtime|support|benchmark|videos?|sounddata|sound|dlc_?\d*|_userdata|userdata|修改器|工具|tool|tools?|docs?|manual|readme|存档|save|saves|profiles?|logs?|log|cache|crash|crashreport|crashreporter|mods?|reshade|config|configs|locales?|languages?|vgui|steam_api|steam_settings|scripts?|installers|[._].*)$/i;
const NOISE_EXE_RE = /(unins|uninstall|setup|installer|install|redist|vcredist|dxsetup|dxwebsetup|directx|dotnetfx|oalinst|physx|crash|handler|bugreport|report|reporter|helper|benchmark|trainer|keygen|patch|update|updater|launcher|editor|cleanup|touchup|activation|fping|tinydl|vconsole|注册|卸载|修复|恢复模式|诊断)/i;
// 已知主程序名：发行版不内置任何具体游戏名；识别依赖同名 exe、
// binaries/win64 目录、根目录最大 exe 等通用评分逻辑。
const KNOWN_MAIN_EXE = [];
// 单机/离线类型关键词（通用，不含具体游戏名）：命中则 mode=single
const SINGLE_NAME_RE = /(simulator|tycoon|city\s*builder|citybuilder|sandbox|single.?player|offline|transport|train|truck|farming|builder|strategy|puzzle|platformer)/i;
// 游戏关键词（注册表兜底识别用；通用词，不含具体游戏名）
const REGISTRY_GAME_RE = /(游戏|单机|3dm|硬盘版|免安装|学习版|破解|repack|portable|\bgog\b|\bsteam\b)/i;
const REGISTRY_NON_GAME_RE = /^(steam|wegame|epic\s*games|epic\s*games\s*launcher|gog\s*galaxy|ubisoft\s*connect|ea\s*app|origin|battle\.net|rockstar\s*games\s*launcher|microsoft\s*visual|nvidia|everything|wechat|微信|qq|钉钉)/i;

// Steam 进程名（精确匹配，绝不杀其它进程）
const STEAM_PROCESS_NAMES = ['steam.exe', 'steamwebhelper.exe', 'steamservice.exe'];
const ACCEL_PROCESS_NAMES = ['leigod.exe', 'leigod_launcher.exe', 'leigodacc.exe'];
const ACCEL_WAIT_MS = 4000;
const STEAM_STOP_WAIT_MS = 1500;

// 中文名映射：默认空。发行版不内置任何游戏名；用户可自行维护（appid/目录名 → 中文名），
// 未命中时 Steam 回退 appmanifest 的 name、独立/WeGame 回退目录名。
const NAME_ZH_STEAM = Object.create(null);
const NAME_ZH_BY_DIR = Object.create(null);

// ---------------------------------------------------------------- 基础工具
function nowIso() { return new Date().toISOString(); }

function sha1Short(input, len) {
  return crypto.createHash('sha1').update(String(input)).digest('hex').slice(0, len || 8);
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function safeReaddir(dir) {
  try { return fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return []; }
}

function safeStat(p) {
  try { return fs.statSync(p); } catch (_) { return null; }
}

function exists(p) { try { return fs.existsSync(p); } catch (_) { return false; } }

function decodeConsole(buf) {
  // Windows 控制台程序（reg.exe / tasklist.exe）输出为系统 ANSI 代码页（中文 = GBK）
  if (!buf) return '';
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(String(buf), 'utf8');
  try { return new TextDecoder('gbk').decode(b); } catch (_) {
    try { return b.toString('utf8'); } catch (_) { return ''; }
  }
}

function runCapture(exe, args, timeoutMs, maxBuffer) {
  try {
    const stdout = execFileSync(exe, args, {
      windowsHide: true,
      timeout: timeoutMs || 20000,
      maxBuffer: maxBuffer || 8 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return { ok: true, stdout };
  } catch (e) {
    return { ok: false, stdout: (e && e.stdout) ? e.stdout : null, error: (e && e.message) || String(e) };
  }
}

function runCaptureText(exe, args, timeoutMs, maxBuffer) {
  const r = runCapture(exe, args, timeoutMs, maxBuffer);
  return { ok: r.ok, text: decodeConsole(r.stdout), error: r.error };
}

function readJson(file) {
  try { return { ok: true, data: JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch (e) {
    return { ok: false, error: e.message, data: null };
  }
}

function writeJsonAtomic(file, data) {
  const dir = path.dirname(file);
  try { fs.mkdirSync(dir, { recursive: true }); } catch (_) { /* ignore */ }
  const tmp = file + '.tmp-' + process.pid + '-' + Date.now();
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  try {
    fs.renameSync(tmp, file);
  } catch (_) {
    // Windows 上目标被占用时 rename 可能失败，退化为直接写
    try { fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8'); } catch (e2) {
      try { fs.unlinkSync(tmp); } catch (_) { /* ignore */ }
      throw e2;
    }
  }
}

// ---------------------------------------------------------------- 进出程序名工具
function normalizeProcessName(name) { return String(name || '').trim().toLowerCase(); }

let _procCache = { at: 0, list: [] };
function listProcesses(force) {
  const now = Date.now();
  if (!force && _procCache.list.length && (now - _procCache.at) < 1200) return _procCache.list;
  const list = [];
  const r = runCaptureText('tasklist.exe', ['/FO', 'CSV', '/NH'], 15000, 16 * 1024 * 1024);
  if (r.ok && r.text) {
    for (const line of r.text.split(/\r?\n/)) {
      const m = /^"([^"]+)","(\d+)"/.exec(line);
      if (m) list.push({ name: m[1], nameLower: normalizeProcessName(m[1]), pid: Number(m[2]) });
    }
  }
  _procCache = { at: now, list };
  return list;
}

function findProcesses(names) {
  const wanted = new Set(names.map(normalizeProcessName));
  return listProcesses(true).filter((p) => wanted.has(p.nameLower));
}

function pidAlive(pid) {
  return listProcesses(true).some((p) => p.pid === pid);
}

function isAdmin() {
  // net session 需要管理员令牌；非管理员通常返回非 0
  try {
    const r = spawnSync('net.exe', ['session'], { windowsHide: true, timeout: 8000, stdio: 'ignore' });
    return r.status === 0;
  } catch (_) {
    return false;
  }
}

function spawnDetached(exe, args, options) {
  const opts = options || {};
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(exe, args || [], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        cwd: opts.cwd || undefined,
      });
    } catch (e) {
      return resolve({ ok: false, error: (e && e.message) || String(e) });
    }
    let settled = false;
    const done = (result) => {
      if (settled) return;
      settled = true;
      try { child.unref(); } catch (_) { /* ignore */ }
      resolve(result);
    };
    child.once('error', (e) => done({ ok: false, error: (e && e.message) || String(e) }));
    child.once('spawn', () => done({ ok: true, pid: child.pid || null }));
    setTimeout(() => done({ ok: true, pid: child.pid || null, timeout: true }), 3000);
  });
}

function taskkillTree(pid) {
  const r = runCaptureText('taskkill.exe', ['/PID', String(pid), '/T', '/F'], 10000, 64 * 1024);
  return { ok: r.ok, output: (r.text || '').trim().split(/\r?\n/).slice(-1)[0] || (r.error || '') };
}

// ---------------------------------------------------------------- 文件名/打分启发式
function normalizeName(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '');
}
function tokenizeName(s) {
  return String(s || '').toLowerCase().split(/[^a-z0-9\u4e00-\u9fff]+/).filter((t) => t.length >= 2);
}
function hasCjk(s) { return /[\u4e00-\u9fff]/.test(String(s || '')); }

function nameSimilarity(gameName, exeBase) {
  const g = normalizeName(gameName);
  const e = normalizeName(exeBase);
  if (!g || !e) return 0;
  let score = 0;
  if (e.length >= 4 && (g === e || g.includes(e) || e.includes(g))) score = Math.max(score, 0.95);
  const gTokens = tokenizeName(gameName);
  const eTokens = tokenizeName(exeBase);
  for (const et of eTokens) {
    for (const gt of gTokens) {
      if (et === gt) score = Math.max(score, 0.75);
      else if (et.length >= 4 && (gt.includes(et) || et.includes(gt))) score = Math.max(score, 0.6);
    }
  }
  return score;
}

function isKnownMainExe(base) {
  return KNOWN_MAIN_EXE.some((re) => re.test(base));
}

function scoreExeCandidate(cand, ctx) {
  const base = cand.base.replace(/\.exe$/i, '');
  const isLauncher = /launcher/i.test(base);
  if (NOISE_EXE_RE.test(base) && !(ctx.allowLauncher && isLauncher)) return -1;
  let score = 0;
  if (isKnownMainExe(base)) score += 85;
  score += nameSimilarity(ctx.gameName, base) * 55;
  const mb = cand.size / (1024 * 1024);
  score += Math.min(42, Math.pow(Math.max(mb, 0.05), 0.3) * 5);
  if (cand.depth <= 1) score += 10;
  else if (cand.depth === 2) score += 5;
  if (/(^|[\\/])(bin|binaries|win64|win32|x64|x86|game|games)([\\/]|$)/i.test(cand.relDir)) score += 8;
  if (ctx.platform === 'wegame' && /launcher|client|start|wegame/i.test(base)) score += 20;
  return score;
}

// 在 rootDir 内做有界 BFS 找主 exe（最大深度 maxDepth，最大目录数 cap）
function findBestExe(rootDir, ctx) {
  const maxDepth = ctx.maxDepth || 4;
  const cap = ctx.cap || 350;
  const start = safeStat(rootDir);
  if (!start || !start.isDirectory()) return { best: null, candidates: [], visited: 0, indicators: [] };
  const indicators = [];
  const candidates = [];
  let visited = 0;
  let current = [{ dir: rootDir, depth: 0, rel: '' }];
  let best = null;
  while (current.length && visited < cap) {
    const next = [];
    for (const node of current) {
      if (node.depth > maxDepth || visited >= cap) continue;
      visited += 1;
      const entries = safeReaddir(node.dir);
      for (const ent of entries) {
        const full = path.join(node.dir, ent.name);
        const rel = node.rel ? path.join(node.rel, ent.name) : ent.name;
        if (ent.isDirectory()) {
          if (NOISE_DIR_RE.test(ent.name)) continue;
          if (ent.name.startsWith('.') || ent.name.startsWith('$')) continue;
          if (node.depth + 1 < maxDepth) next.push({ dir: full, depth: node.depth + 1, rel });
        } else if (/\.exe$/i.test(ent.name)) {
          const st = safeStat(full);
          if (!st || !st.isFile()) continue;
          const cand = { exe: full, base: ent.name, size: st.size, depth: node.depth + 1, relDir: node.rel };
          candidates.push(cand);
        } else if (/\.(bat|url|lnk)$/i.test(ent.name) && node.depth === 0 && /(开始游戏|启动游戏|play|start|运行)/i.test(ent.name)) {
          indicators.push({ file: full, name: ent.name });
        }
      }
    }
    // 评分
    for (const cand of candidates) {
      if (cand.scored) continue;
      cand.scored = true;
      cand.score = scoreExeCandidate(cand, ctx);
      if (cand.score >= 0 && (!best || cand.score > best.score)) best = cand;
    }
    if (best && best.score >= 80) break; // 已找到高置信主程序，停止深入
    current = next;
    if (visited >= cap) break;
  }
  return { best, candidates, visited, indicators };
}

// ---------------------------------------------------------------- Steam 扫描
function unescapeVdf(s) {
  return String(s || '').replace(/\\\\/g, '\\').replace(/\\"/g, '"');
}

function parseSteamLibraryPaths(vdfText) {
  const paths = [];
  const re = /"path"\s+"((?:[^"\\]|\\.)*)"/g;
  let m;
  while ((m = re.exec(vdfText)) !== null) paths.push(unescapeVdf(m[1]));
  if (!paths.length) {
    // 旧版 libraryfolders.vdf: "1" "D:\\SteamLibrary"
    const re2 = /"(\d+)"\s+"((?:[^"\\]|\\.)*)"/g;
    while ((m = re2.exec(vdfText)) !== null) {
      const p = unescapeVdf(m[2]);
      if (/^[A-Za-z]:\\/.test(p)) paths.push(p);
    }
  }
  const out = [];
  for (const p of paths) {
    const norm = path.normalize(p.replace(/[\\/]+$/, ''));
    if (!out.some((x) => x.toLowerCase() === norm.toLowerCase())) out.push(norm);
  }
  return out;
}

function parseAcf(text) {
  const out = {};
  const re = /^\s*"([^"]+)"\s+"([^"]*)"/gm;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (!(m[1] in out)) out[m[1]] = m[2];
  }
  return out;
}

function scanSteam(warnings) {
  const list = [];
  const libs = [];
  const steamDir = exists(path.join(STEAM_DEFAULT_DIR, 'steam.exe')) ? STEAM_DEFAULT_DIR : null;
  const vdfCandidates = [];
  if (steamDir) vdfCandidates.push(path.join(steamDir, 'steamapps', 'libraryfolders.vdf'));
  let steamLibraries = [];
  for (const vdf of vdfCandidates) {
    if (!exists(vdf)) continue;
    try {
      const text = fs.readFileSync(vdf, 'utf8');
      steamLibraries = parseSteamLibraryPaths(text);
    } catch (e) {
      warnings.push('读取 libraryfolders.vdf 失败: ' + e.message);
    }
  }
  if (!steamLibraries.length && steamDir) steamLibraries = [steamDir];
  for (const extra of (GAMES_CONFIG.steamLibraries || [])) {
    if (extra && !steamLibraries.some((p) => p.toLowerCase() === String(extra).toLowerCase())) steamLibraries.push(String(extra));
  }
  // 补充：即使 vdf 缺失，也尝试默认库
  if (steamDir && !steamLibraries.some((p) => p.toLowerCase() === steamDir.toLowerCase())) steamLibraries.push(steamDir);

  for (const lib of steamLibraries) {
    const appsDir = path.join(lib, 'steamapps');
    if (!exists(appsDir)) { libs.push({ path: lib, exists: false, acfCount: 0 }); continue; }
    let files = [];
    try {
      files = fs.readdirSync(appsDir).filter((f) => /^appmanifest_\d+\.acf$/i.test(f));
    } catch (e) {
      warnings.push('读取 Steam 库失败 ' + lib + ': ' + e.message);
      continue;
    }
    let count = 0;
    for (const file of files) {
      const acfPath = path.join(appsDir, file);
      let text;
      try { text = fs.readFileSync(acfPath, 'utf8'); } catch (e) {
        warnings.push('读取 ' + file + ' 失败: ' + e.message);
        continue;
      }
      const acf = parseAcf(text);
      const appid = Number(acf.appid || (file.match(/_(\d+)\.acf/i) || [])[1] || 0);
      if (!appid) continue;
      const name = (acf.name || '').trim();
      if (/redistributable|steamworks common/i.test(name) || appid === 228980) continue; // 运行库不是游戏
      const installdir = (acf.installdir || '').trim();
      if (!installdir) continue;
      const installDir = path.join(appsDir, 'common', installdir);
      if (!exists(installDir)) continue; // 残留 manifest，跳过
      const sizeBytes = Number(acf.SizeOnDisk || 0);
      const found = findBestExe(installDir, { gameName: name + ' ' + installdir, maxDepth: 4, cap: 320 });
      list.push({
        platform: 'steam',
        appid,
        name,
        installDir,
        exe: found.best ? found.best.exe : null,
        sizeGB: sizeBytes > 0 ? Math.round((sizeBytes / 1e9) * 100) / 100 : null,
        detectedBy: 'steam-acf',
        library: lib,
      });
      count += 1;
    }
    libs.push({ path: lib, exists: true, acfCount: files.length, gameCount: count });
  }
  return { games: list, libraries: libs };
}

// ---------------------------------------------------------------- WeGame 扫描
function discoverWeGameRoots() {
  const roots = [];
  for (const r of (GAMES_CONFIG.weGameDirs || [])) {
    if (!r) continue;
    if (exists(r) && !roots.some((x) => x.toLowerCase() === String(r).toLowerCase())) roots.push(String(r));
  }
  return roots;
}

function scanWeGame(warnings) {
  const games = [];
  for (const root of discoverWeGameRoots()) {
    const rootName = path.basename(root);
    // WeGame 根目录下直接是游戏目录；rail_apps / common_apps / downloading
    const directDirs = safeReaddir(root).filter((e) => e.isDirectory());
    for (const ent of directDirs) {
      const lower = ent.name.toLowerCase();
      if (lower === 'downloading' || lower === 'common_apps' || lower === 'rail_apps' || lower === 'cachedata') continue;
      if (/^(rail_files|cache|config|log|logs|tmp|temp)$/i.test(ent.name)) continue;
      const dir = path.join(root, ent.name);
      const exe = pickWegameMainExe(dir);
      if (!exe) {
        warnings.push('WeGame 目录未找到可执行文件，跳过: ' + dir);
        continue;
      }
      games.push({
        platform: 'wegame',
        appid: readWegameGameId(dir, ent.name),
        name: cleanWegameGameName(ent.name),
        installDir: dir,
        exe,
        sizeGB: null,
        detectedBy: 'wegame-dir',
      });
    }
    // <WeGameRoot>\rail_apps\<游戏>(appid)
    const railDir = path.join(root, 'rail_apps');
    for (const ent of safeReaddir(railDir)) {
      if (!ent.isDirectory()) continue;
      const dir = path.join(railDir, ent.name);
      const exe = pickWegameMainExe(dir);
      if (!exe) { warnings.push('WeGame rail_apps 目录未找到可执行文件，跳过: ' + dir); continue; }
      games.push({
        platform: 'wegame',
        appid: readWegameGameId(dir, ent.name),
        name: cleanWegameGameName(ent.name) || ent.name,
        installDir: dir,
        exe,
        sizeGB: null,
        detectedBy: 'wegame-rail_apps',
      });
    }
  }
  return games;
}

// ---------------------------------------------------------------- Epic 扫描（未安装/不可用时返回空）
function scanEpic(warnings) {
  const games = [];
  for (const dir of EPIC_MANIFEST_DIRS) {
    if (!exists(dir)) continue;
    for (const ent of safeReaddir(dir)) {
      if (!ent.isFile() || !/\.item$/i.test(ent.name)) continue;
      const r = readJson(path.join(dir, ent.name));
      if (!r.ok || !r.data) continue;
      const m = r.data;
      const installDir = m.InstallLocation;
      if (!installDir || !exists(installDir)) continue;
      const name = (m.DisplayName || m.AppName || ent.name).trim();
      const found = findBestExe(installDir, { gameName: name, maxDepth: 4, cap: 320 });
      games.push({
        platform: 'epic',
        appid: m.AppName || null,
        name,
        installDir,
        exe: found.best ? found.best.exe : null,
        sizeGB: null,
        detectedBy: 'epic-manifest',
      });
    }
  }
  return games;
}

// ---------------------------------------------------------------- 独立目录扫描
function isExcludedDirName(name) {
  const lower = String(name || '').toLowerCase();
  return EXCLUDE_DIR_TOKENS.some((tok) => lower.includes(tok));
}

function looksLikeGameDir(dir, dirName) {
  const ctxName = dirName;
  const found = findBestExe(dir, { gameName: ctxName, maxDepth: 4, cap: 400 });
  const best = found.best;
  if (!best || best.score < 0) {
    return { isGame: false, found };
  }
  const accept = best.score >= 50 || best.size >= 30 * 1024 * 1024 || (found.indicators.length > 0 && best.score > 0);
  return { isGame: accept, found };
}

function scanStandalone(warnings, roots) {
  const out = [];
  const scanRoots = (roots && roots.length ? roots : (GAMES_CONFIG.roots || []));
  if (!scanRoots.length) { warnings.push('未配置 data/games-config.json 的 roots，跳过独立游戏目录扫描'); return; }
  for (const root of scanRoots) {
    if (!exists(root)) continue;
    let entries = [];
    try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch (e) {
      warnings.push('读取 ' + root + ' 失败: ' + e.message);
      continue;
    }
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      if (ent.name.startsWith('.') || ent.name.startsWith('$')) continue;
      if (isExcludedDirName(ent.name)) continue;
      const dir = path.join(root, ent.name);
      const res = looksLikeGameDir(dir, ent.name);
      if (!res.isGame) continue;
      const exe = res.found.best ? res.found.best.exe : null;
      out.push({
        platform: 'standalone',
        appid: null,
        name: ent.name,
        dirName: ent.name,
        installDir: dir,
        exe,
        sizeGB: null,
        detectedBy: 'standalone-dir',
        tagsHint: res.found.indicators.map((i) => i.name),
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------- 注册表兜底扫描（reg.exe 只读）
const REG_HIVES = [
  'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
];

function queryRegistryUninstall(warnings) {
  const entries = [];
  for (const hive of REG_HIVES) {
    const r = runCapture('reg.exe', ['query', hive, '/s'], 25000, 40 * 1024 * 1024);
    if (!r.ok || !r.stdout) { continue; }
    const text = decodeConsole(r.stdout);
    const blocks = text.split(/\r?\n(?=HKEY_)/);
    for (const block of blocks) {
      if (!/^HKEY_/.test(block)) continue;
      const nameM = /\bDisplayName\s+REG_SZ\s+(.*)/.exec(block);
      if (!nameM) continue;
      const locM = /\bInstallLocation\s+REG_SZ\s+(.*)/.exec(block) || /Inno Setup: App Path\s+REG_SZ\s+(.*)/.exec(block);
      const iconM = /\bDisplayIcon\s+REG_SZ\s+(.*)/.exec(block);
      entries.push({
        name: nameM[1].trim(),
        installLocation: locM ? locM[1].trim() : '',
        icon: iconM ? iconM[1].trim() : '',
        key: block.split(/\r?\n/)[0].trim(),
      });
    }
  }
  return entries;
}

function cleanRegistryGameName(raw) {
  let s = String(raw || '').replace(/^《|》$/g, '').replace(/《|》/g, '');
  s = s.replace(/\s*版本\s*[\d.]+\s*$/i, '');
  s = s.replace(/(3DM完整英文硬盘版|3DM完整|3DM|完整英文硬盘版|完整版|英文硬盘版|硬盘版|免安装版|绿色版|中文版|汉化版|未加密版|学习版)/gi, '');
  s = s.replace(/\s+/g, ' ').trim();
  return s || String(raw || '').trim();
}

function scanRegistry(warnings, knownGames) {
  const games = [];
  let entries = [];
  try { entries = queryRegistryUninstall(warnings); } catch (e) { warnings.push('注册表扫描失败: ' + e.message); }
  for (const ent of entries) {
    const name = String(ent.name || '').trim();
    if (!name || name.length < 2) continue;
    if (REGISTRY_NON_GAME_RE.test(name)) continue;
    if (!REGISTRY_GAME_RE.test(name)) continue;
    const loc = String(ent.installLocation || '').replace(/^"|"$/g, '').trim();
    if (!loc || !exists(loc)) continue;
    if (/\\Windows\\|\\Common Files\\/i.test(loc)) continue;
    // 目录里必须有可执行主程序，避免误报
    const found = findBestExe(loc, { gameName: name, maxDepth: 4, cap: 200 });
    if (!found.best) continue;
    const displayName = cleanRegistryGameName(name);
    const game = {
      platform: 'standalone',
      appid: null,
      name: displayName,
      dirName: path.basename(loc.replace(/[\\/]+$/, '')),
      installDir: loc.replace(/[\\/]+$/, ''),
      exe: found.best.exe,
      sizeGB: null,
      detectedBy: 'registry-uninstall',
      registryName: name,
      tagsHint: [],
    };
    games.push(game);
  }
  // 与已扫描到的独立游戏做目录归并（保留注册表里更友好的中文名）
  const merged = [];
  const byDir = new Map();
  for (const g of knownGames) {
    const key = g.installDir.toLowerCase();
    byDir.set(key, g);
    merged.push(g);
  }
  for (const g of games) {
    if (!g) continue;
    const key = g.installDir.toLowerCase();
    const exact = byDir.get(key);
    if (exact) {
      mergeGameInto(exact, g);
      continue;
    }
    // 已知独立游戏的 installDir 可能是注册表目录的子目录
    let nested = null;
    for (const [dirKey, existing] of byDir) {
      if (key.startsWith(dirKey + '\\') || dirKey.startsWith(key + '\\')) { nested = existing; break; }
    }
    if (nested) { mergeGameInto(nested, g); continue; }
    if (!merged.some((x) => x.installDir.toLowerCase() === key)) {
      merged.push(g);
      byDir.set(key, g);
    }
  }
  return merged;
}

function mergeGameInto(target, src) {
  if (!target || !src) return target;
  const detected = new Set(String(target.detectedBy || '').split('+').filter(Boolean));
  String(src.detectedBy || '').split('+').filter(Boolean).forEach((d) => detected.add(d));
  target.detectedBy = Array.from(detected).join('+');
  // 中文名优先（注册表 DisplayName 一般更友好）
  if (src.name && (hasCjk(src.name) || !hasCjk(target.name))) {
    if (hasCjk(src.name) || !target.name) target.name = src.name;
  }
  if (src.registryName) target.registryName = src.registryName;
  if (!target.exe && src.exe) target.exe = src.exe;
  if (target.appid == null && src.appid != null) target.appid = src.appid;
  return target;
}

// ---------------------------------------------------------------- 分类 + 覆盖
function defaultClassification(game) {
  const tags = [];
  let region = 'unknown';
  let mode = 'unknown';
  if (game.platform === 'steam') { region = 'overseas'; mode = 'online'; tags.push('steam-library'); }
  else if (game.platform === 'epic') { region = 'overseas'; mode = 'online'; tags.push('epic'); }
  else if (game.platform === 'wegame') { region = 'domestic'; mode = 'online'; tags.push('wegame'); }
  else if (game.platform === 'standalone') { region = 'unknown'; mode = 'cracked'; tags.push('standalone', 'cracked'); }
  else { tags.push('unknown'); }
  const nameFloor = game.nameZh || game.name;
  if (SINGLE_NAME_RE.test(String(game.name || '') + ' ' + String(nameFloor || ''))) {
    mode = 'single';
    if (!tags.includes('single')) tags.push('single');
  }
  if (mode === 'cracked' && !tags.includes('cracked')) tags.push('cracked');
  if (region === 'overseas' && !tags.includes('overseas')) tags.push('overseas');
  if (region === 'domestic' && !tags.includes('domestic')) tags.push('domestic');
  if (mode === 'online' && !tags.includes('online')) tags.push('online');
  return { region, mode, tags };
}

const VALID_REGIONS = ['domestic', 'overseas', 'unknown'];
const VALID_MODES = ['online', 'single', 'cracked', 'unknown'];

function sanitizeOverride(ov) {
  if (!ov || typeof ov !== 'object') return null;
  const out = {};
  if (typeof ov.nameZh === 'string' && ov.nameZh.trim()) out.nameZh = ov.nameZh.trim();
  if (typeof ov.region === 'string' && VALID_REGIONS.includes(ov.region)) out.region = ov.region;
  if (typeof ov.mode === 'string' && VALID_MODES.includes(ov.mode)) out.mode = ov.mode;
  if (Array.isArray(ov.tags)) out.tags = ov.tags.map((t) => String(t).trim()).filter(Boolean);
  return Object.keys(out).length ? out : null;
}

function finalizeGame(rawGame, overrides) {
  const ov = sanitizeOverride(overrides && rawGame.id ? overrides[rawGame.id] : null);
  const game = {
    id: rawGame.id,
    name: rawGame.name,
    nameZh: rawGame.nameZh || rawGame.name,
    platform: rawGame.platform,
    installDir: rawGame.installDir,
    exe: rawGame.exe || null,
    appid: rawGame.appid == null ? null : rawGame.appid,
    sizeGB: rawGame.sizeGB == null ? null : rawGame.sizeGB,
    region: 'unknown',
    mode: 'unknown',
    tags: [],
    detectedBy: rawGame.detectedBy || 'unknown',
    lastSeen: rawGame.lastSeen || nowIso(),
  };
  if (rawGame.steamLibrary) game.steamLibrary = rawGame.steamLibrary;
  const cls = defaultClassification(game);
  game.region = cls.region;
  game.mode = cls.mode;
  game.tags = cls.tags.slice();
  if (ov) {
    if (ov.nameZh) game.nameZh = ov.nameZh;
    if (ov.region) game.region = ov.region;
    if (ov.mode) game.mode = ov.mode;
    if (ov.tags) game.tags = ov.tags.slice();
    game.overridden = Object.keys(ov);
  }
  // 标签与最终 region/mode 对齐（覆盖后也保持一致，供 UI 直接展示）
  const tagSet = new Set(game.tags.filter(Boolean).map((t) => String(t)));
  const platformTag = { steam: 'steam-library', epic: 'epic', wegame: 'wegame', standalone: 'standalone' }[game.platform];
  if (platformTag) tagSet.add(platformTag);
  tagSet.delete('domestic');
  tagSet.delete('overseas');
  if (game.region === 'domestic') tagSet.add('domestic');
  else if (game.region === 'overseas') tagSet.add('overseas');
  tagSet.delete('online');
  tagSet.delete('single');
  tagSet.delete('cracked');
  if (game.mode !== 'unknown') tagSet.add(game.mode);
  if (game.platform === 'standalone') tagSet.add('cracked');
  tagSet.delete('accelerator-needed');
  tagSet.delete('steam-offline');
  if (game.mode === 'online' && game.region !== 'domestic') tagSet.add('accelerator-needed');
  if (game.mode === 'single' || game.mode === 'cracked') tagSet.add('steam-offline');
  game.tags = Array.from(tagSet);
  return game;
}

// ---------------------------------------------------------------- 数据文件
function emptyStats() {
  return {
    total: 0, steam: 0, wegame: 0, standalone: 0, epic: 0, unknown: 0,
    domestic: 0, overseas: 0, regionUnknown: 0,
    online: 0, single: 0, cracked: 0, modeUnknown: 0,
    scanMs: 0,
  };
}

function buildStats(games, scanMs) {
  const s = emptyStats();
  for (const g of games) {
    s.total += 1;
    if (s[g.platform] != null) s[g.platform] += 1; else s.unknown += 1;
    if (g.region === 'domestic') s.domestic += 1;
    else if (g.region === 'overseas') s.overseas += 1;
    else s.regionUnknown += 1;
    if (g.mode === 'online') s.online += 1;
    else if (g.mode === 'single') s.single += 1;
    else if (g.mode === 'cracked') s.cracked += 1;
    else s.modeUnknown += 1;
  }
  s.scanMs = scanMs == null ? 0 : Math.round(scanMs);
  return s;
}

function readGamesFile() {
  const r = readJson(GAMES_FILE);
  if (!r.ok || !r.data || typeof r.data !== 'object') return { ok: false, file: null, error: r.error || 'empty' };
  return { ok: true, file: r.data };
}

function recomputeCacheWithOverrides(games, overrides) {
  return games.map((g) => finalizeGame(g, overrides));
}

/**
 * 读取 data/games.json 缓存（已合并用户覆盖）
 * @returns {{ok:boolean, games:Array, stats:Object, scannedAt:string|null, overrides:Object, updatedAt?:string, error?:string}}
 */
function loadGames() {
  const r = readGamesFile();
  if (!r.ok) {
    return { ok: false, games: [], stats: emptyStats(), scannedAt: null, overrides: {}, error: r.error || 'data/games.json 不存在或格式错误' };
  }
  const file = r.file;
  const rawGames = Array.isArray(file.games) ? file.games : [];
  const overrides = file.overrides && typeof file.overrides === 'object' ? file.overrides : {};
  // 缓存中已合并过的数据也能再次安全合并（幂等）
  const games = rawGames.map((g) => finalizeGame(g, overrides));
  const stats = buildStats(games, file.stats && file.stats.scanMs);
  return {
    ok: true,
    games,
    stats,
    scannedAt: file.scannedAt || null,
    updatedAt: file.updatedAt || null,
    overrides,
    source: GAMES_FILE,
    version: file.version || 1,
  };
}

/**
 * 合并写回 overrides（UI 修改 region/mode/tags/nameZh 用）
 * @param {Object|Array} overrides 形如 { "steam-123456": { region:"overseas", mode:"online", tags:[...] } }
 *        也接受 [{ id, region, mode, tags, nameZh }]
 * @returns {Promise<{ok:boolean, overrides:Object, updatedAt:string, message:string}>}
 */
async function saveOverrides(overrides) {
  try {
    let incoming = {};
    const removals = [];
    if (Array.isArray(overrides)) {
      for (const item of overrides) {
        if (!item || typeof item !== 'object' || !item.id) continue;
        if (item.remove === true) { removals.push(String(item.id)); continue; }
        const ov = sanitizeOverride(item);
        if (ov) incoming[String(item.id)] = Object.assign({}, incoming[String(item.id)] || {}, ov);
      }
    } else if (overrides && typeof overrides === 'object') {
      for (const id of Object.keys(overrides)) {
        if (overrides[id] === null) { removals.push(id); continue; } // value=null → 删除该覆盖，恢复启发式分类
        const ov = sanitizeOverride(overrides[id]);
        if (ov) incoming[id] = Object.assign({}, incoming[id] || {}, ov);
      }
    } else {
      return { ok: false, overrides: {}, updatedAt: nowIso(), message: 'overrides 必须是对象或数组' };
    }

    const r = readGamesFile();
    const file = r.ok ? r.file : { version: 1, games: [], overrides: {} };
    const merged = Object.assign({}, (file.overrides && typeof file.overrides === 'object') ? file.overrides : {});
    for (const id of removals) delete merged[id];
    for (const id of Object.keys(incoming)) merged[id] = Object.assign({}, merged[id] || {}, incoming[id]);
    const nextFile = Object.assign({}, file, {
      version: file.version || 1,
      overrides: merged,
      updatedAt: nowIso(),
    });
    writeJsonAtomic(GAMES_FILE, nextFile);
    const count = Object.keys(incoming).length;
    const removed = removals.filter((id) => !incoming[id]).length;
    return {
      ok: true,
      overrides: merged,
      updatedAt: nextFile.updatedAt,
      message: [count > 0 ? ('已合并保存 ' + count + ' 项覆盖') : '', removed > 0 ? ('已删除 ' + removed + ' 项覆盖（恢复自动分类）') : '']
        .filter(Boolean).join('；') || '没有有效覆盖项，未改动',
    };
  } catch (e) {
    return { ok: false, overrides: {}, updatedAt: nowIso(), message: '保存失败: ' + ((e && e.message) || String(e)) };
  }
}

function dedupeAndSort(games, overrides) {
  const byDir = new Map();
  const ordered = [];
  for (const g of games) {
    if (!g) continue;
    let key = '';
    try { key = path.resolve(g.installDir).toLowerCase(); } catch (_) { key = String(g.installDir || '').toLowerCase(); }
    const exist = byDir.get(key);
    if (exist) { mergeGameInto(exist, g); continue; }
    byDir.set(key, g);
    ordered.push(g);
  }
  const platformRank = { steam: 0, wegame: 1, standalone: 2, epic: 3, unknown: 4 };
  const finalized = ordered.map((g) => finalizeGame(g, overrides));
  finalized.sort((a, b) => {
    const pa = platformRank[a.platform] == null ? 9 : platformRank[a.platform];
    const pb = platformRank[b.platform] == null ? 9 : platformRank[b.platform];
    if (pa !== pb) return pa - pb;
    return String(a.nameZh || a.name).localeCompare(String(b.nameZh || b.name), 'zh-CN');
  });
  return finalized;
}

/**
 * 真实扫描游戏库（只读；不启动/关闭任何程序）
 * @param {{roots?:string[]}} [options]
 * @returns {Promise<{ok:boolean, games:Array, stats:Object, scannedAt:string, durationMs:number, warnings:string[], steamLibraries:Array}>}
 */
async function scanGames(options) {
  const opts = options || {};
  const started = Date.now();
  const warnings = [];
  const scannedAt = nowIso();
  try {
    // 先读旧缓存里的 overrides，扫描后保留（扫描只更新 games 缓存，不覆盖用户覆盖）
    const old = readGamesFile();
    const preservedOverrides = (old.ok && old.file && old.file.overrides && typeof old.file.overrides === 'object')
      ? old.file.overrides : {};

    const raw = [];
    let steamLibraries = [];
    // 1) Steam
    try {
      const steamRes = scanSteam(warnings);
      raw.push.apply(raw, steamRes.games);
      steamLibraries = steamRes.libraries || [];
    } catch (e) { warnings.push('Steam 扫描异常: ' + ((e && e.message) || String(e))); }
    // 2) WeGame
    try { raw.push.apply(raw, scanWeGame(warnings)); } catch (e) { warnings.push('WeGame 扫描异常: ' + ((e && e.message) || String(e))); }
    // 3) Epic（未安装/不可用时为空）
    try { raw.push.apply(raw, scanEpic(warnings)); } catch (e) { warnings.push('Epic 扫描异常: ' + ((e && e.message) || String(e))); }
    // 4) 独立/破解目录
    let standalone = [];
    try {
      standalone = scanStandalone(warnings, opts.roots);
      raw.push.apply(raw, standalone);
    } catch (e) { warnings.push('独立目录扫描异常: ' + ((e && e.message) || String(e))); }
    // 5) 注册表兜底（可在 data/games-config.json 关闭）（再与独立目录合并）
    let afterRegistry = raw;
    try {
      const nonStandalone = raw.filter((g) => g.platform !== 'standalone');
      const mergedStandalone = scanRegistry(warnings, raw.filter((g) => g.platform === 'standalone'));
      afterRegistry = nonStandalone.concat(mergedStandalone);
    } catch (e) { warnings.push('注册表兜底异常: ' + ((e && e.message) || String(e))); }

    // 6) 补 id / nameZh / lastSeen
    for (const g of afterRegistry) {
      if (!g.id) {
        if (g.platform === 'steam' && g.appid != null) g.id = 'steam-' + g.appid;
        else if (g.platform === 'epic' && g.appid) g.id = 'epic-' + String(g.appid).replace(/[^A-Za-z0-9]+/g, '-').toLowerCase();
        else if (g.platform === 'wegame' && g.appid != null) g.id = 'wg-' + g.appid;
        else if (g.platform === 'wegame') g.id = 'wg-' + sha1Short(String(g.installDir || g.name).toLowerCase(), 8);
        else g.id = 'dir-' + sha1Short(String(g.installDir || g.name).toLowerCase(), 8);
      }
      if (!g.nameZh) {
        if (g.platform === 'steam' && NAME_ZH_STEAM[g.appid]) g.nameZh = NAME_ZH_STEAM[g.appid];
        else if (NAME_ZH_BY_DIR[String(g.dirName || g.name || '').toLowerCase()]) {
          g.nameZh = NAME_ZH_BY_DIR[String(g.dirName || g.name || '').toLowerCase()];
        } else g.nameZh = g.name;
      }
      g.lastSeen = scannedAt;
    }

    // 7) 去重 + 排序 + 应用覆盖
    const games = dedupeAndSort(afterRegistry, preservedOverrides);
    const durationMs = Date.now() - started;
    const stats = buildStats(games, durationMs);
    stats.steamLibraries = (steamLibraries || []).length;

    // 8) 写缓存（保留 overrides）
    const file = {
      version: 1,
      module: 'lib/games',
      updatedAt: nowIso(),
      scannedAt,
      durationMs,
      stats,
      games,
      overrides: preservedOverrides,
    };
    try {
      writeJsonAtomic(GAMES_FILE, file);
    } catch (e) {
      warnings.push('写入 data/games.json 失败: ' + ((e && e.message) || String(e)));
    }
    return { ok: true, games, stats, scannedAt, durationMs, warnings, steamLibraries: steamLibraries || [], overrides: preservedOverrides, scannedFile: GAMES_FILE };
  } catch (e) {
    const durationMs = Date.now() - started;
    const stats = emptyStats();
    stats.scanMs = Math.round(durationMs);
    return { ok: false, games: [], stats, scannedAt, durationMs, warnings, error: (e && e.message) || String(e) };
  }
}

/**
 * 查询 Steam 进程（只读）
 * @returns {Promise<{running:boolean, pids:number[], webhelperPids:number[], servicePids:number[], checkedAt:string}>}
 */
async function steamStatus() {
  const procs = findProcesses(STEAM_PROCESS_NAMES);
  const steamPids = procs.filter((p) => p.nameLower === 'steam.exe').map((p) => p.pid);
  const webhelperPids = procs.filter((p) => p.nameLower === 'steamwebhelper.exe').map((p) => p.pid);
  const servicePids = procs.filter((p) => p.nameLower === 'steamservice.exe').map((p) => p.pid);
  return {
    running: steamPids.length > 0 || webhelperPids.length > 0,
    pids: steamPids,
    webhelperPids,
    servicePids,
    checkedAt: nowIso(),
  };
}

// ---------------------------------------------------------------- 管理员辅助脚本（只写不执行）
const NET_OFF_PS1 = `#requires -Version 5.1
<#
  Sanwa - Steam network block helper (Administrator required)
  Blocks OUTBOUND network for Steam client processes so Steam runs in Offline Mode.
  Generated by ${HUB_ROOT}\\lib\\games\\index.js  (launchGame -> steam-net-block).

  Usage (elevated PowerShell or cmd):
    powershell -NoProfile -ExecutionPolicy Bypass -File steam-net-off.ps1
    powershell -NoProfile -ExecutionPolicy Bypass -File steam-net-off.ps1 -Remove
    powershell -NoProfile -ExecutionPolicy Bypass -File steam-net-on.ps1

  This script is NEVER executed automatically unless the hub service itself runs elevated.
#>
[CmdletBinding()]
param(
  [switch]$Remove,
  [string]$SteamDir = ''
)

$ErrorActionPreference = 'Stop'
$ruleName = 'Sanwa-Steam-Block'

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Error 'Administrator privileges required. Right-click PowerShell -> Run as administrator.'
  exit 2
}

function Resolve-SteamDir {
  param([string]$hint)
  $candidates = @()
  if ($hint) { $candidates += $hint }
  $candidates += @('C:\\Program Files (x86)\\Steam', 'C:\\Program Files\\Steam')
  try {
    $regPath = (Get-ItemProperty 'HKCU:\\Software\\Valve\\Steam' -ErrorAction Stop).SteamPath
    if ($regPath) { $candidates += $regPath }
  } catch { }
  foreach ($c in $candidates) {
    if ($c -and (Test-Path (Join-Path $c 'steam.exe'))) { return $c }
  }
  return $null
}

function Get-SteamPrograms {
  param([string]$dir)
  $list = New-Object System.Collections.ArrayList
  $steamExe = Join-Path $dir 'steam.exe'
  if (Test-Path $steamExe) { [void]$list.Add($steamExe) }
  $patterns = @(
    'steamwebhelper.exe',
    'bin\\cef\\cef.win7x64\\steamwebhelper.exe',
    'bin\\cef\\cef.win7\\steamwebhelper.exe',
    'bin\\cef\\cef.win8\\steamwebhelper.exe',
    'bin\\cef\\cef.win10\\steamwebhelper.exe',
    'bin\\cef\\cef.win11\\steamwebhelper.exe'
  )
  $seen = @{}
  foreach ($p in $patterns) {
    $full = Join-Path $dir $p
    if ((Test-Path $full) -and -not $seen.ContainsKey($full)) {
      $seen[$full] = $true
      [void]$list.Add($full)
    }
  }
  if ($list.Count -lt 2) {
    $bin = Join-Path $dir 'bin'
    if (Test-Path $bin) {
      Get-ChildItem -Path $bin -Filter 'steamwebhelper.exe' -Recurse -File -ErrorAction SilentlyContinue |
        Select-Object -First 3 | ForEach-Object {
          if (-not $seen.ContainsKey($_.FullName)) { $seen[$_.FullName] = $true; [void]$list.Add($_.FullName) }
        }
    }
  }
  return $list
}

function Remove-SteamBlock {
  $rules = @(Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue)
  if ($rules.Count -eq 0) { Write-Output "No firewall rule named '$ruleName' found."; return 0 }
  $rules | Remove-NetFirewallRule -ErrorAction SilentlyContinue
  Write-Output ("Removed " + $rules.Count + " firewall rule(s) named '" + $ruleName + "'.")
  return $rules.Count
}

if ($Remove) {
  [void](Remove-SteamBlock)
  exit 0
}

$dir = Resolve-SteamDir -hint $SteamDir
if (-not $dir) {
  Write-Error 'Steam installation folder not found. Pass -SteamDir "C:\\Program Files (x86)\\Steam".'
  exit 3
}
$programs = @(Get-SteamPrograms -dir $dir)
if ($programs.Count -eq 0) {
  Write-Error ('No Steam executables found under ' + $dir)
  exit 4
}

# idempotent: drop stale rules first
[void](Remove-SteamBlock)
foreach ($prog in $programs) {
  New-NetFirewallRule -DisplayName $ruleName -Direction Outbound -Program $prog -Action Block -Profile Any -Enabled True -Description 'Sanwa hub: block Steam client network (offline mode)' | Out-Null
  Write-Output ('Blocked outbound: ' + $prog)
}
$check = @(Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue)
Write-Output ("Done. Active '" + $ruleName + "' rules: " + $check.Count)
if ($check.Count -lt 1) { exit 5 }
Write-Output 'Restore with: powershell -NoProfile -ExecutionPolicy Bypass -File steam-net-on.ps1'
exit 0
`;

const NET_ON_PS1 = `#requires -Version 5.1
<#
  Sanwa - remove Steam network block helper (Administrator required)
  Removes firewall rules created by steam-net-off.ps1 (DisplayName: Sanwa-Steam-Block).
  Generated by ${HUB_ROOT}\\lib\\games\\index.js.

  Usage (elevated PowerShell or cmd):
    powershell -NoProfile -ExecutionPolicy Bypass -File steam-net-on.ps1
#>
[CmdletBinding()]
param(
  [string]$RuleName = 'Sanwa-Steam-Block'
)

$ErrorActionPreference = 'Stop'

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Error 'Administrator privileges required. Right-click PowerShell -> Run as administrator.'
  exit 2
}

$rules = @(Get-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue)
if ($rules.Count -eq 0) {
  Write-Output ("No firewall rule named '" + $RuleName + "' found. Steam network is not blocked.")
  exit 0
}
$rules | Remove-NetFirewallRule -ErrorAction SilentlyContinue
$left = @(Get-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue)
Write-Output ("Removed " + $rules.Count + " rule(s). Remaining: " + $left.Count)
if ($left.Count -gt 0) { exit 5 }
exit 0
`;

const HELPERS_README_MD = `# Steam 断网辅助脚本（管理员用，不会自动执行）

本目录下的 \`steam-net-off.ps1\` / \`steam-net-on.ps1\` 由 \`${HUB_ROOT}\\lib\\games\\index.js\`
的 \`launchGame()\` 按需**生成但绝不自动执行**（除非 Sanwa 系统管理器本身以管理员身份运行）。

## 用途

单机/破解游戏按需启动时，编排会先关闭 Steam，并"请求"阻断 Steam 客户端网络，
让 Steam 下次启动进入**离线模式**（不检查更新、不联网验证）。Windows 防火墙规则需要
管理员权限，因此：

- 当前用户非管理员时，\`launchGame()\` 会如实返回
  \`steamNetBlock: { requested:true, applied:false, reason:'需要管理员权限', helper:'${HUB_ROOT}\\tools\\steam-net-off.ps1' }\`
  —— 不会伪造成功。
- 想让断网真正生效，请在需要时以管理员身份手动运行下面脚本。

## 管理员运行方法

开始菜单 → 输入 \`PowerShell\` → 右键 **以管理员身份运行**，然后：

\`\`\`powershell
# 1) 阻断 Steam 出站网络（创建防火墙规则 Sanwa-Steam-Block）
powershell -NoProfile -ExecutionPolicy Bypass -File "${HUB_ROOT}\\tools\\steam-net-off.ps1"

# 2) 查看规则
Get-NetFirewallRule -DisplayName 'Sanwa-Steam-Block' | Format-Table Name,Direction,Action,Enabled

# 3) 恢复网络（删除规则）
powershell -NoProfile -ExecutionPolicy Bypass -File "${HUB_ROOT}\\tools\\steam-net-on.ps1"
\`\`\`

## 脚本行为

| 脚本 | 行为 |
| --- | --- |
| \`steam-net-off.ps1\` | 对 \`steam.exe\`、\`steamwebhelper.exe\` 各建一条**出站 Block** 规则（DisplayName = \`Sanwa-Steam-Block\`）；重复运行会先清理旧规则；支持 \`-Remove\`；\`-SteamDir\` 可指定 Steam 安装目录。 |
| \`steam-net-on.ps1\` | 删除所有 \`Sanwa-Steam-Block\` 规则，恢复 Steam 联网。 |

## 注意

- 规则只针对 Steam 客户端进程，不影响浏览器/其它程序；但断网期间 Steam 无法下载/更新、无法进入在线模式。
- 关闭 Steam 前记得保存进度；断网后再次启动 Steam 会提示以**离线模式**运行。
- 不需要断网时请务必执行 \`steam-net-on.ps1\` 恢复。
- 脚本均为 ASCII 内容 + \`#requires -Version 5.1\`，兼容 Windows PowerShell 5.1。
`;

function ensureSteamBlockHelpers() {
  const created = [];
  try {
    fs.mkdirSync(TOOLS_DIR, { recursive: true });
    const targets = [
      [HELPER_NET_OFF, NET_OFF_PS1],
      [HELPER_NET_ON, NET_ON_PS1],
      [HELPER_README, HELPERS_README_MD],
    ];
    for (const [file, content] of targets) {
      if (!exists(file)) {
        fs.writeFileSync(file, content, 'utf8');
        created.push(file);
      }
    }
    return { ok: true, helper: HELPER_NET_OFF, helperOn: HELPER_NET_ON, readme: HELPER_README, created };
  } catch (e) {
    return { ok: false, created, error: (e && e.message) || String(e), helper: HELPER_NET_OFF, helperOn: HELPER_NET_ON, readme: HELPER_README };
  }
}

// ---------------------------------------------------------------- 启动编排
function decideAccelerator(game, accelMode) {
  if (accelMode === 'on') return { needed: true, reason: '强制开启（opts.accelerator=on）' };
  if (accelMode === 'off') return { needed: false, reason: '已关闭（opts.accelerator=off）' };
  if (game.mode === 'single' || game.mode === 'cracked') return { needed: false, reason: '单机/破解游戏不启动加速器' };
  if (game.region === 'domestic') return { needed: false, reason: '境内游戏无需加速器' };
  if (game.mode === 'online') return { needed: true, reason: '境外联机游戏（region=overseas, mode=online）' };
  return { needed: false, reason: '模式未知，默认不开启加速器' };
}

function decideSteamOffline(game, steamMode) {
  if (steamMode === 'offline') return { needed: true, reason: 'opts.steamMode=offline' };
  if (steamMode === 'block') return { needed: true, reason: 'opts.steamMode=block' };
  if (steamMode === 'off') return { needed: false, reason: 'opts.steamMode=off' };
  if (steamMode !== 'auto') return { needed: false, reason: 'steamMode=' + steamMode };
  if (game.mode === 'single' || game.mode === 'cracked') {
    return { needed: true, reason: '单机/破解游戏（mode=' + game.mode + '）→ Steam 离线编排' };
  }
  return { needed: false, reason: '在线游戏保持 Steam 联网' };
}

async function ensureAccelerator(dryRun) {
  const launcherExe = exists(LEIGOD_LAUNCHER) ? LEIGOD_LAUNCHER : (exists(LEIGOD_MAIN) ? LEIGOD_MAIN : null);
  const running = findProcesses(ACCEL_PROCESS_NAMES);
  if (running.length > 0) {
    return {
      type: 'accelerator',
      ok: true,
      alreadyRunning: true,
      pids: running.map((p) => p.pid),
      note: '雷神加速器已在运行；需在雷神里选择该游戏的加速节点',
    };
  }
  if (!launcherExe) {
    return { type: 'accelerator', ok: false, note: '未找到雷神加速器安装（' + LEIGOD_LAUNCHER + '），无法自动拉起' };
  }
  if (dryRun) {
    return {
      type: 'accelerator',
      ok: true,
      planned: true,
      target: launcherExe,
      waitMs: ACCEL_WAIT_MS,
      note: '计划拉起雷神加速器（' + launcherExe + '），等待约 4s；需在雷神里选择该游戏的加速节点',
    };
  }
  const spawned = await spawnDetached(launcherExe, [], { cwd: LEIGOD_DIR });
  await sleep(ACCEL_WAIT_MS);
  const runningAfter = findProcesses(ACCEL_PROCESS_NAMES);
  return {
    type: 'accelerator',
    ok: runningAfter.length > 0 || spawned.ok,
    alreadyRunning: false,
    spawned: spawned.ok,
    pids: runningAfter.map((p) => p.pid),
    target: launcherExe,
    note: runningAfter.length > 0
      ? '雷神加速器已拉起；需在雷神里选择该游戏的加速节点（客户端不会自动选节点）'
      : (spawned.ok ? '已启动雷神启动器，但 4s 内未检测到进程；请确认客户端已打开并手动选节点' : ('拉起雷神失败: ' + (spawned.error || '未知错误'))),
  };
}

async function stopSteam(dryRun) {
  const before = findProcesses(STEAM_PROCESS_NAMES);
  if (before.length === 0) {
    return { type: 'steam-offline', ok: true, alreadyStopped: true, killed: [], failed: [], note: 'Steam 未运行，无需关闭' };
  }
  if (dryRun) {
    return {
      type: 'steam-offline',
      ok: true,
      planned: true,
      willKill: before.map((p) => ({ name: p.name, pid: p.pid })),
      note: '计划关闭 Steam：' + before.map((p) => p.name + '(' + p.pid + ')').join('、'),
    };
  }
  const killed = [];
  const failed = [];
  for (const p of before) {
    // 二次确认：只杀精确命名的 Steam 进程
    if (!STEAM_PROCESS_NAMES.includes(p.nameLower)) { failed.push({ name: p.name, pid: p.pid, error: '进程名不在白名单' }); continue; }
    const r = taskkillTree(p.pid);
    if (r.ok) killed.push({ name: p.name, pid: p.pid });
    else failed.push({ name: p.name, pid: p.pid, error: r.output || 'taskkill 失败（可能受保护/需要管理员）' });
  }
  await sleep(STEAM_STOP_WAIT_MS);
  const remaining = findProcesses(STEAM_PROCESS_NAMES);
  const mainOpen = remaining.some((p) => p.nameLower === 'steam.exe' || p.nameLower === 'steamwebhelper.exe');
  const serviceRemain = remaining.filter((p) => p.nameLower === 'steamservice.exe');
  const notes = [];
  notes.push(killed.length ? ('已关闭: ' + killed.map((k) => k.name + '(' + k.pid + ')').join('、')) : '未关闭任何 Steam 进程');
  if (failed.length) notes.push('失败: ' + failed.map((f) => f.name + '(' + f.error + ')').join('；'));
  if (serviceRemain.length) notes.push('SteamService 为系统服务，非管理员可能无法关闭（不影响离线启动）');
  return {
    type: 'steam-offline',
    ok: !mainOpen,
    killed,
    failed,
    remaining: remaining.map((p) => ({ name: p.name, pid: p.pid })),
    note: notes.join('；'),
  };
}

async function requestSteamNetBlock(dryRun) {
  const helpers = ensureSteamBlockHelpers();
  const admin = isAdmin();
  const base = {
    requested: true,
    helper: HELPER_NET_OFF,
    helperOn: HELPER_NET_ON,
    readme: HELPER_README,
    ruleName: 'Sanwa-Steam-Block',
  };
  if (admin) {
    if (dryRun) {
      return {
        steamNetBlock: Object.assign({}, base, { applied: false, admin: true, reason: 'dryRun：管理员身份下未执行（正式调用将自动运行 helper）' }),
        action: { type: 'steam-net-block', ok: false, planned: true, admin: true, helper: HELPER_NET_OFF, note: 'dryRun：计划运行 steam-net-off.ps1 添加出站 Block 规则' },
      };
    }
    const run = await new Promise((resolve) => {
      let child;
      try {
        child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', HELPER_NET_OFF], { windowsHide: true, stdio: 'ignore' });
      } catch (e) { return resolve({ ok: false, error: (e && e.message) || String(e) }); }
      child.once('error', (e) => resolve({ ok: false, error: (e && e.message) || String(e) }));
      child.once('exit', (code) => resolve({ ok: code === 0, code }));
      setTimeout(() => resolve({ ok: false, error: 'timeout' }), 25000);
    });
    return {
      steamNetBlock: Object.assign({}, base, {
        applied: !!run.ok,
        admin: true,
        reason: run.ok ? '已添加防火墙出站 Block 规则（Sanwa-Steam-Block）' : ('添加防火墙规则失败: ' + (run.error || ('exit ' + run.code))),
      }),
      action: {
        type: 'steam-net-block',
        ok: !!run.ok,
        admin: true,
        helper: HELPER_NET_OFF,
        note: run.ok ? '已断网（防火墙规则 Sanwa-Steam-Block；恢复用 steam-net-on.ps1）' : '断网失败（见 steamNetBlock.reason）',
      },
    };
  }
  const reason = '需要管理员权限';
  return {
    steamNetBlock: Object.assign({}, base, { applied: false, admin: false, reason, note: '当前用户非管理员，未修改防火墙；如需真正断网请以管理员运行 helper' }),
    action: {
      type: 'steam-net-block',
      ok: false,
      expected: true,
      admin: false,
      helper: HELPER_NET_OFF,
      helperOn: HELPER_NET_ON,
      note: '断网未生效：需要管理员权限。请右键“以管理员身份运行” ' + HELPER_NET_OFF + '（只写未执行）',
    },
    helpersCreated: helpers.created || [],
    helpersOk: helpers.ok,
  };
}

async function launchPlanned(game, dryRun) {
  const platform = game.platform;
  if (platform === 'steam') {
    if (!game.appid) {
      return { type: 'game-launch', ok: false, method: 'steam-uri', note: '缺少 appid，无法用 steam:// 启动' };
    }
    const uri = 'steam://rungameid/' + game.appid;
    if (dryRun) {
      return { type: 'game-launch', ok: true, planned: true, method: 'steam-uri', target: uri, note: '计划通过 Steam 协议启动: ' + uri };
    }
    const r = await spawnDetached('explorer.exe', [uri]);
    return {
      type: 'game-launch',
      ok: r.ok,
      method: 'steam-uri',
      target: uri,
      pid: r.pid || null,
      note: r.ok ? ('已通过 Steam 协议启动 ' + uri) : ('启动失败: ' + (r.error || '未知错误')),
    };
  }
  if (platform === 'wegame') {
    const uri = game.appid != null ? ('wegame://action=StartFor&game_id=' + game.appid) : null;
    if (dryRun) {
      return {
        type: 'game-launch',
        ok: !!(uri || game.exe),
        planned: true,
        method: uri ? 'wegame-protocol' : 'exe',
        target: uri || game.exe,
        note: uri
          ? ('计划通过 WeGame 协议启动: ' + uri)
          : ('计划直接启动 WeGame 游戏主程序: ' + game.exe),
      };
    }
    if (uri) {
      const r = await spawnDetached('explorer.exe', [uri]);
      if (r.ok) {
        return {
          type: 'game-launch', ok: true, method: 'wegame-protocol', target: uri,
          note: '已通过 WeGame 协议启动（若客户端未登录，请在 WeGame 弹窗中确认）',
        };
      }
      if (game.exe) {
        const r2 = await spawnDetached(game.exe, [], { cwd: game.installDir });
        return {
          type: 'game-launch', ok: r2.ok, method: 'exe', target: game.exe,
          note: r2.ok ? 'WeGame 协议启动失败，已改为直接启动游戏 exe（联机功能可能需 WeGame 客户端登录）' : ('启动失败: ' + (r2.error || '未知错误')),
        };
      }
      return { type: 'game-launch', ok: false, method: 'wegame-protocol', target: uri, note: 'WeGame 协议启动失败且没有可用的游戏 exe' };
    }
    if (game.exe) {
      const r = await spawnDetached(game.exe, [], { cwd: game.installDir });
      return { type: 'game-launch', ok: r.ok, method: 'exe', target: game.exe, note: r.ok ? ('已直接启动 ' + game.exe + '（WeGame 游戏缺少 game_id，若登录异常请从 WeGame 客户端启动）') : ('启动失败: ' + (r.error || '未知错误')) };
    }
    const client = discoverWeGameClient();
    if (client) {
      const r = await spawnDetached(client, []);
      return { type: 'game-launch', ok: r.ok, method: 'wegame-client', target: client, note: r.ok ? '已打开 WeGame 客户端，请在客户端中手动启动该游戏' : ('启动 WeGame 客户端失败: ' + (r.error || '未知错误')) };
    }
    return { type: 'game-launch', ok: false, method: 'none', note: '未找到 WeGame 客户端或游戏 exe，无法启动' };
  }
  // standalone / epic：直接启动主程序
  if (!game.exe || !exists(game.exe)) {
    return { type: 'game-launch', ok: false, method: 'exe', target: game.exe || null, note: '未找到游戏主 exe，无法启动（请先重新扫描或手动补充）' };
  }
  if (dryRun) {
    return { type: 'game-launch', ok: true, planned: true, method: 'exe', target: game.exe, cwd: path.dirname(game.exe), note: '计划直接启动: ' + game.exe };
  }
  const r = await spawnDetached(game.exe, [], { cwd: path.dirname(game.exe) });
  return {
    type: 'game-launch',
    ok: r.ok,
    method: 'exe',
    target: game.exe,
    pid: r.pid || null,
    note: r.ok ? ('已启动 ' + path.basename(game.exe)) : ('启动失败: ' + (r.error || '未知错误')),
  };
}

function findGameById(games, id) {
  const key = String(id || '');
  if (!key) return null;
  let g = games.find((x) => x.id === key);
  if (g) return g;
  g = games.find((x) => String(x.appid) === key || String(x.name) === key || String(x.nameZh) === key);
  return g || null;
}

/**
 * 按需启动编排
 * @param {string} id 游戏 id（如 steam-123456 / wg-123 / dir-xxxxxxxx）
 * @param {{accelerator?:'auto'|'on'|'off', steamMode?:'auto'|'offline'|'block'|'off', dryRun?:boolean}} [opts]
 * @returns {Promise<{ok:boolean, game:Object|null, actions:Array, steamNetBlock:Object|null, message:string, dryRun:boolean}>}
 */
async function launchGame(id, opts) {
  const options = opts || {};
  const dryRun = !!options.dryRun;
  const accelMode = options.accelerator || 'auto';
  const steamMode = options.steamMode || 'auto';
  const actions = [];
  let game = null;
  let netBlock = null;
  try {
    const cache = loadGames();
    if (!cache.ok || !cache.games.length) {
      return {
        ok: false, game: null, actions, steamNetBlock: null, dryRun,
        message: '游戏缓存为空或无法读取 data/games.json，请先调用 scanGames() 扫描' + (cache.error ? ('（' + cache.error + '）') : ''),
      };
    }
    game = findGameById(cache.games, id);
    if (!game) {
      return { ok: false, game: null, actions, steamNetBlock: null, dryRun, message: '未找到游戏 id: ' + id + '（可先重新扫描）' };
    }

    // 1) 加速器
    const accel = decideAccelerator(game, accelMode);
    if (accel.needed) actions.push(await ensureAccelerator(dryRun));

    // 2) Steam 离线（关闭 Steam）
    const offline = decideSteamOffline(game, steamMode);
    if (offline.needed) {
      const steamAction = await stopSteam(dryRun);
      actions.push(steamAction);
      // 3) 断网请求（管理员辅助脚本，只写不执行）
      const net = await requestSteamNetBlock(dryRun);
      netBlock = net.steamNetBlock;
      actions.push(net.action);
    }

    // 4) 启动游戏
    const launchAction = await launchPlanned(game, dryRun);
    actions.push(launchAction);

    const ok = !!launchAction.ok;
    const parts = [];
    parts.push((dryRun ? '【演练】' : '') + '《' + (game.nameZh || game.name) + '》启动' + (ok ? (dryRun ? '计划已生成' : '已下发') : '失败'));
    parts.push('平台=' + game.platform + ' / ' + (game.region === 'domestic' ? '境内' : game.region === 'overseas' ? '境外' : '地区未知') + ' / ' + (game.mode === 'online' ? '联机' : game.mode === 'single' ? '单机' : game.mode === 'cracked' ? '破解' : '模式未知'));
    if (accel.needed) {
      const a = actions.find((x) => x.type === 'accelerator');
      parts.push('加速器=' + (a && a.ok ? (a.alreadyRunning ? '已在运行' : (dryRun ? '将拉起' : '已拉起')) : '未生效（需手动处理）'));
    } else {
      parts.push('加速器=跳过（' + accel.reason + '）');
    }
    if (offline.needed) {
      const s = actions.find((x) => x.type === 'steam-offline');
      parts.push('Steam=' + (s && s.ok ? (s.alreadyStopped ? '未运行' : (dryRun ? '将关闭' : '已关闭')) : '关闭未完成'));
      parts.push('断网=' + (netBlock && netBlock.applied ? '已生效' : '未生效（' + ((netBlock && netBlock.reason) || '需要管理员权限') + '）'));
    } else if (game.platform === 'steam') {
      parts.push('Steam=保持运行（联网）');
    }
    return {
      ok,
      game,
      actions,
      steamNetBlock: netBlock,
      dryRun,
      message: parts.join('；'),
      launch: launchAction,
      accelerator: { needed: accel.needed, reason: accel.reason, mode: accelMode },
      steamOffline: { requested: offline.needed, reason: offline.reason, mode: steamMode },
      helper: offline.needed ? HELPER_NET_OFF : null,
    };
  } catch (e) {
    return {
      ok: false,
      game,
      actions,
      steamNetBlock: netBlock,
      dryRun,
      message: '启动编排异常: ' + ((e && e.message) || String(e)),
    };
  }
}

module.exports = {
  scanGames,
  loadGames,
  saveOverrides,
  launchGame,
  steamStatus,
  // 版本信息（便于排查；不影响上述契约）
  VERSION: MODULE_VERSION,
};
