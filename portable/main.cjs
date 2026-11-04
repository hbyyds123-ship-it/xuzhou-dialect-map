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

async function main() {
  const argv = process.argv.slice(2);
  const selfTest = argv.includes('--self-test');
  const noOpen = argv.includes('--no-open');

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
    checks.push(['采样台', rec.code === 200 && rec.body.includes('方言采样台')]);
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
