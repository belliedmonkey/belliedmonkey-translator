// test/offline-video-asr.test.js — BEL-103 isolation and the stage-0 contract.
// The Python suite is the behavior. This file checks the Mac app mounts the same
// CLI and stays out of the listen path and the iOS compile.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { describe, test, ok, eq } = require('./harness');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const code = (src) => src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

describe('offline video asr — one CLI, macOS only, not listen', () => {
  const swift = read('app/native/offline-video-asr.swift');
  const js = read('app/offline-video-asr.js');
  const pin = JSON.parse(read('tools/offline-video-asr/pin.json'));

  test('python contract suite', () => {
    // Mac CLI behavior (AVFoundation / afconvert). ubuntu-latest npm test errors
    // in this suite (test_no_audio_track, then the offline model-missing case).
    // The file stays; the source checks under this describe still run everywhere.
    if (process.platform !== 'darwin') return;
    const r = spawnSync('python3', ['-m', 'unittest', 'tests.test_contract'], {
      cwd: path.join(ROOT, 'tools/offline-video-asr'),
      env: { ...process.env, PYTHONPATH: path.join(ROOT, 'tools/offline-video-asr') },
      encoding: 'utf8',
      timeout: 120000,
    });
    const out = (r.stdout || '') + (r.stderr || '');
    ok(r.status === 0, out);
    ok(/OK/.test(out), out);
  });

  test('swift file is entirely inside os(macOS) and launches the same module', () => {
    const body = code(swift).trim();
    ok(body.startsWith('#if os(macOS)') && body.endsWith('#endif'), '整份必须被 macOS 编译门包住');
    ok(swift.includes('"-m", "offline_video_asr"'), swift);
    ok(swift.includes('"--input"') && swift.includes('"--out"') && swift.includes('"--support-dir"'), swift);
    ok(swift.includes('"--timeout", "14400"'), '墙钟默认要和 pin.json 一致');
    eq(pin.timeout_s, 14400);
    ok(swift.includes('offlineVideoAsr'), 'feature flag');
    ok(swift.includes('UserDefaults.standard.bool'), '缺省 bool 是 false');
  });

  test('install line is macOS-only and the block is registered', () => {
    const { BLOCKS, patchViewController } = require('../scripts/sync-app-assets.js');
    ok(BLOCKS.some((b) => b.src === 'offline-video-asr.swift' && b.name === 'mt-offline-video-asr'));
    const os = require('os');
    const shared = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-ova-'));
    const vc = 'import WebKit\n\nclass ViewController {\n    func viewDidLoad() {\n'
      + '        self.webView.configuration.userContentController.add(self, name: "controller")\n    }\n}\n';
    fs.writeFileSync(path.join(shared, 'ViewController.swift'), vc);
    const notes = patchViewController(shared);
    ok(/offline video asr install patched/.test(notes), notes);
    const out = fs.readFileSync(path.join(shared, 'ViewController.swift'), 'utf8');
    ok(/#if os\(macOS\)\n\s*OfflineVideoAsr\.shared\.install\(webView: self\.webView\)\n\s*#endif/.test(out), out);
    const again = patchViewController(shared);
    ok(/offline video asr install already patched/.test(again), again);
    eq((fs.readFileSync(path.join(shared, 'ViewController.swift'), 'utf8').match(/OfflineVideoAsr\.shared\.install/g) || []).length, 1);
  });

  test('page module tracks only the offline event and does not touch listen', () => {
    ok(js.includes("track('offline_video_asr_task'"), js);
    ok(js.includes("flag: FLAG") && js.includes("offlineVideoAsr"));
    const { MODULES } = require('../build/app-bundle.js');
    ok(MODULES.includes('app/offline-video-asr.js'));
  });

  test('neither half imports the listen stack or the translate CLI', () => {
    const files = [
      'app/native/offline-video-asr.swift',
      'app/offline-video-asr.js',
      'tools/offline-video-asr/offline_video_asr/cli.py',
      'tools/offline-video-asr/offline_video_asr/engines.py',
      'tools/offline-video-asr/macos/extract.swift',
    ];
    const banned = ['MTSpeech', 'speech-bridge', 'listen-model', 'ws-transcribe', 'asr-source',
      'TranslationAPI', 'translation-api', 'SpeechAnalyzer', 'sttEngine', 'NativeSpeech'];
    const bad = [];
    for (const rel of files) {
      const src = read(rel);
      for (const token of banned) if (src.includes(token)) bad.push(`${rel} contains ${token}`);
    }
    eq(bad.length, 0, bad.join('; '));
  });

  test('AVFoundation helper reports media_encrypted and drm, and is not an app source', () => {
    const extract = read('tools/offline-video-asr/macos/extract.swift');
    ok(extract.includes('media_encrypted') && extract.includes('"drm"'), extract);
    ok(extract.includes('no_audio_track') && extract.includes('codec_unsupported'));
    const { BLOCKS } = require('../scripts/sync-app-assets.js');
    ok(!BLOCKS.some((b) => b.src === 'extract.swift' || (b.src || '').includes('macos/extract')));
  });
});
