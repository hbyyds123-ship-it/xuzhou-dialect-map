/* ============================================================
   main.cjs — 免安装版启动器（打包进单个 exe）
   ------------------------------------------------------------
   做三件事：
     1. 在 127.0.0.1 上起一个只读静态服务器（浏览器只在 localhost 给麦克风，
        file:// 不行，所以必须有个本机服务）
     2. 用默认浏览器打开它
     3. 关掉这个黑窗口 = 关掉服务

   静态文件在打包时被塞进 exe（Node SEA），运行时不依赖任何外部文件；
   开发态（node portable/main.cjs）则直接读仓库里的文件，方便改完就试。
   ============================================================ */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

let sea = null;
try { sea = require('node:sea'); } catch (e) { /* 老版本 Node 没有 */ }
const IS_SEA = !!(sea && typeof sea.isSea === 'function' && sea.isSea());
const HERE = __dirname;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.webm': 'audio/webm',
  '.flac': 'audio/flac',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8'
};

/** 从 exe 内嵌资源或磁盘读一个文件；都没有就返回 null */
function readAsset(rel) {
  if (IS_SEA) {
    try {
      const buf = sea.getAsset(rel);
      if (!buf) return null;
      return Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
    } catch (e) { return null; }
  }
  try { return fs.readFileSync(path.join(HERE, '..', rel)); } catch (e) { return null; }
}

function send(res, code, type, body) {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}

const server = http.createServer((req, res) => {
  let url;
  try { url = decodeURIComponent((req.url || '/').split('?')[0]); } catch (e) {
    return send(res, 400, 'text/plain; charset=utf-8', '400');
  }
  if (url.endsWith('/')) url += 'index.html';
  const rel = url.replace(/^\/+/, '');

  // 只允许仓库内的相对路径，挡掉 ../ 之类
  if (rel.includes('..')) return send(res, 403, 'text/plain; charset=utf-8', '403');

  const data = readAsset(rel);
  if (!data) {
    return send(res, 404, 'text/html; charset=utf-8',
      '<meta charset="utf-8"><body style="font:14px/1.8 system-ui;padding:40px">' +
      '<h1 style="font-size:18px">没有这个文件：' + rel.replace(/[<>&]/g, '') + '</h1>' +
      '<p><a href="/">回地图</a> · <a href="/recorder/">回采样台</a></p></body>');
  }
  const ext = path.extname(rel).toLowerCase();
  send(res, 200, MIME[ext] || 'application/octet-stream', data);
});

function listen(port) {
  return new Promise((resolve, reject) => {
    const onErr = (e) => { server.removeListener('listening', onOk); reject(e); };
    const onOk = () => { server.removeListener('error', onErr); resolve(port); };
    server.once('error', onErr);
    server.once('listening', onOk);
    server.listen(port, '127.0.0.1');
  });
}

function openBrowser(url) {
  const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try {
    const p = spawn(cmd[0], cmd[1], { detached: true, stdio: 'ignore' });
    p.unref();
  } catch (e) { /* 打不开就让人手点 */ }
}

/* 端口漂移 = 用户的卷"不见了"。
   localStorage 按 origin 分：这次开在 8000、下次因为 8000 被上一次的进程占着就落到 8001，
   同一个节目在浏览器眼里就是两个不同的站点 —— 建的卷、录的音全都不在了（其实还在）。
   所以先问一句"8000 上是不是已经有一个乡音册"，是就直接打开它，不再起第二个服务。 */
function probe(base) {
  return new Promise((resolve) => {
    const req = http.get(base, { timeout: 1200 }, (r) => {
      let b = '';
      r.setEncoding('utf8');
      r.on('data', (d) => { if (b.length < 8000) b += d; });
      r.on('end', () => resolve(r.statusCode === 200 && b.includes('data-vol="title"')));
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

async function main() {
  const argv = process.argv.slice(2);
  const selfTest = argv.includes('--self-test');
  const noOpen = argv.includes('--no-open');

  // 已经开着一份：复用它，别另起一个 origin（那会让已有的卷看起来消失了）
  if (!selfTest) {
    for (const p of [8000, 8001, 8002, 8003, 8080]) {
      const base = 'http://127.0.0.1:' + p + '/';
      if (await probe(base)) {
        console.log('  乡音册已经开着了，直接用这一个：' + base);
        if (!noOpen) openBrowser(base);
        return;
      }
    }
  }

  let port = 0;
  for (const p of [8000, 8001, 8002, 8003, 8080, 0]) {
    try { port = await listen(p); break; } catch (e) { /* 换下一个 */ }
  }
  const base = 'http://127.0.0.1:' + port + '/';

  if (selfTest) {
    const get = (u) => new Promise((res, rej) => {
      http.get(u, (r) => { let b = ''; r.on('data', (d) => (b += d)); r.on('end', () => res({ code: r.statusCode, body: b })); }).on('error', rej);
    });
    const checks = [];
    const home = await get(base);
    checks.push(['地图首页', home.code === 200 && home.body.includes('乡音册')]);
    const rec = await get(base + 'recorder/');
    // 别拿标题文案当判据：标题会随卷变（改成「采录 · 乡音册」那天这条就误报过）
    checks.push(['采样台', rec.code === 200 && rec.body.includes('id="recBtn"')]);
    // 演示包：换机器演示要靠它把录音带走。
    // 还要盯住「整段录音」这条路：accept 只收 .json 时，用户文件夹里的 m4a
    // 会被系统过滤成空白；递件库没带进 exe，导入按钮就是一句漂亮废话。
    const inboxJs = await get(base + 'features/inbox.js');
    checks.push(['演示包', rec.body.includes('demoExport') && rec.body.includes('导入演示包') &&
      /id="demoFile"[^>]*\.m4a/.test(rec.body) && rec.body.includes('id="audioImport"') &&
      rec.body.includes('features/inbox.js') && inboxJs.code === 200 &&
      inboxJs.body.includes('xz-splice-inbox')]);
    const css = await get(base + 'css/paper.css');
    checks.push(['纸本样式', css.code === 200 && css.body.includes('--paper')]);
    const js = await get(base + 'js/app.js');
    checks.push(['地图脚本', js.code === 200 && js.body.includes('renderWordPanel')]);
    const rjs = await get(base + 'recorder/app.js');
    checks.push(['采样台脚本', rjs.code === 200 && rjs.body.includes('stampOnce')]);
    // 范本音这条链是两个文件：清单 + 模块。少一个，界面上就静默没有"♪"
    const refsData = await get(base + 'data/refs.js');
    checks.push(['范本音清单', refsData.code === 200 && refsData.body.includes('window.REFS')]);
    const refsJs = await get(base + 'features/refs.js');
    checks.push(['范本音模块', refsJs.code === 200 && refsJs.body.includes('xz-dialect-refs')]);
    // 「开一卷」是这一版的主打：缺了它，用户就只能用徐州（样板房）
    const volPage = await get(base + 'volumes.html');
    checks.push(['开一卷', volPage.code === 200 && volPage.body.includes('给你的家乡开一卷')]);
    // 导入的界面也在这一页：卷能生不能搬，等于只能活在这台浏览器里
    checks.push(['卷的导入', volPage.body.includes('导入已有的一卷')]);
    const volJs = await get(base + 'features/volumes.js');
    checks.push(['卷库', volJs.code === 200 && volJs.body.includes('xzdt.volumes.v1') && volJs.body.includes('importJSON')]);
    // 「测一测」在自建卷里得真的能出题：只写词、不写释义是很正常的用法，
    // 旧逻辑那时会把干扰项去重成一个空按钮 —— 打包时就要盯住这一条。
    const quizJs = await get(base + 'features/quiz.js');
    const boardJs = await get(base + 'features/vol-board.js');
    checks.push(['测一测', quizJs.code === 200 && quizJs.body.includes('听音辨词') &&
      quizJs.body.includes('kindOf') && quizJs.body.includes('showEmpty') &&
      boardJs.code === 200 && boardJs.body.includes('至少 2 个词才能出题')]);
    const aboutJs = await get(base + 'features/about-vol.js');
    checks.push(['关于本卷', aboutJs.code === 200 && aboutJs.body.includes('给你的家乡开一卷')]);
    const three = await get(base + 'vendor/three.min.js');
    checks.push(['three.js', three.code === 200 && three.body.length > 100000]);
    checks.forEach(([n, ok]) => console.log((ok ? '✓ ' : '✗ ') + n));
    const bad = checks.filter((c) => !c[1]).length;
    console.log(`\n自检：${checks.length - bad} 通过 / ${bad} 失败（端口 ${port}）`);
    server.close();
    process.exit(bad ? 1 : 0);
  }

  console.log('');
  console.log('  乡音册 · 徐州方言档案');
  console.log('  ─────────────────────────────');
  console.log('  地图    ' + base);
  console.log('  采样台  ' + base + 'recorder/');
  console.log('');
  console.log('  关掉这个窗口，服务就停了。录音只存在本机浏览器里，不会上传。');
  console.log('');

  if (!noOpen) openBrowser(base);
}

main().catch((e) => {
  console.error('启动失败：', e && e.message);
  process.exit(1);
});
