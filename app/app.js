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
    if (code === 'network') return offline();
    if (code === 'signed_out') return codeBad();
    const msg = String((e && e.message) || e);
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
    $('signout').textContent = t('app_signout', '退出');
    $('gear').textContent = t('app_settings_link', '设置');
    AppSettings.paintStatic();
    $('review').textContent = t('app_review_start', '开始复习');
    $('review-back').textContent = t('app_review_back', '← 返回');
    $('sync').textContent = t('app_sync', '同步');
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
    const cell = (n, label) => {
      const d = document.createElement('div');
      const b = document.createElement('b');
      b.textContent = String(n);
      const s = document.createElement('span');
      s.textContent = label;
      d.append(b, s);
      return d;
    };
    $('app-counts').append(
      cell(stats.total, t('learn_count_total', '总计')),
      cell(due, t('learn_count_due', '待复习')),
      cell(stats.by.learning || 0, t('learn_count_learning', '学习中')),
      cell(stats.by.candidate || 0, t('learn_count_new', '候选')),
      cell(stats.by.known || 0, t('learn_count_known', '已掌握')));
    // 「上次同步」读统一成功戳；旧装机回退老键（只读回退，不迁移）。
    const last = lastOk || lastLegacy;
    $('last').textContent = last
      ? new Date(last).toLocaleString()
      : t('app_never_synced', '还没有同步过');
  }

  async function show(session) {
    currentSession = session;
    $('signed-out').hidden = !!session;
    $('signed-in').hidden = !session;
    // Signing out from inside settings or review must not leave that view on screen
    // over the sign-in form.
    if (!session) { $('app-settings').hidden = true; $('review-view').hidden = true; }
    if (session) {
      $('who').textContent = session.email || '';
      await paintCounts();
    }
  }

  // ─── Sign in ──────────────────────────────────────────────────────────────

  let pendingEmail = '';

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

  $('signout').addEventListener('click', async () => {
    await LearnAuth.signOut();
    // The corpus deliberately survives sign-out, exactly as it does in the extension
    // (`sync.js` `forget()` — "turning sync off leaves the local corpus untouched").
    await show(null);
    say('');
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
    // §8.8 — the app is a long-lived single page and review.js built its deck at
    // bundle load, so material synced since then is invisible until a rebuild.
    // Entering the view IS the rebuild point. `start()` is review.js's own export
    // (same bytes as the extension); this is showing/hiding plus one sanctioned
    // call, not a second implementation.
    if (window.LearnReview) LearnReview.start();
    say('');
  });

  $('review-back').addEventListener('click', async () => {
    $('review-view').hidden = true;
    $('signed-in').hidden = false;
    // Grades given in there changed the corpus, so the counts on the way out must
    // not be the ones from the way in.
    await paintCounts();
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
  for (const id of ['open-settings', 'empty-settings']) {
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
    AppSettings.wire({
      say,
      session: () => currentSession,
      onSignOut: async () => {
        await LearnAuth.signOut();
        await show(null);
      },
    });

    try {
      await show(await LearnAuth.current());
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
