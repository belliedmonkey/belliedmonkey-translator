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

const { classifyProject, patchMacWindowXml, patchMacMenuXml } = require('../scripts/sync-app-assets.js');
const { resourceRoot } = require('../scripts/verify-ios-bundle.js');

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
