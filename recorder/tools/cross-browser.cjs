/* ============================================================
   cross-browser.cjs — 跨浏览器跑同一套端到端判据
   ------------------------------------------------------------
   做两件事：
     1. 列出本机所有浏览器，明确区分「能自动化」「装了但不能自动化」「没装」
     2. 对每个能自动化的 Chromium 浏览器，各跑一遍
        e2e-check（录音/保存/刷新/删除/导出物/版本自愈）
        browser-check（徽标、按钮、题库注入、file:// 降级）
        然后把结果并成一张矩阵

   诚实边界：Firefox 的 CDP 已被移除，Safari 在 macOS 上且受 W3C WebDriver 限制，
   两者本仓库都没有自动化能力。这里宁可显示「未覆盖 · 原因」，也不拿 Chromium 的绿去冒充。

   用法：node tools/cross-browser.cjs [--only=chrome,edge] [--quick]
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const browsers = require('./browsers.cjs');

const ROOT = path.join(__dirname, '..');
const SITE = path.join(ROOT, '..');
const onlyArg = (process.argv.find((a) => a.startsWith('--only=')) || '').split('=')[1];
const ONLY = onlyArg ? onlyArg.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean) : null;
const QUICK = process.argv.includes('--quick');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function run(cmd, args, opts) {
  const r = spawnSync(cmd, args, Object.assign({ encoding: 'utf8', timeout: 300000 }, opts || {}));
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

/** 从脚本输出里抠出「X 通过 / Y 失败」 */
function parseCounts(text) {
  const m = String(text).match(/(\d+)\s*通过\s*\/\s*(\d+)\s*失败/);
  if (!m) return null;
  return { pass: Number(m[1]), fail: Number(m[2]) };
}

function waitPort(port, ms = 8000) {
  return new Promise((res) => {
    const end = Date.now() + ms;
    const tick = () => {
      const s = require('net').connect(port, '127.0.0.1', () => { s.destroy(); res(true); });
      s.on('error', () => { s.destroy(); if (Date.now() < end) setTimeout(tick, 200); else res(false); });
      s.setTimeout(500, () => { s.destroy(); if (Date.now() < end) setTimeout(tick, 200); else res(false); });
    };
    tick();
  });
}

async function main() {
  const all = browsers.list();
  const runnable = (ONLY ? all.filter((b) => ONLY.indexOf(b.name) >= 0) : all).filter((b) => b.canRun);
  const skipped = all.filter((b) => runnable.indexOf(b) < 0);

  console.log('本机浏览器：');
  all.forEach((b) => {
    console.log(`  ${b.canRun ? '✓' : '·'} ${b.label.padEnd(8)} ${(b.present ? b.version || '已安装' : '未安装').padEnd(18)} ${b.reason || ''}`);
  });
  if (!runnable.length) {
    console.error('\n没有可自动化的浏览器。');
    process.exit(2);
  }

  // 给 browser-check 起一个共用静态服务器（它自己不拉服务）
  const BCPort = 8300;
  const srv = spawn(process.execPath, [path.join(SITE, 'serve.cjs'), String(BCPort)], { cwd: SITE, stdio: 'ignore' });
  await waitPort(BCPort);
  await sleep(400);

  const results = [];
  let i = 0;
  for (const b of runnable) {
    const e2ePort = 8400 + i * 20;
    const bcPort = BCPort; // 共用一个静态服务器即可，每个浏览器访问同一个地址
    console.log(`\n──── ${b.label} ${b.version} ────`);

    console.log(`[1/2] e2e-check（端口 ${e2ePort}）…`);
    const e2e = run(process.execPath, [path.join(ROOT, 'tools', 'e2e-check.cjs'), String(e2ePort), b.name], { cwd: ROOT });
    const e2eCounts = parseCounts(e2e.out);

    let bc = { code: null, out: '' }, bcCounts = null;
    if (!QUICK) {
      console.log(`[2/2] browser-check（端口 ${bcPort}）…`);
      bc = run(process.execPath, [path.join(ROOT, 'tools', 'browser-check.cjs'), String(bcPort), b.name], { cwd: ROOT });
      bcCounts = parseCounts(bc.out);
    }

    // exit 2 = 脚本在跑出任何判据之前就退了（浏览器起不来 / CDP 连不上）。
    // 这不是"产品有问题"，是这台机器上这个浏览器用不了，所以只报「无法启动」不计失败；
    // 真正的断言失败是 exit 1，那一定红。
    const unrunnable = !e2eCounts && e2e.code === 2;
    const ok = !unrunnable && e2e.code === 0 && (QUICK || bc.code === 0);
    results.push({
      browser: b.name, label: b.label, version: b.version,
      e2e: e2eCounts, browserCheck: bcCounts, ok, unrunnable,
      e2eExit: e2e.code, browserCheckExit: bc.code
    });

    console.log(`      e2e ${e2eCounts ? `${e2eCounts.pass} 通过 / ${e2eCounts.fail} 失败` : '未产出计数（exit ' + e2e.code + '）'}` +
      (QUICK ? '' : `；browser-check ${bcCounts ? `${bcCounts.pass} 通过 / ${bcCounts.fail} 失败` : '未产出计数（exit ' + bc.code + '）'}`));

    // 失败的细节留一份，便于追溯
    if (!ok || unrunnable) {
      fs.writeFileSync(path.join(__dirname, `cross-browser-${b.name}.log`), e2e.out + '\n' + bc.out);
      console.log(`      明细已写入 tools/cross-browser-${b.name}.log`);
    }
    if (unrunnable) {
      console.log(`      ⚠ ${b.label} 起不来，已跳过（不计失败）：${b.path || '路径未知'}`);
    }
    i++;
  }

  try { srv.kill(); } catch (e) {}
  if (QUICK) { /* 未启动 browser-check，无需额外清理 */ }

  // ---- 矩阵 ----
  const w = (s, n) => String(s == null ? '—' : s).padEnd(n);
  console.log('\n' + '='.repeat(78));
  console.log(w('浏览器', 20) + w('版本', 18) + w('e2e', 22) + w('browser-check', 22) + '结论');
  console.log('-'.repeat(78));
  results.forEach((r) => {
    const fmt = (c) => (c ? `${c.pass} 通过 / ${c.fail} 失败` : '未跑/未出数');
    const verdict = r.ok ? '✓' : (r.unrunnable ? '⚠ 起不来·已跳过' : '✗');
    console.log(w(r.label, 20) + w(r.version, 18) + w(fmt(r.e2e), 22) + w(QUICK ? '（--quick 跳过）' : fmt(r.browserCheck), 22) + verdict);
  });
  skipped.forEach((b) => {
    console.log(w(b.label, 20) + w(b.version || (b.present ? '已安装' : '未安装'), 18) +
      w('—', 22) + w('—', 22) + '未覆盖');
    if (b.reason) console.log('   └ ' + b.reason);
  });
  console.log('='.repeat(78));

  const passed = results.filter((r) => r.ok);
  const skippedRun = results.filter((r) => r.unrunnable);
  // 一个都没真跑起来 → 不能算通过，否则"浏览器全挂了"会伪装成绿
  const allOk = passed.length > 0 && results.every((r) => r.ok || r.unrunnable);
  console.log(allOk
    ? `全部可自动化浏览器通过（${passed.map((r) => r.label).join(' / ')}）`
      + (skippedRun.length ? `；${skippedRun.map((r) => r.label).join(' / ')} 起不来已跳过` : '')
    : (passed.length === 0
      ? '没有任何浏览器真正跑起来——这不是绿，是环境有问题，见 tools/cross-browser-*.log'
      : '有浏览器未通过，见上表与 tools/cross-browser-*.log'));

  fs.writeFileSync(path.join(__dirname, 'cross-browser-result.json'),
    JSON.stringify({ at: new Date().toISOString(), node: process.version, quick: QUICK, results, skipped }, null, 2));
  process.exit(allOk ? 0 : 1);
}

main().catch((e) => { console.error('跨浏览器运行异常：', e.message); process.exit(2); });
