/* ============================================================
   features/vol-board.js — 用户自建卷的「卷首页」
   ------------------------------------------------------------
   徐州卷走 3D 地形（有真实边界），用户卷走这张**分幅纸图**：
   片区是建卷人自己写的，词点可以在图上拖动定位。

   同一个「卷」的两种精度：
     · 有边界 → 3D 地形
     · 只有片区 → 分幅图
   这不是降级，是承认"别人手上没有 GeoJSON"这件事。

   本文件只在 window.__VOL_CUSTOM__ 为真时渲染（见 js/app.js 顶部）。
   ============================================================ */
(function () {
  'use strict';
  if (!window.__VOL_CUSTOM__) return;

  var V = window.XZ && window.XZ.volumes;
  var vol = V && V.current();
  if (!vol) return;

  function $(s) { return document.querySelector(s); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[<>&"]/g, function (c) {
      return ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c];
    });
  }
  function done(id) { return !!(window.XZ.sample && window.XZ.sample.has(id)); }
  function hasRef(id) { return !!(window.XZ.refs && window.XZ.refs.has(id)); }

  var doneCount = vol.words.filter(function (w) { return done(w.id); }).length;

  /* ---------- 骨架 ---------- */
  var board = document.createElement('div');
  board.className = 'vol-board';
  board.id = 'volBoard';
  board.innerHTML =
    '<div class="vb-head">' +
      '<div>' +
        '<div class="vb-eyebrow">第 ' + vol.no + ' 卷 · 片区示意</div>' +
        '<h1>' + esc(vol.name) + '</h1>' +
        '<p class="vb-sub">' + esc(vol.dialect) + ' · ' + vol.districts.length + ' 个片区 · ' +
          vol.words.length + ' 个词条 · 已录 ' + doneCount + ' 条</p>' +
      '</div>' +
      '<div class="vb-acts">' +
        '<button id="vbSample" class="primary">去采录</button>' +
        '<button id="vbAdd">＋ 添词</button>' +
        '<button id="vbQuiz"' + (vol.words.length < 2 ? ' disabled title="至少 2 个词才能出题"' : '') + '>测一测</button>' +
        '<button id="vbExport">导出这一卷</button>' +
        '<a class="vb-link" href="volumes.html">再开一卷</a>' +
        '<button id="vbAbout" class="vb-quiet">关于本卷</button>' +
        '<button id="vbBack" class="vb-quiet">切回徐州</button>' +
      '</div>' +
    '</div>' +
    '<div id="vbSparse"></div>' +
    '<div class="vb-map" id="vbMap" data-n="' + Math.min(vol.districts.length, 6) + '">' +
      vol.districts.map(function (d, i) {
        return '<div class="vb-region" data-d="' + esc(d.id) + '">' +
          '<span class="vb-rno">' + (i + 1 < 10 ? '0' : '') + (i + 1) + '</span>' +
          '<span class="vb-rname">' + esc(d.name) + '</span></div>';
      }).join('') +
    '</div>' +
    '<p class="vb-tip">拖着词点可以挪位置 · 点一下看这个词 · 有朱色实心点的已经录过</p>';

  document.body.classList.add('vol-custom');
  document.body.appendChild(board);

  var map = $('#vbMap');

  /* ---------- 词点 ---------- */
  function paintPins() {
    Array.prototype.forEach.call(map.querySelectorAll('.vb-pin'), function (n) { n.remove(); });
    vol.words.forEach(function (w) {
      var b = document.createElement('button');
      b.className = 'vb-pin' + (done(w.id) ? ' has' : '') + (hasRef(w.id) ? ' ref' : '');
      b.style.left = (w.x * 100).toFixed(2) + '%';
      b.style.top = (w.y * 100).toFixed(2) + '%';
      b.setAttribute('data-w', w.id);
      b.innerHTML = '<i></i><b>' + esc(w.w) + '</b>';
      map.appendChild(b);
    });
  }
  paintPins();

  /* ---------- 卷头计数 / 稀疏状态 / 空片区 ----------
     只有一两个词的卷，图上就是孤零零一个点。那不是坏了，是还没长起来 ——
     不写清楚，用户只会以为程序出错；写了却不让添，等于告诉他"重建一份吧"。
     所以这里既解释，也给入口。 */
  var SPARSE_AT = 4;

  function renderMeta() {
    var sub = $('.vb-sub');
    if (sub) {
      var dn = vol.words.filter(function (w) { return done(w.id); }).length;
      sub.textContent = vol.dialect + ' · ' + vol.districts.length + ' 个片区 · ' +
        vol.words.length + ' 个词条 · 已录 ' + dn + ' 条';
    }
    var q = $('#vbQuiz');
    if (q) {
      /* 2 个词就能出两选一；选项数随词数自动取 2–4，不再卡死"四选一"。
         释义写没写决定考法（释义 / 听音辨词），跟能不能测无关。 */
      if (vol.words.length < 2) { q.disabled = true; q.title = '至少 2 个词才能出题'; }
      else { q.disabled = false; q.removeAttribute('title'); }
    }
  }

  function renderSparse() {
    var box = $('#vbSparse');
    if (!box) return;
    var n = vol.words.length;
    if (n >= SPARSE_AT) { box.innerHTML = ''; return; }
    box.innerHTML =
      '<div class="vb-sparse">' +
        '<p>这一卷现在只有 <b>' + n + '</b> 个词，图上就' + (n === 1 ? '一个点' : ' ' + n + ' 个点') +
          ' —— <em>不是坏了</em>。再添 ' + (SPARSE_AT - n) + ' 条，分幅图才立得住，采录和测验也才有东西可走。</p>' +
        '<button type="button" class="vb-sp-b">＋ 添词</button>' +
      '</div>';
  }

  function renderEmpty() {
    Array.prototype.forEach.call(map.querySelectorAll('.vb-empty'), function (n) { n.remove(); });
    var count = {};
    vol.words.forEach(function (w) { count[w.district] = (count[w.district] || 0) + 1; });
    Array.prototype.forEach.call(map.querySelectorAll('.vb-region'), function (r) {
      var d = r.getAttribute('data-d');
      if (count[d]) return;
      var name = (vol.districts.filter(function (x) { return x.id === d; })[0] || {}).name || '这一片';
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'vb-empty';
      b.setAttribute('data-add', d);
      b.innerHTML = esc(name) + '还没有词<i>＋ 添一条</i>';
      r.appendChild(b);
    });
  }

  function refresh() { renderMeta(); renderSparse(); paintPins(); renderEmpty(); }
  refresh();

  /* ---------- 拖动 ---------- */
  var drag = null;
  map.addEventListener('pointerdown', function (e) {
    var pin = e.target.closest('.vb-pin');
    if (!pin) return;
    var r = map.getBoundingClientRect();
    drag = { pin: pin, id: pin.getAttribute('data-w'), rect: r, moved: false,
      dx: e.clientX - pin.getBoundingClientRect().left,
      dy: e.clientY - pin.getBoundingClientRect().top };
    pin.classList.add('drag');
    pin.setPointerCapture(e.pointerId);
  });
  map.addEventListener('pointermove', function (e) {
    if (!drag) return;
    var x = (e.clientX - drag.dx - drag.rect.left) / drag.rect.width;
    var y = (e.clientY - drag.dy - drag.rect.top) / drag.rect.height;
    x = Math.max(0.01, Math.min(0.99, x));
    y = Math.max(0.01, Math.min(0.99, y));
    drag.pin.style.left = (x * 100).toFixed(2) + '%';
    drag.pin.style.top = (y * 100).toFixed(2) + '%';
    drag.x = x; drag.y = y; drag.moved = true;
  });
  var suppressClick = false;
  map.addEventListener('pointerup', function (e) {
    if (!drag) return;
    var d = drag; drag = null;
    d.pin.classList.remove('drag');
    suppressClick = d.moved;          // 拖过就别顺手把词条卡弹出来
    if (!d.moved) return;
    var w = vol.words.filter(function (x) { return x.id === d.id; })[0];
    if (w) { w.x = d.x; w.y = d.y; V.update(vol.id, { words: vol.words }); }
  });

  /* 打开词条用 click：pointerup 在触屏/键盘/自动化下不一定成对出现，
     click 是唯一"到处都发"的事件。拖拽结束靠上面的标记吞掉这一次 click。 */
  map.addEventListener('click', function (e) {
    var empty = e.target.closest && e.target.closest('.vb-empty');
    if (empty) { openAdd(empty.getAttribute('data-add')); return; }
    var pin = e.target.closest && e.target.closest('.vb-pin');
    if (!pin) return;
    if (suppressClick) { suppressClick = false; return; }
    openWord(pin.getAttribute('data-w'));
  });

  /* ---------- 词条卡 ---------- */
  function openWord(id) {
    var w = vol.words.filter(function (x) { return x.id === id; })[0];
    if (!w) return;
    var d = vol.districts.filter(function (x) { return x.id === w.district; })[0];
    var isDone = done(id);
    var modal = $('#modal'), card = $('#modalCard');
    card.innerHTML =
      '<div class="mc-head"><div><div class="mc-eyebrow">' + esc(d ? d.name : '本卷') + '</div>' +
      '<h2 class="mc-title" style="font-size:26px">' + esc(w.w) + '</h2></div>' +
      '<button class="mc-close" data-vb-close>×</button></div>' +
      '<div class="vb-card">' +
        (w.meaning ? '<div class="vb-row"><dt>释义</dt><dd>' + esc(w.meaning) + '</dd></div>' : '') +
        (w.example ? '<div class="vb-row"><dt>例句</dt><dd>' + esc(w.example) + '</dd></div>' : '') +
        '<div class="vb-row"><dt>录音</dt><dd>' +
          (isDone ? '<button class="say-play" data-vb-play="' + esc(id) + '">▶ 播你家的录音</button>'
                  : '<span class="vb-miss">这一条还没录</span>') +
          (hasRef(id) ? ' <button class="say-play ref" data-vb-ref="' + esc(id) + '">♪ 播范本音</button>' : '') +
        '</dd></div>' +
        '<div class="vb-acts2"><a class="say-go" href="recorder/#p=' + encodeURIComponent(id) + '">去采录录这一条</a></div>' +
      '</div>';
    modal.classList.add('on');
  }

  document.addEventListener('click', function (e) {
    var t = e.target;
    if (t.closest && t.closest('[data-vb-close]')) { $('#modal').classList.remove('on'); return; }
    var play = t.closest && t.closest('[data-vb-play]');
    if (play) {
      play.textContent = '…';
      window.XZ.sample.play(play.getAttribute('data-vb-play')).then(function (ok) {
        play.textContent = ok ? '▶ 再播一次' : '▶ 播你家的录音';
      });
      return;
    }
    var ref = t.closest && t.closest('[data-vb-ref]');
    if (ref) {
      ref.textContent = '…';
      window.XZ.refs.play(ref.getAttribute('data-vb-ref')).then(function (ok) {
        ref.textContent = ok ? '♪ 再听一次' : '♪ 播范本音';
      });
    }
  });
  $('#modal').addEventListener('click', function (e) {
    if (e.target === this) this.classList.remove('on');
  });

  /* ---------- 添词 ----------
     建卷时只写了一条，也得有办法补 —— 否则唯一出路是删掉重建。
     从空片区点进来，词就落在那一片；从卷头点进来，轮流摊开。 */
  function parseWords(text) {
    return String(text || '').split(/\r?\n/).map(function (l) { return l.trim(); })
      .filter(Boolean).map(function (line) {
        var p = line.split(/\s*[|\t]\s*|\s*[,，]\s*/);
        return { w: (p[0] || '').trim(), meaning: (p[1] || '').trim(), example: (p[2] || '').trim() };
      }).filter(function (w) { return w.w; });
  }

  function openAdd(districtId) {
    var d = vol.districts.filter(function (x) { return x.id === districtId; })[0];
    var modal = $('#modal'), card = $('#modalCard');
    card.innerHTML =
      '<div class="mc-head"><div><div class="mc-eyebrow">第 ' + vol.no + ' 卷 · ' + esc(vol.name) + '</div>' +
      '<h2 class="mc-title" style="font-size:20px">' + (d ? '给「' + esc(d.name) + '」添词' : '给这一卷添词') + '</h2></div>' +
      '<button class="mc-close" data-vb-close>×</button></div>' +
      '<div class="vb-add">' +
        '<textarea id="vbAddText" spellcheck="false" placeholder="茅子 | 厕所 | 问一声茅子在哪儿&#10;洋柿子 | 西红柿"></textarea>' +
        '<p class="vb-add-hint">一行一个词：<code>词 | 释义 | 例句</code>，后两列可以省。' +
          '写了释义，「测一测」考的是释义；只写词，就考听音辨词（点 ▶ 听，再选是哪个词）。' +
          (d ? '添进来的词先落在「' + esc(d.name) + '」的空处，之后能拖。' : '会轮流摊到各个片区，之后能拖。') +
          '重名的词会被跳过并告诉你。</p>' +
        '<div class="vb-add-act"><button type="button" class="primary" id="vbAddSave">' +
          (d ? '添进「' + esc(d.name) + '」' : '添进这一卷') + '</button>' +
          '<span class="vb-add-err" id="vbAddErr"></span></div>' +
      '</div>';
    modal.classList.add('on');
    var ta = $('#vbAddText');
    if (ta) ta.focus();
    var save = $('#vbAddSave');
    if (save) save.addEventListener('click', function () {
      var list = parseWords(($('#vbAddText') || {}).value);
      if (!list.length) { $('#vbAddErr').textContent = '一行都没读到词：一行一个，词在前。'; return; }
      var r = V.addWords(vol.id, list, d ? d.id : null);
      if (!r || !r.ok) {
        $('#vbAddErr').textContent = ((r && r.errors && r.errors[0]) || {}).msg || '没添进去';
        return;
      }
      vol = V.current() || vol;
      modal.classList.remove('on');
      refresh();
    });
  }

  /* ---------- 按钮 ---------- */
  $('#vbSample').addEventListener('click', function () { location.href = 'recorder/'; });
  $('#vbAdd').addEventListener('click', function () { openAdd(null); });
  // 稀疏提示条是动态渲染的，按 id 直绑会在重渲染后失效 —— 委托到卷板
  board.addEventListener('click', function (e) {
    if (e.target.closest && e.target.closest('.vb-sp-b')) openAdd(null);
  });
  $('#vbQuiz').addEventListener('click', function () {
    if (window.XZ.quiz) window.XZ.quiz.start(1);
    else alert('测验模块没有加载。');
  });
  $('#vbExport').addEventListener('click', function () {
    var data = V.exportJSON(vol.id);
    var name = '乡音册-' + vol.name + '-第' + vol.no + '卷.json';
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1500);
  });
  $('#vbAbout').addEventListener('click', function () {
    if (window.XZ && window.XZ.about) window.XZ.about.open();
  });
  $('#vbBack').addEventListener('click', function () {
    V.deactivate();
    location.href = 'index.html';
  });

  /* 自建卷模式下 js/app.js 在开头就 return 了，ROUTER.init() 从来没跑过 ——
     结果 #/quiz/1、#/d/xxx 这类地址在自建卷里全是死的（按钮能点，手工地址没反应）。
     本文件是最后一个脚本，quiz/scene 的 handler 这时都已注册，补一次 init 即可。 */
  if (window.XZ && window.XZ.router && window.XZ.router.init) {
    try { window.XZ.router.init(); } catch (err) { /* 路由起不来不该把卷板整页拖死 */ }
  }
})();
