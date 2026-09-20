// test/build-scripts.test.js — the two release scripts' layout assumptions.
//
// Both scripts were written against the iOS/dual-platform layout the converter emits
// by default, and both got a macOS bundle wrong in a way that looked like something
// else entirely:
//
//   · `sync-app-assets.js` looks for `Shared (App)`. A `--macos-only` project has no
//     such folder, so it printed "未生成，跳过" — indistinguishable from "no project
//     here" — and patched nothing. The shipped macOS 1.4.1 host app therefore carried
//     the converter's 979-byte template Main.html instead of our 19543-byte app, for
//     three releases, with no output ever saying so.
//   · `verify-ios-bundle.js` walks the .appex from its root. macOS keeps resources in
//     `Contents/Resources/`, so all 71 dist files came back "NOT in the built
//     extension" — a false alarm shaped exactly like the real 2026-08-04 accident
//     (the whole `learn/` directory genuinely missing from the appex).
//
// The rule both encode: **a layout you don't recognise is an error, not an absence.**

const fs = require('fs');
const os = require('os');
const path = require('path');
const { describe, test, ok, eq, deepEq, match } = require('./harness');

const {
  classifyProject, patchViewController, patchMacWindowXml, patchMacMenuXml,
  patchAudioBridgeSwift, patchPlistXml, patchInfoPlists, PLIST_KEYS,
  patchEntitlements,
  ENTITLEMENTS,
  patchWidgetTarget,
  patchWidgetFiles,
  patchExtensionTarget,
  patchExtensionFiles,
  WIDGET_SPEC,
  EMBED_PLUGINS,
  EMBED_EXTENSIONKIT,
  TRANSLATE_EXT_SPEC,
  appBundleId,
  stripExtensionTarget,
  patchSwiftPackageText,
} = require('../scripts/sync-app-assets.js');
const { resourceRoot, findApp, checkBackgroundAudio } = require('../scripts/verify-ios-bundle.js');

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mt-build-scripts-'));
}
function mk(...parts) {
  const p = path.join(...parts);
  fs.mkdirSync(p, { recursive: true });
  return p;
}

describe('sync-app-assets: project layout classification', () => {
  test('a project root that does not exist is absent — silence is correct here', () => {
    const root = tmpdir();
    const res = classifyProject(path.join(root, 'safari-project'));
    eq(res.state, 'absent');
    deepEq(res.dirs, []);
  });

  test('the dual-platform layout is recognised and yields its Shared (App) dir', () => {
    const root = mk(tmpdir(), 'safari-project');
    const shared = mk(root, 'BelliedMonkey Translator', 'Shared (App)');
    mk(root, 'BelliedMonkey Translator', 'iOS (App)');
    mk(root, 'BelliedMonkey Translator', 'macOS (App)');
    const res = classifyProject(root);
    eq(res.state, 'ok');
    deepEq(res.dirs, [shared]);
  });

  // The regression itself: the tree IS there, so reporting "absent" (and moving on)
  // is the one answer that ships a broken app. It must be its own state.
  test('a --macos-only flat layout is unrecognized, NOT absent', () => {
    const root = mk(tmpdir(), 'safari-project-macos');
    mk(root, 'BelliedMonkey Translator', 'BelliedMonkey Translator');
    mk(root, 'BelliedMonkey Translator', 'BelliedMonkey Translator Extension');
    const res = classifyProject(root);
    eq(res.state, 'unrecognized', 'a present-but-unpatchable project must not read as absent');
    deepEq(res.dirs, []);
  });

  test('an empty project root is unrecognized too — something made it, nothing usable in it', () => {
    const root = mk(tmpdir(), 'safari-project');
    eq(classifyProject(root).state, 'unrecognized');
  });
});

// Verbatim from `safari-web-extension-converter` (macOS (App)/Base.lproj/Main.storyboard,
// 2026-08-13). Copied rather than summarised: every needle below is an assumption about
// the converter's exact output, and a paraphrase would test the paraphrase.
const TEMPLATE_STORYBOARD = `<?xml version="1.0" encoding="UTF-8"?>
<document type="com.apple.InterfaceBuilder3.Cocoa.Storyboard.XIB">
    <scenes>
        <scene sceneID="R2V-B0-nI4">
            <objects>
                <windowController showSeguePresentationStyle="single" id="B8D-0N-5wS" sceneMemberID="viewController">
                    <window key="window" title="BelliedMonkey Translator" restorable="NO" id="IQv-IB-iLA">
                        <windowStyleMask key="styleMask" titled="YES" closable="YES"/>
                        <windowCollectionBehavior key="collectionBehavior" fullScreenNone="YES"/>
                        <rect key="contentRect" x="196" y="240" width="425" height="325"/>
                        <rect key="screenRect" x="0.0" y="0.0" width="1680" height="1027"/>
                    </window>
                </windowController>
            </objects>
        </scene>
        <scene sceneID="hIz-AP-VOD">
            <objects>
                <viewController id="XfG-lQ-9wD" customClass="ViewController">
                    <view key="view" id="m2S-Jp-Qdl">
                        <rect key="frame" x="0.0" y="0.0" width="425" height="325"/>
                        <subviews>
                            <wkWebView wantsLayer="YES" fixedFrame="YES" id="eOr-cG-IQY">
                                <rect key="frame" x="0.0" y="0.0" width="425" height="325"/>
                                <autoresizingMask key="autoresizingMask" widthSizable="YES" heightSizable="YES"/>
                            </wkWebView>
                        </subviews>
                    </view>
                </viewController>
            </objects>
        </scene>
    </scenes>
</document>
`;

// The window the converter hands us is right for its 979-byte placeholder and wrong for
// a reading app: fixed 425×325, no zoom, no full screen. It went unnoticed for three
// releases because the same tree also never got its resources — the placeholder does not
// care how big it is. Nothing here asserts a pretty size; it asserts the user can change it.
describe('sync-app-assets: ViewController patches', () => {
  // A minimal converter-shaped template: the two anchors the patches key on.
  const TEMPLATE = 'import WebKit\n\nclass ViewController {\n'
    + '    func viewDidLoad() {\n'
    + '        super.viewDidLoad()\n\n'
    + '        self.webView.navigationDelegate = self\n'
    + '        self.webView.scrollView.isScrollEnabled = false\n'
    + '        self.webView.configuration.userContentController.add(self, name: "controller")\n'
    + '    }\n}\n';

  function run(dir) {
    return patchViewController(dir);
  }

  test('idle timer (§9.5): patched once, iOS-guarded, after the delegate line', () => {
    const dir = tmpdir();
    fs.writeFileSync(path.join(dir, 'ViewController.swift'), TEMPLATE);
    const notes = run(dir);
    ok(/idle timer patched/.test(notes), notes);
    const out = fs.readFileSync(path.join(dir, 'ViewController.swift'), 'utf8');
    ok(out.includes('UIApplication.shared.isIdleTimerDisabled = true'), '补丁行在');
    ok(/#if os\(iOS\)[\s\S]*isIdleTimerDisabled/.test(out), '必须 iOS 门内 — UIApplication 在 macOS 不存在');
  });

  test('running twice changes nothing the second time (idempotent, like every patch)', () => {
    const dir = tmpdir();
    fs.writeFileSync(path.join(dir, 'ViewController.swift'), TEMPLATE);
    run(dir);
    const once = fs.readFileSync(path.join(dir, 'ViewController.swift'), 'utf8');
    const notes = run(dir);
    ok(/idle timer already patched/.test(notes), notes);
    const twice = fs.readFileSync(path.join(dir, 'ViewController.swift'), 'utf8');
    eq(once, twice, '第二次必须一字不改');
    eq((twice.match(/isIdleTimerDisabled/g) || []).length, 1, '只插一次');
  });

  test('a template without the anchor says so instead of silently passing', () => {
    const dir = tmpdir();
    fs.writeFileSync(path.join(dir, 'ViewController.swift'), 'class ViewController {}\n');
    ok(/idle timer: anchor missing/.test(run(dir)));
  });

  // §9.5 后台/锁屏. Both platforms get the install line: iOS needs the audio session,
  // macOS needs the media remote (its process is never suspended, so background
  // playback is unconditional there and the ONLY thing that ever stopped it was our
  // own visibilitychange handler).
  test('audio bridge install (§9.5): after the controller channel, once, both platforms', () => {
    const dir = tmpdir();
    fs.writeFileSync(path.join(dir, 'ViewController.swift'), TEMPLATE);
    const notes = run(dir);
    ok(/audio bridge install patched/.test(notes), notes);
    const out = fs.readFileSync(path.join(dir, 'ViewController.swift'), 'utf8');
    ok(out.includes('MTAudioBridge.shared.install(webView: self.webView)'), '安装行在');
    ok(out.indexOf('MTAudioBridge.shared.install')
       > out.indexOf('userContentController.add(self, name: "controller")'),
      '必须在 controller 通道注册之后 —— 之前的话 web 视图还没定型');
    ok(!/#if os\(iOS\)[^#]*MTAudioBridge\.shared\.install/.test(out),
      'macOS 也要装：那边要媒体键，只是不需要音频会话');
    const twice = run(dir);
    ok(/audio bridge install already patched/.test(twice), twice);
    eq((fs.readFileSync(path.join(dir, 'ViewController.swift'), 'utf8')
        .match(/MTAudioBridge\.shared\.install/g) || []).length, 1, '只插一次');
  });

  test('audio bridge install: missing anchor is LOUD (✗), not a shrug', () => {
    const dir = tmpdir();
    fs.writeFileSync(path.join(dir, 'ViewController.swift'), 'class ViewController {}\n');
    ok(/✗ audio bridge install: userContentController\.add 锚点缺失/.test(run(dir)),
      '漏了这个补丁的表现是「App 装上了、锁屏就停」—— 和功能没做一模一样，必须响亮');
  });
});

// The marker block is the whole point of this patch's shape. Every other patch here
// is one constant line, where "contains it? skip" is right; this block keeps evolving,
// and a needle check would freeze whatever version first reached a tree while app:sync
// printed "already patched" forever.
describe('sync-app-assets: Safari 调用失败必须可见 (#177)', () => {
  // 转换器模板在两处留了「Insert code to inform the user that something went
  // wrong.」然后 return —— 两处都是静默失败。2026-08-28 真机验收撞在深链那处：
  // 按钮拿到焦点环，App 没退出、Safari 设置没开、系统日志无记录，从外面根本
  // 分不清是消息没通还是系统调用被拒。
  const TEMPLATE_SAFARI = 'import WebKit\n\nclass ViewController {\n'
    + '    func viewDidLoad() {\n'
    + '        super.viewDidLoad()\n\n'
    + '        self.webView.navigationDelegate = self\n'
    + '    }\n'
    + '    func didFinish() {\n'
    + '        SFSafariExtensionManager.getStateOfSafariExtension(withIdentifier: x) { (state, error) in\n'
    + '            guard let state = state, error == nil else {\n'
    + '                // Insert code to inform the user that something went wrong.\n'
    + '                return\n'
    + '            }\n'
    + '        }\n'
    + '    }\n'
    + '    func userContentController() {\n'
    + '        SFSafariApplication.showPreferencesForExtension(withIdentifier: x) { error in\n'
    + '            guard error == nil else {\n'
    + '                // Insert code to inform the user that something went wrong.\n'
    + '                return\n'
    + '            }\n'
    + '        }\n'
    + '    }\n}\n';

  test('两处 stub 都被替换成回调页面，且各自用对了 self', () => {
    const dir = tmpdir();
    fs.writeFileSync(path.join(dir, 'ViewController.swift'), TEMPLATE_SAFARI);
    const notes = patchViewController(dir);
    ok(/safari failure feedback patched \(2 stubs\)/.test(notes), notes);
    const out = fs.readFileSync(path.join(dir, 'ViewController.swift'), 'utf8');
    eq((out.match(/MT_PREFS_FAILED/g) || []).length, 2, '两处都要打上');
    eq((out.match(/Insert code to inform/g) || []).length, 0, '模板的 stub 注释不该还留着');
    // 第一处在 didFinish 的闭包里（webView 是入参），第二处在 handler 里（要 self.）
    ok(/\{ webView\.evaluateJavaScript/.test(out), 'getState 那处应当直接用 webView');
    ok(/\{ self\.webView\.evaluateJavaScript/.test(out), 'showPreferences 那处应当用 self.webView');
    // 失败时传 false —— 页面据此收起按钮、退回三步文字
    eq((out.match(/show\('mac', false, false\)/g) || []).length, 2, '两处都要传 false');
  });

  test('再跑一次不重复打（幂等）', () => {
    const dir = tmpdir();
    fs.writeFileSync(path.join(dir, 'ViewController.swift'), TEMPLATE_SAFARI);
    patchViewController(dir);
    const once = fs.readFileSync(path.join(dir, 'ViewController.swift'), 'utf8');
    const notes = patchViewController(dir);
    ok(/safari failure feedback already patched/.test(notes), notes);
    eq(once, fs.readFileSync(path.join(dir, 'ViewController.swift'), 'utf8'), '第二次必须一字不改');
  });

  test('模板形状不认识时报错，而不是默默跳过', () => {
    const dir = tmpdir();
    fs.writeFileSync(path.join(dir, 'ViewController.swift'),
      TEMPLATE_SAFARI.replace('// Insert code to inform the user that something went wrong.\n                return\n            }\n        }\n    }\n    func userContentController', 'return } } }\n    func userContentController'));
    const notes = patchViewController(dir);
    ok(/✗ safari failure feedback/.test(notes),
      '只剩一处 stub 时必须显式报错 —— 认不出的形状是错误，不是缺席');
  });
});

describe('sync-app-assets: the host app must stay UA-anonymous', () => {
  // 2026-08-28: this is the ONLY thing that tells an App session apart from a Safari
  // extension session server-side, and it exists by omission, not by design.
  //
  // A bare WKWebView sends `…AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148`
  // — no `Version/`, no `Safari/`. Real Safari always sends both. That gap is what
  // let `auth.sessions.user_agent` prove all 40 external accounts arrived through the
  // iOS/macOS app and none through a browser extension.
  //
  // Setting `applicationNameForUserAgent` — the ordinary, tidy-looking thing to do —
  // appends a token and makes the two indistinguishable. Nothing else would go red:
  // the app keeps working, and the loss is silent and retroactive. Hence a gate.
  //
  // This guards the accident; it does not make it reliable. The real fix is a `client`
  // field in the chunk header, which costs a Gate B privacy-copy round — see #175.
  const NEEDLE = 'applicationNameForUserAgent';

  test('the patcher never sets applicationNameForUserAgent', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'scripts', 'sync-app-assets.js'), 'utf8');
    ok(!src.includes(NEEDLE),
      'sync-app-assets.js 设了 ' + NEEDLE + ' —— 这会让 App 与 Safari 扩展的 UA 无法区分，'
      + '服务端的客户端归因当场静默失效。真要加客户端标识走 #175（chunk header client 字段）。');
  });

  test('a patched ViewController still carries no app name', () => {
    const dir = tmpdir();
    fs.writeFileSync(path.join(dir, 'ViewController.swift'), TEMPLATE_UA);
    patchViewController(dir);
    const out = fs.readFileSync(path.join(dir, 'ViewController.swift'), 'utf8');
    ok(!out.includes(NEEDLE), '补丁后的 ViewController 不能带 ' + NEEDLE);
    // The media patch rebuilds the web view from a fresh configuration; that rebuild
    // is exactly where an app name would be most tempting to add.
    ok(out.includes('WKWebViewConfiguration()'), '前提没变：媒体补丁确实重建了 webView');
  });

  const TEMPLATE_UA = 'import WebKit\n\nclass ViewController {\n'
    + '    func viewDidLoad() {\n'
    + '        super.viewDidLoad()\n\n'
    + '        self.webView.navigationDelegate = self\n'
    + '    }\n}\n';
});

describe('sync-app-assets: 实时字幕 Mac 悬浮字幕条（learning-design §9.8）', () => {
  const R = path.resolve(__dirname, '..');
  const tpl = fs.readFileSync(path.join(R, 'app', 'native', 'subtitle-bar.swift'), 'utf8');
  const audio = fs.readFileSync(path.join(R, 'app', 'native', 'audio-bridge.swift'), 'utf8');
  const sync = fs.readFileSync(path.join(R, 'scripts', 'sync-app-assets.js'), 'utf8');
  const { BLOCKS } = require('../scripts/sync-app-assets.js');
  const code = (src) => src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  test('登记成标记块；整份只在 macOS 编译 —— 共享的 ViewController.swift 两个平台都编', () => {
    ok(BLOCKS.some((b) => b.src === 'subtitle-bar.swift' && b.name === 'mt-subtitle-bar'), 'BLOCKS 里有 mt-subtitle-bar');
    const body = code(tpl).trim();
    ok(body.startsWith('#if os(macOS)') && body.endsWith('#endif'), '整份包在 #if os(macOS) … #endif 里');
  });
  test('形状照尖刺 S4：不抢焦点、盖在全屏视频上、跨 Space、App 在后台也不消失', () => {
    ok(/\.nonactivatingPanel/.test(tpl) && /\.fullScreenAuxiliary/.test(tpl) && /\.canJoinAllSpaces/.test(tpl), 'NSPanel 三件套');
    ok(/hidesOnDeactivate = false/.test(tpl), 'App 失焦时条不藏');
    ok(/level = \.floating/.test(tpl), '浮在普通窗口之上');
  });
  test('零文案：字面量只有协议 id、{pct} 占位符、省略号与 A− / A+ 两个字形', () => {
    const strings = code(tpl).match(/"[^"]*"/g) || [];
    const allowed = new Set(['""', '"labels"', '"state"', '"controls"', '"menu"', '"fontScale"', '"opacity"', '"clickThrough"',
      '"orig"', '"tr"', '"partial"', '"pct"',
      '"listening"', '"tr-failed"', '"downloading"', '"reconnecting"', '"denied"', '"paused"', '"silence"', '"socket"', '"silent"', '"silence-permission"',
      '"pause"', '"resume"', '"play"', '"main"', '"end"', '"openSettings"', '"showMain"', '"cancelClickThrough"',
      '"font-down"', '"font-up"', '"open-app"', '"{pct}"', '"…"', '"A−"', '"A+"',
      '"x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"']);
    for (const lit of strings) ok(allowed.has(lit), `字幕条里出现了非协议字符串（可能是文案）：${lit}`);
  });
  test('静音门暂停且没听到过声音（silence-permission）：行内出口是「打开系统设置」，不是「继续」（决定 10 修订二补 O2）', () => {
    const body = code(tpl);
    const m = /if ([^{]*)\{\s*let title = controlLabels\["openSettings"\]/.exec(body);
    ok(m && /state == "silence-permission"/.test(m[1]), '打开系统设置那一支的条件里有 silence-permission');
    const r = /\} else if ([^{]*)\{\s*let title = controlLabels\["resume"\]/.exec(body);
    ok(r && !/silence-permission/.test(r[1]), '「继续」那一支不含 silence-permission');
    ok(!/private var listening: Bool \{[^}]*silence-permission/.test(body), 'silence-permission 是停下的态，不算在听（悬停控件显示「继续」）');
  });
  test('条上按钮发的命令，listen.js 都认（§9.8 协议补充决定 9）', () => {
    const listen = fs.readFileSync(path.join(R, 'app', 'listen.js'), 'utf8');
    for (const cmd of ['font-up', 'font-down', 'end', 'pause', 'play']) {
      ok(tpl.includes(`"${cmd}"`), `条会发 ${cmd}`);
      ok(listen.includes(`'${cmd}'`), `listen.js 的 onNative 认 ${cmd}`);
    }
  });
  test('会话中关窗 = 隐藏、点 Dock 找回（协议补充决定 14）', () => {
    ok(sync.includes('MTSubtitleBar.sessionActive'), 'applicationShouldTerminateAfterLastWindowClosed 要读会话');
    ok(sync.includes('applicationShouldHandleReopen'), '点 Dock 找回主窗口');
    ok(/sender\.orderOut\(nil\)\s*\n\s*return false/.test(tpl), '关闭守卫：隐藏而不关');
    ok(/forwardingTarget\(for aSelector/.test(tpl), '守卫把其余委托方法转给原来的窗口委托（storyboard 里是窗口控制器）');
  });
  test('桥：caps-probe 只在 macOS 回；系统声音要 14.4、排除本进程；等授权 2 s 报、90 s 按拒绝', () => {
    const body = code(audio);
    const at = body.indexOf('private func capsProbe');
    ok(at > 0, '有 capsProbe');
    const fn = body.slice(at, body.indexOf('\n    }\n', at));
    ok(fn.includes('#if os(macOS)') && fn.indexOf('"audio-caps"') > fn.indexOf('#if os(macOS)'), 'Mac 按系统版本回 ok / os');
    const iosPart = fn.slice(fn.indexOf('#else'));
    ok(fn.includes('#else') && /"system": "unsupported"/.test(iosPart), 'iOS 一期整体到位后回 system:unsupported（协议补充决定 15）—— 回了 iPhone 首页才出现入口');
    ok(/#available\(macOS 14\.4, \*\)/.test(body), '系统声音守 macOS 14.4');
    ok(/stereoGlobalTapButExcludeProcesses/.test(body), '排除本进程（尖刺 S1b）');
    ok(/"waiting-permission"/.test(body) && /\.now\(\) \+ 2\)/.test(body) && /\.now\(\) \+ 90\)/.test(body), '2 s 报等待授权、90 s 超时按拒绝');
  });
  test('全零帧 ⇒ 不中断的 silent，首个非零帧 ⇒ sound，不再判 denied（协议补充决定 10 修订二，全回归 F13）', () => {
    const body = code(audio);
    ok(/"state": "silent", "reason": "zero-frames"/.test(body), '3 秒全零且别的进程开着输出 ⇒ mic-state silent / zero-frames');
    ok(/"state": "sound"/.test(body), 'silent 之后第一个非零帧 ⇒ mic-state sound');
    ok(!/"state": "denied", "reason": "zero-frames"/.test(body), '零帧不再判 denied：权限已给、开始瞬间静音曾被误判（F13 真机）');
    ok(!/onSilentDenial/.test(body), '零帧回调不再叫 denial，也不再 micStop 撤采集');
    ok(/kAudioProcessPropertyIsRunningOutput/.test(body), '第二个条件：有别的进程开着输出');
    ok(/pid != me/.test(body), '排除本进程');
    ok(/now - zeroSince >= 3/.test(body), '全零要连续 3 秒');
  });
  test('条上的按钮字走 attributedTitle 白字（M27：contentTintColor 对 recessed / inline 无效）', () => {
    const body = code(tpl);
    ok(/attributedTitle = NSAttributedString/.test(body) && /\.foregroundColor: NSColor\.white/.test(body), '有白字 attributedTitle');
    ok(!/contentTintColor/.test(body), '不再依赖 contentTintColor');
    ok(!/\.title = /.test(body), '不直接赋 title（会把颜色冲掉）');
    ok(/rangeOfCharacter\(from: \.alphanumerics\)/.test(body), '只有标点的半句不显示');
  });
  test('plist：系统录音权限说明只给 macOS App（Gate I）', () => {
    ok(/key: 'NSAudioCaptureUsageDescription', only: 'macOS \(App\)'/.test(sync), 'PLIST_KEYS 里有只给 macOS 的那一行');
  });
});

describe('sync-app-assets: 实时字幕 iPhone 画中画字幕窗（learning-design §9.8 协议补充决定（三））', () => {
  const R = path.resolve(__dirname, '..');
  const tpl = fs.readFileSync(path.join(R, 'app', 'native', 'subtitle-pip.swift'), 'utf8');
  const audio = fs.readFileSync(path.join(R, 'app', 'native', 'audio-bridge.swift'), 'utf8');
  const sync = fs.readFileSync(path.join(R, 'scripts', 'sync-app-assets.js'), 'utf8');
  const listen = fs.readFileSync(path.join(R, 'app', 'listen.js'), 'utf8');
  const { BLOCKS } = require('../scripts/sync-app-assets.js');
  const code = (src) => src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  test('登记成标记块；整份只在 iOS 编译', () => {
    ok(BLOCKS.some((b) => b.src === 'subtitle-pip.swift' && b.name === 'mt-subtitle-pip'), 'BLOCKS 里有 mt-subtitle-pip');
    const body = code(tpl).trim();
    ok(body.startsWith('#if os(iOS)') && body.endsWith('#endif'), '整份包在 #if os(iOS) … #endif 里');
  });
  test('形状照尖刺 S7：自绘帧进画中画、离开 App 自动浮出', () => {
    ok(/AVPictureInPictureController\(contentSource: \.init\(sampleBufferDisplayLayer:/.test(tpl), 'sampleBufferDisplayLayer 做来源');
    ok(/canStartPictureInPictureAutomaticallyFromInline = true/.test(tpl), '离开 App 时自动浮出');
    ok(/isUserInteractionEnabled = false/.test(tpl), '预览不接触摸（下面是网页）');
    ok(/didTransitionToRenderSize/.test(tpl) && /renderSize = /.test(tpl), '按系统回报的新尺寸重画（I5）');
  });
  test('零文案：字面量只有协议 id、{pct} 占位符与省略号', () => {
    const strings = code(tpl).match(/"[^"]*"/g) || [];
    const allowed = new Set(['""', '"labels"', '"state"', '"orig"', '"tr"', '"partial"', '"pct"', '"rect"', '"x"', '"y"', '"w"', '"h"',
      '"listening"', '"tr-failed"', '"downloading"', '"reconnecting"', '"play"', '"pause"',
      '"inline"', '"floating"', '"closed"', '"reason"', '"not-active"', '"failed"', '"{pct}"', '"…"',
      '"pip"', '"title"', '"hint"', '"close"', '"history"']);
    for (const lit of strings) ok(allowed.has(lit), `画中画字幕窗里出现了非协议字符串（可能是文案）：${lit}`);
  });
  test('系统控件回页面（19）、浮出只在前台活跃时成（20）', () => {
    ok(/setPlaying playing: Bool\) \{\s*onRemote\?\(playing \? "play" : "pause"\)/.test(tpl), '⏸ / ▶ = remote pause / play');
    ok(/activationState == \.foregroundActive/.test(tpl) && /"not-active"/.test(tpl), '非前台活跃 ⇒ closed / not-active，不硬启动');
    ok(/restoring \? "inline" : "closed"/.test(tpl), '回到 App = inline，点 ✕ = closed');
    // 用户 2026-09-14 15 Pro 手测后裁定的三处
    ok(/renderSize = CGSize\(width: 640, height: 800\)/.test(tpl), '小窗默认 4:5 偏竖（宽高比由帧决定）');
    ok(/let u = size\.width \* 0\.5625/.test(tpl) && !/size\.height \* 0\./.test(tpl), '字号按宽度算：窗口越高放的句子越多（按高度算只会把字放大）');
    ok(/requiresLinearPlayback = false/.test(tpl) && /skipInterval\.seconds < 0/.test(tpl) && /historyOffset/.test(tpl), '借系统后退 / 前进按钮翻看历史');
    ok(/lines\.isEmpty && partial == nil/.test(tpl) && /pipLabels\["hint"\]/.test(tpl), '空窗画说明，不是一块黑');
    ok(/size\.height - block\) \/ 2/.test(tpl) && /u \* 0\.138/.test(tpl), '空窗说明垂直居中、字号不随字幕缩小（按宽度算后曾缩成一小条挤在顶上）');
    ok(listen.includes("subtitle_pip_hint") && listen.includes("subtitle_bar_listening_mic"), '页面把小窗说明与 iPhone 版「正在听」传给原生');
    ok(/guard let c = pip else \{ onWindow\?\(\["state": "closed", "reason": "failed"\]\); return \}/.test(tpl), '没有画中画可用时浮出也要回一句（模拟器实测：不支持时控制器是空的，曾静默返回）');
    ok(/isPictureInPictureSupported\(\)/.test(tpl), '不支持画中画时不建控制器');
    ok(listen.includes("msg.type === 'subtitle-window'") && listen.includes("pipWindow === 'closed'"), '页面据 subtitle-window 显示「浮出字幕窗」');
  });
  test('字幕档会话不带蓝牙、所有重申按同一个 profile（16）；耳机判据（21）', () => {
    const body = code(audio);
    ok(!/options: \[\.defaultToSpeaker, \.allowBluetooth, \.mixWithOthers\]\)/.test(body), '不再有硬写对话档选项的 setCategory');
    ok((body.match(/options: recordOptions/g) || []).length >= 3, '建会话 / 起引擎 / playing-state 重申都读 recordOptions');
    ok(/recordProfile == "subtitle" \? \[\.mixWithOthers, \.defaultToSpeaker\]/.test(body), '字幕档 = mixWithOthers + defaultToSpeaker，不带 allowBluetooth');
    ok(/\.headphones, \.bluetoothA2DP, \.bluetoothLE, \.bluetoothHFP/.test(body) && /"reason": "headphones"/.test(body), '输出走耳机 / 蓝牙 ⇒ headphones');
    ok(/onRouteChange[\s\S]{0,120}checkHeadphones\(\)/.test(body), '路由变化时再判');
  });
  test('麦克风权限说明点名 iPhone「实时字幕」（Gate I）', () => {
    ok(/const MIC_TEXT = '[^']*实时字幕/.test(sync), 'NSMicrophoneUsageDescription 要提实时字幕（一期听外放用的是麦克风）');
  });
});

describe('sync-app-assets: macOS 文件面板桥（§9.7 文档翻译 D5）', () => {
  const R = path.resolve(__dirname, '..');
  const tpl = fs.readFileSync(path.join(R, 'app', 'native', 'file-panel-bridge.swift'), 'utf8');
  const sync = fs.readFileSync(path.join(R, 'scripts', 'sync-app-assets.js'), 'utf8');
  test('模板登记成标记块，且 attach 被打进 ViewController', () => {
    ok(/name: 'mt-file-panel', src: 'file-panel-bridge.swift'/.test(sync), 'BLOCKS 里有 mt-file-panel');
    ok(sync.includes("'MTFilePanel.attach(self.webView)'"), 'attach 行由 app:sync 打进去 —— 漏了它 uiDelegate 就没人设');
  });
  test('取消也调 completionHandler(nil)：漏了 <input> 就永远卡住、再点不弹', () => {
    ok(/runOpenPanelWith parameters: WKOpenPanelParameters/.test(tpl), '实现的是 runOpenPanel');
    ok(/completionHandler\(response == \.OK \? panel\.urls : nil\)/.test(tpl), '取消分支回 nil，不是空数组');
    ok(/#if os\(macOS\)/.test(tpl), 'NSOpenPanel 只在 macOS 编译 —— 共享的 ViewController.swift 两个平台都编');
  });
  // 2026-09-13 用户报障：中国版设置页「去开通 ↗」「还没有 key？去 通义千问 申请 ↗」点了没反应。
  // 链接是共用组件里的 <a target="_blank">，扩展里对，App 的 WKWebView 没有 createWebViewWith ⇒ 哑。
  test('新窗口链接交系统浏览器：只接用户点的 https、两个平台、永不开第二个 WebView', () => {
    // 找声明，不找单词：文件头的注释里也提到了 createWebViewWith。
    const at = tpl.indexOf('createWebViewWith configuration: WKWebViewConfiguration');
    ok(at > 0, '实现了 createWebViewWith —— 没有它，<a target="_blank"> 在 App 里点了什么都不发生');
    const fn = tpl.slice(tpl.lastIndexOf('func webView', at), tpl.indexOf('\n    }\n', at) + 6);
    ok(/navigationAction\.targetFrame == nil/.test(fn), '只处理新窗口');
    ok(/navigationType == \.linkActivated/.test(fn), '只接用户亲手点的链接 —— 脚本 window.open 走 open-url 桥的放行名单');
    ok(/scheme\?\.lowercased\(\) == "https"/.test(fn), '只开 https');
    ok(/UIApplication\.shared\.open\(url\)/.test(fn) && /NSWorkspace\.shared\.open\(url\)/.test(fn), '两个平台都交系统浏览器');
    eq((fn.match(/return nil/g) || []).length, 2, '两条出口都返回 nil：永远不在 App 里开第二个 WebView');
    ok(at < tpl.indexOf('runOpenPanelWith'), '放在 #if os(macOS) 门之外 —— iOS 同样需要');
  });
});

describe('sync-app-assets: open-url 桥放行名单 v4（从注册表生成）', () => {
  const ANCHOR = '#if os(macOS)\n        if (message.body as! String != "open-preferences") {';
  const VC = 'import WebKit\n\nclass ViewController {\n'
    + '    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {\n'
    + ANCHOR + '\n            return\n        }\n#endif\n    }\n}\n';
  const PROVIDERS = require('../build/providers.config.js');
  const keyHosts = (flavor) => {
    const out = new Set();
    for (const p of PROVIDERS) {
      if (!p.keyUrl || (Array.isArray(p.flavors) && !p.flavors.includes(flavor))) continue;
      const u = typeof p.keyUrl === 'string' ? p.keyUrl : p.keyUrl[flavor];
      if (u) out.add(new URL(u).hostname);
    }
    return [...out];
  };
  function patched(proj, src = VC) {
    const dir = path.join(tmpdir(), proj, 'Shared (App)');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'ViewController.swift'), src);
    const notes = patchViewController(dir);
    return { dir, notes, out: fs.readFileSync(path.join(dir, 'ViewController.swift'), 'utf8') };
  }

  test('每个 flavor 的名单覆盖注册表里该 flavor 的全部 keyUrl 主机；境外地址不进中国版', () => {
    const g = patched('safari-project');
    const c = patched('safari-project-china');
    ok(/open-url bridge patched \(v4/.test(g.notes), g.notes);
    ok(keyHosts('global').length > 0 && keyHosts('china').length > 0, '前提：两个 flavor 都有 keyUrl');
    for (const h of keyHosts('global')) ok(g.out.includes('host == "' + h + '"'), '国际版名单缺 ' + h);
    for (const h of keyHosts('china')) ok(c.out.includes('host == "' + h + '"'), '中国版名单缺 ' + h);
    ok(c.out.includes('host == "bailian.console.aliyun.com"'), '报障的那个地址（中国版「去开通」）');
    for (const h of keyHosts('global').filter((x) => !keyHosts('china').includes(x))) {
      ok(!c.out.includes('"' + h + '"'), '境外平台地址不该进中国版：' + h);
    }
  });

  test('第二次一字不改；旧 v3 块整段换成 v4，只剩一个标记', () => {
    const first = patched('safari-project');
    const again = patchViewController(first.dir);
    ok(/open-url bridge already current \(v4\)/.test(again), again);
    eq(fs.readFileSync(path.join(first.dir, 'ViewController.swift'), 'utf8'), first.out, '第二次必须一字不改');
    const v3 = VC.replace(ANCHOR, '// MT_OPEN_URL v3 — patched by scripts/sync-app-assets.js\n        if oldV3Block {}\n        ' + ANCHOR);
    const up = patched('safari-project', v3);
    ok(/open-url bridge v3 block removed/.test(up.notes), up.notes);
    eq((up.out.match(/\/\/ MT_OPEN_URL/g) || []).length, 1, '只剩 v4 一个标记');
    ok(!up.out.includes('oldV3Block'), '旧块一个字都不剩');
  });
});

describe('sync-app-assets: audio bridge block (§9.5)', () => {
  const VC = 'import WebKit\n\nclass ViewController {}\n';
  const TPL = 'final class MTAudioBridge {\n    // v1\n}\n';

  test('first run: inserted after the import anchor, exactly one marker pair', () => {
    const { swift, note } = patchAudioBridgeSwift(VC, TPL);
    match(note, /inserted/);
    eq((swift.match(/BEGIN mt-audio-bridge/g) || []).length, 1);
    eq((swift.match(/END mt-audio-bridge/g) || []).length, 1);
    ok(swift.includes('final class MTAudioBridge'), '模板原文进去了');
    ok(swift.indexOf('BEGIN mt-audio-bridge') > swift.indexOf('import WebKit'),
      '锚在 import 之后 —— 模板自己的 import 因此成为块的一部分，不用单独保幂等');
  });

  test('same template again: byte-identical, and it says so', () => {
    const once = patchAudioBridgeSwift(VC, TPL).swift;
    const again = patchAudioBridgeSwift(once, TPL);
    eq(again.swift, once, '第二次必须一字不改');
    match(again.note, /already current/);
  });

  test('template evolved ⇒ the WHOLE block is replaced, not appended', () => {
    const once = patchAudioBridgeSwift(VC, TPL).swift;
    const { swift, note } = patchAudioBridgeSwift(once, 'final class MTAudioBridge {\n    // v2\n}\n');
    match(note, /replaced/);
    eq((swift.match(/BEGIN mt-audio-bridge/g) || []).length, 1, '仍然只有一对标记');
    ok(swift.includes('// v2') && !swift.includes('// v1'),
      '旧版本一个字都不能剩 —— 否则 build 38 的 Swift 会活到永远');
  });

  test('hand-edits inside the block are overwritten (the repo file is the source)', () => {
    const once = patchAudioBridgeSwift(VC, TPL).swift;
    const tampered = once.replace('// v1', '// someone edited the Xcode copy');
    const { swift } = patchAudioBridgeSwift(tampered, TPL);
    ok(!swift.includes('someone edited'), 'app/native/audio-bridge.swift 才是源');
  });

  test('half a marker pair ⇒ refuse, never append a second copy', () => {
    const once = patchAudioBridgeSwift(VC, TPL).swift;
    const broken = once.replace('// ─── END mt-audio-bridge ───', '');
    const { swift, note } = patchAudioBridgeSwift(broken, TPL);
    eq(swift, broken, '原样返回');
    match(note, /^✗/);
    eq((swift.match(/BEGIN mt-audio-bridge/g) || []).length, 1,
      '两个 MTAudioBridge 是编译期重复定义，错误信息离原因十万八千里');
  });

  test('no import anchor ⇒ named failure, not a silent pass', () => {
    const { swift, note } = patchAudioBridgeSwift('class ViewController {}\n', TPL);
    eq(swift, 'class ViewController {}\n');
    match(note, /^✗.*import WebKit/);
  });

  // The shipped template itself, not a stand-in: these are the properties the macOS
  // target's compiler enforces, and a missing #if is a build failure, not a bug report.
  describe('the real app/native/audio-bridge.swift', () => {
    const tpl = fs.readFileSync(path.join(__dirname, '..', 'app', 'native', 'audio-bridge.swift'), 'utf8');

    test('AVAudioSession only ever appears inside #if os(iOS)', () => {
      // AVAudioSession does not exist on macOS at all — an unguarded mention is a
      // compile error in the macOS target, which is half of this feature's surface.
      for (const line of tpl.split('\n')) {
        if (!line.includes('AVAudioSession')) continue;
        if (line.trim().startsWith('//')) continue;      // 注释里提它没有代价
        ok(inIOSGuard(tpl, line), `未被 #if os(iOS) 包住：${line.trim()}`);
      }
    });

    // 这一行曾经是无条件的 —— 一个真缺陷（2026-08-25 调研时查出）。中断的定义就是
    // 「系统停用了我们的会话」（Apple 原文），所以 `.ended` 时它读起来天经地义：当然该
    // 重新激活一下。但 setActive(true) 是**抢占**（我们的类别是非混音的 .playback），
    // 而 shouldResume 为假时我们并不播 —— 净结果是占着一个活跃的会话却一声不出，最坏
    // 表现是**两边都没声**：刚开始播的别人被我们掐掉，我们自己不响，屏幕上没有任何变化。
    // 「读起来天经地义 + 症状无法归因」正是最该用测试钉死的那类代码。
    test('重新激活会话只发生在 shouldResume 为真时', () => {
      // 先剥注释：上面那段解释里就写着 `setActive(true)` 四个字，不剥的话断言会被
      // 自己的说明文字绊倒（第一次跑就是这么红的）。
      const body = tpl.slice(tpl.indexOf('func onInterruption'), tpl.indexOf('func onRouteChange'))
        .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
      ok(body.includes('setActive(true)'),
        'shouldResume 那条路仍然要重新激活 —— 来电挂断后的自动续播靠它');
      ok(body.indexOf('if shouldResume') >= 0
         && body.indexOf('if shouldResume') < body.indexOf('setActive(true)'),
        '无条件重新激活会打断刚开始播的别人，而我们自己不出声');
      eq((body.match(/setActive\(true\)/g) || []).length, 1, '只该有一处');
    });

    test('the channel name matches what the install patch and the JS use', () => {
      match(tpl, /static let channel = "mtAudio"/);
      const sync = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'sync-app-assets.js'), 'utf8');
      ok(sync.includes('MTAudioBridge.shared.install'), 'sync 脚本装的是同一个类');
      const js = fs.readFileSync(path.join(__dirname, '..', 'app', 'native-audio.js'), 'utf8');
      ok(js.includes('mtAudio'), 'JS 侧用的是同一个通道名');
    });

    // Live Activity 的属性定义在**两个 target 各编译一份**（App 与 Widget 扩展）。
    // 字段对不上时不会编译报错 —— 只会在运行时解码失败、岛上什么都不显示，
    // 而「岛上什么都没有」正是这个功能本来要修的症状，查起来会绕一大圈。
    test('MTPodcastAttributes 两处逐字一致 —— 对不上时不报错，只是岛上空着', () => {
      const widget = fs.readFileSync(
        path.join(__dirname, '..', 'app', 'native', 'widget', 'LiveActivity.swift'), 'utf8');
      const grab = (src) => {
        const m = src.match(/struct MTPodcastAttributes[\s\S]*?\n\}/);
        ok(m, 'MTPodcastAttributes 没找到');
        // 剥掉整行注释**和行尾注释** —— 比对的是字段结构，不是说明文字。
        // （widget 那份在字段后面标了「原句 / 译句 / 第 i / n 张」，那些注释有价值，
        // 不该为了让断言通过而删掉。）
        return m[0].split('\n').map((l) => l.replace(/\/\/.*$/, '').trim())
          .filter(Boolean).join('\n');
      };
      eq(grab(tpl), grab(widget), '桥与 widget 里的属性定义不一致');
    });

    test('it carries no user-visible copy — every word on the lock screen comes from JS', () => {
      // A string literal in Swift never reaches _locales/, so it would never be
      // translated and never follow a product rename. Only keys/ids may be literals.
      const strings = tpl.split('\n')
        .filter((l) => !l.trim().startsWith('//'))
        .join('\n')
        .match(/"[^"]*"/g) || [];
      const allowed = new Set(['""', '"mtAudio"', '"session-start"', '"session-stop"',
        '"now-playing"', '"playing-state"', '"session-ready"', '"session-failed"',
        '"remote"', '"interrupt"', '"route"', '"device-lost"', '"begin"', '"end"',
        '"play"', '"pause"', '"toggle"', '"next"', '"previous"', '"type"', '"reason"',
        '"phase"', '"resume"', '"command"', '"change"', '"title"', '"subtitle"',
        '"album"', '"index"', '"count"', '"playing"',
        '"platform"', '"suspends"', '"ios"', '"macos"',
        '"record-mode"', '"on"',   // §9.6 实时听译：可录音的音频会话请求
        '"mic-start"', '"mic-stop"', '"mic-pcm"', '"mic-state"', '"rate"', '"b64"', '"state"',   // §9.6 原生采集
        '"deliver"', '"level"', '"mic-level"', '"rms"',   // §9.6.1 本机路：PCM 留在原生，只过电平
        '"caps-probe"', '"subtitle-config"', '"subtitle-show"', '"subtitle-state"', '"subtitle-float"', '"subtitle-hide"',   // §9.8 实时字幕（字幕条文字全由 JS 传）
        '"audio-caps"', '"sources"', '"mic"', '"system"', '"ok"', '"os"', '"unsupported"', '"broadcast"', '"source"',   // §9.8 能力回话与声音来源
        '"waiting"', '"waiting-permission"', '"timeout"', '"tick"', '"t"',   // §9.8 协议补充决定 10、13
        '"zero-frames"', '"silent"', '"sound"',   // §9.8 协议补充决定 10 修订二（全零帧 = 不中断的提示，F13）
        '"profile"', '"conv"', '"headphones"', '"subtitle-window"',   // §9.8 协议补充决定（三）16、19、21（iPhone 一期）
        '"granted"', '"denied"', '"failed"', '"interrupted"', '"ended"', '"input-format"', '"converter"',
        '"now-playing-artwork"', '"image"', '"artwork-size"', '"AppIcon"',
        '","', '"w"', '"h"',
        '"window.NativeAudio && window.NativeAudio._fromNative(\\(json))"']);
      for (const lit of strings) {
        ok(allowed.has(lit), `原生侧出现了非协议字符串（可能是文案）：${lit}`);
      }
    });
  });
});

// `#if os(iOS)` … `#endif` containment, by line. Crude on purpose: the property being
// asserted is "this line sits inside an iOS guard", and a nesting-aware parser would
// be more code than the thing it checks.
function inIOSGuard(src, line) {
  const stack = [];
  for (const l of src.split('\n')) {
    const t = l.trim();
    if (/^#if os\(iOS\)$/.test(t)) { stack.push(true); continue; }
    if (/^#if\b/.test(t)) { stack.push(false); continue; }
    // `#else` flips the branch: the macOS half of an os(iOS) conditional is NOT
    // inside the iOS guard, and treating it as if it were would let an
    // AVAudioSession call slip into the macOS build (where the type does not exist).
    if (/^#else$/.test(t)) { if (stack.length) stack[stack.length - 1] = !stack[stack.length - 1]; continue; }
    if (/^#endif$/.test(t)) { stack.pop(); continue; }
    if (l === line) return stack.some(Boolean);
  }
  return false;
}

describe('sync-app-assets: Info.plist declarations (§9.4 mic / §9.5 background audio)', () => {
  const PLIST = '<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0">\n<dict>\n'
    + '\t<key>SFSafariWebExtensionConverterVersion</key>\n\t<string>26.6</string>\n'
    + '</dict>\n</plist>\n';

  function tree() {
    const dir = tmpdir();
    for (const t of ['iOS (App)', 'macOS (App)', 'iOS (Extension)', 'macOS (Extension)', 'Shared (App)']) {
      fs.mkdirSync(path.join(dir, t), { recursive: true });
      fs.writeFileSync(path.join(dir, t, 'Info.plist'), PLIST);
    }
    return dir;
  }
  const read = (dir, t) => fs.readFileSync(path.join(dir, t, 'Info.plist'), 'utf8');

  test('UIBackgroundModes lands in the iOS App target only', () => {
    const dir = tree();
    patchInfoPlists(path.join(dir, 'Shared (App)'));
    match(read(dir, 'iOS (App)'), /<key>UIBackgroundModes<\/key>[\s\S]*<string>audio<\/string>/);
    // macOS is never suspended, so it needs nothing here — and a macOS app declaring a
    // background mode it cannot use is something review asks about.
    ok(!read(dir, 'macOS (App)').includes('UIBackgroundModes'), 'macOS App 不该有');
    ok(!read(dir, 'iOS (Extension)').includes('UIBackgroundModes'), '扩展 target 不该有');
    ok(!read(dir, 'macOS (Extension)').includes('UIBackgroundModes'), '扩展 target 不该有');
  });

  test('NSSupportsLiveActivities 也只进 iOS App —— 没有它灵动岛静默不出现', () => {
    const dir = tree();
    patchInfoPlists(path.join(dir, 'Shared (App)'));
    match(read(dir, 'iOS (App)'), /<key>NSSupportsLiveActivities<\/key>\s*<true\/>/);
    ok(!read(dir, 'macOS (App)').includes('NSSupportsLiveActivities'), 'macOS 没有灵动岛');
  });

  test('the microphone key still goes to BOTH app targets (§9.4 unchanged)', () => {
    const dir = tree();
    patchInfoPlists(path.join(dir, 'Shared (App)'));
    for (const t of ['iOS (App)', 'macOS (App)']) {
      ok(read(dir, t).includes('NSMicrophoneUsageDescription'), t);
    }
  });

  test('idempotent: each key appears exactly once after two runs', () => {
    const dir = tree();
    patchInfoPlists(path.join(dir, 'Shared (App)'));
    const once = read(dir, 'iOS (App)');
    patchInfoPlists(path.join(dir, 'Shared (App)'));
    const twice = read(dir, 'iOS (App)');
    eq(once, twice, '第二次必须一字不改');
    eq((twice.match(/<key>UIBackgroundModes<\/key>/g) || []).length, 1);
    eq((twice.match(/<key>NSMicrophoneUsageDescription<\/key>/g) || []).length, 1);
  });

  test('the result is still valid property-list XML', () => {
    // Text injection into a plist is this route's one real risk, and `plutil -lint` is
    // the only thing that actually knows. Skip off darwin rather than pretend.
    if (process.platform !== 'darwin') return;
    const dir = tree();
    patchInfoPlists(path.join(dir, 'Shared (App)'));
    const { execFileSync } = require('child_process');
    for (const t of ['iOS (App)', 'macOS (App)']) {
      execFileSync('plutil', ['-lint', path.join(dir, t, 'Info.plist')], { stdio: 'pipe' });
    }
  });

  test('a key already present with a STALE string value is updated, not skipped', () => {
    // 2026-09-07：麦克风文案改了措辞（Gate E），而工程里的 plist 还是旧话 —— 模拟器权限
    // 弹窗里看到的正是旧文案。「已存在就跳过」对数组/布尔键是对的，对文案不是。
    const mic = PLIST_KEYS.find((k) => k.key === 'NSMicrophoneUsageDescription');
    const stale = '<plist><dict>\n\t<key>NSMicrophoneUsageDescription</key>\n\t<string>老文案</string>\n</dict></plist>';
    const { xml, updated, note } = patchPlistXml(stale, [mic]);
    ok(xml.includes(mic.xml), '新文案该写进去');
    ok(!xml.includes('老文案'), '旧文案该被替换');
    eq(updated.length, 1);
    match(note, /updated NSMicrophoneUsageDescription/);
    // 再跑一次是幂等的
    const again = patchPlistXml(xml, [mic]);
    eq(again.updated.length, 0);
    eq(again.note, 'already current');
  });

  test('no </dict> anchor ⇒ says so instead of writing garbage', () => {
    const { xml, note } = patchPlistXml('<plist></plist>', PLIST_KEYS);
    eq(xml, '<plist></plist>');
    match(note, /^✗/);
  });
});

describe('sync-app-assets: macOS host window', () => {
  test('the template window becomes resizable and miniaturizable', () => {
    const { xml } = patchMacWindowXml(TEMPLATE_STORYBOARD);
    match(xml, /<windowStyleMask key="styleMask"[^/]*\bresizable="YES"/);
    match(xml, /<windowStyleMask key="styleMask"[^/]*\bminiaturizable="YES"/);
    // What the converter already set must survive — dropping `titled` loses the title
    // bar, and with it the close button.
    match(xml, /<windowStyleMask key="styleMask"[^/]*\btitled="YES"/);
    match(xml, /<windowStyleMask key="styleMask"[^/]*\bclosable="YES"/);
  });

  test('full screen is allowed, not merely left alone', () => {
    const { xml } = patchMacWindowXml(TEMPLATE_STORYBOARD);
    ok(!/fullScreenNone/.test(xml), 'fullScreenNone keeps the green button dead');
    match(xml, /<windowCollectionBehavior key="collectionBehavior" fullScreenPrimary="YES"\/>/);
  });

  // contentRect, the view and the web view all carry the template's content size, and IB
  // keeps them in step. Moving one and not the others is how you get a window with a grey
  // margin where the web view used to end.
  test('all three content rects move together, and screenRect does not', () => {
    const { xml } = patchMacWindowXml(TEMPLATE_STORYBOARD);
    eq((xml.match(/width="820" height="640"/g) || []).length, 3);
    ok(!/width="425" height="325"/.test(xml), 'a stale 425×325 rect would fight the new size');
    match(xml, /screenRect" x="0.0" y="0.0" width="1680" height="1027"/);
  });

  test('running twice changes nothing the second time', () => {
    const once = patchMacWindowXml(TEMPLATE_STORYBOARD).xml;
    const { xml: twice, note } = patchMacWindowXml(once);
    eq(twice, once);
    match(note, /already patched/);
  });

  // The #132 rule, applied to this patch: a shape we do not recognise must say so. The
  // note is the only place it can — app:sync prints it on the ✓ line.
  test('a storyboard without the styleMask says so instead of silently passing', () => {
    const { xml, note } = patchMacWindowXml('<document><scenes></scenes></document>');
    eq(xml, '<document><scenes></scenes></document>');
    match(note, /not found/);
  });

  test('a template at a different size still gets patched — the size is read, not assumed', () => {
    const resized = TEMPLATE_STORYBOARD.replace(/width="425" height="325"/g, 'width="500" height="400"');
    const { xml } = patchMacWindowXml(resized);
    eq((xml.match(/width="820" height="640"/g) || []).length, 3);
    match(xml, /\bresizable="YES"/);
  });
});

// The menu half of the same storyboard, again verbatim. The converter ships exactly two
// top-level menus — the app menu and Help — so ⌘V has no `paste:` item to claim it and
// does nothing. Note the two conventions this fixture pins: a bare `keyEquivalent` means
// ⌘, and the First Responder object id is generated per project (`Ady-hI-5gd` here).
const TEMPLATE_MENU = `<?xml version="1.0" encoding="UTF-8"?>
<document type="com.apple.InterfaceBuilder3.Cocoa.Storyboard.XIB">
    <scenes>
        <scene sceneID="JPo-4y-FX3">
            <objects>
                <application id="hnw-xV-0zn" sceneMemberID="viewController">
                    <menu key="mainMenu" title="Main Menu" systemMenu="main" id="AYu-sK-qS6">
                        <items>
                            <menuItem title="BelliedMonkey Translator" id="1Xt-HY-uBw">
                                <menu key="submenu" title="BelliedMonkey Translator" systemMenu="apple" id="uQy-DD-JDr">
                                    <items>
                                        <menuItem title="Quit BelliedMonkey Translator" keyEquivalent="q" id="4sb-4s-VLi">
                                            <connections>
                                                <action selector="terminate:" target="Ady-hI-5gd" id="Te7-pn-YzF"/>
                                            </connections>
                                        </menuItem>
                                    </items>
                                </menu>
                            </menuItem>
                            <menuItem title="Help" id="wpr-3q-Mcd">
                                <modifierMask key="keyEquivalentModifierMask"/>
                                <menu key="submenu" title="Help" systemMenu="help" id="F2S-fz-NVQ">
                                    <items/>
                                </menu>
                            </menuItem>
                        </items>
                    </menu>
                </application>
                <customObject id="Ady-hI-5gd" userLabel="First Responder" customClass="NSResponder" sceneMemberID="firstResponder"/>
            </objects>
        </scene>
    </scenes>
</document>
`;

// Paste is not cosmetic here. AppKit offers ⌘V to the main menu first, and only an item
// carrying `paste:` claims it; without one the keystroke arrives as a plain keyDown, and
// a plain keyDown does not paste. It bites on the app's FIRST screen — pasting an email
// and then a verification code is the whole of onboarding.
describe('sync-app-assets: macOS menu bar', () => {
  test('the editing commands exist and carry their standard shortcuts', () => {
    const { xml } = patchMacMenuXml(TEMPLATE_MENU);
    for (const [sel, key] of [['paste:', 'v'], ['copy:', 'c'], ['cut:', 'x'], ['selectAll:', 'a'], ['undo:', 'z']]) {
      match(xml, new RegExp(`keyEquivalent="${key}"[^>]*>\\s*(<[^>]*>\\s*)*<connections>\\s*<action selector="${sel}"`));
    }
    match(xml, /selector="delete:"/);
  });

  test('⌘W and ⌘M come too — same root cause, both dead in the template', () => {
    const { xml } = patchMacMenuXml(TEMPLATE_MENU);
    match(xml, /keyEquivalent="w"[\s\S]{0,200}?selector="performClose:"/);
    match(xml, /keyEquivalent="m"[\s\S]{0,200}?selector="performMiniaturize:"/);
    match(xml, /<menu key="submenu" title="Window" systemMenu="window"/);
  });

  // Redo is the one shortcut that is not a bare ⌘: dropping the mask would silently
  // bind it to ⌘Z and shadow Undo.
  test('Redo spells out its shift modifier', () => {
    const { xml } = patchMacMenuXml(TEMPLATE_MENU);
    match(xml, /title="Redo" keyEquivalent="Z"[\s\S]{0,120}?shift="YES" command="YES"/);
  });

  // The converter regenerates this id every time; a hardcoded one would wire every new
  // menu item to nothing on the next regeneration — and silently, since IB accepts it.
  test('the First Responder target is read from the file, not assumed', () => {
    const moved = TEMPLATE_MENU.replace(/Ady-hI-5gd/g, 'zZz-99-qQq');
    const { xml } = patchMacMenuXml(moved);
    match(xml, /<action selector="paste:" target="zZz-99-qQq"/);
    ok(!/Ady-hI-5gd/.test(xml), 'the old id must not survive as a literal');
  });

  test('what the converter already shipped survives', () => {
    const { xml } = patchMacMenuXml(TEMPLATE_MENU);
    match(xml, /<menuItem title="Help" id="wpr-3q-Mcd">/);
    match(xml, /systemMenu="apple"/);
    match(xml, /selector="terminate:"/);
  });

  test('running twice changes nothing the second time', () => {
    const once = patchMacMenuXml(TEMPLATE_MENU).xml;
    const { xml: twice, note } = patchMacMenuXml(once);
    eq(twice, once);
    match(note, /already patched/);
  });

  test('a storyboard without the Help anchor says so instead of silently passing', () => {
    const { xml, note } = patchMacMenuXml('<document><scenes></scenes></document>');
    eq(xml, '<document><scenes></scenes></document>');
    match(note, /not found/);
  });

  test('a storyboard with no wired action says so rather than guessing a target', () => {
    const noFR = TEMPLATE_MENU.replace(/<action selector="terminate:"[^>]*\/>/, '');
    const { xml, note } = patchMacMenuXml(noFR);
    eq(xml, noFR);
    match(note, /First Responder target not found/);
  });
});

describe('verify-ios-bundle: appex resource root', () => {
  test('iOS bundle — resources sit at the appex root', () => {
    const appex = mk(tmpdir(), 'Extension.appex');
    mk(appex, 'content');
    eq(resourceRoot(appex), appex);
  });

  test('macOS bundle — resources sit under Contents/Resources', () => {
    const appex = mk(tmpdir(), 'Extension.appex');
    const res = mk(appex, 'Contents', 'Resources');
    mk(res, 'content');
    eq(resourceRoot(appex), res);
  });

  // Guards the discriminator itself: `Contents/` alone (no Resources) is not the
  // macOS resource layout, and picking it would report every file missing again.
  test('Contents/ without Resources/ falls back to the appex root', () => {
    const appex = mk(tmpdir(), 'Extension.appex');
    mk(appex, 'Contents', 'MacOS');
    eq(resourceRoot(appex), appex);
  });
});

// The §9.5 background declaration lives in a gitignored tree that `app:sync` rebuilds.
// Forgetting app:sync gives you an app that installs fine and goes silent the moment
// the screen locks — the shape of "the feature was never built" — and the build log
// says nothing. So it is checked against the BUILT bundle, not the source.
describe('verify-ios-bundle: the §9.5 background-audio declaration', () => {
  const PLIST = (extra) => '<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0">\n<dict>\n'
    + '\t<key>CFBundleIdentifier</key>\n\t<string>com.example</string>\n' + (extra || '')
    + '</dict>\n</plist>\n';
  const BG = '\t<key>UIBackgroundModes</key>\n\t<array>\n\t\t<string>audio</string>\n\t</array>\n';

  function iosBundles(dir, appExtra, appexExtra) {
    const app = path.join(dir, 'App.app');
    const appex = path.join(app, 'PlugIns', 'Ext.appex');
    fs.mkdirSync(appex, { recursive: true });
    fs.writeFileSync(path.join(app, 'Info.plist'), PLIST(appExtra));
    fs.writeFileSync(path.join(appex, 'Info.plist'), PLIST(appexExtra));
    return { app, appex };
  }

  test('iOS: app declares audio, extension does not ⇒ pass', () => {
    if (process.platform !== 'darwin') return;   // needs plutil
    const { app, appex } = iosBundles(tmpdir(), BG, '');
    ok(checkBackgroundAudio(app, appex));
  });

  test('iOS: the key missing ⇒ fail (this is app:sync having been skipped)', () => {
    if (process.platform !== 'darwin') return;
    const { app, appex } = iosBundles(tmpdir(), '', '');
    ok(!checkBackgroundAudio(app, appex));
  });

  test('the extension target must never declare it — it plays no audio', () => {
    if (process.platform !== 'darwin') return;
    const { app, appex } = iosBundles(tmpdir(), BG, BG);
    ok(!checkBackgroundAudio(app, appex));
  });

  test('macOS: declaring it is the failure — the process is never suspended there', () => {
    if (process.platform !== 'darwin') return;
    const dir = tmpdir();
    const app = path.join(dir, 'App.app');
    fs.mkdirSync(path.join(app, 'Contents'), { recursive: true });
    fs.writeFileSync(path.join(app, 'Contents', 'Info.plist'), PLIST(BG));
    ok(!checkBackgroundAudio(app, null), 'macOS 不需要它，而声明一个用不上的后台模式审核会问');
    fs.writeFileSync(path.join(app, 'Contents', 'Info.plist'), PLIST(''));
    ok(checkBackgroundAudio(app, null));
  });

  test('findApp stops at the .app and does not dive into the .appex inside it', () => {
    const dir = tmpdir();
    const { app } = iosBundles(dir, BG, '');
    eq(findApp(dir), app);
  });
});

// 灵动岛的 Widget target（§9.5）。**这是本仓库唯一一个凭空造 target 的补丁**，也是
// 最脆的：别的补丁都是往一个已经在 target 里的文件上贴代码，这一个要在 pbxproj 里
// 新增八类对象并把它们接起来，而 safari-project*/ 每次重生成都会抹掉它们。
//
// 这里守的不是「造得对不对」（那要靠 xcodebuild，见 M20），而是**两条会静默失效的性质**：
// 幂等，以及「按 productType 找 App target 而不是按产品名」—— 后者是被中国版那棵树
// （target 叫「… CN (iOS)」）当场证伪出来的，写死英文名会让中国版整体跳过，
// 而「跳过」的表现是「中国版没有灵动岛」，没有一行输出会提这件事。
describe('sync-app-assets: 每 target 一份 entitlements（I-2）', () => {
  const ROOT = path.join(__dirname, '..');
  const REAL_PBX = (() => {
    const f = path.join(ROOT, 'safari-project', 'BelliedMonkey Translator',
      'BelliedMonkey Translator.xcodeproj', 'project.pbxproj');
    try { return fs.readFileSync(f, 'utf8').replace(/\n[^\n]*CODE_SIGN_ENTITLEMENTS[^\n]*\n/g, '\n'); } catch (_) { return null; }
  })();
  function tree() {
    const dir = tmpdir();
    fs.mkdirSync(path.join(dir, 'X.xcodeproj'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'Shared (App)'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'X.xcodeproj', 'project.pbxproj'), REAL_PBX);
    return { dir, shared: path.join(dir, 'Shared (App)'), pbx: path.join(dir, 'X.xcodeproj', 'project.pbxproj') };
  }

  test('★ 两个 App target 各挂各的，扩展一个都不沾', () => {
    if (!REAL_PBX) return;
    const t = tree();
    match(patchEntitlements(t.shared), /entitlements patched/);
    const out = fs.readFileSync(t.pbx, 'utf8');
    for (const [plat, file] of [['iOS', 'ios-app.entitlements'], ['macOS', 'macos-app.entitlements']]) {
      const re = new RegExp('CODE_SIGN_ENTITLEMENTS = "([^"]+)";\\s*\\n\\s*INFOPLIST_FILE = "' + plat + ' \\(App\\)/Info\\.plist";', 'g');
      const got = [...out.matchAll(re)].map((m) => m[1]);
      eq(got.length, 2, plat + ' 的两档配置都要挂上');
      eq(new Set(got).size, 1, plat + ' 两档要指同一份');
      ok(got[0].endsWith(file), plat + ' 要挂 ' + file + '，实际 ' + got[0]);
    }
    // 扩展不登录，多一个权限只会在审核时被问
    ok(!/CODE_SIGN_ENTITLEMENTS[^\n]*\n\s*INFOPLIST_FILE = "(iOS|macOS) \(Extension\)/.test(out),
      '扩展 target 不该有 CODE_SIGN_ENTITLEMENTS');
  });

  test('★ 守卫按配置块判，不按整份判 —— 否则第二个 target 永远挂不上', () => {
    if (!REAL_PBX) return;
    // 造一个「iOS 已挂、macOS 还没挂」的中间态：原来的全局守卫会在这里整体跳过
    const t = tree();
    let pbx = fs.readFileSync(t.pbx, 'utf8');
    pbx = pbx.replace(/(\n\s*)(INFOPLIST_FILE = "iOS \(App\)\/Info\.plist";)/g,
      '$1CODE_SIGN_ENTITLEMENTS = "Shared (App)/ios-app.entitlements";$1$2');
    fs.writeFileSync(t.pbx, pbx);
    const note = patchEntitlements(t.shared);
    const out = fs.readFileSync(t.pbx, 'utf8');
    ok(out.includes('macos-app.entitlements'), 'macOS 那一份必须补上，实际回执：' + note);
    eq((out.match(/CODE_SIGN_ENTITLEMENTS = "Shared \(App\)\/ios-app\.entitlements";/g) || []).length, 2,
      'iOS 已有的不能被打第二遍');
  });

  test('模板缺了就整体放弃并说明，绝不写一半', () => {
    if (!REAL_PBX) return;
    const t = tree();
    const saved = ENTITLEMENTS[1].src;
    ENTITLEMENTS[1].src = 'nope.entitlements';
    try {
      match(patchEntitlements(t.shared), /✗ entitlements:.*nope\.entitlements 不存在/);
      eq(fs.readFileSync(t.pbx, 'utf8').includes('CODE_SIGN_ENTITLEMENTS'), false, '一行都不该写');
    } finally { ENTITLEMENTS[1].src = saved; }
  });

  test('每份模板都只放该 target 用得上的 —— macOS 永远不该有 App Group / translation-app', () => {
    const mac = fs.readFileSync(path.join(ROOT, 'app', 'native', 'entitlements', 'macos-app.entitlements'), 'utf8');
    const body = mac.slice(mac.indexOf('<plist'));
    for (const k of ['application-groups', 'keychain-access-groups', 'translation-app']) {
      ok(!body.includes(k), 'macOS 的 entitlements 里不该有 ' + k + '（系统翻译是 iOS 独有的）');
    }
  });
});

describe('sync-app-assets: 灵动岛 Widget target', () => {
  // **样板取自真工程**，不是手写的。第一版手写的样板字段顺序和转换器的输出不同，
  // 于是测试红了而补丁其实是对的 —— 一个只存在于测试里的形状，守不住任何东西。
  // 这里读一份真实 pbxproj 骨架（跑过 app:sync 的树；没有就跳过整节）。
  const REAL = (() => {
    const cand = ['safari-project/BelliedMonkey Translator/BelliedMonkey Translator.xcodeproj/project.pbxproj'];
    for (const c of cand) {
      const abs = path.join(__dirname, '..', c);
      if (fs.existsSync(abs)) return fs.readFileSync(abs, 'utf8');
    }
    return null;
  })();

  const PBX = (appName) => {
    // 把 needle 与已有的 widget 痕迹剥掉，得到一份「还没打过这个补丁」的骨架。
    // 剥掉**每一个**我们自己造的 target 的痕迹，得到「还没打过补丁」的骨架。
    // 用的是脚本导出的那个 strip —— 生产代码在「规格变了就拆掉重造」时走同一条路，
    // 一份实现两个消费者。只剥 widget 是不够的：I-5 之后真工程里还有系统翻译那一个。
    let t = String(REAL);
    for (const sp of [WIDGET_SPEC, TRANSLATE_EXT_SPEC]) t = stripExtensionTarget(t, sp);
    if (appName !== 'BelliedMonkey Translator') {
      t = t.split('BelliedMonkey Translator').join(appName);
    }
    return t;
  };

  function tree(appName) {
    const dir = tmpdir();
    const proj = path.join(dir, 'X.xcodeproj');
    fs.mkdirSync(path.join(dir, 'Shared (App)'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'iOS (App)'), { recursive: true });
    fs.mkdirSync(proj, { recursive: true });
    fs.writeFileSync(path.join(proj, 'project.pbxproj'), PBX(appName));
    return { dir, pbx: path.join(proj, 'project.pbxproj') };
  }

  // I-1：patchWidgetTarget 变成 patchExtensionTarget(spec) 的一个薄包装。这是纯重构，
  // 判据是**输出逐字节不变** —— 重构一个「凭空造 target」的补丁，最容易的失手方式是
  // 悄悄改掉某个 id 或某行缩进，而那要到下一次真机构建才会暴露。
  // patchWidgetFiles 此前**一条测试都没有** —— I-1 把常量换成规格时漏改了它里面的
  // WIDGET_DIR，而 npm test 全绿：这个函数要真工程树才跑得到，单测一次都没碰过它。
  // 是 app:sync 在真树上当场 ReferenceError 才暴露的。补这一条，让它以后不必靠人跑到。
  test('★ 源文件与 Info.plist 落进规格说的那个目录', () => {
    const dir = tmpdir();
    fs.mkdirSync(path.join(dir, 'Shared (App)'), { recursive: true });
    const note = patchWidgetFiles(path.join(dir, 'Shared (App)'));
    ok(!/✗|not defined/.test(note), '不该报错，实际：' + note);
    const out = path.join(dir, WIDGET_SPEC.dir);
    ok(fs.existsSync(path.join(out, WIDGET_SPEC.srcs[0])), WIDGET_SPEC.srcs[0] + ' 要被拷过去');
    ok(fs.existsSync(path.join(out, 'Info.plist')), '扩展有独立 bundle，plist 也独立');
    ok(fs.readFileSync(path.join(out, 'Info.plist'), 'utf8').includes('widgetkit-extension'),
      'plist 要声明 widget 的扩展点');
  });

  test('★ 重构不动 widget 的输出：走规格造出来的与走包装造出来的逐字节相同', () => {
    if (!REAL) return;
    const a = tree('Some App'); patchWidgetTarget(path.join(a.dir, 'Shared (App)'));
    const b = tree('Some App'); patchExtensionTarget(path.join(b.dir, 'Shared (App)'), WIDGET_SPEC);
    eq(fs.readFileSync(b.pbx, 'utf8'), fs.readFileSync(a.pbx, 'utf8'), 'widget 的 pbxproj 必须逐字节相同');
  });

  // 造第二个扩展时最先撞上的两件事：id 撞车（两个 target 抢同一个号，Xcode 打不开工程）
  // 与源文件只能有一个。两条都在这里钉住 —— 不必等 I-5 真的写那个 target。
  test('★ 规格是通用的：换个 needle 的扩展不与 widget 抢 id，且可以带多个源文件', () => {
    if (!REAL) return;
    const SPEC2 = { needle: 'MT_TRANSLATE_EXT_TARGET', label: 'translate', dir: 'iOS (TranslateExt)',
      name: 'MTTranslateExt', deploy: '18.4', srcs: ['A.swift', 'B.swift', 'C.swift'], settings: {} };
    const t = tree('Some App');
    match(patchWidgetTarget(path.join(t.dir, 'Shared (App)')), /widget target patched/);
    const note = patchExtensionTarget(path.join(t.dir, 'Shared (App)'), SPEC2);
    match(note, /translate target patched \(MTTranslateExt, iOS 18\.4\+\)/, '回执要自称 translate');
    const out = fs.readFileSync(t.pbx, 'utf8');
    for (const f of SPEC2.srcs) {
      ok(out.includes(f + ' in Sources'), f + ' 要进 Sources 阶段');
      ok(out.includes('path = ' + f + ';'), f + ' 要有 PBXFileReference');
    }
    ok(out.includes('IPHONEOS_DEPLOYMENT_TARGET = 18.4;'), '扩展有自己的部署下限');
    // id 撞车会让 Xcode 直接打不开工程。注意判据不能写成「所有 id 去重后数目不变」——
    // pbxproj 里同一个 id 本来就出现多次（定义一次、被引用多次），那样写必然红。
    // 真判据：两个扩展各自的 id 集合**不相交**，这由 needle 长度决定的前缀保证。
    const pre = (spec) => "MT" + spec.needle.length.toString(16).toUpperCase().padStart(2, "0");
    ok(pre(WIDGET_SPEC) !== pre(SPEC2), "两个扩展的 id 前缀必须不同（否则 Xcode 打不开工程）");
    const setOf = (pfx) => new Set((out.match(new RegExp(pfx + "[0-9A-F]{20}", "g")) || []));
    const inter = [...setOf(pre(SPEC2))].filter((x) => setOf(pre(WIDGET_SPEC)).has(x));
    eq(inter.length, 0, "两个扩展的 id 不能有交集");
    ok(out.includes('MTPodcastWidget.appex') && out.includes('MTTranslateExt.appex'), '两个产物都在');
  });

  test('造出 target，并把它挂进工程的 targets、依赖与嵌入阶段', () => {
    if (!REAL) return;   // 工程还没生成过，这节无从谈起
    const t = tree('Some App');
    const note = patchWidgetTarget(path.join(t.dir, 'Shared (App)'));
    match(note, /widget target patched/);
    const out = fs.readFileSync(t.pbx, 'utf8');
    ok(out.includes('MT_WIDGET_TARGET'), 'needle 在');
    ok(/productType = "com\.apple\.product-type\.app-extension"/.test(out), 'target 类型');
    ok(/targets = \(\n\t+MT[0-9A-F]+ \/\* MTPodcastWidget \*\/,/.test(out.replace(/\t/g, '\t')),
      '没挂进工程的 targets 列表 —— Xcode 根本看不到它');
    ok(/in Embed Foundation Extensions/.test(out),
      '没塞进嵌入阶段 —— 扩展会编译但装不进 App，而这不会报错');
    ok(/isa = PBXTargetDependency/.test(out), '没建依赖 —— 构建顺序无保证');
  });

  test('跑两次一字不改（幂等）—— 造了两遍就是两个同名 target，工程当场坏掉', () => {
    if (!REAL) return;
    const t = tree('Some App');
    patchWidgetTarget(path.join(t.dir, 'Shared (App)'));
    const once = fs.readFileSync(t.pbx, 'utf8');
    const note = patchWidgetTarget(path.join(t.dir, 'Shared (App)'));
    match(note, /already patched/);
    eq(fs.readFileSync(t.pbx, 'utf8'), once, '第二次必须一字不改');
    eq((once.match(/MT_WIDGET_TARGET/g) || []).length, 1);
  });

  test('按 productType 找 App target，不按产品名 —— 中国版叫「… CN (iOS)」', () => {
    // 写死英文名会让中国版整体跳过，而跳过的表现是「中国版没有灵动岛」，
    // 没有任何一行输出会说这件事。这条是被那棵树当场证伪出来的。
    if (!REAL) return;
    for (const name of ['Some App', 'Some App CN', '大肚猴翻译']) {
      const t = tree(name);
      match(patchWidgetTarget(path.join(t.dir, 'Shared (App)')), /widget target patched/, name);
    }
  });

  test('id 是固定的，不是随机的 —— 随机会让每次 app:sync 都产生不同的 pbxproj', () => {
    if (!REAL) return;
    const a = tree('Some App'); patchWidgetTarget(path.join(a.dir, 'Shared (App)'));
    const b = tree('Some App'); patchWidgetTarget(path.join(b.dir, 'Shared (App)'));
    eq(fs.readFileSync(a.pbx, 'utf8'), fs.readFileSync(b.pbx, 'utf8'));
  });

  test('锚点缺失 ⇒ 整体放弃并说明，绝不写一半', () => {
    if (!REAL) return;
    const t = tree('Some App');
    // 抽掉**所有** application target：造了一半的工程编译不了，而那比不造更糟。
    // （真工程有 iOS 与 macOS 两个 —— 只删一处，正则会在另一处匹配成功。）
    fs.writeFileSync(t.pbx, PBX('Some App')
      .split('productType = "com.apple.product-type.application";').join(''));
    const note = patchWidgetTarget(path.join(t.dir, 'Shared (App)'));
    match(note, /^✗/);
    ok(!fs.readFileSync(t.pbx, 'utf8').includes('MT_WIDGET_TARGET'), '放弃时不许留下半个 target');
  });

  // I-5a 把 buildSettings 从一段模板字面量改成「表 + 字母序」，好让第二个扩展能塞进自己的
  // 几项。改完逐字节比对过重构前的输出（相同），但那只是当时一次 —— 这一条把它钉住：
  // 少一项、多一项、顺序变了，都会红。**顺序也是判据**：Xcode 自己按字母序写，而一份
  // 顺序不同的 pbxproj 会在下一次有人用 Xcode 存盘时产生一大片无关 diff。
  test('★ widget 的 buildSettings 逐行钉住 —— 少一项、多一项、换个顺序都要红', () => {
    if (!REAL) return;
    const t = tree('Some App');
    patchWidgetTarget(path.join(t.dir, 'Shared (App)'));
    const out = fs.readFileSync(t.pbx, 'utf8');
    // **取最后一处**：骨架是从真工程剥出来的，剥的是「MT… 开头的那一行」与「提到产品名的
    // 那一行」，于是上一次 app:sync 留下的 widget 配置**正文**还躺在里面（那一份的显示名与
    // 部署下限已被 build-safari.sh 改过）。取第一处量到的是它，不是这一次造出来的。
    const at = out.lastIndexOf(`INFOPLIST_FILE = "${WIDGET_SPEC.dir}/Info.plist";`);
    ok(at > 0, '找不到 widget 那一档配置');
    ok(out.slice(at, at + 300).includes(`INFOPLIST_KEY_CFBundleDisplayName = "${WIDGET_SPEC.name}"`),
      '量错了块 —— 这一档必须是这一次生成的那一份');
    const block = out.slice(out.lastIndexOf('buildSettings = {', at), out.indexOf('\t\t\t};', at));
    const keys = (block.match(/^\t{4}([A-Za-z_]+) = /gm) || []).map((s) => s.trim().replace(' =', ''));
    deepEq(keys, ['ASSETCATALOG_COMPILER_GLOBAL_ACCENT_COLOR_NAME', 'CODE_SIGN_STYLE',
      'CURRENT_PROJECT_VERSION', 'GENERATE_INFOPLIST_FILE', 'INFOPLIST_FILE',
      'INFOPLIST_KEY_CFBundleDisplayName', 'INFOPLIST_KEY_NSHumanReadableCopyright',
      'IPHONEOS_DEPLOYMENT_TARGET', 'LD_RUNPATH_SEARCH_PATHS', 'MARKETING_VERSION',
      'PRODUCT_BUNDLE_IDENTIFIER', 'PRODUCT_NAME', 'SDKROOT', 'SKIP_INSTALL',
      'SWIFT_EMIT_LOC_STRINGS', 'SWIFT_VERSION', 'TARGETED_DEVICE_FAMILY']);
    deepEq(keys.slice().sort(), keys, 'Xcode 按字母序写 buildSettings，我们也要');
    ok(!block.includes('CODE_SIGN_ENTITLEMENTS'), 'widget 不该有 entitlements —— 它不用任何能力');
  });
});

// I-5a：系统翻译的扩展点是 **ExtensionKit**，与灵动岛小组件不是同一种扩展
// （T1 尖刺 2026-09-19：产品类型 `extensionkit-extension`、嵌在 `Extensions/` 而不是
// `PlugIns/`、Info.plist 用 `EXAppExtensionAttributes`）。装错位置的后果是
// **系统永远发现不了它，而构建、签名、上传一路都不报错** —— 所以判据只能写在这里。
describe('sync-app-assets: ExtensionKit 扩展（I-5a）', () => {
  const REAL = (() => {
    const abs = path.join(__dirname, '..', 'safari-project/BelliedMonkey Translator/BelliedMonkey Translator.xcodeproj/project.pbxproj');
    return fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
  })();
  const PBX = () => {
    let t = String(REAL);
    for (const sp of [WIDGET_SPEC, TRANSLATE_EXT_SPEC]) t = stripExtensionTarget(t, sp);
    return t;
  };
  function tree() {
    const dir = tmpdir();
    const proj = path.join(dir, 'X.xcodeproj');
    fs.mkdirSync(path.join(dir, 'Shared (App)'), { recursive: true });
    fs.mkdirSync(proj, { recursive: true });
    fs.writeFileSync(path.join(proj, 'project.pbxproj'), PBX());
    return { dir, pbx: path.join(proj, 'project.pbxproj'), shared: path.join(dir, 'Shared (App)') };
  }
  const SPEC = {
    needle: 'MT_TEST_EXTKIT_TARGET', label: 'extkit', dir: 'iOS (TestExt)', name: 'MTTestExt',
    deploy: '18.4', srcDir: 'x', srcs: ['A.swift'],
    productType: 'com.apple.product-type.extensionkit-extension',
    productFileType: 'wrapper.extensionkit-extension',
    embed: EMBED_EXTENSIONKIT,
    plist: '\t<key>EXAppExtensionAttributes</key>\n\t<dict/>\n',
    settings: { CODE_SIGN_ENTITLEMENTS: '"Shared (App)/t.entitlements"', INFOPLIST_KEY_CFBundleDisplayName: '"起个名"' },
    resources: [{ name: 'ExtEngine.js', from: 'package.json' }],
  };

  test('★ 产品类型与嵌入位置都换了一种 —— 装进 PlugIns 的 ExtensionKit 扩展系统看不见', () => {
    if (!REAL) return;
    const t = tree();
    match(patchExtensionTarget(t.shared, SPEC), /extkit target patched/);
    const out = fs.readFileSync(t.pbx, 'utf8');
    ok(out.includes('productType = "com.apple.product-type.extensionkit-extension"'), '产品类型');
    ok(out.includes('explicitFileType = "wrapper.extensionkit-extension"'), '产物类型');
    ok(out.includes('dstSubfolderSpec = 16;') && out.includes('dstPath = "$(EXTENSIONS_FOLDER_PATH)"'),
      '嵌入到 <App>.app/Extensions/');
    ok(out.includes('MTTestExt.appex in Embed ExtensionKit Extensions'), '嵌入项挂在新阶段里');
    ok(!out.includes('MTTestExt.appex in Embed Foundation Extensions'),
      '**绝不能**同时塞进 PlugIns 那个阶段');
  });

  test('★ 新的嵌入阶段要挂进 iOS App target 的 buildPhases —— 只建不挂 = 根本不执行', () => {
    if (!REAL) return;
    const t = tree();
    patchExtensionTarget(t.shared, SPEC);
    const out = fs.readFileSync(t.pbx, 'utf8');
    // id 是我们自己造的 `MT…`，不是转换器那种纯十六进制 —— 类别写窄了会一条都匹配不到。
    const phaseId = (out.match(/(MT[0-9A-F]{20}) \/\* Embed ExtensionKit Extensions \*\/ = \{\n/) || [])[1];
    ok(phaseId, '阶段对象要在');
    // iOS App target 的 buildPhases 列表里必须点名它
    const appIdx = out.search(/[0-9A-F]{24} \/\* [^*]*\(iOS\) \*\/ = \{\s*isa = PBXNativeTarget;/);
    const phases = (out.slice(appIdx).match(/buildPhases = \(([\s\S]*?)\);/) || [])[1] || '';
    ok(phases.includes(phaseId), 'iOS App 的 buildPhases 里没有它 ⇒ 这个阶段一次都不会跑');
    // macOS App 不该被牵连（那边没有这个扩展点）
    const macIdx = out.search(/[0-9A-F]{24} \/\* [^*]*\(macOS\) \*\/ = \{\s*isa = PBXNativeTarget;/);
    if (macIdx > 0) {
      const macPhases = (out.slice(macIdx).match(/buildPhases = \(([\s\S]*?)\);/) || [])[1] || '';
      ok(!macPhases.includes(phaseId), 'macOS App 不该嵌这个扩展');
    }
  });

  test('★ 资源进得了扩展 bundle —— 引擎不在包里，扩展起来就是一句 no ExtEngine.js', () => {
    if (!REAL) return;
    const t = tree();
    patchExtensionTarget(t.shared, SPEC);
    const out = fs.readFileSync(t.pbx, 'utf8');
    ok(out.includes('ExtEngine.js in Resources'), '要有 PBXBuildFile');
    ok(/MT[0-9A-F]{20} \/\* Resources \*\/ = \{\s*isa = PBXResourcesBuildPhase;[\s\S]{0,400}?ExtEngine\.js in Resources/.test(out),
      '要真的列在这个 target 的 Resources 阶段里');
    ok(out.includes('path = ExtEngine.js;'), '要有 PBXFileReference');
  });

  test('★ 额外的构建设置合并进去，并且仍按字母序', () => {
    if (!REAL) return;
    const t = tree();
    patchExtensionTarget(t.shared, SPEC);
    const out = fs.readFileSync(t.pbx, 'utf8');
    ok(out.includes('CODE_SIGN_ENTITLEMENTS = "Shared (App)/t.entitlements";'), 'entitlements 要挂给扩展自己');
    ok(out.includes('INFOPLIST_KEY_CFBundleDisplayName = "起个名";'), 'spec.settings 覆盖同名默认值');
    eq((out.match(/= "起个名";/g) || []).length, 2, '两档配置各一条，不是四条');
    const i = out.indexOf('CODE_SIGN_ENTITLEMENTS');
    ok(i > 0 && out.indexOf('CODE_SIGN_STYLE', i) > i, 'CODE_SIGN_ENTITLEMENTS 要排在 CODE_SIGN_STYLE 之前');
    ok(out.includes('IPHONEOS_DEPLOYMENT_TARGET = 18.4;'), '部署下限是扩展自己的');
  });

  test('★ 两个扩展并存：各有各的嵌入阶段，id 不相交', () => {
    if (!REAL) return;
    const t = tree();
    match(patchWidgetTarget(t.shared), /widget target patched/);
    match(patchExtensionTarget(t.shared, SPEC), /extkit target patched/);
    const out = fs.readFileSync(t.pbx, 'utf8');
    ok(out.includes('MTPodcastWidget.appex in Embed Foundation Extensions'), 'widget 还在 PlugIns');
    ok(out.includes('MTTestExt.appex in Embed ExtensionKit Extensions'), '翻译扩展在 Extensions/');
    // 结尾要带换行：`… in Embed ExtensionKit Extensions */ = {isa = PBXBuildFile` 是那条嵌入项，不是阶段。
    eq((out.match(/\/\* Embed ExtensionKit Extensions \*\/ = \{\n/g) || []).length, 1, '阶段只该建一次');
    const pre = (s) => 'MT' + s.needle.length.toString(16).toUpperCase().padStart(2, '0');
    const setOf = (p) => new Set(out.match(new RegExp(p + '[0-9A-F]{20}', 'g')) || []);
    eq([...setOf(pre(SPEC))].filter((x) => setOf(pre(WIDGET_SPEC)).has(x)).length, 0);
    // 幂等：再跑一次一字不改
    const once = out;
    match(patchExtensionTarget(t.shared, SPEC), /already patched/);
    eq(fs.readFileSync(t.pbx, 'utf8'), once);
  });

  test('★ 工程里没有那个嵌入阶段、而规格又不许造 ⇒ 响亮地停下，不塞进 PlugIns 将就', () => {
    if (!REAL) return;
    const t = tree();
    const NOCREATE = Object.assign({}, SPEC, { embed: { phase: 'Embed ExtensionKit Extensions' } });
    match(patchExtensionTarget(t.shared, NOCREATE), /^✗ extkit: iOS App target 没有 Embed ExtensionKit Extensions 阶段/);
    ok(!fs.readFileSync(t.pbx, 'utf8').includes(SPEC.needle), '放弃时不许留下半个 target');
  });

  test('★ 源文件或资源缺一个就整体放弃 —— 半个扩展比没有扩展更糟', () => {
    const dir = tmpdir();
    fs.mkdirSync(path.join(dir, 'Shared (App)'), { recursive: true });
    const shared = path.join(dir, 'Shared (App)');
    match(patchExtensionFiles(shared, Object.assign({}, SPEC, { srcs: ['NoSuch.swift'] })),
      /✗ extkit: app\/native\/x\/NoSuch\.swift 不存在/);
    match(patchExtensionFiles(shared, Object.assign({}, SPEC, { srcs: [], resources: [{ name: 'E.js', from: 'dist-app/NoSuch.js' }] })),
      /✗ extkit: dist-app\/NoSuch\.js 不存在/);
    ok(!fs.existsSync(path.join(dir, SPEC.dir)), '放弃时连目录都不该建');
  });

  test('★ plist 用 EXAppExtensionAttributes，不是 NSExtension —— 那正是论坛 779334 的死结', () => {
    const dir = tmpdir();
    fs.mkdirSync(path.join(dir, 'Shared (App)'), { recursive: true });
    const note = patchExtensionFiles(path.join(dir, 'Shared (App)'),
      Object.assign({}, SPEC, { srcs: [], srcDir: '.' }));
    match(note, /extkit files synced/);
    const p = fs.readFileSync(path.join(dir, SPEC.dir, 'Info.plist'), 'utf8');
    ok(p.includes('EXAppExtensionAttributes'), 'ExtensionKit 的扩展点声明');
    ok(!p.includes('NSExtension'), 'ExtensionKit 不用 NSExtension；Xcode 也不许写 NSExtensionPrincipalClass');
    ok(fs.existsSync(path.join(dir, SPEC.dir, 'ExtEngine.js')), '资源要拷进工程树');
    // 模板变了就跟上（这棵树是一次性的，手改不该在这里留存）
    fs.writeFileSync(path.join(dir, SPEC.dir, 'Info.plist'), '手改的');
    patchExtensionFiles(path.join(dir, 'Shared (App)'), Object.assign({}, SPEC, { srcs: [], srcDir: '.' }));
    ok(fs.readFileSync(path.join(dir, SPEC.dir, 'Info.plist'), 'utf8').includes('EXAppExtensionAttributes'),
      '第二次要把手改覆盖回模板');
  });
});

// 发内测**一定**会更新官网那一页。
//
// 第一版把「保持最新」全押在页面运行时那次 api.github.com 请求上，而那个请求在部分
// 网络下根本发不出去：1.7.4 发了出去，页面还写着 1.7.3，同时印着「所以这个链接不会
// 停在旧版本」—— 恰恰在它失效的那一刻说了假话（2026-09-02 用户实测）。
// 静态那份是真相，所以发布脚本必须调生成器；这条断言守的就是那一行不许被删。
describe('内测发布会更新官网那一页', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'scripts/gh-release.js'), 'utf8');

  test('gh-release.js 在 prerelease 之后调 gen-beta-page.js', () => {
    ok(src.includes('gen-beta-page.js'),
      'gh-release.js 不再调用 gen-beta-page.js —— 官网内测页会停在上一个版本');
    ok(/--tag \$\{tag\}/.test(src),
      '调生成器时没把 tag 传进去 —— 生成器会沿用页面里的旧版本');
  });

  test('页面没推时会明说', () => {
    ok(src.includes('还没推'),
      '生成完却不检查有没有推 —— 文件改了没推，用户看到的仍是上一版');
  });

  test('生成器把版本钉进 HTML，而不是只靠运行时 fetch', () => {
    const gen = fs.readFileSync(path.join(__dirname, '..', 'scripts/gen-beta-page.js'), 'utf8');
    ok(gen.includes('{{TAG}}'), '生成器不再往 HTML 里钉版本');
    ok(gen.includes('AbortController'), '运行时那次 fetch 没有超时 —— 请求不到时会一直挂着');
    ok(gen.includes('function newer('), '运行时改写没有比大小 —— 会被更旧的 prerelease 覆盖');
  });
});

// installs：下载量。这三条钉的是**实测出来的形状**，不是文档里读的。
// 2026-09-03 首次接通 salesReports 时，每一条都真实地绊过一次。
//
// 2026-09-04 这段代码搬进了 scripts/lib/asc-client.js（store-stats.js 要问 Apple
// 同样的问题，两份实现会漂移）。**断言跟着搬，一条都没放宽** —— 搬家当天它就抓到
// 一个真回归：取 vendorNumber 的那个网址在搬运中被丢了，而那个号 API 查不到、
// 只能去网页上抄。
describe('asc installs 的三个形状', () => {
  const fs = require('fs');
  const path = require('path');
  const fn = fs.readFileSync(path.join(__dirname, '..', 'scripts/lib/asc-client.js'), 'utf8');
  const caller = fs.readFileSync(path.join(__dirname, '..', 'scripts/asc.js'), 'utf8');
  // 负向断言要看**代码**，不看注释 —— 解释「为什么不读 Supported Platforms」的那段话
  // 本身含有这个词组，否则一条正确的说明会把它自己判成违规。
  const codeOf = (s) => s.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

  test('404 当成「那天没人下载」，不当错误', () => {
    ok(/status === 404\) return null/.test(fn),
      '没数据的那天 Apple 返回 404 —— 当成错误的话，拉 40 天会在第一个安静的日子里炸掉');
  });

  test('按 gzip 的 TSV 读，不走 api()（那个只解 JSON）', () => {
    ok(fn.includes("Accept: 'application/a-gzip'"), '没有要 a-gzip');
    ok(fn.includes('gunzipSync'), '没有解压 —— salesReports 返回的不是 JSON');
  });

  test('设备分布读 Device 列，不读 Supported Platforms', () => {
    ok(/r\.Device/.test(fn), '没读 Device 列');
    ok(!/Supported Platforms/.test(codeOf(fn)) && !/Supported Platforms/.test(codeOf(caller)),
      'Supported Platforms 写的是「包支持什么」（iOS and macOS），不是「用户用什么」'
      + ' —— 拿它当设备分布会得到一个 100% 全平台的废话');
  });

  test('缺 vendorNumber 时告诉用户去哪儿拿，而不是只说缺', () => {
    ok(fn.includes('payments_and_financial_reports'),
      '缺凭证时没给出取值的地址 —— 那个号 API 查不到，只能去网页上抄');
  });
});

// Apple 的 OAuth secret 六个月过期（§8.4.1.2）。
//
// 到期时的表现是**只坏一半**：扩展里的「用 Apple 登录」开始失败，而 App 一切正常
// —— 因为原生那条路走 id_token，根本不用这个 secret。半年后没有人会记得这里有个
// 定时炸弹，而「一半的登录静默失效」正是这个仓库最怕的形状。
//
// 判据取自 .local/keys.md 里由 scripts/apple-client-secret.js 写回的到期日。
// 那个文件是 gitignored 的，所以在 CI 上它不存在 —— **不存在时跳过**，而不是红。
// 一条在 CI 上永远红的断言，等于一条没人看的断言。
describe('Apple client secret 的到期提醒', () => {
  const fs = require('fs');
  const path = require('path');
  const KEYS = path.join(__dirname, '..', '.local', 'keys.md');

  test('剩余有效期还够（本机有凭证时才判）', () => {
    if (!fs.existsSync(KEYS)) return;                      // CI：没有凭证，跳过
    const m = /^appleSecretExpires\s*=\s*(\d{4}-\d{2}-\d{2})/m.exec(fs.readFileSync(KEYS, 'utf8'));
    if (!m) return;                                        // 还没生成过 secret
    const days = Math.floor((new Date(m[1] + 'T00:00:00Z') - Date.now()) / 86400000);
    ok(days > 30, `Apple 的 OAuth secret 还有 ${days} 天到期（${m[1]}）。`
      + '过期后**扩展**里的 Apple 登录会静默失败，而 App 一切正常 —— 只坏一半，最难查。'
      + ' 重新生成：node scripts/apple-client-secret.js');
  });

  test('生成器把到期日写回去了 —— 不写的话上面那条永远没东西可判', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'scripts/apple-client-secret.js'), 'utf8');
    ok(src.includes('appleSecretExpires'), '生成器不再记录到期日');
    ok(!/appleClientSecret\s*=/.test(src),
      'secret 本身不该被写进 keys.md —— 它随时能重新生成，多存一份只是多一个泄露面');
  });
});

// app:sync 的幂等判据必须覆盖**这一版要打的全部内容**。
//
// 2026-09-03 的真实漏打：给 attach 那一处加 MTWebAuth.attach 时，判据还只认
// MTAppleSignIn.attach，于是整段被当成「已经打过了」跳过 —— 补丁没打上，而输出
// 说的是 `already current`。这类失败**最难发现**：脚本报的是成功。
//
// 判据：凡是补丁块里要写进去的 `.attach(` 调用，幂等检查里都要出现。
describe('app:sync 的幂等判据不许只认第一行', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'scripts/sync-app-assets.js'), 'utf8');

  test('要打进去的每一个 attach，检查里都提到了', () => {
    const written = new Set([...src.matchAll(/(\w+)\.attach\(self\.webView\)/g)].map((m) => m[1]));
    ok(written.size >= 2, `只扫到 ${written.size} 个 attach —— 扫法走歪了？`);
    // 检查侧可能写成 `includes(ATTACH)`，其中 ATTACH 是个常量。先把常量解开，
    // 否则断言会指着一个其实已经守住的地方喊漏（第一版就是这样）。
    const alias = {};
    for (const m of src.matchAll(/const\s+(\w+)\s*=\s*'(\w+)\.attach\(self\.webView\)'/g)) {
      alias[m[1]] = m[2];
    }
    const checkLines = src.split('\n').filter((ln) => ln.includes('includes('));
    for (const name of written) {
      const guarded = checkLines.some((ln) => ln.includes(name + '.attach')
        || Object.entries(alias).some(([k, v]) => v === name && ln.includes('includes(' + k + ')')));
      ok(guarded, `${name}.attach 会被写进工程，但幂等检查里没有它 —— `
        + '下一次它会被当成「已经打过了」而漏打，且脚本报的是成功');
    }
  });
});

// 撤审之后必须走得回去。
//
// 撤审后的状态是 DEVELOPER_REJECTED —— 那是「开发者自己撤回」，**不是**「被审核拒了」。
// 状态判据只认 PREPARE_FOR_SUBMISSION 的脚本，会在撤审之后拒绝再动那条记录，而撤审
// **不可逆**（排队位置已经清零）。2026-09-03 中国版为合规撤审后当场撞上：renameversion
// 拒绝把 1.7.12 改成 1.7.13，人被卡在一个走不回去的状态里。
//
// 三个脚本用的是同一套判据，所以三个都验 —— 这条以前只在两个脚本里成立。
describe('ASC 脚本必须认 DEVELOPER_REJECTED（撤审后的状态）', () => {
  const fs = require('fs');
  const path = require('path');
  const ROOT = path.join(__dirname, '..');
  for (const f of ['scripts/asc.js', 'scripts/asc-media.js', 'scripts/asc-submit.js']) {
    test(f + ' 的可编辑集合里有 DEVELOPER_REJECTED', () => {
      const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
      ok(/DEVELOPER_REJECTED/.test(src), f + ' 从没提过 DEVELOPER_REJECTED');
      // 真正的判据：不许再有「!== 'PREPARE_FOR_SUBMISSION'」这种单状态比较 ——
      // 那正是撤审后走不回去的形状。集合比较（includes / EDITABLE）才对。
      const bare = [...src.matchAll(/[!=]==\s*'PREPARE_FOR_SUBMISSION'/g)];
      eq(bare.length, 0,
        `${f} 还有 ${bare.length} 处把 PREPARE_FOR_SUBMISSION 当唯一可编辑状态 `
        + '—— 撤审之后那条记录就再也动不了了，而撤审不可逆');
    });
  }
});

// 被 App Review 拒了是另一个状态：REJECTED。2026-09-18 1.12.1 国际 iOS 因 Guideline 4 被拒，
// 修完要 bind 新 build 再重提 —— 而那次提交还挂着（UNRESOLVED_ISSUES），不能 POST 新的，
// 要复用它、跳过挂版本那步、直接递出去。
describe('ASC 脚本必须认 REJECTED（被审核拒了）并复用那次提交', () => {
  const fs = require('fs');
  const path = require('path');
  const ROOT = path.join(__dirname, '..');
  test('asc.js 与 asc-submit.js 的可编辑 / 可提交集合里有 REJECTED', () => {
    match(fs.readFileSync(path.join(ROOT, 'scripts/asc.js'), 'utf8'), /\[\s*'PREPARE_FOR_SUBMISSION',\s*'DEVELOPER_REJECTED',\s*'REJECTED'\s*\]/);
    // asc-submit 还多认 READY_FOR_REVIEW：版本已挂在没递出去的提交里，只差 submitted:true
    match(fs.readFileSync(path.join(ROOT, 'scripts/asc-submit.js'), 'utf8'), /\[\s*'PREPARE_FOR_SUBMISSION',\s*'DEVELOPER_REJECTED',\s*'REJECTED',\s*'READY_FOR_REVIEW'\s*\]/);
  });
  test('asc-submit.js 复用 UNRESOLVED_ISSUES 的提交，且已挂版本时跳过 POST reviewSubmissionItems', () => {
    const src = fs.readFileSync(path.join(ROOT, 'scripts/asc-submit.js'), 'utf8');
    ok(/\['UNRESOLVED_ISSUES', 'READY_FOR_REVIEW'\]\.includes\(r\.attributes\.state\)/.test(src), '要找被拒的 / 没递出去的那次提交');
    ok(/attributes: \{ resolved: true \}/.test(src), '被拒条目先标 resolved，否则 ③ 回 409');
    ok(/if \(!attached\) await api\('POST', '\/reviewSubmissionItems'/.test(src), '版本已在条目里就不再挂一次');
  });
});

// ── 设备内置转写 / 朗读的桥（learning-design §9.6.1）─────────────────────────────
describe('sync-app-assets: speech bridge block (§9.6.1)', () => {
  const R = path.join(__dirname, '..');
  const tpl = fs.readFileSync(path.join(R, 'app', 'native', 'speech-bridge.swift'), 'utf8');
  const audio = fs.readFileSync(path.join(R, 'app', 'native', 'audio-bridge.swift'), 'utf8');
  const sync = fs.readFileSync(path.join(R, 'scripts', 'sync-app-assets.js'), 'utf8');
  const { BLOCKS, patchSwiftPackageText } = require('../scripts/sync-app-assets.js');
  const stripComments = (src) => src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

  test('it is a marker block and the install line rides the audio bridge install', () => {
    ok(BLOCKS.some((b) => b.src === 'speech-bridge.swift' && b.name === 'mt-speech-bridge'), 'BLOCKS 里要有它');
    ok(sync.includes('MTSpeechBridge.shared.install(webView: self.webView)'), 'sync 脚本装的是同一个类');
    match(tpl, /static let channel = "mtSpeech"/);
    const js = fs.readFileSync(path.join(R, 'app', 'native-speech.js'), 'utf8');
    ok(js.includes("const CHANNEL = 'mtSpeech'"), 'JS 侧用的是同一个通道名');
  });

  // 协议镜像：JS 的 PROTOCOL 两组字符串必须在 .swift 里有对应的 case / "type"。
  // 以前两个桥都只靠字符串白名单间接约束（grep -rn toNative test/ 为空）—— 一边改名
  // 另一边没跟上时，表现是「遥控键按了没反应 / 识别结果没到」，查起来极贵。
  const mirror = (jsFile, swift) => {
    const src = fs.readFileSync(path.join(R, 'app', jsFile), 'utf8');
    const grab = (k) => (src.match(new RegExp(k + ":\\s*\\[([^\\]]*)\\]")) || [])[1].match(/'([^']+)'/g).map((s) => s.slice(1, -1));
    const toNative = grab('toNative'), fromNative = grab('fromNative');
    ok(toNative.length && fromNative.length, jsFile + ' 的 PROTOCOL 读不到');
    const body = stripComments(swift);
    for (const verb of toNative) ok(body.includes(`case "${verb}":`), `${jsFile} toNative「${verb}」在 .swift 里没有 case`);
    for (const verb of fromNative) ok(body.includes(`"${verb}"`), `${jsFile} fromNative「${verb}」在 .swift 里从未发出`);
  };
  test('native-speech.js 的 PROTOCOL 与 speech-bridge.swift 逐字对表', () => mirror('native-speech.js', tpl));
  test('native-audio.js 的 PROTOCOL 与 audio-bridge.swift 逐字对表', () => mirror('native-audio.js', audio));

  test('AVAudioSession only ever appears inside #if os(iOS)', () => {
    for (const line of tpl.split('\n')) {
      if (!line.includes('AVAudioSession')) continue;
      if (line.trim().startsWith('//')) continue;
      ok(inIOSGuard(tpl, line), `未被 #if os(iOS) 包住：${line.trim()}`);
    }
  });

  test('it carries no user-visible copy — states and reasons are protocol ids', () => {
    const strings = stripComments(tpl).match(/"[^"]*"/g) || [];
    const allowed = new Set(['""', '"mtSpeech"',
      // JS → 原生
      '"stt-probe"', '"stt-assets"', '"stt-start"', '"stt-stop"', '"tts-probe"', '"tts-assets"', '"tts-speak"', '"tts-stop"',
      // 原生 → JS
      '"stt-state"', '"assets-progress"', '"stt-partial"', '"stt-final"', '"tts-state"', '"tts-start"', '"tts-end"', '"tts-failed"',
      '"tts-debug"', '"step"', '"speak"', '"player"', '"generated"', '"n"', '"stale"',   // 朗读链路的调试事件（JS 不认就忽略）
      // 系统语音的原生后端（MTSystemSpeech）：请求字段、tts-state 的能力字段、选声用的 identifier 前缀
      '"backend"', '"system"', '"systemLangs"', '"voice"', '"-"',
      '"com.apple.voice."', '"ttsbundle"', '"com.apple.eloquence."', '"com.apple.speech.synthesis.voice."',
      // 字段
      '"type"', '"state"', '"reason"', '"assets"', '"kind"', '"locale"', '"fraction"', '"locales"', '"vadMs"', '"vadLevel"',
      '"text"', '"conf"', '"alts"', '"t0"', '"t1"', '"langs"', '"id"', '"lang"', '"rate"', '"models"', '"dir"', '"model"',
      '"tokens"', '"dataDir"', '"files"', '"path"', '"url"', '"sha256"', '"size"',
      '"supported"',   // stt-state 里本机识别器支持的 locale 清单（2026-09-17）：JS 据此只列支持的语言
      '"url-probe"', '"https"', '"Range"', '"bytes=0-0"', '"ok"', '"status"',   // 地址可用性探测（learning-design §9.6.1.1，2026-09-17）：Range 0-0，回 ok/status
      // 状态 / 原因 id
      '"ready"', '"unsupported"', '"failed"', '"ended"', '"installed"', '"missing"', '"downloading"',
      '"os"', '"locale"', '"locales"', '"format"', '"stt"', '"tts"', '"no-engine"', '"download"', '"load"', '"lang"',
      // 路径 / 杂项
      '"mt-speech"', '"mt.speech.tts"', '"%02x"',
      // zip 解包（MTZip）：错误码与路径片段
      '".zip"', '".installed-"', '"/"', '".."', '"."', '"eocd"', '"cdir"', '"name"', '"local"', '"range"', '"method"', '"inflate"',
      '"window.NativeSpeech && window.NativeSpeech._fromNative(\\(json))"']);
    for (const lit of strings) ok(allowed.has(lit), `原生侧出现了非协议字符串（可能是文案）：${lit}`);
  });

  test('朗读期间静麦（§9.6 回声段 2026-09-13）：audio-bridge 有 muteInput，两个朗读后端出声置 true、收尾置 false', () => {
    const a = stripComments(audio), sp = stripComments(tpl);
    ok(/var muteInput = false/.test(a), 'audio-bridge 要有 muteInput 开关');
    ok(/muteUntil/.test(a) && /frameCapacity: raw\.frameLength/.test(a), '静音是同长度的零帧，不是丢帧');
    const on = (sp.match(/MTAudioBridge\.shared\.muteInput = true/g) || []).length;
    const off = (sp.match(/MTAudioBridge\.shared\.muteInput = false/g) || []).length;
    eq(on, 2, 'Piper 首块 + 系统语音 didStart 各一处置 true，实际 ' + on);
    ok(off >= 5, 'Piper finish/stop + 系统语音 didFinish/didCancel/stop 都要放开，实际 ' + off);
  });

  test('本机路 mic-start {deliver: level} 不发 PCM，只发 mic-level；tap 只装一次、sink 共享', () => {
    const body = stripComments(audio);
    ok(body.includes('var micSink'), 'audio-bridge 要暴露 micSink');
    ok(body.includes('"mic-level"'), '要发 mic-level');
    ok(body.includes('"deliver"'), 'mic-start 要认 deliver');
    ok(!stripComments(tpl).includes('installTap'), 'speech-bridge 不许自己再装 tap');
    ok(stripComments(tpl).includes('MTAudioBridge.shared.micSink'), 'speech-bridge 通过 micSink 拿音频');
  });

  describe('patchSwiftPackageText（本地 SwiftPM 包进 pbxproj）', () => {
    const fixture = [
      '\t\tA1 /* App iOS */ = {', '\t\t\tisa = PBXNativeTarget;', '\t\t\tname = "X (iOS)";', '\t\t\tpackageProductDependencies = (', '\t\t\t);', '\t\t};',
      '\t\tA2 /* App macOS */ = {', '\t\t\tisa = PBXNativeTarget;', '\t\t\tname = "X (macOS)";', '\t\t\tpackageProductDependencies = (', '\t\t\t);', '\t\t};',
      '\t\tE1 /* Ext */ = {', '\t\t\tisa = PBXNativeTarget;', '\t\t\tname = "X Extension (iOS)";', '\t\t\tpackageProductDependencies = (', '\t\t\t);', '\t\t};',
      '\t\tP /* Project object */ = {', '\t\t\tisa = PBXProject;', '\t\t\tmainGroup = M;', '\t\t\tproductRefGroup = G /* Products */;', '\t\t};',
      '\t};', '\trootObject = P /* Project object */;', '}', '',
    ].join('\n');
    const vendorReady = fs.existsSync(path.join(R, 'app', 'native', 'vendor', 'sherpa-onnx', 'Package.swift'));

    test('两个 App target 各挂一个产品依赖，扩展不挂；PBXProject 得到 packageReferences；幂等', () => {
      if (!vendorReady) { ok(true, 'vendor 未就位时跳过（fetch-native-deps 未跑）'); return; }
      const { src, note } = patchSwiftPackageText(fixture, '../../app/native/vendor/sherpa-onnx');
      ok(/patched \(2 App targets\)/.test(note), note);
      eq((src.match(/\/\* sherpa-onnx \*\/,/g) || []).length, 2, 'App target 两处');
      ok(src.indexOf('E1 /* Ext */') < src.indexOf('packageReferences') || !src.slice(src.indexOf('E1 /* Ext */'), src.indexOf('P /* Project object */')).includes('sherpa-onnx'), '扩展 target 不挂');
      ok(src.includes('isa = XCLocalSwiftPackageReference;') && src.includes('relativePath = "../../app/native/vendor/sherpa-onnx";'));
      ok(src.includes('isa = XCSwiftPackageProductDependency;') && src.includes('productName = "sherpa-onnx";'));
      ok(src.includes('\t\t\tpackageReferences = (\n'), 'PBXProject 的 packageReferences');
      const again = patchSwiftPackageText(src, '../../app/native/vendor/sherpa-onnx');
      ok(/already/.test(again.note), '第二次是 already');
      eq(again.src, src, '第二次不改字节');
    });

    test('App target 数对不上就拒绝，不写半个补丁', () => {
      if (!vendorReady) { ok(true, 'vendor 未就位时跳过'); return; }
      const one = fixture.replace('name = "X (macOS)"', 'name = "Y"');
      const { src, note } = patchSwiftPackageText(one, 'p');
      ok(/^✗/.test(note), note);
      eq(src, one, '拒绝时原样返回');
    });
  });

  // 2026-09-14 TestFlight 被拒（ITMS-90208）：onnxruntime iOS 切片 Info.plist 写 13.0，被包成动态框架后二进制是 App 的 16.4。
  test('原生依赖：iOS 切片框架的 MinimumOSVersion 抬到 App 系统下限（ITMS-90208）', () => {
    const deps = require('../scripts/fetch-native-deps.js');
    const src = fs.readFileSync(path.join(R, 'scripts', 'fetch-native-deps.js'), 'utf8');
    ok(typeof deps.normalizeIosMinOS === 'function', '导出 normalizeIosMinOS');
    ok(/normalizeIosMinOS\(checkOnly, problems\);/.test(src), 'main 里每次都跑（含 --check）');
    ok(/OS_FLOOR\.FLOOR\.ios/.test(src) && /'-replace', 'MinimumOSVersion'/.test(src), '按 os-floor 的 iOS 下限改 Info.plist');
    const problems = [];
    deps.normalizeIosMinOS(true, problems);   // vendor 未就位时自然没有问题（CI 上跳过）
    eq(problems.join('\n'), '', '本机已拉取的依赖不许低于下限');
  });
});

// ─── 系统下限（build/os-floor.config.js）：部署目标钉住 + 解析期语法门 ─────────────────
describe('os-floor: 部署目标与解析期语法门', () => {
  const OSF = require(path.join(__dirname, '..', 'build', 'os-floor.config.js'));
  const { patchDeploymentTargets } = require(path.join(__dirname, '..', 'scripts', 'sync-app-assets.js'));
  test('下限是有据的：iOS 16.4 / macOS 13.3 = Safari 16.4，带裁定日期', () => {
    eq(OSF.FLOOR.ios, '16.4', 'iOS 下限'); eq(OSF.FLOOR.macos, '13.3', 'macOS 下限'); eq(OSF.FLOOR.safari, '16.4', 'Safari 下限');
    ok(/^\d{4}-\d{2}-\d{2}$/.test(OSF.FLOOR.decided), '裁定日期');
  });
  test('sync 把转换器默认的 15.0 / 10.14 抬到下限，更高的（widget 16.1 以上）不动，第二次幂等', () => {
    const src = 'IPHONEOS_DEPLOYMENT_TARGET = 15.0;\nMACOSX_DEPLOYMENT_TARGET = 10.14;\nIPHONEOS_DEPLOYMENT_TARGET = 17.0;\nMACOSX_DEPLOYMENT_TARGET = 10.15;\n';
    const a = patchDeploymentTargets(src);
    ok(a.src.includes('IPHONEOS_DEPLOYMENT_TARGET = 16.4;'), '15.0 → 16.4');
    ok(a.src.includes('IPHONEOS_DEPLOYMENT_TARGET = 17.0;'), '17.0 不动');
    eq((a.src.match(/MACOSX_DEPLOYMENT_TARGET = 13\.3;/g) || []).length, 2, '10.14 与 10.15 都抬到 13.3');
    ok(/3 处/.test(a.note), a.note);
    ok(/already/.test(patchDeploymentTargets(a.src).note), '幂等');
  });
  test('门能红：下限 15.0 时后行断言被抓到（文件:行），下限 16.4 时不报；注释里的不算', () => {
    const js = "// (?<=x) 注释里\nconst a = t.split(/(?<=[.!?])\\s+/u);\nconst b = 1;\n";
    const v = OSF.syntaxViolations(js, '15.0');
    eq(v.length, 1, JSON.stringify(v)); eq(v[0].line, 2, '行号'); eq(v[0].id, 'regex-lookbehind', 'id');
    eq(OSF.syntaxViolations(js, '16.4').length, 0, '16.4 已支持 ⇒ 不报');
    eq(OSF.syntaxViolations("class A { static { init(); } }", '16.0').length, 1, '静态块 16.4 起');
  });
  test('表里每条 since 都是版本号，且 cmp 正确', () => {
    for (const s of OSF.SYNTAX) ok(/^\d+\.\d+$/.test(s.since), s.id + ' 的 since');
    ok(OSF.cmp('16.4', '16.10') < 0 && OSF.cmp('17.0', '16.4') > 0 && OSF.cmp('13.3', '13.3') === 0, 'cmp');
  });
});

describe('sync-app-assets: 权限说明本地化（2026-09-18 国际 iOS 1.12.1 被拒 · Guideline 4）', () => {
  const R = path.resolve(__dirname, '..');
  const S = require('../scripts/sync-app-assets');
  const fs2 = require('fs');
  // 审核原话：「权限请求的文案与 App 的本地化语言不一致」—— 审核机是英文 iPad，App 界面是英文，
  // 弹窗却是中文。判据不是「有翻译」，而是：Info.plist 的默认值是英文，且 App 界面支持的每个语种都有一份。
  test('Info.plist 里三句权限说明的默认值是英文（CFBundleDevelopmentRegion = en 落到它）', () => {
    for (const k of ['NSMicrophoneUsageDescription', 'NSSpeechRecognitionUsageDescription', 'NSAudioCaptureUsageDescription']) {
      const row = S.PLIST_KEYS.find((x) => x.key === k);
      ok(row, k);
      ok(!/[一-鿿]/.test(row.xml), `${k} 的 Info.plist 默认值不该含中文：${row.xml.slice(0, 40)}`);
      ok(/^<string>[^<]{20,}<\/string>$/.test(row.xml), `${k} 是一句话`);
    }
  });
  test('lproj 清单与 extension/_locales 一一对应（zh_CN→zh-Hans、zh_TW→zh-Hant、pt_BR→pt-BR）', () => {
    const map = { zh_CN: 'zh-Hans', zh_TW: 'zh-Hant', pt_BR: 'pt-BR' };
    const want = fs2.readdirSync(path.join(R, 'extension', '_locales')).filter((d) => !d.startsWith('.')).map((d) => map[d] || d).sort();
    deepEq(Object.keys(S.PLIST_L10N).sort(), want);
  });
  test('每个语种三句都在、非空、不与英文相同（除 en）、zh-Hans 就是中文常量', () => {
    for (const [l, rows] of Object.entries(S.PLIST_L10N)) {
      eq(rows.length, 3, l);
      for (const r of rows) ok(typeof r === 'string' && r.trim().length > 10, `${l} 有空句`);
      if (l !== 'en') for (let i = 0; i < 3; i++) ok(rows[i] !== S.PLIST_L10N.en[i], `${l} 第 ${i} 句没翻，还是英文`);
    }
    ok(/实时字幕/.test(S.PLIST_L10N['zh-Hans'][0]) && /设备内置转写/.test(S.PLIST_L10N['zh-Hans'][1]), 'zh-Hans 是原来的中文文案');
  });
  test('生成的 .strings 转义了引号，且是合法的老式 strings（plutil -lint）', () => {
    for (const l of Object.keys(S.PLIST_L10N)) {
      const t = S.infoPlistStringsText(l);
      for (const k of S.PLIST_L10N_KEYS) ok(t.includes(`"${k}" = "`), `${l} 缺 ${k}`);
      // 每一行值里的裸引号都必须是 \" —— pt-BR 那份带直引号，最容易漏
      const bad = t.split('\n').filter((line) => /^"[A-Za-z]+" = "/.test(line)).filter((line) => {
        const val = line.slice(line.indexOf(' = "') + 4, -2);   // 去掉 `"KEY" = "` 与结尾 `";`
        return val.replace(/\\"/g, '').includes('"');
      });
      eq(bad.length, 0, `${l} 有没转义的引号：${bad.join(' | ')}`);
    }
    if (process.platform !== 'darwin') return;
    const { execFileSync } = require('child_process');
    const dir = fs2.mkdtempSync(path.join(require('os').tmpdir(), 'mt-strings-'));
    for (const l of Object.keys(S.PLIST_L10N)) {
      const f = path.join(dir, `${l}.strings`);
      fs2.writeFileSync(f, S.infoPlistStringsText(l));
      execFileSync('plutil', ['-lint', f], { stdio: 'pipe' });
    }
  });
  const PBX = [
    '/* Begin PBXBuildFile section */',
    '\t\tAAAA000000000000000000E4 /* Main.html in Resources */ = {isa = PBXBuildFile; fileRef = AAAA000000000000000000A9 /* Main.html */; };',
    '/* End PBXBuildFile section */',
    '/* Begin PBXFileReference section */',
    '/* End PBXFileReference section */',
    '/* Begin PBXGroup section */',
    '\t\tAAAA000000000000000000A8 /* Resources */ = {\n\t\t\tisa = PBXGroup;\n\t\t\tchildren = (\n\t\t\t\tAAAA000000000000000000A9 /* Main.html */,\n\t\t\t\tAAAA000000000000000000AB /* Icon.png */,\n\t\t\t);\n\t\t\tpath = Resources;\n\t\t};',
    '/* End PBXGroup section */',
    '\t\t\tknownRegions = (\n\t\t\t\ten,\n\t\t\t\tBase,\n\t\t\t);',
    '/* Begin PBXResourcesBuildPhase section */',
    '\t\tAAAA000000000000000000B4 /* Resources */ = {\n\t\t\tisa = PBXResourcesBuildPhase;\n\t\t\tfiles = (\n\t\t\t\tAAAA000000000000000000E4 /* Main.html in Resources */,\n\t\t\t);\n\t\t};',
    '\t\tAAAA000000000000000000C6 /* Resources */ = {\n\t\t\tisa = PBXResourcesBuildPhase;\n\t\t\tfiles = (\n\t\t\t\tAAAA000000000000000000E5 /* Main.html in Resources */,\n\t\t\t);\n\t\t};',
    '\t\tAAAA000000000000000000D2 /* Resources */ = {\n\t\t\tisa = PBXResourcesBuildPhase;\n\t\t\tfiles = (\n\t\t\t\tAAAA000000000000000000EE /* Assets.xcassets in Resources */,\n\t\t\t);\n\t\t};',
    '/* End PBXResourcesBuildPhase section */',
    '/* Begin PBXVariantGroup section */',
    '/* End PBXVariantGroup section */',
  ].join('\n');
  test('pbxproj：变体组进 Resources 组、两个 App target 的 Resources 阶段各挂一条、扩展的阶段不动、knownRegions 补齐、幂等', () => {
    const { src, note } = S.patchPbxprojInfoPlistStrings(PBX, ['en', 'zh-Hans', 'pt-BR']);
    match(note, /added \(3 lproj · 2 app targets\)/);
    eq((src.match(/\/\* InfoPlist\.strings in Resources \*\/,/g) || []).length, 2, '两个 App 阶段各一条');
    ok(!/Assets\.xcassets in Resources \*\/,\n\t\t\t\tMT1F/.test(src), '扩展 target 的阶段不该被挂');
    match(src, /AAAA000000000000000000A9 \/\* Main\.html \*\/,\n\t\t\t\tMT1F[0-9A-Z]+ \/\* InfoPlist\.strings \*\/,/);
    match(src, /isa = PBXVariantGroup;[\s\S]*?name = InfoPlist\.strings;/);
    match(src, /path = "zh-Hans\.lproj\/InfoPlist\.strings"/);
    match(src, /knownRegions = \(\n\t\t\t\ten,\n\t\t\t\tBase,\n\t\t\t\t"zh-Hans",\n\t\t\t\t"pt-BR",\n\t\t\t\);/);
    eq(S.patchPbxprojInfoPlistStrings(src, ['en', 'zh-Hans', 'pt-BR']).src, src, '第二次一字不改');
  });
  test('pbxproj：找不到两个 App 阶段就明说、不写', () => {
    const one = PBX.replace('AAAA000000000000000000E5 /* Main.html in Resources */', 'AAAA000000000000000000E5 /* Other */');
    const r = S.patchPbxprojInfoPlistStrings(one, ['en']);
    match(r.note, /^✗/); eq(r.src, one);
  });
});

// 快速翻译的菜单栏常驻（learning-design §9.9，2026-09-19）。
describe('sync-app-assets: 快速翻译的菜单栏常驻（learning-design §9.9）', () => {
  const R = path.resolve(__dirname, '..');
  const os = require('os');
  const tpl = fs.readFileSync(path.join(R, 'app', 'native', 'resident.swift'), 'utf8');
  const bar = fs.readFileSync(path.join(R, 'app', 'native', 'subtitle-bar.swift'), 'utf8');
  const { BLOCKS, patchDelegates, patchViewController } = require('../scripts/sync-app-assets.js');
  const code = (src) => src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  const TEMPLATE = 'import Cocoa\n\n@main\nclass AppDelegate: NSObject, NSApplicationDelegate {\n\n'
    + '    func applicationDidFinishLaunching(_ notification: Notification) {\n        // Override point for customization after application launch.\n    }\n\n'
    + '    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {\n        return true\n    }\n\n}\n';
  const tree = (appDelegate) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-resident-'));
    fs.mkdirSync(path.join(root, 'Shared (App)')); fs.mkdirSync(path.join(root, 'macOS (App)'));
    fs.writeFileSync(path.join(root, 'macOS (App)', 'AppDelegate.swift'), appDelegate);
    return { shared: path.join(root, 'Shared (App)'), read: () => fs.readFileSync(path.join(root, 'macOS (App)', 'AppDelegate.swift'), 'utf8') };
  };

  test('登记成标记块；整份只在 macOS 编译', () => {
    ok(BLOCKS.some((b) => b.src === 'resident.swift' && b.name === 'mt-resident'), 'BLOCKS 里有 mt-resident');
    const body = code(tpl).trim();
    ok(body.startsWith('#if os(macOS)') && body.endsWith('#endif'), '整份包在 #if os(macOS) … #endif 里');
  });
  test('原生那份文件里没有任何给用户看的文案 —— 菜单标题全部由页面给', () => {
    ok(!/[一-鿿]/.test(code(tpl).replace(/\/\/\/.*$/gm, '')), 'resident.swift 的代码里出现了中文字面量');
    ok(/labels\["open"\]/.test(tpl) && /labels\["settings"\]/.test(tpl) && /labels\["quit"\]/.test(tpl));
  });
  test('关窗不退出：模板 ⇒ 两个条件都在的那一行；再跑一遍不动', () => {
    const t = tree(TEMPLATE);
    const n1 = patchDelegates(t.shared);
    ok(!/✗/.test(n1), n1);
    ok(t.read().includes('return !(MTSubtitleBar.sessionActive || MTResident.keepAlive)'), t.read());
    const once = t.read(); const n2 = patchDelegates(t.shared);
    eq(t.read(), once, '第二遍改了文件'); ok(/already current/.test(n2), n2);
  });
  test('已经打过旧版补丁的树（只认字幕会话的那一行）⇒ 原地升级，不逼人重新生成工程；再跑一遍不动', () => {
    const old = TEMPLATE.replace('        return true\n', '        return !MTSubtitleBar.sessionActive\n');
    const t = tree(old);
    const n = patchDelegates(t.shared);
    ok(/subtitle session upgraded/.test(n) && !/✗/.test(n), n);
    ok(t.read().includes('return !(MTSubtitleBar.sessionActive || MTResident.keepAlive)'));
    const once = t.read(); patchDelegates(t.shared); eq(t.read(), once);
  });
  test('两种已知形状都不是 ⇒ 响亮地失败，而不是悄悄少一个条件', () => {
    const t = tree(TEMPLATE.replace('        return true\n', '        return false\n'));
    ok(/✗ macOS \(App\): subtitle session/.test(patchDelegates(t.shared)));
  });
  test('install 行只在 macOS 编进来，紧跟语音桥；幂等', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-resident-vc-'));
    const shared = path.join(root, 'Shared (App)'); fs.mkdirSync(shared);
    const vc = 'import WebKit\n\nclass ViewController {\n    func viewDidLoad() {\n        self.webView.configuration.userContentController.add(self, name: "controller")\n    }\n}\n';
    fs.writeFileSync(path.join(shared, 'ViewController.swift'), vc);
    patchViewController(shared);
    const out = fs.readFileSync(path.join(shared, 'ViewController.swift'), 'utf8');
    ok(/MTSpeechBridge\.shared\.install\(webView: self\.webView\)\n\s*#if os\(macOS\)\n\s*MTResident\.shared\.install\(webView: self\.webView\)\n\s*#endif/.test(out), 'install 行的形状不对');
    patchViewController(shared);
    eq((fs.readFileSync(path.join(shared, 'ViewController.swift'), 'utf8').match(/MTResident\.shared\.install/g) || []).length, 1, '第二遍又加了一行');
  });
  test('两个关闭守卫互不覆盖：字幕会话结束时只摘自己，被包着就把自己从链上剪出去', () => {
    ok(/if w\.delegate === g \{ w\.delegate = g\.original \}/.test(bar), '字幕条还在无条件地把 delegate 设回 original —— 会连常驻守卫一起摘掉');
    ok(/as\? MTResidentCloseGuard, outer\.original === g \{ outer\.original = g\.original \}/.test(bar), '没有从链上剪出自己');
    ok(/!w\.isVisible && !MTResident\.keepAlive/.test(bar), '常驻开着时，字幕会话结束不该把用户收起来的主窗口弹回来');
  });
  test('quick-host.js 的 PROTOCOL 与 resident.swift 逐字对表', () => {
    const src = fs.readFileSync(path.join(R, 'app', 'quick-host.js'), 'utf8');
    const grab = (k) => (src.match(new RegExp(k + ':\\s*\\[([^\\]]*)\\]')) || [])[1].match(/'([^']+)'/g).map((s) => s.slice(1, -1));
    const body = code(tpl);
    for (const v of grab('toNative')) ok(body.includes(`case "${v}":`), `toNative「${v}」在 resident.swift 里没有 case`);
    // 两条是面板页交来、由 quick-panel.swift 原样中继的：字面量在那份文件的 relay 分支里。
    const relayed = (code(fs.readFileSync(path.join(R, 'app', 'native', 'quick-panel.swift'), 'utf8')).match(/case ([^\n]*):\s*\n\s*MTResident\.shared\.relay\(body\)/) || [])[1] || '';
    for (const v of grab('fromNative')) ok(body.includes(`"${v}"`) || relayed.includes(`"${v}"`), `fromNative「${v}」既没有在 resident.swift 里发出，也不在 quick-panel.swift 的中继分支里`);
    deepEq(relayed.match(/"([^"]+)"/g).map((x) => x.slice(1, -1)).sort(), ['quick-capture', 'quick-result'], '中继的只该是这两条 —— 多一条就是面板页能直接指挥主页面');
    match(tpl, /static let channel = "mtQuick"/); ok(src.includes("const CHANNEL = 'mtQuick'"));
  });
  test('第一次关窗：先让页面说话，读完才收；之后直接收起', () => {
    ok(/if !seen \{[\s\S]*?"quick-first-close"[\s\S]*?return false/.test(tpl), '第一次关窗没有把事情交给页面');
    ok(/case "quick-close-main":\s*\n\s*seen = true\s*\n\s*mainWindowNow\(\)\?\.orderOut\(nil\)/.test(tpl));
    ok(/static var keepAlive: Bool \{ shared\.enabled \}/.test(tpl) && /private var enabled = false/.test(tpl), '页面还没发来配置之前必须是老行为（关窗即退出）');
  });
});

// ── 快速翻译面板（M-3）：面板页 ↔ quick-panel.swift 的协议镜像、零权限路径的三条纪律 ─────────────────
describe('quick panel — app/quick.js ↔ app/native/quick-panel.swift', () => {
  const R2 = path.join(__dirname, '..');
  const strip = (s) => s.replace(/\/\/.*$/gm, '');
  const swift = fs.readFileSync(path.join(R2, 'app', 'native', 'quick-panel.swift'), 'utf8');
  const hot = fs.readFileSync(path.join(R2, 'app', 'native', 'hotkey.swift'), 'utf8');
  const js = fs.readFileSync(path.join(R2, 'app', 'quick.js'), 'utf8');
  const grab = (k) => (js.match(new RegExp(k + ':\\s*\\[([^\\]]*)\\]')) || [])[1].match(/'([^']+)'/g).map((x) => x.slice(1, -1));
  test('面板页发的每一条，原生都有 case；原生发的每一条，面板页都认', () => {
    const body = strip(swift);
    const cases = [...body.matchAll(/case ((?:"[^"]+"(?:, )?)+):/g)].flatMap((m) => m[1].match(/"([^"]+)"/g).map((x) => x.slice(1, -1)));
    deepEq(cases.slice().sort(), grab('toNative').slice().sort(), 'toNative 与 swift 的 case 不是同一个集合');
    for (const v of grab('fromNative')) ok(body.includes(`"${v}"`) || v === 'quick-ocr', `fromNative「${v}」从未发出`);   // quick-ocr 在 M-6
    match(swift, /static let channel = "mtQuick"/); ok(js.includes("const CHANNEL = 'mtQuick'"));
  });
  test('两个块都在 BLOCKS 里、整份 #if os(macOS)、代码里没有给用户看的文案', () => {
    const { BLOCKS } = require(path.join(R2, 'scripts', 'sync-app-assets.js'));
    for (const [src, name] of [['hotkey.swift', 'mt-hotkey'], ['quick-panel.swift', 'mt-quick-panel']]) ok(BLOCKS.some((b) => b.src === src && b.name === name), name);
    for (const s of [swift, hot]) {
      const c = strip(s).trim(); ok(c.startsWith('#if os(macOS)') && c.endsWith('#endif'));
      ok(!/[一-鿿]/.test(strip(s).replace(/\/\/\/.*$/gm, '')), '代码里出现了中文字面量');
    }
  });
  test('隐藏 / 临时标记 ⇒ 根本不读文字（读文字的那一行只在 else 里）', () => {
    const body = strip(swift);
    ok(/org\.nspasteboard\.ConcealedType/.test(body) && /org\.nspasteboard\.TransientType/.test(body));
    eq((body.match(/pb\.string\(forType/g) || []).length, 1, '读剪贴板文字的地方只该有一处');
    ok(/if concealed \{\s*out\["concealed"\] = true\s*\} else \{[\s\S]*?pb\.string\(forType: \.string\)/.test(body), '读文字不在 concealed 的 else 分支里');
  });
  test('读剪贴板在后台队列 + 1 秒超时（剪贴板隐私开着时后台读取会卡住不返回）', () => {
    const body = strip(swift);
    ok(/DispatchQueue\.global\(qos: \.userInitiated\)\.async \{\s*let pb = NSPasteboard\.general/.test(body), '读取不在后台队列');
    ok(/asyncAfter\(deadline: \.now\(\) \+ 1\) \{ if !finished \{ finished = true; done\(\["blocked": true\]\) \} \}/.test(body), '没有超时出口');
  });
  test('自己复制出去的译文记下 changeCount ⇒ 下次报 own，不再翻一遍', () => {
    const body = strip(swift);
    ok(/ownChangeCount = pb\.changeCount/.test(body) && /if pb\.changeCount == own \{ out\["own"\] = true \}/.test(body));
    const C = require(path.join(R2, 'app', 'quick-core.js'));
    deepEq(C.classifyClipboard({ text: '译文', own: true }, 'Source text'), { kind: 'same', text: 'Source text' });
    eq(C.classifyClipboard({ text: '译文', own: true }, '').kind, 'ok', '没有上一次（App 刚重开）⇒ 照常翻');
  });
  test('钉住后 Esc 与点外面都不关；Esc 的全局占用只在面板可见且未钉住时', () => {
    const body = strip(swift);
    ok(/private func startDismissWatch\(\) \{\s*stopDismissWatch\(\)\s*guard !pinned else \{ return \}/.test(body));
    ok(/func hide\(\) \{\s*stopDismissWatch\(\)/.test(body), '收起时没有释放 Esc');
  });
  test('面板不是 key 窗口时，第一下点击就算数（不然复制 / 钉住 / 关闭要点两次）', () => {
    const body = strip(swift);
    ok(/final class MTQuickWebView: WKWebView \{\s*override func acceptsFirstMouse\(for event: NSEvent\?\) -> Bool \{ true \}/.test(body));
    ok(/let w = MTQuickWebView\(frame:/.test(body), '面板用的不是放开了第一下点击的那个子类');
  });
  test('常驻关 ⇒ 面板与快捷键一起拆掉', () => {
    const res = strip(fs.readFileSync(path.join(R2, 'app', 'native', 'resident.swift'), 'utf8'));
    ok(/MTQuickPanel\.shared\.enable\(\)/.test(res) && /MTQuickPanel\.shared\.disable\(\)/.test(res));
    ok(/func disable\(\) \{\s*enabledNow = false\s*unregisterHotkeys\(\)/.test(strip(swift)), '常驻关掉时三个全局快捷键都要放开');
    ok(/for id in \[MTQuickPanel\.hotkeyClipboard, MTQuickPanel\.hotkeyScreenshot, MTQuickPanel\.hotkeyInput\] \{ MTHotkey\.shared\.unregister\(id: id\) \}/.test(strip(swift)));
  });
});

// ── 快捷键可改 + 登录时启动（M-7）：原生那一半 ──────────────────────────────────────────────────────
describe('quick settings — 原生：按配置注册快捷键、回报冲突、登录时启动', () => {
  const R6 = path.join(__dirname, '..');
  const strip = (x) => x.replace(/\/\/.*$/gm, '');
  const panel = strip(fs.readFileSync(path.join(R6, 'app', 'native', 'quick-panel.swift'), 'utf8'));
  const res = strip(fs.readFileSync(path.join(R6, 'app', 'native', 'resident.swift'), 'utf8'));
  const login = strip(fs.readFileSync(path.join(R6, 'app', 'native', 'login-item.swift'), 'utf8'));
  const H = require(path.join(R6, 'app', 'hotkey-core.js'));
  test('原生的默认值 = 页面的默认值（页面还没发来配置之前用的就是它）', () => {
    ok(/"translate": Combo\(keyCode: UInt32\(kVK_ANSI_T\), modifiers: UInt32\(controlKey \| optionKey\), char: "t"\)/.test(panel));
    ok(/"shot": Combo\(keyCode: UInt32\(kVK_ANSI_S\), modifiers: UInt32\(controlKey \| optionKey\), char: "s"\)/.test(panel));
    ok(/"input": nil,/.test(panel));
    deepEq([H.wire(H.DEFAULTS.translate).char, H.wire(H.DEFAULTS.shot).char, H.DEFAULTS.input], ['t', 's', null]);
  });
  test('★ 录制时（paused）与常驻关着时一个都不注册 —— 不然用户按下现有的组合，Carbon 抢在网页之前吃掉它', () => {
    ok(/guard enabledNow, !hotkeysPaused else \{ return \[\] \}/.test(panel));
    ok(/hotkeysPaused = \(body\["paused"\] as\? Bool\) \?\? false/.test(panel));
  });
  test('没注册上的（别的 App 占了）要报回去；清掉的（null）不注册', () => {
    ok(/if !MTHotkey\.shared\.register\(id: id, keyCode: c\.keyCode, modifiers: c\.modifiers, action: action\) \{ failed\.append\(name\) \}/.test(panel));
    ok(/guard let c = hotkeys\[name\] \?\? nil else \{ continue \}/.test(panel));
    ok(/case "quick-hotkeys":\s*let failed = MTQuickPanel\.shared\.applyHotkeys\(body\)[\s\S]*?emit\(\["type": "quick-hotkeys-result", "failed": failed\]\)/.test(res));
  });
  test('菜单上写的是当前的快捷键，改了之后菜单跟着重建', () => {
    ok(/if let \(ch, flags\) = MTQuickPanel\.shared\.menuShortcut\(hotkey\) \{ it\.keyEquivalent = ch; it\.keyEquivalentModifierMask = flags \}/.test(res));
    ok(/applyHotkeys\(body\)\s*if item != nil \{ item\?\.menu = buildMenu\(\) \}/.test(res));
  });
  test('登录时启动：状态现读系统的、默认什么都不做、低版本 unsupported；登记成标记块', () => {
    const { BLOCKS } = require(path.join(R6, 'scripts', 'sync-app-assets.js'));
    ok(BLOCKS.some((b) => b.src === 'login-item.swift' && b.name === 'mt-login-item'));
    ok(login.trim().startsWith('#if os(macOS)') && login.trim().endsWith('#endif'));
    ok(/switch SMAppService\.mainApp\.status/.test(login) && /guard #available\(macOS 13\.0, \*\) else \{ return "unsupported" \}/.test(login));
    eq((login.match(/\.register\(\)/g) || []).length, 1); ok(/static func set\(_ on: Bool\)/.test(login), '只有用户拨开关才登记');
    ok(!/MTLoginItem\.set\(true\)/.test(res + panel), '任何地方都不许自己把登录项打开');
    ok(/"loginItem": MTLoginItem\.status/.test(res));
  });
});

// ── 截图翻译（M-6）：screen-ocr.swift 的不变量，对着源码钉 ───────────────────────────────────────────
describe('quick screenshot — app/native/screen-ocr.swift', () => {
  const R5 = path.join(__dirname, '..');
  const strip = (x) => x.replace(/\/\/.*$/gm, '');
  const c = strip(fs.readFileSync(path.join(R5, 'app', 'native', 'screen-ocr.swift'), 'utf8'));
  const panel = strip(fs.readFileSync(path.join(R5, 'app', 'native', 'quick-panel.swift'), 'utf8'));
  const res = strip(fs.readFileSync(path.join(R5, 'app', 'native', 'resident.swift'), 'utf8'));
  test('登记成标记块、整份 #if os(macOS)、没有给用户看的文案', () => {
    const { BLOCKS } = require(path.join(R5, 'scripts', 'sync-app-assets.js'));
    ok(BLOCKS.some((b) => b.src === 'screen-ocr.swift' && b.name === 'mt-screen-ocr'));
    ok(c.trim().startsWith('#if os(macOS)') && c.trim().endsWith('#endif'));
    ok(!/[一-鿿]/.test(c.replace(/\/\/\/.*$/gm, '')));
  });
  test('① 截图不落盘：全文件没有任何写文件 / 写剪贴板的调用', () => {
    for (const bad of ['write(to', 'writeToFile', 'FileManager', 'createFile', 'CGImageDestination', 'NSPasteboard', 'NSSavePanel', 'temporaryDirectory', 'NSTemporaryDirectory'])
      ok(c.indexOf(bad) < 0, '出现了 ' + bad);
  });
  test('② 像素只经一条路离开原生：用户点了「用我的识图引擎再试」（quick-ocr-cloud）', () => {
    eq((panel.match(/lastImageDataURL\(\)/g) || []).length, 1, '把截图编码交出去的调用点只该有一处');
    ok(/case "quick-ocr-cloud":\s*send\(\["type": "quick-image", "dataUri": MTScreenShot\.shared\.lastImageDataURL\(\) \?\? ""\]\)/.test(panel));
    ok(!/lastImageDataURL/.test(res), '主页面那一头拿不到截图');
    ok(/func hide\(\) \{\s*stopDismissWatch\(\)\s*MTScreenShot\.shared\.discardImage\(\)/.test(panel), '面板收起时该丢弃截图');
    ok(/func pickRegion[\s\S]*?lastImage = nil/.test(c), '下一次框选开始时该丢弃上一张');
  });
  test('③ 只截框的那一块（sourceRect），我们自己的窗口不进截图；坐标从左下原点换到左上原点', () => {
    ok(/cfg\.sourceRect = CGRect\(x: rect\.minX, y: top, width: rect\.width, height: rect\.height\)/.test(c));
    ok(/let top = screen\.frame\.height - rect\.maxY/.test(c));
    ok(/excludingApplications: mine/.test(c) && /\$0\.bundleIdentifier == Bundle\.main\.bundleIdentifier/.test(c));
    ok(/cfg\.width = Int\(rect\.width \* scale\)/.test(c) && /cfg\.showsCursor = false/.test(c));
  });
  test('框选层不抢焦点：是不激活 App 的面板（普通窗口一成为键盘窗口就把主窗口带到前面 —— 真机实测）', () => {
    ok(/final class MTShotOverlayWindow: NSPanel \{/.test(c));
    ok(/styleMask: \[\.borderless, \.nonactivatingPanel\]/.test(c) && /hidesOnDeactivate = false/.test(c));
    ok(!/NSApp\.activate|activate\(ignoringOtherApps/.test(c), '这份文件里不许激活 App');
  });
  test('④ 小于 12 × 12 当误触、Esc 取消：都不截、不出面板', () => {
    ok(/guard let r = rect, r\.width >= 12, r\.height >= 12 else \{ done\?\(nil\); return \}/.test(c));
    ok(/if event\.keyCode == 53 \{ pick\(nil, target\) \}/.test(c));
    ok(/guard let s = self, let image = image else \{ return \}/.test(panel), '取消之后面板不该出现');
  });
  test('第二道系统框只在 macOS 15 起才有 ⇒ 由原生告诉页面会不会有，页面才预告', () => {
    ok(/static var asksAgainOnFirstCapture: Bool \{ if #available\(macOS 15\.0, \*\) \{ return true \} else \{ return false \} \}/.test(c));
    ok(/"second": MTScreenShot\.asksAgainOnFirstCapture/.test(panel));
  });
  test('⑤ 权限只用系统的请求接口；没有权限 ⇒ 不框选，面板里先说话（入口不消失）', () => {
    ok(/CGRequestScreenCaptureAccess\(\)/.test(c) && /CGPreflightScreenCaptureAccess\(\)/.test(c));
    ok(/guard MTScreenShot\.granted else \{[\s\S]*?"perm": "screen"[\s\S]*?return\s*\}\s*hide\(\)\s*MTScreenShot\.shared\.pickRegion/.test(panel));
  });
  test('识别：行框换成左上原点再交出去；第一次要准备模型 ⇒ 记下「跑过了」并在空闲时预热（预热用的是自己画的图）', () => {
    ok(/"y": 1 - b\.maxY/.test(c), 'Vision 的原点在左下，HandoffCore.assembleLines 要的是左上');
    ok(/UserDefaults\.standard\.set\(true, forKey: warmKey\)/.test(c) && /"first": !MTScreenShot\.visionWarm/.test(panel));
    ok(/static func prewarmIfNeeded\(\) \{\s*guard supported, !visionWarm else \{ return \}/.test(c));
    const warm = c.slice(c.indexOf('static func prewarmIfNeeded'), c.indexOf('func lastImageDataURL'));
    ok(!/SCScreenshotManager|SCShareableContent|CGWindowList/.test(warm), '预热不许碰屏幕');
  });
  test('macOS 低于 14 ⇒ 入口整个不出现：热键不注册、菜单里没有这一项、能力回执里 sck:false', () => {
    ok(/static var supported: Bool \{ if #available\(macOS 14\.0, \*\) \{ return true \} else \{ return false \} \}/.test(c));
    ok(/if name == "shot" && !MTScreenShot\.supported \{ continue \}/.test(panel), '低版本系统上截图的快捷键不该注册');
    ok(/if MTScreenShot\.supported \{ m\.addItem\(item\("shot"/.test(res) && /"sck": MTScreenShot\.supported/.test(res));
  });
});

// ── 增强取词（M-5）：capture.swift 的四条不变量，对着源码钉 ─────────────────────────────────────────
describe('quick capture — app/native/capture.swift', () => {
  const R4 = path.join(__dirname, '..');
  const strip = (x) => x.replace(/\/\/.*$/gm, '');
  const raw = fs.readFileSync(path.join(R4, 'app', 'native', 'capture.swift'), 'utf8');
  const c = strip(raw);
  const panel = strip(fs.readFileSync(path.join(R4, 'app', 'native', 'quick-panel.swift'), 'utf8'));
  const at = (needle) => { const i = c.indexOf(needle); ok(i >= 0, '找不到：' + needle); return i; };
  test('登记成标记块、整份 #if os(macOS)、没有给用户看的文案', () => {
    const { BLOCKS } = require(path.join(R4, 'scripts', 'sync-app-assets.js'));
    ok(BLOCKS.some((b) => b.src === 'capture.swift' && b.name === 'mt-capture'));
    ok(c.trim().startsWith('#if os(macOS)') && c.trim().endsWith('#endif'));
    ok(!/[一-鿿]/.test(c.replace(/\/\/\/.*$/gm, '')));
  });
  test('① 先记下剪贴板，再按 ⌘C；剪贴板变过之后、任何一条返回之前，都先原样写回', () => {
    ok(at('let before = snapshot(pb)') < at('down?.post(tap: .cghidEventTap)'), '快照必须在按键之前');
    const gate = 'if pb.changeCount == count { finish(.text("")); return }';
    const changed = c.slice(at(gate) + gate.length);
    ok(changed.indexOf('restore(before, to: pb)') >= 0, '变过之后没有写回');
    ok(changed.indexOf('restore(before, to: pb)') < changed.indexOf('finish('), '写回必须在交结果之前 —— 面板一出来，剪贴板就已经是原样');
    eq((changed.match(/finish\(/g) || []).length, 2, '变过之后只该有两种结果：文字 / 隐藏');
  });
  test('② 0.3 秒内没变 ⇒ 交空文字；**这条分支里不读剪贴板**（绝不退回去翻旧剪贴板）', () => {
    ok(/while pb\.changeCount == count, Date\(\)\.timeIntervalSince\(t1\) < 0\.3/.test(c));
    ok(/if pb\.changeCount == count \{ finish\(\.text\(""\)\); return \}/.test(c));
    const before = c.slice(0, at('if pb.changeCount == count { finish(.text("")); return }'));
    ok(!/pb\.string\(forType/.test(before), '在确认剪贴板变过之前就读了文字');
  });
  test('③ 带隐藏 / 临时标记 ⇒ 根本不读文字；全文件读文字的地方只有一处', () => {
    ok(/org\.nspasteboard\.ConcealedType/.test(c) && /org\.nspasteboard\.TransientType/.test(c));
    ok(/let got = concealed \? nil : \(pb\.string\(forType: \.string\) \?\? ""\)/.test(c));
    eq((c.match(/pb\.string\(forType/g) || []).length, 1);
  });
  test('④ 整个过程在后台队列、总时限 1 秒；回调恒在主线程、恒只来一次', () => {
    ok(/DispatchQueue\.main\.asyncAfter\(deadline: \.now\(\) \+ 1\) \{ if !finished \{ finished = true; done\(\.blocked\) \} \}/.test(c));
    ok(/DispatchQueue\.global\(qos: \.userInitiated\)\.async \{\s*let pb = NSPasteboard\.general/.test(c));
    ok(/DispatchQueue\.main\.async \{ if !finished \{ finished = true; done\(o\) \} \}/.test(c));
  });
  test('按键只带 ⌘；先等用户松开快捷键的修饰键（不然宿主收到的是 ⌃⌥⌘C）', () => {
    eq((c.match(/\.flags = \.maskCommand/g) || []).length, 2);
    ok(at('flagsState(.combinedSessionState)') < at('down?.post(tap: .cghidEventTap)'));
  });
  test('用的是系统的请求接口；全仓库没有任何地方教用户手动把 App 加进列表', () => {
    ok(/CGRequestPostEventAccess\(\)/.test(c) && /CGPreflightPostEventAccess\(\)/.test(c));
    ok(!/AXIsProcessTrusted|kAXTrustedCheckOptionPrompt|AXUIElement/.test(c), '不读别的 App 的选区：沙盒里不可用，也过不了审');
  });
  test('快捷键：想开且**此刻**权限在 ⇒ 取词；否则落回剪贴板 —— 每次按键都重新读权限', () => {
    ok(/func hotkeyPressed\(\) \{\s*if enhanced && MTQuickCapture\.granted \{ translateSelection\(\) \} else \{ translateClipboard\(\) \}/.test(panel));
    ok(/static var granted: Bool \{ CGPreflightPostEventAccess\(\) \}/.test(c), 'granted 必须是现读的，不能缓存');
    ok(/\{ \[weak self\] in self\?\.hotkeyPressed\(\) \}/.test(panel));
  });
});

// ── 右键「服务」（M-4）：Info.plist 条目、12 语种菜单名、提供方 ─────────────────────────────────────
describe('quick services — NSServices / ServicesMenu.strings / services.swift', () => {
  const R3 = path.join(__dirname, '..');
  const S3 = require(path.join(R3, 'scripts', 'sync-app-assets.js'));
  const strip = (x) => x.replace(/\/\/.*$/gm, '');
  const swift = fs.readFileSync(path.join(R3, 'app', 'native', 'services.swift'), 'utf8');
  const PLIST = '<?xml version="1.0"?>\n<plist version="1.0">\n<dict>\n\t<key>CFBundleName</key>\n\t<string>x</string>\n</dict>\n</plist>\n';
  test('★ 条目里有 NSRequiredContext —— 没有它，服务「已登记、默认不启用、菜单里找不到、无报错」（T2 实测）', () => {
    const xml = S3.servicesXml();
    ok(/<key>NSRequiredContext<\/key>\s*<dict\/>/.test(xml), '缺 NSRequiredContext');
    ok(xml.includes('<string>$(PRODUCT_NAME)</string>'), 'NSPortName 必须等于 App 名；两个 flavor 名字不同，所以用构建变量');
    ok(xml.includes('<string>NSStringPboardType</string>') && xml.includes('<string>public.utf8-plain-text</string>'));
  });
  test('只进 macOS App 的 Info.plist；第二遍一字不改', () => {
    const entry = S3.PLIST_KEYS.find((k) => k.key === 'NSServices');
    eq(entry.only, 'macOS (App)');
    const once = S3.patchPlistXml(PLIST, [entry]);
    ok(once.xml.includes('<key>NSServices</key>') && once.added.join() === 'NSServices');
    eq(S3.patchPlistXml(once.xml, [entry]).xml, once.xml);
  });
  test('NSMessage = Swift 里 @objc 方法名的第一段；方法签名是 AppKit 规定的三段式', () => {
    ok(S3.servicesXml().includes(`<string>${S3.SERVICE_MESSAGE}</string>`));
    ok(new RegExp('@objc func ' + S3.SERVICE_MESSAGE + '\\(_ pboard: NSPasteboard, userData: String\\?, error: AutoreleasingUnsafeMutablePointer<NSString>\\)').test(swift));
  });
  test('菜单名：与权限文案同一份 12 个 lproj；default 的英文就是 .strings 的键；非英文都翻了', () => {
    deepEq(Object.keys(S3.SERVICES_L10N), Object.keys(S3.PLIST_L10N));
    eq(S3.SERVICES_L10N.en, S3.SERVICE_TITLE_EN);
    ok(S3.servicesXml().includes(`<string>${S3.SERVICE_TITLE_EN}</string>`));
    for (const [l, v] of Object.entries(S3.SERVICES_L10N)) {
      if (l !== 'en') ok(v !== S3.SERVICE_TITLE_EN && v.trim().length > 3, l + ' 没翻');
      ok(S3.servicesMenuStringsText(l).includes(`"${S3.SERVICE_TITLE_EN}" = "${v}";`), l);
    }
    ok(/大肚猴/.test(S3.SERVICES_L10N['zh-Hans']) && /BelliedMonkey/.test(S3.SERVICES_L10N.ja), '品牌名：中文里是「大肚猴」，其余不译');
  });
  test('生成的 .strings 是合法的老式 strings（plutil -lint）', () => {
    const os2 = require('os'); const cp = require('child_process');
    if (process.platform !== 'darwin') return;
    const d = fs.mkdtempSync(path.join(os2.tmpdir(), 'mt-svc-'));
    try { for (const l of Object.keys(S3.SERVICES_L10N)) { const f = path.join(d, l + '.strings'); fs.writeFileSync(f, S3.servicesMenuStringsText(l)); cp.execFileSync('plutil', ['-lint', f], { stdio: 'pipe' }); } }
    finally { fs.rmSync(d, { recursive: true, force: true }); }
  });
  test('变体组补丁：两份 .strings 各挂各的、ID 段不撞、各自幂等', () => {
    const PBX2 = ['/* Begin PBXBuildFile section */', '/* End PBXBuildFile section */', '/* Begin PBXFileReference section */', '/* End PBXFileReference section */',
      '/* Begin PBXVariantGroup section */', '/* End PBXVariantGroup section */', '\t\t\tchildren = (', '\t\t\t\tAAAAAAAAAAAAAAAAAAAAAAAA /* Main.html */,', '\t\t\t);',
      '\t\t\tfiles = (', '\t\t\t\tBBBBBBBBBBBBBBBBBBBBBBBB /* Main.html in Resources */,', '\t\t\t);', '\t\t\tfiles = (', '\t\t\t\tCCCCCCCCCCCCCCCCCCCCCCCC /* Main.html in Resources */,', '\t\t\t);',
      '\t\t\tknownRegions = (', '\t\t\t\ten,', '\t\t\t\tBase,', '\t\t\t);', ''].join('\n');
    const a = S3.patchPbxprojInfoPlistStrings(PBX2, ['en', 'zh-Hans']);
    const b = S3.patchPbxprojStringsGroup(a.src, ['en', 'zh-Hans'], 'ServicesMenu.strings', 100);
    ok(!/✗/.test(a.note + b.note), a.note + ' | ' + b.note);
    eq((b.src.match(/ServicesMenu\.strings in Resources \*\/,/g) || []).length, 2, '两个 App target 的 Resources 阶段各一条');
    eq((b.src.match(/InfoPlist\.strings in Resources \*\/,/g) || []).length, 2, '挂第二份不能碰第一份');
    const ids = b.src.match(/MT1F0057A1B9\d{12}(?= \/\* [^*]+ \*\/ = \{)/g); eq(new Set(ids).size, ids.length, 'ID 撞了：' + ids.join());
    eq(S3.patchPbxprojStringsGroup(b.src, ['en', 'zh-Hans'], 'ServicesMenu.strings', 100).src, b.src, '第二遍一字不改');
    eq(S3.patchPbxprojInfoPlistStrings(b.src, ['en', 'zh-Hans']).src, b.src);
  });
  test('提供方：登记成标记块、整份 #if os(macOS)、没有给用户看的文案', () => {
    ok(S3.BLOCKS.some((x) => x.src === 'services.swift' && x.name === 'mt-services'));
    const c = strip(swift).trim(); ok(c.startsWith('#if os(macOS)') && c.endsWith('#endif'));
    ok(!/[一-鿿]/.test(strip(swift).replace(/\/\/\/.*$/gm, '')));
  });
  test('把焦点还给刚才那个 App；「刚才那个」来自激活通知（回调时最前面的已经是我们自己）', () => {
    const c = strip(swift);
    // 冷启动：App 正是被这次调用拉起来的，激活通知一条都没收到过 —— 登记的那一刻先记下最前面的 App（真机实测：不记就没处还焦点）
    ok(/installed = true\s*if let front = NSWorkspace\.shared\.frontmostApplication, front\.bundleIdentifier != Bundle\.main\.bundleIdentifier \{\s*lastOther = front/.test(c.replace(/\n\s*\n/g, '\n')), '冷启动没有先记下最前面的 App');
    ok(/didActivateApplicationNotification/.test(c) && /app\.bundleIdentifier != Bundle\.main\.bundleIdentifier/.test(c));
    ok(/lastOther\?\.activate\(\)\s*\n\s*MTQuickPanel\.shared\.translateFromService\(text\)/.test(c), '该先还焦点、再出面板');
  });
  test('服务是用户明确点的：不看常驻开关；一启动就登记；页面随后发来的「常驻关着」拆不掉正在用的面板', () => {
    const panel = strip(fs.readFileSync(path.join(R3, 'app', 'native', 'quick-panel.swift'), 'utf8'));
    const res = strip(fs.readFileSync(path.join(R3, 'app', 'native', 'resident.swift'), 'utf8'));
    ok(/"via": "service", "origin": "service", "text": text\], focus: false, force: true\)/.test(panel));
    ok(/guard web == nil, force \|\| MTResident\.keepAlive,/.test(panel));
    ok(/if panel\?\.isVisible == true \|\| !pending\.isEmpty \{ return \}/.test(panel));
    ok(/func install\(webView: WKWebView\) \{[\s\S]*?MTQuickServices\.shared\.install\(\)/.test(res));
  });
});

// ── 快速翻译面板页（learning-design §9.9）：同一份包以 #quick 加载时，加载即自启动的模块整段不执行 ──────
describe('app bundle — 面板页不启动主壳（MAIN_ONLY）', () => {
  const ROOT = path.join(__dirname, '..');
  const src = fs.readFileSync(path.join(ROOT, 'build/app-bundle.js'), 'utf8');
  test('面板的两个模块在 MODULES 里，且 HandoffCore 先于 AppQuick', () => {
    const a = src.indexOf("'app/quick-core.js'"), b = src.indexOf("'app/quick.js'");
    ok(a > 0 && b > a, '顺序：quick-core → quick');
  });
  test('review.js 被列为 MAIN_ONLY —— 它与扩展同字节、加载即开学习库并发心跳', () => {
    ok(/const MAIN_ONLY = new Set\(\[[^\]]*'extension\/learn\/review\.js'/.test(src));
  });
  test('包出来的守卫是一段能执行的正则（转义没有在模板里丢一层）', () => {
    const m = src.match(/const PANEL_HASH_TEST = (".*");/); ok(m, '找不到 PANEL_HASH_TEST');
    const expr = JSON.parse(m[1]);
    const run = (hash) => new Function('location', 'return ' + expr)({ hash });
    eq(run('#quick'), true); eq(run('#quick?x'), true); eq(run(''), false); eq(run('#quickly'), false); eq(run('#settings'), false);
  });
  test('app.js 的两处副作用都在 #quick 下让路：IIFE 第一行返回 + 末尾的遥测初始化', () => {
    const app = fs.readFileSync(path.join(ROOT, 'app/app.js'), 'utf8');
    ok(/AppQuick\.isQuickMode\(\)\) \{ AppQuick\.boot\(\); return; \}/.test(app));
    ok(/MTTelemetry !== 'undefined' && !\(typeof AppQuick !== 'undefined' && AppQuick\.isQuickMode\(\)\)\) MTTelemetry\.init/.test(app));
  });
});

// 系统翻译扩展本身（learning-design §9.9 / iOS 线 I-5b）。
//
// 这一节守的不是「代码对不对」（那由 xcodebuild 回答，见 PR 里的读数），而是几件
// **做错了不会报错**的事：组名写死成一个 flavor、entitlements 多给一项、联网键写错位置、
// 文案与产品里已有的那几句各说各的。
describe('sync-app-assets: 系统翻译扩展（I-5b）', () => {
  const ROOT = path.join(__dirname, '..');
  const NATIVE = path.join(ROOT, 'app', 'native');
  const ENT = path.join(NATIVE, 'entitlements');

  test('★ 组名跟着 flavor 走 —— 两个 App 共用一个组 = 互相看得见对方的 key', () => {
    for (const f of ['ios-app.entitlements', 'translate-ext.entitlements']) {
      const s = fs.readFileSync(path.join(ENT, f), 'utf8');
      const body = s.slice(s.indexOf('<plist'));
      ok(body.includes('group.__MT_APP_BUNDLE_ID__'), f + ' 的 App Group 要用占位符');
      ok(body.includes('$(AppIdentifierPrefix)__MT_APP_BUNDLE_ID__.shared'), f + ' 的钥匙串组要用占位符');
      ok(!/group\.com\.belliedmonkeytranslator/.test(body), f + ' 里不许写死 bundle id');
    }
  });

  test('★ 扩展的 entitlements 只有两项 —— translation-app 与 applesignin 属于宿主', () => {
    const s = fs.readFileSync(path.join(ENT, 'translate-ext.entitlements'), 'utf8');
    const body = s.slice(s.indexOf('<plist'));
    ok(body.includes('application-groups') && body.includes('keychain-access-groups'));
    for (const k of ['translation-app', 'applesignin']) {
      ok(!body.includes(k), '扩展不该有 ' + k + '（多一项能力 = 审核多一个要解释的点）');
    }
  });

  test('★ 联网键写在**宿主 App** 的 Info.plist —— 写在扩展里三个地址一律 -1009，且不报权限错', () => {
    const row = PLIST_KEYS.find((k) => k.key === 'com.apple.developer.translation-ui-provider.network-access');
    ok(row, '这个键要在 PLIST_KEYS 里');
    eq(row.only, 'iOS (App)', 'Apple 文档那句 “your app’s Info.plist” 是字面意思（T1 实测）');
    // 扩展自己的 plist 里不许有它 —— 那正是尖刺里连不上的那一版
    ok(!TRANSLATE_EXT_SPEC.plist.includes('network-access'), '扩展的 plist 里不该有联网键');
  });

  test('★ 扩展点声明用 ExtensionKit 那一套，且带着这棵树的 scheme', () => {
    ok(TRANSLATE_EXT_SPEC.plist.includes('EXAppExtensionAttributes'));
    ok(TRANSLATE_EXT_SPEC.plist.includes('com.apple.public.translation-ui-provider'));
    ok(!TRANSLATE_EXT_SPEC.plist.includes('NSExtension'), 'ExtensionKit 不用 NSExtension');
    ok(TRANSLATE_EXT_SPEC.plist.includes('__MT_SCHEME__'), '深链 scheme 要按 flavor 替换');
    eq(TRANSLATE_EXT_SPEC.productType, 'com.apple.product-type.extensionkit-extension');
    eq(TRANSLATE_EXT_SPEC.embed, EMBED_EXTENSIONKIT);
    eq(TRANSLATE_EXT_SPEC.deploy, '18.4', 'TranslationUIProvider 从 iOS 18.4 才有');
  });

  test('★ 弹层标题栏那一行是宿主 App 名，不是 MTTranslateExt', () => {
    if (!fs.existsSync(path.join(ROOT, 'safari-project/BelliedMonkey Translator/BelliedMonkey Translator.xcodeproj/project.pbxproj'))) return;
    ok(TRANSLATE_EXT_SPEC.settings.INFOPLIST_KEY_CFBundleDisplayName.includes('__MT_APP_DISPLAY_NAME__'),
      '显示名要从工程里取，不在这份脚本里抄一份中文字面量');
    const REALPBX = fs.readFileSync(path.join(ROOT, 'safari-project/BelliedMonkey Translator/BelliedMonkey Translator.xcodeproj/project.pbxproj'), 'utf8');
    const dir = tmpdir();
    fs.mkdirSync(path.join(dir, 'Shared (App)'), { recursive: true });
    const proj = path.join(dir, 'X.xcodeproj'); fs.mkdirSync(proj);
    let skel = REALPBX;
    for (const sp of [WIDGET_SPEC, TRANSLATE_EXT_SPEC]) skel = stripExtensionTarget(skel, sp);
    const pbx = path.join(proj, 'project.pbxproj');
    fs.writeFileSync(pbx, skel);
    patchExtensionTarget(path.join(dir, 'Shared (App)'), TRANSLATE_EXT_SPEC);
    const out = fs.readFileSync(pbx, 'utf8');
    const at = out.lastIndexOf(`INFOPLIST_FILE = "${TRANSLATE_EXT_SPEC.dir}/Info.plist";`);
    const line = out.slice(at, at + 200).split('\n')[1];
    ok(!line.includes('$(PRODUCT_NAME)') && !line.includes(TRANSLATE_EXT_SPEC.name),
      '系统用它画弹层标题栏，写内部名等于给用户看一个他不认得的词：' + line.trim());

    // 已经造过的树也要跟上 —— 「见到 needle 就跳过」会让后来改的设置永远追不上
    fs.writeFileSync(pbx, out.replace(
      new RegExp('(INFOPLIST_FILE = "iOS \\(TranslateExt\\)\\/Info\\.plist";\\n\\s*INFOPLIST_KEY_CFBundleDisplayName = )"[^"]*";', 'g'),
      '$1"$(PRODUCT_NAME)";'));
    const note = patchExtensionTarget(path.join(dir, 'Shared (App)'), TRANSLATE_EXT_SPEC);
    match(note, /显示名已升到/, '已有的树要原地升级，实际回执：' + note);
    ok(!fs.readFileSync(pbx, 'utf8').includes('INFOPLIST_KEY_CFBundleDisplayName = "$(PRODUCT_NAME)"'));
  });

  test('★ mtVault 的 PROTOCOL 与 vault-bridge.swift 逐字对表（含收件箱）', () => {
    const js = fs.readFileSync(path.join(ROOT, 'app', 'vault-mirror.js'), 'utf8');
    const sw = fs.readFileSync(path.join(NATIVE, 'vault-bridge.swift'), 'utf8');
    const grab = (k) => (js.match(new RegExp(k + ":\\s*\\[([^\\]]*)\\]")) || [])[1].match(/'([^']+)'/g).map((x) => x.slice(1, -1));
    const toNative = grab('toNative'); const fromNative = grab('fromNative');
    ok(toNative.includes('inbox-drain') && toNative.includes('inbox-ack') && toNative.includes('inbox-clear'));
    ok(fromNative.includes('inbox-batch'));
    for (const v of toNative) ok(sw.includes('case "' + v + '":'), 'toNative「' + v + '」在 .swift 里没有 case');
    for (const v of fromNative) ok(sw.includes('"' + v + '"'), 'fromNative「' + v + '」在 .swift 里从未发出');
  });

  test('★ 收件箱的上限与门与 app/handoff.js 同一套 —— 两处各写一套就是两种行为', () => {
    const sw = fs.readFileSync(path.join(NATIVE, 'translate-ext', 'ExtInbox.swift'), 'utf8');
    const js = fs.readFileSync(path.join(ROOT, 'app', 'handoff.js'), 'utf8');
    ok(sw.includes('maxChars = 2000'), '单条上限要与 handoff.js 的 MAX_CHARS 一致');
    ok(js.includes('MAX_CHARS = 2000'));
    ok(sw.includes('maxFiles = 200') && sw.includes('maxBytes = 512 * 1024'), '200 条 / 512 KB');
    // 失败路径永不写（Collector law 2）：写入只在译文非空、且与原文不同时发生
    ok(sw.includes('t != r'), '译文等于原文不写');
    ok(sw.includes('options: [.atomic]'), '原子写 —— 读的那一侧随时可能在扫目录');
    // 两把开关都要看（learnEnabled 是总闸，handoffCapture 是这个入口的）
    const view = fs.readFileSync(path.join(NATIVE, 'translate-ext', 'TranslateExt.swift'), 'utf8');
    ok(/guard config\.learnEnabled, config\.handoffCapture else \{ return \}/.test(view),
      '两把开关都开着才写；关着就整个不写，不留看不见的积压');
    const cap = view.slice(view.indexOf('private func capture('));
    ok(!cap.includes('failCode'), '失败路径永不写');
  });

  test('★ ack 只认文件名本身 —— 一个能删任意路径的口子不该存在', () => {
    const sw = fs.readFileSync(path.join(NATIVE, 'vault-bridge.swift'), 'utf8');
    const ack = sw.slice(sw.indexOf('private func ack(names:'), sw.indexOf('private func clearInbox'));
    ok(ack.includes('!n.contains("/")') && ack.includes('!n.contains("..")'), '路径分隔符与 .. 都要挡');
  });

  // 2026-09-20 重新生成工程时才发现的：转换器（Xcode 27）不再输出
  // `packageProductDependencies = ();` 这一行，而离线朗读的包补丁原来只会往已有的空列表里塞。
  // 停下来是对的，但停下之后没人能往前走 —— 构建报的是
  // `Unable to resolve module dependency: 'SherpaOnnxC'`，离真因隔着两层。
  // 这个洞能躺这么久，是因为工程树是 gitignored 的一次性产物：升级 Xcode 之后没人重新生成过。
  test('★ 转换器不给空列表时也要挂得上 sherpa 包（两种形状都认）', () => {
    const P = path.join(ROOT, 'safari-project/BelliedMonkey Translator/BelliedMonkey Translator.xcodeproj/project.pbxproj');
    if (!fs.existsSync(P)) return;
    const real = fs.readFileSync(P, 'utf8');
    // 从真工程里剥掉这个补丁自己的痕迹，得到「还没挂过」的两种形状
    const bare = real.replace(/\n[^\n]*MT10D06CA57E00000000(31|32)[^\n]*/g, '')
      .replace(/\n\/\* (Begin|End) XCLocalSwiftPackageReference section \*\//g, '')
      .replace(/\n\/\* (Begin|End) XCSwiftPackageProductDependency section \*\//g, '')
      .replace(/\n\t\t\tpackageReferences = \(\n\t\t\t\);/g, '');
    const withEmpty = bare.replace(/(\t\t\tname = "([^"]*) \((iOS|macOS)\)";\n)/g,
      (m, head, base) => (/Extension/.test(base) ? m : head + '\t\t\tpackageProductDependencies = (\n\t\t\t);\n'));
    for (const [what, src] of [['没有空列表（Xcode 27）', bare], ['有空列表（老转换器）', withEmpty]]) {
      const r = patchSwiftPackageText(src, '../../../app/native/vendor/sherpa-onnx');
      match(r.note, /sherpa package patched \(2 App targets\)/, what);
      eq((r.src.match(/MT10D06CA57E0000000032 \/\* sherpa-onnx \*\//g) || []).length, 3,
        what + '：两个 App target 各一条引用 + 一个对象定义');
      ok(!/Extension \((iOS|macOS)\)";\n\t\t\tpackageProductDependencies/.test(r.src),
        what + '：扩展 target 不该链接它');
    }
  });

  test('★ 拆掉重造 = 重新生成：剥掉再打一遍，与真工程逐字节相同', () => {
    const P = path.join(ROOT, 'safari-project/BelliedMonkey Translator/BelliedMonkey Translator.xcodeproj/project.pbxproj');
    if (!fs.existsSync(P)) return;
    const real = fs.readFileSync(P, 'utf8');
    // 规格里的源文件清单变了时，生产代码走的就是这条路（id 是按序号算的，中间插一个
    // 文件会让后面每一个都错位，所以不能缝补）。判据必须是**逐字节**：剥得不干净的
    // 表现是「工程打不开」或者「同一个文件编译两遍」，而两者都要到 Xcode 里才看得见。
    // 只比系统翻译那一个：widget 的部署下限在真工程里是 16.4，那是同一次 app:sync 里
    // **后面**一条补丁（统一抬到 iOS 16.4 / macOS 13.3）改的，而这里只跑了造 target 这一步。
    for (const sp of [TRANSLATE_EXT_SPEC]) {
      const dir = tmpdir();
      fs.mkdirSync(path.join(dir, 'Shared (App)'), { recursive: true });
      const proj = path.join(dir, 'X.xcodeproj'); fs.mkdirSync(proj);
      const pbx = path.join(proj, 'project.pbxproj');
      fs.writeFileSync(pbx, stripExtensionTarget(real, sp));
      match(patchExtensionTarget(path.join(dir, 'Shared (App)'), sp), /target patched/, sp.label);
      // 比的是**行的多重集**，不是逐字节：每一段都是往末尾追加的，所以重造出来的那一个
      // 会排在另一个扩展之后 —— 先后顺序对 Xcode 无意义。多一行、少一行、留下半截对象，
      // 这个判据照样红。
      const sort = (t) => t.split('\n').sort().join('\n');
      eq(sort(fs.readFileSync(pbx, 'utf8')), sort(real), sp.label + '：重造出来的必须与真工程一致');
    }
  });

  test('★ 规格里多一个源文件 ⇒ 拆掉重造，不是「已经打过补丁」', () => {
    const P = path.join(ROOT, 'safari-project/BelliedMonkey Translator/BelliedMonkey Translator.xcodeproj/project.pbxproj');
    if (!fs.existsSync(P)) return;
    const real = fs.readFileSync(P, 'utf8');
    const dir = tmpdir();
    fs.mkdirSync(path.join(dir, 'Shared (App)'), { recursive: true });
    const proj = path.join(dir, 'X.xcodeproj'); fs.mkdirSync(proj);
    const pbx = path.join(proj, 'project.pbxproj');
    // 造一棵「按旧规格打过补丁」的树：把最后一个源文件从清单里拿掉再生成
    const OLD = Object.assign({}, TRANSLATE_EXT_SPEC, { srcs: TRANSLATE_EXT_SPEC.srcs.slice(0, -1) });
    fs.writeFileSync(pbx, stripExtensionTarget(real, TRANSLATE_EXT_SPEC));
    patchExtensionTarget(path.join(dir, 'Shared (App)'), OLD);
    const before = fs.readFileSync(pbx, 'utf8');
    const last = TRANSLATE_EXT_SPEC.srcs[TRANSLATE_EXT_SPEC.srcs.length - 1];
    ok(!before.includes(last + ' in Sources'), '前提：旧规格里没有它');
    // 现在按新规格再跑一次
    const note = patchExtensionTarget(path.join(dir, 'Shared (App)'), TRANSLATE_EXT_SPEC);
    match(note, /重造/, '回执要说清楚是重造的，实际：' + note);
    const after = fs.readFileSync(pbx, 'utf8');
    eq((after.match(new RegExp(last + ' in Sources', 'g')) || []).length, 2,
      '一条 PBXBuildFile + 一条 Sources 阶段项 —— 多了就是同一个文件编译两遍');
    const sort = (t) => t.split('\n').sort().join('\n');
    eq(sort(after), sort(real), '重造出来的要与真工程一致');
    // 再跑一次不该再动它
    match(patchExtensionTarget(path.join(dir, 'Shared (App)'), TRANSLATE_EXT_SPEC), /already patched/);
    eq(fs.readFileSync(pbx, 'utf8'), after, '重造之后要幂等');
  });

  test('★ 规格里点名的源文件与资源都真的在', () => {
    for (const s of TRANSLATE_EXT_SPEC.srcs) {
      ok(fs.existsSync(path.join(NATIVE, TRANSLATE_EXT_SPEC.srcDir, s)), s + ' 不存在');
    }
    for (const p of TRANSLATE_EXT_SPEC.plain) ok(fs.existsSync(path.join(ROOT, p.from)), p.from + ' 不存在');
    eq(TRANSLATE_EXT_SPEC.resources[0].fromApp, 'ExtEngine.js', '引擎从这个 flavor 的宿主包里取');
  });

  test('★ VaultNames 是一份文件两个消费者 —— App 那边走标记块，扩展那边编进 target', () => {
    const { DELEGATE_PATCHES: _ } = require('../scripts/sync-app-assets.js');
    const src = fs.readFileSync(path.join(ROOT, 'scripts', 'sync-app-assets.js'), 'utf8');
    ok(src.includes("src: 'translate-ext/VaultNames.swift'"), 'App 那边要贴同一份文件');
    ok(TRANSLATE_EXT_SPEC.srcs.includes('VaultNames.swift'), '扩展那边要编同一份文件');
    // 抄第二份的形状：仓库里除了这一个文件，不该有第二处定义 MTVaultNames
    const hits = fs.readdirSync(NATIVE).filter((f) => f.endsWith('.swift'))
      .filter((f) => /enum MTVaultNames/.test(fs.readFileSync(path.join(NATIVE, f), 'utf8')));
    eq(hits.length, 0, 'app/native/ 顶层不该再有一份 MTVaultNames：' + hits.join(', '));
  });

  test('★ 回执里永远没有 key 的值（原生这一侧）', () => {
    const s = fs.readFileSync(path.join(NATIVE, 'vault-bridge.swift'), 'utf8');
    // 锚在**回执**那一个 ack 上（收件箱那个也叫 ack，它在前面）。切到文件末尾会把
    // sync 一起圈进来，于是一条对的实现被判成泄漏 —— I-6 加收件箱时就撞了一次。
    const ack = s.slice(s.indexOf('private func ack(keys:'));
    ok(!/apiKey|secret\[/.test(ack), 'ack 里不许出现 key');
    const inboxAck = s.slice(s.indexOf('private func ack(names:'), s.indexOf('private func clearInbox'));
    ok(!/apiKey|secret\[/.test(inboxAck), '收件箱的 ack 里同样不许出现 key');
    ok(s.includes('"keys": keys') && s.includes('"status": Int(status)'), '回执只有键名与 OSStatus');
    ok(/#if os\(iOS\)/.test(s) && /#endif/.test(s), 'macOS 没有这个扩展点，整份要被条件编译挡住');
  });

  test('★ 扩展的文案与产品里已有的那几句逐字相同 —— 抄一句改一个字就是两套说法', () => {
    const copy = fs.readFileSync(path.join(NATIVE, 'translate-ext', 'ExtCopy.swift'), 'utf8');
    const zh = JSON.parse(fs.readFileSync(path.join(ROOT, 'extension', '_locales', 'zh_CN', 'messages.json'), 'utf8'));
    const en = JSON.parse(fs.readFileSync(path.join(ROOT, 'extension', '_locales', 'en', 'messages.json'), 'utf8'));
    // 形如：Row(loc: "auth_err_key",\n  en: "…",\n  zh: "…")
    const re = /Row\(loc: "([a-z_]+)",\s*\n?\s*en: "((?:[^"\\]|\\.)*)",\s*\n?\s*zh: "((?:[^"\\]|\\.)*)"\)/g;
    let m; let n = 0;
    while ((m = re.exec(copy))) {
      const [, key, e, z] = m;
      ok(zh[key], '_locales/zh_CN 里没有 ' + key);
      eq(z.replace(/\\"/g, '"'), zh[key].message, key + ' 的中文与 _locales 不一致');
      eq(e.replace(/\\"/g, '"'), en[key].message, key + ' 的英文与 _locales 不一致');
      n += 1;
    }
    ok(n >= 8, '至少那几条失败文案要标上 _locales 的键，实际 ' + n);
  });

  test('★ 每个会上屏的停机码都有一行文案 —— 没有的那一个会显示成「这次没翻成」', () => {
    const copy = fs.readFileSync(path.join(NATIVE, 'translate-ext', 'ExtCopy.swift'), 'utf8');
    const view = fs.readFileSync(path.join(NATIVE, 'translate-ext', 'TranslateExt.swift'), 'utf8');
    const have = new Set((copy.match(/^\s*"([a-z_]+)": Row\(/gm) || []).map((s) => s.match(/"([a-z_]+)"/)[1]));
    // ext-entry.js 会返回的 + translation-api.js 会抛的 + 这一侧自己判的
    for (const c of ['empty', 'no_settings', 'needs_setup', 'empty_result', 'not_synced', 'engine_unavailable',
      'auth', 'http', 'no_base', 'unknown_provider', 'credit_exhausted', 'grant_unavailable',
      'model_not_allowed', 'network', 'timeout', 'unknown']) {
      if (c === 'no_settings') continue;   // 扩展里读不到 storage 是不可能的：seed 是原生注入的
      ok(have.has(c), '缺文案：' + c);
    }
    // 要去 App 里改配置的，不能给「重试」—— 再失败一次不是出口
    const needsApp = view.slice(view.indexOf('private func needsApp'), view.indexOf('private func openApp'));
    for (const c of ['needs_setup', 'not_synced', 'auth', 'no_base', 'unknown_provider']) {
      ok(needsApp.includes(`"${c}"`), c + ' 要给「打开大肚猴翻译」而不是「重试」');
    }
  });

  test('★ 扩展里没有第二份传输实现 —— 同一份字节跑在 JavaScriptCore 里', () => {
    const dir = path.join(NATIVE, 'translate-ext');
    const all = fs.readdirSync(dir).map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
    // 这几样一旦出现在 Swift 里，就是开始重写传输层了
    for (const bad of ['chat/completions', 'api.deepseek.com', 'Authorization', '"messages"']) {
      ok(!all.includes(bad), 'Swift 里不该出现 ' + bad + '（传输只有 ExtEngine.js 一份）');
    }
    ok(all.includes('__mtFetch') && all.includes('__mtTimer') && all.includes('__mtSeed'),
      '三个钩子的名字要与 app/ext-shim.js 逐字一致');
  });
});
