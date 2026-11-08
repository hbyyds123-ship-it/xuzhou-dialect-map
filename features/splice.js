/* ============================================================
   features/splice.js — 把一段长录音切成一条一条
   ------------------------------------------------------------
   为什么要有：拿着一张问法表去问老人，回来常常是**一条 6 分钟的长录音**
   里装着 50 条。而范本音是「一条录音对一个词」。中间缺一道工序：
   切开、逐条听、逐条选词。

   这个模块只做"切"这一半的数学：能量包络、静音段、切点、WAV 编码。
   谁配哪个词是人的事 —— 自动猜归属会把错位的录音当真话说下去，
   比缺一条坏得多。

   对外：
     XZ.splice.toMono(audioBuffer)             → { data, sr }
     XZ.splice.analyze(samples, sr, opts)      → { rms, frames, th, floor, silences, segs, dur }
     XZ.splice.autoOpts(samples, sr)           → 建议的 { th, minSil, minSeg }
     XZ.splice.cut(samples, sr, seg)           → Float32Array（两端带 20ms 淡入淡出）
     XZ.splice.encodeWav(samples, sr)          → Blob('audio/wav')，16bit 单声道
   ============================================================ */
(function () {
  'use strict';

  var MONO_SR = 16000;

  function toDb(v) { return 20 * Math.log10(Math.max(v, 1e-8)); }

  /** 混单声道并降采样。Chromium 解出来的常是 48k 立体声，降下来省 3/4 内存 */
  function toMono(ab, targetSr) {
    targetSr = targetSr || MONO_SR;
    var ch = ab.numberOfChannels || 1;
    var sr = ab.sampleRate;
    var len = ab.length != null ? ab.length : Math.floor((ab.duration || 0) * sr);
    var step = Math.max(1, Math.round(sr / targetSr));
    var n = Math.floor(len / step);
    var out = new Float32Array(n);
    var chans = [];
    for (var c = 0; c < ch; c++) chans.push(ab.getChannelData(c));
    if (ch === 1) {
      var d0 = chans[0];
      for (var i = 0; i < n; i++) out[i] = d0[i * step];
    } else {
      for (var j = 0; j < n; j++) {
        var s = 0;
        for (var c2 = 0; c2 < ch; c2++) s += chans[c2][j * step] || 0;
        out[j] = s / ch;
      }
    }
    return { data: out, sr: sr / step };
  }

  function percentile(sorted, p) {
    if (!sorted.length) return -100;
    return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * p)))];
  }

  /**
   * @param {Float32Array} samples 单声道
   * @param {number} sr
   * @param {{threshold?:number, minSil?:number, minSeg?:number, frameMs?:number, pad?:number}} opts
   *   threshold 分贝阈值；不给就用噪声底 +8dB（不低于 -45）
   *   minSil   多长的停顿才算"换了一条"（秒）
   *   minSeg   短于这个的有声段当噪声丢掉（秒）
   *   pad      切点前后各留多少静音（秒），免得把字头切掉
   */
  function analyze(samples, sr, opts) {
    opts = opts || {};
    var frameMs = opts.frameMs || 20;
    var frame = Math.max(1, Math.round(sr * frameMs / 1000));
    var frames = Math.floor(samples.length / frame);
    var rms = new Float32Array(frames);
    for (var i = 0; i < frames; i++) {
      var s = 0, base = i * frame;
      for (var k = 0; k < frame; k++) { var v = samples[base + k]; s += v * v; }
      rms[i] = Math.sqrt(s / frame);
    }

    var dbs = new Array(frames);
    for (var m = 0; m < frames; m++) dbs[m] = toDb(rms[m]);
    var sorted = dbs.slice().sort(function (a, b) { return a - b; });
    var floor = frames ? percentile(sorted, 0.10) : -100;

    var th = (opts.threshold != null) ? opts.threshold : Math.max(floor + 8, -45);
    var minSil = (opts.minSil != null) ? opts.minSil : 0.42;
    var minSeg = (opts.minSeg != null) ? opts.minSeg : 0.35;
    var pad = (opts.pad != null) ? opts.pad : 0.12;
    var secPerFrame = frame / sr;

    /* 静音段 */
    var silences = [];
    var run = 0;
    for (var f = 0; f < frames; f++) {
      if (dbs[f] < th) { run++; }
      else if (run) {
        silences.push({ a: (f - run) * secPerFrame, b: f * secPerFrame });
        run = 0;
      }
    }
    if (run) silences.push({ a: (frames - run) * secPerFrame, b: frames * secPerFrame });

    var dur = samples.length / sr;
    var cuts = silences.filter(function (x) { return (x.b - x.a) >= minSil; });

    /* 段 = 长静音之间的有声区；切点往静音里退 pad 秒，保住字头字尾 */
    var segs = [];
    var cursor = 0;
    for (var c = 0; c < cuts.length; c++) {
      var cutAt = cuts[c].a + Math.min(pad, (cuts[c].b - cuts[c].a) / 2);
      if (cutAt - cursor > minSeg) segs.push({ a: cursor, b: cutAt });
      cursor = cuts[c].b - Math.min(pad, (cuts[c].b - cuts[c].a) / 2);
      if (cursor < 0) cursor = 0;
    }
    if (dur - cursor > minSeg) segs.push({ a: cursor, b: dur });

    /* 头尾静音削掉一点，免得每条都先空半秒 */
    segs = segs.map(function (g) {
      var a = Math.max(0, g.a + Math.min(pad, (g.b - g.a) / 4));
      var b = Math.min(dur, g.b - Math.min(pad, (g.b - g.a) / 4));
      return { a: +a.toFixed(3), b: +b.toFixed(3) };
    }).filter(function (g) { return g.b - g.a >= minSeg * 0.8; });

    return {
      rms: rms, frames: frames, frame: frame, sr: sr, secPerFrame: secPerFrame,
      dur: dur, floor: floor, th: th, silences: silences, segs: segs,
      opts: { threshold: th, minSil: minSil, minSeg: minSeg, pad: pad }
    };
  }

  /** 给界面一个能用的起点：噪声底 +8dB，最短停顿 0.42s */
  function autoOpts(samples, sr) {
    var r = analyze(samples, sr, { minSil: 0.42, minSeg: 0.35 });
    return { threshold: Math.round(r.th * 10) / 10, minSil: 0.42, minSeg: 0.35, floor: r.floor };
  }

  /** 切一段出来，两端 20ms 淡入淡出 —— 不淡会"啪"一声，那种录音不能用 */
  function cut(samples, sr, seg) {    var a = Math.max(0, Math.floor((seg.a || 0) * sr));
    var b = Math.min(samples.length, Math.ceil((seg.b || 0) * sr));
    var n = Math.max(0, b - a);
    var out = new Float32Array(n);
    out.set(samples.subarray(a, b));
    var fade = Math.min(Math.floor(sr * 0.02), Math.floor(n / 4));
    for (var i = 0; i < fade; i++) {
      var g = i / fade;
      out[i] *= g;
      out[n - 1 - i] *= g;
    }
    return out;
  }

  /**
   * 把一段从中间劈开。
   * 为什么需要：一口气念了十来条的地方（真人录音里很常见）按停顿切不开，
   * 只能先切成一整块，再一刀一刀劈到每条。劈歪了就「并上一条」合回去。
   */
  function splitSeg(seg, at) {
    var a = seg.a, b = seg.b;
    var t = (at == null) ? (a + b) / 2 : Math.min(b - 0.05, Math.max(a + 0.05, at));
    return [{ a: a, b: +t.toFixed(3) }, { a: +t.toFixed(3), b: b }];
  }

  /** 16bit 单声道 WAV。范本音不需要高保真，16k 足够，文件也小 */
  function encodeWav(samples, sr) {
    var n = samples.length;
    var buf = new ArrayBuffer(44 + n * 2);
    var v = new DataView(buf);
    function str(off, s) { for (var i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); }
    str(0, 'RIFF');
    v.setUint32(4, 36 + n * 2, true);
    str(8, 'WAVE');
    str(12, 'fmt ');
    v.setUint32(16, 16, true);
    v.setUint16(20, 1, true);                        // PCM
    v.setUint16(22, 1, true);                        // 单声道
    v.setUint32(24, Math.round(sr), true);
    v.setUint32(28, Math.round(sr) * 2, true);
    v.setUint16(32, 2, true);
    v.setUint16(34, 16, true);
    str(36, 'data');
    v.setUint32(40, n * 2, true);
    var off = 44;
    for (var i = 0; i < n; i++) {
      var s = Math.max(-1, Math.min(1, samples[i]));
      v.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      off += 2;
    }
    return new Blob([buf], { type: 'audio/wav' });
  }

  window.XZ = window.XZ || {};
  window.XZ.splice = {
    MONO_SR: MONO_SR,
    toMono: toMono,
    analyze: analyze,
    autoOpts: autoOpts,
    cut: cut,
    splitSeg: splitSeg,
    encodeWav: encodeWav
  };
})();
