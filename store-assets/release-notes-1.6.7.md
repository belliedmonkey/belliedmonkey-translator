# 1.6.7 发布说明（六个面）

> **这一轮的改动几乎全在 macOS / iOS App 的「播客模式」里，浏览器扩展一个字节都没改。**
> 六个面仍然全发，是为了让版本号对齐；但两类用户看到的东西差别很大，所以下面的文案
> 分开写 —— 给扩展用户的那一份**不吹 App 的功能**，否则他们更新完会觉得什么都没变。

---

## Apple 四条线（iOS / macOS × 国际版 / 中国版）

### iOS · 简体中文

```
播客模式现在像音乐 App 一样工作了：

· 退到后台、锁屏、切到别的 App，朗读都会继续，一张卡接一张卡地往下走。
· 锁屏上能看到正在念的那张卡片——原句、译句，念到解析时下面三行（生词 / 短语 /
  语法）会跟着念到哪儿就亮到哪儿。
· 灵动岛上显示当前进度，长按展开能看到完整的原句和译句。
· 锁屏、车机和耳机上的播放/暂停、下一张都能用；「上一曲」是「再听一遍」。
· 来电结束后自动继续播放。

另外：App 在前台时屏幕不再自动锁上。锁屏之后想一直看到卡片，请打开系统的「息屏
常显」（设置 → 显示与亮度 → 始终显示）。

小提示：这一版改进了朗读的分段方式，之前预载的解析语音需要重新预载一次，才能恢复
整轮离线播放。
```

### iOS · English

```
Podcast mode now works like a music app:

· Playback keeps going when you leave the app, lock the phone, or switch away —
  card after card, without stopping.
· The Lock Screen shows the card being read: the sentence, its translation, and —
  while the analysis plays — three lines (vocabulary / phrases / grammar) that
  light up one at a time as they are spoken.
· The Dynamic Island shows your progress; press and hold to see the full sentence
  and translation.
· Play/pause and next work from the Lock Screen, your car and your headphones.
  "Previous" repeats the current card from the top.
· Playback resumes by itself after a phone call ends.

Also: the screen no longer dims while podcast mode is in front. To keep seeing the
card after you lock the phone, turn on Always-On Display (Settings → Display &
Brightness → Always On).

Note: this version changes how the analysis is split for speech, so previously
downloaded analysis audio needs to be preloaded once more for fully offline playback.
```

### macOS · 简体中文

```
播客模式现在会在后台继续播放：把窗口最小化、隐藏 App、切到别的程序，朗读都不会停。

· 控制中心的「正在播放」显示当前卡片的原句与译句。
· 键盘上的媒体键可以播放/暂停、切换到下一张；「上一曲」是「再听一遍」。
· 朗读解析时按「生词 / 短语 / 语法」分三段读，节奏更清楚。

（锁屏卡片与灵动岛是 iPhone 上的功能。）
```

### macOS · English

```
Podcast mode now keeps playing in the background: minimise the window, hide the
app, or switch to something else — the reading continues.

· Control Center's Now Playing shows the current card's sentence and translation.
· The keyboard media keys handle play/pause and next; "previous" repeats the
  current card from the top.
· The analysis is now read in three parts (vocabulary / phrases / grammar).

(The Lock Screen card and Dynamic Island are iPhone features.)
```

> **中国版与国际版这次文案相同** —— 本轮没有任何一方独有的修复。上一轮（1.6.4）中国版
> 有「默认引擎不在自己注册表里」那个独有 bug，所以文案必须分开；这次没有，硬编出差异
> 反而是假的。

---

## 浏览器扩展三面（Chrome Web Store / Firefox AMO / GitHub + 官网）

**扩展本身这一版没有功能变化。** 版本号跟到 1.6.7 是为了与 App 对齐，也让从官网直装的
用户拿到与商店同源的包。

### 中文

```
本次为版本对齐更新，浏览器扩展的功能与 1.6.6 相同。

这一版的改进都在 macOS / iOS App 的「播客模式」里：后台与锁屏播放、锁屏上的卡片、
灵动岛显示。浏览器扩展中不提供这些功能。
```

### English

```
This is a version-alignment update; the browser extension is functionally identical
to 1.6.6.

This release's improvements are all in the macOS / iOS app's podcast mode —
background and Lock Screen playback, the Lock Screen card, and Dynamic Island
support. These are not part of the browser extension.
```
