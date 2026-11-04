/* ============================================================
  // ········································································
  // ········································································
  // ········································································
  // ········································································
  // ········································································
  // ········································································
  // ········································································
  // ········································································
  // ········································································
  // ········································································
  // ········································································
  // ········································································
   app.js — 方言采样台引擎
   ------------------------------------------------------------
   四块技术：
     ① 采集    getUserMedia + MediaRecorder，关闭 AGC/降噪，
               因为自动增益会破坏基频曲线的形状。
     ② 分析    自相关法提基频（F0）→ 整段音高走向（类别 + 参考读数）。
               全程本地计算，不调任何识别服务。
     ③ 存档    IndexedDB（localStorage 存不下二进制）。
     ④ 导出    OfflineAudioContext 重采样到 16k 单声道 → 手写 WAV 头 →
               base64 内嵌，产出一个脱离本程序也能打开的单文件。

   ------------------------------------------------------------
   ⚠ 行号契约（改动本文件前必读，改完必跑 tools/anchor-check.cjs）
   ------------------------------------------------------------
   外部验收脚本按「行号」切片本文件并单独求值，因此下面三段的
   位置与行数是契约，动了它们，验收脚本就会切到错误的代码：

     134–200   Analysis 对象的 mono/f0/levels 三个方法（会被包成
               { … } 求值，只能依赖这三个方法与全局对象）
     203–216   function stats(frames, levels) —— 独立函数表达式，
               不得引用本文件的任何闭包变量
     504–528   function encodeWavBase64(samples, sr) —— 同上

   所以新增能力优先写在三段之外（界面 / 存档 / 导出），
   或在三段内就地改写而不增减行数。

   ------------------------------------------------------------
   声学上的两个决定（都不是「调阈值调出来的」）
   ------------------------------------------------------------
   1) 倍频纠错用 0.98 而不是 0.99：0.98 能让 170/180/340Hz 这类
      「周期不是整数样本」的信号回到真值，对 70–150Hz 的最大扰动
      只有 +0.8%；0.99 虽然更严，却会把低嗓音整体抬高。浊音门限
      0.32 不动，判据仍是「相邻帧跳变 > 1.6 倍」。
   2) 静音门限用「帧 RMS 的 95% 分位 × 0.15」，再配一个绝对下限
      1e-3：只用相对分位时整段无声也会被整体放行（界面会画出一条
      由底噪编出来的曲线）；绝对下限让「什么都没录到」会被报红。
      1e-3 ≈ −60 dBFS，比 16bit 量化噪声底（≈3e-5）高约 30 倍，
      又比最轻的可用语声（约 1e-2）低一个数量级。
   ============================================================ */
(function () {
  'use strict';

  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));
  const P = window.PROMPTS || [];

  const BUCKET_NAME = { new: '新事物 · 长辈没有的词', old: '老器物 · 正在消失的词', home: '家词 · 只有你家这么说', sent: '句子 · 录语序与语气', atlas: '词表题 · 来自《乡音册》词表', free: '自定 · 你自己想录的' };
  /** 填补策略三分类：借音 / 意译 / 旧词延伸（导出后要能按这三类统计） */
  const STRATEGY = ['借音', '意译', '旧词延伸', '其他'];
  /** 判定人：策略归类必须标明是谁判的，记录者自评不当证据 */
  const STRATEGY_BY = ['记录者', '长辈本人', '未知'];

  /* ---------------- 错误可见化 ---------------- */
  let bannerTimer = 0;
  function banner(msg) {
    const el = $('#banner');
    el.textContent = msg;
    el.classList.add('on');
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => el.classList.remove('on'), 6000);
  }
  window.addEventListener('error', (e) => banner('脚本出错：' + (e.message || e.error)));
  window.addEventListener('unhandledrejection', (e) => banner('异步出错：' + ((e.reason && e.reason.message) || e.reason)));

  function esc(s) {
    return String(s == null ? '' : s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);
  }
  /** 唯一的时长格式化函数：界面与存档 JSON 用同一份 */
  function fmtMs(ms) {
    if (ms == null || !isFinite(ms)) return '—';
    return (ms / 1000).toFixed(1) + 's';
  }
  /** 题目的汉字数（去标点）：≥4 字的题按「不出调型」模式处理 */
  function hanLen(text) {
    return Array.from(String(text == null ? '' : text).replace(/[“”"？！。，！]/g, '')).length;
  }

  /* ---------------- ① 环境自检 ---------------- */
  function selfCheck() {
    const items = [];
    // 不能只看 isSecureContext：Chrome 下 file:// 的 isSecureContext 仍是 true，
    // 实测会「加载态假绿」，点下去才报 Permission denied。判据改为「协议 + 主机」。
    const proto = location.protocol;
    const host = location.hostname;
    const served = (proto === 'http:' && (host === '127.0.0.1' || host === 'localhost')) || proto === 'https:';
    items.push(['运行环境', served, served ? '' : '请用 http://127.0.0.1:8000 打开，不能双击 file://']);
    items.push(['录音接口', !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia), '', '']);
    items.push(['MediaRecorder', !!window.MediaRecorder, '', '']);
    items.push(['音频分析', !!(window.AudioContext || window.webkitAudioContext), '', '']);
    // 导出 WAV 要重采样，靠 OfflineAudioContext；Safari 旧版只有 webkit 前缀
    items.push(['音频导出', !!(window.OfflineAudioContext || window.webkitOfflineAudioContext), '',
      '这个浏览器没有 OfflineAudioContext，导出的 WAV 无法重采样']);
    items.push(['IndexedDB', !!window.indexedDB, '', '']);
    const mime = chooseMime();
    items.push(['录音格式', !!mime, mime || '浏览器不支持任何可用的 mime']);

    $('#selfcheck').innerHTML = items.map(([name, ok, note]) =>
      '<span class="chk ' + (ok ? 'ok' : 'bad') + '">' + (ok ? '✓ ' : '✗ ') + esc(name) +
      (note && !ok ? ' · ' + esc(note) : '') + '</span>').join('');

    if (!served) banner('当前不是可用的运行环境，浏览器不会给麦克风权限。请用 http://127.0.0.1:8000 打开（见 README）。');
    return served && !!mime;
  }

  function chooseMime() {
    if (!window.MediaRecorder || !MediaRecorder.isTypeSupported) return '';
    const cands = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
    for (const m of cands) { try { if (MediaRecorder.isTypeSupported(m)) return m; } catch (e) {} }
    return '';
  }

  /* 构造 MediaRecorder：先按选定格式 + 码率建，被拒再逐级退回。
     Safari 对不认识的选项（audioBitsPerSecond）会直接抛 NotSupportedError，
     所以不能一次到位；退回顺序是「格式+码率 → 只要格式 → 全默认」。 */
  function makeRecorder(stream, mime) {
    if (mime) {
      try { return new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 64000 }); } catch (e) {}
      try { return new MediaRecorder(stream, { mimeType: mime }); } catch (e) {}
    }
    return new MediaRecorder(stream);
  }

  /* ---------------- ② 分析：基频提取 ---------------- */
  const Analysis = {
    _ctx: null,
    ctx() {
      if (!this._ctx) this._ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (this._ctx.state === 'suspended') this._ctx.resume();
      return this._ctx;
    },
    async decode(blob) {
      const ab = await blob.arrayBuffer();
      const ctx = this.ctx();
      // Chrome / Firefox / Safari 14+ 返回 Promise；更老的 WebKit 只认回调式，
      // 且 decodeAudioData 会接管（detach）传入的 ArrayBuffer，所以回调式必须另给一份拷贝。
      const r = ctx.decodeAudioData(ab);
      if (r && typeof r.then === 'function') return await r;
      return await new Promise((res, rej) => ctx.decodeAudioData(ab.slice(0), res, rej));
    },
    mono(buf, factor) {
      const ch = buf.numberOfChannels, len = buf.length, chans = [];
      for (let c = 0; c < ch; c++) chans.push(buf.getChannelData(c));
      const out = new Float32Array(Math.floor(len / factor));
      for (let i = 0; i < out.length; i++) {
        let s = 0;
        for (let j = 0; j < factor; j++) {
          const k = i * factor + j;
          for (let c = 0; c < ch; c++) s += chans[c][k];
        }
        out[i] = s / (factor * ch);
      }
      return out;
    },
    /**
     * 自相关基频追踪，返回 [{t, f0, r, low}]：f0=0 表清音/静音，r 为置信度，
     * low=1 表低置信帧（画灰点，不抹掉）。倍频纠错：回退到第一个 r >= 0.98×bestR 的 lag。
     */
    f0(blob) {
      return this.decode(blob).then((buf) => {
        const factor = Math.max(1, Math.floor(buf.sampleRate / 11025));
        const x = this.mono(buf, factor), sr = buf.sampleRate / factor;
        const win = Math.round(sr * 0.040), hop = Math.round(sr * 0.015);
        const minLag = Math.floor(sr / 400), maxLag = Math.ceil(sr / 70);
        const raw = [];
        for (let off = 0; off + win < x.length; off += hop)
          raw.push({ off: off, rms: Math.sqrt(x.slice(off, off + win).reduce((a, b) => a + b * b, 0) / win) });
        const rr = raw.map((o) => o.rms).sort((a, b) => a - b);
        const p95 = rr.length ? rr[Math.min(rr.length - 1, Math.floor(rr.length * 0.95))] : 0;
        const gate = Math.max(p95 * 0.15, 1e-3), frames = [];
        for (const o of raw) {
          const t = o.off / sr;
          if (o.rms < gate) { frames.push({ t: t, f0: 0, r: 0, low: 0 }); continue; }
          const rs = [];
          let best = 0, bestLag = minLag;
          for (let lag = minLag; lag <= maxLag; lag++) {
            let num = 0, e1 = 0, e2 = 0;
            for (let i = 0; i + lag < win; i++) { const a = x[o.off + i], b = x[o.off + i + lag]; num += a * b; e1 += a * a; e2 += b * b; }
            const r = num / (Math.sqrt(e1 * e2) || 1);
            rs.push(r);
            if (r > best) { best = r; bestLag = lag; }
          }
          let lag = bestLag;
          for (let k = 0; k < rs.length; k++) { if (rs[k] >= 0.98 * best) { lag = minLag + k; break; } }
          const r = rs[lag - minLag];
          frames.push({ t: t, f0: best >= 0.32 ? sr / lag : 0, r: r, low: best >= 0.32 && r < 0.5 ? 1 : 0 });
        }
        this.meta = { ctxRate: buf.sampleRate, factor: factor, analysisRate: sr };
        return frames;
      });
    },
    /** 5 度制曲线 + 整段音高走向类别；__a 携带派生量供 stats 读取 */
    levels(frames) {
      const V = frames.filter((f) => f.f0 > 0), F = V.map((f) => f.f0), n = F.length;
      const S = F.slice().sort((a, b) => a - b), at = (p) => S[Math.min(n - 1, Math.floor(n * p))] || 0;
      const lo = at(0.05), hi = at(0.95), dyn = lo > 0 ? 12 * Math.log2(hi / lo) : 0, z = F.map((f) => 12 * Math.log2(f / (at(0.5) || 1)));
      const k = Math.max(1, n / 3 | 0), av = (a) => a.reduce((s, v) => s + v, 0) / a.length;
      const q1 = av(z.slice(0, k)), q2 = av(z.slice(k, 2 * k)), q3 = av(z.slice(2 * k));
      const cat = n < 3 ? '不可辨' : dyn < 1.5 ? '平' : (q2 - q1 < -0.5 && q3 - q2 > 0.5) ? '降升'
        : (q2 - q1 > 0.5 && q3 - q2 < -0.5) ? '升降' : (q3 - q1 > 0.5) ? '升' : (q3 - q1 < -0.5) ? '降' : '平';
      const out = n < 3 ? frames.map(() => 0) : frames.map((f) => (f.f0 > 0 ? (dyn >= 1.5 ? 1 + 4 * (f.f0 - lo) / (hi - lo) : 3) : 0));
      const idx = out.map((v, i) => (v > 0 ? i : -1)).filter((i) => i >= 0);
      const pick = idx.length >= 3 ? [idx[0], idx[idx.length >> 1], idx[idx.length - 1]] : null;
      const contour = pick && cat !== '平' && cat !== '不可辨' ? pick.map((i) => Math.max(1, Math.min(5, Math.round(out[i])))).join('') : '—';
      out.__a = { category: cat, contour: contour, dynamicSemitones: dyn };
      return out;
    }
  };

function stats(frames, levels) {
  const A = levels.__a || {}, V = frames.filter((f) => f.f0 > 0), n = V.length, N = frames.length;
  const dur = n ? V[n - 1].t - V[0].t : 0;
  const mean = n ? V.reduce((s, f) => s + f.f0, 0) / n : 0;
  const degraded = N > 0 && n / N < 0.1;
  let jumps = 0; for (let i = 1; i < n; i++) if (V[i].f0 > V[i - 1].f0 * 1.6 || V[i].f0 < V[i - 1].f0 / 1.6) jumps++;
  const lowConf = V.filter((f) => f.low).length, fs = V.map((f) => f.f0);
  return {
    dur: dur, voiceMs: Math.round(dur * 1000), mean: degraded ? null : mean,
    contour: degraded ? '—' : (A.contour || '—'), category: degraded ? '不可辨' : (A.category || '不可辨'),
    dynamicSemitones: A.dynamicSemitones || 0, voiced: n, total: N, degraded: degraded,
    jumps: jumps, lowConf: lowConf, f0min: n ? Math.min.apply(null, fs) : 0, f0max: n ? Math.max.apply(null, fs) : 0
  };
}

  // ········································································
  // ········································································
  // ········································································
  // ········································································
  // ········································································
  // ········································································
  // ········································································
  // ········································································
  // ········································································
  // ········································································
  function contourSVG(frames, levels) {
    const W = 320, H = 96, PAD = 10;
    if (!frames.length) return '';
    const tMax = frames[frames.length - 1].t || 1;
    const parts = [];
    for (let g = 1; g <= 5; g++) {
      const y = PAD + (5 - g) / 4 * (H - PAD * 2);
      parts.push('<line x1="0" y1="' + y + '" x2="' + W + '" y2="' + y + '" stroke="rgba(27,26,23,.13)"/>');
    }
    // 方格纸：每 1/8 宽一条竖线（配上面的 5 条横线，做出记录纸的格子）
    for (let gx = 1; gx < 8; gx++) {
      const gxp = gx / 8 * W;
      parts.push('<line x1="' + gxp + '" y1="0" x2="' + gxp + '" y2="' + H + '" stroke="rgba(27,26,23,.07)"/>');
    }
    let d = '', pen = false;
    frames.forEach((f, i) => {
      if (levels[i] <= 0) { pen = false; return; }
      const x = (f.t / tMax) * W;
      const y = PAD + (5 - levels[i]) / 4 * (H - PAD * 2);
      d += (pen ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1) + ' ';
      pen = true;
    });
    parts.push('<path d="' + d + '" fill="none" stroke="#2A2723" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>');
    // 低置信帧不抹掉：画成灰点，并单独计数
    let low = 0;
    frames.forEach((f, i) => {
      if (!f.low || levels[i] <= 0) return;
      low++;
      const x = (f.t / tMax) * W;
      const y = PAD + (5 - levels[i]) / 4 * (H - PAD * 2);
      parts.push('<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="2.2" fill="rgba(27,26,23,.35)"/>');
    });
    if (low) parts.push('<text x="' + (W - 6) + '" y="' + (H - 8) + '" fill="rgba(27,26,23,.5)" font-size="8.5" text-anchor="end">低置信 ' + low + ' 帧</text>');
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none">' + parts.join('') + '</svg>';
  }

  /* ---------------- 录音 ---------------- */
  const rec = {
    stream: null, mr: null, chunks: [], t0: 0, tick: 0,
    async init() {
      if (this.stream) return this.stream;
      // 关掉 AGC 与降噪：它们会改变音高包络，破坏基频分析
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
      });
      return this.stream;
    },
    async start() {
      const s = await this.init();
      this.chunks = [];
      const m = chooseMime();
      this.mr = makeRecorder(s, m);
      this.mime = (this.mr && this.mr.mimeType) || m || '';
      this.mr.ondataavailable = (e) => { if (e.data && e.data.size) this.chunks.push(e.data); };
      this.t0 = performance.now();
      this.mr.start();
    },
    stop() {
      return new Promise((res) => {
        const mr = this.mr;
        if (!mr) return res(null);
        mr.onstop = () => {
          // 不能写死 audio/webm：Safari 录出来是 audio/mp4，标错类型会让回放与解码失败
          const blob = new Blob(this.chunks, { type: mr.mimeType || this.mime || (this.chunks[0] && this.chunks[0].type) || '' });
          this.mr = null;
          res({ blob: blob, durMs: Math.round(performance.now() - this.t0) });
        };
        try { mr.stop(); } catch (e) { this.mr = null; res(null); }
      });
    }
  };

  /* ---------------- 状态 ---------------- */
  const S = {
    idx: 0,
    recording: false,
    envOk: false,         // 环境自检结果：决定录音按钮是否可用
    pending: null,     // { blob, durMs, frames, levels, st }
    clips: [],
    urls: [],
    urlStats: { created: 0, revoked: 0 }   // objectURL 收支计数，供验收断言
  };
  const cur = () => P[Math.min(S.idx, P.length - 1)];

  /** 统一的 objectURL 计数：创建与回收都要可数 */
  function mkURL(blob) {
    const u = URL.createObjectURL(blob);
    S.urlStats.created++;
    return u;
  }
  function revokeURL(u) {
    if (!u) return;
    URL.revokeObjectURL(u);
    S.urlStats.revoked++;
  }

  /* ---------------- 渲染：题目 ---------------- */
  const POS_KEY = 'xzdt.pos.v1';
  let resumeHint = false;

  function drawPrompt() {
    const p = cur();
    // 记住停在哪儿：93 道题一次录不完，下次进来接着上次，而不是从头
    try { localStorage.setItem(POS_KEY, String(S.idx)); } catch (e) { }
    $('#bucketTag').className = 'tag ' + p.bucket;
    $('#bucketTag').textContent = BUCKET_NAME[p.bucket] || p.bucket;
    $('#promptText').textContent = p.text;
    $('#promptHint').textContent = p.hint || '';
    const done = S.clips.some((c) => c.promptId === p.id);
    $('#promptIndex').textContent = '第 ' + (S.idx + 1) + ' / ' + P.length +
      (done ? ' · 已录过，可再录一条不同人的' : '') +
      (resumeHint ? ' · 接着上次' : '');
    if (resumeHint) { resumeHint = false; }
    $('#fGloss').value = p.gloss || '';
    $('#fSaying').value = '';
    $('#fSayingPy').value = '';
    $('#fStrategy').value = p.expectedStrategy || '';
    $('#fStrategyBy').value = '记录者';
    $('#resultRow').style.display = 'none';
    S.pending = null;
    // 按钮可用性由环境自检决定，不能在这里无条件启用 —— 否则 file:// 下
    // 徽标虽红、按钮却仍可点，点下去才报 Permission denied（F4 的假绿）
    $('#recBtn').disabled = !S.envOk;
    $('#recBtn').className = 'primary';
    $('#recLabel').textContent = '按下开始录音';
    $('#recTimer').textContent = '0.0s';
  }

  function startTimer() {
    const t0 = performance.now();
    clearInterval(S.tick);
    S.tick = setInterval(() => {
      $('#recTimer').textContent = fmtMs(performance.now() - t0);
    }, 100);
  }
  function stopTimer() { clearInterval(S.tick); S.tick = 0; }

  /* ---------------- 录音交互 ---------------- */
  async function toggleRec() {
    if (!S.recording) {
      try {
        await rec.start();
      } catch (e) {
        banner('打不开麦克风：' + (e && e.message) + '（需 http://127.0.0.1:8000，且允许麦克风权限）');
        return;
      }
      S.recording = true;
      $('#recBtn').classList.add('rec');
      $('#recLabel').textContent = '正在录 · 点一下结束';
      startTimer();
      return;
    }

    S.recording = false;
    $('#recBtn').classList.remove('rec');
    $('#recLabel').textContent = '分析中…';
    $('#recBtn').disabled = true;
    stopTimer();
    $('#recTimer').textContent = '0.0s';

    const got = await rec.stop();
    if (!got || !got.blob.size) {
      banner('没录到声音，检查一下麦克风。');
      $('#recBtn').disabled = false;
      $('#recLabel').textContent = '按下开始录音';
      return;
    }

    try {
      const frames = await Analysis.f0(got.blob);
      const levels = Analysis.levels(frames);
      const st = stats(frames, levels);
      S.pending = { blob: got.blob, durMs: got.durMs, frames: frames, levels: levels, st: st };

      $('#waveBox').innerHTML = contourSVG(frames, levels);
      $('#metrics').innerHTML = metricsHTML(st, cur());
      $('#resultRow').style.display = 'block';
      $('#recBtn').disabled = false;
      $('#recLabel').textContent = '重录一条';
      if (st.degraded) banner('没检测到语音（浊音帧 ' + st.voiced + '/' + st.total + '）：检查输入设备，或重录一条。');
    } catch (e) {
      banner('分析失败：' + (e && e.message));
      $('#recBtn').disabled = false;
      $('#recLabel').textContent = '按下开始录音';
    }
  }

  /**
   * 指标区分两档：
   *   ≥4 字的题 —— 不出调型，只出时长 / 基频 / 范围 / 动态 / 浊音占比
   *   2–3 字的题 —— 出「整段音高走向」类别为主，三位数为参考值
   */
  function metricsHTML(st, prompt) {
    const mode = hanLen(prompt && prompt.text) >= 4 ? 'none' : 'whole-span';
    const sp = [];
    sp.push('<span>语音时长 <b>' + fmtMs(st.voiceMs) + '</b></span>');
    sp.push('<span>平均基频 <b>' + (st.mean ? Math.round(st.mean) + ' Hz' : '—') + '</b></span>');
    sp.push('<span>F0 范围 <b>' + (st.voiced ? Math.round(st.f0min) + '–' + Math.round(st.f0max) + ' Hz' : '—') + '</b></span>');
    sp.push('<span>动态 <b>' + (st.dynamicSemitones ? st.dynamicSemitones.toFixed(2) + ' 半音' : '—') + '</b></span>');
    sp.push('<span>浊音帧 <b>' + st.voiced + ' / ' + st.total + '</b></span>');
    if (st.jumps) sp.push('<span>倍频跳变 <b>' + st.jumps + '</b></span>');
    if (st.lowConf) sp.push('<span>低置信 <b>' + st.lowConf + '</b></span>');
    if (mode === 'whole-span') {
      sp.push('<span class="hl">整段音高走向 <b>' + esc(st.category) + '</b></span>');
      sp.push('<span>参考读数 <b>' + esc(st.contour) + '</b></span>');
      sp.push('<span class="dim">非音节级</span>');
    }
    if (st.degraded) sp.push('<span class="bad">未检测到语音</span>');
    return sp.join('');
  }

  /* ---------------- 渲染：列表与进度 ---------------- */
  async function save() {
    const p = cur(), pd = S.pending;
    if (!pd) return;
    // 说法文本是必填项 —— 没有它，「借音/意译/旧词延伸」就没有被统计的对象
    const saying = $('#fSaying').value.trim();
    if (!saying) {
      banner('请先填「你家的说法」——这是每条录音最要紧的一栏，不能空着。');
      $('#fSaying').focus();
      return;
    }
    const sayingPy = $('#fSayingPy').value.trim();
    const strategy = $('#fStrategy').value.trim();
    const strategyBy = $('#fStrategyBy').value.trim();
    if (strategy && !strategyBy) {
      banner('请写明这个策略归类是谁判的。');
      return;
    }
    const mode = hanLen(p.text) >= 4 ? 'none' : 'whole-span';
    const rec0 = {
      id: p.id + '-' + Date.now(),
      promptId: p.id,
      atlasId: p.atlasId || null,
      text: p.text,
      bucket: p.bucket,
      saying: saying,
      sayingPy: sayingPy,
      expectedStrategy: p.expectedStrategy || '',
      strategy: strategy,
      strategyBy: strategyBy,
      gloss: $('#fGloss').value.trim(),
      speaker: $('#fSpeaker').value.trim(),
      gen: Number($('#fGen').value),
      correct: Number($('#fCorrect').value),
      common: Number($('#fCommon').value),
      note: $('#fNote').value.trim(),
      durMs: pd.durMs,
      voiceMs: pd.st.voiceMs,
      voiceDur: fmtMs(pd.st.voiceMs),
      meanF0: pd.st.mean ? Math.round(pd.st.mean) : null,
      f0min: Math.round(pd.st.f0min), f0max: Math.round(pd.st.f0max),
      dynamicSemitones: pd.st.dynamicSemitones,
      category: mode === 'whole-span' ? pd.st.category : '—',
      contour: mode === 'whole-span' ? pd.st.contour : '—',
      contourMode: mode,
      voicedFrames: pd.st.voiced, totalFrames: pd.st.total,
      jumps: pd.st.jumps, lowConf: pd.st.lowConf, degraded: pd.st.degraded,
      capture: captureMeta(pd.blob),
      createdAt: Date.now(),
      mime: pd.blob.type,
      blob: pd.blob
    };
    rec0.stars = '★'.repeat(rec0.correct + 1); clearTimeout(bannerTimer); $('#banner').textContent = ''; $('#banner').classList.remove('on');
    await store.put(rec0);
    await reload();
    stampOnce();
    // 跳到下一个还没录的题
    const done = new Set(S.clips.map((c) => c.promptId));
    let next = -1;
    for (let i = 1; i <= P.length; i++) {
      const k = (S.idx + i) % P.length;
      if (!done.has(P[k].id)) { next = k; break; }
    }
    if (next >= 0) { S.idx = next; drawPrompt(); }
    else banner('全部 ' + P.length + ' 题都录过了。可以重录，或者导出存档。');
  }

  /* 落一枚「录」印：存下来这件事应该有个物理动作，而不是只闪一行提示 */
  let stampTimer = 0;
  function stampOnce() {
    const el = document.getElementById('stamp');
    if (!el) return;
    el.classList.remove('on');
    void el.offsetWidth;
    el.classList.add('on');
    clearTimeout(stampTimer);
    stampTimer = setTimeout(() => el.classList.remove('on'), 1300);
  }

  /* ---------------- 测验：听音选词 ---------------- */
  /* ---------------- 导出：WAV 编码 ---------------- */
  async function toWavBase64(blob, targetSr) {
    targetSr = targetSr || 16000;
    const buf = await Analysis.decode(blob);
    const frames = Math.max(1, Math.ceil(buf.duration * targetSr));
    const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!OAC) throw new Error('这个浏览器不支持 OfflineAudioContext，无法重采样成 WAV');
    const off = new OAC(1, frames, targetSr);
    const src = off.createBufferSource();
    src.buffer = buf;
    src.connect(off.destination);
    src.start();
    const rendered = await off.startRendering();
    return encodeWavBase64(rendered.getChannelData(0), targetSr);
  }

function encodeWavBase64(samples, sr) {
  const n = samples.length;
  const ab = new ArrayBuffer(44 + n * 2);
  const v = new DataView(ab);
  const wr = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  wr(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); wr(8, 'WAVE'); wr(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  wr(36, 'data'); v.setUint32(40, n * 2, true);
  let o = 44;
  for (let i = 0; i < n; i++) {
    let s = samples[i];
    s = s < -1 ? -1 : s > 1 ? 1 : s;
    v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    o += 2;
  }
  const bytes = new Uint8Array(ab);
  let bin = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  }
  return btoa(bin);
}

  /* ---------------- ③ IndexedDB 存档（C1 修复：本轮曾因锚点对齐整段丢失） ---------------- */
  const DB_NAME = 'xz-dialect-rec', DB_VER = 1, STORE = 'clips';
  let dbp = null;

  function buildStore(db) {
    const os = db.createObjectStore(STORE, { keyPath: 'id' });
    os.createIndex('promptId', 'promptId');
    os.createIndex('createdAt', 'createdAt');
  }

  /* 打开库，并且**永不要求降级**。
     早期写法是 open(DB_NAME, 1) + 「表缺失就 version+1 重建」。后半句没错，
     前半句会留下一个坑：库一旦被抬到 v2，下一次 open(…, 1) 直接 VersionError，
     于是"自愈过一次之后，每次刷新都读不出存档"（实测复现：banner =
     The requested version (1) is less than the existing version (2)）。
     规则：期望版本只作为第一次尝试；一旦撞上 VersionError 就改用不带版本重开，
     表还是缺的，就读出当前版本再 +1。最多重试 3 次，避免任何递归失控。 */
  function openAt(version, res, rej, tries) {
    const req = version == null ? indexedDB.open(DB_NAME) : indexedDB.open(DB_NAME, version);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) buildStore(db);
    };
    req.onsuccess = () => {
      const db = req.result;
      if (db.objectStoreNames.contains(STORE)) { res(db); return; }
      const next = db.version + 1;
      db.close();
      if (tries <= 0) { rej(new Error('建表重试已用尽')); return; }
      openAt(next, res, rej, tries - 1);
    };
    req.onerror = () => {
      const err = req.error;
      if (err && err.name === 'VersionError' && tries > 0) { openAt(null, res, rej, tries - 1); return; }
      rej(err || new Error('打开本地存档失败'));
    };
    req.onblocked = () => rej(new Error('本地存档被其它页面占用，请关掉其它标签页再试'));
  }

  function openDB() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => openAt(DB_VER, res, rej, 3));
    // 失败不要把整个会话锁死：用户点重试还应当能再试一次
    dbp.catch(() => { dbp = null; });
    return dbp;
  }
  const store = {
    put(c) {
      return openDB().then((db) => new Promise((res, rej) => {
        const t = db.transaction(STORE, 'readwrite');
        t.objectStore(STORE).put(c);
        t.oncomplete = () => res(c);
        t.onerror = () => rej(t.error);
      }));
    },
    all() {
      return openDB().then((db) => new Promise((res, rej) => {
        const t = db.transaction(STORE, 'readonly');
        const r = t.objectStore(STORE).getAll();
        r.onsuccess = () => res(r.result || []);
        r.onerror = () => rej(r.error);
      }));
    },
    del(id) {
      return openDB().then((db) => new Promise((res, rej) => {
        const t = db.transaction(STORE, 'readwrite');
        t.objectStore(STORE).delete(id);
        t.oncomplete = () => res();
        t.onerror = () => rej(t.error);
      }));
    },
    clear() {
      return openDB().then((db) => new Promise((res, rej) => {
        const t = db.transaction(STORE, 'readwrite');
        t.objectStore(STORE).clear();
        t.oncomplete = () => res();
        t.onerror = () => rej(t.error);
      }));
    }
  };

  function download(name, text) {
    const blob = new Blob([text], { type: 'text/html;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  async function exportJson() {
    const rows = S.clips.map((c) => {
      const o = Object.assign({}, c);
      delete o.blob;
      return o;
    });
    download('方言存档-' + new Date().toISOString().slice(0, 10) + '.json',
      JSON.stringify({ exportedAt: new Date().toISOString(), total: rows.length, clips: rows }, null, 2));
  }

  async function exportHtml() {
    if (!S.clips.length) { banner('还没有可导出的录音。'); return; }
    banner('正在把录音转成 WAV 并打包，稍等…');
    const rows = [];
    const sorted = S.clips.slice().sort((a, b) => a.createdAt - b.createdAt);
    for (const c of sorted) {
      let b64 = '';
      try { b64 = await toWavBase64(c.blob); } catch (e) { b64 = ''; }
      rows.push({ c: c, b64: b64 });
    }

    const genName = ['孩子', '我这一代', '父辈', '祖辈'];
    const corrName = ['不像方言', '半土半普', '地道'];
    const commName = ['只我家', '本村', '本县/镇', '到处都说'];

    // 二维散点：x=流传范围(0-3) y=地道程度(0-2)
    const W = 340, H = 200, PAD = 30;
    let pts = '';
    rows.forEach(({ c }) => {
      const x = PAD + (c.common / 3) * (W - PAD * 2);
      const y = H - PAD - (c.correct / 2) * (H - PAD * 2);
      pts += '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="4" fill="#1B1A17" opacity=".9"><title>' +
        esc(c.saying || c.text) + '</title></circle>';
    });
    let grid = '';
    for (let i = 0; i <= 3; i++) {
      const x = PAD + (i / 3) * (W - PAD * 2);
      grid += '<line x1="' + x + '" y1="' + PAD + '" x2="' + x + '" y2="' + (H - PAD) + '" stroke="rgba(27,26,23,.15)"/>';
      grid += '<text x="' + x + '" y="' + (H - PAD + 14) + '" fill="#6B655B" font-size="9" text-anchor="middle">' + commName[i] + '</text>';
    }
    for (let i = 0; i <= 2; i++) {
      const y = H - PAD - (i / 2) * (H - PAD * 2);
      grid += '<line x1="' + PAD + '" y1="' + y + '" x2="' + (W - PAD) + '" y2="' + y + '" stroke="rgba(27,26,23,.15)"/>';
      grid += '<text x="' + (PAD - 6) + '" y="' + (y + 3) + '" fill="#6B655B" font-size="9" text-anchor="end">' + corrName[i] + '</text>';
    }

    // 填补策略分布：导出物本身要能统计出三类各几条
    const tally = {};
    STRATEGY.forEach((s) => { tally[s] = 0; });
    rows.forEach(({ c }) => { if (c.strategy && tally[c.strategy] != null) tally[c.strategy]++; });
    const tallyHTML = Object.keys(tally).map((k) => esc(k) + ' ' + tally[k] + ' 条').join(' · ');

    const body = rows.map(({ c, b64 }) => {
      const audio = b64
        ? '<audio controls preload="none" src="data:audio/wav;base64,' + b64 + '"></audio>'
        : '<span class="miss">（音频转换失败，请用 JSON 备份里的原始数据）</span>';
      const pitch = c.contourMode === 'none'
        ? '<span class="dim">（整句 / 长词，不出调型）</span>'
        : esc(c.category || '—') + '<br><span class="g">参考 ' + esc(c.contour || '—') + ' · ' +
          (c.dynamicSemitones ? c.dynamicSemitones.toFixed(2) + ' 半音' : '—') + '</span>';
      return '<tr><td><b>' + esc(c.text) + '</b><br><span class="say">' + esc(c.saying || '（未填）') + '</span>' +
        (c.sayingPy ? '<br><span class="g">' + esc(c.sayingPy) + '</span>' : '') +
        (c.gloss ? '<br><span class="g">' + esc(c.gloss) + '</span>' : '') + '</td>' +
        '<td>' + esc(c.speaker || '—') + '<br><span class="g">' + (genName[c.gen] || '—') + '</span></td>' +
        '<td>' + audio + '</td>' +
        '<td class="m">' + pitch + '<br><span class="g">' + (c.meanF0 ? c.meanF0 + ' Hz' : '') +
        (c.voiceDur ? ' · 语音时长 ' + esc(c.voiceDur) : '') + '</span></td>' +
        '<td class="g">' + corrName[c.correct] + ' · ' + commName[c.common] +
        (c.strategy ? '<br>策略 ' + esc(c.strategy) + '（判定：' + esc(c.strategyBy || '未知') + '）' : '') +
        (c.note ? '<br>' + esc(c.note) : '') + '</td></tr>';
    }).join('');

    const html = [
      '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">',
      '<meta name="viewport" content="width=device-width,initial-scale=1">',
      '<title>方言存档 · ' + new Date().toISOString().slice(0, 10) + '</title><style>',
      'body{background:#F3EDE1;color:#1B1A17;font:14px/1.75 "Songti SC","SimSun","Noto Serif SC",serif;margin:0;padding:34px}',
      '.w{max-width:900px;margin:0 auto}h1{font-size:19px;margin:0 0 4px}',
      '.sub{color:#6B655B;font-size:12px;margin:0 0 22px}',
      'table{width:100%;border-collapse:collapse;margin-top:8px}',
      'th,td{text-align:left;padding:10px 8px;border-bottom:1px solid rgba(27,26,23,.18);vertical-align:top;font-size:13px}',
      'th{color:#1B1A17;font-weight:500;font-size:11px;letter-spacing:.16em;border-bottom:2px solid #1B1A17}',
      'audio{height:28px;width:180px}.g{color:#6B655B;font-size:11px}.m{font-variant-numeric:tabular-nums;font-family:ui-monospace,Consolas,monospace;color:#1B1A17}',
      '.say{color:#1B1A17;font-size:15px;font-weight:600}.dim{color:#6B655B;font-size:11px}',
      '.miss{color:#A63B2A;font-size:11px}',
      '.card{border:1px solid rgba(27,26,23,.45);padding:16px;margin:18px 0}',
      '</style></head><body><div class="w">',
      '<h1>方言存档</h1><p class="sub">导出于 ' + new Date().toLocaleString('zh-CN') + ' · 共 ' + rows.length + ' 条 · 音频已内嵌，可离线打开</p>',
      '<div class="card"><div style="font-size:11px;color:#1B1A17;letter-spacing:.16em;margin-bottom:10px;border-bottom:1px solid #1B1A17;padding-bottom:5px">分布观察</div>',
      '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;max-width:340px">' + grid + pts + '</svg>',
      '<div class="g" style="margin-top:6px">横轴＝流传范围，纵轴＝地道程度。右下＝地道且广传；左上＝不地道但流传广；左下＝只在你家。</div>',
      '<div class="g" style="margin-top:6px">这是<b>描述性快照</b>：坐标只有 3×4＝12 格，样本约 3 个说话人、组内不独立，因此只描述分布，不做统计推断。</div>',
      (tallyHTML ? '<div class="g" style="margin-top:6px">填补策略分布：' + tallyHTML + '（判定人见下表；记录者自评仅供参考）</div>' : '') +
      '</div>',
      '<table><thead><tr><th>题目 / 说法</th><th>谁在说</th><th>录音</th><th>整段音高走向</th><th>标注</th></tr></thead><tbody>',
      body,
      '</tbody></table>',
      '<p class="sub" style="margin-top:22px">这个文件不依赖任何程序、服务器或网络。换电脑、隔十年，双击仍能听。</p>',
      '<p class="sub">说明：音高读数为整段级、非音节级；题库中没有单音节题，读数不可与单字声调对照。</p>',
      '</div></body></html>'
    ].join('\n');

    download('方言存档-' + new Date().toISOString().slice(0, 10) + '.html', html);
  }

  /* ---------------- 知情同意 ---------------- */
  const CONSENT_KEY = 'xz-dialect-consent-v1';
  function ensureConsent() {
    let ok = false;
    try { ok = localStorage.getItem(CONSENT_KEY) === '1'; } catch (e) { ok = false; }
    if (!ok) $('#consent').classList.add('on');
  }
  function acceptConsent() {
    try { localStorage.setItem(CONSENT_KEY, '1'); } catch (e) {}
    $('#consent').classList.remove('on');
  }

  /* ---------------- 初始化 ---------------- */
  /** 采集元数据：必须记 ctxRate / factor / analysisRate 三值，否则他机无法复现 */
  function captureMeta(blob) {
    const m = Analysis.meta || {};
    return {
      ctxRate: m.ctxRate || 0,
      factor: m.factor || 0,
      analysisRate: m.analysisRate || 0,
      ua: navigator.userAgent,
      constraints: { autoGainControl: false, noiseSuppression: false, echoCancellation: false },
      mime: blob ? blob.type : ''
    };
  }


  async function init() {
    const ok = selfCheck();
    S.envOk = ok;
    $('#recBtn').disabled = !ok;

    $('#recBtn').addEventListener('click', toggleRec);
    $('#skipBtn').addEventListener('click', () => { S.idx = (S.idx + 1) % P.length; drawPrompt(); });

    /* 录一个自己的词：题库之外的自由录入。
       题目只活在本次会话（不写回 prompts.js），但录音与其他题完全一样地存、一样地导出。 */
    $('#freeBtn').addEventListener('click', () => {
      const row = $('#freeRow');
      row.hidden = !row.hidden;
      if (!row.hidden) $('#freeText').focus();
    });
    $('#freeCancel').addEventListener('click', () => { $('#freeRow').hidden = true; $('#freeText').value = ''; });
    $('#freeOk').addEventListener('click', () => {
      const t = ($('#freeText').value || '').trim();
      if (!t) { banner('先写下要录的词或句子。'); return; }
      const dup = P.findIndex((p) => p.text === t);
      if (dup >= 0) { S.idx = dup; drawPrompt(); banner('题库里已经有「' + t + '」，直接录它。'); }
      else {
        P.push({ id: 'free-' + Date.now(), bucket: 'free', text: t, hint: '你自己加的题。录音、声调分析、导出与其它题完全一样。' });
        S.idx = P.length - 1;
        drawPrompt();
        banner('已加一道自定题：' + t);
      }
      $('#freeRow').hidden = true;
      $('#freeText').value = '';
    });
    $('#freeText').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#freeOk').click(); });
    $('#saveBtn').addEventListener('click', save);
    $('#redoBtn').addEventListener('click', () => { S.pending = null; drawPrompt(); });
    $('#playBtn').addEventListener('click', () => {
      if (!S.pending) return;
      const url = mkURL(S.pending.blob);
      const a = new Audio(url);
      a.play().catch((e) => banner('播放失败：' + e.message));
      const done = () => revokeURL(url);
      a.onended = done;
      a.onerror = done;
    });
    $('#exportJson').addEventListener('click', exportJson);
    $('#exportHtml').addEventListener('click', () => exportHtml().catch((e) => banner('导出失败：' + (e && e.message))));
    $('#quizBtn').addEventListener('click', () => Quiz.start());
    $('#quizPlay').addEventListener('click', () => Quiz.play());
    $('#quizNext').addEventListener('click', () => Quiz.next());
    $('#quizClose').addEventListener('click', () => Quiz.close());
    $('#consentOk').addEventListener('click', acceptConsent);
    $('#clearBtn').addEventListener('click', async () => {
      if (!confirm('确定清空全部录音？导出过的话再删。')) return;
      await store.clear();
      await reload();
    });

    ensureConsent();
    // 深链：#p=<atlasId 或 promptId> —— 从地图词条卡「去录一条 / 看全部」进来时直接定位到那一题
    try {
      const mm = /(?:^|[#&])p=([^&]+)/.exec(location.hash || '');
      if (mm) {
        const key = decodeURIComponent(mm[1]);
        const k = P.findIndex((p) => p.atlasId === key || p.id === key || p.id === 'a-' + key);
        if (k >= 0) S.idx = k;      // 找不到就停在第一题，不报错
      }
    } catch (e) { /* hash 不合法：忽略 */ }

    // 同一页里换 hash 也要跟过去（否则"再点一次同一个词的链接"没反应）
    window.addEventListener('hashchange', function () {
      const m2 = /(?:^|[#&])p=([^&]+)/.exec(location.hash || '');
      if (!m2) return;
      try {
        const key = decodeURIComponent(m2[1]);
        const k = P.findIndex((p) => p.atlasId === key || p.id === key || p.id === 'a-' + key);
        if (k >= 0) { S.idx = k; drawPrompt(); }
      } catch (e) { }
    });

    // 没有深链就接着上次；从来没有过就从第 1 题开始
    if (!/(?:^|[#&])p=/.test(location.hash || '')) {
      try {
        const last = Number(localStorage.getItem(POS_KEY));
        if (Number.isFinite(last) && last > 0 && last < P.length) {
          S.idx = last;
          resumeHint = true;
        }
      } catch (e) { }
    }
    drawPrompt();
    try {
      S.clips = await store.all();
      renderList();
      drawPrompt2();
    } catch (e) {
      banner('读取本地存档失败：' + (e && e.message));
    }
  }

  document.addEventListener('DOMContentLoaded', init);

  function renderList() {
    S.urls.forEach((u) => revokeURL(u));
    S.urls = [];

    const doneIds = new Set(S.clips.map((c) => c.promptId));
    $('#progress').textContent = doneIds.size + ' / ' + P.length + ' 题已录';
    $('#barFill').style.width = (P.length ? (doneIds.size / P.length * 100) : 0) + '%';

    /* 分类进度：题目分 5 类，数字全部从 PROMPTS 现算，改题不用改这里 */
    (function byClass() {
      const NAMES = { new: '新词', old: '老词', home: '家词', sent: '句子', atlas: '词表' };
      const bucketOf = (p) => (p && NAMES[p.bucket] ? p.bucket : 'free');
      const tot = {}, don = {};
      P.forEach((p) => { const b = bucketOf(p); tot[b] = (tot[b] || 0) + 1; });
      const seen = new Set();
      S.clips.forEach((c) => {
        if (seen.has(c.promptId)) return;
        seen.add(c.promptId);
        const p = P.find((x) => x.id === c.promptId);
        const b = bucketOf(p);
        don[b] = (don[b] || 0) + 1;
      });
      const groups = Object.keys(NAMES).concat(['free']);
      const box = document.getElementById('byClass');
      if (box) {
        const label = { new: '新词', old: '老词', home: '家词', sent: '句子', atlas: '词表', free: '自定' };
        box.innerHTML = groups
          .filter((k) => tot[k] || don[k])
          .map((k) =>
            '<div class="bc-row"><span>' + label[k] + '</span><i></i><b>' + (don[k] || 0) + ' / ' + (tot[k] || 0) + '</b></div>'
          ).join('');
      }
      const ft = document.getElementById('ftDone');
      if (ft) ft.textContent = String(doneIds.size);
      const tt = document.getElementById('ftTotal');
      if (tt) tt.textContent = String(P.length);
    })();

    if (!S.clips.length) { $('#list').innerHTML = '<div class="empty">还没有录制</div>'; return; }

    const sorted = S.clips.slice().sort((a, b) => b.createdAt - a.createdAt);
    $('#list').innerHTML = sorted.map((c) => {
      const url = mkURL(c.blob);
      S.urls.push(url);
      const genName = ['孩子', '我这一代', '父辈', '祖辈'][c.gen] || '—';
      const miss = c.saying ? '' : '<span class="todo">待补说法</span>';
      return '<div class="clip" data-id="' + esc(c.id) + '">' +
        '<div class="txt">' + esc(c.text) + miss + '<div class="who">' + esc(c.speaker || '未署名') + ' · ' + genName + ' · ' + (c.stars || '') + '</div></div>' +
        '<audio controls preload="none" src="' + url + '"></audio>' +
        '<button class="del" data-del="' + esc(c.id) + '">删</button>' +
        '</div>';
    }).join('');

    $$('[data-del]').forEach((b) => b.addEventListener('click', async () => {
      await store.del(b.getAttribute('data-del'));
      await reload();
    }));
  }

  /* ---------------- 与地图的契约：只回写索引，音频留在 IndexedDB ----------------
     地图（../index.html）与本目录同源时读这个键，决定「听发音」播真人录音还是回落合成音。
     写失败（无痕模式、file:// 下被禁用）不影响录音本身，只影响地图能不能自动找到它。 */
  const SAMPLE_KEY = 'xzdt.sample.v1';

  function syncSampleIndex(clips) {
    const words = {};
    clips.forEach((c) => {
      const aid = c.atlasId || ((P.find((p) => p.id === c.promptId) || {}).atlasId) || null;
      if (!aid) return;
      const e = words[aid] || (words[aid] = { clips: [], newest: 0, clipId: null, list: [] });
      e.clips.push(c.id);
      /* list 存每条的摘要（说法/谁说的/哪一辈/时间），地图那边做"三代对照"时
         不用为了列个表去翻 IndexedDB；真要出声仍按 clipId 取 blob。 */
      e.list.push({
        clipId: c.id, saying: c.saying || '', speaker: c.speaker || '',
        gen: typeof c.gen === 'number' ? c.gen : null, at: c.createdAt
      });
      if (c.createdAt > e.newest) {
        e.newest = c.createdAt; e.clipId = c.id;
        e.saying = c.saying || ''; e.speaker = c.speaker || ''; e.gen = c.gen;
      }
    });
    Object.keys(words).forEach((k) => {
      words[k].list.sort((a, b) => (b.at || 0) - (a.at || 0));
    });
    try {
      localStorage.setItem(SAMPLE_KEY, JSON.stringify({
        version: 1, updatedAt: new Date().toISOString(), count: Object.keys(words).length, words: words
      }));
    } catch (e) { /* 存不下就算了，录音本身不受影响 */ }
  }

  async function reload() {
    S.clips = await store.all();
    renderList();
    drawPrompt2();
    syncSampleIndex(S.clips);
  }

  /** 只刷新「已录过」这类提示，不打断当前录音结果 */
  function drawPrompt2() {
    const p = cur();
    const done = S.clips.filter((c) => c.promptId === p.id).length;
    if (done) $('#promptIndex').textContent = '第 ' + (S.idx + 1) + ' / ' + P.length + ' · 已有 ' + done + ' 条';
  }

  /* ---------------- 保存 ---------------- */
  const Quiz = {
    q: null, score: 0, total: 0, audio: null,
    /** 只有「同一说话人 ≥2 个不同词」才具备出题条件 */
    eligible() {
      const byS = {};
      S.clips.forEach((c) => {
        const k = (c.speaker || '').trim();
        if (!k) return;
        byS[k] = byS[k] || new Set();
        byS[k].add(c.promptId);
      });
      return Object.keys(byS).filter((k) => byS[k].size >= 2);
    },
    gens() { return new Set(S.clips.map((c) => c.gen)).size; },
    async start() {
      const who = this.eligible();
      if (!who.length) {
        banner('听音选词需要「同一个说话人」至少录 2 个不同的词，目前还不满足。先多录几条。');
        return;
      }
      $('#quiz').classList.add('on');
      this.score = 0; this.total = 0;
      this.next();
    },
    /** 轮换两种题：听音选词（同说话人内）与听音辨辈分（跨辈分用例） */
    next() {
      const mode = this.total % 2 === 1 ? 'gen' : 'word';
      const pool = S.clips.filter((c) => (c.speaker || '').trim());
      if (!pool.length) { this.close(); return; }
      let ans, opts, label;
      if (mode === 'gen' && this.gens() >= 2) {
        ans = pool[Math.floor(Math.random() * pool.length)];
        const genName = ['孩子', '我这一代', '父辈', '祖辈'];
        label = '这段话是谁说的？';
        const set = [];
        pool.forEach((c) => { if (set.indexOf(genName[c.gen]) < 0) set.push(genName[c.gen]); });
        if (set.length < 2) set.push(genName[(ans.gen + 1) % 4]);
        opts = set.slice(0, 4);
        this.q = { ans: ans, opts: opts, label: label, kind: 'gen', answer: genName[ans.gen] };
      } else {
        const who = this.eligible();
        const spk = who[Math.floor(Math.random() * who.length)];
        const mine = S.clips.filter((c) => (c.speaker || '').trim() === spk);
        const others = [];
        mine.forEach((c) => { if (others.indexOf(c.text) < 0) others.push(c.text); });
        ans = mine[Math.floor(Math.random() * mine.length)];
        opts = [ans.text];
        const cand = P.filter((p) => others.indexOf(p.text) >= 0 && opts.indexOf(p.text) < 0);
        for (let i = cand.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [cand[i], cand[j]] = [cand[j], cand[i]]; }
        cand.slice(0, 3).forEach((p) => opts.push(p.text));
        while (opts.length < 4) { const extra = P[Math.floor(Math.random() * P.length)].text; if (opts.indexOf(extra) < 0) opts.push(extra); }
        for (let i = opts.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [opts[i], opts[j]] = [opts[j], opts[i]]; }
        label = '这段话说的是哪个词？';
        this.q = { ans: ans, opts: opts, label: label, kind: 'word', answer: ans.text };
      }
      if (this.q.kind === 'gen' && opts.length < 2) { this.q = null; this.close(); return; }
      $('#quizMsg').textContent = '得分 ' + this.score + ' / ' + this.total;
      $('#quizLabel').textContent = this.q.label;
      $('#quizOpts').innerHTML = opts.map((t, i) =>
        '<button data-opt="' + i + '">' + esc(t) + '</button>').join('');
      $$('#quizOpts button').forEach((b) => b.addEventListener('click', () => this.pick(Number(b.getAttribute('data-opt')))));
      this.play();
    },
    play() {
      if (!this.q) return;
      this.stopAudio();
      const url = mkURL(this.q.ans.blob);
      const a = new Audio(url);
      this.audio = a;
      a.play().catch((e) => banner('播放失败：' + e.message));
      const done = () => { revokeURL(url); if (this.audio === a) this.audio = null; };
      a.onended = done;
      a.onerror = done;
    },
    /** 关闭或换题时，正在播的音源必须停下并回收 URL */
    stopAudio() {
      if (!this.audio) return;
      try { this.audio.pause(); } catch (e) {}
      this.audio = null;
    },
    pick(i) {
      if (!this.q || this.q.answered) return;
      this.q.answered = true;
      this.total++;
      const ok = this.q.opts[i] === this.q.answer;
      if (ok) this.score++;
      $$('#quizOpts button').forEach((b, k) => {
        if (this.q.opts[k] === this.q.answer) b.classList.add('ok');
        else if (k === i) b.classList.add('no');
        b.disabled = true;
      });
      $('#quizMsg').textContent = (ok ? '✓ 对了' : '✗ 正确答案是「' + this.q.answer + '」') +
        '　得分 ' + this.score + ' / ' + this.total;
    },
    close() {
      this.stopAudio();
      $('#quiz').classList.remove('on');
    }
  };

  /* ---------------- I11：稳定测试入口 ----------------
     夹具此后只调函数，不再依赖行号切片。
     行号契约已由审计方废止（见《第3轮审阅意见》§5），此处为替代方案。 */
  window.__probe = {
    Analysis,
    stats,
    levels: (frames) => Analysis.levels(frames),
    encodeWavBase64,
    store,
    version: 'r3-fix'
  };
})();

