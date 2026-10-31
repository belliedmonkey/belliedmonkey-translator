#!/usr/bin/env python3
# scripts/lid-eval-real.py — 真语音上的语种识别（LID）**准确率矩阵**（Mac，2026-10-07）。
#
# 为什么要有它：`scripts/lid-eval.py` 评的是**真机麦克风录音**（要服务端诊断音频）；这一支评的是
# **任意标注好的真语音频**（新闻/播客都行），用来回答两件事：
#   1. 换模型值不值 —— 同一批音频在不同模型上各跑一遍，比准确率与体积；
#   2. **按音频时长看准确率曲线** —— 这正是听译的取舍点（LID 判出来之前屏幕上只有「正在说…」）。
#
# **别在片头音乐/静音上评**：第二版对着「新闻片头 45s」评，得出「德语被判成英语」—— 用同一份模型
# 去**转写**那些窗口才看到 `*Musik*` / `(upbeat music)`：那几秒根本没人说话。能量门（`speech_runs`）
# 切出语音句再评才像 App 喂进去的东西；`--mode clip` 保留只为对照。
#
# **也别用 TTS 合成音**：macOS `say` 出来的西班牙语会被判成 zh/en，真语音上 1s 起就全对。
#
# Core ML 模型的对比不走这一支（`coremltools` 装不了没有 Manifest 的 ML Program，见下），
# 走 `scripts/lid-eval-coreml.swift`（Swift 侧把 mel 前端逐值对过 frontend.py 之后评测）。
#
# 音频约定：`<dir>/<lang>_16k.wav`（16k 单声道）；`lang` 用注册表短码（zh/en/th/…）。
# **抓完务必核对标题** —— 一条 `ytsearch1:` 抓来的可能是别国语言的节目（踩过）：
#   yt-dlp --no-warnings --no-simulate --print "%(title)s | %(channel)s" \
#     -f bestaudio -x --audio-format wav --download-sections "*40-90" -o es.wav "ytsearch1:telediario"
#   （`--print` 隐含 `--simulate`，要真下必须显式 `--no-simulate`。）
#   ffmpeg -y -i es.wav -ar 16000 -ac 1 es_16k.wav
#
# 用法：
#   .local/lidvenv/bin/python scripts/lid-eval-real.py --model tiny
#   .local/lidvenv/bin/python scripts/lid-eval-real.py --model base
import argparse, glob, json, os, re, subprocess, sys, wave
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..'))
# 模型 → (说明, 交付体积)。体积是**用户实际要下的那个数**（sherpa 用 zip）。
# 站内对比用的另外两个（都由外部工具评）：whisper-base 见本脚本 --model base；
# VoxLingua107 ECAPA Core ML（40.8MB）见 `scripts/lid-eval-coreml.swift`。
MODELS = {
    'tiny': ('whisper-tiny SLID（现用）', '103MB 原始 / 60.3MB zip'),
    'base': ('whisper-base SLID（试过，弃：体积 1.6 倍、整段反而 92% < 100%）', '160MB 原始'),
}


def load_wav16k(path):
    w = '/tmp/_lid_eval_real.wav'
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', path, '-ar', '16000', '-ac', '1', w], check=True)
    with wave.open(w, 'rb') as f:
        return np.frombuffer(f.readframes(f.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0


def make_lid(model):
    """返回 lid(samples_16k_float32) -> 语言短码。"""
    if model in ('tiny', 'base'):
        d = 'lid-model' if model == 'tiny' else 'lid-model-base'
        pre = 'tiny' if model == 'tiny' else 'base'
        root = os.path.join(ROOT, '.local', d)
        for f in (f'{pre}-encoder.int8.onnx', f'{pre}-decoder.int8.onnx'):
            if not os.path.exists(os.path.join(root, f)):
                print(f'✗ 缺模型 {os.path.join(root, f)}', file=sys.stderr)
                sys.exit(1)
        try:
            import sherpa_onnx
        except Exception:
            print('✗ 没装 sherpa_onnx —— .local/lidvenv/bin/pip install sherpa-onnx', file=sys.stderr)
            sys.exit(1)
        slid = sherpa_onnx.SpokenLanguageIdentification(sherpa_onnx.SpokenLanguageIdentificationConfig(
            whisper=sherpa_onnx.SpokenLanguageIdentificationWhisperConfig(
                encoder=os.path.join(root, f'{pre}-encoder.int8.onnx'),
                decoder=os.path.join(root, f'{pre}-decoder.int8.onnx')),
            num_threads=2, provider='cpu'))

        def lid(x):
            s = slid.create_stream()
            s.accept_waveform(16000, x)
            return slid.compute(s)
        return lid

    raise SystemExit(f'未知模型 {model}')


def speech_runs(x, sr=16000, H=320):
    """能量门切出语音句（与 scripts/lid-eval.py 同一套）—— 只判语音段，别拿音乐/静音去问模型。"""
    if len(x) <= H:
        return []
    fr = np.array([np.sqrt(np.mean(x[i:i + H] ** 2) + 1e-12) for i in range(0, len(x) - H, H)])
    gate = max(0.008, float(np.percentile(fr, 10)) * 3)
    sp = fr > gate
    runs, i = [], 0
    while i < len(sp):
        if sp[i]:
            j = i
            while j < len(sp) and (sp[j] or (j + 1 < len(sp) and sp[j + 1])):
                j += 1
            if (j - i) * H / sr >= 0.5:
                runs.append((i * H, min(len(x), j * H)))
            i = j
        else:
            i += 1
    return runs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dir', default=os.path.join(ROOT, '.local', 'lid-real'))
    ap.add_argument('--model', default='tiny', choices=list(MODELS))
    ap.add_argument('--windows', default='1,2,3,5,0', help='秒；0 = 整段')
    ap.add_argument('--mode', default='segments', choices=['segments', 'clip'],
                    help='segments（默认）= 先能量门切出语音句再判（**这才像 App 喂进去的东西**）；'
                         'clip = 整条文件直接判（含音乐/片头/静音 —— 那不是在评模型）')
    a = ap.parse_args()
    print(f'模型 {MODELS[a.model][0]} · {MODELS[a.model][1]} · 模式 {a.mode}')
    lid = make_lid(a.model)
    files = sorted(glob.glob(os.path.join(a.dir, '*_16k.wav')))
    if not files:
        print(f'✗ {a.dir} 里没有 <lang>_16k.wav', file=sys.stderr)
        sys.exit(1)
    wins = [float(x) for x in a.windows.split(',') if x.strip()]
    res = {w: {'n': 0, 'ok': 0, 'bad': []} for w in wins}
    print(f'{len(files)} 门语言\n')
    print(f"{'语言':>4} {'句数':>4} " + ' '.join(f"{('整段' if w == 0 else f'{w:g}s'):>8}" for w in wins))
    for path in files:
        raw = os.path.basename(path).split('_')[0].lower()
        lang = re.match(r'[a-z]+', raw).group(0)
        x = load_wav16k(path)
        segs = [(0, len(x))] if a.mode == 'clip' else speech_runs(x)
        if not segs:
            print(f'{raw:>4}    0 （切不出语音句）')
            continue
        cells = []
        # 逐句判，汇总成「这一门语言在各个时长下的正确率」
        per_len = {w: [0, 0] for w in wins}
        for (s0, s1) in segs:
            seg = x[s0:s1]
            for w in wins:
                L = len(seg) if w == 0 else int(w * 16000)
                if L > len(seg) or L < 16000:
                    continue
                got = lid(seg[:L])
                per_len[w][1] += 1
                res[w]['n'] += 1
                if got == lang:
                    per_len[w][0] += 1
                    res[w]['ok'] += 1
                else:
                    res[w]['bad'].append(f'{raw}→{got}')
        for w in wins:
            ok, n = per_len[w]
            cells.append(f'{ok}/{n}' if n else '-')
        print(f'{raw:>4} {len(segs):>4} ' + ' '.join(f'{c:>8}' for c in cells))
    print()
    for w in wins:
        r = res[w]
        if not r['n']:
            continue
        tag = '整段' if w == 0 else f'{w:g}s'
        misses = ' · '.join(r['bad'][:12]) if r['bad'] else '—'
        print(f'  {tag:>4}: {r["ok"]}/{r["n"]} = {r["ok"]/r["n"]*100:5.1f}%   判错的：{misses}')



if __name__ == '__main__':
    main()
