/* ============================================================
   features/quiz.js — 方言小游戏（答题闯关）
   ------------------------------------------------------------
   数据全部来自 window.ATLAS：关卡 → levelWords() → 四选一。
   作答正确的词条通过 store.unlockWords() 解锁，
   关卡结算通过 store.completeLevel() 写入，地图 pin 随之改态。
   ============================================================ */
(function () {
  'use strict';

  var A = window.ATLAS;
  var act = window.XZ.actions;
  var sel = window.XZ.selectors;

  var root = null;      // #stage
  var q = null;         // 当前局
  var KEY = ['A', 'B', 'C', 'D'];

  /* 方言名从卷数据来：这一句在每个方言区都得跟着换，不能写死 */
  var DIALECT = (window.XZ && window.XZ.volume && window.XZ.volume.dialect) || '徐州话';

  /* ---------------- 语音 ---------------- */
  var audio = {
    speak: function (text, rate) {
      try {
        if (!('speechSynthesis' in window)) return;
        window.speechSynthesis.cancel();
        var u = new SpeechSynthesisUtterance(text);
        u.lang = 'zh-CN';
        u.rate = rate || 0.8;
        u.pitch = 0.92;
        window.speechSynthesis.speak(u);
      } catch (e) { }
    }
  };

  /* 「听发音」优先链：有真人录音就播录音，否则回落上面的合成音。
     模块缺席（单独拷走 features/ 或脚本没加载）时行为与改动前完全一致。 */
  function speakWord(item, rate) {
    var S = window.XZ && window.XZ.sample && window.XZ.sample.speakOrSynth;
    // 学习场景要听的是"给定方言"，所以范本音优先；没范本音才退回自家录音
    if (S && item) return S(item, audio, rate, { prefer: 'ref' });
    if (item) audio.speak(item.w, rate);
    return Promise.resolve('synth');
  }

  /* 「听发音」必须说清是谁的嘴：范本音 / 你家的录音 / 普通话合成。
     学方言最忌讳的就是把合成音当范本——那等于在学普通话。
     来源常驻写在按钮旁边，而不是只弹一次 toast（弹完就忘，还挡题目）。 */
  function markSource(src, item) {
    var el = root.querySelector('[data-src]');
    if (!el) return;
    if (src === 'ref') {
      el.textContent = '范本音 · ' + DIALECT;
      el.className = 'q-src ref';
    } else if (src === 'real') {
      el.textContent = '你家的录音';
      el.className = 'q-src real';
    } else {
      /* 落到合成音有两种原因：真的没有录音，或者浏览器拦了这次自动播放。
         混为一谈会让人以为"录的东西丢了"——所以这里再看一眼有没有音源：
         有就说"点 ▶ 播"，没有才承认是合成音。 */
      var id = item && (item.atlasId || item.id);
      var S = window.XZ && window.XZ.sample, R = window.XZ && window.XZ.refs;
      var hasReal = !!(id && S && S.has(id)) || !!(id && R && R.has(id));
      if (hasReal) {
        el.textContent = '有真人录音 · 点 ▶ 播放';
        el.className = 'q-src pending';
      } else {
        el.textContent = '普通话合成 · 不是' + DIALECT;
        el.className = 'q-src synth';
      }
    }
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[<>&"]/g, function (c) {
      return ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c];
    });
  }
  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  /* ---------------- 出题 ---------------- */
  /* 一个词能不能考「释义」，取决于它有没有释义。
     自建卷里「词 | 释义 | 例句」后两列本来就可以省，只写词是很正常的事；
     旧逻辑一律拿 meaning 当选项文本，空释义去重后只剩正确项本身，
     结果就是一题一个空按钮 —— 看起来像"没有选项，只能打勾"。
     所以每题先判题型：
       meaning 型 → 选项是释义（原逻辑）
       listen  型 → 选项是词本身，靠"听发音"辨词，不需要释义 */
  function kindOf(w) { return (w.meaning && String(w.meaning).trim()) ? 'meaning' : 'listen'; }
  function textOf(w) { return kindOf(w) === 'meaning' ? String(w.meaning).trim() : (w.w || ''); }

  function buildQuestions(levelId) {
    var pool = sel.levelWords(levelId);
    if (!pool.length) return [];
    var all = A.words;

    // 优先出没解锁过的词：图鉴收集是这个项目的主要动机，反复出已解锁的词等于原地空转。
    // 两组各自洗牌（而不是把 fresh 整体排在前面），否则同一次里题序会按数据顺序泄露难度。
    var fresh = shuffle(pool.filter(function (w) { return !sel.isWordUnlocked(w.id); }));
    var repeat = shuffle(pool.filter(function (w) { return sel.isWordUnlocked(w.id); }));
    var ordered = [];
    for (var n = 0; n < Math.max(fresh.length, repeat.length); n++) {
      if (n < fresh.length) ordered.push(fresh[n]);
      if (n < repeat.length) ordered.push(repeat[n]);
    }

    // 每关最多 6 题，词多的关卡随机抽取
    var out = [];
    ordered.slice(0, 6).forEach(function (item) {
      var type = kindOf(item);
      /* 干扰项必须和本题同类型：释义题只能配释义，听音题只能配词，
         混着配会让选项一半是意思一半是字，看着就乱。 */
      var same = all.filter(function (w) { return w.id !== item.id && kindOf(w) === type; });
      var sameCat = same.filter(function (w) { return w.cat === item.cat; });
      var sameDiff = same.filter(function (w) { return w.difficulty === item.difficulty; });
      var rest = same;

      // 三段都必须洗牌：以前只有最终 opts 洗，而**取哪三个干扰项**是按数据原序定的，
      // 于是同一题的错误选项永远是同三个（背下来就能过）。
      var cand = shuffle(sameCat).concat(shuffle(sameDiff), shuffle(rest));
      var picked = [], used = {};
      used[textOf(item)] = 1;

      for (var i = 0; i < cand.length && picked.length < 3; i++) {
        var c = cand[i];
        var t = textOf(c);
        if (!t || used[t]) continue;
        used[t] = 1;
        picked.push(c);
      }

      /* 一个干扰项都凑不出来（整卷只有一个词）就别硬出题：
         单选题不成立，只会变成一个空按钮。 */
      if (!picked.length) return;

      var opts = shuffle([item].concat(picked)).map(function (o) {
        return { text: textOf(o), right: o.id === item.id };
      });

      out.push({ item: item, type: type, opts: opts });
    });

    return out;
  }


  /* ---------------- 渲染 ---------------- */
  function render() {
    if (!q) return;
    var cur = q.qs[q.i];
    var item = cur.item;
    var lv = q.level;
    var d = sel.district(lv.districtId);
    var cat = A.wordCats[item.cat] || { label: item.cat };

    var dots = q.qs.map(function (_, i) {
      if (i < q.results.length) return '<i class="' + (q.results[i] ? 'ok' : 'no') + '"></i>';
      return '<i class="' + (i === q.i ? 'now' : '') + '"></i>';
    }).join('');

    var opts = cur.opts.map(function (o, i) {
      return '<button class="q-opt" data-i="' + i + '">' +
        '<span class="q-k">' + KEY[i] + '</span>' +
        '<span class="q-t">' + esc(o.text) + '</span>' +
        '<span class="q-mk"></span></button>';
    }).join('');

    /* 听音题不能把词摆在标题上 —— 选项就是词，一露字这题就白送。
       只在答完之后由 .q-reveal 揭晓。 */
    var isListen = cur.type === 'listen';
    var headName = String(lv.name || '');
    var headLabel = /^第\s*\d+\s*关/.test(headName) ? headName : '第 ' + lv.id + ' 关 · ' + headName;

    root.innerHTML =
      '<div class="stage-inner">' +
      '<div class="q-head">' +
      '<button class="q-close" data-close aria-label="退出">✕</button>' +
      '<div class="q-head-txt">' +
      '<b>' + esc(headLabel) + '</b>' +
      '<span>' + (d ? esc(d.name) + ' · ' : '') + esc(lv.place) + '</span>' +
      '</div>' +
      '<div class="q-head-val">' + S0().value + '<small>方言值</small></div>' +
      '</div>' +

      '<div class="q-dots">' + dots + '</div>' +

      '<div class="q-body">' +
      '<div class="q-tags"><span>' + esc(isListen ? '听音辨词' : cat.label) + '</span>' +
      '<span class="q-diff">' + '★'.repeat(item.difficulty) + '</span></div>' +
      (isListen
        ? '<div class="q-word q-word-hide">？</div>'
        : '<div class="q-word">' + esc(item.w) + '</div>') +
      '<div class="q-py">' + esc(isListen ? '' : (item.py || '')) + '</div>' +
      '<button class="q-play" data-play>' +
      '<svg viewBox="0 0 24 24"><path d="M8 5.5v13l11-6.5z"/></svg>' +
      '<span>听发音</span></button>' +
      '<span class="q-src" data-src></span>' +
      '<div class="q-ask">' + (isListen ? '刚才听到的是哪一个词？' : '这句' + esc(DIALECT) + '的意思是？') + '</div>' +
      '</div>' +

      '<div class="q-opts">' + opts + '</div>' +
      '<div class="q-reveal"></div>' +
      '<div class="q-foot"><button class="q-next" data-next hidden>下一题</button></div>' +
      '</div>';

    q.locked = false;
    bind();
    setTimeout(function () { if (q && !q.locked) speakWord(item, 0.72).then(function (s) { markSource(s, item); }); }, 260);
  }

  function S0() { return window.XZ.store.get(); }

  function bind() {
    var close = root.querySelector('[data-close]');
    if (close) close.addEventListener('click', api.close);

    var play = root.querySelector('[data-play]');
    if (play) play.addEventListener('click', function () {
      var it = q.qs[q.i].item;
      speakWord(it, 0.7).then(function (s) { markSource(s, it); });
      play.classList.add('on');
      setTimeout(function () { play.classList.remove('on'); }, 900);
    });

    Array.prototype.forEach.call(root.querySelectorAll('.q-opt'), function (b) {
      b.addEventListener('click', function () { answer(+b.dataset.i, b); });
    });

    /* 「下一题」必须绑上 —— 它是答完之后唯一能往下走的东西。
       这里曾经一个字都没写：按钮画出来了、也显示出来了，就是点了没反应，
       于是每一关都停在第一题。测试一直没发现，是因为此前只验"进得去、退得出"，
       从来没有真的走完一道题。 */
    var nx = root.querySelector('[data-next]');
    if (nx) {
      var at = q ? q.i : -1;
      nx.addEventListener('click', function () {
        /* 防连点：render() 之后 q.i 已经变了，旧按钮不该再推进一次 */
        if (!q || !q.locked || q.i !== at) return;
        next();
      });
    }
  }

  function answer(idx, btn) {
    if (!q || q.locked) return;
    q.locked = true;

    var cur = q.qs[q.i];
    var item = cur.item;
    var ok = cur.opts[idx].right;

    Array.prototype.forEach.call(root.querySelectorAll('.q-opt'), function (b, i) {
      b.disabled = true;
      if (cur.opts[i].right) {
        b.classList.add('ok');
        b.querySelector('.q-mk').textContent = '✓';
      } else if (i === idx) {
        b.classList.add('no');
        b.querySelector('.q-mk').textContent = '✗';
      } else {
        b.classList.add('dim');
      }
    });

    q.results[q.i] = ok;
    if (ok) {
      q.right++;
      act.unlockWords([item.id]);
      var dot = root.querySelectorAll('.q-dots i')[q.i];
      if (dot) dot.className = 'ok';
    } else {
      var dot2 = root.querySelectorAll('.q-dots i')[q.i];
      if (dot2) dot2.className = 'no';
    }

    if (btn) {
      var r = btn.getBoundingClientRect();
      floatScore(ok ? '+10' : '×', r.right - 36, r.top + 6);
    }

    var rv = root.querySelector('.q-reveal');
    rv.innerHTML =
      '<div class="q-rv ' + (ok ? '' : 'bad') + '">' +
      '<div class="q-rv-h"><b>' + esc(item.w) + '</b>' +
      '<i>' + esc(item.py || '') + '</i>' +
      '<span class="' + (ok ? 'ok' : 'no') + '">' + (ok ? '✓ 答对 · +10' : '✗ 记一下') + '</span></div>' +
      /* 自建卷常常没有释义和例句，空着就别印空标签 */
      (item.meaning ? '<div class="q-rv-m"><em>释义</em>' + esc(item.meaning) + '</div>' : '') +
      (item.example ? '<div class="q-rv-e">' + esc(item.example) + '</div>' : '') +
      '</div>';
    rv.classList.add('on');

    var nx = root.querySelector('[data-next]');
    nx.hidden = false;
    nx.textContent = (q.i >= q.qs.length - 1) ? '完成本关' : '下一题';
    nx.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    var hv = root.querySelector('.q-head-val');
    if (hv) hv.innerHTML = S0().value + '<small>方言值</small>';
  }

  function next() {
    if (!q) return;
    q.i++;
    if (q.i >= q.qs.length) { finish(); return; }
    render();
    var body = root.querySelector('.q-body');
    if (body) body.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function finish() {
    var lv = q.level;
    var total = q.qs.length;
    var right = q.right;
    var rate = Math.round(right / total * 100);
    var stars = rate >= 100 ? 3 : rate >= 80 ? 2 : 1;

    var res = act.completeLevel(lv.id, stars, right, total);
    var tier = sel.tier();
    var book = sel.bookProgress();

    root.innerHTML =
      '<div class="stage-inner q-result">' +
      '<div class="qr-eyebrow">第 ' + lv.id + ' 关 · ' + esc(lv.name) + '</div>' +
      '<div class="qr-stars">' + '★'.repeat(stars) + '<i>' + '★'.repeat(3 - stars) + '</i></div>' +
      '<div class="qr-num">' + right + '<span>/' + total + '</span></div>' +
      '<div class="qr-tier">' + esc(tier.name) + '</div>' +
      '<div class="qr-stats">' +
      '<div><b>+' + (right * 10 + (res.first ? 20 : 0)) + '</b><span>本次得分</span></div>' +
      '<div><b>' + S0().value + '</b><span>累计方言值</span></div>' +
      '<div><b>' + book.unlocked + '/' + book.total + '</b><span>已解锁词条</span></div>' +
      '</div>' +
      (res.first ? '<div class="qr-badge">首次通关 · 该区方言点已点亮</div>' : '<div class="qr-badge dim">重玩不加分 · 只刷新星级</div>') +
      '<div class="qr-acts">' +
      '<button class="q-btn ghost" data-retry>再玩一次</button>' +
      '<button class="q-btn primary" data-close2>回到地图</button>' +
      '</div>' +
      '</div>';

    root.querySelector('[data-close2]').addEventListener('click', api.close);
    root.querySelector('[data-retry]').addEventListener('click', function () {
      api.start(lv.id);
    });
  }

  function floatScore(txt, x, y) {
    var d = document.createElement('div');
    d.className = 'q-float';
    d.textContent = txt;
    d.style.left = x + 'px';
    d.style.top = y + 'px';
    document.body.appendChild(d);
    setTimeout(function () { d.remove(); }, 1000);
  }

  /* 出不了题时不要静默关掉 —— 点了「测一测」什么都没发生，比报错更让人摸不着头脑。 */
  function showEmpty(lv) {
    root = document.getElementById('stage');
    if (!root) return;
    var pool = sel.levelWords(lv.id);
    var msg = pool.length
      ? '这一卷只有 ' + pool.length + ' 个词条，至少要 2 个才能出题。回到卷首页点「＋ 添词」再补几个。'
      : '这一卷还没有词条。先点「＋ 添词」，或者在采录台录几条再来。';
    root.className = 'stage on';
    root.innerHTML =
      '<div class="stage-inner"><div class="q-empty">' +
      '<div class="q-empty-mark">测一测</div>' +
      '<p>' + esc(msg) + '</p>' +
      '<button class="q-empty-b" data-close>知道了</button>' +
      '</div></div>';
    document.body.classList.add('stage-open');
    var b = root.querySelector('[data-close]');
    if (b) b.addEventListener('click', function () { api.close(); });
  }

  /* ---------------- 对外 ---------------- */
  var api = {
    el: function () { return root; },

    start: function (levelId) {
      var lv = sel.level(levelId);
      if (!lv) { api.close(); return; }
      var qs = buildQuestions(lv.id);
      if (!qs.length) { showEmpty(lv); return; }

      root = document.getElementById('stage');
      root.className = 'stage on';

      q = { level: lv, qs: qs, i: 0, right: 0, results: [], locked: false };
      act.startLevel(lv.id);
      render();
      document.body.classList.add('stage-open');
    },

    close: function () {
      if (!root) return;
      // 没答完就退出 = 放弃：必须清掉 levels.active，否则那个区县会永久显示「进行中」
      // （completeLevel 已经清过，所以这里只在"未到结算"时生效）
      if (q && q.i < q.qs.length) act.abandonLevel();
      root.className = 'stage';
      root.innerHTML = '';
      q = null;
      document.body.classList.remove('stage-open');

      var back = window.XZ.router.returnPath();
      if (back && back.indexOf('#/quiz') !== 0) {
        if (location.hash === back) window.XZ.router.dispatch();
        else location.hash = back;
      } else {
        window.XZ.router.go('home');
      }
    },

    isOpen: function () { return !!(q && root && root.classList.contains('on')); }
  };

  window.XZ = window.XZ || {};
  window.XZ.quiz = api;

  /* 题卡上印着 A/B/C/D 键帽，此前却没有任何键盘监听 —— 键盘用户看得见提示却按不动。
     现在 1-4 与 A-D 都能作答；只在答题界面打开时生效，不抢搜索框的输入。 */
  document.addEventListener('keydown', function (e) {
    if (!api.isOpen() || !q || q.locked) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    var k = String(e.key || '').toLowerCase();
    var idx = '1234'.indexOf(k);
    if (idx < 0) idx = 'abcd'.indexOf(k);
    if (idx < 0) return;
    var btn = root.querySelectorAll('.q-opt')[idx];
    if (!btn) return;
    e.preventDefault();
    answer(idx, btn);
  });

  // 路由接管（脚本位于 body 末尾，DOM 已就绪，直接注册）
  window.XZ.router.on('quiz', function (param) {
    api.start(Number(param) || 1);
  });
})();
