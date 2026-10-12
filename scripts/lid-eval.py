#!/usr/bin/env python3
# scripts/lid-eval.py — 真机录音上的语种识别（LID）评估（Mac 音频层，§0.4；LID spike，2026-10-07）。
#
# 目的：判断「前置 LID」值不值得接进听译（值 = 一票决定哪一路识别器是对的）。要的是**真机麦克风**
#       下的读数，不是干净 TTS 下的读数 —— 两者差得很远（spike 实测：干净 ≥1s 稳，真机 ~67-89%）。
#
# 标注方法（关键）：**一场只录一种语言**，整场即 ground truth；脚本用能量门切出每一句，逐句判。
#   （不要把中泰混录一场再按 sidecar 标 —— sidecar 的 locale 正是被当前 bug 影响的那个量。）
#
# 依赖（本机一次性）：
#   python3 -m venv .local/lidvenv && .local/lidvenv/bin/pip install sherpa-onnx numpy
#   模型（~103MB，放 .local/lid-model/）：
#     curl -L -o tiny-encoder.int8.onnx https://huggingface.co/csukuangfj/sherpa-onnx-whisper-tiny/resolve/main/tiny-encoder.int8.onnx
#     curl -L -o tiny-decoder.int8.onnx https://huggingface.co/csukuangfj/sherpa-onnx-whisper-tiny/resolve/main/tiny-decoder.int8.onnx
#   （同一模型的 Core ML 版更轻：aufklarer/SpeechBrain-ECAPA-VoxLingua107-21M-CoreML，40.8MB，走系统 ANE。）
#
# 用法： .local/lidvenv/bin/python scripts/lid-eval.py --lang zh <sessionDir...>
#        sessionDir 里要有 mic.caf（+ 可选 sidecar.json/meta.json）。服务器上的场：
#        ssh 后 /opt/bt/deploy/china/data/diag-audio/<session>/  scp 回来即可。
import argparse, os, subprocess, sys, wave
import numpy as np

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--lang', required=True, choices=['zh', 'th', 'en', 'ja', 'ko', 'yue'], help='整场的真实语言')
    ap.add_argument('--encoder', default=os.path.join(os.path.dirname(__file__), '..', '.local', 'lid-model', 'tiny-encoder.int8.onnx'))
    ap.add_argument('--decoder', default=os.path.join(os.path.dirname(__file__), '..', '.local', 'lid-model', 'tiny-decoder.int8.onnx'))
    ap.add_argument('dirs', nargs='+')
    a = ap.parse_args()
    try:
        import sherpa_onnx
    except Exception:
        print('✗ 没装 sherpa_onnx —— 见本文件头的依赖说明', file=sys.stderr); sys.exit(1)
    for p in (a.encoder, a.decoder):
        if not os.path.exists(p): print(f'✗ 缺模型 {p}', file=sys.stderr); sys.exit(1)
    slid = sherpa_onnx.SpokenLanguageIdentification(sherpa_onnx.SpokenLanguageIdentificationConfig(
        whisper=sherpa_onnx.SpokenLanguageIdentificationWhisperConfig(encoder=a.encoder, decoder=a.decoder),
        num_threads=2, provider='cpu'))

    def lid(seg):
        s = slid.create_stream(); s.accept_waveform(16000, seg); return slid.compute(s)

    by_len = {}
    SR = 16000
    for d in a.dirs:
        caf = os.path.join(d, 'mic.caf')
        if not os.path.exists(caf):
            print(f'✗ {d} 没有 mic.caf（这一场没开「上传诊断录音」或音频没传上来）'); continue
        wav = os.path.join(d, '_mic16k.wav')
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', caf, '-ar', '16000', '-ac', '1', wav], check=True)
        with wave.open(wav, 'rb') as w:
            x = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0
        H = 320
        fr = np.array([np.sqrt(np.mean(x[i:i+H]**2)+1e-12) for i in range(0, len(x)-H, H)])
        gate = max(0.008, float(np.percentile(fr, 10)) * 3)
        sp = fr > gate
        runs = []; i = 0
        while i < len(sp):
            if sp[i]:
                j = i
                while j < len(sp) and (sp[j] or (j+1 < len(sp) and sp[j+1])): j += 1
                if (j-i)*H/SR >= 0.5: runs.append((i*H/SR, j*H/SR))
                i = j
            else: i += 1
        print(f'\n{d}  时长 {len(x)/SR:.1f}s · 底噪 {np.percentile(fr,10):.4f} · 语音句 {len(runs)} 个 · 期望 {a.lang}')
        for (s0, s1) in runs:
            seg = x[int(s0*SR):int(s1*SR)]
            for pre in (1.0, 2.0, 3.0, None):
                L = len(seg) if pre is None else min(len(seg), int(pre*SR))
                if L < SR*0.5: continue
                g = lid(seg[:L]); by_len.setdefault(pre, []).append(g == a.lang)

    print('\n=== 汇总（按判定时长）===')
    print(f"{'时长':>6} {'n':>4} {'正确率':>7}")
    for pre in (1.0, 2.0, 3.0, None):
        r = by_len.get(pre)
        if not r: continue
        print(f'{"≤"+str(pre)+"s" if pre else "整段":>6} {len(r):>4} {sum(r)/len(r)*100:>6.0f}%')

if __name__ == '__main__':
    main()
