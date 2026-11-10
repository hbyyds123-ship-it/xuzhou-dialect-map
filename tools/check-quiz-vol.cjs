/* ============================================================
   check-quiz-vol.cjs — 自建卷「测一测」回归（Q1–Q6）
   ------------------------------------------------------------
   为什么要有这个文件：
     自建卷的词条允许「只写词、不写释义」（添词弹层明说后两列可省）。
     旧出题逻辑一律拿 meaning 当选项文本，空释义去重后只剩正确项，
     界面上就是"一个空按钮 + 打个勾"，看起来像没有选项。

   判据只用真实行为：
     · 选项数量 ≥ 2（单选题不成立就不该出题）
     · 选项文本非空且互不相同
     · 题型与选项同质：释义题选项全是释义，听音题选项全是词
     · 出不了题时给说明卡，而不是静默关闭

   用法： node tools/check-quiz-vol.cjs [port]
   ============================================================ */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const B = require(path.join(ROOT, 'recorder', 'tools', 'browsers.cjs'));
const PORT = Number(process.argv[2] || 8451);
const DBG = PORT + 10;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
let fail = 0;
function check(id, desc, ok, detail) {
  ok ? pass++ : fail++;
  console.log(`${ok ? '✓' : '✗'} ${id.padEnd(4)} ${desc}` + (detail ? `\n        ${detail}` : ''));
}

const MEAN_WORDS = [
  { w: '日头', meaning: '太阳' }, { w: '夜来', meaning: '昨天' },
  { w: '各拉', meaning: '角落' }, { w: '挎包', meaning: '书包' },
  { w: '胰子', meaning: '肥皂' }, { w: '河沿', meaning: '河边' }
];
const BARE_WORDS = [{ w: '日头' }, { w: '夜来' }, { w: '各拉' }, { w: '挎包' }, { w: '胰子' }, { w: '河沿' }];

(async () => {
  const srv = spawn(process.execPath, [path.join(ROOT, 'serve.cjs'), String(PORT)], { cwd: ROOT, stdio: 'ignore' });
  await sleep(900);

  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'ckqv-'));
  const ch = spawn(B.primary().path, [
    ...B.commonFlags(), `--remote-debugging-port=${DBG}`, `--user-data-dir=${ud}`,
    '--autoplay-policy=no-user-gesture-required', '--hide-scrollbars'
  ], { stdio: 'ignore' });

  const getJson = (u) => new Promise((res, rej) => {
    http.get(u, (r) => { let b = ''; r.on('data', (d) => (b += d)); r.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } }); })
      .on('error', rej);
  });
  let ver = null;
  for (let i = 0; i < 60; i++) { try { ver = await getJson(`http://127.0.0.1:${DBG}/json/version`); break; } catch (e) { await sleep(300); } }
  if (!ver) { console.error('起不来浏览器'); process.exit(2); }

  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0;
  const pend = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
  const send = (method, params, sid) => new Promise((res) => {
    const mid = ++id; pend.set(mid, res);
    ws.send(JSON.stringify({ id: mid, method, params: params || {}, sessionId: sid }));
  });

  const t = await send('Target.createTarget', { url: 'about:blank' });
  const at = await send('Target.attachToTarget', { targetId: t.result.targetId, flatten: true });
  const sid = at.result.sessionId;
  await send('Page.enable', {}, sid);
  await send('Runtime.enable', {}, sid);
  await send('Emulation.setDeviceMetricsOverride', { width: 1360, height: 900, deviceScaleFactor: 1, mobile: false }, sid);

  const ev = async (expr, gesture) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, userGesture: !!gesture }, sid);
    if (r.result && r.result.exceptionDetails) return { __err: (r.result.exceptionDetails.exception || {}).description || 'eval-error' };
    return r.result.result && r.result.result.value;
  };
  const go = async (u, w) => { await send('Page.navigate', { url: u }, sid); await sleep(w || 2600); };

  const mkVol = (words, name) => ev(`(() => {
    const v = XZ.volumes.create({
      title:'乡音册', name:${JSON.stringify(name || '测试县')}, dialect:'测试话',
      districts:['东片','西片'], words:${JSON.stringify(words)}
    });
    return v ? { id:v.id, words:v.words.length } : null;
  })()`, true);

  const clickQuiz = () => ev(`(() => { const b=document.getElementById('vbQuiz'); if(!b) return 'nobtn'; b.click(); return b.disabled?'disabled':'ok'; })()`, true);

  /* 逐题读取：题干 + 选项；点第 1 个选项后进下一题，最多 6 题 */
  const readAll = async () => {
    const list = [];
    for (let i = 0; i < 6; i++) {
      const one = await ev(`(() => {
        const st = document.getElementById('stage');
        if (!st || !st.classList.contains('on')) return null;
        const opts = [...st.querySelectorAll('.q-opt')];
        if (!opts.length) return { empty: true, text: st.innerText.slice(0,200), hasCard: !!st.querySelector('.q-empty') };
        return {
          ask: (st.querySelector('.q-ask')||{}).textContent || '',
          word: (st.querySelector('.q-word')||{}).textContent || '',
          opts: opts.map(b => (b.querySelector('.q-t')||{}).textContent || '')
        };
      })()`, true);
      if (!one || one.__err) break;
      if (one.empty) { list.push(one); break; }
      list.push(one);
      const advanced = await ev(`(async () => {
        const st=document.getElementById('stage');
        const o=st.querySelectorAll('.q-opt'); if(o[0]) o[0].click();
        await new Promise(r=>setTimeout(r,220));
        const nx=st.querySelector('[data-next]');
        if(!nx || nx.hidden) return 'no-next';
        nx.click();
        await new Promise(r=>setTimeout(r,420));
        return 'ok';
      })()`, true);
      if (advanced !== 'ok') break;
    }
    return list;
  };

  try {
    /* ---------- Q1：有释义的卷 —— 照旧考释义 ---------- */
    await go(`http://127.0.0.1:${PORT}/volumes.html`, 1800);
    await mkVol(MEAN_WORDS, '有释义县');
    await go(`http://127.0.0.1:${PORT}/index.html`, 3000);
    await clickQuiz();
    await sleep(1200);
    const q1 = await readAll();
    const meanings = new Set(MEAN_WORDS.map((w) => w.meaning));
    const q1ok = q1.length > 0 && q1.every((r) => !r.empty && r.opts.length === 4 &&
      r.ask.includes('意思') && r.opts.every((t) => t && meanings.has(t)) &&
      new Set(r.opts).size === r.opts.length);
    check('Q1', '有释义的卷：每题 4 个选项，选项都是释义、无重复、题干问「意思」', q1ok,
      JSON.stringify(q1.map((r) => ({ ask: r.ask, opts: r.opts }))).slice(0, 400));

    /* ---------- Q2：只写词的卷 —— 转听音辨词 ---------- */
    await go(`http://127.0.0.1:${PORT}/volumes.html`, 1500);
    await mkVol(BARE_WORDS, '无释义县');
    await go(`http://127.0.0.1:${PORT}/index.html`, 3000);
    const btn2 = await clickQuiz();
    await sleep(1200);
    const q2 = await readAll();
    const words = new Set(BARE_WORDS.map((w) => w.w));
    const q2ok = q2.length > 0 && q2.every((r) => !r.empty && r.opts.length === 4 &&
      r.ask.includes('哪一个词') && r.opts.every((t) => t && words.has(t)) &&
      new Set(r.opts).size === r.opts.length &&
      /* 不能露字：选项就是词，标题上出现原词等于送分 */
      r.word === '？');
    check('Q2', '只写词的卷：每题 4 个选项，选项都是词、题干问「哪一个词」，且不泄露答案',
      q2ok && btn2 === 'ok', JSON.stringify(q2.map((r) => ({ ask: r.ask, word: r.word, opts: r.opts }))).slice(0, 400));

    /* ---------- Q3：只有 2 个词 —— 出 2 个选项，而不是 1 个 ---------- */
    await go(`http://127.0.0.1:${PORT}/volumes.html`, 1500);
    await mkVol([{ w: '日头' }, { w: '夜来' }], '两词县');
    await go(`http://127.0.0.1:${PORT}/index.html`, 3600);
    const btn3 = await clickQuiz();
    await sleep(1600);
    const q3 = await readAll();
    const q3ok = q3.length > 0 && q3[0] && !q3[0].empty && q3[0].opts.length === 2 &&
      q3[0].opts.every((t) => t && t.trim());
    check('Q3', '只有 2 个词的卷：出 2 个选项（不是 1 个空按钮）', q3ok,
      `click=${btn3} ` + JSON.stringify(q3[0] || null));

    /* ---------- Q4：只有 1 个词 —— 按钮禁用；直接进路由也要给说明卡 ---------- */
    await go(`http://127.0.0.1:${PORT}/volumes.html`, 1500);
    await mkVol([{ w: '日头' }], '单词县');
    await go(`http://127.0.0.1:${PORT}/index.html`, 3200);
    const q4btn = await ev(`(() => { const b=document.getElementById('vbQuiz'); return b?{disabled:!!b.disabled,title:b.title}:null; })()`, true);
    /* 绕过按钮直接进路由：说明卡必须出现，而不是一片空白 */
    await ev(`location.hash='#/quiz/1'`, true);
    await sleep(1400);
    const q4 = await ev(`(() => {
      const st=document.getElementById('stage');
      return {
        on: !!(st && st.classList.contains('on')),
        opts: st ? st.querySelectorAll('.q-opt').length : -1,
        card: st ? ((st.querySelector('.q-empty')||{}).innerText||'') : ''
      };
    })()`, true);
    check('Q4', '只有 1 个词：卷首页按钮禁用；直接进路由时给「至少 2 个词」说明卡，不是空白',
      q4btn && q4btn.disabled === true && q4 && q4.on === true && q4.opts === 0 &&
      /至少要\s*2\s*个/.test(q4.card || ''),
      JSON.stringify({ q4btn, q4 }));

    /* ---------- Q5：混着写（一半有释义一半没有）—— 每题选项必须同质 ---------- */
    await go(`http://127.0.0.1:${PORT}/volumes.html`, 1500);
    await mkVol([
      { w: '日头', meaning: '太阳' }, { w: '夜来', meaning: '昨天' },
      { w: '各拉', meaning: '角落' }, { w: '挎包', meaning: '书包' },
      { w: '胰子' }, { w: '河沿' }, { w: '地排车' }, { w: '洋柿子' }
    ], '混合县');
    await go(`http://127.0.0.1:${PORT}/index.html`, 3000);
    await clickQuiz();
    await sleep(1200);
    const q5 = await readAll();
    const meanSet = new Set(['太阳', '昨天', '角落', '书包']);
    const wordSet = new Set(['胰子', '河沿', '地排车', '洋柿子']);
    const q5ok = q5.length > 0 && q5.every((r) => {
      if (r.empty) return false;
      if (r.opts.length < 2) return false;
      if (r.opts.some((t) => !t || !t.trim())) return false;
      if (new Set(r.opts).size !== r.opts.length) return false;
      return r.ask.includes('意思')
        ? r.opts.every((t) => meanSet.has(t))
        : r.opts.every((t) => wordSet.has(t));
    });
    check('Q5', '混合卷：释义题只配释义、听音题只配词，且没有空选项', q5ok,
      JSON.stringify(q5.map((r) => ({ ask: r.ask.slice(0, 12), n: r.opts.length, opts: r.opts }))).slice(0, 500));

    /* ---------- Q6：第 1 卷（徐州）没被改坏 ---------- */
    await ev(`XZ.volumes.deactivate()`, true);
    await go(`http://127.0.0.1:${PORT}/index.html`, 3000);
    await ev(`location.hash='#/quiz/1'`, true);
    await sleep(1800);
    const q6 = await ev(`(() => {
      const st=document.getElementById('stage');
      const opts=[...(st?st.querySelectorAll('.q-opt'):[])];
      return {
        on: !!(st && st.classList.contains('on')),
        ask: (st && st.querySelector('.q-ask') ? st.querySelector('.q-ask').textContent : ''),
        opts: opts.map(b => (b.querySelector('.q-t')||{}).textContent || ''),
        word: (st && st.querySelector('.q-word') ? st.querySelector('.q-word').textContent : '')
      };
    })()`, true);
    check('Q6', '徐州卷回归：仍是 4 个释义选项、题干问「意思」、词直接可见',
      q6 && q6.on && q6.opts.length === 4 && q6.ask.includes('意思') &&
      q6.opts.every((t) => t && t.trim()) && q6.word && q6.word !== '？',
      JSON.stringify(q6));
  } catch (e) {
    console.error('异常:', e && e.stack || e);
    fail++;
  } finally {
    console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
    try { ch.kill(); } catch (e) {}
    try { srv.kill(); } catch (e) {}
    setTimeout(() => process.exit(fail ? 1 : 0), 300);
  }
})();
