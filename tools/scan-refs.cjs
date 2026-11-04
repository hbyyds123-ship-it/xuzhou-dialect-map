#!/usr/bin/env node
/* ============================================================
   tools/scan-refs.cjs — 把 data/ref-audio/ 里的录音登记进 data/refs.js
   ------------------------------------------------------------
   范本音（请发音人录的"给定方言"）只有两件麻烦事：命名与登记。
   命名沿用一条规则，登记交给这个脚本，别手写。

     文件名可以是    maozi.mp3      （词条 id）
                    茅子.mp3        （词本身）
                    01-茅子.mp3     （前面带序号，自动剥掉）
                    01_maozi.wav

   用法： npm run refs        （或 node tools/scan-refs.cjs）
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const AUDIO_DIR = 'data/ref-audio';
const OUT = path.join(ROOT, 'data/refs.js');
const EXT = /\.(mp3|wav|m4a|ogg|oga|webm|flac)$/i;

/* atlas.js 是浏览器脚本（window.ATLAS = {...}），这里给个假 window 求值把它读出来 */
function loadWords() {
  const file = path.join(ROOT, 'data/atlas.js');
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: 'atlas.js' });
  return (sandbox.window.ATLAS && sandbox.window.ATLAS.words) || [];
}

function resolveName(filename, words) {
  let base = String(filename).replace(/\.[^./\\]+$/, '');
  base = base.replace(/^\s*\d+\s*[-_.、\s]+/, '').trim();
  if (!base) return null;
  const low = base.toLowerCase();

  let hit = words.find((w) => String(w.id).toLowerCase() === low);
  if (hit) return { id: hit.id, by: 'id' };
  hit = words.find((w) => String(w.w) === base);
  if (hit) return { id: hit.id, by: '词形' };
  const py = low.replace(/[\s'’·]/g, '');
  hit = words.find((w) => String(w.py || '').toLowerCase().replace(/[\s'’·]/g, '') === py);
  return hit ? { id: hit.id, by: '拼音' } : null;
}

function listAudio(dir, out) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return out;
  fs.readdirSync(abs, { withFileTypes: true }).forEach((d) => {
    const rel = dir + '/' + d.name;
    if (d.isDirectory()) listAudio(rel, out);
    else if (EXT.test(d.name)) out.push(rel);
  });
  return out;
}

function main() {
  const words = loadWords();
  const files = listAudio(AUDIO_DIR, []);
  const map = {};
  const miss = [];
  const dup = [];

  files.sort().forEach((rel) => {
    const name = path.basename(rel);
    const hit = resolveName(name, words);
    if (!hit) { miss.push(name); return; }
    if (map[hit.id]) { dup.push(`${name} ← 与 ${path.basename(map[hit.id])} 撞同一个词条 ${hit.id}`); return; }
    map[hit.id] = rel;
  });

  const body = Object.keys(map)
    .map((id) => `    ${JSON.stringify(id)}: ${JSON.stringify(map[id])}`)
    .join(',\n');

  const js = `/* ============================================================
   data/refs.js — 随包分发的范本音清单
   ------------------------------------------------------------
   范本音 = 请发音人录好的「给定方言」教学录音，用来替代浏览器里
   那个普通话合成音。两种来源：

     1. 随包分发（就是这里）：把文件放进 data/ref-audio/，
        再跑 \`npm run refs\` 自动重写这张表。**别手改**。
     2. 用户自己导入（拖进词条册）：只存在他自己的浏览器里，
        不进这个文件，也不进仓库。

   优先级：学习侧（听音选词）范本音优先；地图词条默认先播自家录音，
   自家没有才播范本音；两者都没有才是普通话合成，并明确标注。

   本次扫描：${files.length} 个音频文件 → 登记 ${Object.keys(map).length} 条
   ============================================================ */
window.REFS = {
  audio: {
${body || '    /* 还没有范本音。把文件放进 data/ref-audio/ 后跑 npm run refs */'}
  }
};
`;

  fs.writeFileSync(OUT, js, 'utf8');

  console.log(`扫描 ${AUDIO_DIR}/：${files.length} 个文件，登记 ${Object.keys(map).length} 条 → data/refs.js`);
  Object.keys(map).forEach((id) => {
    const w = words.find((x) => x.id === id);
    console.log(`  ✓ ${w ? w.w : id}  ←  ${path.basename(map[id])}`);
  });
  if (dup.length) { console.log('\n撞车（同一条只登记了第一个）：'); dup.forEach((d) => console.log('  ! ' + d)); }
  if (miss.length) {
    console.log('\n对不上词条（没有登记，改文件名后重跑）：');
    miss.forEach((m) => console.log('  ✗ ' + m));
    console.log('  文件名请用词条 id（maozi.mp3）或词本身（茅子.mp3）。');
  }
}

main();
