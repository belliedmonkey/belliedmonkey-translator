// app/app.js — the host app's Stage 2 surface: sign in, then pull.
//
// This runs LAST in the built `Script.js`, after the shared modules it depends on
// (LearnStore / LearnAuth / LearnChunk / LearnSync). Those are the SAME files the
// extension ships — not ports of them. `docs/learning-design.md` §9 is explicit that
// the app is not a second engine, and the moment a behaviour is retyped here the two
// surfaces start disagreeing about what a corpus is.
//
// Verified before any of this was written (verification-spec, Stage 2 spike): on the
// app's `file://` origin, IndexedDB, `crypto.subtle`, `CompressionStream` and `fetch`
// to Supabase all work, identically on macOS, iOS 17.2 and iOS 26.5. None of it needs
// a shim, which is why there is none.

(() => {
  const $ = (id) => document.getElementById(id);

  // Declared up here, not beside the sign-in code: `show()` reads it and is defined
  // above that point, so a `let` further down would be a temporal-dead-zone trap
  // waiting for the first refactor that calls `show()` earlier.
  let currentSession = null;

  // Same i18n as every other surface (interaction-spec 「界面语言」: no hardcoded
  // copy, anywhere). The bundle has carried MT_I18N_MESSAGES + PageI18n from the
  // start — the shim's getUILanguage hands it the system locale — so the app shell
  // localizes exactly like the extension pages do. The Chinese here is the FALLBACK
  // argument only, per the standing convention: a missing key must never blank the
  // UI, and the literal beside the key is what the translator's source of truth
  // (_locales/zh_CN) says.
  const t = (k, fb) => PageI18n.t(k, fb);

  const say = (msg, isErr) => {
    const el = $('status');
    el.textContent = msg || '';
    el.classList.toggle('err', !!isErr);
  };

  // Never show a raw provider string to a user. `auth.js` and `sync.js` attach `code`
  // precisely so callers can decide the wording, and "AuthApiError: Token has expired
  // or is invalid" is not wording — it is a stack trace with a sentence around it.
  function humanError(e) {
    const offline = () => t('app_offline', '连不上服务器，检查网络后重试。');
    const codeBad = () => t('app_code_bad', '验证码不对或已过期，重新试一次。');
    const code = e && e.code;
    if (code === 'network' || code === 'offline') return offline();
    if (code === 'invalid_credentials') return t('app_pw_bad', '邮箱或密码不对，重新试一次。');
    if (code === 'signed_out') return codeBad();
    const msg = String((e && e.message) || e);
    if (/invalid login credentials/i.test(msg)) return t('app_pw_bad', '邮箱或密码不对，重新试一次。');
    if (/expired|invalid|otp/i.test(msg)) return codeBad();
    if (/network|fetch|load failed/i.test(msg)) return offline();
    return msg;
  }

  function paintStatic() {
    $('lede').textContent = t('app_lede', '你在浏览器里读到的句子，会同步到这里来复习。');
    $('email-label').textContent = t('app_email_label', '邮箱');
    $('send').textContent = t('app_send', '发送验证码');
    $('code-label').textContent = t('app_code_label', '验证码（查收邮件）');
    $('verify').textContent = t('app_verify', '登录');
    $('back').textContent = t('app_back_email', '换一个邮箱');
    $('local-note').textContent = t('app_local_note', '浏览器扩展不登录也能采集和复习，全部存在本机。登录只是为了让语料同步到这台设备上。');
    $('app-use-pw').textContent = t('app_use_pw', '使用密码登录');
    $('app-pw-email-label').textContent = t('app_email_label', '邮箱');
    $('app-pw-label').textContent = t('app_pw_label', '密码');
    $('app-pw-login').textContent = t('app_verify', '登录');
    $('app-pw-back').textContent = t('app_pw_back', '改用验证码登录');
    $('signout').textContent = t('app_signout', '退出');
    $('gear').textContent = t('app_settings_link', '设置');
    AppSettings.paintStatic();
    $('review').textContent = t('app_review_start', '开始复习');
    $('review-back').textContent = t('app_review_back', '← 返回');
    $('sync').textContent = t('app_sync', '同步');
    AppDriving.paintStatic();
    paintAppEmptyState();
  }

  // 复习页的空态整段是从扩展的 review.html 原样嵌进来的（build/app-bundle.js 的
  // <!--REVIEW--> 槽），所以它说的是扩展的话：「打开采集开关」+ 一个「去设置里打开采集」
  // 的链接。在 App 里这两句都是错的 ——
  //   · App 结构上就不采集：learn-collector.js 不在 app-bundle 的 MODULES 里，
  //     材料只能经同步进来（domain-design §9.2）
  //   · 那个链接被 app.js 拦去打开 App 设置，而 App 设置里没有采集开关 —— 死路
  // 2026-08-28 实测：40 个外部用户全部经 App 进来，没有一个产生过一张卡。
  // 每一个点进复习页的人撞的都是这面墙。
  function paintAppEmptyState() {
    const body = document.querySelector('#empty [data-i18n="learn_empty_body"]');
    if (body) body.textContent = t('app_empty_body', '学习材料来自浏览器扩展 —— 这个 App 负责复习它们。');
    const link = $('empty-settings');
    if (!link) return;
    // 降级成纯文本：iOS 没有跳到 Safari 扩展设置的深链，给一句能照做的话，
    // 比给一个跳到死路的链接强。（macOS 有 SFSafariApplication 深链，但那要新增
    // 一条 native 消息，属于另一件事。）
    const how = document.createElement('span');
    how.id = 'empty-settings';
    how.textContent = t('app_empty_how',
      '在 iOS「设置 → Safari → 扩展」里启用大肚猴翻译，打开采集，然后照常浏览、照常翻译。');
    link.replaceWith(how);
  }

  async function paintCounts() {
    // 总计 + 四状态 —— 与复习页头部同一口径（interaction-spec「多设备同步一致性」：
    // 每设备显示总条目数与各状态数，同一账号同步后逐字一致）。待复习用调度器默认
    // 配置，与 review.js 的有效 targetR/KNOWN_S 一致（dailyNew 不影响这两个数）。
    const [stats, items, lastOk, lastLegacy] = await Promise.all([
      LearnStore.stats(),
      LearnStore.allItems(),
      LearnStore.getMeta('lastSyncOkAt', 0),
      LearnStore.getMeta('appLastSync', 0),
    ]);
    const due = LearnScheduler.dueCount(items, Date.now(), LearnScheduler.DEFAULTS);
    $('app-counts').innerHTML = '';
    // cls = semantic hook for style.css's stat-tile colors (never color by
    // position — a reordered/hidden tile would silently mis-color).
    const cell = (n, label, cls) => {
      const d = document.createElement('div');
      if (cls) d.className = cls;
      const b = document.createElement('b');
      b.textContent = String(n);
      const s = document.createElement('span');
      s.textContent = label;
      d.append(b, s);
      return d;
    };
    $('app-counts').append(
      cell(stats.total, t('learn_count_total', '总计')),
      cell(due, t('learn_count_due', '待复习'), 'count-due'),
      cell(stats.by.learning || 0, t('learn_count_learning', '学习中'), 'count-learning'),
      cell(stats.by.candidate || 0, t('learn_count_new', '候选')),
      cell(stats.by.known || 0, t('learn_count_known', '已掌握')));
    // 「上次同步」读统一成功戳；旧装机回退老键（只读回退，不迁移）。
    const last = lastOk || lastLegacy;
    $('last').textContent = last
      ? new Date(last).toLocaleString()
      : t('app_never_synced', '还没有同步过');
  }

  // 密码登录只服务「服务端已设过密码」的账号 —— 产品内没有任何设密码的面，
  // 所以对普通用户它 100% 会失败。2026-08-28 的 GoTrue 日志里实证撞了两次：
  // Apple 审核员（08-26，17.185.64.x）与一个真实用户（08-27，刚发完验证码就连点
  // 三次密码登录，全部 invalid_credentials，然后再没回来）。他就是那批「发了码从没
  // 验证」的用户之一 —— 也就是说这个入口在真实地吃转化。
  //
  // 判据用 plus-alias 而不是写死某个地址：演示账号按 §8.4.1 的做法一律是 Gmail
  // 别名（belliedmonkey+applereview@gmail.com），而真实用户几乎不会用 + 标签。
  // 写死地址的话，下次换演示账号就是一次 App Review 拒审。
  function isDemoAddress(v) { return /\+[^@\s]*@/.test(String(v || '').trim()); }

  function refreshPwEntry() {
    const el = $('app-use-pw');
    if (!el) return;
    // 密码表单已经打开时不要把入口抽走。
    el.hidden = !isDemoAddress($('email').value) && $('app-pw-form').hidden;
  }

  async function show(session) {
    currentSession = session;
    $('signed-out').hidden = !!session;
    $('signed-in').hidden = !session;
    // Signing out from inside settings or review must not leave that view on screen
    // over the sign-in form.
    if (!session) {
      $('app-settings').hidden = true;
      $('review-view').hidden = true;
      // And the sign-in surface resets to its default (OTP) path.
      $('app-pw-form').hidden = true;
      $('app-use-pw').hidden = true;   // 只有 demo 地址才会把它揭出来（refreshPwEntry）
      $('email-form').hidden = false;
      $('code-form').hidden = true;
    }
    if (session) {
      $('who').textContent = session.email || '';
      await paintCounts();
      // 播客模式入口是能力门控的（§9.5）：uiLang 能开口才渲染。Fire-and-forget —
      // 计数与登录绝不等一次语音列表加载。
      AppDriving.refreshEntry();
    }
  }

  // ─── Sign in ──────────────────────────────────────────────────────────────

  let pendingEmail = '';

  $('email').addEventListener('input', refreshPwEntry);

  $('email-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('email').value.trim();
    if (!email) return;
    $('send').disabled = true;
    $('send').textContent = t('app_sending', '正在发送…');
    say('');
    try {
      await LearnAuth.signIn(email);
      pendingEmail = email;
      $('email-form').hidden = true;
      $('code-form').hidden = false;
      $('code').focus();
      say(t('app_code_sent', '验证码已发送，查收邮件。'));
    } catch (err) {
      say(humanError(err), true);
    } finally {
      $('send').disabled = false;
      $('send').textContent = t('app_send', '发送验证码');
    }
  });

  $('code-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('verify').disabled = true;
    $('verify').textContent = t('app_verifying', '正在登录…');
    say('');
    try {
      const session = await LearnAuth.verify(pendingEmail, $('code').value);
      $('code').value = '';
      await show(session);
      // Pull immediately. A user who just signed in is asking for their material —
      // making them find a second button to get it would be the app admitting it does
      // not know what it is for.
      await doSync();
    } catch (err) {
      say(humanError(err), true);
    } finally {
      $('verify').disabled = false;
      $('verify').textContent = t('app_verify', '登录');
    }
  });

  $('back').addEventListener('click', () => {
    $('code-form').hidden = true;
    $('email-form').hidden = false;
    $('email').focus();
    say('');
  });

  // ─── Password sign-in (§8.4.1 second grant, 2026-08-17) ──────────────────
  // OTP stays the default path; this form serves accounts that HAVE a password
  // (set server-side — e.g. the App Review demo account). Same session shape,
  // same downstream flow as verify().
  $('app-use-pw').addEventListener('click', () => {
    $('email-form').hidden = true;
    $('code-form').hidden = true;
    $('app-use-pw').hidden = true;
    $('app-pw-form').hidden = false;
    $('app-pw-email').value = $('email').value;
    $('app-pw-email').focus();
    say('');
  });

  $('app-pw-back').addEventListener('click', () => {
    $('app-pw-form').hidden = true;
    $('email-form').hidden = false;
    refreshPwEntry();
    $('email').focus();
    say('');
  });

  $('app-pw-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('app-pw-login').disabled = true;
    $('app-pw-login').textContent = t('app_verifying', '正在登录…');
    say('');
    try {
      const session = await LearnAuth.signInPassword($('app-pw-email').value, $('app-pw').value);
      $('app-pw').value = '';
      await show(session);
      // Same as the OTP path: a user who just signed in is asking for their
      // material — pull immediately.
      await doSync();
    } catch (err) {
      say(humanError(err), true);
    } finally {
      $('app-pw-login').disabled = false;
      $('app-pw-login').textContent = t('app_verify', '登录');
    }
  });

  $('signout').addEventListener('click', async (e) => {
    // interaction-spec 全局原则: network sign-out + repaint are in flight.
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      await LearnAuth.signOut();
      // The corpus deliberately survives sign-out, exactly as it does in the extension
      // (`sync.js` `forget()` — "turning sync off leaves the local corpus untouched").
      await show(null);
      say('');
    } finally { btn.disabled = false; }
  });

  // ─── Pull ─────────────────────────────────────────────────────────────────

  async function doSync() {
    $('sync').disabled = true;
    $('sync').textContent = t('app_syncing', '正在同步…');
    say('');
    try {
      // Pull AND push. The app is downstream for CORPUS (the extension captures and
      // owns that upload, domain-design §9.3) but it is the origin of REVIEW
      // PROGRESS — grades given here exist nowhere else. Without the push, learning on
      // the phone would be a dead end: the extension would keep showing those cards as
      // due, and reinstalling the app would lose months of scheduling.
      //
      // Pushing is safe because of §8.4.2's watermarks, not because of care taken
      // here: items replayed from the server carry `syncedAt = touchedAt`, so only a
      // LOCAL review lifts them back above it, and reviews that arrived from the
      // server carry `viaSync`. A first push from a freshly-synced app therefore
      // uploads the grades and nothing else — which is exactly what convergence
      // (「上传 0」on the second run) proves.
      const { pulled, pushed } = await LearnSync.sync();
      const r = pulled;
      // sync() 自己盖统一成功戳 lastSyncOkAt（手动/自动一视同仁）；老键不再写。
      await paintCounts();
      // Both directions get said, and the upload is not hidden when it is the only
      // thing that happened — 「收到 0」 alone after a review session would read as
      // "your grades went nowhere".
      const up = pushed && (pushed.pushed || pushed.reviews)
        ? ' · ' + t('app_uploaded_n', '上传 {n} 条复习记录').replace('{n}', String(pushed.reviews || 0))
        : '';

      if (r.needsUpgrade) {
        // `sync()` returns pushed:null in this case — it refuses to push on top of a
        // chunk it could not read, so there is nothing to report but the stall.
        say(t('app_needs_upgrade', '服务器上有这个版本读不了的内容，请更新 App。'), true);
      } else if (r.cards || r.reviews) {
        // Keyed on what was NEW, not on `r.chunks`. A converged pull still READS a
        // chunk — the cursor does not skip rows this device wrote (§8.4.2) — so
        // branching on chunks announced 「收到 0 张卡 · 0 条复习记录」 right after a
        // perfectly successful sync. Second time this exact confusion has been
        // shipped in this file; both times it turned the healthy state into a
        // sentence that reads like a failure.
        say(t('app_received', '收到 {n} 张卡 · {m} 条复习记录')
          .replace('{n}', String(r.cards)).replace('{m}', String(r.reviews)) + up);
      } else if (up) {
        say(t('app_uploaded_only', '已上传 {n} 条复习记录')
          .replace('{n}', String((pushed && pushed.reviews) || 0)));
      } else {
        // Zero chunks is TWO different states and they must not share a sentence.
        // Converged (the good one) told the user 「服务器上还没有内容」 while the
        // counts beside it read 11 — i.e. the app announced data loss every time
        // sync worked perfectly. Distinguish by whether anything is actually here.
        const stats = await LearnStore.stats();
        say(stats.total
          ? t('app_up_to_date', '已经是最新的。')
          : t('app_sync_empty', '同步完成，但服务器上还没有内容 —— 先在浏览器里采集一些，再回来同步。'));
      }
    } catch (err) {
      say(humanError(err), true);
    } finally {
      $('sync').disabled = false;
      $('sync').textContent = t('app_sync', '同步');
    }
  }

  $('sync').addEventListener('click', doSync);

  // §8.8 修订版 — launch and return-to-foreground are ENTRIES, and every entry
  // FORCES a sync (interaction-spec「多设备同步一致性」: 每次进 App 即同步，绕过
  // 节流). Failures stay non-interruptive: the review header's status line carries
  // the state; the loud path stays on the button above. 进复习视图不再额外触发 ——
  // 启动/回前台已覆盖，且 inflight 会去重。
  async function quietSync(extra) {
    if (!currentSession) return;
    const r = await LearnSync.autoSync(Date.now(), Object.assign({ force: true }, extra || {}))
      .catch(() => null);
    if (r) await paintCounts();
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') quietSync();
  });
  // 断网自愈：网络回来立刻补一次进入级同步。
  window.addEventListener('online', () => { quietSync({ online: true }); });

  // ─── Review ───────────────────────────────────────────────────────────────
  // `review.js` runs its own boot on load and owns everything inside #review-view.
  // The app only shows and hides that view — reaching into its internals here would
  // be the start of the second implementation §9 exists to prevent.
  $('review').addEventListener('click', () => {
    $('signed-in').hidden = true;
    $('review-view').hidden = false;
    // review.js 自己的 applyI18n 会把每个 [data-i18n] 的 textContent 按扩展的文案
    // 写回去，所以 paintStatic() 那次重绘会被它覆盖。进入复习页时再绘一次 ——
    // 这里是空态真正会被看见的时刻。
    paintAppEmptyState();
    // §8.8 — the app is a long-lived single page and review.js built its deck at
    // bundle load, so material synced since then is invisible until a rebuild.
    // Entering the view IS the rebuild point. `start()` is review.js's own export
    // (same bytes as the extension); this is showing/hiding plus one sanctioned
    // call, not a second implementation.
    if (window.LearnReview) LearnReview.start();
    say('');
  });

  // ─── 播客模式（§9.5）────────────────────────────────────────────────────
  // Same split as #review-view: the shell owns view switching, AppDriving owns
  // everything inside #app-drive.
  $('app-drive-start').addEventListener('click', () => {
    $('signed-in').hidden = true;
    $('app-drive').hidden = false;
    AppDriving.start();
    say('');
  });

  $('app-drive-back').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      AppDriving.stop();
      $('app-drive').hidden = true;
      $('signed-in').hidden = false;
      // 跟读评分改了语料，出门时的计数不能还是进门时的。
      await paintCounts();
    } catch (err) {
      say(String((err && err.message) || err), true);
    } finally { btn.disabled = false; }
  });

  $('review-back').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      $('review-view').hidden = true;
      $('signed-in').hidden = false;
      // Grades given in there changed the corpus, so the counts on the way out must
      // not be the ones from the way in.
      await paintCounts();
    } catch (err) {
      // 失败要具名: stale counts + silence would read as "nothing happened".
      say(String((err && err.message) || err), true);
    } finally { btn.disabled = false; }
  });

  // ─── Settings ─────────────────────────────────────────────────────────────
  // The review page's own 「设置」 link lands here. Before Stage 4 it called
  // `chrome.runtime.openOptionsPage()`, which the shim throws on — a dead end the
  // user could reach in two taps.

  async function openSettings() {
    $('signed-in').hidden = true;
    $('review-view').hidden = true;
    $('app-settings').hidden = false;
    await AppSettings.paint(currentSession, say);
    say('');
  }

  async function closeSettings() {
    $('app-settings').hidden = true;
    $('signed-in').hidden = false;
    await paintCounts();
    say('');
  }

  $('gear').addEventListener('click', openSettings);
  $('settings-back').addEventListener('click', closeSettings);
  // Both of review.html's settings links, captured so review.js's own handler (which
  // throws through the shim) never runs. Capture phase, because review.js attached
  // first and `preventDefault` alone would not stop a listener already registered.
  // 'empty-settings' 不在列内：它在 App 里已被 paintAppEmptyState 换成纯文本，
  // 而它原本指向的 App 设置没有采集开关。
  for (const id of ['open-settings']) {
    const el = $(id);
    if (el) {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openSettings();
      }, true);
    }
  }

  // ─── Boot ─────────────────────────────────────────────────────────────────

  (async () => {
    paintStatic();

    // The app must honour the SAME shipping switch as the extension. `MT_BACKEND
    // .enabled === false` promises there is "no path to an account or to our server"
    // — and an app whose entire job is signing in and pulling is exactly such a path.
    // Gating only the extension's settings page would have left that promise true in
    // the place anyone checks and false in the place it mattered.
    if (!MT_BACKEND.enabled) {
      $('signed-out').hidden = true;
      $('signed-in').hidden = true;
      say(t('app_sync_disabled', '同步尚未在这个版本中启用。浏览器扩展的采集与复习不受影响，全部存在本机。'));
      return;
    }

    await AppSettings.ensureDefaults();
    AppDriving.wire();
    AppSettings.wire({
      say,
      session: () => currentSession,
      onSignOut: async () => {
        await LearnAuth.signOut();
        await show(null);
      },
    });

    try {
      const session = await LearnAuth.current();
      await show(session);
      // Storage-read failure ≠ signed out (§8.4.1): the sign-in form still works
      // as the recovery path, but the status line must name the real problem.
      if (!session && LearnAuth.lastLoadError()) {
        say(t('sync_status_storage_error', '读不到登录状态（存储读取失败），稍后自动重试 —— 这不代表已退出登录。'), true);
      }
      // Fire-and-forget: launch is a heartbeat (§8.8), and the sign-in screen or
      // counts must never wait on the network for a run the user didn't ask for.
      quietSync();
    } catch (err) {
      // A corrupt session must not leave a blank window with no way forward.
      await show(null);
      say(humanError(err), true);
    }
  })();
})();
