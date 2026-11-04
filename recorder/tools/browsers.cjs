/* ============================================================
   browsers.cjs — 本机浏览器探测
   ------------------------------------------------------------
   为什么要单独一个文件：测试脚本原本把 Chrome 的绝对路径写死，
   于是"能不能在别的浏览器上跑"这件事根本无从验证。这里把探测集中起来，
   e2e-check / cross-browser 都从这里取，换机器只改一处。

   分两类：
     chromium —— Chrome / Edge / Brave 等，能用 CDP（--remote-debugging-port）
     gecko    —— Firefox，CDP 已在 129 之后移除，需要 geckodriver/WebDriver，
                 本文件只负责"是否装了"，不假装能跑

   用法：
     const B = require('./browsers.cjs');
     B.list()            → 全部候选（含未安装的，带 present/reason）
     B.primary()         → 第一个可跑的 chromium
     B.pick('edge')      → 按名字挑，找不到返回 null
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

/* 路径按平台分组：Windows 是这台开发机，Linux/macOS 是给 CI 与别人的机器用的。
   环境变量优先（BROWSER_CHROME / BROWSER_EDGE …），方便 CI 里指到非标准安装位置。 */
const WIN = process.platform === 'win32';
const MAC = process.platform === 'darwin';

const ENV_OVERRIDE = {
  chrome: process.env.BROWSER_CHROME || '',
  edge: process.env.BROWSER_EDGE || '',
  brave: process.env.BROWSER_BRAVE || '',
  firefox: process.env.BROWSER_FIREFOX || ''
};

const CANDIDATES = [
  {
    name: 'chrome', label: 'Chrome', kind: 'chromium',
    paths: [
      ENV_OVERRIDE.chrome,
      'C:/Program Files/Google/Chrome/Application/chrome.exe',
      'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
      path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/opt/google/chrome/chrome'
    ]
  },
  {
    name: 'chromium', label: 'Chromium', kind: 'chromium',
    paths: [
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/snap/bin/chromium',
      '/Applications/Chromium.app/Contents/MacOS/Chromium'
    ]
  },
  {
    name: 'edge', label: 'Edge', kind: 'chromium',
    paths: [
      ENV_OVERRIDE.edge,
      'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
      'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/usr/bin/microsoft-edge',
      '/usr/bin/microsoft-edge-stable'
    ]
  },
  {
    name: 'brave', label: 'Brave', kind: 'chromium',
    paths: [
      ENV_OVERRIDE.brave,
      'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
      '/usr/bin/brave-browser'
    ]
  },
  {
    name: 'firefox', label: 'Firefox', kind: 'gecko',
    note: 'CDP 已移除，需要 geckodriver + WebDriver；本仓库的自动化暂不支持，仅做人工验证',
    paths: [
      ENV_OVERRIDE.firefox,
      'C:/Program Files/Mozilla Firefox/firefox.exe',
      'C:/Program Files (x86)/Mozilla Firefox/firefox.exe',
      '/Applications/Firefox.app/Contents/MacOS/firefox',
      '/usr/bin/firefox'
    ]
  },
  {
    name: 'safari', label: 'Safari', kind: 'webkit',
    note: '仅 macOS；本仓库的自动化不支持，靠功能探测 + 降级路径覆盖',
    paths: MAC ? ['/Applications/Safari.app/Contents/MacOS/Safari'] : []
  }
];

/** 读浏览器版本号；Windows 走 PowerShell 的 VersionInfo，其余平台跑 --version。
    读不到就返回 ''，不阻断探测。 */
function versionOf(exe) {
  try {
    if (WIN) {
      const out = execFileSync('powershell', [
        '-NoProfile', '-NonInteractive', '-Command',
        `(Get-Item '${exe.replace(/'/g, "''")}').VersionInfo.ProductVersion`
      ], { encoding: 'utf8', timeout: 8000, stdio: ['ignore', 'pipe', 'ignore'] });
      return String(out).trim();
    }
    const out = execFileSync(exe, ['--version'], {
      encoding: 'utf8', timeout: 8000, stdio: ['ignore', 'pipe', 'ignore']
    });
    return String(out).trim().replace(/^[^0-9]*/, '');
  } catch (e) { return ''; }
}

function probe(spec) {
  const hit = spec.paths.find((p) => p && fs.existsSync(p)) || null;
  const present = !!hit;
  let reason = '';
  if (!present) reason = '未安装';
  else if (spec.kind !== 'chromium') reason = spec.note || '非 Chromium 内核，本仓库自动化不支持';

  return {
    name: spec.name,
    label: spec.label || spec.name,
    kind: spec.kind,
    path: hit,
    present,
    version: present ? versionOf(hit) : '',
    canRun: present && spec.kind === 'chromium',
    reason
  };
}

function list() { return CANDIDATES.map(probe); }

function pick(name) {
  const want = String(name || '').toLowerCase();
  return list().find((b) => b.name === want && b.canRun) || null;
}

function primary() {
  return list().find((b) => b.canRun) || null;
}

/** 人读的一行摘要，给测试脚本开头打印用 */
function describe(b) {
  if (!b) return '（没有可用于自动化的浏览器）';
  return `${b.label}${b.version ? ' ' + b.version : ''}${b.path ? ' · ' + b.path : ''}`;
}

/** 无头启动的公共参数。CI 容器里 Chrome 常因没有 user namespace 而起不来，
    只有在那时加 --no-sandbox；本地不加，别把沙箱关成默认行为。
    /dev/shm 在容器里往往只有 64MB，Linux 下一并加 --disable-dev-shm-usage。 */
function commonFlags() {
  const flags = ['--headless=new', '--no-first-run', '--disable-gpu'];
  const needNoSandbox = process.env.CI || process.env.BROWSER_NO_SANDBOX === '1';
  if (needNoSandbox) flags.push('--no-sandbox', '--disable-setuid-sandbox');
  if (process.platform === 'linux') flags.push('--disable-dev-shm-usage');
  return flags;
}

module.exports = { list, pick, primary, describe, versionOf, commonFlags };

if (require.main === module) {
  const rows = list();
  rows.forEach((b) => {
    console.log(
      `${b.canRun ? '✓' : '·'} ${b.label.padEnd(8)} ` +
      `${(b.present ? (b.version || '已安装') : '未安装').padEnd(20)} ` +
      `${b.kind.padEnd(9)} ${b.reason || ''}`
    );
  });
  const ok = rows.filter((b) => b.canRun);
  console.log(`\n可用于自动化：${ok.length ? ok.map((b) => b.name).join(', ') : '无'}`);
}
