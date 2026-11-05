/* ============================================================
   features/volumes.js — 用户自己的「卷」
   ------------------------------------------------------------
   徐州是样板房：真实边界 + 10 个区县，所以它有一张 3D 地形。
   别的卷没有边界数据 —— 那就不画边界，画**片区**：
   建卷的人手上真正有、也愿意填的，是"我们县分城关、东乡、西乡"。

   所以一卷 = 卷名 + 方言名 + 3–6 个片区 + 一张词表。
   有片区就有图，有词就能录、能学、能导出。

   存储：localStorage 单键 xzdt.volumes.v1。
   为什么不用 IndexedDB：本文件必须在 core/store.js 之前**同步**跑完，
   才能把 ATLAS 换成用户卷（store.js 一加载就会遍历 ATLAS 建索引）。
   ============================================================ */
(function () {
  'use strict';

  var KEY = 'xzdt.volumes.v1';

  function read() {
    try {
      var db = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (!db || !Array.isArray(db.list)) return { v: 1, active: null, list: [] };
      return db;
    } catch (e) { return { v: 1, active: null, list: [] }; }
  }
  function write(db) {
    db.updatedAt = new Date().toISOString();
    try { localStorage.setItem(KEY, JSON.stringify(db)); return true; }
    catch (e) { return false; }          // 配额满了：调用方要能看见失败
  }

  function list() { return read().list; }
  function activeId() { return read().active; }
  function current() {
    var db = read();
    if (!db.active) return null;
    for (var i = 0; i < db.list.length; i++) if (db.list[i].id === db.active) return db.list[i];
    return null;
  }
  function isCustom() { return !!current(); }

  /** 词 id 带卷号前缀：u2w1。否则两个卷的 w1 会在录音索引里撞车 */
  function wordId(vol, i) { return 'u' + vol.no + 'w' + (i + 1); }

  function create(input) {
    var db = read();
    // 第 1 卷永远是样板房（徐州），它不在 list 里，所以新卷从 2 起
    var no = db.list.reduce(function (m, v) { return Math.max(m, v.no || 0); }, 1) + 1;
    var vol = {
      id: 'u-' + Date.now().toString(36) + '-' + no,
      no: no,
      title: String(input.title || '乡音册').trim(),
      name: String(input.name || '').trim(),
      dialect: String(input.dialect || (input.name + '话')).trim(),
      mark: String(input.mark || String(input.name || '乡').slice(0, 1)).trim().slice(0, 1),
      districts: (input.districts || []).map(function (n, i) {
        return { id: 'd' + (i + 1), name: String(n).trim() };
      }).filter(function (d) { return d.name; }),
      words: [],
      createdAt: new Date().toISOString()
    };
    (input.words || []).forEach(function (w, i) {
      if (!w || !w.w) return;
      vol.words.push({
        id: wordId(vol, i),
        w: String(w.w).trim(),
        meaning: String(w.meaning || '').trim(),
        example: String(w.example || '').trim(),
        district: (vol.districts[i % (vol.districts.length || 1)] || {}).id || null,
        x: 0, y: 0
      });
    });
    // 词点在片区内均匀铺开，用户随后可以拖
    layoutWords(vol);
    db.list.push(vol);
    db.active = vol.id;
    return write(db) ? vol : null;
  }

  /* 分幅的分格规则必须和 css/vol-board.css 的 [data-n] 一致，否则词会落到格子外面。
     1–3 个片区横排一行，4 个 2×2，5–6 个 3×2。 */
  function hash(s) {
    var h = 0;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return ((h % 997) + 997) % 997 / 997;      // 0–1，稳定
  }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  function gridOf(n) {
    if (n <= 1) return { cols: 1, rows: 1 };
    if (n <= 3) return { cols: n, rows: 1 };
    if (n === 4) return { cols: 2, rows: 2 };
    return { cols: 3, rows: 2 };
  }

  /** 没有坐标的词：先按片区均分，再在片区内部铺开（错行，不排成一条线） */
  function layoutWords(vol) {
    var n = vol.districts.length || 1;
    var g = gridOf(n);
    var idxOf = {};
    vol.districts.forEach(function (d, i) { idxOf[d.id] = i; });

    // 每个片区有几个词 —— 片区自己算行列，别用全局平均数，
    // 否则词多的片区会挤成一团、词少的片区只有一个点偏在角落
    var counts = {};
    vol.words.forEach(function (w) {
      var d = (w.district && idxOf[w.district] != null) ? w.district : (vol.districts[0] || {}).id;
      counts[d] = (counts[d] || 0) + 1;
    });

    var seen = {};
    vol.words.forEach(function (w) {
      if (typeof w.x === 'number' && w.x > 0) return;
      var d = (w.district && idxOf[w.district] != null) ? w.district : (vol.districts[0] || {}).id;
      var di = idxOf[d] || 0;
      var j = seen[d] || 0; seen[d] = j + 1;

      var ci = di % g.cols, ri = Math.floor(di / g.cols);
      var cw = 1 / g.cols, ch = 1 / g.rows;

      var per = counts[d] || 1;
      var ic = Math.min(2, per);                 // 一个词就居中，两个词并排
      var ir = Math.max(1, Math.ceil(per / ic));
      var fx = ((j % ic) + 0.5) / ic;
      var fy = ((Math.floor(j / ic) + 0.5) / ir);

      /* 稳定的小抖动：不抖，同一片区的词会排成一条横线，像表格不像地图。
         用 id 哈希而不是 Math.random —— 刷新后位置不能变。 */
      var jx = (hash(w.id + 'x') - 0.5) * 0.20;
      var jy = (hash(w.id + 'y') - 0.5) * 0.34;
      w.x = clamp(ci * cw + (0.2 + fx * 0.6) * cw + jx * cw, 0.04, 0.96);
      w.y = clamp(ri * ch + (0.18 + fy * 0.58) * ch + jy * ch, 0.06, 0.94);
    });
  }

  function update(id, patch) {
    var db = read();
    for (var i = 0; i < db.list.length; i++) {
      if (db.list[i].id !== id) continue;
      Object.keys(patch || {}).forEach(function (k) { db.list[i][k] = patch[k]; });
      db.list[i].updatedAt = new Date().toISOString();
      return write(db) ? db.list[i] : null;
    }
    return null;
  }

  function remove(id) {
    var db = read();
    db.list = db.list.filter(function (v) { return v.id !== id; });
    if (db.active === id) db.active = null;
    return write(db);
  }

  function activate(id) {
    var db = read();
    db.active = id || null;
    return write(db);
  }
  function deactivate() { return activate(null); }

  /** 把当前卷写进 ATLAS 与 VOLUME —— 必须在 core/store.js 之前跑 */
  function apply() {
    var vol = current();
    if (!vol) return false;

    var A = window.ATLAS;
    if (!A) return false;

    var hasWords = vol.words.length > 0;
    A.words = vol.words.map(function (w) {
      return {
        id: w.id, w: w.w, py: '', meaning: w.meaning || '', example: w.example || '',
        cat: 'changyong', difficulty: 1, levelId: 1,
        districtId: w.district || (vol.districts[0] || {}).id || null, spotId: null
      };
    });
    A.districts = vol.districts.map(function (d, i) {
      return { id: d.id, name: d.name, adcode: '', type: '', note: '', intro: '', label: null, stage: i + 1 };
    });
    A.spots = [];
    A.scenes = [];
    A.levels = hasWords
      ? [{ id: 1, name: '第 1 关', desc: '这一卷的全部词条', place: vol.name, districtId: (A.districts[0] || {}).id || null }]
      : [];

    // 等级名称跟着方言走，别让用户卷里出现"徐州话萌新"
    (A.tiers || []).forEach(function (t) {
      if (t && t.name) t.name = String(t.name).replace('徐州话', vol.dialect);
    });

    // 顶栏 / 标题 / 印章字：core/volume.js 稍后读的就是这个对象
    var V = window.VOLUME;
    if (V) {
      V.id = vol.id; V.no = vol.no; V.title = vol.title;
      V.name = vol.name; V.dialect = vol.dialect; V.mark = vol.mark;
      V.scope = vol.words.length + ' 个词条 · ' + vol.districts.length + ' 个片区';
      V.note = vol.name + '是第 ' + vol.no + ' 卷（你自己建的那一卷）。';
      V.survey = ''; V.refsBy = ''; V.mapSource = '片区示意：由建卷人填写的片区名生成，不是地理边界';
    }
    return true;
  }

  /** 导出可带走的一份：别人拿到能导入、能贴回仓库 */
  function exportJSON(id) {
    var db = read();
    var vol = db.list.filter(function (v) { return v.id === id; })[0] || current();
    if (!vol) return null;
    return {
      format: 'xiangyince-volume/1',
      exportedAt: new Date().toISOString(),
      volume: {
        no: vol.no, title: vol.title, name: vol.name,
        dialect: vol.dialect, mark: vol.mark,
        districts: vol.districts, words: vol.words
      }
    };
  }

  apply();

  window.XZ = window.XZ || {};
  window.XZ.volumes = {
    key: KEY,
    list: list,
    current: current,
    activeId: activeId,
    isCustom: isCustom,
    create: create,
    update: update,
    remove: remove,
    activate: activate,
    deactivate: deactivate,
    apply: apply,
    layoutWords: layoutWords,
    exportJSON: exportJSON
  };
})();
