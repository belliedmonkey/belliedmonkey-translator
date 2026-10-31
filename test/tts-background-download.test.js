// test/tts-background-download.test.js — 离线语音包的**后台续传**（2026-10-04）。
//
// 来自一次真机：最小化 App + 断网 ⇒ 屏上写着
// 「离线模型下载失败：Error Domain=NSURLErrorDomain Code=-1005「网络连接已中断。」」，
// 而 NSError 的 UserInfo 里**明明带着 11862 字节的 NSURLSessionDownloadTaskResumeData** ——
// 我们既没用它，也没重试，停在一个失败态等用户再点。
//
// 这一组是**结构门**：真机上的「挂起 / 断网 / 恢复」在 `npm test` 里造不出来（没有设备），
// 所以这里钉住的是**使那三件事成立的结构**；端到端那条走 verification 的设备配方。
const path = require('path');
const fs = require('fs');
const { describe, test, ok } = require('./harness');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const SWIFT = read('app/native/speech-bridge.swift');
const TTS = read('extension/learn/tts.js');
const SETTINGS = read('src/app/settings-view.jsx');
const SHELL = read('src/app/shell-model.js');

// download(models:) 那一支的正文 —— 只在这一段里断言，别把 STT 那半边牵连进来。
const downloadFn = (() => {
  const i = SWIFT.indexOf('func download(models v: Any?)');
  ok(i > 0, '找不到 MTDeviceSpeech.download');
  const j = SWIFT.indexOf('private func loadedLangs()', i);
  return SWIFT.slice(i, j > i ? j : i + 4000);
})();

describe('离线语音包：后台可续传（真机 -1005 之后）', () => {
  test('下载用 background 会话 —— 否则 App 一挂起传输就冻住', () => {
    ok(/URLSessionConfiguration\.background\(withIdentifier:/.test(SWIFT),
      'sessions 还在用 .default：App 进后台传输会被挂起，这正是用户报的那个场景');
    ok(/sessionSendsLaunchEvents\s*=\s*true/.test(SWIFT), '少了 sessionSendsLaunchEvents');
    ok(/waitsForConnectivity\s*=\s*true/.test(SWIFT), '少了 waitsForConnectivity（系统等网络回来自动继续）');
  });

  test('失败时**先留 resume data、再按退避重试**（不是停在失败态）', () => {
    ok(/NSURLSessionDownloadTaskResumeData/.test(SWIFT), '没有读 resume data —— 断点信息就这么丢了');
    ok(/downloadTask\(withResumeData:/.test(SWIFT), '没有用 resume data 重建任务 ⇒ 会从零重下');
    ok(/mtdlRetryable\(/.test(SWIFT), '没有「哪些失败值得重试」的判据');
    ok(/NSURLErrorNetworkConnectionLost/.test(SWIFT),
      '-1005（网络连接已中断）必须算可重试 —— 它就是用户截图里那个码');
    ok(/asyncAfter\(deadline: \.now\(\) \+ delay\)/.test(SWIFT), '没有退避重试的调度');
  });

  test('重试期间不动界面：不再有调试事件里的 n 等噪声之外的失败态跳变', () => {
    // 失败态只在**重试用尽**后才有一次（settle 的 else 分支）；中途只推进度。
    const retries = (SWIFT.match(/self\.start\(job\.url, attempt: n, resumeData: rd/g) || []).length;
    ok(retries === 1, '重试调度应当只有一处，实际 ' + retries);
  });

  test('★ 不把系统原文送到界面：TTS 下载失败只送协议码', () => {
    ok(!/state": "failed", "reason": String\(describing: error\)/.test(downloadFn),
      'download() 又把 String(describing: error) 送出去了 —— 那正是屏上那句 Error Domain=…');
    ok(/mtdlCode\(error\)/.test(downloadFn), 'download() 没有用协议码');
    for (const code of ['offline', 'http', 'sha', 'load']) {
      ok(new RegExp('return "' + code + '"').test(SWIFT), 'mtdlCode 缺协议码 ' + code);
    }
  });

  test('失败不再删掉整个模型目录（那会把同一次里已下好的文件一起抹掉）', () => {
    ok(!/FileManager\.default\.removeItem\(at: d\)/.test(downloadFn),
      'download() 的 catch 里又在删整个模型目录');
  });

  test('★ 界面侧把协议码拼成人话，而不是摊开原生给的东西', () => {
    ok(/case 'offline': return t\('tts_network'/.test(TTS), "tts.js 的 reason() 没认 'offline'");
    ok(/case 'sha':/.test(TTS) && /case 'load':/.test(TTS), "reason() 没认 'sha' / 'load'");
    ok(/LearnTTS\.reason\(r\.why \|\| r\.reason/.test(SETTINGS), '设置页仍直接插原生值');
    ok(/LearnTTS\.reason\(String\(e\.why/.test(SHELL), '首启页仍直接插原生值');
  });
});
