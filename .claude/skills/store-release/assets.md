# 商店素材：怎么判断过时，怎么重做

`store-assets/README.md` 与 `screenshots-cn/README.md` 已经写了两条截图管线的重做
流程，**这里不复述**。这里补它们没有的两层：**怎么判断一张图该不该重拍**，以及
**视频怎么做**（两个 README 都没有视频）。

## 什么算过时 —— 五条判据

每一条都对应 2026-08-22 的一次真实事故。审计时逐张过一遍这五条，**别只比日期**。

### ① 展示了未完成状态

旧 `f1-article.png`（08-15）里有两段停在「⏳ 翻译中…」。商店页在演示一个还没翻完的
产品。拍之前等到全部收敛：

```bash
osascript -e 'tell application "Safari" to do JavaScript "var t=[...document.querySelectorAll(\".mt-translation\")].map(x=>x.innerText.trim()); JSON.stringify({total:t.length, pending:t.filter(x=>/翻译中/.test(x)).length, err:t.filter(x=>/失败/.test(x)).length})" in front document'
# 期望 pending:0, err:0
```

### ② 泄露了隐私

旧 `f3`/`f4` 印着 `belliedmonkey@gmail.com`。那是公开页面。

两个来源：**登录态**（复习页顶部会显示账号）和**浏览器标签栏**（会把你所有标签页
印上去）。脚本拍的那两张不登录，页面显示「未登录，仅本机数据」；手工拍的用只有
一个标签页的新窗口。

### ③ 配色或版式已经变了

旧的两个预览片（08-10）用的是改版前的亮绿配色，当前是 Organic 的橄榄/鼠尾草。
判据：把旧素材和当前构建并排看一眼，不要凭印象。

### ④ 那个界面已经不存在了

旧 `f3-phone-stats.png` 拍的是「大数字统计」版式（`129 / 12 / 56 / 42 / 31` 五个
大数字 + 开始复习按钮）。当前 UI 里那个版式**没有了**，改成了一行紧凑 header。
图与实包对不上，比图丑严重得多。

### ⑤ 产物早于最近一次 UI 改动

```bash
for f in store-assets/src/assets/*.png; do echo "$(stat -f '%Sm' -t '%m-%d %H:%M' "$f")  $f"; done
git log -1 --format=%ad --date=short -- extension/options extension/learn extension/content
```

⚠️ **日期只是线索，不是判据。** 08-15 拍的 `f2-video.png` 完全没过时（视频字幕那一屏
自那以后没改过），重拍它是浪费；而 08-11 的 `f5-settings.png` 里印着 markdown 星号
bug —— 幸好它是孤儿资产（`scene.html` 不引用），没进出货图。

### ⑥ 画布上放的是另一台设备的截图

手机画布里一个 Mac 窗口、Mac 横幅里一台手机 —— 图与画布不是同一台设备。2026-09-06
之前第 1、2、5 帧在 iPhone / iPad 画布里就是一个 1728 宽的 Mac 窗口：缩进 1242 宽的画布后
正文一个字都看不清，上下各空四成。用户原话「人类看起来很糟糕」。

规矩与档位写在 `store-assets/README.md`「一条硬规矩」；`scene.html` 按画布判档位，原料按
`phone` / `tablet` / `desk` 三档各拍。审计时逐张问一句：**这张画布是哪台设备，图里是不是
那台设备看到的东西。** 唯一例外是横版第 5 帧（Mac 旁边那台手机是内容本身）。

### 别漏掉的三处素材

审计范围不止 App Store：

| 位置 | 内容 |
|---|---|
| `store-assets/src/assets/f*.png` | 国际版的四张实拍图（合成的原料） |
| `screenshots-cn/src/assets/cn-*.png` | 中国版的六张实拍图 |
| `~/belliedmonkey-cc/media/` | **官网自己的一套**：`shot-*.png`、`demo-macos-*.mp4`、`demo-poster.jpg` |

---

## 截图

两条管线的重做流程见各自 README。这里只补两件它们没写的。

### 尺寸表

| ASC 展示类型 | 像素 | 出货文件 |
|---|---|---|
| `APP_IPHONE_65` | 1242×2688 | `{zh,en}-iphone-*` / `cn-iphone-*` |
| `APP_IPAD_PRO_3GEN_129` | **2064×2752** | `{zh,en}-ipad-*` / `cn-ipad-*` |
| `APP_DESKTOP` | 2880×1800 | `{zh,en}-mac-*` / `cn-mac-*` |
| CWS / AMO | 1280×800 | `{zh,en}-web-*` |

⚠️ iPad 那个尺寸**反直觉**：Apple 文档写 `APP_IPAD_PRO_3GEN_129` 是 2048×2732，
但线上现有集合里就是 2064×2752（iPad Pro 13" M4），传同尺寸不会被拒。
**以线上现状为准**，传前先读一眼：

```bash
# asc-media.js 的干运行会打印每个集合现有几张；要看尺寸就查 imageAsset
```

### 手工那几张的完整配方

桌面档 `f1-article` / `f2-video` 与手机、平板档的视频 `phone-video` / `tablet-video`
是手拍的。文章双语的手机、平板档**不用手拍**：`node store-assets/src/capture-live.js
phone|tablet article` 用真 Chrome 装上 dist/ 去翻 m.wikipedia / wikipedia。视频拍不了是
YouTube 的事：受控浏览器里播放器直接报「Something went wrong」（headless、有头、iPhone /
Android UA、先暖 cookie 全试过，2026-09-06），所以视频永远手拍。

手机 / 平板档的视频用 **iOS 模拟器**拍（真机走 iPhone 镜像的话分辨率只有 0.7 倍，且手机
自己的网络到不了 YouTube）：模拟器走 Mac 的网络与代理，`simctl io booted screenshot` 出的
是整数倍的原生分辨率，装扩展的步骤见 [[ios-sim-extension-resources-stale]] 那条记忆。
拍 m.youtube.com（iPhone）/ youtube.com（iPad），点悬浮球，等双字幕出现、画面不是黑场再截。

桌面档两张：

```bash
# ① 干净窗口，精确 1280×800 点 —— 单标签页，否则标签栏泄露浏览记录
osascript <<'EOF'
tell application "Safari"
  activate
  make new document with properties {URL:"https://en.wikipedia.org/wiki/Tea"}
  delay 4
  set bounds of front window to {60, 60, 1340, 860}
end tell
EOF

# ② 收起 Wikipedia 右侧 Appearance 面板（它白占地方）
osascript -e 'tell application "Safari" to do JavaScript "var ap=document.getElementById(\"vector-appearance\"); var b=ap?[...ap.querySelectorAll(\"button\")].find(x=>/^hide$/i.test(x.textContent.trim())):null; if(b) b.click(); window.scrollTo(0,0); \"ok\"" in front document'

# ③ 翻译并确认收敛（判据 ①）

# ④ 抓图：窗口 1280×800 点 → 2560×1600 物理像素
cap screenshot --window <窗口id> --path /tmp/raw.png

# ⑤ 裁掉顶部 104px 工具栏，取 2560×1286（1.99:1），缩到 1728×868
python3 -c "
from PIL import Image
im=Image.open('/tmp/raw.png').convert('RGB')
im.crop((0,104,2560,104+1286)).resize((1728,868), Image.LANCZOS).save('store-assets/src/assets/f1-article.png')
"
```

窗口 id 用 `cap record windows --json` 拿。

---

## 视频（App Preview）

### Apple 规格

| 预览类型 | 像素 | 时长 | 帧率 | 编码 |
|---|---|---|---|---|
| `IPHONE_65` | 886×1920（竖） | 15–30 秒 | 30fps | H.264 · yuv420p |
| `DESKTOP` | 2560×1600 | 15–30 秒 | 30fps | 同上 |

### 五个坑 —— 每一个都让一条素材作废过

| 坑 | 判据 | 解 |
|---|---|---|
| **`simctl recordVideo` 是延时摄影** | 20 秒实时录出 4.5 秒（它只在画面变化时出帧） | 改用 `cap record` |
| **智能体光标印进画面** | iPhone 画面里出现紫色鼠标箭头 | 守护进程带 `--no-overlay` 重启，**用完还原** |
| **`cap` 的窗口录制不是无遮挡的** | 录到了别的窗口的内容，而 `cap screenshot` 同一个 id 却是对的 | 起录前把目标窗口提到最前，并确保没有别的窗口压在上面 |
| **`cap` 启动会抢焦点** | 起录后的第一次点击落空，页面没反应 | 起录 → `bring_to_front` → 再点 |
| **标签栏泄露浏览记录** | 画面里能看到你所有标签页的标题 | 用只有一个标签页的新窗口 |

关掉智能体光标（**录完记得还原**）：

```bash
cua-driver stop && sleep 3
nohup cua-driver serve --grant existing-profile --no-overlay > /tmp/cua.log 2>&1 &
# 判据：cua-driver call get_agent_cursor_state '{}' 报 facility_unavailable
# 还原：去掉 --no-overlay 重启，get_agent_cursor_state 回到 enabled:true
```

### iOS：模拟器几何

用 iPhone 11 Pro Max 模拟器（6.5"，1242×2688，与 `IPHONE_65` 严格对应）。

```
Window ▸ Show Device Bezels   关掉  ⇒ 窗口去掉外壳
Window ▸ Point Accurate       选上  ⇒ 按设备点数渲染，放大倍数最小
```

得到窗口 414×948 点 ⇒ `cap` 录到 **828×1896** 物理像素（含 104px 标题栏）
⇒ `crop=828:1792:0:104` 去掉标题栏 ⇒ 缩到 886×1920，**只放大 1.07 倍**，几乎无损。

### macOS：一比一，不缩放

Safari 窗口设成 **1280×800 点** ⇒ `cap` 录到 2560×1600 ⇒ 正好是 `DESKTOP` 规格，
不用缩放。

### 录制

```bash
cua-driver call bring_to_front '{"pid":<pid>,"window_id":<wid>}'
cap record start --window <wid> --fps 30 --detach --path /tmp/take.cap
sleep 2.5
# …驱动界面：点 FAB → 等译文出现 → 滚动 3 次…
cap record stop

# 关掉 Cap 自己那层光标 + 去掉背景内边距与阴影
python3 -c "
import json
p='/tmp/take.cap/project-config.json'
d=json.load(open(p)); d['cursor']['hide']=True
b=d['background']; b['padding']=0.0; b['rounding']=0.0; b['shadow']=0.0; b['inset']=0
b['advancedShadow']={'size':0.0,'opacity':0.0,'blur':0.0}
json.dump(d,open(p,'w'),indent=2)
"
cap export /tmp/take.cap -o /tmp/take.mp4 --resolution 828x1896 --fps 30 --quality maximum
```

### 配音：用 App 自己的学习 TTS

**不要用第三方配音。** 声音应该就是用户学外语时听到的那个。

在扩展的复习页（`safari-web-extension://<UUID>/learn/review.html`，从设置页的
「打开复习页」按钮进，直接导航会被 Safari 拒）里，全局有 `LearnTTS`：

```bash
cap record start --window <任意窗口> --system-audio --fps 30 --detach --path /tmp/tts.cap
sleep 2
osascript -e 'tell application "Safari" to do JavaScript "LearnTTS.speak(\"<画面上出现的那句英文>\", \"en\"); \"go\"" in front document'
sleep 11
# …第二句…
cap record stop
```

音频落在 `/tmp/tts.cap/content/segments/segment-0/system_audio.ogg`。
用 `silencedetect` 定位有声段落，再按定位切：

```bash
ffmpeg -i system_audio.ogg -af "silencedetect=noise=-45dB:d=0.6" -f null /dev/null 2>&1 | grep silence_
ffmpeg -ss 2.9 -t 7.5 -i system_audio.ogg -af "afade=t=in:st=0:d=0.15,afade=t=out:st=7.2:d=0.3,loudnorm=I=-18:TP=-2" -ar 48000 -ac 2 /tmp/s1.wav
```

### 音乐：合成，不用现成素材

**不碰任何有版权的音乐。** 用 ffmpeg 合成一段环境音床：

```bash
ffmpeg -f lavfi -t 21 -i "sine=frequency=110:sample_rate=48000" \
       -f lavfi -t 21 -i "sine=frequency=164.81:sample_rate=48000" \
       -f lavfi -t 21 -i "sine=frequency=220:sample_rate=48000" \
       -f lavfi -t 21 -i "sine=frequency=329.63:sample_rate=48000" \
 -filter_complex "[0]volume=0.5[a];[1]volume=0.32[b];[2]volume=0.22[c];[3]volume=0.12[d];\
   [a][b][c][d]amix=inputs=4:normalize=0[m];\
   [m]tremolo=f=0.18:d=0.35,lowpass=f=900,aformat=channel_layouts=stereo,\
   loudnorm=I=-30:TP=-6:LRA=7,afade=t=in:st=0:d=2,afade=t=out:st=18:d=3[music]" \
 -map "[music]" -ar 48000 /tmp/music.wav
```

`loudnorm=I=-30` 是关键：不定标的话四个正弦混出来大约 -54 dB，等于没有。

### 混音与封装

侧链压缩让音乐在人声下自动让位：

```bash
# 旁白轨：静音 + 第一句 + 间隔 + 第二句 + 补齐到片长
ffmpeg -f lavfi -t 4 -i anullsrc=r=48000:cl=stereo -i /tmp/s1.wav \
       -f lavfi -t 1.2 -i anullsrc=r=48000:cl=stereo -i /tmp/s2.wav \
       -f lavfi -t 5 -i anullsrc=r=48000:cl=stereo \
 -filter_complex "[0][1][2][3][4]concat=n=5:v=0:a=1[a]" -map "[a]" -t 21 -ar 48000 /tmp/narr.wav

ffmpeg -i /tmp/narr.wav -i /tmp/music.wav \
 -filter_complex "[1][0]sidechaincompress=threshold=0.03:ratio=6:attack=20:release=800[duck];\
   [0][duck]amix=inputs=2:normalize=0,alimiter=limit=0.95,loudnorm=I=-16:TP=-1.5[a]" \
 -map "[a]" -t 21 -ar 48000 -ac 2 /tmp/audio.wav

# 画面：裁剪 + 缩放 + 定帧率
ffmpeg -ss 1.0 -t 21 -i /tmp/take.mp4 -vf "crop=828:1792:0:104,scale=886:1920:flags=lanczos" \
  -r 30 -c:v libx264 -profile:v high -level 4.0 -preset slow -crf 18 -pix_fmt yuv420p \
  -movflags +faststart -an /tmp/video.mp4

# 合成
ffmpeg -i /tmp/video.mp4 -i /tmp/audio.wav -c:v copy -c:a aac -b:a 192k -ar 48000 -ac 2 \
  -shortest -movflags +faststart /tmp/ios-preview.mp4
```

**验收**（不要只看有没有报错）：

```bash
ffprobe -v error -show_entries stream=codec_type,codec_name,width,height,r_frame_rate \
  -show_entries format=duration,size -of default=nw=1 /tmp/ios-preview.mp4
# 期望：h264 / 886×1920 / 30 / aac / duration 在 15–30 之间
```

再抽几帧人眼看一遍：起手是原文、中段译文出现、结尾在滚动，且**没有光标、没有别的
窗口、没有标签栏**。

---

## 六个面各要什么

| 面 | 截图 | 视频 |
|---|---|---|
| Apple iOS 国际版 | `en-iphone-1..5` + `en-ipad-1..5`（en-US）、`zh-*`（zh-Hans） | `IPHONE_65` ×1 |
| Apple macOS 国际版 | `en-mac-1..5`、`zh-mac-1..5` | `DESKTOP` ×1 |
| Apple iOS 中国版 | `cn-iphone-1..4` + `cn-ipad-1..4`（zh-Hans） | 无 |
| Apple macOS 中国版 | `cn-mac-1..4` | 无 |
| CWS / AMO | `{zh,en}-web-1..5` + `cws-promo-tile-440x280.png` | 无 |
| 官网 | `~/belliedmonkey-cc/media/shot-*.png` | `~/belliedmonkey-cc/media/demo-macos-{en,zh}.mp4` + `demo-poster.jpg` |

中国版刻意少两帧（视频字幕、跨设备闭环），**不是风格差异是事实差异** ——
YouTube 在境内不可达，china flavor 的同步是关的。见 `screenshots-cn/README.md`。

## 上传

见 `SKILL.md` 第 6 步。一句话：`node scripts/asc-media.js` 打印计划，`--apply` 才动，
**先探一条、回读 `assetDeliveryState.state === 'COMPLETE'`、再推其余**。
