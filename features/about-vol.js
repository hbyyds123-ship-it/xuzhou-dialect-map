/* ============================================================
   features/about-vol.js — 「关于本卷」那一张卡
   ------------------------------------------------------------
   为什么单独一个文件：这张卡在两种卷里都要能打开。
     · 徐州卷（样板房）：js/app.js 负责 3D，卡片原先写在它里面；
     · 用户卷：js/app.js 顶部就 return 了（没有 3D），卡片得另有人管。
   放在这里，两边都调用同一个渲染器，文案不会长出两套。

   两条硬规矩（第 2 轮验收 G2 / G4）：
     1. 用户卷**不继承**第 1 卷的 CC BY-SA。没填许可就写「未声明 —— 仅本机自用」。
     2. 不对普通用户喊命令行。要开新卷就指向 volumes.html，npm 路径只留在 VOLUMES.md。
   ============================================================ */
(function () {
  'use strict';

  function $(s) { return document.querySelector(s); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[<>&"]/g, function (c) {
      return ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c];
    });
  }

  function open() {
    var modal = $('#modal'), card = $('#modalCard');
    if (!card) return;

    var V = (window.XZ && window.XZ.volume && window.XZ.volume.get()) || {};
    var custom = !!(window.XZ && window.XZ.volumes && window.XZ.volumes.isCustom());
    var words = (window.ATLAS && window.ATLAS.words) ? window.ATLAS.words.length : 0;
    var refN = (window.XZ && window.XZ.refs && window.XZ.refs.count) ? window.XZ.refs.count() : 0;

    /* 授权这一行是用户卷最容易出错的地方：V 是从 data/volume.js 复制来的，
       那里写着第 1 卷的 CC BY-SA。用户自己录的家人语料，不能被软件替他声明许可。 */
    var lic;
    if (V.dataLicense) lic = '词条 ' + V.dataLicense + '；代码 MIT';
    else if (custom) lic = '未声明 —— 仅本机自用';
    else lic = '';

    var missing = [
      ['语料依据', V.survey],
      ['范本音发音人', V.refsBy],
      ['边界来源', V.mapSource]
    ].filter(function (r) { return !r[1]; }).map(function (r) { return r[0]; });

    function row(k, v) {
      return '<div class="about-row"><dt>' + k + '</dt><dd>' +
        (v ? esc(v) : '<span class="about-miss">—</span>') + '</dd></div>';
    }

    card.innerHTML =
      '<div class="mc-head"><div><div class="mc-eyebrow">关于</div>' +
      '<h2 class="mc-title" style="font-size:19px">' + esc(V.title || '乡音册') + ' · 第 ' + (V.no || 1) + ' 卷</h2>' +
      '</div><button class="mc-close" data-close>×</button></div>' +
      '<div class="about-body">' +
        '<p class="about-lead">' + esc(V.name || '') + '是这一卷。</p>' +
        '<dl class="about-list">' +
          row('范围', V.scope) +
          row('语料依据', V.survey) +
          row('范本音', V.refsBy ? '由 ' + V.refsBy + ' 录制' : '') +
          row('边界数据', V.mapSource) +
          row('授权', lic) +
        '</dl>' +
        (missing.length
          ? '<p class="about-todo">' + missing.join(' / ') + ' 这 ' + missing.length + ' 栏空着，不是漏了：' +
            (missing.indexOf('范本音发音人') >= 0 ? '这一卷还没有一条请人念过的录音，' : '') +
            '来源要能查，所以在拿到之前宁可空着。填法见《开一卷》页。</p>'
          : '') +
        '<div class="about-vols">' +
          '<div class="av-row done"><span class="av-no">第 ' + (V.no || 1) + ' 卷</span><b>' + esc(V.name || '') + '</b>' +
            '<span class="av-st">已成卷</span></div>' +
          '<div class="av-row"><span class="av-no">第 ' + ((V.no || 1) + 1) + ' 卷</span><b>——</b>' +
            '<span class="av-st">空位 · 谁的老家谁开</span></div>' +
          '<div class="av-row more"><span class="av-no">第 ' + ((V.no || 1) + 2) + ' 卷起</span>' +
            '<b>…</b><span class="av-st">开卷不需要联系作者</span></div>' +
        '</div>' +
        '<div class="about-note">' +
          '<p>这不是一个「' + esc(V.name || '') + ' App」，是<strong>一卷可以复制的地方志</strong>。' +
          '引擎不动，换掉这一卷的词表、片区、录音，同一套代码就是另一座城 —— ' +
          '录音、学习、传承这三件事在每个方言区都成立。</p>' +
          '<p class="about-cmd"><a class="about-open" href="volumes.html">给你的家乡开一卷 →</a></p>' +
          '<p class="about-dim">现在这一卷的 ' + words + ' 个词里，' +
            (refN ? '有 ' + refN + ' 个请人念过' : '还没有一个请人念过 —— 学习侧你能听到的仍是普通话合成音') + '。</p>' +
        '</div>' +
      '</div>';

    Array.prototype.forEach.call(card.querySelectorAll('[data-close]'), function (b) {
      b.addEventListener('click', function () { modal.classList.remove('on'); });
    });
    modal.classList.add('on');
  }

  window.XZ = window.XZ || {};
  window.XZ.about = { open: open };

  /* 顶栏「第 N 卷」那枚小标签就是入口 —— 两种卷都绑，不再由 js/app.js 各自绑一次 */
  var tag = document.querySelector('.vol-tag');
  if (tag) {
    tag.style.cursor = 'pointer';
    tag.addEventListener('click', open);
  }
})();
