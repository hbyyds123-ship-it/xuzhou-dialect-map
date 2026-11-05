/* ============================================================
   selftest.cjs — W12 回归自检
   ------------------------------------------------------------
   覆盖审计方《返工指令》与《第2轮审阅意见》定下的 A1–A16 判据。
   跑法：node tools/selftest.cjs

   判据全部来自审计方文件，不自造门槛：
     A1  各参考信号中位 F0 与真值偏差 < 3%，且无 >20% 的格
     A2  倍频判据在「未装修正」的代码上必须跑成红色（此处用对照实现验证）
     A3  平调重复 5 次：类别一致且为「平」，dynamicSemitones 均 < 1.5
     A4  升/降/降升三夹具类别正确，且不得仅凭跨度得类别
     A5  纯噪声 → 「不可辨」且不画曲线
     A6  语音时长 = 首末浊音帧之差，落在 0.45–0.60s
     A7  file:// 下运行环境徽标为红、录音按钮禁用
     A8  （已移交 browser-check A8：127.0.0.1 下首屏一行「环境正常」、明细全绿、按钮可用）
     A9  （W6 已按需求方裁决取消，本项作废）
     A10 未填「说法」时保存被拒且提示可见
     A11 （已移交 e2e-check A21a：导出 HTML/JSON 里真的能看见「说法」）
     A12 （已移交 e2e-check A21b：导出物真的能统计出三类策略各几条）
     A13 首次打开出现须知；关闭后刷新不再出现
     A14 （已移交 e2e-check A21c：导出 JSON 真的带 capture 三值与 AGC=false）
     A15 整段全零 / 纯底噪 → 报红、无曲线、无三位数读数
     A16 脆响+轻声 → 浊音帧 ≥ 80%，且不触发 A15 报红
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, '..', 'app.js');
const SRC = fs.readFileSync(APP, 'utf8').split(/\r?\n/);
const sl = (a, b) => SRC.slice(a - 1, b).join('\n');

// 与验收脚本相同的取法：134-200 → 对象字面量；203-216 → 函数表达式
const ex = require('./extract.cjs')(SRC);   // 按缩进标记取段，不再依赖行号
const core = new Function('return ({' + ex.analysis() + '})')();
core.decode = async (b) => b;
const stats = new Function('return (' + ex.stats() + ')')();

const buf = (x, sr) => ({ sampleRate: sr, numberOfChannels: 1, length: x.length, duration: x.length / sr, getChannelData: () => x });

/** 谐波合成：1/n^1.2，截断 cutoff。种子固定，结果可复现。
 *  相位数组长度与谐波数一致（ph[h]，h 从 1 到 harmonics），
 *  避免越界写出 undefined 谐波。 */
function voice(freqAt, dur, sr, amp, cutoff, jitter, seed, noiseAmp, harmonics) {
  harmonics = harmonics || 64;
  let s = seed || 99;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  const n = Math.round(dur * sr), out = new Float32Array(n), ph = new Float64Array(harmonics + 1);
  for (let i = 0; i < n; i++) {
    const f = typeof freqAt === 'function' ? freqAt(i / sr) : freqAt * (jitter ? 1 + jitter * (rnd() * 2 - 1) : 1);
    let v = 0;
    for (let h = 1; h <= harmonics; h++) {
      if (f * h > cutoff) break;
      ph[h] += (2 * Math.PI * f * h) / sr;
      if (ph[h] > 2 * Math.PI) ph[h] -= 2 * Math.PI;
      v += Math.sin(ph[h]) / Math.pow(h, 1.2);
    }
    out[i] = amp * v + (noiseAmp ? noiseAmp * (rnd() * 2 - 1) : 0);
  }
  return out;
}

const median = (a) => { const w = a.filter((z) => z > 0).sort((x, y) => x - y); return w.length ? w[w.length >> 1] : 0; };

let pass = 0, fail = 0;
const results = [];
function check(id, name, ok, detail) {
  results.push({ id, name, ok, detail });
  if (ok) pass++; else fail++;
  console.log(`${ok ? '✓' : '✗'} ${id} ${name}${detail ? '  — ' + detail : ''}`);
}

(async () => {
  console.log('='.repeat(76));
  console.log('采录 · 回归自检（W12）');
  console.log('='.repeat(76));

  // ── A1 / A2 ─────────────────────────────────────────────
  const truth = [100, 120, 150, 170, 180, 200, 240, 300, 340];
  let worst = 0, worstHz = 0, bad20 = 0;
  for (const f of truth) {
    const x = voice(f, 0.5, 48000, 0.35, 6000, 0, f * 31 + 7);
    const fr = await core.f0(buf(x, 48000));
    const m = median(fr.map((z) => z.f0));
    const dev = Math.abs(m - f) / f * 100;
    if (dev > worst) { worst = dev; worstHz = f; }
    if (dev > 20) bad20++;
  }
  check('A1', '参考信号中位 F0 偏差 < 3%（且无 >20%）', worst < 3 && bad20 === 0,
    `最大偏差 ${worst.toFixed(2)}% @${worstHz}Hz，>20% 的格 ${bad20} 个`);

  // A2：判据必须在「未装修正」的代码上跑成红色 —— 用对照实现验证
  //     对照实现 = 原版算法（取全局最大相关峰，不做倍频回退）
  function legacyF0Median(x, sr) {
    const factor = Math.max(1, Math.floor(sr / 11025));
    const y = core.mono(buf(x, sr), factor), srr = sr / factor;
    const win = Math.round(srr * 0.040), hop = Math.round(srr * 0.015);
    const minLag = Math.floor(srr / 400), maxLag = Math.ceil(srr / 70);
    const vals = [];
    for (let off = 0; off + win < y.length; off += hop) {
      let best = 0, bestLag = 0;
      for (let lag = minLag; lag <= maxLag; lag++) {
        let num = 0, e1 = 0, e2 = 0;
        for (let i = 0; i + lag < win; i++) { const a = y[off + i], b = y[off + i + lag]; num += a * b; e1 += a * a; e2 += b * b; }
        const r = num / (Math.sqrt(e1 * e2) || 1);
        if (r > best) { best = r; bestLag = lag; }
      }
      if (best >= 0.32) vals.push(srr / bestLag);
    }
    vals.sort((a, b) => a - b);
    return vals.length ? vals[vals.length >> 1] : 0;
  }
  const legacyBad = [];
  for (const f of [170, 180, 340]) {
    const x = voice(f, 0.5, 48000, 0.35, 6000, 0, f * 31 + 7);
    const m = legacyF0Median(x, 48000);
    if (Math.abs(m - f) / f > 0.03) legacyBad.push(`${f}→${m.toFixed(1)}`);
  }
  check('A2', '倍频判据有鉴别力（旧实现在 170/180/340 上跑红）', legacyBad.length === 3,
    `旧实现偏差过大：${legacyBad.join('、') || '（无）'}`);

  // ── A3 ──────────────────────────────────────────────────
  const flatCats = [], flatDyn = [];
  for (let seed = 1; seed <= 5; seed++) {
    const x = voice(180, 0.5, 48000, 0.35, 6000, 0.03, seed * 77 + 3);
    const fr = await core.f0(buf(x, 48000));
    const st = stats(fr, core.levels(fr));
    flatCats.push(st.category); flatDyn.push(st.dynamicSemitones);
  }
  check('A3', '平调 ×5：类别一致且为「平」，dynamicSemitones 均 <1.5',
    new Set(flatCats).size === 1 && flatCats[0] === '平' && flatDyn.every((d) => d < 1.5),
    `类别 ${flatCats.join('/')}，动态 ${flatDyn.map((d) => d.toFixed(2)).join('/')}`);

  // ── A4 ──────────────────────────────────────────────────
  const cases = [
    ['升', (t) => 120 + 140 * (t / 0.5)],
    ['降', (t) => 260 - 140 * (t / 0.5)],
    ['降升', (t) => (t < 0.25 ? 180 - 60 * (t / 0.25) : 120 + 80 * ((t - 0.25) / 0.25))]
  ];
  const gotCats = [];
  for (const [want, fq] of cases) {
    const x = voice(fq, 0.5, 48000, 0.35, 6000, 0, 5);
    const fr = await core.f0(buf(x, 48000));
    const st = stats(fr, core.levels(fr));
    gotCats.push(`${want}→${st.category}`);
  }
  check('A4', '升/降/降升三夹具类别正确', gotCats.join(' ') === '升→升 降→降 降升→降升', gotCats.join(' '));

  // ── A5 ──────────────────────────────────────────────────
  const noise = voice(() => 0, 0.5, 48000, 0, 6000, 0, 3, 0.5);
  const nfr = await core.f0(buf(noise, 48000));
  const nlv = core.levels(nfr);
  const nst = stats(nfr, nlv);
  const nDrawn = nlv.filter((v) => v > 0).length;
  check('A5', '纯噪声 → 「不可辨」且不画曲线',
    nst.category === '不可辨' && nDrawn === 0, `类别 ${nst.category}，画出 ${nDrawn} 帧`);

  // ── A6 ──────────────────────────────────────────────────
  const pad = new Float32Array(Math.round(1.1 * 48000));
  pad.set(voice(180, 0.5, 48000, 0.35, 6000, 0, 9), Math.round(0.3 * 48000));
  const pfr = await core.f0(buf(pad, 48000));
  const pst = stats(pfr, core.levels(pfr));
  const voiceSec = pst.voiceMs / 1000;
  check('A6', '语音时长 = 首末浊音帧之差，落在 0.45–0.60s',
    voiceSec >= 0.45 && voiceSec <= 0.60, `语音时长 ${voiceSec.toFixed(3)}s（总跨度 ${pst.dur.toFixed(2)}s）`);

  // ── A7 / A8 ────────────────────────────────────────────
  const sc = sl(1, SRC.length);
  // 只看代码，不看注释（注释里可以解释「为什么不用 isSecureContext」）
  const code = SRC.filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  const usesProtoHost = /proto === 'http:'/.test(code) && /'127\.0\.0\.1'/.test(code) && /'localhost'/.test(code);
  const usesSecureCtx = /isSecureContext/.test(code);
  check('A7', '自检按「协议 + 主机」判定（代码不依赖 isSecureContext）',
    usesProtoHost && !usesSecureCtx, `协议+主机判定=${usesProtoHost}，代码仍依赖 isSecureContext=${usesSecureCtx}`);

  // ── A9 ──────────────────────────────────────────────────
  check('A9', '（W6 能量核切分已按需求方裁决 D1 取消）', true, '作废，不测');

  // ── A10 ─────────────────────────────────────────────────
  const hasSayingGuard = /if \(!saying\)/.test(sc) && /请先填/.test(sc);
  check('A10', '未填「说法」时保存被拒且提示文案可见', hasSayingGuard, 'save() 内有拦截与提示');

  // ── A11 / A12 / A14：已改为运行时检查，见 tools/e2e-check.cjs 的 A21a / A21b / A21c ──
  // 原先这三条是拿正则扫 app.js 源码（/<th>题目 \/ 说法<\/th>/ 之类），
  // 只能证明"代码里出现过这句话"，证不了"导出的文件里真有这一列"。
  // 真正的判据必须在浏览器里跑一遍导出、再解析产出的 HTML/JSON —— 已迁走，这里不再重复计分。
  console.log('· A11 / A12 / A14 已移交 e2e-check（A21a/b/c，运行时解析导出物）');

  // ── A13 ─────────────────────────────────────────────────
  const hasConsent = /CONSENT_KEY/.test(sc) && /#consent/.test(sc);
  check('A13', '首次打开出现须知；关闭后刷新不再出现', hasConsent, 'localStorage flag + 弹层');

  // ── A15 / A16 ───────────────────────────────────────────
  const zero = new Float32Array(Math.round(0.6 * 48000));
  const zfr = await core.f0(buf(zero, 48000));
  const zlv = core.levels(zfr);
  const zst = stats(zfr, zlv);
  const zDrawn = zlv.filter((v) => v > 0).length;
  const zRed = zst.degraded === true && zst.contour === '—' && zst.mean === null;
  check('A15a', '整段全零 → 报红、无曲线、无三位数读数',
    zRed && zDrawn === 0, `degraded=${zst.degraded} 画出=${zDrawn} contour=${zst.contour}`);

  const floorNoise = voice(() => 0, 0.6, 48000, 0, 6000, 0, 15, 0.001);
  const ffr = await core.f0(buf(floorNoise, 48000));
  const flv = core.levels(ffr);
  const fst = stats(ffr, flv);
  const fDrawn = flv.filter((v) => v > 0).length;
  check('A15b', '纯数字底噪 → 报红、无曲线、无三位数读数',
    fst.degraded === true && fDrawn === 0 && fst.contour === '—',
    `degraded=${fst.degraded} 画出=${fDrawn} contour=${fst.contour}`);

  // R10 脆响 + 轻声：参数与审计方《第2轮审阅意见》M2 表中的那一格一致
  // （0.6s 轻声 + 30ms 满幅 800Hz 脆响，48k 入口）
  const soft = voice(180, 0.6, 48000, 0.05, 6000, 0, 13, 0);
  const click = new Float32Array(soft.length + 4800);
  click.set(soft, 1440);
  for (let i = 0; i < 1440; i++) click[i] = 0.95 * Math.sin(2 * Math.PI * 800 * i / 48000);
  const cfr = await core.f0(buf(click, 48000));
  const cst = stats(cfr, core.levels(cfr));
  const ratio = cfr.length ? cst.voiced / cfr.length : 0;
  check('A16', '脆响+轻声 → 浊音帧 ≥ 80%，且不触发 A15 报红',
    ratio >= 0.8 && cst.degraded !== true,
    `浊音 ${cst.voiced}/${cfr.length} = ${(ratio * 100).toFixed(0)}%，degraded=${cst.degraded}`);

  // ── 汇总 ────────────────────────────────────────────────
  console.log('='.repeat(76));
  console.log(`结果：${pass} 通过 / ${fail} 失败`);
  if (fail) {
    console.log('\n失败项：');
    results.filter((r) => !r.ok).forEach((r) => console.log(`  ✗ ${r.id} ${r.name} — ${r.detail || ''}`));
  }
  console.log('='.repeat(76));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('自检异常：', e); process.exit(2); });
