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
