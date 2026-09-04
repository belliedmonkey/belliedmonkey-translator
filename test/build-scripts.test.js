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
  patchWidgetTarget,
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
    let t = String(REAL).replace(/\n\t\tMT[0-9A-F]{20}[^\n]*\n/g, '\n')
      .replace(/\n[^\n]*MT_WIDGET_TARGET[^\n]*\n/g, '\n')
      .replace(/\n[^\n]*MTPodcastWidget[^\n]*\n/g, '\n');
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
