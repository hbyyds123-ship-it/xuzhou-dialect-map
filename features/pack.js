/* ============================================================
   features/pack.js — 语言包
   ------------------------------------------------------------
   问题不在"能不能录音"，在"录音的人不是操作软件的人"。
   老人用手机录音机念十条，发过来是一堆「新录音 1.m4a」——
   谁也不知道哪条是哪个词，于是这段声音就废了。

   语言包就是那份共同语言：一张清单（谁、哪的话、录哪些词、什么许可）
   ＋ 若干段音频。音频可以内嵌在清单里（单文件，微信能发），
   也可以和清单并排放（多选一次拖进来）。

     format: 'xiangyince-pack/1'

   两条线必须分清，别合成一条：

     语言包 xiangyince-pack/1  → 请别人录的「范本音」→ 库 xz-dialect-refs
     演示包 xiangyince-demo/1  → 你自己录的「自家说法」→ 库 xz-dialect-rec

   混在一起会把"这话是谁说的"搞丢，而"谁说的"正是这套东西的全部价值。
   （演示包在 recorder/app.js，走采样台的导入，不在这里。）

   配对是这里唯一有难度的地方，所以它被写成纯函数 pairFiles()：
   输入只有文件名/大小/时间，不读内容 —— 于是可以在 Node 里直接测，不必起浏览器。
   ============================================================ */
(function () {
  'use strict';

  var FORMAT = 'xiangyince-pack/1';
  var MAX_BYTES = 24 * 1024 * 1024;
  var MAX_ITEMS = 500;

  /* ---------------- 当前这一卷 ---------------- */

  /** 当前卷（用户卷优先，没有就是样板房第 1 卷） */
  function currentVolume() {
    var V = window.XZ && window.XZ.volumes;
    var vol = (V && V.current) ? V.current() : null;
    if (vol) {
      return {
        no: vol.no || 1, name: vol.name || '', dialect: vol.dialect || ((vol.name || '') + '话'),
        custom: true, words: vol.words || []
      };
    }
    var VO = window.VOLUME || {};
    var A = window.ATLAS || { words: [] };
    return {
      no: VO.no || 1, name: VO.name || '徐州', dialect: VO.dialect || '徐州话',
      custom: false, words: A.words || []
    };
  }

  /** 统一字段：徐州卷与用户卷的词结构不同（m/meaning、py 有无），这里拉平 */
  function currentWords() {
    var vol = currentVolume();
    return (vol.words || []).map(function (w, i) {
      return {
        id: String(w.id != null ? w.id : ('w' + (i + 1))),
        w: String(w.w != null ? w.w : ''),
        py: String(w.py || ''),
        meaning: String(w.meaning != null ? w.meaning : (w.m || '')),
        example: String(w.example || '')
      };
    });
  }

  function indexWords() {
    var map = {};
    currentWords().forEach(function (w) { map[w.id] = w; });
    return map;
  }

  function hasRef(id) {
    var R = window.XZ && window.XZ.refs;
    return !!(R && R.has && R.has(id));
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  /* ---------------- 建包 ---------------- */

  /**
   * @param {{speaker?:Object, license?:string, words?:Array, volume?:Object}} input
   * words 省略 = 当前卷全部词
   */
  function buildPack(input) {
    input = input || {};
    var vol = input.volume || currentVolume();
    var sp = input.speaker || {};
    var words = input.words || currentWords();
    return {
      format: FORMAT,
      packId: 'pk' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      createdAt: new Date().toISOString(),
      volume: { no: vol.no || 1, name: vol.name || '', dialect: vol.dialect || '' },
      speaker: {
        name: String(sp.name || ''),
        birthYear: sp.birthYear ? Number(sp.birthYear) : null,
        hometown: String(sp.hometown || ''),
        years: sp.years ? Number(sp.years) : null,
        note: String(sp.note || '')
      },
      license: String(input.license || ''),
      items: words.map(function (w, i) {
        return {
          no: i + 1,
          wordId: String(w.id),
          word: String(w.w || ''),
          py: String(w.py || ''),
          meaning: String(w.meaning || ''),
          /* 默认就把"建议文件名"写进去：配对时这是第一优先，最不会错 */
          file: pad2(i + 1) + '.m4a',
          note: ''
        };
      })
    };
  }

  function validate(doc) {
    var errors = [];
    if (!doc || typeof doc !== 'object') return { ok: false, errors: [{ msg: '读不出这份文件' }] };
    if (doc.format !== FORMAT) {
      var hint = doc.format === 'xiangyince-demo/1'
        ? '这是「演示包」（你自己录的自家说法），要在采样台里导入，不是语言包。'
        : 'format 应为 ' + FORMAT + '，实际是 ' + (doc.format || '（空）') + '。';
      errors.push({ msg: '这不是语言包：' + hint });
    }
    if (!Array.isArray(doc.items) || !doc.items.length) {
      errors.push({ msg: '清单里没有词（items 为空）—— 至少一条才有意义。' });
    } else {
      var noId = doc.items.filter(function (it) { return !it || !it.wordId; });
      if (noId.length) {
        errors.push({ msg: noId.length + ' 条没写词条 id（wordId），不知道该放进哪个词。' });
      }
      if (doc.items.length > MAX_ITEMS) {
        errors.push({ msg: '清单有 ' + doc.items.length + ' 条，超过一卷 ' + MAX_ITEMS + ' 条的上限。' });
      }
    }
    return errors.length ? { ok: false, errors: errors } : { ok: true, doc: doc };
  }

  /* ---------------- 配对（纯函数，可单测） ---------------- */

  function baseName(name) {
    return String(name == null ? '' : name).replace(/\.[^./\\]+$/, '');
  }

  /**
   * 文件名 → 编号。
   * 只认 1–3 位、且有边界的数字，**绝不把 13 位时间戳当编号**：
   *   "01.m4a" → 1        "01-一崩子.m4a" → 1      "新录音 1.m4a" → 1
   *   "录音_02.m4a" → 2   "wx_camera_1699123456789.m4a" → 0（认不出，走顺序）
   */
  function numberOf(name) {
    var b = baseName(name);
    var m = /^\s*0*(\d{1,3})(?=\D|$)/.exec(b);
    if (m) return Number(m[1]);
    m = /[\s\-_.、]0*(\d{1,3})$/.exec(b);
    if (m) return Number(m[1]);
    return 0;
  }

  function isJson(name) { return /\.json$/i.test(String(name || '')); }

  /** 只描述文件，不读内容：便于在 Node 里测。raw 留着原始 File —— 配对完还要读它 */
  function describe(file) {
    return {
      name: String(file.name || ''),
      size: Number(file.size || 0),
      lastModified: Number(file.lastModified || 0),
      raw: file
    };
  }

  /**
   * 把音频文件对到清单条目上。
   * @param {Object} doc 语言包
   * @param {Array} files [{name,size,lastModified}]（json 会被自动滤掉）
   * @param {{mode?:'auto'|'order'}} opts
   * @returns {{pairs:Array, missing:Array, extra:Array, mode:string}}
   *
   * 策略是"全有或全无"：只要有一个文件能靠名字精确配上，就**只**做精确匹配，
   * 剩下的报出来让人自己改名 —— 绝不把"顺序"混进"精确"里，
   * 因为错位的录音比缺失的录音更坏：它会被当成真的，一路传下去。
   */
  function pairFiles(doc, files, opts) {
    opts = opts || {};
    var items = (Array.isArray(doc && doc.items) ? doc.items : []).slice();
    var audios = (Array.isArray(files) ? files : []).map(describe).filter(function (f) {
      return f.name && !isJson(f.name);
    });

    var byNo = {};
    items.forEach(function (it) { if (it && it.no != null) byNo[Number(it.no)] = it; });

    var usedFile = {}, paired = [], hitExact = 0;

    function take(item, file, how) {
      usedFile[file.name] = 1;
      paired.push({ item: item, file: file, how: how });
      hitExact++;
    }

    function freeFiles() {
      return audios.filter(function (f) { return !usedFile[f.name]; });
    }
    function pairedIds() {
      var s = {};
      paired.forEach(function (p) { s[p.item.no] = 1; });
      return s;
    }

    // 1) 清单里写死的文件名（建包时默认写了 01.m4a，所以这一步命中率最高）
    items.forEach(function (it) {
      if (!it || !it.file) return;
      var f = freeFiles().filter(function (x) { return x.name === it.file; })[0];
      if (f) take(it, f, '清单指定');
    });

    // 2) 文件名里的编号
    audios.forEach(function (f) {
      if (usedFile[f.name]) return;
      var n = numberOf(f.name);
      if (!n) return;
      var it = byNo[n];
      if (!it || pairedIds()[n]) return;
      take(it, f, '按编号');
    });

    // 3) 文件名就是词 / 词条 id（给懂的人用的老办法）
    audios.forEach(function (f) {
      if (usedFile[f.name]) return;
      var b = baseName(f.name).replace(/^\s*\d+\s*[-_.、\s]+/, '').trim();
      if (!b) return;
      var it = items.filter(function (x) {
        if (!x || pairedIds()[x.no]) return false;
        return x.word === b || String(x.wordId) === b ||
          (x.py && x.py.replace(/[\s'’·]/g, '').toLowerCase() === b.replace(/[\s'’·]/g, '').toLowerCase());
      })[0];
      if (it) take(it, f, '按词名');
    });

    // 4) 顺序兜底：一个精确命中都没有、或者调用方明确要求时，才走这条
    var orderUsed = false;
    if (!hitExact || opts.mode === 'order') {
      var rest, open;
      if (opts.mode === 'order') {
        // 强制按顺序：清空精确结果，全部重排
        paired = []; usedFile = {};
        rest = audios.slice();
        open = items.filter(function (it) { return !!it; });
      } else {
        rest = freeFiles();
        var taken = {};
        paired.forEach(function (p) { taken[p.item.no] = 1; });
        open = items.filter(function (it) { return it && !taken[it.no]; });
      }
      rest.sort(function (a, b) {
        return (a.lastModified - b.lastModified) || (a.name < b.name ? -1 : (a.name > b.name ? 1 : 0));
      });
      open.sort(function (a, b) { return (a.no || 0) - (b.no || 0); });
      var k = 0;
      rest.forEach(function (f) {
        if (usedFile[f.name]) return;
        var it = open[k];
        if (!it) return;
        k++;
        usedFile[f.name] = 1;
        paired.push({ item: it, file: f, how: '按顺序' });
        orderUsed = true;
      });
    }

    var doneNo = {};
    paired.forEach(function (p) { doneNo[p.item.no] = 1; });

    return {
      pairs: paired.sort(function (a, b) { return (a.item.no || 0) - (b.item.no || 0); }),
      missing: items.filter(function (it) { return it && !doneNo[it.no]; }),
      extra: audios.filter(function (f) { return !usedFile[f.name]; }),
      orderUsed: orderUsed
    };
  }

  /* ---------------- 读文件 ---------------- */

  function readText(file) {
    return new Promise(function (res, rej) {
      var fr = new FileReader();
      fr.onload = function () { res(String(fr.result || '')); };
      fr.onerror = function () { rej(fr.error || new Error('read-failed')); };
      fr.readAsText(file);
    });
  }

  function b64ToBlob(b64, mime) {
    var bin = atob(String(b64 || ''));
    var u8 = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return new Blob([u8], { type: mime || 'audio/mpeg' });
  }

  function guessMime(name) {
    var m = /\.([a-z0-9]+)$/i.exec(String(name || ''));
    var ext = m ? m[1].toLowerCase() : '';
    return ({
      mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', mp4: 'audio/mp4',
      aac: 'audio/aac', ogg: 'audio/ogg', oga: 'audio/ogg', webm: 'audio/webm', flac: 'audio/flac'
    })[ext] || 'audio/mpeg';
  }

  /** 一批文件 → { doc, files }：json 当清单，其余当音频 */
  function splitInputs(fileList) {
    var arr = Array.prototype.slice.call(fileList || []);
    var jsons = arr.filter(function (f) { return isJson(f.name); });
    var audios = arr.filter(function (f) { return !isJson(f.name); });
    if (!jsons.length) return Promise.resolve({ doc: null, files: audios });
    return readText(jsons[0]).then(function (txt) {
      var doc = null;
      try { doc = JSON.parse(txt); } catch (e) {
        return { doc: null, files: audios, parseError: '清单不是合法的 JSON：' + e.message };
      }
      return { doc: doc, files: audios };
    });
  }

  /**
   * 把任意一段来源统一成「带 type 的音频文件」。
   * 为什么必须带 type：refs 存的是 Blob，播放时直接 URL.createObjectURL 给 <audio>，
   * 一个没有 type 的 Blob 在部分浏览器里会静默播不出来 —— 那是最难查的一类故障。
   */
  function asAudioFile(raw, name) {
    var nm = name || (raw && raw.name) || 'audio';
    var mime = guessMime(nm);
    if (typeof File !== 'undefined' && raw instanceof File && raw.type) return Promise.resolve(raw);
    return new Promise(function (res, rej) {
      var fr = new FileReader();
      fr.onload = function () {
        try { res(new File([fr.result], nm, { type: mime })); }
        catch (e) { res(new Blob([fr.result], { type: mime })); }
      };
      fr.onerror = function () { rej(fr.error || new Error('read-failed')); };
      fr.readAsArrayBuffer(raw);
    });
  }

  /* ---------------- 导入 ---------------- */

  /**
   * @param {Object} doc 清单
   * @param {Array} files 音频（File/Blob，需有 name）
   * @param {{overwrite?:boolean, mode?:string}} opts
   */
  function importPack(doc, files, opts) {
    opts = opts || {};
    var R = window.XZ && window.XZ.refs;
    if (!R) return Promise.resolve({ ok: false, errors: [{ msg: '范本音模块没有加载，无法写入。' }] });

    var v = validate(doc);
    if (!v.ok) return Promise.resolve(v);

    var known = indexWords();
    var speaker = (doc.speaker && doc.speaker.name) || '';
    var list = (files || []).slice();

    /* 待办表：内嵌的音频（data 字段）与散装文件走同一个循环，
       否则"一半内嵌一半散装"的包会丢掉其中一半 —— 那种包真的会出现：
       有人手工补了三条，剩下的还留在文件夹里。 */
    var todo = [];
    var embedded = doc.items.filter(function (it) { return it && it.data; });
    var restItems = doc.items.filter(function (it) { return it && !it.data; });
    var report = { missing: [], extra: [], orderUsed: false };

    embedded.forEach(function (it) {
      todo.push({
        item: it, how: '内嵌',
        name: it.file || (pad2(it.no) + '.m4a'),
        b64: it.data, mime: it.mime || guessMime(it.file)
      });
    });

    if (restItems.length) {
      var pr = pairFiles({ format: doc.format, items: restItems }, list, opts);
      pr.pairs.forEach(function (p) {
        todo.push({ item: p.item, how: p.how, name: p.file.name, file: p.file.raw });
      });
      report = { missing: pr.missing, extra: pr.extra, orderUsed: pr.orderUsed };
    } else if (list.length) {
      // 全内嵌却还给了音频文件：不猜，报出来
      report.extra = list.map(describe);
    }

    var out = {
      ok: true, added: [], skipped: [], failed: [],
      missing: report.missing || [], extra: report.extra || [],
      orderUsed: !!report.orderUsed, speaker: speaker,
      packName: (doc.volume && doc.volume.name) || '', packNo: (doc.volume && doc.volume.no) || 0
    };

    return todo.reduce(function (p, t) {
      return p.then(function () {
        var it = t.item;
        if (!it || !it.wordId) { out.failed.push({ no: it && it.no, word: it && it.word, why: '没写词条 id' }); return null; }

        if (R.has(it.wordId) && !opts.overwrite) {
          out.skipped.push({ no: it.no, word: it.word || (known[it.wordId] || {}).w || it.wordId, why: '已有范本音' });
          return null;
        }

        var blobP;
        if (t.b64) {
          try { blobP = Promise.resolve(asAudioFile(b64ToBlob(t.b64, t.mime), t.name)); }
          catch (e) { blobP = Promise.reject(e); }
        } else if (t.file) {
          blobP = asAudioFile(t.file, t.name);
        } else {
          blobP = Promise.resolve(null);
        }

        return blobP.then(function (blob) {
          if (!blob) throw new Error('no-blob');
          if (blob.size > MAX_BYTES) throw new Error('too-large');
          return R.add(it.wordId, blob, { name: t.name, by: speaker, packId: doc.packId || '' });
        }).then(function () {
          out.added.push({
            no: it.no, wordId: it.wordId,
            word: it.word || (known[it.wordId] || {}).w || it.wordId,
            how: t.how,
            /* 这个词在不在当前这一卷：不在也不拦（数据不能因为切错卷就丢），
               但必须在报告里说清楚，否则用户会以为"导了却听不到"是坏了 */
            here: !!known[it.wordId]
          });
        }, function (e) {
          out.failed.push({
            no: it.no, word: it.word, why:
              e && e.message === 'too-large' ? '单个文件超过 24MB'
                : e && e.message === 'no-blob' ? '读不出这段音频'
                  : '写不进本机（可能是存储已满）'
          });
        });
      });
    }, Promise.resolve()).then(function () {
      return R.refresh().then(function () { return out; }, function () { return out; });
    });
  }

  /* ---------------- 念稿单 ---------------- */

  function esc(s) {
    return String(s == null ? '' : s).replace(/[<>&"]/g, function (c) {
      return ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c];
    });
  }

  /** 可打印的一页纸：发音人照着念，一条一格 */
  function sheetHTML(doc) {
    if (!doc || !doc.items) return '';
    var sp = doc.speaker || {};
    var bits = [];
    if (sp.birthYear) bits.push(sp.birthYear + ' 年生');
    if (sp.hometown) bits.push('老家 ' + sp.hometown);
    if (sp.years) bits.push('在本地住了 ' + sp.years + ' 年');

    var rows = doc.items.map(function (it) {
      return '<tr>' +
        '<td class="c-no">' + pad2(it.no) + '</td>' +
        '<td class="c-w">' + esc(it.word) + (it.py ? '<i>' + esc(it.py) + '</i>' : '') + '</td>' +
        '<td class="c-m">' + esc(it.meaning || '') + '</td>' +
        '<td class="c-k"></td>' +
        '</tr>';
    }).join('');

    return '<div class="sheet">' +
      '<div class="sh-head">' +
        '<div><div class="sh-eyebrow">乡音册 · 念稿单</div>' +
        '<h2>' + esc((doc.volume && doc.volume.name) || '') + ' · ' + esc(sp.name || '（还没写发音人）') + '</h2>' +
        '<p class="sh-sub">' + esc((doc.volume && doc.volume.dialect) || '') +
          (bits.length ? '　|　' + esc(bits.join('　|　')) : '') + '</p></div>' +
        '<div class="sh-code"><span>包号</span><b>' + esc(doc.packId || '') + '</b></div>' +
      '</div>' +
      '<div class="sh-how">' +
        '<b>怎么念</b>' +
        '<span>① 一条录一段，按 01、02 的顺序来。</span>' +
        '<span>② 每条说完停一下再停录音。</span>' +
        '<span>③ <b>不认识、不这么说的词就跳过</b> —— 空着比编一条有用。</span>' +
        '<span>④ 录完把音频按顺序发回来，<b>不用改名</b>。</span>' +
      '</div>' +
      '<table class="sh-tab"><thead><tr>' +
        '<th class="c-no">号</th><th class="c-w">词</th><th class="c-m">意思</th><th class="c-k">它在你家怎么说</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table>' +
      '<p class="sh-foot">' + doc.items.length + ' 条 · 念完大约 ' +
        Math.max(1, Math.round(doc.items.length * 0.35)) + ' 分钟 · ' +
        '这一页是 ' + esc((doc.volume && doc.volume.name) || '') + ' 的 ' + doc.items.length + ' 个词</p>' +
      '</div>';
  }

  /* ---------------- 导出 ---------------- */

  function downloadJSON(filename, obj) {
    var txt = JSON.stringify(obj, null, 1);
    var blob = new Blob([txt], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    return txt.length;
  }

  window.XZ = window.XZ || {};
  window.XZ.pack = {
    format: FORMAT,
    maxItems: MAX_ITEMS,
    maxBytes: MAX_BYTES,
    currentVolume: currentVolume,
    currentWords: currentWords,
    hasRef: hasRef,
    buildPack: buildPack,
    validate: validate,
    pairFiles: pairFiles,
    numberOf: numberOf,
    splitInputs: splitInputs,
    importPack: importPack,
    sheetHTML: sheetHTML,
    downloadJSON: downloadJSON,
    guessMime: guessMime,
    pad2: pad2
  };
})();
