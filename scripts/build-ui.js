#!/usr/bin/env node
/**
 * Sanwa系统管理器 · 单文件 UI 构建脚本
 * 读取 web/ui.template.html + data/tools.json（不存在时用 data/tools.example.json），
 * 生成 web/index.html。桌面 HTML 由 install.ps1 复制。
 * 用法：node scripts/build-ui.js
 */

'use strict';

const fs = require('fs');
const path = require('path');

const HUB_ROOT = path.resolve(__dirname, '..');
const TEMPLATE = path.join(HUB_ROOT, 'web', 'ui.template.html');
const INSTALLED_CONFIG = path.join(HUB_ROOT, 'data', 'tools.json');
const EXAMPLE_CONFIG = path.join(HUB_ROOT, 'data', 'tools.example.json');
const CONFIG_PATH = fs.existsSync(INSTALLED_CONFIG) ? INSTALLED_CONFIG : EXAMPLE_CONFIG;
const WEB_INDEX = path.join(HUB_ROOT, 'web', 'index.html');
const MARKER = '/*__HUB_DATA__*/ null';

const warnings = [];
const errors = [];

function readJson(file, label) {
  try {
    const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
    return JSON.parse(raw);
  } catch (err) {
    errors.push(`读取 ${label} 失败：${err.message}`);
    return null;
  }
}

function categoryName(config, catId) {
  const list = Array.isArray(config.categories) ? config.categories : [];
  const hit = list.find((c) => c.id === catId);
  return hit ? hit.name : catId;
}

function resolveScriptPath(script) {
  if (!script) return null;
  if (String(script).indexOf('%') >= 0) return String(script); // 占位符：安装后由 install.ps1 展开
  if (path.isAbsolute(script)) return script;
  return path.join(HUB_ROOT, 'scripts', script);
}

function isHttpUrl(value) {
  return /^https?:\/\/[^\s]+$/i.test(String(value || ''));
}

function launchReadiness(tool) {
  const launch = tool.launch || {};
  const kind = launch.kind || 'none';
  if (kind === 'none') return { ready: false, kind, reason: launch.note || '未配置启动方式' };
  if (kind === 'self' || kind === 'service') return { ready: true, kind, reason: '' };
  if (kind === 'appx') return { ready: true, kind, reason: '' };
  if (kind === 'url') {
    const target = launch.url || tool.url;
    if (isHttpUrl(target)) return { ready: true, kind, reason: '' };
    try {
      if (target && path.isAbsolute(target) && fs.existsSync(target)) return { ready: true, kind, reason: '' };
    } catch (_) { /* ignore */ }
    return { ready: false, kind, reason: `打开目标不存在：${target || '(空)'}` };
  }
  if (kind === 'exe') {
    const exe = launch.exe;
    if (!exe) return { ready: false, kind, reason: '未配置 exe 路径' };
    try {
      if (fs.existsSync(exe)) return { ready: true, kind, reason: '' };
    } catch (_) { /* ignore */ }
    return { ready: false, kind, reason: `可执行文件不存在：${exe}` };
  }
  if (kind === 'script') {
    const abs = resolveScriptPath(launch.script);
    if (!abs) return { ready: false, kind, reason: '未配置启动脚本' };
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
      paths: t.paths || null,
      notes: Array.isArray(t.notes) ? t.notes : [],
      actionLabel: (t.launch && t.launch.actionLabel) || '',
      launchKind: kind,
      canLaunch: readiness.ready,
      launchReady: readiness.ready,
      launchReason: readiness.ready ? '' : readiness.reason,
    };
  });
}

function validate(config) {
  const validCats = new Set((config.categories || []).map((c) => c.id));
  const ids = new Set();
  for (const tool of config.tools) {
    if (!tool.id || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(tool.id)) {
      warnings.push(`工具 id 不规范：${JSON.stringify(tool.id)}（应匹配 ^[a-z0-9][a-z0-9_-]{0,63}$）`);
    }
    if (ids.has(tool.id)) warnings.push(`工具 id 重复：${tool.id}`);
    ids.add(tool.id);
    if (!validCats.has(tool.category)) warnings.push(`工具 ${tool.id} 的分类 "${tool.category}" 不在 categories 中`);
    if (!tool.name) warnings.push(`工具 ${tool.id} 缺少 name`);
    const kind = (tool.launch && tool.launch.kind) || 'none';
    if (kind !== 'none' && kind !== 'self') {
      const script = path.join(HUB_ROOT, 'scripts', `${tool.id}.ps1`);
      if (!fs.existsSync(script)) warnings.push(`工具 ${tool.id} 配置了 launch.kind=${kind}，但缺少脚本 scripts/${tool.id}.ps1`);
    }
    const readiness = launchReadiness(tool);
    if (!readiness.ready) warnings.push(`工具 ${tool.id} 当前不可启动：${readiness.reason}`);
  }
}

function main() {
  if (!fs.existsSync(TEMPLATE)) {
    console.error(`[build-ui] 未找到模板：${TEMPLATE}`);
    process.exit(1);
  }
  const config = readJson(CONFIG_PATH, 'tools.json');
  if (!config) {
    errors.forEach((e) => console.error(`[build-ui] ${e}`));
    process.exit(1);
  }
  if (!Array.isArray(config.tools)) {
    console.error('[build-ui] tools.json 缺少 tools 数组');
    process.exit(1);
  }

  validate(config);
  const template = fs.readFileSync(TEMPLATE, 'utf8');
  if (!template.includes(MARKER)) {
    console.error(`[build-ui] 模板缺少数据占位标记：${MARKER}`);
    process.exit(1);
  }

  const desktopHtml = (config.hub && config.hub.desktopHtml) || '%USERPROFILE%\\Desktop\\Sanwa系统管理器.html';
  const payload = {
    builtAt: new Date().toISOString(),
    templateVersion: 2,
    toolBookVersion: config.toolBookVersion || '',
    isDraft: !!config.draft,
    hub: Object.assign(
      {
        name: 'Sanwa系统管理器',
        version: '1.0.0',
        apiBase: 'http://127.0.0.1:9900',
        root: '%SANWA_HOME%',
        startCmd: (config.hub && config.hub.startCmd) || path.join(HUB_ROOT, 'start-sanwa.cmd'),
        desktopHtml,
        webIndex: '%SANWA_HOME%\\web\\index.html',
        port: 9900,
      },
      config.hub || {}
    ),
    categories: config.categories || [],
    tools: publicTools(config),
  };

  const compact = JSON.stringify(payload).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
  const html = template.replace(MARKER, compact);

  // 写入服务端 UI
  fs.mkdirSync(path.dirname(WEB_INDEX), { recursive: true });
  fs.writeFileSync(WEB_INDEX, html, 'utf8');
  // 写入桌面 UI
  const bytes = Buffer.byteLength(html, 'utf8');
  const tools = payload.tools;
  const drafts = tools.filter((t) => t.draft).length;
  const withoutLaunch = tools.filter((t) => !t.canLaunch).length;

  console.log('');
  console.log('');
  console.log('  Sanwa系统管理器 · UI 构建完成');
  console.log('  ------------------------------------------------------');
  console.log('  输出：' + WEB_INDEX);
  console.log('  配置：' + CONFIG_PATH);
  if (errors.length) { console.error('构建失败：'); errors.forEach((e) => console.error('  - ' + e)); process.exit(1); }
  if (warnings.length) warnings.forEach((w) => console.log('  ⚠ ' + w));
}


main();
