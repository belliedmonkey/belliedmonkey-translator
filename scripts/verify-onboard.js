/* scripts/verify-onboard.js — 扩展引导页的门禁。
 *
 * 判据不是「文件在产物里」，是**在真浏览器里五屏都渲染出字、进度条真的走完、
 * 控制台干净**。一个只检查文件存在的门禁，挡不住「HTML 在但 JS 抛异常所以一片空白」。
 *
 * 顺带钉住一条 flavor 正确性：国际版 5 屏、中国版 4 屏。中国版少的那一屏是「登录同步」，
 * 它消失不是因为代码里判了 flavor 名，而是因为 MT_BACKEND.enabled 在中国版产物里是
 * false（build.js 构建时翻的）。所以这条断言同时在守「引导不会把中国版用户引到一个
 * 被关掉的功能上」—— 那正是 App 那边至今还存在的问题。
 *
 * 用法：node scripts/verify-onboard.js [dist|dist-china|dist-firefox]
 */
const path=require('path'), fs=require('fs'), http=require('http');
const ROOT='/Users/belliedmonkey/mobiletranslator';
const { launchChrome }=require(path.join(ROOT,'test/layout/chrome.js'));
const { CDP }=require(path.join(ROOT,'test/layout/cdp.js'));
const DIST=process.argv[2]||'dist';
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml'};
setTimeout(()=>{console.log('\n✗ 超时');process.exit(2);},90000).unref();
(async()=>{
  const srv=http.createServer((q,r)=>{
    const f=path.join(ROOT,DIST,decodeURIComponent(q.url.split('?')[0]));
    if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end();}
    r.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'text/plain'});r.end(fs.readFileSync(f));
  }).listen(0);
  await new Promise(r=>srv.on('listening',r));
  const url='http://127.0.0.1:'+srv.address().port+'/onboard/onboard.html';
  const chrome=await launchChrome(); let ok=true;
  const fail=m=>{ok=false;console.log('  ✗ '+m);}, pass=m=>console.log('  ✓ '+m);
  try{
    const cdp=await CDP.connect(chrome.port);
    const t=await cdp.send('Target.getTargets',{});
    const pg=t.targetInfos.find(x=>x.type==='page');
    const {sessionId}=await cdp.send('Target.attachToTarget',{targetId:pg.targetId,flatten:true});
    const errs=[];
    await cdp.send('Runtime.enable',{},sessionId); await cdp.send('Log.enable',{},sessionId);
    cdp.listeners.push({event:'Runtime.exceptionThrown',fn:p=>errs.push('EXC '+((p.exceptionDetails.exception||{}).description||p.exceptionDetails.text))});
    cdp.listeners.push({event:'Log.entryAdded',fn:p=>{if(p.entry.level==='error'&&!/favicon/.test(p.entry.url||''))errs.push('ERR '+p.entry.text);}});
    await cdp.send('Page.enable',{},sessionId);
    // 手机尺寸。默认窗口高得离谱，于是「按钮被内容顶出首屏」这类问题在门禁里
    // 永远不发生 —— 而那正是用户唯一会遇到它的尺寸。390×640 比 iPhone SE 还窄矮一档。
    await cdp.send('Emulation.setDeviceMetricsOverride',
      {width:390,height:640,deviceScaleFactor:1,mobile:true},sessionId);
    // chrome.storage 在普通页面上不存在 —— 打桩，正是要验 storageGet 的超时兜底之外的路径
    await cdp.send('Page.addScriptToEvaluateOnNewDocument',{source:`
      window.chrome={runtime:{getURL:s=>s,id:'x',openOptionsPage(){}},
        i18n:{getUILanguage:()=>'zh-CN',getMessage:()=>''},
        storage:{local:{get:(k,cb)=>cb({}),set:(o,cb)=>cb&&cb(),remove:(k,cb)=>cb&&cb()}}};`},sessionId);
    await cdp.send('Page.navigate',{url},sessionId);
    await new Promise(r=>setTimeout(r,2500));
    const ev=async e=>JSON.parse((await cdp.send('Runtime.evaluate',{expression:e,returnByValue:true},sessionId)).result.value);
    // 异步版。上面那个不等 Promise —— 拿到的是一个 Promise 对象，value 是 undefined，
    // 于是 JSON.parse(undefined) 抛出，看上去像「页面坏了」而不是「求值器用错了」。
    const evA=async e=>JSON.parse((await cdp.send('Runtime.evaluate',
      {expression:e,returnByValue:true,awaitPromise:true},sessionId)).result.value);

    const seen=[];
    for(let i=0;i<8;i++){
      // **读渲染，不读属性。** 这一行原来写的是 `!el.hidden` —— 而 2026-08-31 真机上
      // 漏出来的引擎块，`el.hidden` 恰恰是 true：onboard.css 的 `#ob-engine{display:flex}`
      // 压过了 UA 的 `[hidden]{display:none}`，属性对、渲染错，于是这道门禁一路绿着
      // 把它送上了 App Store。问「用户看不看得见」只有 getClientRects 答得了。
      const s=await ev(`(()=>{const vis=el=>!!(el&&el.getClientRects().length);
        return JSON.stringify({
        step:(document.body&&document.body.dataset&&document.body.dataset.obStep)||'',
        title:(document.getElementById('ob-title')||{}).textContent||'',
        text:(document.getElementById('ob-text')||{}).textContent||'',
        w:(document.getElementById('ob-fill')||{style:{}}).style.width,
        quick:(()=>{const b=document.getElementById('ob-quick');
          return vis(b)?{n:b.querySelectorAll('button,select,input').length,
            plat:b.querySelectorAll('#qs-platform option').length,
            apply:!!b.querySelector('#qs-apply')}:null;})(),
        steps:(()=>{const ol=document.getElementById('ob-steps');
          if(!vis(ol)) return null;
          const li=[...ol.children];
          return {n:li.length,
            texts:li.filter(x=>(x.textContent||'').replace(/^\d+/,'').trim().length>3).length,
            arts:li.filter(x=>x.querySelector('svg')).length};})(),
        modes:vis(document.getElementById('ob-modes')),
        acts:['ob-cta','ob-next','ob-skip'].filter(id=>vis(document.getElementById(id))).length,
        // 每个可见按钮的**渲染背景**。判据不能是类名：secondary 挂对了而 CSS 规则
        // 没命中，正是 2026-09-02 那个 bug 的形状（填色写在裸 button 上，
        // button.secondary 是一条从没被用过的死规则）。
        // ⚠️ 这段注释在模板字符串里，**不许出现反引号** —— 它会把模板提前结束掉。
        //
        // 「填色」= 背景等于页面自己的 --accent。**在页面里解析**这个令牌（塞一个探针
        // 元素读回 computed 值），而不是在门禁里写死一个十六进制 —— 后者等于再抄一份
        // 调色板，调色板改一次这条断言就废了。
        accentBg:(()=>{const d=document.createElement('div');
          d.style.cssText='background:var(--accent);position:absolute;left:-9999px';
          document.body.appendChild(d);
          const v=getComputedStyle(d).backgroundColor; d.remove(); return v;})(),
        // **整屏所有可见按钮**，不只是页脚那三个。第一版只数 ob-cta/ob-next/ob-skip，
        // 于是「配好翻译、朗读、转写」（一键卡的按钮，在 body 里）与「继续」两个填色
        // 按钮并排时，这条断言看不见 —— 2026-09-02 靠一张截图才发现。
        // 排除 tab 切换器：选中态本来就该填色，那是「你在哪一档」不是「该点哪个」。
        btns:[...document.querySelectorAll('#onboard button')]
          .filter(b=>vis(b) && !b.closest('.mode-tabs'))
          .map(b=>({id:b.id||b.className||b.textContent.trim().slice(0,10),
            bg:getComputedStyle(b).backgroundColor})),
        manual:(()=>{const b=document.getElementById('ob-manual');
          return vis(b)?{sel:b.querySelectorAll('select').length,
            key:b.querySelectorAll('input[type=password]').length}:null;})(),
        // 旧的手动引擎块**必须不存在于 DOM**，不是「藏起来」——
        // 它换个 id 回来就是重复的配置项又回来了。
        engineInDom:!!document.getElementById('ob-engine'),
        // 前瞻性的那一条：#ob-quick / #ob-manual 之外**任何**可见的引擎下拉或密码框。
        // 按 id 断言只挡得住同名复辟，这一条挡得住换名复辟。
        stray:(()=>{const body=document.getElementById('ob-body');
          if(!body) return 0;
          return [...body.querySelectorAll('select,input[type=password]')]
            .filter(e=>!e.closest('#ob-quick')&&!e.closest('#ob-manual')&&e.getClientRects().length).length;})(),
        // 「首屏能不能看见前进键」。sticky 页脚之前，第 1 屏（三张插图 + 三行字）
        // 会把「继续」顶到 701px、视口只有 640 —— 而没人会想到往下滚一屏找前进键。
        fold:(()=>{const vis=el=>!!(el&&el.getClientRects().length);
          const n=document.getElementById('ob-next'), c=document.getElementById('ob-cta');
          const key=vis(n)?n:(vis(c)?c:null), sk=document.getElementById('ob-skip');
          return {vh:innerHeight,
            key:key?Math.round(key.getBoundingClientRect().bottom):null,
            skip:vis(sk)?Math.round(sk.getBoundingClientRect().bottom):null};})(),
        capture:vis(document.getElementById('ob-capture')),
        cta:vis(document.getElementById('ob-cta')),
        done:vis(document.getElementById('ob-done')),
        // 收尾屏的反馈出口：文字非空、链接是 mailto。HTML 在而 feedback.js 抛异常时
        // 这里是空的 —— 正是这道门禁存在的理由。
        fb:(()=>{const a=document.getElementById('ob-done-feedback-link'),tx=document.getElementById('ob-done-feedback-text');
          return {href:a?a.getAttribute('href')||'':'',text:(tx&&tx.textContent||'').trim(),link:(a&&a.textContent||'').trim()};})()})})()`);
      if(s.done){
        if(!/^mailto:/.test(s.fb.href)) fail(`收尾屏的反馈链接不是 mailto（${JSON.stringify(s.fb.href)}）—— feedback.js 没跑起来？`);
        else if(!s.fb.text||!s.fb.link) fail('收尾屏的反馈出口文字为空');
        else pass('收尾屏有反馈出口，链接是 mailto');
        break;
      }
      seen.push(s);
      // 点**可见**的那个按钮。'try' 屏没有「继续」（唯一行动是「打开示例页面」，
      // 它同时前进），照旧点 ob-next 会点到一个 display:none 的按钮 —— click() 照样
      // 触发，于是这道门禁永远发现不了那一屏变了。
      await ev(`(()=>{const vis=el=>!!(el&&el.getClientRects().length);
        const n=document.getElementById('ob-next');
        (vis(n)?n:document.getElementById('ob-cta')).click();return'1'})()`);
      await new Promise(r=>setTimeout(r,220));
    }
    console.log(`  屏数: ${seen.length}`);
    seen.forEach((s,i)=>console.log(`    ${i+1}. ${s.w.padStart(4)} ${s.title.slice(0,26).padEnd(28)}${s.quick?'[一键]':''}${s.manual?'[三引擎]':''}${s.capture?'[采集]':''}${s.cta?'[按钮]':''}`));
    // 屏**序**，不只是屏数。这一轮的 bug 正是顺序：sync 排在 try 之后，而 try 是终止屏
    // （它唯一的按钮开新标签，人就走了），于是「扩展里唯一提登录的地方」在真实使用中
    // 等于不存在 —— 而屏数是对的，5 屏一个不少，旧断言全绿。
    // try 必须是最后一屏：任何排在它后面的屏都到不了。
    const order = seen.map(s=>s.step).join(' → ');
    // 四屏，**两个 flavor 同形**。登录 2026-09-02 移出引导：它曾经排在「翻一页」之前，
    // 也就是要人在看到第一句译文之前先填邮箱收验证码。现在登录的请求由官网交接块
    // 在翻译成功那一刻提出、由复习页那行「未登录」接住 —— 都在他看到价值之后。
    const want = 'welcome → engine → capture → try';
    if(order!==want) fail(`屏序是 ${order}，期望 ${want}`);
    else pass(`屏序 ${want}`);
    if(seen.length!==4) fail(`屏数 ${seen.length}，期望 4`); else pass('屏数 4 —— 两个 flavor 同形');

    // ★ 引导里**不许再出现登录**。加回来的那天这条会红，并且会指着这段注释问为什么。
    // 理由不是「登录不重要」，恰恰相反：它太重要，所以不能问在人还没看到价值的时候。
    const loginish = /登录|登入|Sign in|ログイン|로그인|Connexion|Anmeld|Iniciar sesión|Entrar|Вход|تسجيل الدخول/i;
    const asksLogin = seen.filter(s=>loginish.test(s.title+' '+s.text));
    if(asksLogin.length) fail(`第 ${seen.indexOf(asksLogin[0])+1} 屏（${asksLogin[0].step}）又在引导里要人登录了：`
      + JSON.stringify(asksLogin[0].title)
      + ' —— 登录的请求归官网交接块与复习页，都在用户看到译文之后');
    else pass('引导里不提登录 —— 那一步在看到价值之后才问');
    if(seen.some(s=>!s.title.trim()||!s.text.trim())) fail('有屏的标题或正文是空的'); else pass('每屏都有标题与正文');
    // 判据是意图本身：这一屏上得有**某个**能配引擎的东西。不要拿某个具体元素当代理 ——
    // 代理会随改版失效，而失效的代理不会变红，只会变得没有意义。
    if(!seen.some(s=>s.quick||s.manual)) fail('没有引擎那一屏'); else pass('引擎屏在');
    // 每屏**只**露它自己那一块。第一屏尤其要紧：它是所有人看到的第一眼，而漏出来的
    // 那一块还是没被 paint 过的（下拉空、按钮没文字），比缺一块更难解释。
    // 第 1 屏的三步插图不许漏到别的屏 —— 它讲的是「怎么用」，配置屏上出现只会分散注意力。
    const stepLeak = seen.map((s,i)=>({i,has:!!s.steps})).filter(x=>x.i!==0&&x.has);
    if(stepLeak.length) fail(`第 ${stepLeak[0].i+1} 屏漏出了第 1 屏的三步插图`);
    else pass('三步插图只在第 1 屏');
    const first = seen[0] && seen[0].steps;
    if(!first) fail('第 1 屏没有那三步 —— 只剩一句话和一大片空白');
    else if(first.n !== 3) fail(`第 1 屏有 ${first.n} 步，期望 3`);
    else if(first.texts !== 3) fail(`第 1 屏只有 ${first.texts} 步有文字 —— i18n 键没解出来？`);
    else if(first.arts !== 3) fail(`第 1 屏只有 ${first.arts} 步有插图 —— <template> 没克隆进去？`);
    else pass('第 1 屏：三步，各有文字与插图');

    // ★ 每一屏的前进键都必须落在首屏之内。判据是**渲染出来的坐标**，不是 CSS 里
    //   写了什么 —— sticky 会因为祖先的 overflow 静默失效，而失效的样子就是这个数字变大。
    const below = seen.map((s,i)=>({i,f:s.fold}))
      .filter(x=>x.f && x.f.key!==null && x.f.key > x.f.vh);
    if(below.length) fail(`第 ${below[0].i+1} 屏的前进键在首屏之外`
      + `（底边 ${below[0].f.key} > 视口 ${below[0].f.vh}）—— 页脚没吸住，用户看不到能点什么`);
    else pass('每屏的前进键都在首屏之内');

    const leak = seen.map((s,i)=>({i,bad:[s.quick&&'一键卡',s.manual&&'三引擎',
      s.modes&&'切换标签',s.capture&&'采集'].filter(Boolean)}))
      .filter(x=>x.i===0&&x.bad.length);
    if(leak.length) fail(`欢迎屏上漏出了 ${leak[0].bad.join('、')} —— `
      + 'hidden 属性对但渲染没隐藏？查样式表里的 [hidden]{display:none!important}');
    else pass('欢迎屏干净 —— 第 2 屏的东西一样都没漏出来');
    // 「一把 key 配好全部」必须真的渲染出来。HTML 在而 JS 抛异常导致一片空白，
    // 正是这个门禁存在的理由 —— 而它对新组件尤其要紧：这一页刚加了六个 script。
    // ── 不变量：一键配置与逐引擎配置**永不同屏** ────────────────────────────
    // 共存时，用户在下面改了引擎，上面那张卡显示的「已配过 / 没配过」当场变成谎话，
    // 而它下一次被按下就会照着那份谎话覆盖存储。
    if(seen.some(s=>s.quick&&s.manual))
      fail('一键卡与三引擎同屏 —— 互斥的两个 tab 同时露出来了');
    else pass('一键卡与三引擎互斥，从没同屏');
    if(seen.some(s=>s.engineInDom))
      fail('#ob-engine 又回到 DOM 里了 —— 那是被替换掉的那份重复配置项');
    else pass('旧的手动引擎块不在 DOM 里');
    const strayAt = seen.findIndex(s=>s.stray);
    if(strayAt>=0)
      fail(`第 ${strayAt+1} 屏在两个 tab 之外露出了 ${seen[strayAt].stray} 个引擎下拉/密码框`
        + ' —— 换个 id 的重复配置项');
    else pass('两个 tab 之外没有任何引擎控件');
    // 一键卡在的那一屏必须给得出另一条路 —— 一键卡只覆盖 openrouter/openai（global）
    // 与 qwen（china）；china 的 7 个对话引擎里有 4 个在它之外，且没有免费通道。
    const qs = seen.filter(s=>s.quick);
    if(qs.length && !qs.every(s=>s.modes))
      fail('一键卡在，却没有切到「三引擎分别配」的入口 —— 不在一键清单里的引擎没路可走');
    else if(qs.length) pass('一键卡那屏有切换到三引擎的入口');

    // ── 真的去点一次那个 tab ────────────────────────────────────────────────
    // 上面几条断言只看遍历过程中的快照，而遍历从不点 tab —— 那样 s.manual 恒为 null，
    // 「互斥」和「tab 之外没有引擎控件」两条都会**空转变绿**。这一段是它们的前提。
    await ev(`(()=>{location.reload();return'1'})()`).catch(()=>{});
    await new Promise(r=>setTimeout(r,2200));
    const tab = await ev(`(()=>{const vis=el=>!!(el&&el.getClientRects().length);
      document.getElementById('ob-next').click();          // 欢迎 → 引擎
      const before={quick:vis(document.getElementById('ob-quick')),
                    manual:vis(document.getElementById('ob-manual'))};
      document.getElementById('ob-mode-manual').click();
      const box=document.getElementById('ob-manual');
      const after={quick:vis(document.getElementById('ob-quick')),
                   manual:vis(box),
                   sel:box?box.querySelectorAll('select').length:0,
                   key:box?box.querySelectorAll('input[type=password]').length:0,
                   base:box?box.querySelectorAll('input[type=url]').length:0,
                   labels:box?[...box.querySelectorAll('label')].filter(l=>l.textContent.trim()).length:0,
                   // 每一槽都得有自检按钮。这一页原来**零反馈**：填完 key 唯一的回应
                   // 是什么都没有，然后点「继续」—— 而这是整条链的第一环，key 没配对
                   // 要到他翻第一页时才发现（2026-09-02）。
                   tests:box?box.querySelectorAll('.ef-test-btn').length:0};
      document.getElementById('ob-mode-quick').click();
      const back={quick:vis(document.getElementById('ob-quick')),
                  manual:vis(document.getElementById('ob-manual'))};
      return JSON.stringify({before,after,back});})()`);
    if(!tab.before.quick||tab.before.manual)
      fail(`引擎屏默认不是「一键配置」：${JSON.stringify(tab.before)}`);
    else pass('引擎屏默认落在一键配置');
    if(tab.after.quick||!tab.after.manual)
      fail(`点了「三引擎分别配」之后不是互斥的：${JSON.stringify(tab.after)}`);
    else if(tab.after.sel!==3)
      fail(`三引擎那一页只有 ${tab.after.sel} 个引擎下拉，期望 3（翻译/朗读/转写）`);
    else if(tab.after.tests !== 3)
      fail(`三引擎那一页只有 ${tab.after.tests} 个「测试连接」，期望 3 —— `
        + '手动路原来零反馈：填完 key 唯一的回应是什么都没有，然后点「继续」');
    else if(!tab.after.key||!tab.after.base)
      fail(`三引擎那一页缺字段：Key ${tab.after.key} 个、地址 ${tab.after.base} 个`
        + ' —— 用户选的是「每行还带地址与模型」');
    else if(tab.after.labels<4)
      fail(`三引擎那一页只有 ${tab.after.labels} 个非空标签 —— i18n 键没解出来？`);
    else pass(`三引擎那一页：3 个引擎下拉、${tab.after.key} 个 Key、${tab.after.base} 个地址、`
      + `${tab.after.tests} 个「测试连接」，标签都有文字`);
    if(!tab.back.quick||tab.back.manual)
      fail(`切回「一键配置」没生效：${JSON.stringify(tab.back)}`);
    else pass('两个 tab 来回切都保持互斥');

    // ★ 任一屏**至多一个填色按钮**。
    //
    // 两个填色按钮并排时，用户看不出该点哪个 —— 而这一族问题在两个面上各犯过一次：
    // App 侧是两个白按钮（2026-09-02 用户截图），扩展侧是两个填色按钮（同日探查）。
    // 两次都没被拦下来，因为两侧门禁**都只数按钮个数，从不看长相**。
    //
    // 「填色」= 背景就是 accent 本身（页面里解析出来的那个值，见上面的探针）。
    const filledOn = seen.map((s,i)=>({i, step:s.step,
      filled:(s.btns||[]).filter(b=>s.accentBg && b.bg === s.accentBg)
        .map(b=>b.id+'='+b.bg)}));
    const twoFilled = filledOn.filter(x=>x.filled.length > 1);
    if(twoFilled.length){
      fail(`第 ${twoFilled[0].i+1} 屏（${twoFilled[0].step}）有 ${twoFilled[0].filled.length} 个填色按钮：`
        + twoFilled[0].filled.join('、')
        + ' —— 并排的两个主行动，用户看不出该点哪个');
    } else pass('每屏至多一个填色按钮');

    // 「现在翻一页看看」那一屏只该有一个按钮。配好了就去看，而「继续」（配好了但
    // 不去看）和「以后再设置」（配好了但不用）都在跟它抢注意力。
    // 按**页面自报的步骤 id** 认屏，不靠「长得像」。原来的判据是「第一个带 CTA 且
    // 没有一键卡/采集的屏」—— sync 屏同样满足它，于是 sync 排到 try 前面之后，这条
    // 断言就悄悄改成在考 sync 屏了（它有 3 个按钮，理应如此）。
    const tryScreen = seen.find(s=>s.step==='try');
    if(!tryScreen) fail('找不到「翻一页看看」那一屏');
    else if(tryScreen.acts !== 1)
      fail(`「翻一页看看」那屏有 ${tryScreen.acts} 个可点按钮，期望 1（只留「打开示例页面」）`);
    else pass('「翻一页看看」那屏只有一个按钮');

    const q = (seen.find(s=>s.quick)||{}).quick;
    if(!q) fail('引擎屏上没有「一把 key 配好全部」那张卡 —— HTML 在但没渲染？');
    else if(!q.apply) fail('卡渲染了但没有那个按钮');
    else {
      // global 有 openrouter.ai / api.openai.com 两组，china 只有 dashscope 一组；
      // 只有一项时刻意不渲染 <select>（一个只有一个选项的下拉是在假装有选择）。
      const wantSel = DIST==='dist-china' ? 0 : 2;
      if(q.plat!==wantSel) fail(`平台下拉 ${q.plat} 项，期望 ${wantSel}（china 只有一组，不该有下拉）`);
      else pass(`一键配置卡在，平台${wantSel?`下拉 ${wantSel} 项`:'唯一、不渲染下拉'}`);
    }
    // ★ 一键配置的自检**真的点一次**。
    //
    // 这道门禁原来只数按钮、只看渲染，从来没点过那个「配好翻译、朗读、转写」。
    // 于是 quick-setup 的 runOne 里一个 `opts.targetLang` 一路绿着上了线 —— runOne
    // 在 render 外面，那里根本没有 `opts` 这个名字，一进去就 ReferenceError，被自己
    // 的 try/catch 接住印成「✗ opts is not defined」，看上去像是用户的 key 或网络
    // 出了问题（2026-09-02 用户报的，1.7.2/1.7.3 都带着它）。
    //
    // 三个引擎测试是**打桩**的：这里验的是自检这条代码路径走不走得通，不是第三方
    // 端点通不通。真去请求的话，这道门禁就变成了对别人可用性的赌注。
    const sc = await evA(`(async()=>{
      window.EngineTest = Object.assign({}, window.EngineTest, {
        translation: async () => ({ ms: 11, text: '你好' }),
        tts: async () => ({ ms: 12 }),
        stt: async () => ({ ms: 13 }),
      });
      const key = document.getElementById('qs-key');
      if (!key) return JSON.stringify({ err: '找不到 #qs-key' });
      key.value = 'sk-verify-0123456789';
      key.dispatchEvent(new Event('input', { bubbles: true }));
      document.getElementById('qs-apply').click();
      for (let i = 0; i < 60; i++) {
        await new Promise(r => setTimeout(r, 100));
        if (!document.querySelector('#ob-quick .qs-idle')
            && document.querySelectorAll('#ob-quick .qs-ok, #ob-quick .qs-bad').length) break;
      }
      const rows = [...document.querySelectorAll('#ob-quick .qs-ok, #ob-quick .qs-bad, #ob-quick .qs-idle')]
        .map(c => ({ cls: c.className, txt: (c.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 90) }));
      return JSON.stringify({ rows });
    })()`);
    if(sc.err) fail('自检跑不起来：'+sc.err);
    else if(!sc.rows.length) fail('点了「配好」之后一行结果都没有 —— 自检没跑');
    else {
      const bad = sc.rows.filter(r=>/qs-bad/.test(r.cls));
      const ref = sc.rows.filter(r=>/is not defined|undefined is not|Cannot read/.test(r.txt));
      if(ref.length) fail(`自检印出了 JS 报错（不是引擎的错，是我们自己的）：${ref[0].txt}`);
      else if(bad.length) fail(`打桩全都成功，却有 ${bad.length} 行失败：${bad[0].txt}`);
      else pass(`一键配置自检跑通 ${sc.rows.length} 项，无一失败`);
    }

    if(!seen.some(s=>s.capture)) fail('没有采集那一屏'); else pass('采集屏在');
    if(seen[0].w===seen[seen.length-1].w) fail('进度条没动'); else pass(`进度条 ${seen[0].w} → ${seen[seen.length-1].w}`);
    if(errs.length){ok=false;console.log('  控制台错误:');errs.slice(0,4).forEach(e=>console.log('    '+e));}
    else pass('控制台无报错');
  } finally { chrome.cleanup(); srv.close(); }
  console.log(ok?`\n✓ ${DIST} 引导页通过`:`\n✗ ${DIST} 未通过`);
  process.exit(ok?0:1);
})().catch(e=>{console.error(e);process.exit(2);});
