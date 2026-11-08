/* ============================================================
   features/inbox.js — 两个页面之间递一个文件
   ------------------------------------------------------------
   场景：用户把一整段录音拖进「语言包 → 导入」，那里需要清单（.json），
   于是只能说"没有找到清单"。可他要做的事很清楚：把这段录音切开。

   浏览器不让我们把 File 放进 URL，也不该放进 localStorage（base64 会撑爆）。
   Blob 能原样存进 IndexedDB —— 所以这里只做一件事：暂存一个文件，
   另一个页面取走。取走即删，不留副本（录音不该在没人知道的地方留痕）。

   对外：
     XZ.inbox.put(file)  → Promise，把文件放进去
     XZ.inbox.take()     → Promise<File|null>，取走并删除
   ============================================================ */
(function () {
  'use strict';

  var DB = 'xz-splice-inbox', VER = 1, STORE = 'pending', KEY = 'file';

  function open() {
    return new Promise(function (res, rej) {
      var req;
      try { req = indexedDB.open(DB, VER); } catch (e) { rej(e); return; }
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = function () { res(req.result); };
      req.onerror = function () { rej(req.error || new Error('open-failed')); };
    });
  }

  function put(file) {
    if (!file) return Promise.reject(new Error('no-file'));
    if (!window.indexedDB) return Promise.reject(new Error('no-idb'));
    return open().then(function (db) {
      return new Promise(function (res, rej) {
        var t = db.transaction(STORE, 'readwrite');
        t.objectStore(STORE).put({ name: file.name || 'audio', blob: file, at: Date.now() }, KEY);
        t.oncomplete = function () { try { db.close(); } catch (e) {} res(true); };
        t.onerror = function () { rej(t.error || new Error('put-failed')); };
        t.onabort = function () { rej(t.error || new Error('abort')); };
      });
    });
  }

  function take() {
    if (!window.indexedDB) return Promise.resolve(null);
    return open().then(function (db) {
      return new Promise(function (res) {
        var out = null;
        var t = db.transaction(STORE, 'readwrite');
        var store = t.objectStore(STORE);
        var rq = store.get(KEY);
        rq.onsuccess = function () {
          var rec = rq.result;
          if (rec && rec.blob) {
            /* 还原成 File：切条页要的是 name + FileReader，Blob 没有名字 */
            try {
              out = new File([rec.blob], rec.name || 'audio.m4a', { type: rec.blob.type || '' });
            } catch (e) {
              out = rec.blob;
            }
          }
          store.delete(KEY);              // 取走即删
        };
        t.oncomplete = function () { try { db.close(); } catch (e) {} res(out); };
        t.onerror = function () { try { db.close(); } catch (e) {} res(null); };
      });
    }, function () { return null; });
  }

  window.XZ = window.XZ || {};
  window.XZ.inbox = { put: put, take: take };
})();
