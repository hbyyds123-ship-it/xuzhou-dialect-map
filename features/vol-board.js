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
        '<button id="vbQuiz"' + (vol.words.length < 4 ? ' disabled title="至少 4 个词才能出四选一"' : '') + '>测一测</button>' +
        '<button id="vbExport">导出这一卷</button>' +
        '<a class="vb-link" href="volumes.html">再开一卷</a>' +
        '<button id="vbAbout" class="vb-quiet">关于本卷</button>' +
        '<button id="vbBack" class="vb-quiet">切回徐州</button>' +
      '</div>' +
    '</div>' +
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

  /* ---------- 按钮 ---------- */
  $('#vbSample').addEventListener('click', function () { location.href = 'recorder/'; });
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
})();
