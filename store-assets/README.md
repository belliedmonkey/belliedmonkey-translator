# 国际版商店素材（store-assets/）

App Store（`com.belliedmonkeytranslator`）、Chrome Web Store、AMO 共用的截图与预览片。
出货图是 `{zh,en}-{iphone,ipad,mac,web}-1..5.png`，由 `src/scene.html` 把**实拍产品图**
合进版式框里渲染而成。中国版的对应目录是 [`screenshots-cn/`](../screenshots-cn/)。

## 四张实拍图，两种来源 —— 这是这套素材唯一需要记住的事

| 素材 | 内容 | 怎么来的 |
|---|---|---|
| `src/assets/f1-article.png` | Mac Safari 里真实译好的一页 | **真机截图**（下方「手工那两张」） |
| `src/assets/f2-video.png` | YouTube 双语字幕 | **真机截图**（同上） |
| `src/assets/f3-phone-stats.png` | 手机上的出题卡 | `src/capture.js` 自动拍 |
| `src/assets/f4-phone-card.png` | 手机上答对后的双语对照 + 四档评分 | `src/capture.js` 自动拍 |

f1/f2 需要**真实扩展跑在真实站点上**（一个要真的把维基页翻出来，一个要 YouTube 真的
吐出字幕轨），headless 里造不出来，所以它们不在脚本里。f3/f4 只用到扩展自己的页面，
可以在 headless 里连数据一起造，于是脚本化了。

`src/assets/f5-settings.png` 是**孤儿**：`scene.html` 不引用它。留着只是历史，别照着它更新。

## 重做流程

改了 UI 就得重跑，否则商店图与实包不符。

```bash
# ① 脚本能拍的两张
node build.js                                  # 出 dist/
(cd dist && python3 -m http.server 8732 &)
node store-assets/src/capture.js               # → src/assets/f3,f4

# ② 手工那两张（真机，见下）
# ③ 合成 40 张
bash store-assets/src/render.sh
```

### 手工那两张怎么拍

把 Safari 窗口精确设成 **1280×800 点**（`osascript` 设 bounds），装好当前构建的扩展，
翻译一页维基 / 打开一个带字幕的 YouTube 视频，然后：

```bash
cap screenshot --window <窗口id> --path /tmp/raw.png      # 2560×1600
# 裁掉顶部 104px 工具栏，取 2560×1286（1.99:1），缩到 1728×868
```

**拍之前要清掉三样东西**，它们都真的进过出货图：

- **未完成状态**。旧 `f1`（08-15）有两段停在「⏳ 翻译中…」。等到全部收敛再拍。
- **你自己的浏览记录**。用只有一个标签页的新窗口，否则标签栏会把你所有标签页印上去。
- **你的账号**。旧 `f3`/`f4` 印着真实邮箱 —— 那是公开页面。脚本拍的那两张不登录，
  页面显示「未登录，仅本机数据」。

## 上传

`node scripts/asc-media.js` 打印计划，`--apply` 才真替换。资产上传是三步（预留 → 传字节
→ 提交 md5 校验和），**漏了校验和会停在 `UPLOAD_COMPLETE` 而商店页看不到图，且 API
不报错** —— 所以传完必须回读 `assetDeliveryState.state === 'COMPLETE'`。
