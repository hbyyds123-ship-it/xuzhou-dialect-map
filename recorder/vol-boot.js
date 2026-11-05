/* ============================================================
   vol-boot.js — 用户自建卷接管题库
   ------------------------------------------------------------
   必须在 prompts.js 之后、prompts-atlas.js 之前跑。

   徐州的 56 道原题（新事物/老器物/家词/句子）属于第 1 卷；
   切到用户卷时它们不该出现，否则用户会看到一堆不属于自己家乡的题。
   清空后由 prompts-atlas.js 从这一卷的词表重新派生。
   ============================================================ */
(function () {
  'use strict';
  var V = window.XZ && window.XZ.volumes;
  if (!V || !V.isCustom()) return;

  window.__VOL_CUSTOM__ = true;
  if (window.PROMPTS) window.PROMPTS.length = 0;
})();
