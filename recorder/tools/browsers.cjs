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

const CANDIDATES = [
  {
    name: 'chrome', label: 'Chrome', kind: 'chromium',
    paths: [
      'C:/Program Files/Google/Chrome/Application/chrome.exe',
      'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
      path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe')
    ]
  },
  {
    name: 'edge', label: 'Edge', kind: 'chromium',
    paths: [
      'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
      'C:/Program Files/Microsoft/Edge/Application/msedge.exe'
    ]
  },
  {
    name: 'brave', label: 'Brave', kind: 'chromium',
    paths: ['C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe']
  },
  {
    name: 'firefox', label: 'Firefox', kind: 'gecko',
    note: 'CDP 已移除，需要 geckodriver + WebDriver；本仓库的自动化暂不支持，仅做人工验证',
    paths: [
      'C:/Program Files/Mozilla Firefox/firefox.exe',
      'C:/Program Files (x86)/Mozilla Firefox/firefox.exe'
    ]
  },
  {
    name: 'safari', label: 'Safari', kind: 'webkit',
    note: '仅 macOS；本仓库的自动化不支持，靠功能探测 + 降级路径覆盖',
    paths: []
  }
];

/** 读 Windows 可执行文件版本号；读不到就返回 ''（不阻断探测） */
function versionOf(exe) {
  try {
    const out = execFileSync('powershell', [
      '-NoProfile', '-NonInteractive', '-Command',
      `(Get-Item '${exe.replace(/'/g, "''")}').VersionInfo.ProductVersion`
    ], { encoding: 'utf8', timeout: 8000, stdio: ['ignore', 'pipe', 'ignore'] });
    return String(out).trim();
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

module.exports = { list, pick, primary, describe, versionOf };

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
