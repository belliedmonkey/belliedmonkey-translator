// learn/backend.config.js — where the optional sync backend lives.
// See docs/learning-design.md §8.4.1.
//
// EVERYTHING here is public by design: the URL is a hostname and the key is the
// *publishable* anon key, which grants nothing on its own — every table is behind RLS
// keyed on `auth.uid()`, so an anon key with no session can read and write nothing.
// It ships in the extension bundle, which anyone can unzip; that is fine and expected.
// A key that must stay secret must never appear in this file.
//
// This is also the whole "which backend" decision, in one object. §8.4.1 explains why
// the client is written so that changing it is a one-file change.

var MT_BACKEND = {
  // ─── SHIPPING SWITCH ─────────────────────────────────────────────────────
  // true since v1.4.0 (Gate B, 2026-08-09): sync is PUBLIC. The flip landed in
  // the same commit as the honest privacy copy — README ×2, the in-product
  // learn_section_hint ×11 locales, and the Firefox data_collection_permissions
  // growing to three entries — exactly as learning-design §10 required. The
  // build gates that used to block this flag now guard the OPPOSITE direction:
  // enabled:true with any stale "never uploaded / no account" sentence anywhere
  // in the repo fails the build (see build.js validateManifest, Gate B block).
  //
  // The CHINA flavor's EXTENSION ships with this flipped back to false at build
  // time (build.js china override). The China HOST APP, however, ships the one
  // shared app bundle — enabled:true, sign-in included — by explicit decision
  // (2026-08-17, App Review Route A: reviewers require a username+password demo
  // account, so the login stays). Known asymmetry: a China user's extension does
  // not upload, so the app's sync only pulls what other (global-flavor) devices
  // pushed. Unifying the china extension's sync is a separate decision with its
  // own PIPL/cross-border gate.
  //
  // Sign-in stays optional: signed out, every feature except multi-device sync
  // works fully and locally (§8.2 stance — sync is an upgrade, not a gate).
  enabled: true,

  // Dedicated project, Tokyo (ap-northeast-1) — 2026-08-04. Tokyo rather than the
  // us-east-1 the other projects use: sync is not latency-critical, but the users
  // are, and from mainland China us-east-1 is ~250-350ms and unreliable where Tokyo
  // is ~50-80ms. Region cannot be changed after creation, so it is a decision, not
  // a default.
  url: 'https://cavezcufztzqsohpjmup.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNhdmV6Y3VmenR6cXNvaHBqbXVwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU4MTczNTAsImV4cCI6MjEwMTM5MzM1MH0.VdL1B_jYLySEkhecL6WHOLV_vYbnRItpciFx7ZSxO4M',
  table: 'bt_chunks',
  quotaBytes: 50 * 1024 * 1024,

  // 后端**真的开着**的第三方登录（§8.4.1.2）。界面只提供这里列出的。
  //
  // 为什么要有这张表：一个 provider 在 Supabase 那边没配时，点它会跳到一个
  // 「Unsupported provider」的错误页 —— 一个必然失败的按钮，和「点了没反应」
  // 是同一类。而「配没配」是**后端的状态**，客户端猜不出来，只能被告知。
  //
  // 加一个 provider 的顺序永远是：先在 Supabase 配好并实测授权入口 302 到对的地方，
  // 再把它写进这张表。反过来做，就是发一个坏按钮出去。
  //   apple  —— 2026-09-03 配好（Services ID + secret，实测 302 到 appleid.apple.com）
  //   google —— 2026-09-03 配好（OAuth client 950198135110-…，实测 302 到
  //             accounts.google.com 且 client_id 与本地那份逐字一致）
  //
  // 排序就是界面上的排序。Apple 在前：按下载数据用户几乎全在苹果设备上，而在那些
  // 设备上 Sign in with Apple 是系统级的一次点击，Google 要走一次浏览器往返。
  providers: ['apple', 'google'],

  // 手机号验证码。**还没接通** —— Supabase 的 Send SMS Hook 与阿里云 PNVS 都没配。
  // 界面按这个值决定说不说「手机号」；auth.js 那一侧早就支持了，但**能力不等于承诺**：
  // 在没接通时把「邮箱或手机号」写在标签上，是让用户填一个必然失败的东西。
  //
  // 接通之后这里也**不能直接写 true** —— PNVS 只发中国大陆号码（+86）。对一个法国
  // 用户说「手机号」同样是假话。所以它的取值是**地域相关**的：
  //   'cn'   —— 只在中国版构建里提供（那个 flavor 的用户几乎必然是 +86）
  //   true   —— 所有地区都提供（只有换成一家全球可达的短信服务之后才成立）
  //   false  —— 不提供（现在）
  // 判据永远是「这条路对**这个**用户真的能走通吗」，不是「我们实现了吗」。
  phoneOtp: false,
};

if (typeof module !== 'undefined' && module.exports) module.exports = MT_BACKEND;
