/* ============================================================
   check-splice.cjs — 长录音切条回归（S1–S8）
   ------------------------------------------------------------
   这一页做的是"把一整段录音切开、逐条对词、写进范本音"。
   它一旦悄悄错位，后果和语言包错位一样：别人的口音被安到另一个词上，
   而且越用越像真的。所以这里不靠肉眼看，全部用**合成音频**跑端到端：

     1. 造一段 3 声、中间有静音的 wav，走真实文件选择器塞进去
     2. 断言切出来就是 3 条（多一条少一条都算错）
     3. 断言「按问法表顺序填」用的真是 data/sheet-order.js 的顺序
     4. 断言入库之后 refs 里真有三条，且能取出来
     5. 合并 / 删除 / 重切 各自改变段数
     6. 没选词时入库按钮是禁用的（不许写空条目）

   用法： node tools/check-splice.cjs [port]
   ============================================================ */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const B = require(path.join(ROOT, 'recorder', 'tools', 'browsers.cjs'));

const PORT = Number(process.argv[2] || 8497);
const DBG = PORT + 10;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
function check(id, desc, ok, detail) {
  ok ? pass++ : fail++;
  console.log(`${ok ? '✓' : '✗'} ${id.padEnd(4)} ${desc}` + (detail ? `\n        ${detail}` : ''));
}

/* 三段 0.7s 的 440Hz，间隔 0.9s 静音，头尾各留 0.4s —— 正好切出 3 条 */
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
  for (let k = 0; k < 3; k++) {
    parts.push(tone(0.7, 320 + k * 90, 9000));
    parts.push(sil(0.9));
  }
  parts.push(sil(0.4));
  const pcm = Buffer.concat(parts);
  const head = Buffer.alloc(44);
  head.write('RIFF', 0); head.writeUInt32LE(36 + pcm.length, 4); head.write('WAVE', 8);
  head.write('fmt ', 12); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20);
  head.writeUInt16LE(1, 22); head.writeUInt32LE(sr, 24); head.writeUInt32LE(sr * 2, 28);
  head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34); head.write('data', 36);
  head.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([head, pcm]);
}

(async () => {
  /* ========== S1 sheet-order.js 本身（静态，不需要浏览器） ========== */
  const sheet = path.join(ROOT, 'data', 'sheet-order.js');
  const sb = { window: {} };
  let order = [];
  if (fs.existsSync(sheet)) {
    vm.runInNewContext(fs.readFileSync(sheet, 'utf8'), sb);
    order = (sb.window.SHEET_ORDER || []);
  }
  const atlasSb = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'data', 'atlas.js'), 'utf8'), atlasSb);
  const ATLAS = atlasSb.window.ATLAS;
  const ids = order.map((o) => o.id);
  const dup = ids.filter((x, i) => ids.indexOf(x) !== i);
  check('S1', 'sheet-order.js 覆盖全部词条、编号 1..N 连续、无重复、第一条是「中午」',
    order.length === ATLAS.words.length && dup.length === 0 &&
    order.every((o, i) => o.no === i + 1) && order[0] && order[0].id === 'shangwu',
    `条数=${order.length}/${ATLAS.words.length} 重复=${JSON.stringify(dup)} 首条=${order[0] && order[0].id}`);

  const srv = spawn(process.execPath, [path.join(ROOT, 'serve.cjs'), String(PORT)], { cwd: ROOT, stdio: 'ignore' });
  await sleep(1000);

  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'ckspl-'));
  const wavPath = path.join(ud, '长录音.wav');
  fs.writeFileSync(wavPath, suite(16000));

  const ch = spawn(B.primary().path, [
    ...B.commonFlags(),
    `--remote-debugging-port=${DBG}`, `--user-data-dir=${ud}`,
    '--autoplay-policy=no-user-gesture-required', '--hide-scrollbars'
  ], { stdio: 'ignore' });

  const getJson = (u) => new Promise((res, rej) => {
    http.get(u, (r) => { let b = ''; r.on('data', (d) => (b += d)); r.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } }); })
      .on('error', rej);
  });

  let ver = null;
  for (let i = 0; i < 60; i++) {
    try { ver = await getJson(`http://127.0.0.1:${DBG}/json/version`); break; } catch (e) { await sleep(300); }
  }
  if (!ver) { console.error('起不来浏览器'); process.exit(2); }

  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0;
  const pend = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
  };
  const send = (method, params, sid) => new Promise((res) => {
    const mid = ++id;
    pend.set(mid, res);
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
    if (r.result && r.result.exceptionDetails) {
      return { __err: (r.result.exceptionDetails.exception || {}).description || 'eval-error' };
    }
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

  try {
    await go(`http://127.0.0.1:${PORT}/splice.html`, 2400);

    /* ========== S2 选文件 → 解码 → 切出 3 条 ========== */
    const picked = await setFile('#file', wavPath);
    await sleep(2600);
    const s2 = await ev(`(()=>{
      const rows=document.querySelectorAll('#segBody tr');
      return {
        info:document.getElementById('fileInfo').textContent,
        wave:document.getElementById('waveInfo').textContent,
        rows:rows.length,
        visible:!document.getElementById('secSegs').hidden,
        saveText:document.getElementById('save').textContent,
        saveDisabled:document.getElementById('save').disabled
      };
    })()`, true);
    check('S2', '整段录音解出来就切成 3 条（多一条少一条都算错），页面进入可对词状态',
      picked && s2 && !s2.__err && s2.rows === 3 && s2.visible === true && /3 条/.test(s2.wave),
      JSON.stringify(s2));
    check('S3', '没选词时入库按钮是禁用的（不许把空条目写进去）',
      s2 && s2.saveDisabled === true && /0 条/.test(s2.saveText || ''),
      s2 && s2.saveText);

    /* ========== S4 按问法表顺序填 ========== */
    const s4 = await ev(`(()=>{
      document.getElementById('fillOrder').click();
      const vals=[...document.querySelectorAll('#segBody select')].map(s=>s.value);
      return { vals, saveText:document.getElementById('save').textContent };
    })()`, true);
    check('S4', '「按问法表顺序填」填的正是 sheet-order 的前三条',
      s4 && !s4.__err && JSON.stringify(s4.vals) === JSON.stringify(ids.slice(0, 3)),
      JSON.stringify(s4 && { got: s4.vals, want: ids.slice(0, 3) }));

    /* ========== S5 逐条试听：点 ▶ 这一行进入播放状态 ========== */
    const s5 = await ev(`(async()=>{
      const b=document.querySelector('#segBody [data-play="0"]');
      b.click();
      await new Promise(r=>setTimeout(r,300));
      const playing=!!document.querySelector('#segBody tr.playing');
      const row=document.querySelector('#segBody tr.playing');
      return { playing, sameRow: row ? row.getAttribute('data-i')==='0' : false };
    })()`, true);
    check('S5', '每条的 ▶ 能就地把这一段放出来（播放行高亮）',
      s5 && !s5.__err && s5.playing === true && s5.sameRow === true,
      JSON.stringify(s5));

    /* ========== S6 入库：refs 真有三条，且能取到 blob ========== */
    const s6 = await ev(`(async()=>{
      document.getElementById('save').click();
      await new Promise(r=>setTimeout(r,2200));
      const R=window.XZ.refs;
      const list=R.list().filter(r=>['shangwu','yelai','ganming'].indexOf(r.id)>=0);
      const got=[];
      for (const id of ['shangwu','yelai','ganming']) {
        try { const u=await R.url(id); got.push(!!u); } catch(e) { got.push(false); }
      }
      return {
        has:R.has('shangwu')&&R.has('yelai')&&R.has('ganming'),
        list:list.map(r=>r.id),
        mime:list.map(r=>r.mime),
        got,
        report:document.getElementById('report').innerText.replace(/\\s+/g,' ').slice(0,120)
      };
    })()`, true);
    check('S6', '写入后 refs 里真有三条，且每条都能取到可播地址（不是"看起来存进去了"）',
      s6 && !s6.__err && s6.has === true && s6.list.length === 3 && s6.got.every(Boolean) &&
      s6.mime.every((m) => m === 'audio/wav'),
      JSON.stringify(s6));

    /* ========== S7 合并 / 删除 改段数 ========== */
    const s7 = await ev(`(()=>{
      const before=document.querySelectorAll('#segBody tr').length;
      document.querySelector('#segBody [data-merge="1"]').click();
      const afterMerge=document.querySelectorAll('#segBody tr').length;
      document.querySelector('#segBody [data-del="0"]').click();
      const afterDel=document.querySelectorAll('#segBody tr').length;
      return { before, afterMerge, afterDel };
    })()`, true);
    check('S7', '「并上一条」少一条、「✕」少一条（切多了能手动救）',
      s7 && !s7.__err && s7.before === 3 && s7.afterMerge === 2 && s7.afterDel === 1,
      JSON.stringify(s7));

    /* ========== S8 重切：最短停顿调大 → 段数变少 ========== */
    const s8 = await ev(`(()=>{
      const recut=()=>document.getElementById('recut').click();
      window.confirm=()=>true;
      const ms=document.getElementById('minSil');
      ms.value='1.05'; recut();
      const loose=document.querySelectorAll('#segBody tr').length;
      ms.value='0.15'; recut();
      const tight=document.querySelectorAll('#segBody tr').length;
      return { loose, tight };
    })()`, true);
    check('S8', '调「最短停顿」真的会重切：松 → 段少，紧 → 段多',
      s8 && !s8.__err && s8.loose < 3 && s8.tight > s8.loose,
      JSON.stringify(s8));

    /* ========== S10 劈开：一整块里念了好几条时唯一的出路 ========== */
    const s10 = await ev(`(()=>{
      const rows=[...document.querySelectorAll('#segBody tr')];
      const before=rows.length;
      const firstDur=parseFloat(rows[0].querySelector('.dur').textContent);
      /* 先给第一条选个词，才能验证"劈开之后词留在前半" */
      const sel0=rows[0].querySelector('select');
      sel0.value='shangwu';
      sel0.dispatchEvent(new Event('change',{bubbles:true}));
      document.querySelector('#segBody [data-split="0"]').click();
      const after=[...document.querySelectorAll('#segBody tr')];
      const d1=parseFloat(after[0].querySelector('.dur').textContent);
      const d2=parseFloat(after[1].querySelector('.dur').textContent);
      const firstSel=after[0].querySelector('select').value;
      const secondSel=after[1].querySelector('select').value;
      return { before, afterN:after.length, firstDur, d1, d2, sum:+(d1+d2).toFixed(1), firstSel, secondSel };
    })()`, true);
    check('S10', '「劈开」把一块分成两块、时长加起来不变，词归前半（后半要重新选）',
      s10 && !s10.__err && s10.afterN === s10.before + 1 &&
      Math.abs(s10.sum - s10.firstDur) < 0.15 && s10.firstSel === 'shangwu' && s10.secondSel === '',
      JSON.stringify(s10));

    /* ========== S9 地图顶栏入口 ========== */
    await go(`http://127.0.0.1:${PORT}/index.html`, 3000);
    const s9 = await ev(`(()=>{
      const a=[...document.querySelectorAll('a.vol-pack')].filter(x=>/splice\\.html/.test(x.getAttribute('href')||''))[0];
      const vis=a&&a.checkVisibility?a.checkVisibility({checkVisibilityCSS:true}):!!a;
      return { exists:!!a, label:a?a.textContent.trim():'', vis:!!vis };
    })()`, true);
    check('S9', '地图顶栏有「切条」入口，指向 splice.html，且真的可见',
      s9 && !s9.__err && s9.exists && /切条/.test(s9.label) && s9.vis === true,
      JSON.stringify(s9));

  } catch (e) {
    fail++;
    console.error('✗ 运行中断：' + (e && e.stack || e));
  }

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  try { ch.kill(); } catch (e) {}
  try { srv.kill(); } catch (e) {}
  process.exit(fail ? 1 : 0);
})();
