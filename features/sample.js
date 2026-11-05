/* ============================================================
   features/sample.js — 真人发音优先 + 采样台入口
   ------------------------------------------------------------
   与 recorder/（采录）之间的唯一契约：

     · 索引   localStorage 键 xzdt.sample.v1 —— 采样台每次存/删后重写，
              形状 { version, updatedAt, count, words: { <atlasId>: { clipId, clips[], saying, speaker, gen, newest } } }
     · 音频   IndexedDB 库 xz-dialect-rec / store 'clips'，本模块只读，不写不建表
     · 连接键 atlasId = ATLAS.words[].id（如 'guan'、'bai'）

   两条硬边界：
     1. file:// 下浏览器不给麦克风，索引与库也可能读不到 → 一切回落到原来的合成音，
        并把「这是普通话合成，不是徐州话」这件事告诉用户，而不是假装念的是方言。
     2. 本模块不改写 store.js 的存档（xzdt.v2），也不引入构建步骤；同源由根目录的
        serve.cjs 保证（地图与 recorder/ 必须由同一个服务器提供）。
   ============================================================ */
(function () {
  'use strict';

  var KEY = 'xzdt.sample.v1';
  var DB_NAME = 'xz-dialect-rec', DB_VER = 1, STORE = 'clips';
  var RECORDER_PATH = 'recorder/';

  var idx = null;
  var dbp = null, dbFailed = false;
  var urls = {};
  var toastTimer = 0;

  function served() {
    var p = location.protocol, h = location.hostname;
    return (p === 'http:' && (h === '127.0.0.1' || h === 'localhost')) || p === 'https:';
  }

  function toast(msg) {
    var t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('on'); }, 2600);
  }

  function index() {
    if (idx !== null) return idx;
    try { idx = JSON.parse(localStorage.getItem(KEY) || 'null') || {}; }
    catch (e) { idx = {}; }
    if (!idx.words || typeof idx.words !== 'object') idx.words = {};
    return idx;
  }

  function metaFor(atlasId) { return index().words[atlasId] || null; }
  function has(atlasId) { var m = metaFor(atlasId); return !!(m && m.clipId); }
  function count() { return Object.keys(index().words).length; }
  function reloadIndex() { idx = null; return index(); }

  /* 只读打开。**绝不创建库**：带版本号 open() 一个不存在的库会真的建出一个空库，
     而采样台用的是同一个版本号，它随后的 open() 不会触发 upgradeneeded，
     于是 'clips' 表永远建不出来 —— 采样台整个存不了录音（实测复现过）。
     所以先用 indexedDB.databases() 确认库存在，再不带版本号地打开。
     浏览器没有 databases()（Firefox 126 以前、部分 WebView）时**直接放弃优先链**：
     不带版本号的 open() 在库不存在时会顺手建一个空库，那等于把上面这个坑重新踩一遍。 */
  function openDB() {
    if (dbp) return dbp;
    if (dbFailed || !window.indexedDB) { dbFailed = true; return Promise.reject(new Error('no-indexeddb')); }
    dbp = Promise.resolve()
      .then(function () {
        if (!indexedDB.databases) throw new Error('no-databases');
        return indexedDB.databases().then(function (list) {
          var hit = (list || []).some(function (d) { return d.name === DB_NAME; });
          if (!hit) throw new Error('no-db');
          return null;
        });
      })
      .then(function () {
        return new Promise(function (res, rej) {
          var req;
          try { req = indexedDB.open(DB_NAME); } catch (e) { return rej(e); }
          req.onsuccess = function () { res(req.result); };
          req.onerror = function () { rej(req.error || new Error('open-failed')); };
          req.onblocked = function () { rej(new Error('blocked')); };
        });
      });
    dbp.catch(function () { dbFailed = true; });
    return dbp;
  }

  /* 兜底：万一打开后发现没有 'clips' 表（空库），把自己造出来的这个库删掉再抛错。
     不删就等于把"采样台建不出表"的状态留在浏览器里；删掉后采样台下次能正常建库。 */
  function dropEmpty(db) {
    try { db.close(); } catch (e) {}
    try {
      var q = indexedDB.deleteDatabase(DB_NAME);
      q.onerror = q.onblocked = function () {};
    } catch (e) {}
  }

  function clipURL(clipId) {
    if (urls[clipId]) return Promise.resolve(urls[clipId]);
    return openDB().then(function (db) {
      if (db.objectStoreNames.contains(STORE) === false) { dropEmpty(db); throw new Error('no-store'); }
      return new Promise(function (res, rej) {
        var rq = db.transaction(STORE, 'readonly').objectStore(STORE).get(clipId);
        rq.onsuccess = function () {
          var c = rq.result;
          if (!c || !c.blob) { rej(new Error('no-blob')); return; }
          var u = URL.createObjectURL(c.blob);
          urls[clipId] = u;
          res(u);
        };
        rq.onerror = function () { rej(rq.error || new Error('get-failed')); };
      });
    });
  }

  /** 播一条真人录音。只有真的开播了才 resolve(true) ——
      自动播放策略会拒绝非用户手势的 play()，那种情况下必须让调用方回落合成音，
      否则就是"提示说有录音、其实一声不响"。 */
  /** 播一条指定 clip（三代对照要播"祖辈那条"，不能只播最新） */
  function playClip(clipId, note) {
    if (!served() || !clipId) return Promise.resolve(false);
    return clipURL(clipId).then(function (u) {
      var a = new Audio(u);
      return new Promise(function (res) {
        var settled = false;
        var timer = setTimeout(function () { if (!settled) { settled = true; res(false); } }, 1500);
        var p = a.play();
        if (p && p.then) {
          p.then(function () {
            if (settled) return;
            settled = true; clearTimeout(timer);
            if (note) toast(note);
            res(true);
          }).catch(function () {
            if (settled) return;
            settled = true; clearTimeout(timer); res(false);
          });
        } else {
          settled = true; clearTimeout(timer); res(false);
        }
      });
    }).catch(function () { return false; });
  }

  function play(atlasId, opts) {
    var m = metaFor(atlasId);
    if (!served() || !m || !m.clipId) return Promise.resolve(false);
    var who = m.speaker ? ' · ' + m.speaker : '';
    var n = (m.list && m.list.length) || (m.clips && m.clips.length) || 1;
    var note = (opts && opts.quiet) ? '' :
      '真人录音 · 你家的说法「' + (m.saying || '') + '」' + who + ' · 共 ' + n + ' 条，播最新一条';
    return playClip(m.clipId, note);
  }

  /* 范本音（给定方言的教学录音）。模块缺席就当没有，不抛错 —— 
     单独拷走 features/ 或脚本没加载时，行为必须和改动前一致。 */
  function refs() { return window.XZ && window.XZ.refs; }
  function hasRef(atlasId) { var R = refs(); return !!(R && R.has(atlasId)); }
  function playRef(atlasId) {
    var R = refs();
    return (R && R.has(atlasId)) ? R.play(atlasId) : Promise.resolve(false);
  }

  /** 这个词的所有录音摘要（按时间倒序）；老索引没有 list 时返回空数组 */
  function clipsFor(atlasId) {
    var m = metaFor(atlasId);
    return (m && m.list) ? m.list.slice() : [];
  }

  /**
   * 优先链：真人录音 / 范本音 → 合成音（并明标它是普通话合成）
   *
   * opts.prefer = 'ref'    学习场景：先播范本音（给定方言才是要学的东西），
   *                        没范本音再退回自家录音，都没有才合成。
   * opts.prefer = 'family' 默认：先播自家的（地图词条、随便听听）。
   *
   * 返回值 'real' | 'ref' | 'synth' 决定界面上那行「这是谁的声音」。
   */
  function speakOrSynth(word, audio, rate, opts) {
    var id = word && (word.atlasId || word.id);
    if (!id) { if (audio) audio.speak(word && word.w, rate); return Promise.resolve('synth'); }

    var quiet = { quiet: true };
    var steps = (opts && opts.prefer === 'ref')
      ? [['ref', function () { return playRef(id); }], ['real', function () { return play(id, quiet); }]]
      : [['real', function () { return play(id, quiet); }], ['ref', function () { return playRef(id); }]];

    function step(i) {
      if (i >= steps.length) {
        if (audio) audio.speak(word.w, rate);
        return Promise.resolve('synth');
      }
      return Promise.resolve(steps[i][1]()).then(function (ok) {
        return ok ? steps[i][0] : step(i + 1);
      }, function () { return step(i + 1); });
    }
    return step(0);
  }

  function bindEntry() {
    var b = document.getElementById('btnSample');
    if (!b) return;
    var n = count();
    var tip = n ? '采录 · 已有 ' + n + ' 词真人录音' : '采录 · 录你家的说法';
    b.setAttribute('data-tip', tip);
    b.setAttribute('aria-label', tip);
    b.addEventListener('click', function () {
      window.location.href = RECORDER_PATH;
    });
  }

  function init() {
    bindEntry();
    // 从采样台返回浏览器历史时，索引可能已变
    window.addEventListener('focus', function () { reloadIndex(); bindCountRefresh(); });
  }

  function bindCountRefresh() {
    var b = document.getElementById('btnSample');
    if (!b) return;
    var n = count();
    if (n) {
      var tip = '采录 · 已有 ' + n + ' 词真人录音';
      b.setAttribute('data-tip', tip);
      b.setAttribute('aria-label', tip);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.XZ = window.XZ || {};
  window.XZ.sample = {
    served: served,
    key: KEY,
    index: index,
    count: count,
    has: has,
    metaFor: metaFor,
    urlFor: function (atlasId) {
      var m = metaFor(atlasId);
      return (m && m.clipId) ? clipURL(m.clipId) : Promise.reject(new Error('no-clip'));
    },
    play: play,
    playClip: playClip,
    playRef: playRef,
    hasRef: hasRef,
    clipsFor: clipsFor,
    speakOrSynth: speakOrSynth,
    reloadIndex: reloadIndex
  };
})();
