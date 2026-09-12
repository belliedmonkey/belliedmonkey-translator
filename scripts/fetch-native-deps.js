#!/usr/bin/env node
// 拉取宿主 App 的原生二进制依赖（本机离线朗读：sherpa-onnx + onnxruntime 的静态 xcframework），
// 钉版本 + sha256，解到 app/native/vendor/（gitignored），并生成两个**本地** SwiftPM 包。
//
//   node scripts/fetch-native-deps.js          # 缺什么下什么；校验和不对就报错退出
//   node scripts/fetch-native-deps.js --check  # 只检查，不联网
//
// 为什么是本地包而不是远程 SPM 依赖（learning-design §9.1）：xcodebuild 解析远程二进制
// 目标时不走 shell 的代理，在这台机器上实测卡死；本地包让构建机不依赖 GitHub，且校验和
// 在这个仓库里只写一处（下面这张表）。为什么不用 SPM 的 checksum 字段：那是给远程 url 用的，
// `binaryTarget(path:)` 不校验 —— 所以校验在这里做，下载完立刻算。
//
// 版本升级：改下面四行 url/sha256 + SHERPA_SWIFT_SHA，删掉 app/native/vendor/ 重跑。
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const VENDOR = path.join(ROOT, 'app', 'native', 'vendor');
const SHERPA_VERSION = '1.13.8';
const ORT_VERSION = '1.28.2';

// SPM 的 checksum 就是 zip 的 sha256 —— 直接取自两家上游 Package.swift 里对应的 binaryTarget。
const ARTIFACTS = [
  { pkg: 'sherpa-onnx', slice: 'ios', name: 'sherpa-onnx.xcframework',
    url: `https://github.com/k2-fsa/sherpa-onnx/releases/download/xcframework/sherpa-onnx-v${SHERPA_VERSION}-ios-static.xcframework.zip`,
    sha256: '6b8e769cb153343270fdccbe92e3b3db0d1c421d67fa0989ab01fdf5b2fcf2de' },
  { pkg: 'sherpa-onnx', slice: 'macos', name: 'sherpa-onnx.xcframework',
    url: `https://github.com/k2-fsa/sherpa-onnx/releases/download/xcframework/sherpa-onnx-v${SHERPA_VERSION}-macos-static.xcframework.zip`,
    sha256: '93f7a064abe99e0d6185a88c5b36ce18c4bff35cd0d5e4e81f81151de8e3e7e5' },
  { pkg: 'onnxruntime-libs', slice: 'ios', name: 'onnxruntime.xcframework',
    url: `https://github.com/csukuangfj/onnxruntime-libs/releases/download/v${ORT_VERSION}/onnxruntime-ios-static-xcframework-${ORT_VERSION}.xcframework.zip`,
    sha256: '306b740d513a1af5c9f1c3a7d2ca98d8bf5491a558a45ef2b14cbed4fde64059' },
  { pkg: 'onnxruntime-libs', slice: 'macos', name: 'onnxruntime.xcframework',
    url: `https://github.com/csukuangfj/onnxruntime-libs/releases/download/v${ORT_VERSION}/onnxruntime-macos-static-xcframework-${ORT_VERSION}.xcframework.zip`,
    sha256: '39f816cac19cb76e0f504b2d7c91fec3e889c25bf5b9b474297b19eb0bd69a31' },
];
// 上游的 Swift 包装（一个文件，把 C API 包成 Swift 类）。同样钉住。
const SHERPA_SWIFT = {
  url: `https://raw.githubusercontent.com/k2-fsa/sherpa-onnx/v${SHERPA_VERSION}/swift-api-examples/SherpaOnnx.swift`,
  sha256: 'a7ff8bbc35fc27017dc4f47271592054a2138b6e716c2abb5d8b5bdcbcf49ffd',
  dst: path.join(VENDOR, 'sherpa-onnx', 'Sources', 'SherpaOnnx', 'SherpaOnnx.swift'),
};

const PACKAGE_SWIFT = {
  'onnxruntime-libs': `// swift-tools-version: 5.9
// 由 scripts/fetch-native-deps.js 生成 —— 别手改。onnxruntime ${ORT_VERSION} 静态 xcframework 的本地包。
import PackageDescription
let package = Package(
  name: "onnxruntime-libs",
  platforms: [.iOS(.v15), .macOS(.v10_15)],
  products: [
    .library(name: "onnxruntime-ios", targets: ["OnnxruntimeIOS"]),
    .library(name: "onnxruntime-macos", targets: ["OnnxruntimeMacOS"]),
  ],
  targets: [
    .binaryTarget(name: "OnnxruntimeIOS", path: "ios/onnxruntime.xcframework"),
    .binaryTarget(name: "OnnxruntimeMacOS", path: "macos/onnxruntime.xcframework"),
  ]
)
`,
  'sherpa-onnx': `// swift-tools-version: 5.9
// 由 scripts/fetch-native-deps.js 生成 —— 别手改。sherpa-onnx ${SHERPA_VERSION} 静态 xcframework 的本地包，
// 产品名与上游一致（"sherpa-onnx"，模块 SherpaOnnx；C 类型在 SherpaOnnxC）。
import PackageDescription
let package = Package(
  name: "sherpa-onnx",
  platforms: [.iOS(.v15), .macOS(.v10_15)],
  products: [.library(name: "sherpa-onnx", targets: ["SherpaOnnx"])],
  dependencies: [.package(path: "../onnxruntime-libs")],
  targets: [
    .binaryTarget(name: "SherpaOnnxIOS", path: "ios/sherpa-onnx.xcframework"),
    .binaryTarget(name: "SherpaOnnxMacOS", path: "macos/sherpa-onnx.xcframework"),
    .target(
      name: "SherpaOnnx",
      dependencies: [
        .product(name: "onnxruntime-ios", package: "onnxruntime-libs", condition: .when(platforms: [.iOS])),
        .product(name: "onnxruntime-macos", package: "onnxruntime-libs", condition: .when(platforms: [.macOS])),
        .target(name: "SherpaOnnxIOS", condition: .when(platforms: [.iOS])),
        .target(name: "SherpaOnnxMacOS", condition: .when(platforms: [.macOS])),
      ],
      path: "Sources/SherpaOnnx",
      linkerSettings: [.linkedLibrary("c++"), .linkedFramework("Foundation"), .linkedFramework("CoreML")]
    ),
  ]
)
`,
};

function sha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function download(url, dst) {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  // curl 而不是 fetch：走用户 shell 的代理设置，且大文件不占 Node 内存。
  execFileSync('curl', ['-sSL', '--fail', '--max-time', '1800', '-o', dst, url], { stdio: 'inherit' });
}

function main() {
  const checkOnly = process.argv.includes('--check');
  const problems = [];
  for (const a of ARTIFACTS) {
    const dir = path.join(VENDOR, a.pkg, a.slice);
    const out = path.join(dir, a.name);
    const stamp = path.join(dir, '.sha256');
    if (fs.existsSync(out) && fs.existsSync(stamp) && fs.readFileSync(stamp, 'utf8').trim() === a.sha256) {
      console.log(`  ✓ ${a.pkg}/${a.slice}/${a.name}（已就位）`); continue;
    }
    if (checkOnly) { problems.push(`${a.pkg}/${a.slice} 缺失或校验和不符`); continue; }
    const zip = path.join(dir, 'download.zip');
    console.log(`  ↓ ${a.url}`);
    download(a.url, zip);
    const got = sha256(zip);
    if (got !== a.sha256) {
      fs.unlinkSync(zip);
      problems.push(`${a.pkg}/${a.slice}: sha256 不符 —— 期望 ${a.sha256.slice(0, 12)}… 实得 ${got.slice(0, 12)}…（上游改了包？别放过）`);
      continue;
    }
    fs.rmSync(out, { recursive: true, force: true });
    execFileSync('unzip', ['-qo', zip, '-d', dir]);
    fs.unlinkSync(zip);
    if (!fs.existsSync(out)) { problems.push(`${a.pkg}/${a.slice}: 解压后没有 ${a.name}`); continue; }
    fs.writeFileSync(stamp, a.sha256 + '\n');
    console.log(`  ✓ ${a.pkg}/${a.slice}/${a.name}`);
  }
  // Swift 包装源
  if (!(fs.existsSync(SHERPA_SWIFT.dst) && sha256(SHERPA_SWIFT.dst) === SHERPA_SWIFT.sha256)) {
    if (checkOnly) problems.push('SherpaOnnx.swift 缺失或校验和不符');
    else {
      download(SHERPA_SWIFT.url, SHERPA_SWIFT.dst);
      const got = sha256(SHERPA_SWIFT.dst);
      if (got !== SHERPA_SWIFT.sha256) { fs.unlinkSync(SHERPA_SWIFT.dst); problems.push(`SherpaOnnx.swift sha256 不符（实得 ${got.slice(0, 12)}…）`); }
      else console.log('  ✓ SherpaOnnx.swift');
    }
  } else console.log('  ✓ SherpaOnnx.swift（已就位）');
  // 两个 Package.swift（内容确定，每次重写，幂等）
  for (const [pkg, text] of Object.entries(PACKAGE_SWIFT)) {
    const p = path.join(VENDOR, pkg, 'Package.swift');
    if (!checkOnly) { fs.mkdirSync(path.dirname(p), { recursive: true }); if (!fs.existsSync(p) || fs.readFileSync(p, 'utf8') !== text) fs.writeFileSync(p, text); }
    else if (!fs.existsSync(p) || fs.readFileSync(p, 'utf8') !== text) problems.push(`${pkg}/Package.swift 缺失或过期`);
  }
  if (problems.length) {
    console.error('✗ 原生依赖未就位：\n  - ' + problems.join('\n  - '));
    if (checkOnly) console.error('  跑 `node scripts/fetch-native-deps.js` 拉取');
    process.exit(1);
  }
  console.log(`原生依赖就位：sherpa-onnx ${SHERPA_VERSION} · onnxruntime ${ORT_VERSION} → app/native/vendor/`);
}

if (require.main === module) main();
module.exports = { ARTIFACTS, SHERPA_SWIFT, PACKAGE_SWIFT, VENDOR, SHERPA_VERSION, ORT_VERSION };
