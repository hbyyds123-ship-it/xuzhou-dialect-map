/* ============================================================
   demo-check.cjs — 演示包：换机器/换浏览器还能不能演
   ------------------------------------------------------------
   为什么要有这个文件：录音只活在 IndexedDB 里，换一台机器、换一个浏览器、
   清了站点数据，地图里就一条也放不出来。演示包（导出一份含 base64 的 JSON、
   在演示机上导回去）就是为这件事存在的 —— 没有判据，它坏掉没人知道。

   判据用真实录音（假麦克风灌 180Hz），不是构造的假记录：
   走完"录一条 → 导出演示包 → 清空 → 导入 → 地图能播"整条链。

   用法：node tools/demo-check.cjs [port] [browser]
   ============================================================ */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const B = require('./browsers.cjs');

const PORT = Number(process.argv[2] || 8501);
const DBG = PORT + 10;
const ROOT = path.join(__dirname, '..');
const SITE = path.join(ROOT, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
let fail = 0;
const check = (id, desc, ok, detail) => {
  ok ? pass++ : fail++;
  console.log(`${ok ? '✓' : '✗'} ${id.padEnd(4)} ${desc}` + (detail ? `\n        ${detail}` : ''));
};

function wavBuf(freq, secs, sr) {
  const n = Math.round(secs * sr);
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22); b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin(2 * Math.PI * freq * i / sr) * 12000), 44 + i * 2);
  return b;
}

(async () => {
  const mic = path.join(os.tmpdir(), 'demo-mic-180hz.wav');
  fs.writeFileSync(mic, wavBuf(180, 4, 48000));

  const srv = spawn(process.execPath, [path.join(SITE, 'serve.cjs'), String(PORT)], { cwd: SITE, stdio: 'ignore' });
  await sleep(1000);

  const browser = (process.argv[3] && B.pick(process.argv[3])) || B.primary();
  if (!browser) { console.error('没有可用的 Chromium'); process.exit(2); }

  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-'));
  const ch = spawn(browser.path, [
    ...B.commonFlags(),
    `--remote-debugging-port=${DBG}`, `--user-data-dir=${ud}`,
    '--autoplay-policy=no-user-gesture-required',
    '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
    `--use-file-for-fake-audio-capture=${mic}`, '--hide-scrollbars'
  ], { stdio: 'ignore' });

  const getJson = (u) => new Promise((res, rej) => {
    http.get(u, (r) => { let b = ''; r.on('data', (d) => (b += d)); r.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } }); })
      .on('error', rej);
  });

  let ver = null;
  for (let i = 0; i < 60; i++) {
    try { ver = await getJson(`http://127.0.0.1:${DBG}/json/version`); break; } catch (e) { await sleep(300); }
  }
  if (!ver) { console.error('浏览器起不来'); process.exit(2); }

  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0;
  const pend = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
  };
  const send = (method, params, sid) => new Promise((res) => {
    const mid = ++id; pend.set(mid, res);
    ws.send(JSON.stringify({ id: mid, method, params: params || {}, sessionId: sid }));
  });

  const t = await send('Target.createTarget', { url: 'about:blank' });
  const at = await send('Target.attachToTarget', { targetId: t.result.targetId, flatten: true });
  const sid = at.result.sessionId;
  await send('Page.enable', {}, sid);
  await send('Runtime.enable', {}, sid);
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false }, sid);

  const ev = async (expr, gesture) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, userGesture: !!gesture }, sid);
    if (r.result && r.result.exceptionDetails) return { __err: (r.result.exceptionDetails.exception || {}).description || 'eval-error' };
    return r.result.result && r.result.result.value;
  };
  const go = async (url, wait) => { await send('Page.navigate', { url }, sid); await sleep(wait || 2400); };

  try {
    /* 干净起点 */
    await go(`http://127.0.0.1:${PORT}/recorder/`, 2400);
    await ev(`(document.getElementById('consentOk')||{click(){}}).click()`);
    await sleep(200);
    await ev(`(async()=>{ await __probe.store.clear(); localStorage.removeItem('xzdt.sample.v1'); return 1 })()`, true);
    await go(`http://127.0.0.1:${PORT}/recorder/`, 2200);
    await ev(`(document.getElementById('consentOk')||{click(){}}).click()`);
    await sleep(200);

    /* D0 界面入口在，且看得见 */
    const ui = await ev(`(()=>{
      const vis=el=>!!(el&&el.checkVisibility&&el.checkVisibility({checkVisibilityCSS:true}));
      const a=document.getElementById('demoExport'), b=document.getElementById('demoImport');
      return {a:!!a&&vis(a), b:!!b&&vis(b), label:(a?a.textContent:'')+' / '+(b?b.textContent:'')};
    })()`);
    check('D0', '采录页有「导出演示包 / 导入演示包」，且可见', ui && ui.a && ui.b, JSON.stringify(ui));

    /* 真录一条（假麦克风），拿到合法 promptId/atlasId */
    const rec = await ev(`(async()=>{
      const mm=/(?:^|[#&])p=([^&]+)/.exec('#p=maozi'); 
      const p=document.getElementById('promptText');
      return p?p.textContent.trim():'';
    })()`, true);
    await go(`http://127.0.0.1:${PORT}/recorder/#p=maozi`, 2200);
    await ev(`(document.getElementById('consentOk')||{click(){}}).click()`);
    await sleep(200);
    const word = await ev(`(document.getElementById('promptText')||{}).textContent.trim()`);
    await ev(`document.getElementById('recBtn').click()`, true);
    await sleep(3200);
    await ev(`document.getElementById('recBtn').click()`, true);
    let shown = false;
    for (let i = 0; i < 40; i++) {
      if (await ev(`document.getElementById('resultRow').style.display === 'block'`)) { shown = true; break; }
      await sleep(400);
    }
    await ev(`(()=>{const s=document.getElementById('fSaying'); s.value='洋柿子'; s.dispatchEvent(new Event('input',{bubbles:true}));
      const w=document.getElementById('fSpeaker'); w.value='我妈'; w.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await ev(`document.getElementById('saveBtn').click()`, true);
    await sleep(1400);
    const saved = await ev(`(()=>{ const j=JSON.parse(localStorage.getItem('xzdt.sample.v1')||'{}');
      return {words:Object.keys(j.words||{}), list:document.querySelectorAll('#list [data-del]').length} })()`);
    check('D1', '先真录一条（演示包的起点）', shown && saved && saved.list === 1 && (saved.words || []).includes('maozi'),
      `题目「${word}」；列表 ${saved && saved.list} 条；索引键 ${JSON.stringify(saved && saved.words)}`);

    /* D2 导出演示包：有音频、有卷名 */
    const pack = await ev(`(async()=>{
      const d=await __probe.exportDemo();
      const c=d.clips[0]||{};
      return {format:d.format, n:d.clips.length, vol:d.volumeName, no:d.volumeNo,
        atlasId:c.atlasId, text:c.text, saying:c.saying,
        b64:(c.data||'').length, mime:c.mime, hasBlob:('blob' in c)};
    })()`, true);
    check('D2', '导出演示包：音频以 base64 带出、卷名与词都在、不夹带 blob 对象',
      pack && !pack.__err && pack.format === 'xiangyince-demo/1' && pack.n === 1 &&
        pack.b64 > 2000 && pack.atlasId === 'maozi' && pack.hasBlob === false,
      JSON.stringify(pack));

    const docJson = await ev(`(async()=>JSON.stringify(await __probe.exportDemo()))()`, true);

    /* D3 清空后确实没了（证明后面不是"本来就还在"） */
    await ev(`(async()=>{ await __probe.store.clear(); localStorage.removeItem('xzdt.sample.v1'); return 1 })()`, true);
    await go(`http://127.0.0.1:${PORT}/recorder/`, 2200);
    await ev(`(document.getElementById('consentOk')||{click(){}}).click()`);
    const empty = await ev(`({list:document.querySelectorAll('#list [data-del]').length,
      idx:(()=>{try{return Object.keys((JSON.parse(localStorage.getItem('xzdt.sample.v1')||'{}').words)||{})}catch(e){return []}})()})`);
    check('D3', '清空后录音与索引都没了（导入才有意义）', empty && empty.list === 0 && (empty.idx || []).length === 0, JSON.stringify(empty));

    /* D4 导入演示包 */
    const imp = await ev(`(async()=>{
      const doc=JSON.parse(${JSON.stringify(docJson)});
      const r=await __probe.importDemo(doc);
      return r;
    })()`, true);
    check('D4', '导入演示包：条数对、无未对上、写入索引',
      imp && !imp.__err && imp.ok && imp.count === 1 && imp.unmatched === 0,
      JSON.stringify(imp));

    const after = await ev(`(()=>{ const j=JSON.parse(localStorage.getItem('xzdt.sample.v1')||'{}');
      return {list:document.querySelectorAll('#list [data-del]').length,
        clip:(j.words&&j.words.maozi&&j.words.maozi.clipId)||'', saying:(j.words&&j.words.maozi&&j.words.maozi.saying)||''} })()`);
    check('D5', '导入后列表恢复、索引指向新 clipId、说法还在',
      after && after.list === 1 && /maozi-\d+$/.test(after.clip) && after.saying === '洋柿子',
      JSON.stringify(after));

    /* D6 演示真正要的那一步：地图里能播 */
    await go(`http://127.0.0.1:${PORT}/index.html`, 3200);
    const played = await ev(`(async()=>{
      const S=window.XZ&&window.XZ.sample;
      if(!S) return {err:'no-sample'};
      const has=S.has('maozi');
      let ok=null;
      try { ok = await S.play('maozi'); } catch(e){ ok='ERR:'+e.message; }
      return {has, ok};
    })()`, true);
    check('D6', '换到地图页：词条面板能播导入的录音', played && played.has === true && played.ok === true,
      JSON.stringify(played));

    console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  } catch (e) {
    console.error('崩溃：', (e && e.stack) || e);
    fail++;
  } finally {
    try { ws.close(); } catch (e) {}
    try { ch.kill(); } catch (e) {}
    try { srv.kill(); } catch (e) {}
  }
  process.exit(fail ? 1 : 0);
})();
