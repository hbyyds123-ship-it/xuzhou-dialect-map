/**
 * e2e-check.cjs — A17 / A18 端到端回归
 *
 * 针对《第3轮审阅意见》C1/C2/C4b/E13：
 *   - 不看 console（异常会被产品自己的 try/catch 吞进 #banner）
 *   - 只看 DOM：banner 文本、列表条数、进度文本
 *   - 四步全跑：保存 → 列表出现 → 刷新仍在 → 删除回退
 *
 * 用法：node tools/e2e-check.cjs [port] [browser]
 *       browser 取 chrome / edge …（见 tools/browsers.cjs），默认 chrome
 *       也可用环境变量 E2E_BROWSER=edge
 * 依赖：本机 Chromium 内核浏览器、Node >= 22（内置 WebSocket）
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const browsers = require('./browsers.cjs');

const PORT = Number(process.argv[2] || 8131);
const ROOT = path.join(__dirname, '..');
const WANT = String(process.argv[3] || process.env.E2E_BROWSER || 'chrome').toLowerCase();
const BROWSER = browsers.pick(WANT) || browsers.primary();
if (!BROWSER) {
  console.error('没有可用的 Chromium 浏览器（chrome / edge / brave）。先跑 node tools/browsers.cjs 看看。');
  process.exit(2);
}
if (WANT !== BROWSER.name) {
  console.log(`（未找到 ${WANT}，改用 ${browsers.describe(BROWSER)}）`);
}

let pass = 0, fail = 0;
const rows = [];
function check(id, desc, ok, detail) {
  if (ok) pass++; else fail++;
  rows.push({ id, desc, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${id} ${desc}${detail ? '  — ' + detail : ''}`);
}

/** 生成 180 Hz 测试音（48k / 16bit / mono），供 Chrome 假麦克风使用 */
function makeWav(file, freq, secs, sr) {
  const n = Math.round(secs * sr);
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22); buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 2, 28);
  buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    // 基频 + 少量谐波，模拟人声，幅度 0.35
    const t = i / sr;
    const v = 0.35 * (Math.sin(2 * Math.PI * freq * t)
      + 0.5 * Math.sin(4 * Math.PI * freq * t)
      + 0.33 * Math.sin(6 * Math.PI * freq * t));
    let s = Math.max(-1, Math.min(1, v));
    buf.writeInt16LE(Math.round(s * 0x7fff), 44 + i * 2);
  }
  fs.writeFileSync(file, buf);
}

function getJson(url) {
  return new Promise((res, rej) => {
    http.get(url, (r) => {
      let b = '';
      r.on('data', (d) => (b += d));
      r.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } });
    }).on('error', rej);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 进度文本形如 "1 / 42 题已录"，取出前两个数字比较 */
function progressIs(text, done, total) {
  const m = String(text).match(/(\d+)\s*\/\s*(\d+)/);
  return !!m && Number(m[1]) === done && Number(m[2]) === total;
}

async function main() {
  // ---- A18 静态部分：闭包必须收在文件末尾 ----
  const src = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  const lines = src.split(/\r?\n/);
  const lastNonEmpty = lines.reduce((acc, l, i) => (l.trim() ? i + 1 : acc), 0);
  let lastClose = -1;
  lines.forEach((l, i) => { if (l.trim() === '})();') lastClose = i + 1; });
  check('A18a', '最后一个 `})();` 位于文件末尾（闭包不提前闭合）',
    lastClose === lastNonEmpty, `})(); @ ${lastClose}，最后非空行 @ ${lastNonEmpty}`);
  // 断言"存储层存在"用能力，不用出现次数：
  // 加一次自愈重开（indexedDB.open 出现 2 次）不代表存储层坏了，
  // 数次数会把正确的改动判成回归 —— 这正是我们一直在拆的那类无鉴别力判据。
  const nOpen = (src.match(/indexedDB\.open/g) || []).length;
  const nStoreDef = (src.match(/createObjectStore\(\s*STORE/g) || []).length;
  const hasFacade = /const store\s*=\s*\{/.test(src)
    && ['put', 'all', 'del', 'clear'].every((m) => new RegExp(m + '\\s*[(:]').test(src));
  check('A18b', '存储层在位（有 open、能建表、store 门面四个方法齐）',
    nOpen >= 1 && nStoreDef >= 1 && hasFacade,
    `open=${nOpen} createObjectStore=${nStoreDef} facade=${hasFacade}`);
  check('A18c', 'I11 稳定入口 window.__probe 已导出',
    /window\.__probe\s*=\s*\{/.test(src), 'window.__probe 存在');

  // ---- 起服务 ----
  // 仓库化之后 recorder/ 只是站点的一个子目录，服务器与页面路径都要跟着换：
  //   recorder/ 自带 serve.cjs（独立目录形态） → 页面在 /
  //   否则用仓库根的 serve.cjs（合并形态）     → 页面在 /recorder/，且与地图同源
  // 层级注意：ROOT 已经是 recorder/，仓库根是它的**上一级**。
  // 曾经写成两级向上，导致自起服务器这条分支一直指向不存在的目录；
  // 而"复用已监听端口"那条分支遮住了它 —— 两条分支都要真跑。
  const SERVE_ROOT = fs.existsSync(path.join(ROOT, 'serve.cjs'))
    ? ROOT : path.join(ROOT, '..');
  const PAGE = SERVE_ROOT === ROOT ? '/' : '/recorder/';
  if (!fs.existsSync(path.join(SERVE_ROOT, 'serve.cjs'))) {
    console.error('找不到服务器脚本：', path.join(SERVE_ROOT, 'serve.cjs'));
    process.exit(3);
  }
  let srv = null;
  const portBusy = await new Promise((res) => {
    const s = require('net').connect(PORT, '127.0.0.1', () => { s.destroy(); res(true); });
    s.on('error', () => res(false));
    s.setTimeout(700, () => { s.destroy(); res(false); });
  });
  if (portBusy) console.log('（复用已在监听的 127.0.0.1:' + PORT + '，不另起服务器）');
  else srv = spawn(process.execPath, [path.join(SERVE_ROOT, 'serve.cjs'), String(PORT)],
    { cwd: SERVE_ROOT, stdio: 'ignore' });
  await sleep(1200);

  // ---- 起浏览器（假麦克风 = 180 Hz 测试音）----
  console.log('浏览器：' + browsers.describe(BROWSER));
  const wav = path.join(os.tmpdir(), 'e2e-180hz.wav');
  makeWav(wav, 180, 4, 48000);
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-cdp-'));
  const chrome = spawn(BROWSER.path, [
    '--headless=new',
    `--remote-debugging-port=${PORT + 10}`,
    `--user-data-dir=${ud}`,
    '--no-first-run', '--disable-gpu',
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    `--use-file-for-fake-audio-capture=${wav}`
  ], { stdio: 'ignore' });

  let ver = null;
  for (let i = 0; i < 60; i++) {
    try { ver = await getJson(`http://127.0.0.1:${PORT + 10}/json/version`); break; }
    catch (e) { await sleep(400); }
  }
  if (!ver) throw new Error('Chrome 调试端口未就绪');

  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const pend = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
  };
  const send = (method, params, sid) => new Promise((res) => {
    const mid = ++id; pend.set(mid, res);
    ws.send(JSON.stringify({ id: mid, method, params: params || {}, sessionId: sid }));
  });

  const t = await send('Target.createTarget', { url: 'about:blank' });
  const at = await send('Target.attachToTarget', { targetId: t.result.targetId, flatten: true });
  const sid = at.result.sessionId;
  await send('Runtime.enable', {}, sid);
  await send('Page.enable', {}, sid);

  const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate',
      { expression: expr, returnByValue: true, awaitPromise: true }, sid);
    if (r.result && r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
    return r.result.result.value;
  };
  const waitFor = async (expr, ms = 20000, step = 300) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      try { if (await evalJs(expr)) return true; } catch (e) { /* 过渡态 */ }
      await sleep(step);
    }
    return false;
  };

  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}${PAGE}` }, sid);
  await sleep(2500);

  // 清库，保证从 0 开始
  await evalJs(`new Promise(r=>{try{const q=indexedDB.deleteDatabase('xz-dialect-rec');q.onsuccess=q.onerror=q.onblocked=()=>r(1);}catch(e){r('denied:'+e.name)}})`);
  await send('Page.reload', {}, sid);
  await sleep(2200);

  // ---- A13 知情同意（运行时，不看源码字符串）----
  const consentOn = await evalJs(`(()=>{const c=document.getElementById('consent');return {on:c.classList.contains('on'),disp:getComputedStyle(c).display}})()`);
  check('A13a', '首次打开时知情同意弹层可见', !!consentOn.on && consentOn.disp === 'grid', JSON.stringify(consentOn));

  await evalJs(`(document.getElementById('consentOk')||{click(){}}).click()`);
  await sleep(500);

  const consentOff = await evalJs(`(()=>{const c=document.getElementById('consent');return {on:c.classList.contains('on'),disp:getComputedStyle(c).display,ls:localStorage.getItem('xz-dialect-consent-v1')}})()`);
  check('A13b', '点「我知道了」后关闭并写入 localStorage',
    !consentOff.on && consentOff.disp === 'none' && !!consentOff.ls, JSON.stringify(consentOff));

  const banner0 = await evalJs(`document.getElementById('banner').textContent.trim()`);
  check('A18d', '加载后 #banner 为空（不靠 console 判断）', banner0 === '', banner0 ? `banner="${banner0}"` : '空');

  const prog0 = await evalJs(`document.getElementById('progress').textContent.trim()`);
  const total = await evalJs(`(window.PROMPTS||[]).length`);
  check('A17-0', '初始进度为 0 / N', progressIs(prog0, 0, total), `"${prog0}"，题库 ${total} 题`);

  // ---- 第一步：录音并保存 ----
  await evalJs(`document.getElementById('recBtn').click()`);
  await sleep(3200);
  await evalJs(`document.getElementById('recBtn').click()`);
  const analyzed = await waitFor(`document.getElementById('resultRow').style.display === 'block'`, 25000);
  check('A17-1a', '录音→分析完成，出结果区', analyzed,
    analyzed ? await evalJs(`document.getElementById('metrics').textContent.replace(/\\s+/g,' ').trim().slice(0,90)`) : '超时');

  const bannerA = await evalJs(`document.getElementById('banner').textContent.trim()`);
  check('A17-1b', '分析阶段 #banner 无「出错/失败」',
    !/出错|失败|is not defined/.test(bannerA), bannerA ? `banner="${bannerA}"` : '空');

  // ---- A10 说法必填（运行时：真空着点保存，看是否被拒）----
  await evalJs(`(()=>{const e=document.getElementById('fSaying');e.value='';e.dispatchEvent(new Event('input',{bubbles:true}));return 1;})()`);
  await evalJs(`document.getElementById('saveBtn').click()`);
  await sleep(1000);
  const bannerA10 = await evalJs(`document.getElementById('banner').textContent.trim()`);
  const cntA10 = await evalJs(`document.querySelectorAll('#list [data-del]').length`);
  check('A10', '说法为空时保存被拒（运行时实测）',
    /先填/.test(bannerA10) && cntA10 === 0, `banner="${bannerA10}"，列表=${cntA10}`);

  await evalJs(`(()=>{const e=document.getElementById('fSaying');e.value='测试说法';e.dispatchEvent(new Event('input',{bubbles:true}));return 1;})()`);
  await evalJs(`document.getElementById('saveBtn').click()`);
  const saved = await waitFor(`document.querySelectorAll('#list .item, #list > div').length >= 1 && !document.querySelector('#list .empty')`, 15000);
  const bannerB = await evalJs(`document.getElementById('banner').textContent.trim()`);
  check('A17-1c', '点击保存后 #banner 无错误', !/出错|失败|is not defined/.test(bannerB), bannerB ? `banner="${bannerB}"` : '空');

  // ---- 第二步：列表出现 ----
  const listText1 = await evalJs(`document.getElementById('list').textContent.replace(/\\s+/g,' ').trim().slice(0,120)`);
  const cnt1 = await evalJs(`document.querySelectorAll('#list [data-del]').length`);
  const prog1 = await evalJs(`document.getElementById('progress').textContent.trim()`);
  check('A17-2', '列表出现 1 条且进度推进到 1 / N',
    saved && cnt1 === 1 && progressIs(prog1, 1, total),
    `条数=${cnt1}，进度="${prog1}"，列表="${listText1}"`);

  // ---- 第三步：刷新后仍在 ----
  await send('Page.reload', {}, sid);
  await sleep(2600);
  const cnt2 = await evalJs(`document.querySelectorAll('#list [data-del]').length`);
  const prog2 = await evalJs(`document.getElementById('progress').textContent.trim()`);
  const bannerC = await evalJs(`document.getElementById('banner').textContent.trim()`);
  check('A17-3', '刷新页面后记录仍在（IndexedDB 持久化）',
    cnt2 === 1 && progressIs(prog2, 1, total) && !/失败|出错/.test(bannerC),
    `条数=${cnt2}，进度="${prog2}"，banner="${bannerC || '空'}"`);

  // ---- 第四步：删除回退 ----
  await evalJs(`document.querySelector('#list [data-del]').click()`);
  const gone = await waitFor(`document.querySelectorAll('#list [data-del]').length === 0`, 12000);
  const prog3 = await evalJs(`document.getElementById('progress').textContent.trim()`);
  check('A17-4', '删除后列表清空、进度回退 0 / N',
    gone && progressIs(prog3, 0, total), `进度="${prog3}"`);

  // ---- A21 导出物运行时检查（取代 selftest 里 A11/A12/A14 那三条源码正则）----
  // 判据必须落在"产出的文件"上：源码里有 <th>题目 / 说法</th> 不等于导出的表格里真有这一列。
  // 做法：造两条带策略的探针 → 刷新让页面重读存档 → 拦下 download 的 Blob → 在页面内用
  // DOMParser / JSON.parse 解析 → 断言列、行、策略计数、capture 字段。
  await evalJs(`(async()=>{
    const put=(id,say,str)=>window.__probe.store.put({id:id,promptId:'a21-'+id,atlasId:null,
      text:'探针'+id,saying:say,bucket:'home',gen:1,speaker:'姐',correct:2,common:1,
      strategy:str,strategyBy:'我',createdAt:Date.now(),voiceDur:'0.50s',meanF0:180,
      contourMode:'none',category:'—',contour:'—',dynamicSemitones:0,
      capture:{ctxRate:48000,factor:4,analysisRate:12000,agc:false},
      blob:new Blob([new Uint8Array([1,2,3])],{type:'audio/webm'})});
    await put('yin','洋柿子','借音');
    await put('yi','洋柿子二','意译');
    return 1;
  })()`);
  await send('Page.reload', {}, sid);
  await sleep(2600);

  // 拦 download：不真的存盘，但把 Blob 留住；同时装 DOMParser 解析结果
  await evalJs(`(()=>{
    window.__capHtml=''; window.__capJson='';
    if (!window.__patched) {
      window.__patched = 1;
      const oc = URL.createObjectURL.bind(URL);
      URL.createObjectURL = function(b){ window.__lastBlob = b; return oc(b); };
      HTMLAnchorElement.prototype.click = function(){};
    }
    return 1;
  })()`);

  const grabJson = await evalJs(`(async()=>{
    window.__lastBlob = null;
    document.getElementById('exportJson').click();
    for (let i=0;i<40 && !window.__lastBlob;i++) await new Promise(r=>setTimeout(r,100));
    window.__capJson = window.__lastBlob ? await window.__lastBlob.text() : '';
    return window.__capJson.length;
  })()`);
  const grabHtml = await evalJs(`(async()=>{
    window.__lastBlob = null;
    document.getElementById('exportHtml').click();
    for (let i=0;i<80 && !window.__lastBlob;i++) await new Promise(r=>setTimeout(r,150));
    window.__capHtml = window.__lastBlob ? await window.__lastBlob.text() : '';
    return window.__capHtml.length;
  })()`);

  const htmlProbe = await evalJs(`(()=>{
    const doc = new DOMParser().parseFromString(window.__capHtml || '', 'text/html');
    const ths = [...doc.querySelectorAll('thead th')].map(t=>t.textContent.trim());
    const trs = [...doc.querySelectorAll('tbody tr')];
    return {
      title: doc.title,
      ths: ths,
      rows: trs.length,
      sayings: trs.map(r=>{const s=r.querySelector('.say');return s?s.textContent.trim():null}),
      tally: (doc.body.textContent.match(/填补策略分布：[^（]{0,80}/)||[''])[0].trim(),
      svgPts: doc.querySelectorAll('svg circle').length
    };
  })()`);

  const jsonProbe = await evalJs(`(()=>{
    let j=null; try { j = JSON.parse(window.__capJson); } catch(e) { return {err:String(e)}; }
    const clips = (j && j.clips) || [];
    return {
      total: j && j.total,
      n: clips.length,
      sayings: clips.map(c=>c.saying),
      strategies: clips.map(c=>c.strategy),
      hasBlob: clips.some(c=>'blob' in c),
      captures: clips.map(c=>c.capture || null)
    };
  })()`);

  check('A21a', '导出的 HTML 有「说法」列且每行都带说法；JSON 每条含 saying',
    !!htmlProbe && htmlProbe.ths.length === 5 && htmlProbe.ths[0] === '题目 / 说法' &&
      htmlProbe.rows === 2 && htmlProbe.sayings.indexOf('洋柿子') >= 0 &&
      !!jsonProbe && jsonProbe.n === 2 && jsonProbe.sayings.every((s) => !!s && s.length > 0) && !jsonProbe.hasBlob,
    `HTML 列=${JSON.stringify((htmlProbe || {}).ths)}，行=${(htmlProbe || {}).rows}，说法=${JSON.stringify((htmlProbe || {}).sayings)}；` +
    `JSON 条数=${(jsonProbe || {}).n}，含 blob=${(jsonProbe || {}).hasBlob}，字符=${grabHtml}/${grabJson}`);

  const stratOk = !!jsonProbe && jsonProbe.strategies.slice().sort().join(',') === ['意译', '借音'].sort().join(',');
  check('A21b', '导出物能按数据统计出三类策略（不是写死的常量）',
    !!(htmlProbe && /借音 1 条/.test(htmlProbe.tally) && /意译 1 条/.test(htmlProbe.tally) && /旧词延伸 0 条/.test(htmlProbe.tally)) && stratOk,
    `HTML 统计="${(htmlProbe || {}).tally}"，JSON 每条策略=${JSON.stringify((jsonProbe || {}).strategies)}`);

  const caps = (jsonProbe && jsonProbe.captures) || [];
  const capOk = caps.length === 2 && caps.every((c) => c && c.ctxRate && c.factor && c.analysisRate && c.agc === false);
  check('A21c', '导出 JSON 的 capture 带 ctxRate/factor/analysisRate 且 AGC 恒 false',
    capOk, JSON.stringify(caps[0] || null));

  // A21d：跨浏览器的降级路径 —— 没有 OfflineAudioContext（Safari 旧版走 webkit 前缀、某些 WebView 干脆没有）
  // 时，导出必须把这一格降级成「音频转换失败，请用 JSON 备份」，而不是整张表塌掉或直接报错退出。
  const degraded = await evalJs(`(async()=>{
    const a = window.OfflineAudioContext, b = window.webkitOfflineAudioContext;
    try { window.OfflineAudioContext = undefined; window.webkitOfflineAudioContext = undefined; } catch (e) {}
    window.__lastBlob = null;
    document.getElementById('exportHtml').click();
    for (let i=0;i<80 && !window.__lastBlob;i++) await new Promise(r=>setTimeout(r,150));
    const html = window.__lastBlob ? await window.__lastBlob.text() : '';
    try { window.OfflineAudioContext = a; window.webkitOfflineAudioContext = b; } catch (e) {}
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const trs = [...doc.querySelectorAll('tbody tr')];
    return {
      rows: trs.length,
      sayings: trs.map(r=>{const s=r.querySelector('.say');return s?s.textContent.trim():null}),
      miss: doc.querySelectorAll('.miss').length,
      banner: document.getElementById('banner').textContent.trim()
    };
  })()`);
  check('A21d', '没有 OfflineAudioContext 时导出降级为「转换失败」，表格与说法仍在',
    !!degraded && degraded.rows === 2 && degraded.miss === 2 &&
      degraded.sayings.indexOf('洋柿子') >= 0 && !/出错|失败：/.test(degraded.banner),
    `行=${(degraded || {}).rows}，失效音频格=${(degraded || {}).miss}，说法=${JSON.stringify((degraded || {}).sayings)}，banner="${(degraded || {}).banner}"`);

  // 清掉探针，别把 A20 的计数搅浑
  await evalJs(`(async()=>{ await window.__probe.store.del('a21-yin'); await window.__probe.store.del('a21-yi'); return 1; })()`);

  // ---- A20 版本处理回归：被造出 v1 空库 → 自愈 → **刷新后还要能存** ----
  // 这条是补 2026-11-03 那次事故用的：自愈把库抬到 v2 之后，若仍用
  // open(name, 1) 去访问，下一次加载直接 VersionError，等于"修一次坏每次"。
  // 当时只验了"自愈后能存"，没验"刷新后还能存"，所以缺陷是靠反向脚本才暴露的。
  //
  // 造空库必须在**不持有连接的同源页**上做。踩过的坑：直接在采样台页面 deleteDatabase，
  // 页面自己那条连接会让它一直 blocked（delete 没真正完成，空库也没造出来），
  // 紧随其后的 open 又排在未完成的 delete 后面且没有 onblocked —— awaitPromise 永不返回，
  // 整个套件挂死在第 15 项。所以这里先离开页面，再找一个纯静态同源资源落脚。
  const evalT = async (expr, ms = 5000) => Promise.race([evalJs(expr), sleep(ms).then(() => 'TIMEOUT')]);

  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}${PAGE}prompts.js` }, sid);
  await sleep(900);
  const mkDel = await evalT(`new Promise(r=>{
    const q=indexedDB.deleteDatabase('xz-dialect-rec');
    q.onsuccess=()=>r('deleted');
    q.onerror=()=>r('ERR:'+(q.error&&q.error.name));
    q.onblocked=()=>r('BLOCKED');
  })`);
  const mkOpen = await evalT(`new Promise(r=>{
    const q=indexedDB.open('xz-dialect-rec',1);
    q.onupgradeneeded=function(){};
    q.onsuccess=function(){q.result.close();r('v'+q.result.version+'/stores='+q.result.objectStoreNames.length)};
    q.onerror=function(){r('ERR:'+q.error.name)};
    q.onblocked=function(){r('BLOCKED')};
  })`);
  check('A20-0', '已人为造出 v1 空库（无 clips 表，前提成立才算数）',
    mkDel === 'deleted' && mkOpen === 'v1/stores=0', `delete=${mkDel}, open=${mkOpen}`);

  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}${PAGE}` }, sid);
  await sleep(2600);
  const bannerA20 = await evalJs(`document.getElementById('banner').textContent.trim()`);
  const putA = await evalJs(`window.__probe.store.put({id:'a20-first',promptId:'a20',text:'探针',createdAt:Date.now(),blob:new Blob(['x'],{type:'audio/webm'})}).then(()=>1).catch(e=>('ERR:'+e.name))`);
  await send('Page.reload', {}, sid);
  await sleep(2600);
  const bannerA20b = await evalJs(`document.getElementById('banner').textContent.trim()`);
  const putB = await evalJs(`window.__probe.store.put({id:'a20-second',promptId:'a20',text:'探针2',createdAt:Date.now(),blob:new Blob(['x'],{type:'audio/webm'})}).then(()=>1).catch(e=>('ERR:'+e.name))`);
  const gotBoth = await evalJs(`window.__probe.store.all().then(a=>a.filter(x=>/^a20-/.test(x.id)).length).catch(e=>-1)`);
  const dbInfo = await evalJs(`indexedDB.databases?indexedDB.databases().then(l=>{const d=l.find(x=>x.name==='xz-dialect-rec');return d?d.name+'@'+d.version:'gone'}):'n/a'`);
  check('A20a', '人为 v1 空库后加载不报错（自愈不留下报错）',
    !/失败|出错|Error/.test(bannerA20), `banner="${bannerA20 || '空'}"`);
  check('A20b', '自愈后第一次能存', putA === 1, `put=${JSON.stringify(putA)}`);
  check('A20c', '刷新之后仍然能存（版本不降级、不再 VersionError）',
    putB === 1 && gotBoth === 2 && !/失败|出错/.test(bannerA20b),
    `刷新后 put=${JSON.stringify(putB)} 累计=${gotBoth} 库=${dbInfo} banner="${bannerA20b || '空'}"`);
  // 收尾同样要先离开页面，否则 delete 又被自己的连接挡住，等于没清
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}${PAGE}prompts.js` }, sid);
  await sleep(600);
  await evalT(`new Promise(r=>{
    const q=indexedDB.deleteDatabase('xz-dialect-rec');
    q.onsuccess=q.onerror=q.onblocked=()=>r(1);
  })`);

  // ---- 汇总 ----
  console.log('\n' + '='.repeat(72));
  console.log(`结果：${pass} 通过 / ${fail} 失败`);
  console.log('='.repeat(72));
  fs.writeFileSync(path.join(ROOT, 'tools', 'e2e-result.json'),
    JSON.stringify({
      at: new Date().toISOString(), node: process.version,
      browser: BROWSER.name, browserVersion: BROWSER.version,
      pass, fail, rows
    }, null, 2));

  ws.close();
  try { chrome.kill(); } catch (e) {}
  try { srv.kill(); } catch (e) {}
  try { fs.rmSync(ud, { recursive: true, force: true, maxRetries: 3 }); } catch (e) {}
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error('E2E 异常：', e.message); process.exit(2); });
