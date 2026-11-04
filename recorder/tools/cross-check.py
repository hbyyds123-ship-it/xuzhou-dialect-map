# ============================================================
# cross-check.py -- W11 外部交叉校验
# ------------------------------------------------------------
# 用 Praat (parselmouth) 独立算一遍 F0，与本项目 app.js 的结果对比。
# 两边算法完全独立: Praat 走自相关 + 抛物线插值 + 中值滤波,
# 本项目走自相关 + 0.98 倍频回退 + 分位拉伸, 所以偏差应当很小。
#
# 用法: python tools/cross-check.py
# 依赖: praat-parselmouth (外部工具, 不进交付物, 只用于验证)
# ============================================================
import json
import os
import subprocess
import sys

import numpy as np
import parselmouth

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.join(HERE, '..', 'app.js')

RUNNER = r'''
const fs=require('fs');
const SRC=fs.readFileSync(process.argv[2],'utf8').split(/\r?\n/);
const core=new Function('return ({'+SRC.slice(133,200).join('\n')+'})')();
core.decode=async b=>b;
// 从 stdin 读 JSON, 避免命令行长度限制
let raw='';
process.stdin.setEncoding('utf8');
process.stdin.on('data',d=>raw+=d);
process.stdin.on('end',()=>{
const data=JSON.parse(raw);
const x=Float64Array.from(data.samples);
const buf={sampleRate:data.sr,numberOfChannels:1,length:x.length,duration:x.length/data.sr,getChannelData:()=>x};
core.f0(buf).then(fr=>{
  const v=fr.filter(f=>f.f0>0).map(f=>f.f0).sort((a,b)=>a-b);
  process.stdout.write(JSON.stringify({median:v.length?v[v.length>>1]:0,frames:fr.length,voiced:v.length}));
});
});
'''


def synth(freq, dur=0.6, sr=48000, amp=0.35, cutoff=6000, jitter=0.0, seed=7):
    # 与验收夹具同构的合成浊音: 谐波 1/n^1.2, 截断 cutoff
    rng = np.random.default_rng(seed)
    n = int(dur * sr)
    f = freq * (1 + jitter * (rng.random(n) * 2 - 1)) if jitter else np.full(n, float(freq))
    sig = np.zeros(n)
    ph = 2 * np.pi * np.cumsum(f) / sr
    for h in range(1, 65):
        if freq * h > cutoff:
            break
        sig += np.sin(ph * h) / (h ** 1.2)
    return amp * sig


def praat_f0(sig, sr=48000):
    # Praat 的 To Pitch (基频追踪)
    snd = parselmouth.Sound(sig, sr)
    pitch = snd.to_pitch_ac(time_step=0.015, pitch_floor=70, pitch_ceiling=400)
    return np.array([v for v in pitch.selected_array['frequency'] if v > 0])


def find_node():
    for c in ('node', 'node.exe'):
        try:
            subprocess.run([c, '--version'], capture_output=True, check=True)
            return c
        except Exception:
            pass
    raise RuntimeError('找不到 node')


def app_f0(sig, sr=48000, node=None):
    # 取 app.js 的 Analysis.f0 原文跑一遍 (Node 侧, 走 134-200 行契约)
    payload = json.dumps({'samples': list(sig), 'sr': sr})
    tmp = os.path.join(HERE, '_app_f0_runner.js')
    with open(tmp, 'w', encoding='utf-8') as f:
        f.write(RUNNER)
    try:
        r = subprocess.run([node, tmp, APP], input=payload, capture_output=True, text=True, timeout=180)
        if r.returncode != 0:
            raise RuntimeError('node 运行失败: ' + r.stderr[:400])
        return json.loads(r.stdout)
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)


def main():
    node = find_node()
    print('=' * 72)
    print('W11 外部交叉校验: Praat(parselmouth)  vs  本项目 app.js')
    print('=' * 72)
    print('%8s %10s %11s %9s  %s' % ('真值Hz', 'Praat中位', 'app.js中位', '偏差', '判定'))
    print('-' * 72)
    worst = 0.0
    bad = []
    for f in (100, 120, 150, 170, 180, 200, 240, 300, 340):
        sig = synth(f)
        pv = praat_f0(sig)
        praat_med = float(np.median(pv)) if pv.size else 0.0
        res = app_f0(sig, node=node)
        app_med = res['median']
        if praat_med and app_med:
            dev = abs(app_med - praat_med) / praat_med * 100
            worst = max(worst, dev)
            ok = 'OK' if dev < 3 else 'BAD'
            if dev >= 3:
                bad.append((f, dev))
        else:
            dev, ok = float('nan'), 'BAD'
            bad.append((f, dev))
        print('%8d %10.1f %11.1f %8.2f%%  %s' % (f, praat_med, app_med, dev, ok))
    print('-' * 72)
    print('最大偏差 %.2f%%   判据: 两条曲线的最大偏差 < 3%%' % worst)
    print('=' * 72)
    return 0 if not bad else 1


if __name__ == '__main__':
    sys.exit(main())
