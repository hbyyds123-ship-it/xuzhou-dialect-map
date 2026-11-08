/* ============================================================
   check-demo-file.cjs — 「导入演示包」这扇门能不能接住一段录音
   ------------------------------------------------------------
   用户现场事故：D 盘 11 文件夹里明明有 新录音 5(1).m4a，点采录页
   「导入演示包」，文件对话框里却什么都没有。根因是 accept 只写 .json，
   系统把 m4a 过滤了；就算硬塞进去，程序也拿 JSON.parse 去读二进制
   （报 "ftypM4… 不是合法 JSON"）。这一套判据盯的就是这两件事：

     DF1 文件对话框里看得见 .m4a（静态查 accept，不靠肉眼）
     DF2 采录页真的加载了递件库、能分清音频和清单
     DF3 误选整段录音 → 常驻说明 + 「去切条」，绝不再报「不是合法 JSON」
     DF4 文件真的暂存进了 inbox（不是只写了一句提示）
     DF5 点「去切条」→ 切条页自动加载、解出条目、inbox 取走即删
     DF6 正门「导入一段录音」→ 自动跳切条页，不用再找一遍文件
     DF7 .json 演示包这条路没被改坏（真导入一条 → banner 报条数）
     DF8 递件失败时给得出人能照做的退路（不静默）

   用法： node tools/check-demo-file.cjs [port] [--real D:/11/新录音.m4a]
   --real 用真人录音跑 DF3/DF5/DF6，段数只要求 > 0（本机验证用，CI 不传）
   ============================================================ */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const B = require(path.join(ROOT, 'recorder', 'tools', 'browsers.cjs'));

const argv = process.argv.slice(2);
const ri = argv.indexOf('--real');
const REAL = ri >= 0 ? argv[ri + 1] : null;
const PORT = Number(argv[0] || 8499);
const DBG = PORT + 10;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
function check(id, desc, ok, detail) {
  ok ? pass++ : fail++;
  console.log(`${ok ? '✓' : '✗'} ${id.padEnd(4)} ${desc}` + (detail ? `\n        ${detail}` : ''));
}

/* 三段 0.7s 的纯音 + 0.9s 静音：切条页必定解出 3 条 */
function suite(sr) {
  sr = sr || 16000;
  const parts = [];
  const sil = (sec) => Buffer.alloc(Math.round(sec * sr) * 2);
  const tone = (sec, freq, amp) => {
    const n = Math.round(sec * sr);
    const b = Buffer.alloc(n * 2);
    for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin(2 * Math.PI * freq * i / sr) * amp), i * 2);
    return b;
  };
  parts.push(sil(0.4));
  for (let k = 0; k < 3; k++) { parts.push(tone(0.7, 320 + k * 90, 9000)); parts.push(sil(0.9)); }
  parts.push(sil(0.4));
  const pcm = Buffer.concat(parts);
  const head = Buffer.alloc(44);
  head.write('RIFF', 0); head.writeUInt32LE(36 + pcm.length, 4); head.write('WAVE', 8);
  head.write('fmt ', 12); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20);
  head.writeUInt16LE(1, 22); head.writeUInt32LE(sr, 24); head.writeUInt32LE(sr * 2, 28);
  head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34);
  head.write('data', 36); head.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([head, pcm]);
}

/* 一份最小合法演示包：走 __probe.importDemo 同一条路，不绕过界面 */
function demoDoc(buf) {
  return {
    format: 'xiangyince-demo/1', exportedAt: new Date().toISOString(),
    volumeNo: 1, volumeName: '测试卷',
    clips: [{ id: 'df1', text: '中午', atlasId: 'shangwu', mime: 'audio/wav', data: buf.toString('base64') }]
  };
}

(async () => {
  /* ========== DF1 静态：accept 不能再只收 .json ========== */
  const html = fs.readFileSync(path.join(ROOT, 'recorder', 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(ROOT, 'recorder', 'app.js'), 'utf8');
  const demoAccept = (html.match(/id="demoFile"[^>]*accept="([^"]+)"/) || [])[1] || '';
  const audioAccept = (html.match(/id="audioFile"[^>]*accept="([^"]+)"/) || [])[1] || '';
  check('DF1', '「导入演示包」对话框看得见 .m4a；另有独立的「导入一段录音」入口',
    /\.m4a/.test(demoAccept) && /audio\/\*/.test(demoAccept) &&
    /\.m4a/.test(audioAccept) && /id="audioImport"/.test(html) &&
    /features\/inbox\.js/.test(html) && /id="demoHint"/.test(html),
    `demoFile=[${demoAccept}] audioFile=[${audioAccept}]`);

  const srv = spawn(process.execPath, [path.join(ROOT, 'serve.cjs'), String(PORT)], { cwd: ROOT, stdio: 'ignore' });
  await sleep(1000);

  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'ckdf-'));
  const wavPath = REAL || path.join(ud, '一整段录音.wav');
  if (!REAL) fs.writeFileSync(wavPath, suite(16000));
  const jsonPath = path.join(ud, '演示包-测试.json');
  fs.writeFileSync(jsonPath, JSON.stringify(demoDoc(suite(16000))));

  const browser = B.primary();
  if (!browser) { console.error('没有可用的 Chromium'); process.exit(2); }
  const ch = spawn(browser.path, [
    ...B.commonFlags(),
    `--remote-debugging-port=${DBG}`, `--user-data-dir=${ud}`,
    '--autoplay-policy=no-user-gesture-required', '--hide-scrollbars'
  ], { stdio: 'ignore' });

  const getJson = (u) => new Promise((res, rej) => {
    http.get(u, (r) => { let b = ''; r.on('data', (d) => (b += d)); r.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } }); }).on('error', rej);
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
  for (const m of ['Page.enable', 'Runtime.enable', 'DOM.enable']) await send(m, {}, sid);
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false }, sid);

  const ev = async (expr, gesture) => {
    const r = await send('Runtime.evaluate', {
      expression: expr, returnByValue: true, awaitPromise: true, userGesture: !!gesture
    }, sid);
    if (r.result && r.result.exceptionDetails) return { __err: (r.result.exceptionDetails.exception || {}).description || 'eval-error' };
    return r.result.result && r.result.result.value;
  };
  const go = async (url, wait) => { await send('Page.navigate', { url }, sid); await sleep(wait || 2200); };
  const setFile = async (selector, file) => {
    const doc = await send('DOM.getDocument', {}, sid);
    const q = await send('DOM.querySelector', { nodeId: doc.result.root.nodeId, selector }, sid);
    if (!q.result || !q.result.nodeId) return false;
    await send('DOM.setFileInputFiles', { files: [file], nodeId: q.result.nodeId }, sid);
    return true;
  };
  const REC = `http://127.0.0.1:${PORT}/recorder/`;
  const wantSegs = REAL ? 1 : 3;   // 真人录音只要求切出东西，合成音必须正好 3 条

  try {
    await go(REC, 2400);

    /* ========== DF2 采录页的递件库与音频判别 ========== */
    const d2 = await ev(`(()=>{ const p=window.__probe||{};
      return { inbox: !!(window.XZ && window.XZ.inbox),
        fn: typeof p.isAudioFile,
        m4a: p.isAudioFile && p.isAudioFile({name:'新录音 5(1).m4a',type:''}),
        json: p.isAudioFile && p.isAudioFile({name:'清单.json',type:'application/json'}),
        lnk: p.isAudioFile && p.isAudioFile({name:'快捷方式.lnk',type:''}) }; })()`);
    check('DF2', '采录页加载了递件库；m4a 认成音频，.json / .lnk 不认',
      d2 && !d2.__err && d2.inbox === true && d2.fn === 'function' &&
      d2.m4a === true && d2.json === false && d2.lnk === false, JSON.stringify(d2));

    /* ========== DF3 误把整段录音选进「导入演示包」 ========== */
    const picked = await setFile('#demoFile', wavPath);
    await sleep(REAL ? 1500 : 900);
    const d3 = await ev(`(()=>{ const h=document.getElementById('demoHint');
      return { hint:h && !h.hidden ? h.textContent : '',
        link:!!(h && h.querySelector('a[href="../splice.html"]')),
        banner:(document.getElementById('banner')||{}).textContent||'' }; })()`);
    check('DF3', '误选录音：给常驻说明 +「去切条」，不再拿 JSON.parse 去读二进制',
      picked && d3 && !d3.__err && d3.link === true &&
      /不是演示包/.test(d3.hint) && !/不是合法的 JSON/.test(d3.banner),
      JSON.stringify(d3 && { hint: (d3.hint || '').slice(0, 110), banner: (d3.banner || '').slice(0, 110) }));

    /* ========== DF4 文件真的进了递件库（取出来再放回去给 DF5 用） ========== */
    const d4 = await ev(`(async()=>{ const f=await window.XZ.inbox.take();
      if(!f) return {got:false};
      const name=f.name, size=f.size;
      await window.XZ.inbox.put(f);           // 放回，留给下一步的切条页
      return {got:true,name,size,back:await (async()=>{const g=await window.XZ.inbox.take();
        await window.XZ.inbox.put(g); return !!(g&&g.name===name);})()}; })()`, true);
    check('DF4', '文件暂存进 inbox 且名字/大小没丢（取走即删，随即放回）',
      d4 && !d4.__err && d4.got === true && d4.size > 0 &&
      /录音|m4a|wav/i.test(d4.name || '') && d4.back === true, JSON.stringify(d4));

    /* ========== DF5 点「去切条」→ 切条页自己把文件打开 ========== */
    await ev(`document.querySelector('#demoHint a').click()`, true);
    await sleep(REAL ? 9000 : 2800);
    const d5 = await ev(`(()=>({ url:location.pathname,
      info:(document.getElementById('fileInfo')||{}).textContent||'',
      rows:document.querySelectorAll('#segBody tr').length,
      wave:(document.getElementById('waveInfo')||{}).textContent||'' }))()`);
    check('DF5', '「去切条」直接把那段录音解出来，不需要再选一次文件',
      d5 && !d5.__err && /splice\.html/.test(d5.url) &&
      /带过来的/.test(d5.info) && d5.rows >= wantSegs,
      JSON.stringify(d5));
    const d5b = await ev(`(async()=>{const f=await window.XZ.inbox.take();return {empty:!f};})()`, true);
    check('DF5b', '切条页取走后 inbox 清空（录音不在没人知道的地方留副本）',
      d5b && d5b.empty === true, JSON.stringify(d5b));

    /* ========== DF6 正门「导入一段录音」→ 自动跳切条页 ========== */
    await go(REC, 2200);
    const p6 = await setFile('#audioFile', wavPath);
    await sleep(REAL ? 11000 : 3600);
    const d6 = await ev(`(()=>({ url:location.pathname,
      info:(document.getElementById('fileInfo')||{}).textContent||'',
      rows:document.querySelectorAll('#segBody tr').length }))()`);
    check('DF6', '「导入一段录音」选中即跳切条页，文件自动就位',
      p6 && d6 && !d6.__err && /splice\.html/.test(d6.url) &&
      /带过来的/.test(d6.info) && d6.rows >= wantSegs, JSON.stringify(d6));

    /* ========== DF7 .json 演示包这条老路没被改坏 ========== */
    await go(REC, 2200);
    const p7 = await setFile('#demoFile', jsonPath);
    await sleep(1400);
    /* 判据只盯 banner（真实结果），不盯新加的 #demoHint：
       这条是老路回归，改前版本也该绿；写成「新 DOM 存在」会把回归用例变成摆设。 */
    const d7 = await ev(`(()=>({ banner:(document.getElementById('banner')||{}).textContent||'' }))()`);
    check('DF7', '真正的 .json 演示包照旧导入成功（改前版本也该过）',
      p7 && d7 && !d7.__err && /已导入 [1-9]\d* 条录音/.test(d7.banner) &&
      !/导入失败/.test(d7.banner), JSON.stringify(d7));

    /* ========== DF8 递件库不可用时，给得出人能照做的退路 ========== */
    const d8 = await ev(`(async()=>{
      const bak=window.XZ && window.XZ.inbox;
      if(window.XZ) window.XZ.inbox=null;
      const inp=document.getElementById('demoFile');
      const dt=new DataTransfer();
      dt.items.add(new File([new Uint8Array([0,1,2,3])],'退路测试.wav',{type:'audio/wav'}));
      inp.files=dt.files; inp.dispatchEvent(new Event('change',{bubbles:true}));
      await new Promise(r=>setTimeout(r,350));
      const msg=(document.getElementById('banner')||{}).textContent||'';
      if(window.XZ) window.XZ.inbox=bak;
      return {msg}; })()`, true);
    check('DF8', '递不了件时明说「从顶栏打开切条，再选一次文件」，不静默',
      d8 && !d8.__err && /没能递给切条页/.test(d8.msg) && /再选一次文件/.test(d8.msg),
      JSON.stringify(d8));

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
