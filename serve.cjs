#!/usr/bin/env node
'use strict';
/*
 * serve.cjs — 本仓库的唯一本地服务器（地图 + 采录同源）
 *
 * 为什么需要它：浏览器只在 http://127.0.0.1 / http://localhost 这类可信来源给麦克风。
 * 双击 index.html（file://）时，地图的全部「学习」功能照常可用，采样台只能看不能录。
 * 两个页面必须由同一个服务器提供，录音索引与 IndexedDB 才是同源的、能互相读到。
 *
 * 用法：  node serve.cjs          → 打开 http://127.0.0.1:8000/
 *         node serve.cjs 8080     → 换端口
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = Number(process.argv[2] || 8000);
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.wav': 'audio/wav',
  '.webm': 'audio/webm',
  '.mp3': 'audio/mpeg',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8'
};

const server = http.createServer((req, res) => {
  let url;
  try {
    url = decodeURIComponent((req.url || '/').split('?')[0]);
  } catch (e) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('400 Bad Request（URL 编码不合法）');
    return;
  }

  const rel = url === '/' ? 'index.html' : url.replace(/^\/+/, '');
  const file = path.resolve(ROOT, rel);
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('403');
    return;
  }

  fs.stat(file, (err, st) => {
    let target = file;
    if (!err && st.isDirectory()) target = path.join(file, 'index.html');
    fs.readFile(target, (e, data) => {
      if (e) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('404 Not Found: ' + rel);
        return;
      }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(target).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-store'
      });
      res.end(data);
    });
  });
});

server.on('clientError', (err, socket) => { try { socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'); } catch (e) {} });

server.listen(PORT, '127.0.0.1', () => {
  console.log('学习模式（可直接双击，也可用这个地址）： http://127.0.0.1:' + PORT + '/');
  console.log('采录（要录音就必须用它）：            http://127.0.0.1:' + PORT + '/recorder/');
  console.log('双击 index.html 也能跑，但那时浏览器不给麦克风，采样台只能看不能录。');
});
