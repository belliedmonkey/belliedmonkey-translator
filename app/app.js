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

  // Chinese-first with the same fallback discipline as the extension's `t()`: a
  // missing string must never blank the UI. There is no `chrome.i18n` here (this is
  // not an extension page), so the app carries its own copy rather than pretending.
  const T = {
    lede: '你在浏览器里读到的句子，会同步到这里来复习。',
    emailLabel: '邮箱',
    send: '发送验证码',
    sending: '正在发送…',
    codeLabel: '验证码（查收邮件）',
    verify: '登录',
    verifying: '正在登录…',
    back: '换一个邮箱',
    localNote: '浏览器扩展不登录也能采集和复习，全部存在本机。登录只是为了让语料同步到这台设备上。',
    signout: '退出',
    review: '开始复习',
    reviewBack: '← 返回',   // NOT `back` — that key is the sign-in flow's 换一个邮箱
    sync: '同步',
    syncing: '正在同步…',
    cards: '张卡',
    reviews: '条复习记录',
    sources: '个来源',
    never: '还没有同步过',
    empty: '同步完成，但服务器上还没有内容 —— 先在浏览器里采集一些，再回来同步。',
    upToDate: '已经是最新的。',
    sent: '验证码已发送，查收邮件。',
    codeBad: '验证码不对或已过期，重新试一次。',
    offline: '连不上服务器，检查网络后重试。',
  };
  const t = (k) => T[k] || k;

  const say = (msg, isErr) => {
    const el = $('status');
    el.textContent = msg || '';
    el.classList.toggle('err', !!isErr);
  };

  // Never show a raw provider string to a user. `auth.js` and `sync.js` attach `code`
  // precisely so callers can decide the wording, and "AuthApiError: Token has expired
  // or is invalid" is not wording — it is a stack trace with a sentence around it.
  function humanError(e) {
    const code = e && e.code;
    if (code === 'network') return t('offline');
    if (code === 'signed_out') return t('codeBad');
    const msg = String((e && e.message) || e);
    if (/expired|invalid|otp/i.test(msg)) return t('codeBad');
    if (/network|fetch|load failed/i.test(msg)) return t('offline');
    return msg;
  }

  function paintStatic() {
    $('lede').textContent = t('lede');
    $('email-label').textContent = t('emailLabel');
    $('send').textContent = t('send');
    $('code-label').textContent = t('codeLabel');
    $('verify').textContent = t('verify');
    $('back').textContent = t('back');
    $('local-note').textContent = t('localNote');
    $('signout').textContent = t('signout');
    $('review').textContent = t('review');
    $('review-back').textContent = t('reviewBack');
    $('sync').textContent = t('sync');
  }

  async function paintCounts() {
    const [stats, reviews, last] = await Promise.all([
      LearnStore.stats(),
      LearnStore.allReviews(),
      LearnStore.getMeta('appLastSync', 0),
    ]);
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
      cell(stats.total, t('cards')),
      cell(reviews.length, t('reviews')),
      cell(stats.sources, t('sources')));
    $('last').textContent = last
      ? new Date(last).toLocaleString()
      : t('never');
  }

  async function show(session) {
    $('signed-out').hidden = !!session;
    $('signed-in').hidden = !session;
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
    $('send').textContent = t('sending');
    say('');
    try {
      await LearnAuth.signIn(email);
      pendingEmail = email;
      $('email-form').hidden = true;
      $('code-form').hidden = false;
      $('code').focus();
      say(t('sent'));
    } catch (err) {
      say(humanError(err), true);
    } finally {
      $('send').disabled = false;
      $('send').textContent = t('send');
    }
  });

  $('code-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('verify').disabled = true;
    $('verify').textContent = t('verifying');
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
      $('verify').textContent = t('verify');
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
    $('sync').textContent = t('syncing');
    say('');
    try {
      // PULL ONLY. The app is downstream of the extension by design
      // (domain-design §9.3): the extension owns the upload and its own progress
      // cursor. Stage 4 gives the app a push of its own review results; until it has
      // reviews to push, a push here would only be able to send back what it just
      // received.
      const r = await LearnSync.pull();
      await LearnStore.setMeta('appLastSync', Date.now());
      await paintCounts();
      if (r.needsUpgrade) {
        say('服务器上有这个版本读不了的内容，请更新 App。', true);
      } else if (r.chunks) {
        say('收到 ' + r.cards + ' 张卡 · ' + r.reviews + ' 条复习记录');
      } else {
        // Zero chunks is TWO different states and they must not share a sentence.
        // Converged (the good one) told the user 「服务器上还没有内容」 while the
        // counts beside it read 11 — i.e. the app announced data loss every time
        // sync worked perfectly. Distinguish by whether anything is actually here.
        const stats = await LearnStore.stats();
        say(stats.total ? t('upToDate') : t('empty'));
      }
    } catch (err) {
      say(humanError(err), true);
    } finally {
      $('sync').disabled = false;
      $('sync').textContent = t('sync');
    }
  }

  $('sync').addEventListener('click', doSync);

  // ─── Review ───────────────────────────────────────────────────────────────
  // `review.js` runs its own boot on load and owns everything inside #review-view.
  // The app only shows and hides that view — reaching into its internals here would
  // be the start of the second implementation §9 exists to prevent.
  $('review').addEventListener('click', () => {
    $('signed-in').hidden = true;
    $('review-view').hidden = false;
    say('');
  });

  $('review-back').addEventListener('click', async () => {
    $('review-view').hidden = true;
    $('signed-in').hidden = false;
    // Grades given in there changed the corpus, so the counts on the way out must
    // not be the ones from the way in.
    await paintCounts();
  });

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
      say('同步尚未在这个版本中启用。浏览器扩展的采集与复习不受影响，全部存在本机。');
      return;
    }

    try {
      await show(await LearnAuth.current());
    } catch (err) {
      // A corrupt session must not leave a blank window with no way forward.
      await show(null);
      say(humanError(err), true);
    }
  })();
})();
