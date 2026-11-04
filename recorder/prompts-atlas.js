/* ============================================================
   prompts-atlas.js — 把《乡音册》的统一词表变成采样题
   ------------------------------------------------------------
   真源只有一个：../data/atlas.js 的 ATLAS.words（54 条）。
   本文件不改写它、也不复制它，只在运行时派生题目：

     · 词表里新增一个词 → 采样题自动多一道，无需两头维护
     · 词形已与 prompts.js 里某道题相同的（实测 3 条：茅子 / 屋当门 / 手捏子），
       不重复出题，而是把 atlasId 挂回原条目 —— 这样你原来录的那条
       也能被地图认出来，不必重录
     · atlasId 是两边唯一的连接字段：采样台写索引、地图按它取真人录音

   atlas.js 不存在时（单独拷走 recorder/ 目录）本文件静默跳过，
   题库仍是 prompts.js 的原始题量。
   ============================================================ */
(function () {
  'use strict';

  var A = window.ATLAS, P = window.PROMPTS;
  if (!A || !A.words || !A.words.length || !P) {
    window.PROMPTS_META = { atlasAdded: 0, atlasMerged: 0, atlasTotal: 0, atlasSkipped: 'no-atlas' };
    return;
  }

  var indexOfText = {};
  P.forEach(function (p, i) { if (!(p.text in indexOfText)) indexOfText[p.text] = i; });

  var added = 0, merged = 0, dup = 0;

  A.words.forEach(function (w) {
    if (!w || !w.w || !w.id) return;

    if (w.w in indexOfText) {
      var p = P[indexOfText[w.w]];
      if (!p.atlasId) { p.atlasId = w.id; merged++; }
      return;
    }

    P.push({
      id: 'a-' + w.id,
      atlasId: w.id,
      bucket: 'atlas',
      text: w.w,
      hint: '这个词在你家怎么说？跟题目一样就照说，不一样就说你家的说法。' +
            (w.meaning ? '（标准释义：' + w.meaning + '）' : '') +
            (w.example ? '例句：' + w.example : ''),
      gloss: w.meaning || ''
    });
    indexOfText[w.w] = P.length - 1;
    added++;
  });

  window.PROMPTS_META = { atlasAdded: added, atlasMerged: merged, atlasTotal: A.words.length, atlasSkipped: null };
})();
