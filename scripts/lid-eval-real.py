#!/usr/bin/env python3
# scripts/lid-eval-real.py — 真语音上的语种识别（LID）**准确率矩阵**（Mac，2026-10-07）。
#
# 为什么要有它：`scripts/lid-eval.py` 评的是**真机麦克风录音**（要服务端诊断音频）；这一支评的是
# **任意标注好的真语音频**（新闻/播客都行），用来回答两件事：
#   1. 换模型值不值 —— 同一批音频在 whisper-tiny / 候选模型上各跑一遍，比准确率与体积；
#   2. **按音频时长看准确率曲线** —— 这正是听译的取舍点（LID 判出来之前屏幕上只有「正在说…」）。
#
# **别用 TTS 合成音下结论**：macOS `say` 出来的西班牙语被 whisper-tiny 判成 zh/en，而真语音
# 未必（2026-10-07 实测，见 docs/learning-design.md §9.6.1.3）。所以要真音频。
#
# 音频约定：`<dir>/<lang>_16k.wav`（16k 单声道）；`lang` 用注册表短码（zh/en/th/…）。
# 取真语音（Mac 上一条命令一个语言）：
#   yt-dlp -f bestaudio -x --audio-format wav --download-sections "*20-70" -o es.wav "ytsearch1:telediario español"
#   ffmpeg -y -i es.wav -ar 16000 -ac 1 es_16k.wav
#
# 用法：
#   .local/lidvenv/bin/python scripts/lid-eval-real.py --dir .local/lid-real
#   .local/lidvenv/bin/python scripts/lid-eval-real.py --dir .local/lid-real --model other
import argparse, glob, os, subprocess, sys, wave
import numpy as np

MODELS = {
    'tiny': ('sherpa-onnx-whisper-tiny',  'tiny-encoder.int8.onnx',  'tiny-decoder.int8.onnx'),
    'base': ('sherpa-onnx-whisper-base',  'base-encoder.int8.onnx',  'base-decoder.int8.onnx'),
}
MODEL_DIRS = {
    'tiny': os.path.join('..', '.local', 'lid-model'),
    'base': os.path.join('..', '.local', 'lid-model-base'),
}


def load_wav16k(path):
    w = '/tmp/_lid_eval_real.wav'
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', path, '-ar', '16000', '-ac', '1', w], check=True)
    with wave.open(w, 'rb') as f:
        return np.frombuffer(f.readframes(f.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dir', default=os.path.join(os.path.dirname(__file__), '..', '.local', 'lid-real'))
    ap.add_argument('--model', default='tiny', choices=list(MODELS))
    ap.add_argument('--model-dir', default='', help='模型目录；空 = 按 --model 取默认')
    ap.add_argument('--windows', default='1,2,3,5,0', help='秒；0 = 整段')
    a = ap.parse_args()
    rel = a.model_dir or MODEL_DIRS[a.model]
    root = os.path.abspath(os.path.join(os.path.dirname(__file__), rel))
    name, enc, dec = MODELS[a.model]
    for p in (os.path.join(root, enc), os.path.join(root, dec)):
        if not os.path.exists(p):
            print(f'✗ 缺模型 {p}', file=sys.stderr)
            sys.exit(1)
    try:
        import sherpa_onnx
    except Exception:
        print('✗ 没装 sherpa_onnx —— python3 -m venv .local/lidvenv && .local/lidvenv/bin/pip install sherpa-onnx numpy', file=sys.stderr)
        sys.exit(1)
    slid = sherpa_onnx.SpokenLanguageIdentification(sherpa_onnx.SpokenLanguageIdentificationConfig(
        whisper=sherpa_onnx.SpokenLanguageIdentificationWhisperConfig(
            encoder=os.path.join(root, enc), decoder=os.path.join(root, dec)),
        num_threads=2, provider='cpu'))

    def lid(x):
        s = slid.create_stream()
        s.accept_waveform(16000, x)
        return slid.compute(s)

    files = sorted(glob.glob(os.path.join(a.dir, '*_16k.wav')))
    if not files:
        print(f'✗ {a.dir} 里没有 <lang>_16k.wav', file=sys.stderr)
        sys.exit(1)
    wins = [float(x) for x in a.windows.split(',') if x.strip()]
    res = {w: {'n': 0, 'ok': 0, 'bad': []} for w in wins}
    print(f'模型 {name}（{a.model}） · {len(files)} 门语言\n')
    print(f"{'语言':>4} {'时长':>6} " + ' '.join(f"{('整段' if w == 0 else f'{w:g}s'):>7}" for w in wins))
    for path in files:
        lang = os.path.basename(path).split('_')[0].lower()
        x = load_wav16k(path)
        row = []
        for w in wins:
            n = len(x) if w == 0 else int(w * 16000)
            if n > len(x) or n < 16000:
                row.append('   -   ')
                continue
            got = lid(x[:n])
            res[w]['n'] += 1
            if got == lang:
                res[w]['ok'] += 1
            else:
                res[w]['bad'].append(f'{lang}→{got}')
            row.append(f'{got:>7}')
        print(f'{lang:>4} {len(x)/16000:>5.1f}s ' + ' '.join(row))
    print()
    for w in wins:
        r = res[w]
        if not r['n']:
            continue
        tag = '整段' if w == 0 else f'{w:g}s'
        misses = ' · '.join(r['bad']) if r['bad'] else '—'
        print(f'  {tag:>4}: {r["ok"]}/{r["n"]} = {r["ok"]/r["n"]*100:5.1f}%   判错的：{misses}')


if __name__ == '__main__':
    main()
