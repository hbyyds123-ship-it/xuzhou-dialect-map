/* ============================================================
   make-icon.cjs — 用浏览器把图标画出来，存成多尺寸 .ico
   ------------------------------------------------------------
   为什么这么绕：不想为了一个图标引 Pillow / ImageMagick。
   本机已经有 Chromium（测试也在用），直接让它按每个尺寸渲染一次，
   像素对齐比"画 256 再缩小"更清楚；.ico 只是把几张 PNG 排个目录，纯 JS 就能拼。

   图标语言跟界面一致：朱色方章 + 纸色「徐」，方角、无渐变、无阴影——
   16px 下也认得出是一枚印章。

   用法：node portable/make-icon.cjs [输出路径]
   ============================================================ */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const browsers = require('../recorder/tools/browsers.cjs');

const OUT = process.argv[2] || path.join(__dirname, 'icon.ico');
const SIZES = [16, 24, 32, 48, 64, 128, 256];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const getJson = (u) => new Promise((res, rej) => { http.get(u, (r) => { let b = ''; r.on('data', (d) => (b += d)); r.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } }); }).on('error', rej); });

function html(size) {
  const edge = size <= 24 ? 1 : size <= 48 ? 2 : 3;
  const inset = Math.max(2, Math.round(size * 0.075));
  const fs2 = Math.round(size * 0.60);
  return '<!doctype html><meta charset="utf-8"><body style="margin:0;overflow:hidden">' +
    '<div style="position:relative;width:' + size + 'px;height:' + size + 'px;background:#A63B2A">' +
    '<div style="position:absolute;inset:' + inset + 'px;border:' + edge + 'px solid rgba(243,237,225,.5)"></div>' +
    '<div style="position:absolute;inset:0;display:grid;place-items:center;color:#F3EDE1;' +
    'font-family:\'Songti SC\',\'SimSun\',\'Noto Serif SC\',serif;font-weight:700;' +
    'font-size:' + fs2 + 'px;line-height:1">徐</div>' +
    '</div></body>';
}

function buildIco(images) {
  const n = images.length;
  const head = Buffer.alloc(6);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(n, 4);
  const dirs = [];
  let offset = 6 + 16 * n;
  images.forEach((im) => {
    const d = Buffer.alloc(16);
    d.writeUInt8(im.size >= 256 ? 0 : im.size, 0);
    d.writeUInt8(im.size >= 256 ? 0 : im.size, 1);
    d.writeUInt8(0, 2); d.writeUInt8(0, 3);
    d.writeUInt16LE(1, 4); d.writeUInt16LE(32, 6);
    d.writeUInt32LE(im.png.length, 8);
    d.writeUInt32LE(offset, 12);
    offset += im.png.length;
    dirs.push(d);
  });
  return { ico: Buffer.concat([head, ...dirs, ...images.map((i) => i.png)]), dirs };
}

(async () => {
  const B = browsers.primary();
  if (!B) throw new Error('没有可用浏览器，先跑 node recorder/tools/browsers.cjs');
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'icon-'));
  const ch = spawn(B.path, [...browsers.commonFlags(), '--remote-debugging-port=8399', `--user-data-dir=${ud}`], { stdio: 'ignore' });

  let ver = null;
  for (let i = 0; i < 60; i++) { try { ver = await getJson('http://127.0.0.1:8399/json/version'); break; } catch (e) { await sleep(300); } }
  if (!ver) throw new Error('浏览器没起来');

  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const pend = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
  const send = (m, p, sid) => new Promise((res) => { const mid = ++id; pend.set(mid, res); ws.send(JSON.stringify({ id: mid, method: m, params: p || {}, sessionId: sid })); });

  const t = await send('Target.createTarget', { url: 'about:blank' });
  const at = await send('Target.attachToTarget', { targetId: t.result.targetId, flatten: true });
  const sid = at.result.sessionId;
  await send('Page.enable', {}, sid);

  const images = [];
  for (const size of SIZES) {
    await send('Emulation.setDeviceMetricsOverride', { width: size, height: size, deviceScaleFactor: 1, mobile: false }, sid);
    const url = 'data:text/html;charset=utf-8,' + encodeURIComponent(html(size));
    await send('Page.navigate', { url }, sid);
    await sleep(220);
    const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, sid);
    images.push({ size, png: Buffer.from(shot.result.data, 'base64') });
    console.log(`  · ${size}×${size}  ${(shot.result.data.length * 0.75 / 1024).toFixed(1)} KB`);
  }

  const { ico } = buildIco(images);
  fs.writeFileSync(OUT, ico);
  console.log(`✓ ${path.relative(process.cwd(), OUT)}（${SIZES.length} 个尺寸，${(ico.length / 1024).toFixed(0)} KB）`);

  ws.close();
  try { ch.kill(); } catch (e) { }
  try { fs.rmSync(ud, { recursive: true, force: true, maxRetries: 3 }); } catch (e) { }
})().catch((e) => { console.error('生成图标失败：', e.message); process.exit(1); });
