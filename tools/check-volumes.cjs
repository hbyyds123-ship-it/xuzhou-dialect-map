/* ============================================================
   check-volumes.cjs — 卷制回归（V8–V17）
   ------------------------------------------------------------
   为什么要有这个文件：features/volumes.js + vol-board.js + volumes.html
   是"一卷一个地方"这条主张的全部实现，却一直只在别人的 out/ 目录里验过。
   下一轮任何人改 ATLAS / store / 导入，都会裸奔。

   判据只用能力与状态：
     · 可见性 → el.checkVisibility({checkVisibilityCSS:true})
       （新版 Chrome 折叠 <details> 走 content-visibility，用 display 判会假报"可见"）
     · 不数 .chk 个数、不按行号切片、不拿文案当契约（V14 例外：它验的就是文案）

   用法：
     node tools/check-volumes.cjs [port]
   依赖：本机 Chrome/Chromium（复用 recorder/tools/browsers.cjs）、Node >= 22
   ============================================================ */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const B = require(path.join(ROOT, 'recorder', 'tools', 'browsers.cjs'));

const PORT = Number(process.argv[2] || 8491);
const DBG = PORT + 10;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
let fail = 0;
function check(id, desc, ok, detail) {
  ok ? pass++ : fail++;
  console.log(`${ok ? '✓' : '✗'} ${id.padEnd(4)} ${desc}` + (detail ? `\n        ${detail}` : ''));
}

/* 1 秒 220Hz 的 wav（只为造一条能播的范本音，不追求音质） */
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

/* ---------- V15 是纯静态检查，先做（不需要浏览器） ---------- */
function walk(dir, out) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach((d) => {
    if (d.name === 'node_modules' || d.name === '.git' || d.name === 'dist' ||
        d.name === '.workbuddy' || d.name === 'volumes' || d.name === 'out') return;
    const p = path.join(dir, d.name);
    if (d.isDirectory()) walk(p, out);
    else out.push(p);
  });
  return out;
}

function v15() {
  const files = walk(ROOT, []).filter((f) => /\.(js|html)$/i.test(f) && !f.includes('three.min'));
  const hits = [];
  files.forEach((f) => {
    const s = fs.readFileSync(f, 'utf8');
    if (s.includes('?vol=')) hits.push(path.relative(ROOT, f));
  });
  const mdPath = path.join(ROOT, 'VOLUMES.md');
  let mdBad = '';
  if (fs.existsSync(mdPath)) {
    const md = fs.readFileSync(mdPath, 'utf8');
    // 允许留，但必须写明"已废弃"
    if (md.includes('?vol=') && !md.includes('已废弃')) mdBad = 'VOLUMES.md 提到 ?vol= 但没写"已废弃"';
  }
  check('V15', '代码里没有 ?vol= 的空头路径', hits.length === 0 && !mdBad,
    hits.length ? `命中：${hits.join(', ')}` : (mdBad || `扫了 ${files.length} 个 js/html，0 命中`));
}

/* ---------- 浏览器部分 ---------- */
(async () => {
  v15();

  const srv = spawn(process.execPath, [path.join(ROOT, 'serve.cjs'), String(PORT)], { cwd: ROOT, stdio: 'ignore' });
  await sleep(1000);

  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'ckvol-'));
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
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }, sid);

  const ev = async (expr, gesture) => {
    const r = await send('Runtime.evaluate', {
      expression: expr, returnByValue: true, awaitPromise: true, userGesture: !!gesture
    }, sid);
    if (r.result && r.result.exceptionDetails) {
      return { __err: (r.result.exceptionDetails.exception || {}).description || 'eval-error' };
    }
    return r.result.result && r.result.result.value;
  };
  const go = async (url, wait) => { await send('Page.navigate', { url }, sid); await sleep(wait || 2600); };
  const B64 = wavBuf(220, 1.0, 16000).toString('base64');

  try {
    /* ================= 徐州卷：范本音计数与空态（V16/V17） ================= */
    await go(`http://127.0.0.1:${PORT}/index.html`, 3200);

    const readBook = `(async()=>{
      const card=document.getElementById('modalCard');
      const vis=el=>!!(el&&el.checkVisibility&&el.checkVisibility({checkVisibilityCSS:true}));
      const bar=[...card.querySelectorAll('.refs-btn')].filter(vis).map(e=>e.textContent.trim()).join(' | ');
      const empty=[...card.querySelectorAll('.refs-empty')].filter(vis).map(e=>e.textContent.trim()).join(' ');
      const badge=[...card.querySelectorAll('.bk-say.ref')].filter(vis).length;
      const refRows=[...card.querySelectorAll('.ref-row')].filter(vis).length;
      return {bar, empty, badge, refRows, n:window.XZ.refs.count(), words:(window.ATLAS?ATLAS.words.length:0)};
    })()`;

    let v16 = await ev(`(async()=>{
      (document.getElementById('btnBook')||{click(){}}).click();
      await new Promise(r=>setTimeout(r,700));
      const tog=document.getElementById('refToggle'); if(tog) tog.click();
      await new Promise(r=>setTimeout(r,600));
      return 1;
    })()`, true);
    const bk0 = await ev(readBook, true);
    check('V16', '开箱 0 条时，词条册可见文本里有「范本音 0 / N」和「未带范本音」',
      bk0 && !bk0.__err && bk0.n === 0 && /范本音\s*0\s*\/\s*\d+/.test(bk0.bar || '') && /未带范本音/.test(bk0.empty || ''),
      JSON.stringify(bk0));

    const v17add = await ev(`(async()=>{
      const bin=atob(${JSON.stringify(B64)}); const u8=new Uint8Array(bin.length);
      for(let i=0;i<bin.length;i++) u8[i]=bin.charCodeAt(i);
      await XZ.refs.add('maozi', new File([u8],'maozi.wav',{type:'audio/wav'}));
      await XZ.refs.refresh();
      (document.querySelector('.mc-close')||{click(){}}).click();
      await new Promise(r=>setTimeout(r,300));
      (document.getElementById('btnBook')||{click(){}}).click();
      await new Promise(r=>setTimeout(r,700));
      const tog=document.getElementById('refToggle'); if(tog) tog.click();
      await new Promise(r=>setTimeout(r,600));
      return XZ.refs.count();
    })()`, true);
    const bk1 = await ev(readBook, true);
    check('V17', '导入 1 条后计数变 1 / N，且那个词出现 ♪ 角标',
      v17add === 1 && bk1 && !bk1.__err && /范本音\s*1\s*\/\s*\d+/.test(bk1.bar || '') && bk1.badge >= 1,
      `count=${v17add} ${JSON.stringify(bk1)}`);

    /* ================= 卷的导入往返（V8） ================= */
    await go(`http://127.0.0.1:${PORT}/volumes.html`, 1800);

    const created = await ev(`(()=>{
      localStorage.removeItem('xzdt.volumes.v1');
      const V=window.XZ.volumes;
      const a=V.create({title:'乡音册',name:'宿迁',dialect:'宿迁话',mark:'宿',
        districts:['城关','东乡','西乡'],
        words:[{w:'茅子',meaning:'厕所',example:'茅子在哪儿'},
               {w:'洋柿子',meaning:'西红柿'},
               {w:'管',meaning:'行、可以'},
               {w:'恣儿',meaning:'舒服、痛快'}],
        dataLicense:'', survey:'', refsBy:''});
      if(!a) return {err:'create failed'};
      return {id:a.id, no:a.no, words:a.words.length};
    })()`, true);
    check('V8-0', '先建一卷（往返的起点）', created && created.words === 4, JSON.stringify(created));

    const rt = await ev(`(()=>{
      const V=window.XZ.volumes;
      const norm=v=>({
        title:v.title, name:v.name, dialect:v.dialect, mark:v.mark,
        districts:v.districts.map(d=>d.name),
        words:v.words.map(w=>({w:w.w, meaning:w.meaning, example:w.example,
          d:w.district, x:Math.round((w.x||0)*1000)/1000, y:Math.round((w.y||0)*1000)/1000}))
      });
      const e1=V.exportJSON(${JSON.stringify(created && created.id)});
      const r=V.importJSON(e1);
      if(!r || !r.ok) return {err:'import failed', r:r};
      const e2=V.exportJSON(r.volume.id);
      const a=JSON.stringify(norm(e1.volume)), b=JSON.stringify(norm(e2.volume));
      return {same:a===b, a, b, newNo:r.volume.no, oldNo:e1.volume.no, diffIds:e1.volume.words[0].id+'→'+e2.volume.words[0].id};
    })()`, true);
    check('V8', '导出 → 导入 → 再导出：语义逐字段相等（卷号/词 id 由本机重新分配）',
      rt && !rt.err && rt.same === true && rt.newNo === rt.oldNo + 1,
      rt && rt.err ? JSON.stringify(rt) : `卷号 ${rt.oldNo}→${rt.newNo}，词 id ${rt.diffIds}，两轮 JSON ${rt.same ? '完全一致' : '不一致'}\n        ${rt.same ? '' : (rt.a || '') + '\n        ' + (rt.b || '')}`);

    /* ================= V8-ui 界面入口（拖文件进去真的能导入） ================= */
    const uiImp = await ev(`(async()=>{
      const V=window.XZ.volumes;
      const doc=V.exportJSON(V.current().id);
      const f=new File([JSON.stringify(doc)], 't.json', {type:'application/json'});
      const dt=new DataTransfer(); dt.items.add(f);
      const drop=document.getElementById('impDrop');
      if(!drop) return {err:'没有导入区'};
      drop.dispatchEvent(new DragEvent('drop',{bubbles:true, dataTransfer:dt}));
      await new Promise(r=>setTimeout(r,900));
      const rep=document.getElementById('impReport');
      return {text:(rep?rep.innerText:'').replace(/\s+/g,' ').trim().slice(0,200),
              rows:V.list().length};
    })()`, true);
    check('V8-ui', '「导入已有的一卷」的拖放区在页面上，拖进去能出逐条报告',
      uiImp && !uiImp.err && /已导入/.test(uiImp.text || '') && /卷号/.test(uiImp.text || ''),
      JSON.stringify(uiImp));

    /* ================= V9 坏输入必须红，且不得写库 ================= */
    const BAD = [
      ['format', { format: 'xiangyince-volume/2', volume: { name: '甲', districts: ['城关'], words: [{ w: '管' }] } }, /format/i],
      ['d0', { format: 'xiangyince-volume/1', volume: { name: '甲', districts: [], words: [{ w: '管' }] } }, /片区/],
      ['d7', { format: 'xiangyince-volume/1', volume: { name: '甲', districts: ['a', 'b', 'c', 'd', 'e', 'f', 'g'], words: [{ w: '管' }] } }, /片区/],
      ['w0', { format: 'xiangyince-volume/1', volume: { name: '甲', districts: ['城关'], words: [] } }, /词/],
      ['wdup', { format: 'xiangyince-volume/1', volume: { name: '甲', districts: ['城关'], words: [{ w: '管' }, { w: '管' }] } }, /重名|重复/],
      ['wempty', { format: 'xiangyince-volume/1', volume: { name: '甲', districts: ['城关'], words: [{ w: '   ' }] } }, /空/],
      ['wnotarray', { format: 'xiangyince-volume/1', volume: { name: '甲', districts: ['城关'], words: '管' } }, /数组|词表/]
    ];
    for (const [tag, doc, want] of BAD) {
      const r = await ev(`(()=>{
        const V=window.XZ.volumes;
        const before=V.list().length;
        const out=V.importJSON(${JSON.stringify(doc)});
        const after=V.list().length;
        const msgs=(out&&out.errors||[]).map(e=>e.msg||e.reason||String(e));
        return {ok:!!(out&&out.ok), msgs, before, after, threw:false};
      })()`, true);
      const ok = r && !r.__err && r.ok === false && (r.msgs || []).length > 0 &&
        want.test((r.msgs || []).join(' ')) && r.before === r.after;
      check('V9-' + tag, `坏输入被拒（${tag}）且有对应文案、不写库`,
        ok, r && r.__err ? `抛异常：${r.__err}` : `${JSON.stringify(r && r.msgs)}，list ${r && r.before}→${r && r.after}`);
    }

    /* ================= V10 清 localStorage 后能完整恢复 ================= */
    const snapshot = await ev(`(()=>{
      const V=window.XZ.volumes;
      const cur=V.current();
      const doc=V.exportJSON(cur.id);
      localStorage.removeItem('xzdt.volumes.v1');
      return {kept:JSON.parse(JSON.stringify(doc)), hadWords:cur.words.length, hadName:cur.name,
              afterClear:V.list().length};
    })()`, true);

    await go(`http://127.0.0.1:${PORT}/volumes.html`, 1800);
    const restored = await ev(`(()=>{
      const V=window.XZ.volumes;
      const before=V.list().length;
      const r=V.importJSON(${JSON.stringify(snapshot && snapshot.kept)});
      const cur=V.current();
      return {before, ok:!!(r&&r.ok), after:V.list().length,
        name:cur&&cur.name, words:cur&&cur.words.length, dists:cur&&cur.districts.length,
        ids:cur&&cur.words.map(w=>w.id)};
    })()`, true);
    check('V10', '清掉 localStorage 后，导入同一份文件能完整恢复卷与词表',
      snapshot && snapshot.afterClear === 0 && restored && restored.ok && restored.after === 1 &&
      restored.name === snapshot.hadName && restored.words === snapshot.hadWords && restored.dists === 3,
      `清空前 ${snapshot && snapshot.hadWords} 词 / 清空后 list=${snapshot && snapshot.afterClear} → 导入 ${JSON.stringify(restored)}`);

    /* ================= V11 导入的卷在采录页只出本卷题 ================= */
    const wordSet = await ev(`(()=>{const c=window.XZ.volumes.current();return c?c.words.map(w=>w.w):[]})()`);
    await go(`http://127.0.0.1:${PORT}/recorder/`, 2600);
    const rec = await ev(`(async()=>{
      (document.getElementById('consentOk')||{click(){}}).click();
      await new Promise(r=>setTimeout(r,250));
      const idx=(document.getElementById('promptIndex')||{}).textContent||'';
      const total=Number((idx.match(/\\/\\s*(\\d+)/)||[])[1]||0);
      const seen=[];
      for(let i=0;i<total;i++){
        seen.push((document.getElementById('promptText')||{}).textContent.trim());
        document.getElementById('skipBtn').click();
        await new Promise(r=>setTimeout(r,140));
      }
      return {idx:idx.trim(), total, seen};
    })()`, true);
    const set = new Set(wordSet || []);
    const allMine = (rec && rec.seen || []).every((w) => set.has(w));
    check('V11', '导入的卷在采录页只出本卷题（不混徐州 93 题）',
      rec && !rec.__err && rec.total === (wordSet || []).length && allMine,
      `题号「${rec && rec.idx}」；抽到 ${JSON.stringify(rec && rec.seen)}；本卷 ${JSON.stringify(wordSet)}`);

    /* ================= V12/V13/V14 关于本卷（用户卷） ================= */
    const mk = await ev(`(()=>{
      const V=window.XZ.volumes;
      const a=V.create({title:'乡音册',name:'无许可卷',dialect:'无许可话',mark:'无',
        districts:['城关','东乡','西乡'],
        words:[{w:'甲'},{w:'乙'},{w:'丙'},{w:'丁'}]});
      const b=V.create({title:'乡音册',name:'有许可卷',dialect:'有许可话',mark:'有',
        districts:['上乡','下乡'],
        words:[{w:'戊'},{w:'己'}],
        dataLicense:'CC BY-NC-SA 4.0（本人语料）', survey:'自采，2026-11', refsBy:'本人'});
      return {a:a&&a.id, b:b&&b.id};
    })()`, true);

    async function aboutText(volId) {
      await ev(`window.XZ.volumes.activate(${JSON.stringify(volId)}), 1`, true);
      await go(`http://127.0.0.1:${PORT}/index.html`, 3000);
      const clicked = await ev(`(()=>{const t=document.querySelector('.vol-tag'); if(!t) return 'no-tag'; t.click(); return 'ok'})()`, true);
      await sleep(700);
      return await ev(`(()=>{
        const c=document.getElementById('modalCard');
        if(!c) return {err:'no-card'};
        const on=document.getElementById('modal').classList.contains('on');
        const a=c.querySelector('a[href*="volumes.html"]');
        return {on, text:(c.innerText||'').replace(/\\s+/g,' ').trim(),
          openLink:(a&&a.textContent||'').trim(), openHref:(a&&a.getAttribute('href'))||''};
      })()`, true);
    }

    const aboutNo = await aboutText(mk && mk.a);
    check('V12', '不填许可 → 授权行不得继承第 1 卷的 CC BY-SA，要写"未声明"',
      aboutNo && !aboutNo.err && aboutNo.on && /未声明/.test(aboutNo.text || '') && !/CC BY-SA/.test(aboutNo.text || ''),
      aboutNo && aboutNo.err ? String(aboutNo.err) : `弹层打开=${aboutNo.on}；授权行片段「${(aboutNo.text || '').match(/授权[^范]{0,80}/) || ''}」`);

    const aboutYes = await aboutText(mk && mk.b);
    const licRT = await ev(`(()=>{
      const V=window.XZ.volumes;
      const cur=V.current();
      const e=V.exportJSON(cur.id);
      const r=V.importJSON(e);
      return {inExport:e.volume.dataLicense, inImport:r&&r.ok?r.volume.dataLicense:'IMPORT-FAIL'};
    })()`, true);
    check('V13', '填了许可 → 关于本卷原样显示，导出带该字段并能被导入带回',
      aboutYes && !aboutYes.err && /CC BY-NC-SA 4\.0/.test(aboutYes.text || '') &&
      licRT && licRT.inExport === 'CC BY-NC-SA 4.0（本人语料）' && licRT.inImport === licRT.inExport,
      `关于本卷含许可=${/CC BY-NC-SA/.test(aboutYes && aboutYes.text || '')}；导出=${JSON.stringify(licRT && licRT.inExport)}；导入回来=${JSON.stringify(licRT && licRT.inImport)}`);

    const aboutTxt = (aboutYes && aboutYes.text) || '';
    check('V14', '「关于本卷」不再对用户喊命令行，改指向开一卷',
      !!(aboutYes && !aboutYes.err && !/npm\s/.test(aboutTxt) &&
        /开一卷/.test((aboutYes && aboutYes.openLink) || '') &&
        /volumes\.html/.test((aboutYes && aboutYes.openHref) || '')),
      `含 npm=${/npm\s/.test(aboutTxt)}；入口「${aboutYes && aboutYes.openLink}」→ ${aboutYes && aboutYes.openHref}`);

    console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  } catch (e) {
    console.error('崩溃：', e && e.stack || e);
    fail++;
  } finally {
    try { ws.close(); } catch (e) {}
    try { ch.kill(); } catch (e) {}
    try { srv.kill(); } catch (e) {}
  }
  process.exit(fail ? 1 : 0);
})();
