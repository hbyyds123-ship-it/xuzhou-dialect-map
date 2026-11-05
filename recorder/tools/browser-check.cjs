/* ============================================================
   browser-check.cjs — 浏览器端验证（CDP，免第三方依赖）
   ------------------------------------------------------------
   用 Chrome 的 DevTools Protocol 直接开页面、读 DOM，不装 Playwright。
   覆盖 A7（file:// 一行报错 + 按钮禁用）、A8（127.0.0.1 一行「环境正常」+ 明细全绿 + 按钮可用），
   以及「0 console error」这一条基础判据。

   用法：node tools/browser-check.cjs [端口] [浏览器]
        浏览器取 chrome / edge …（见 tools/browsers.cjs），默认第一个可用的
   ============================================================ */
'use strict';
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const os = require('os');
const fs = require('fs');
const browsers = require('./browsers.cjs');

const PORT = Number(process.argv[2] || 8123);
// 合并进地图仓库后，采样台在 /recorder/ 下；单独持有本目录时仍在 /。
// 判据不能假定布局——上一轮它就是因为写死 '/' 而一路导航到地图页，
// 于是 A8/B2/B3/B4 全部因布局漂移而变红，看起来像产品回归，其实是脚本没跟上。
const MERGED = fs.existsSync(path.join(__dirname, '..', '..', 'serve.cjs'));
const BASE = `http://127.0.0.1:${PORT}/` + (MERGED ? 'recorder/' : '');
const WANT = String(process.argv[3] || process.env.E2E_BROWSER || '').toLowerCase();
const BROWSER = (WANT && browsers.pick(WANT)) || browsers.primary();
if (!BROWSER) {
  console.error('没有可用的 Chromium 浏览器，先跑 node tools/browsers.cjs');
  process.exit(2);
}
const CHROME = BROWSER.path;

let pass = 0, fail = 0;
function check(id, name, ok, detail) {
  if (ok) pass++; else fail++;
  console.log(`${ok ? '✓' : '✗'} ${id} ${name}${detail ? '  — ' + detail : ''}`);
}

function httpGet(url) {
  return new Promise((res, rej) => {
    http.get(url, (r) => {
      let b = '';
      r.on('data', (d) => (b += d));
      r.on('end', () => res(JSON.parse(b)));
    }).on('error', rej);
  });
}

async function main() {
  if (!CHROME) { console.error('找不到 Chrome/Edge'); process.exit(2); }
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-'));
  const port = 9333;
  const proc = spawn(CHROME, [
    ...browsers.commonFlags(), `--remote-debugging-port=${port}`, `--user-data-dir=${userDir}`,
    '--no-default-browser-check', '--autoplay-policy=no-user-gesture-required', 'about:blank'
  ], { stdio: 'ignore' });

  // 等 CDP 就绪
  let ver = null;
  for (let i = 0; i < 60; i++) {
    try { ver = await httpGet(`http://127.0.0.1:${port}/json/version`); break; }
    catch (e) { await new Promise((r) => setTimeout(r, 400)); }
  }
  if (!ver) { console.error('CDP 未就绪'); proc.kill(); process.exit(2); }

  const ws = ver.webSocketDebuggerUrl;
  const results = await runCdp(ws, BASE);

  try { proc.kill(); } catch (e) {}
  try { fs.rmSync(userDir, { recursive: true, force: true }); } catch (e) {}

  console.log('='.repeat(72));
  console.log(`浏览器端验证结果：${pass} 通过 / ${fail} 失败`);
  console.log('='.repeat(72));
  process.exit(fail ? 1 : 0);
}

/** 极简 CDP 客户端（用内置 WebSocket，Node 22+ 自带） */
async function runCdp(wsUrl, baseUrl) {
  const WebSocket = globalThis.WebSocket;
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  const send = (method, params, sessionId) => new Promise((res) => {
    const mid = ++id;
    pending.set(mid, res);
    ws.send(JSON.stringify({ id: mid, method, params: params || {}, sessionId }));
  });

  // 开新标签
  const t = await send('Target.createTarget', { url: 'about:blank' });
  const at = await send('Target.attachToTarget', { targetId: t.result.targetId, flatten: true });
  const sid = at.result.sessionId;

  const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sid);
    if (r.result && r.result.exceptionDetails) return { error: r.result.exceptionDetails.text };
    return { value: r.result && r.result.result ? r.result.result.value : undefined };
  };

  const out = {};
  for (const [tag, url] of [['http', baseUrl], ['file', 'file:///' + path.join(__dirname, '..', 'index.html').replace(/\\/g, '/')]]) {
    await send('Page.enable', {}, sid);
    await send('Runtime.enable', {}, sid);
    await send('Log.enable', {}, sid);
    const errors = [];
    // favicon.ico 的 404 是浏览器自动请求，与页面代码无关 —— 排除掉
    // （favicon 出现在 entry.url 里，不在 entry.text 里）
    const isIrrelevant = (text, url) => /favicon/i.test(text || '') || /favicon/i.test(url || '');
    // 每次导航前清空上一轮的累积，避免把上一标签页的错误算到这一轮
    const onMsg = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.method === 'Runtime.exceptionThrown' && !isIrrelevant(m.params.exceptionDetails.text))
        errors.push(m.params.exceptionDetails.text);
      if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error'
          && !isIrrelevant(m.params.entry.text, m.params.entry.url))
        errors.push(m.params.entry.text + ' @ ' + (m.params.entry.url || ''));
    };
    ws.addEventListener('message', onMsg);
    await send('Page.navigate', { url }, sid);
    await new Promise((r) => setTimeout(r, 2500));
    ws.removeEventListener('message', onMsg);
    const probe = await evalJs(`(()=>{
      const chks=[...document.querySelectorAll('#selfcheck .chk')];
      const line=(document.querySelector('#selfcheck .chk-line')||{}).textContent||'';
      return {
        line: line.trim(),
        badges: chks.length,
        ok: chks.filter(c=>c.classList.contains('ok')).length,
        bad: chks.filter(c=>c.classList.contains('bad')).length,
        texts: chks.map(c=>c.textContent.trim()),
        recDisabled: document.getElementById('recBtn') ? document.getElementById('recBtn').disabled : null,
        consentOn: document.getElementById('consent') ? document.getElementById('consent').classList.contains('on') : null,
        hasSaying: !!document.getElementById('fSaying'),
        hasStrategy: !!document.getElementById('fStrategy'),
        promptCount: (window.PROMPTS||[]).length,
        atlasCount: (window.PROMPTS||[]).filter(p=>p.bucket==='atlas').length,
        meta: window.PROMPTS_META || null,
        banner: document.getElementById('banner') ? document.getElementById('banner').textContent.trim() : null
      };
    })()`);
    out[tag] = { probe: probe.value, errors };
  }

  // ── 判定 ────────────────────────────────────────────────
  const h = out.http.probe, f = out.file.probe;
  // 徽标个数不写死：不同浏览器能提供的 API 不同（例如没有 OfflineAudioContext 的就会多一个红徽标），
  // 真正要守的是「在这台机器的这个浏览器下，127.0.0.1 打开时不该有红徽标」。
  check('A8', '127.0.0.1 下首屏一行「环境正常」、明细全绿、录音按钮可用',
    !!h && h.badges >= 6 && h.ok === h.badges && h.recDisabled === false && /环境正常/.test(h.line || ''),
    h ? `首屏「${h.line}」，明细 ${h.ok}/${h.badges} 绿，录音按钮禁用=${h.recDisabled}` : '页面未加载');
  check('A7', 'file:// 下运行环境徽标为红、录音按钮禁用',
    f && f.bad >= 1 && f.recDisabled === true,
    f ? `红徽标 ${f.bad} 个，按钮禁用=${f.recDisabled}（${f.texts[0] || ''}）` : '页面未加载');
  const hb = (h && h.banner) || '', fb = (f && f.banner) || '';
  check('B1', '两种加载方式下均无脚本错误（console 之外还看 #banner，因为异常会被产品自己吞进 banner）',
    out.http.errors.length === 0 && out.file.errors.length === 0 && !/出错|失败/.test(hb),
    `http=${out.http.errors.length} 处，file=${out.file.errors.length} 处，http banner="${hb || '空'}"`);
  // 不写死题量：只要求"派生条数与 atlas.words 自洽"，改题不会误红
  const m = h && h.meta;
  const derived = !m || m.atlasSkipped
    ? (h && h.promptCount >= 42 && h.atlasCount === 0)
    : (m.atlasAdded + m.atlasMerged === m.atlasTotal && h.atlasCount === m.atlasAdded && h.promptCount > m.atlasAdded);
  check('B2', '题库注入正常，且词表派生条数与 atlas.words 自洽',
    !!derived,
    h ? `PROMPTS=${h.promptCount}，其中词表派生 ${h.atlasCount} 条；meta=${m ? JSON.stringify(m) : '无（atlas.js 未加载）'}` : '');
  check('B3', '说法 / 策略字段已就位',
    h && h.hasSaying && h.hasStrategy, h ? `说法字段=${h.hasSaying} 策略字段=${h.hasStrategy}` : '');
  check('B4', '知情同意弹层首次打开出现',
    h && h.consentOn === true, h ? `consent.on=${h.consentOn}` : '');

  return out;
}

main().catch((e) => { console.error(e); process.exit(2); });
