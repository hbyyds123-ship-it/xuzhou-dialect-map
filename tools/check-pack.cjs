/* ============================================================
   check-pack.cjs — 语言包回归（P1–P12）
   ------------------------------------------------------------
   为什么要有这个文件：语言包是"请别人录音"这条链路的唯一交接物。
   它一旦悄悄错位（把 03 号的声音放进 02 号的词），
   错的不是界面，是别人一辈子的口音被安到了另一个词上，而且没人看得出来。
   所以这里重点验三件事：
     1. 配对四种策略各自在什么条件下生效（而且要能说出用了哪一种）
     2. 导入报告与实际落库一致（新增/跳过/缺失/多余）
     3. 音频真的能播（带 type 的 Blob，不是"看起来存进去了"）

   判据只盯行为与状态，不盯文案；唯一两处文案断言（"演示包"、"已有范本音"）
   验的正是"说清楚为什么"这件事本身。

   用法： node tools/check-pack.cjs [port]
   依赖：本机 Chrome（复用 recorder/tools/browsers.cjs）、Node >= 22
   ============================================================ */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const B = require(path.join(ROOT, 'recorder', 'tools', 'browsers.cjs'));

const PORT = Number(process.argv[2] || 8493);
const DBG = PORT + 10;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
let fail = 0;
function check(id, desc, ok, detail) {
  ok ? pass++ : fail++;
  console.log(`${ok ? '✓' : '✗'} ${id.padEnd(5)} ${desc}` + (detail ? `\n        ${detail}` : ''));
}

/* 0.4 秒 300Hz 的 wav —— 只为造一段能播的音频 */
function wavBuf(freq, secs, sr) {
  const n = Math.round(secs * sr);
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22); b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin(2 * Math.PI * freq * i / sr) * 9000), 44 + i * 2);
  return b;
}

(async () => {
  const srv = spawn(process.execPath, [path.join(ROOT, 'serve.cjs'), String(PORT)], { cwd: ROOT, stdio: 'ignore' });
  await sleep(1000);

  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'ckpack-'));
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
  await send('Page.enable', {}, sid);
  await send('Runtime.enable', {}, sid);
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 980, deviceScaleFactor: 1, mobile: false }, sid);

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
  const B64 = wavBuf(300, 0.4, 16000).toString('base64');

  try {
    /* ========== 页面：建包与念稿单（P1/P2） ========== */
    await go(`http://127.0.0.1:${PORT}/pack.html`, 2400);

    const p1 = await ev(`(()=>{
      const P=window.XZ.pack;
      const words=P.currentWords();
      const doc=P.buildPack({speaker:{name:'王秀兰',birthYear:1950,hometown:'沛县张寨',years:60},words:words});
      const rows=document.querySelectorAll('.sh-tab tbody tr');
      return {
        words:words.length, items:doc.items.length, rows:rows.length,
        firstNo:doc.items[0]&&doc.items[0].no, firstFile:doc.items[0]&&doc.items[0].file,
        lastNo:doc.items[doc.items.length-1]&&doc.items[doc.items.length-1].no,
        firstWord:doc.items[0]&&doc.items[0].word,
        hasId:doc.items.every(i=>!!i.wordId),
        fmt:doc.format, sheet:!!document.querySelector('.sheet'),
        row0:(rows[0]?rows[0].innerText:'').replace(/\\s+/g,' ').trim()
      };
    })()`, true);
    check('P1', '开包：条目数=卷内词数、编号 01…N 连续、每条都有 wordId、清单自带建议文件名',
      p1 && !p1.__err && p1.items === p1.words && p1.items > 0 &&
      p1.firstNo === 1 && p1.lastNo === p1.items && p1.firstFile === '01.m4a' && p1.hasId && p1.fmt === 'xiangyince-pack/1',
      JSON.stringify(p1 && { ...p1, firstWord: undefined }));

    check('P2', '念稿单：渲染出与条目同数量的行，第一行带编号与该词',
      p2ok(p1),
      `行数=${p1 && p1.rows} 条目=${p1 && p1.items} 首行「${p1 && p1.row0}」`);

    function p2ok(x) {
      return !!(x && !x.__err && x.sheet && x.rows === x.items && x.items > 0 &&
        x.row0.indexOf('01') === 0 && x.firstWord && x.row0.indexOf(x.firstWord) > 0);
    }

    /* ========== 纯函数：编号识别（P3） ========== */
    const p3 = await ev(`(()=>{
      const n=window.XZ.pack.numberOf;
      return {
        a:n('01.m4a'), b:n('新录音 1.m4a'), c:n('wx_camera_1699123456789.m4a'),
        d:n('录音_02.m4a'), e:n('03-一崩子.m4a'), f:n('一崩子.m4a'), g:n('010.mp3')
      };
    })()`, true);
    check('P3', '文件名编号：认 01 / 新录音 1 / 录音_02 / 03-词 / 010，不把13位时间戳当编号，无数字给 0',
      p3 && !p3.__err && p3.a === 1 && p3.b === 1 && p3.c === 0 && p3.d === 2 && p3.e === 3 && p3.f === 0 && p3.g === 10,
      JSON.stringify(p3));

    /* ========== 纯函数：四种配对（P4/P5/P6） ========== */
    const p4 = await ev(`(()=>{
      const P=window.XZ.pack;
      const doc={format:P.format,items:[
        {no:1,wordId:'w1',word:'一'},{no:2,wordId:'w2',word:'二'},{no:3,wordId:'w3',word:'三'}]};
      const r=P.pairFiles(doc,[{name:'03.m4a'},{name:'01.m4a'},{name:'02.m4a'}]);
      return {
        n:r.pairs.length,
        order:r.pairs.map(p=>p.item.no+':'+p.file.name+':'+p.how).join(','),
        missing:r.missing.length, extra:r.extra.length, orderUsed:r.orderUsed
      };
    })()`, true);
    check('P4', '编号配对：乱序的 03/01/02 各归其位，标记为「按编号」，不误用顺序兜底',
      p4 && !p4.__err && p4.n === 3 &&
      p4.order === '1:01.m4a:按编号,2:02.m4a:按编号,3:03.m4a:按编号' &&
      p4.missing === 0 && p4.extra === 0 && p4.orderUsed === false,
      JSON.stringify(p4));

    const p5 = await ev(`(()=>{
      const P=window.XZ.pack;
      const doc={format:P.format,items:[
        {no:1,wordId:'w1',word:'一'},{no:2,wordId:'w2',word:'二'},{no:3,wordId:'w3',word:'三'}]};
      // 手机默认命名：一个都认不出编号 → 只能按录音顺序
      const files=[{name:'录音C.m4a',lastModified:3000},{name:'录音A.m4a',lastModified:1000},{name:'录音B.m4a',lastModified:2000}];
      const r=P.pairFiles(doc,files);
      const r2=P.pairFiles(doc,files,{mode:'order'});
      return {
        order:r.pairs.map(p=>p.item.no+':'+p.file.name).join(','),
        orderUsed:r.orderUsed,
        forced:r2.pairs.map(p=>p.item.no+':'+p.file.name).join(',')
      };
    })()`, true);
    check('P5', '顺序兜底：文件名全无编号时按录音时间排，并标明"用了顺序"（不只是结果对）',
      p5 && !p5.__err &&
      p5.order === '1:录音A.m4a,2:录音B.m4a,3:录音C.m4a' && p5.orderUsed === true &&
      p5.forced === '1:录音A.m4a,2:录音B.m4a,3:录音C.m4a',
      JSON.stringify(p5));

    const p6 = await ev(`(()=>{
      const P=window.XZ.pack;
      const doc={format:P.format,items:[
        {no:1,wordId:'w1',word:'一'},{no:2,wordId:'w2',word:'二'},
        {no:3,wordId:'w3',word:'三'},{no:4,wordId:'w4',word:'四'}]};
      // 01/02 精确命中 → 只做精确匹配，03 缺、09 多，绝不把 09 硬塞给 03
      const r=P.pairFiles(doc,[{name:'01.m4a'},{name:'02.m4a'},{name:'09.m4a'}]);
      return {pairs:r.pairs.length, missing:r.missing.map(m=>m.no), extra:r.extra.map(f=>f.name), orderUsed:r.orderUsed};
    })()`, true);
    check('P6', '一旦有精确命中就不再兜底：缺的报缺、多的报多，绝不把 09 硬塞给 03 号词',
      p6 && !p6.__err && p6.pairs === 2 &&
      JSON.stringify(p6.missing) === '[3,4]' && JSON.stringify(p6.extra) === '["09.m4a"]' && p6.orderUsed === false,
      JSON.stringify(p6));

    /* ========== 界面：真拖放导入（P8） ========== */
    const p8 = await ev(`(async()=>{
      const P=window.XZ.pack;
      const ws=P.currentWords().slice(0,2);
      const doc=P.buildPack({speaker:{name:'王秀兰',hometown:'沛县张寨'},words:ws});
      const b64=${JSON.stringify(B64)};
      function fileOf(name){
        const bin=atob(b64); const u8=new Uint8Array(bin.length);
        for(let i=0;i<bin.length;i++) u8[i]=bin.charCodeAt(i);
        return new File([u8], name, {type:'audio/wav'});
      }
      const dt=new DataTransfer();
      dt.items.add(new File([JSON.stringify(doc)],'pack.json',{type:'application/json'}));
      dt.items.add(fileOf('01.wav')); dt.items.add(fileOf('02.wav'));
      const drop=document.getElementById('drop');
      drop.dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:dt}));
      await new Promise(r=>setTimeout(r,1400));
      const rep=document.getElementById('rep');
      return {
        text:(rep?rep.innerText:'').replace(/\\s+/g,' ').trim().slice(0,220),
        rows:rep?rep.querySelectorAll('.rep-row').length:0,
        plays:rep?rep.querySelectorAll('[data-play]').length:0,
        has1:XZ.refs.has(ws[0].id), has2:XZ.refs.has(ws[1].id),
        count:XZ.refs.count()
      };
    })()`, true);
    check('P8', '拖一份「清单 + 两个 wav」进页面：两条都落库，报告逐条可试听',
      p8 && !p8.__err && p8.has1 === true && p8.has2 === true && p8.count === 2 &&
      p8.rows === 2 && p8.plays === 2 && /新增\s*2/.test(p8.text || ''),
      JSON.stringify(p8));

    const p8b = await ev(`(async()=>{
      const P=window.XZ.pack;
      const ws=P.currentWords();
      const id=ws[0].id;
      // 存进去的 Blob 必须带音频 type；不带的话 <audio> 会静默播不出来
      const u=await XZ.refs.url(id);
      const head=u?await (await fetch(u)).blob():null;
      const ok=await XZ.refs.play(id);
      return {url:!!u, type:head?head.type:'', size:head?head.size:0, played:ok};
    })()`, true);
    check('P8b', '落库的音频带 audio/* 类型、体积非零、真的能播出来',
      p8b && !p8b.__err && p8b.url === true && /^audio\//.test(p8b.type || '') && p8b.size > 1000 && p8b.played === true,
      JSON.stringify(p8b));

    /* ========== 内嵌 base64 单文件包（P7） ========== */
    const p7 = await ev(`(async()=>{
      const P=window.XZ.pack;
      const w=P.currentWords()[2];
      const doc=P.buildPack({speaker:{name:'李福'},words:[w]});
      doc.items[0].data=${JSON.stringify(B64)};
      doc.items[0].mime='audio/wav';
      const r=await P.importPack(doc,[]);
      return {added:r.added.length, missing:r.missing.length, has:XZ.refs.has(w.id), how:r.added[0]&&r.added[0].how};
    })()`, true);
    check('P7', '单文件包（音频内嵌 base64）：只给一个 .json 也能导进来，标「内嵌」',
      p7 && !p7.__err && p7.added === 1 && p7.has === true && p7.how === '内嵌',
      JSON.stringify(p7));

    /* ========== 重复导入：默认跳过，勾了才覆盖（P9/P10） ========== */
    const p9 = await ev(`(async()=>{
      const P=window.XZ.pack;
      const ws=P.currentWords().slice(0,2);
      const doc=P.buildPack({speaker:{name:'王秀兰'},words:ws});
      const b64=${JSON.stringify(B64)};
      const bin=atob(b64); const u8=new Uint8Array(bin.length);
      for(let i=0;i<bin.length;i++) u8[i]=bin.charCodeAt(i);
      const mk=n=>new File([u8],n,{type:'audio/wav'});
      const before=XZ.refs.list().filter(r=>r.id===ws[0].id)[0];
      const r=await P.importPack(doc,[mk('01.wav'),mk('02.wav')],{});
      const after=XZ.refs.list().filter(r=>r.id===ws[0].id)[0];
      return {added:r.added.length, skipped:r.skipped.length,
              sameAt: before&&after&&before.at===after.at, why:r.skipped[0]&&r.skipped[0].why};
    })()`, true);
    check('P9', '再导一次同一包：默认全部跳过、原记录不被改写（at 不变），并说明「已有范本音」',
      p9 && !p9.__err && p9.added === 0 && p9.skipped === 2 && p9.sameAt === true && /已有/.test(p9.why || ''),
      JSON.stringify(p9));

    const p10 = await ev(`(async()=>{
      const P=window.XZ.pack;
      const ws=P.currentWords().slice(0,2);
      const doc=P.buildPack({speaker:{name:'李福'},words:ws});
      const b64=${JSON.stringify(B64)};
      const bin=atob(b64); const u8=new Uint8Array(bin.length);
      for(let i=0;i<bin.length;i++) u8[i]=bin.charCodeAt(i);
      const r=await P.importPack(doc,[new File([u8],'01.wav',{type:'audio/wav'}),
                                     new File([u8],'02.wav',{type:'audio/wav'})],{overwrite:true});
      const rec=XZ.refs.list().filter(x=>x.id===ws[0].id)[0];
      return {added:r.added.length, skipped:r.skipped.length, by:rec&&rec.by};
    })()`, true);
    check('P10', '勾了「覆盖」再导一次：两条都换成新的，记录上的发音人跟着换',
      p10 && !p10.__err && p10.added === 2 && p10.skipped === 0 && p10.by === '李福',
      JSON.stringify(p10));

    /* ========== 坏输入必须红，且不得写库（P11） ========== */
    const p11 = await ev(`(async()=>{
      const P=window.XZ.pack;
      const before=XZ.refs.count();
      const demo={format:'xiangyince-demo/1',clips:[]};
      const r1=await P.importPack(demo,[]);
      const empty={format:'xiangyince-pack/1',items:[]};
      const r2=await P.importPack(empty,[]);
      const noId={format:'xiangyince-pack/1',items:[{no:1,word:'一'}]};
      const r3=await P.importPack(noId,[]);
      return {
        ok1:r1.ok, msg1:(r1.errors||[]).map(e=>e.msg).join(' '),
        ok2:r2.ok, ok3:r3.ok,
        msg3:(r3.errors||[]).map(e=>e.msg).join(' '),
        unchanged: XZ.refs.count()===before
      };
    })()`, true);
    check('P11', '坏输入一律拒绝且不写库：演示包被点名叫对地方、空清单、缺 wordId',
      p11 && !p11.__err && p11.ok1 === false && /演示包/.test(p11.msg1 || '') &&
      p11.ok2 === false && p11.ok3 === false && /wordId/.test(p11.msg3 || '') && p11.unchanged === true,
      JSON.stringify(p11));

    /* ========== 入口（P12） ========== */
    await go(`http://127.0.0.1:${PORT}/index.html`, 3000);
    const p12 = await ev(`(()=>{
      const a=document.querySelector('a.vol-pack');
      const vis=a&&a.checkVisibility?a.checkVisibility({checkVisibilityCSS:true}):!!a;
      return {exists:!!a, href:a?a.getAttribute('href'):'', label:a?a.textContent.trim():'', vis:!!vis};
    })()`, true);
    check('P12', '地图顶栏有「语言包」入口，指向 pack.html，且真的可见（不是被 CSS 藏掉）',
      p12 && !p12.__err && p12.exists && /pack\.html/.test(p12.href) && p12.vis === true,
      JSON.stringify(p12));

  } catch (e) {
    fail++;
    console.error('✗ 运行中断：' + (e && e.stack || e));
  }

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  try { ch.kill(); } catch (e) {}
  try { srv.kill(); } catch (e) {}
  process.exit(fail ? 1 : 0);
})();
