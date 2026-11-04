/* ============================================================
   anchor-check.cjs — 可独立求值段落的标记守卫（原"行号契约守卫"）
   ------------------------------------------------------------
   外部验收脚本需要三段能单独求值的代码：
     · Analysis 对象成员（mono / f0 / levels）
     · function stats(frames, levels)
     · function encodeWavBase64(samples, sr)

   旧版按固定行号（134–200 / 203–216 / 504–528）检查。行号一旦被插入操作挤走，
   切到的就是错的代码，而且常常不报错、只是悄悄给错结论 —— 本轮合并
   （app.js 增加录音索引回写）就把 encodeWavBase64 从 504 顶到了 505，
   旧检查因此变红。现改为按缩进标记提取（见 tools/extract.cjs）：
   标记找不到就抛错，不再依赖任何行号。

   用法：node tools/anchor-check.cjs
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, '..', 'app.js');
const SRC = fs.readFileSync(APP, 'utf8').split(/\r?\n/);
const ex = require('./extract.cjs')(SRC);

let fail = 0;
function check(label, ok, detail) {
  if (!ok) fail++;
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? '  — ' + detail : ''}`);
}

// A1：Analysis 成员必须能包成对象字面量求值，且含三个方法
let a1ok = true, a1detail = '';
try {
  const core = new Function('return ({' + ex.analysis() + '})')();
  a1ok = typeof core.mono === 'function' && typeof core.f0 === 'function' && typeof core.levels === 'function';
  a1detail = `mono/f0/levels ${a1ok ? '齐备' : '缺失'}`;
} catch (e) {
  a1ok = false; a1detail = '无法求值：' + e.message;
}
check('A1 Analysis 成员可独立求值且含 mono/f0/levels', a1ok, a1detail);

// A2：stats 必须是完整的函数表达式
let a2ok = false, a2detail = '';
try {
  const stats = new Function('return (' + ex.stats() + ')')();
  a2ok = typeof stats === 'function' && stats.length === 2;
  a2detail = a2ok ? 'stats(frames, levels) 可独立求值' : '签名不符';
} catch (e) {
  a2detail = '无法求值：' + e.message;
}
check('A2 stats 是完整函数表达式（按标记提取）', a2ok, a2detail);

// A3：encodeWavBase64 必须是完整的函数表达式
let a3ok = false, a3detail = '';
try {
  const enc = new Function('return (' + ex.wav() + ')')();
  a3ok = typeof enc === 'function' && enc.length === 2;
  a3detail = a3ok ? 'encodeWavBase64(samples, sr) 可独立求值' : '签名不符';
} catch (e) {
  a3detail = '无法求值：' + e.message;
}
check('A3 encodeWavBase64 是完整函数表达式（按标记提取）', a3ok, a3detail);

// A2/A3 不许引用本文件的闭包变量 —— 它们被单独求值，引用了就会在运行时报错。
// 用运行时验证而不是静态扫标识符：真跑一遍，看有没有 ReferenceError。
function runtimeFree(src, name, args, globals) {
  const names = Object.keys(globals);
  const vals = names.map((k) => globals[k]);
  try {
    const fn = new Function(...names, 'return (' + src + ')')(...vals);
    fn.apply(null, args);
    return { ok: true };
  } catch (e) {
    return { ok: false, err: e.message };
  }
}

// stats：喂两组帧，一组有浊音、一组全静音
const framesV = [
  { t: 0, f0: 180, r: 0.9, low: 0 }, { t: 0.1, f0: 190, r: 0.9, low: 0 },
  { t: 0.2, f0: 200, r: 0.9, low: 0 }, { t: 0.3, f0: 0, r: 0, low: 0 }
];
const framesQ = [{ t: 0, f0: 0, r: 0, low: 0 }];
const s1 = runtimeFree(ex.stats(), 'stats', [framesV, [3, 3, 4, 0]], { Math });
const s2 = runtimeFree(ex.stats(), 'stats', [framesQ, [0, 0, 0, 0]], { Math });
check('stats 不引用闭包变量（运行时）', s1.ok && s2.ok,
  s1.ok && s2.ok ? '两组输入均正常求值' : (s1.err || s2.err));

// encodeWavBase64：喂一段正弦
const N = 1600, sig = new Float64Array(N);
for (let i = 0; i < N; i++) sig[i] = 0.5 * Math.sin(2 * Math.PI * 440 * i / 16000);
const e1 = runtimeFree(ex.wav(), 'encodeWavBase64', [sig, 16000],
  { Math, ArrayBuffer, DataView, Uint8Array, btoa, String });
check('encodeWavBase64 不引用闭包变量（运行时）', e1.ok, e1.ok ? '正常求值并返回 base64' : e1.err);

console.log('='.repeat(68));
console.log(fail ? `标记提取/可求值检查未通过（${fail} 项）` : '三段独立代码均可按标记稳定提取');
console.log('='.repeat(68));
process.exit(fail ? 1 : 0);
