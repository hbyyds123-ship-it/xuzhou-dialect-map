#!/usr/bin/env node
/* ============================================================
   tools/check-volume.cjs — 卷数据守门
   ------------------------------------------------------------
   换一卷最怕的不是缺东西，是**填了一半还以为成了**：
   标题是新的、词表还是旧的；或者印章字写成两个字，页面上直接撑破。

   这里只检查"卷"这一层，不碰数据内容对不对：
     ✗ 必须有的字段（缺了页面会残）
     ! 建议有的字段（缺了不报错，但"这一卷"就说不清来路）

   用法：npm run volume
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const FILE = 'data/volume.js';

let pass = 0, warn = 0, fail = 0;
const ok = (m) => { pass++; console.log('✓ ' + m); };
const warnf = (m) => { warn++; console.log('! ' + m); };
const bad = (m) => { fail++; console.log('✗ ' + m); };

function load() {
  const code = fs.readFileSync(path.join(ROOT, FILE), 'utf8');
  const sb = { window: {} };
  vm.runInNewContext(code, sb, { filename: FILE });
  return sb.window.VOLUME || {};
}

const V = load();

// --- 必须有 ---
if (/^[a-z][a-z0-9-]*$/.test(String(V.id || ''))) ok(`卷 id 合规：${V.id}`);
else bad(`卷 id 不合规：「${V.id || '(空)'}」要小写字母开头，只含小写字母/数字/连字符`);

['title', 'name'].forEach((k) => {
  if (V[k] && String(V[k]).trim()) ok(`${k}：${V[k]}`);
  else bad(`缺 ${k}（页面标题会退回默认值，等于没换卷）`);
});

if (V.dialect && String(V.dialect).trim()) ok(`方言名：${V.dialect}`);
else bad('缺 dialect（学习侧那句"这句××话的意思是？"会退回"徐州话"）');

if (typeof V.mark === 'string' && Array.from(V.mark).length === 1) ok(`印章字：${V.mark}（单字）`);
else bad(`印章字 mark 必须是 1 个字，现在是「${V.mark}」（两个字会把印章撑破）`);

if (Number.isInteger(V.no) && V.no > 0) ok(`卷号：第 ${V.no} 卷`);
else bad(`卷号 no 必须是正整数，现在是 ${JSON.stringify(V.no)}`);

// --- 建议有：缺了不拦，但要说清 ---
if (V.scope && String(V.scope).trim()) ok(`范围：${V.scope}`);
else warnf('没填 scope（"关于本卷"里范围一栏会显示「未填」）');

if (V.survey && String(V.survey).trim()) ok(`语料依据：${V.survey}`);
else warnf('没填 survey（词从哪本方言志来的？这一栏空着，别人没法核）');

if (V.refsBy && String(V.refsBy).trim()) ok(`范本音发音人：${V.refsBy}`);
else warnf('没填 refsBy（还没请人念；学习侧此刻仍在播普通话合成）');

if (V.mapSource && String(V.mapSource).trim()) ok(`边界来源：${V.mapSource}`);
else warnf('没填 mapSource —— 本地演示可以先空，**公开上线必须有审图号**');

if (V.dataLicense && String(V.dataLicense).trim()) ok(`授权：${V.dataLicense}`);
else warnf('没填 dataLicense（词条的授权方式，发布前定下来）');

console.log(`\n卷体检：${pass} 通过 / ${warn} 提醒 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
