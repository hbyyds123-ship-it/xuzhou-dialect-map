/* ============================================================
   features/refs.js — 范本音（给定方言的教学录音）
   ------------------------------------------------------------
   为什么要有这一层：学习侧原先唯一的"发音"是浏览器 TTS 的普通话，
   拿它学方言等于在学普通话。范本音是真人录的徐州话，学习时才播它。

   两条来源、一个接口：
     · 随包分发  data/refs.js 里登记的 audio 表（文件在 data/ref-audio/）
     · 用户导入  拖进词条册的 wav/mp3，存进独立的 IndexedDB 库

   **独立的库 xz-dialect-refs**：绝不和采样台的 xz-dialect-rec 混用。
   那个库的版本号曾经因为"谁先建库"踩过坑（见 sample.js 的长注释），
   本模块只碰自己的库，也就不需要任何版本协商。
   ============================================================ */
(function () {
  'use strict';

  var DB_NAME = 'xz-dialect-refs', STORE = 'refs';
  var MAX_BYTES = 24 * 1024 * 1024;     // 单条上限：24MB，一首无损歌的大小，够录一句话

  var manifest = (window.REFS && window.REFS.audio) || {};
  var cache = null;                      // { id: {id, name, mime, size, at, bundled} }
  var dbp = null;
  var urls = {};

  function words() { return (window.ATLAS && window.ATLAS.words) || []; }

  function openDB() {
    if (dbp) return dbp;
    dbp = new Promise(function (res, rej) {
      var req;
      try { req = indexedDB.open(DB_NAME); } catch (e) { return rej(e); }
      // 这个库只归本模块所有，所以可以放心在 upgradeneeded 里建表。
      // 不带版本号 open：已存在时不会因版本号对不上抛 VersionError。
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      };
      req.onsuccess = function () { res(req.result); };
      req.onerror = function () { rej(req.error || new Error('open-failed')); };
      req.onblocked = function () { rej(new Error('blocked')); };
    });
    dbp.catch(function () { dbp = null; });
    return dbp;
  }

  function guessMime(name) {
    var m = /\.([a-z0-9]+)$/i.exec(String(name || ''));
    var ext = m ? m[1].toLowerCase() : '';
    return ({ mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac',
      ogg: 'audio/ogg', oga: 'audio/ogg', webm: 'audio/webm', flac: 'audio/flac'
    })[ext] || 'audio/mpeg';
  }

  /** 文件名 → 词条 id。容忍 "01-茅子.mp3"、"茅子.wav"、"maozi.mp3"、"mǎozi.mp3" 这些写法 */
  function resolveName(filename) {
    var base = String(filename || '').replace(/\.[^./\\]+$/, '');
    base = base.replace(/^\s*\d+\s*[-_.、\s]+/, '').trim();   // 去掉 01- 这样的序号
    if (!base) return null;
    var W = words(), low = base.toLowerCase();

    var hit = W.filter(function (w) { return String(w.id).toLowerCase() === low; })[0];
    if (hit) return hit.id;
    hit = W.filter(function (w) { return String(w.w) === base; })[0];
    if (hit) return hit.id;

    var py = low.replace(/[\s'’·]/g, '');
    hit = W.filter(function (w) {
      return String(w.py || '').toLowerCase().replace(/[\s'’·]/g, '') === py;
    })[0];
    return hit ? hit.id : null;
  }

  function fromManifest() {
    var map = {};
    Object.keys(manifest).forEach(function (id) {
      var p = String(manifest[id]);
      map[id] = { id: id, name: p.split('/').pop(), bundled: true, at: 0, size: 0, mime: guessMime(p) };
    });
    return map;
  }

  function allRecs() {
    return openDB().then(function (db) {
      return new Promise(function (res, rej) {
        var rq = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
        rq.onsuccess = function () { res(rq.result || []); };
        rq.onerror = function () { rej(rq.error); };
      });
    });
  }

  /** 重建内存索引：随包分发的打底，用户导入的盖在上面（自己的优先） */
  function refresh() {
    return allRecs().then(function (list) {
      var map = fromManifest();
      list.forEach(function (r) {
        map[r.id] = {
          id: r.id, name: r.name || '', mime: r.mime || '',
          size: r.size || 0, at: r.at || 0, bundled: false
        };
      });
      cache = map;
      return map;
    }).catch(function () { cache = cache || fromManifest(); return cache; });
  }

  function has(id) {
    if (!id) return false;
    if (cache) return !!cache[id];
    return !!manifest[id];
  }

  function count() { return cache ? Object.keys(cache).length : Object.keys(manifest).length; }

  function list() {
    var map = cache || fromManifest();
    return Object.keys(map).map(function (k) { return map[k]; })
      .sort(function (a, b) { return (b.at || 0) - (a.at || 0); });
  }

  /** 范本音的播放地址：随包分发的直接给相对路径，导入的是 blob URL */
  function url(id) {
    if (!id) return Promise.resolve(null);
    if (urls[id]) return Promise.resolve(urls[id]);
    if (manifest[id]) return Promise.resolve(String(manifest[id]));
    return openDB().then(function (db) {
      return new Promise(function (res, rej) {
        var rq = db.transaction(STORE, 'readonly').objectStore(STORE).get(id);
        rq.onsuccess = function () {
          var r = rq.result;
          if (!r || !r.blob) { res(null); return; }
          var u = URL.createObjectURL(r.blob);
          urls[id] = u;
          res(u);
        };
        rq.onerror = function () { rej(rq.error); };
      });
    }).catch(function () { return null; });
  }

  function play(id) {
    return url(id).then(function (u) {
      if (!u) return false;
      var a = new Audio(u);
      return new Promise(function (res) {
        var done = false;
        var t = setTimeout(function () { if (!done) { done = true; res(false); } }, 1500);
        var p = a.play();
        if (p && p.then) {
          p.then(function () { if (done) return; done = true; clearTimeout(t); res(true); })
            .catch(function () { if (done) return; done = true; clearTimeout(t); res(false); });
        } else { done = true; clearTimeout(t); res(false); }
      });
    });
  }

  function add(id, file) {
    if (!id || !file) return Promise.reject(new Error('bad-args'));
    if (file.size && file.size > MAX_BYTES) return Promise.reject(new Error('too-large'));
    var rec = {
      id: id,
      name: file.name || (id + '.mp3'),
      mime: file.type || guessMime(file.name),
      size: file.size || 0,
      at: Date.now(),
      blob: file
    };
    return openDB().then(function (db) {
      return new Promise(function (res, rej) {
        var t = db.transaction(STORE, 'readwrite');
        t.objectStore(STORE).put(rec);
        t.oncomplete = function () { res(rec); };
        t.onerror = function () { rej(t.error || new Error('put-failed')); };
        t.onabort = function () { rej(t.error || new Error('abort')); };
      });
    }).then(function () {
      if (urls[id]) { try { URL.revokeObjectURL(urls[id]); } catch (e) {} delete urls[id]; }
      return rec;
    });
  }

  /** 批量导入。按文件名对词条，对不上的单独报出来，不静默丢弃 */
  function importFiles(files) {
    var arr = Array.prototype.slice.call(files || []);
    var ok = [], fail = [];
    return arr.reduce(function (p, f) {
      return p.then(function () {
        var id = resolveName(f.name);
        if (!id) { fail.push(f.name); return null; }
        return add(id, f).then(function () { ok.push(id); },
          function () { fail.push(f.name); });
      });
    }, Promise.resolve()).then(function () {
      return refresh().then(function () { return { ok: ok, fail: fail }; });
    });
  }

  function del(id) {
    if (manifest[id]) {
      return Promise.reject(new Error('bundled'));   // 随包分发的不能在这里删，得改 data/refs.js
    }
    return openDB().then(function (db) {
      return new Promise(function (res, rej) {
        var t = db.transaction(STORE, 'readwrite');
        t.objectStore(STORE).delete(id);
        t.oncomplete = function () { res(true); };
        t.onerror = function () { rej(t.error || new Error('del-failed')); };
      });
    }).then(function () {
      if (urls[id]) { try { URL.revokeObjectURL(urls[id]); } catch (e) {} delete urls[id]; }
      return refresh();
    });
  }

  var ready = refresh();

  window.XZ = window.XZ || {};
  window.XZ.refs = {
    ready: ready,
    refresh: refresh,
    has: has,
    count: count,
    list: list,
    url: url,
    play: play,
    add: add,
    del: del,
    importFiles: importFiles,
    resolveName: resolveName,
    maxBytes: MAX_BYTES
  };
})();
