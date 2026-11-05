/* ============================================================
   core/volume.js — 把「这一卷是谁」落到页面上
   ------------------------------------------------------------
   data/volume.js 只有数据，这里负责把它写进 DOM：

     <h1 data-vol="title">乡音册</h1>
     <span data-vol="no">第 1 卷</span>
     <span data-vol="subtitle">徐州方言档案</span>
     <div class="brand-mark"><span data-vol="mark">乡</span></div>

   为什么不在 HTML 里写死、也不在构建时替换：卷是运行时概念。
   换卷有两条真实路径：换 data/volume.js（打包时定），或在《开一卷》页里
   建/切一卷（features/volumes.js，存 localStorage）。
   HTML 里保留一份默认文案，是为了让"没加载 JS 也能看懂这是什么"。

   缺字段一律回落到默认值 —— 一卷数据没填全，页面不该白屏。
   ============================================================ */
(function () {
  'use strict';

  var SRC = window.VOLUME || {};
  function pick(key, dflt) {
    var v = SRC[key];
    return (v === undefined || v === null || v === '') ? dflt : v;
  }

  var V = {
    id: pick('id', 'xuzhou'),
    no: pick('no', 1),
    title: pick('title', '乡音册'),
    name: pick('name', '徐州'),
    dialect: pick('dialect', '徐州话'),
    mark: pick('mark', '乡'),
    scope: pick('scope', ''),
    note: pick('note', ''),
    dataLicense: pick('dataLicense', ''),
    refsBy: pick('refsBy', ''),
    survey: pick('survey', ''),
    mapSource: pick('mapSource', '')
  };
  V.subtitle = V.name + '方言档案';
  V.series = '第 ' + V.no + ' 卷';

  var TEXT = {
    title: function () { return V.title; },
    subtitle: function () { return V.subtitle; },
    mark: function () { return V.mark; },
    no: function () { return V.series; },
    name: function () { return V.name; },
    dialect: function () { return V.dialect; },
    scope: function () { return V.scope; },
    recsmall: function () { return V.title + ' · ' + V.series; }
  };

  function apply(root) {
    var doc = document;

    // 标题与描述：搜索结果是别人对"格局"的第一印象。
    // 页面若自带标题（采样台），用 data-vol-title="keep" 声明，不要被这里盖掉。
    if (doc.documentElement.getAttribute('data-vol-title') !== 'keep') {
      doc.title = V.title + ' · ' + V.subtitle;
    }
    var md = doc.querySelector('meta[name="description"]');
    if (md) {
      md.setAttribute('content',
        V.title + '：' + V.name + '方言的录、学、传。' +
        (V.scope ? V.scope + '。' : '') + '一卷一个地方，同一套引擎可复制到任何方言区。');
    }

    var nodes = (root || doc).querySelectorAll('[data-vol]');
    Array.prototype.forEach.call(nodes, function (el) {
      var fn = TEXT[el.getAttribute('data-vol')];
      if (!fn) return;
      var s = fn();
      if (s) el.textContent = s;
    });
  }

  // data/volume.js 若在 body 末尾才加载，这里补一次；正常顺序下是幂等的
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { apply(); });
  } else {
    apply();
  }

  window.XZ = window.XZ || {};
  window.XZ.volume = {
    get: function () { return V; },
    name: V.name,
    dialect: V.dialect,
    title: V.title,
    no: V.no,
    apply: apply
  };
})();
