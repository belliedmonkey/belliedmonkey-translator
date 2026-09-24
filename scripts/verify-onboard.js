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
// 仓库根按脚本位置算，不写死：写死的绝对路径会让 worktree / 别的机器上的门禁悄悄去验
// **另一棵树**的 dist（2026-09-06 就这么量到了一份旧调色板）。
const ROOT=path.join(__dirname,'..');
const { launchChrome }=require(path.join(ROOT,'test/layout/chrome.js'));
const { CDP }=require(path.join(ROOT,'test/layout/cdp.js'));
const { SWEEP_FN, installSweep, sweepBoth } = require('./lib/sweep.js');
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
        // storage 是**真的内存存储**，不是空壳（2026-09-22）。原来 get 恒回 {}、set 丢掉 ——
        // 那样一切「写了再读回来」的断言都测不出真话：遥测队列永远是空的、开关永远是默认值，
        // 而「发出去的那条带没带对属性」恰恰只能从队列里读。空壳让门禁看起来绿，实际什么都没验。
        storage:{local:(()=>{const m={};return{
          get:(k,cb)=>{const ks=Array.isArray(k)?k:(k==null?Object.keys(m):[k]);const o={};
            for(const x of ks) if(x in m) o[x]=m[x]; cb&&cb(o); },
          set:(o,cb)=>{Object.assign(m,o); cb&&cb(); },
          remove:(k,cb)=>{for(const x of (Array.isArray(k)?k:[k])) delete m[x]; cb&&cb(); },
        };})()}};
      ${SWEEP_FN}
      window.__sweep=__sweep;`},sessionId);
    await cdp.send('Page.navigate',{url},sessionId);
    await new Promise(r=>setTimeout(r,2500));
    const ev=async e=>JSON.parse((await cdp.send('Runtime.evaluate',{expression:e,returnByValue:true},sessionId)).result.value);
    // 异步版。上面那个不等 Promise —— 拿到的是一个 Promise 对象，value 是 undefined，
    // 于是 JSON.parse(undefined) 抛出，看上去像「页面坏了」而不是「求值器用错了」。
    const evA=async e=>JSON.parse((await cdp.send('Runtime.evaluate',
      {expression:e,returnByValue:true,awaitPromise:true},sessionId)).result.value);

    // 一屏的完整采样表达式。提成常量是因为分流屏要把 engine 屏**采两次**
    // （分流态一次、配置态一次），两次必须问同样的问题。
    const EXPR_SCREEN = `(()=>{const vis=el=>!!(el&&el.getClientRects().length);
        return JSON.stringify({
        step:(document.body&&document.body.dataset&&document.body.dataset.obStep)||'',
        title:(document.getElementById('ob-title')||{}).textContent||'',
        text:(document.getElementById('ob-text')||{}).textContent||'',
        w:(document.getElementById('ob-fill')||{style:{}}).style.width,
        // 额度卡（§8.10）**必须在逐屏采样里取**。第一版把它放在走完四屏之后单独读一次，
        // 那时页面停在第 4 屏，引擎屏上的两张卡自然都读不到 —— 门禁于是报「看不到那张卡」，
        // 而卡其实好好地画在第 2 屏上。判据要问「那一屏怎么样」，不是「现在怎么样」。
        grant:(()=>{const b=document.getElementById('ob-grant');
          const next=document.getElementById('ob-next');
          return {on: typeof LearnGrant!=='undefined' && LearnGrant.enabled(),
            vis:vis(b), text:b?(b.textContent||''):'',
            why:!b?'no-node':(b.hidden?'hidden':(b.children.length?'painted':'empty')),
            steps:b?b.querySelectorAll('.gr-steps li').length:0,
            hrefs:b?[...b.querySelectorAll('a[href]')].map(x=>x.getAttribute('href')).filter(h=>h&&h!=='#'):[],
            quickVis:vis(document.getElementById('ob-quick')),
            nextVis:vis(next), nextOff:!!(next&&next.disabled)};})(),
        quick:(()=>{const b=document.getElementById('ob-quick');
          return vis(b)?{n:b.querySelectorAll('button,select,input').length,
            plat:b.querySelectorAll('#qs-platform option').length,
            apply:!!b.querySelector('#qs-apply'),live:!!b.querySelector('#qs-live')}:null;})(),
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
          return {href:a?a.getAttribute('href')||'':'',text:(tx&&tx.textContent||'').trim(),link:(a&&a.textContent||'').trim()};})()})})()`;
    const seen=[];
    for(let i=0;i<8;i++){
      // **读渲染，不读属性。** 这一行原来写的是 `!el.hidden` —— 而 2026-08-31 真机上
      // 漏出来的引擎块，`el.hidden` 恰恰是 true：onboard.css 的 `#ob-engine{display:flex}`
      // 压过了 UA 的 `[hidden]{display:none}`，属性对、渲染错，于是这道门禁一路绿着
      // 把它送上了 App Store。问「用户看不看得见」只有 getClientRects 答得了。
      const s=await ev(EXPR_SCREEN);
      if(s.done){
        if(!/^mailto:/.test(s.fb.href)) fail(`收尾屏的反馈链接不是 mailto（${JSON.stringify(s.fb.href)}）—— feedback.js 没跑起来？`);
        else if(!s.fb.text||!s.fb.link) fail('收尾屏的反馈出口文字为空');
        else pass('收尾屏有反馈出口，链接是 mailto');
        break;
      }
      // 每一屏在深色 + 浅色下各扫一遍：每段看得见的文字 ≥ 4.5:1（scripts/lib/sweep.js）。
      // 2026-09-06 用户报「申请 key 的链接在深色下看不清」—— 那个 <a> 没人上色，1.9:1。
      s.contrast=await sweepBoth(cdp,sessionId,'body');
      // ★ 前置分流屏（2026-09-16，画布方案 A）。engine 屏现在有两个态：先问「你想
      // 怎么开始」，选了「我有自己的 API key」才露出今天就有的一键卡/三引擎。
      // 门禁在这里**显式走一次分流**，然后把这一屏重新采一遍 —— 于是下面所有关于
      // 引擎屏的老断言问的仍然是配置态，一条都不用改；分流态另外单独断言。
      // 不这么做的话，老断言会集体报「引擎屏上没有那张卡」，而卡其实在分流的另一侧。
      if(s.step==='engine'){
        const fk=await ev(`(()=>{const vis=el=>!!(el&&el.getClientRects().length);
          const f=document.getElementById('ob-fork');
          const n=document.getElementById('ob-next');
          return JSON.stringify({vis:vis(f),
            grantCard:vis(document.getElementById('ob-fork-grant')),
            keyCard:vis(document.getElementById('ob-fork-key')),
            grantCta:((document.getElementById('ob-fork-grant-cta')||{}).textContent||'').trim(),
            keyCta:((document.getElementById('ob-fork-key-cta')||{}).textContent||'').trim(),
            foot:((document.getElementById('ob-fork-foot')||{}).textContent||'').trim(),
            nextVis:vis(n), nextOff:!!(n&&n.disabled),
            grantOn: typeof LearnGrant!=='undefined' && LearnGrant.enabled()})})()`);
        s.fork=fk;
        if(fk.grantOn){
          // 有我们代领的额度 ⇒ 必须先问一句。两张卡都在，才是二选一而不是墙。
          if(s.quick&&s.quick.live) fail('引导页一键卡里又出现了 #qs-live（实时转写格）—— 2026-09-17 起实时转写固定为设备内置');
          if(!fk.vis) fail('开了免费额度，引擎屏却没有前置分流屏');
          else if(!fk.grantCard||!fk.keyCard) fail(`分流屏缺一张卡（额度=${fk.grantCard} key=${fk.keyCard}）`);
          else if(!fk.grantCta||!fk.keyCta||!fk.foot) fail('分流屏有卡但文案是空的 —— i18n key 漏了？');
          // 裁定 D2 在这一屏同样成立：「继续」必须可见且没被禁用，否则选择就成了墙。
          else if(!fk.nextVis||fk.nextOff) fail('分流屏上的「继续」不可见或被禁用 —— 那就成墙了（裁定 D2）');
          else pass('引擎屏先问「你想怎么开始」：两张卡 + 文案齐，「继续」仍可点');
          // 走「我有自己的 API key」那一侧，把这一屏重新采成配置态
          await ev(`(document.getElementById('ob-fork-key').click(),'1')`);
          await new Promise(r=>setTimeout(r,260));
          const again=await ev(`(()=>{const vis=el=>!!(el&&el.getClientRects().length);
            return JSON.stringify({forkVis:vis(document.getElementById('ob-fork')),
              modes:vis(document.getElementById('ob-modes')),
              quickVis:vis(document.getElementById('ob-quick'))})})()`);
          if(again.forkVis) fail('选了「我有自己的 API key」之后，分流屏没有收起');
          else if(!again.modes&&!again.quickVis) fail('选了「我有自己的 API key」之后，旧的配置块没有露出来 —— 旧路径被堵死了');
          else pass('选「我有自己的 API key」后，今天就有的配置块原样回来');
        }else{
          // 没有我们代领的额度（中国版：那里放的是阿里云的官方额度指路卡，不是第二条路）
          if(fk.vis) fail('这个构建没有我们代领的额度（MT_GRANT=null），分流屏却出来了 —— 那会给出一个不存在的选项');
          else pass('没有代领额度的构建：分流屏一个像素都没出，引擎屏逐字照旧');
        }
        // 重采这一屏（现在是配置态），让下面所有老断言问的仍然是配置态
        if(fk.grantOn){
          const s2=await ev(EXPR_SCREEN);
          s2.contrast=s.contrast; s2.fork=fk;
          seen.push(s2);
          await ev(`(()=>{const vis=el=>!!(el&&el.getClientRects().length);
            const n=document.getElementById('ob-next');
            (vis(n)?n:document.getElementById('ob-cta')).click();return'1'})()`);
          await new Promise(r=>setTimeout(r,220));
          continue;
        }
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
    // 2026-09-22：capture 屏砍掉（画布 #392）⇒ 三屏。
    const want = 'welcome → engine → try';
    if(order!==want) fail(`屏序是 ${order}，期望 ${want}`);
    else pass(`屏序 ${want}`);
    if(seen.length!==3) fail(`屏数 ${seen.length}，期望 3`); else pass('屏数 3 —— 两个 flavor 同形');

    // ★ 引导里**不许再出现登录**。加回来的那天这条会红，并且会指着这段注释问为什么。
    // 理由不是「登录不重要」，恰恰相反：它太重要，所以不能问在人还没看到价值的时候。
    const loginish = /登录|登入|Sign in|ログイン|로그인|Connexion|Anmeld|Iniciar sesión|Entrar|Вход|تسجيل الدخول/i;
    const asksLogin = seen.filter(s=>loginish.test(s.title+' '+s.text));
    if(asksLogin.length) fail(`第 ${seen.indexOf(asksLogin[0])+1} 屏（${asksLogin[0].step}）又在引导里要人登录了：`
      + JSON.stringify(asksLogin[0].title)
      + ' —— 登录的请求归官网交接块与复习页，都在用户看到译文之后');
    else pass('引导里的**标题与正文**不提登录 —— 那一步在看到价值之后才问');

    // ★ 2026-09-08 起有一个**有界的例外**：免费额度那张卡（§8.10，裁定 D2）。
    //
    // 上面那条判的是屏的标题与正文；这条判的是那张卡。两者不是一回事：
    // 「在人还没看到价值之前就用登录挡住他」仍然禁止，而「给他一个可以不点的选项」
    // 不是墙。所以判据是**并存**，不是「有没有出现登录字样」：
    //   · 额度卡里可以提登录；
    //   · 但「用自己的 key」那张卡必须同屏可见；
    //   · 「继续」必须同屏可见**且没被禁用**。
    // 三条里任何一条不成立，它就从选项变回了墙。
    //
    // MT_GRANT 为 null 时（今天的两个 flavor）这张卡整块不出，于是这条断言说的是
    // 「它确实一个字都没出」—— 那也是一个真判据，不是空转。
    const eng = seen.find(x=>x.step==='engine');
    const g = eng && eng.grant;
    if(!g) fail('没采到引擎屏的额度卡状态 —— 这条断言在空转');
    else if(!g.on && /china/.test(DIST)){
      // 中国版**没有**我们代领的额度（原文会经东京中转，境内后端未就绪），
      // 那个位置放的是另一件真事：阿里云百炼自己给的免费额度（G5 / 画布 A10）。
      // 三条判据缺一不可 —— 有卡、有三步、**没有登录字样**（中国版一个登录入口都没有），
      // 而且链接是真地址（来自注册表 keyUrl），不是一个 href="#" 的假链接。
      if(!g.vis) fail(`中国版引擎屏没有那张官方额度卡（原因位=${g.why}）`);
      else if(loginish.test(g.text)) fail('中国版那张卡上出现了登录字样 —— 那个 flavor 里没有登录');
      else if(g.steps!==3) fail(`那张卡有 ${g.steps} 步，期望 3`);
      else if(!g.hrefs.some(h=>/^https:/.test(h))) fail(`那张卡没有可点的真地址：${JSON.stringify(g.hrefs)}`);
      else pass('中国版：官方免费额度三步卡在，链接是真地址，没有登录字样');
    }
    else if(!g.on){
      if(g.vis) fail('MT_GRANT 是 null，额度卡却画出来了');
      else pass('这个构建没有免费额度（MT_GRANT=null），卡一个字都没出');
    } else {
      if(!g.vis) fail(`开了免费额度，引擎屏却看不到那张卡（原因位=${g.why}）`);
      else if(!loginish.test(g.text)) fail('额度卡上没有登录入口 —— 那它就不是这张卡了');
      else if(!g.quickVis) fail('额度卡在，但「用自己的 key」那张卡不同屏 —— 登录就成了墙');
      else if(!g.nextVis || g.nextOff) fail('额度卡在，但「继续」不可见或被禁用 —— 登录就成了墙');
      else pass('额度卡与「用自己的 key」同屏，「继续」可点 —— 登录是选项不是墙');
    }
    const dim=seen.filter(s=>s.contrast&&s.contrast.length);
    if(dim.length) fail(`第 ${seen.indexOf(dim[0])+1} 屏有看不清的文字：${dim[0].contrast.slice(0,5).join(' | ')}${dim[0].contrast.length>5?' …共 '+dim[0].contrast.length+' 处':''}`);
    else pass('每屏文字在深色与浅色下都 ≥ 4.5:1');
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
      // 引擎屏现在可能先出前置分流屏（2026-09-16，画布方案 A）。这一段验的是两个 tab
      // 的互斥，那是**配置态**里的事，所以先走「我有自己的 API key」那一侧。
      // 没有分流屏的构建（中国版）这一步是空操作。
      const fkk=document.getElementById('ob-fork-key');
      if(fkk&&fkk.getClientRects().length) fkk.click();
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
      // 推导出来的组：global 两组、china 一组；**再加一项「自定义」**（#421 方案 C，
      // 2026-09-24）—— 手里有一个能用的 OpenAI 兼容地址的人，原来在这张卡上无路可走。
      // 所以两个 flavor 现在都有下拉（china 从「唯一、不渲染」变成两项）。
      const wantSel = DIST==='dist-china' ? 2 : 3;
      if(q.plat!==wantSel) fail(`平台下拉 ${q.plat} 项，期望 ${wantSel}（推导组 + 自定义那一项）`);
      else pass(`一键配置卡在，平台下拉 ${wantSel} 项（含「自定义」）`);
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

    // ★ 「自定义」那一项（#421 方案 C）：选它之后卡必须变 —— 多一个地址框、按钮只承诺
    //   一样、缺地址点了什么都不写、填上之后真把地址写进 apiBaseUrl。
    //   判据是**存储里那三个键**，不是界面上的绿勾：写不写得进去才是这张卡的作用。
    const cu = await evA(`(async()=>{
      const sel = document.getElementById('qs-platform');
      if (!sel) return JSON.stringify({ err: '没有平台下拉' });
      const opts = [...sel.options];
      const i = opts.findIndex(o => o.dataset && o.dataset.custom === '1');   // 渲染器给自定义那一项标了 data-custom
      if (i < 0) return JSON.stringify({ err: '下拉里没有「自定义」那一项：' + opts.map(o => o.textContent).join(' | ') });
      sel.value = String(i);
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(r => setTimeout(r, 60));
      const row = document.getElementById('qs-base-row');
      const base = document.getElementById('qs-base');
      const btn = document.getElementById('qs-apply');
      const shown = !!(row && !row.hidden && row.getClientRects().length);
      const applyText = (btn.textContent || '').trim();
      const ph = base ? base.placeholder : '';
      // ① 缺地址：点了什么都不该写
      await new Promise(r => chrome.storage.local.remove(['provider', 'apiKey', 'apiBaseUrl'], r));
      const key = document.getElementById('qs-key');
      key.value = 'sk-verify-custom-1'; key.dispatchEvent(new Event('input', { bubbles: true }));
      btn.click();
      await new Promise(r => setTimeout(r, 500));
      const after0 = await new Promise(r => chrome.storage.local.get(['provider', 'apiKey', 'apiBaseUrl'], v => r(v || {})));
      // ② 填上地址再点
      base.value = 'https://gw.example.internal/v1/chat/completions';
      base.dispatchEvent(new Event('input', { bubbles: true }));
      btn.click();
      for (let i = 0; i < 60; i++) {
        await new Promise(r => setTimeout(r, 100));
        if (document.querySelectorAll('#ob-quick .qs-ok, #ob-quick .qs-bad').length) break;
      }
      const after1 = await new Promise(r => chrome.storage.local.get(['provider', 'apiKey', 'apiBaseUrl'], v => r(v || {})));
      const rows = [...document.querySelectorAll('#ob-quick .qs-res li')]
        .map(li => (li.textContent || '').replace(/\s+/g, ' ').trim());
      return JSON.stringify({ shown, applyText, ph, after0, after1, rows });
    })()`);
    if(cu.err) fail('自定义那一项验不了：'+cu.err);
    else {
      if(!cu.shown) fail('选了「自定义」却没有地址框 —— 那一条引擎没有默认端点，不填地址配了也是死的');
      else pass('选「自定义」⇒ 出地址框');
      if(!/^https?:\/\//.test(cu.ph||'')) fail(`地址框的占位符不是注册表里的示例地址：「${cu.ph}」`);
      else pass('地址框的占位符来自注册表（不是卡里另抄一份）');
      if(cu.after0 && cu.after0.apiKey) fail('缺地址就把 key 写进去了 —— 卡上会说「配好了」，而端点是空的');
      else pass('缺地址 ⇒ 一个键都不写');
      if(!(cu.after1 && cu.after1.apiBaseUrl === 'https://gw.example.internal/v1/chat/completions'))
        fail('填了地址点「配好」，apiBaseUrl 没写进去：'+JSON.stringify(cu.after1));
      else pass('填地址 ⇒ provider / key / apiBaseUrl 三个键都写对了');
      const absent = (cu.rows||[]).filter(x=>/不提供|not offered|提供されません|제공하지|non proposé|nicht angeboten|no lo ofrece|não oferece|не даёт|لا يوفّره|नहीं देता/.test(x));
      if(absent.length !== 2) fail(`朗读 / 转写那两行该说「这个地址不提供」，实际 ${JSON.stringify(cu.rows)}`);
      else pass('朗读 / 转写如实说「这个地址不提供」（不是「你已经配过了」）');
    }


    // ── 「继续」不许把填好的 key 静默丢掉 ──────────────────────────────────
    //
    // 提交键 #qs-apply 在一键卡的最下面，而这一屏在手机宽度上装不下两张卡：
    // 2026-09-09 iPhone Safari 实测 393×659，免费额度卡把 #qs-apply 顶到 y=635，
    // 吸底页脚从 554 起 —— 首屏唯一看得见的按钮是「继续」。它当时只前进不提交，
    // 于是粘完 key 点它 = key 没了、界面还说设置完成。**静默失败**，而当时三道
    // 引导门禁一条都没红：它们只看「有没有画出来」，从不按一次那颗最显眼的键。
    //
    // 与上面那段同样打桩 EngineTest —— 验的是「继续」这条代码路径，不是端点通不通。
    const keep = await evA(`(async()=>{
      const vis = el => !!(el && el.getClientRects().length);
      window.EngineTest = Object.assign({}, window.EngineTest, {
        translation: async () => ({ ms: 11, text: '你好' }),
        tts: async () => ({ ms: 12 }),
        stt: async () => ({ ms: 13 }),
      });
      const res = document.getElementById('qs-res');
      if (res) { res.hidden = true; res.textContent = ''; }      // 回到「还没提交过」
      const k = document.getElementById('qs-key');
      if (!k) return JSON.stringify({ err: '引擎屏上没有 qs-key' });
      k.value = 'sk-verify-continue-0123456789';
      k.dispatchEvent(new Event('input', { bubbles: true }));
      document.getElementById('ob-next').click();
      await new Promise(r => setTimeout(r, 500));
      const h2 = document.querySelector('#ob-body h2');
      return JSON.stringify({ err: null, res: vis(document.getElementById('qs-res')),
                              stillEngine: vis(document.getElementById('ob-quick')),
                              head: h2 ? h2.textContent.slice(0, 20) : '' });
    })()`);
    if(keep.err) fail(keep.err);
    else if(!keep.res)
      fail('引擎屏填了 key 之后点「继续」，一键配置没有提交（#qs-res 仍不可见）'
        + ' —— 手机上它是首屏唯一可见的按钮，这等于把 key 静默丢掉');
    else if(!keep.stillEngine)
      fail('点「继续」替用户提交了，却同时翻页了 —— 三行结果是「真的配上了」的唯一证据，'
        + `不能让它一闪而过（当前标题「${keep.head}」）`);
    else pass('引擎屏填了 key 点「继续」：先提交、且停在原屏让结果看得见');

    // 2026-09-22：采集屏被砍掉了（画布 #392）。断言反过来 —— 它**不许回来**，
    // 因为它教的是一个默认已开的开关，净作用是给用户一个关掉它的机会。
    if(seen.some(s=>s.capture)) fail('采集屏又回来了 —— 它教的是一个默认已开的开关');
    else pass('没有采集屏（开关与采集语言只在设置页）');


    // 离开引导时那一条 onboarding_done 必须带上 result 与 step（telemetry-design §3.6）。
    // **判据是队列里真的有那条、且属性是对的**，不是「代码里有 track 调用」——
    // 静态 seam 门禁证明得了后者，证明不了前者：客户端的 shape() 会把白名单外的属性
    // 静默丢掉，所以少生成一次 providers.gen.js，这两个属性就凭空消失而没人看得见。
    const STEPS_OK=['welcome','engine','try'];
    const DWELL_OK=['0-2','3-9','10-29','30+'];
    const skipped=await evA(`(async()=>{
      // 两件必须先做，否则测到的是「不发」这件废事：
      //   ① allowAutomation —— spec() 在 navigator.webdriver 为真时返回 null（自动化不算
      //      用户，免得每跑一次门禁就往线上表里写两行）。这是它自己留的逃生口，smoke 也用它。
      //      **只入队、不 flush**（FLUSH_AT 10 / FLUSH_MS 60s），所以一个字节都不会发出去。
      //   ② tm:on —— 走完这几屏的过程中那个开关被点掉了。
      // 中国版产物里 MT_TELEMETRY **根本不存在**（不是关着）—— 那是 Gate D 的承诺。
      // 所以这一条在中国版上反过来断言：点完跳过，队列必须仍然是空的。
      if(!window.MT_TELEMETRY){
        const sk0=document.getElementById('ob-skip'); if(sk0) sk0.click();
        await new Promise(r=>setTimeout(r,400));
        const q0=await new Promise(r=>chrome.storage.local.get(['tm:queue'],v=>r((v||{})['tm:queue']||[])));
        return JSON.stringify({china:true,n:q0.length});
      }
      try{ window.MT_TELEMETRY.allowAutomation=true; }catch(_){}
      await new Promise(r=>chrome.storage.local.set({'tm:on':true},r));
      await new Promise(r=>chrome.storage.local.remove(['tm:queue'],r));
      const sk=document.getElementById('ob-skip');
      if(!sk) return JSON.stringify({err:'引导页上没有「以后再设置」'});
      sk.click();
      await new Promise(r=>setTimeout(r,400));
      const q=await new Promise(r=>chrome.storage.local.get(['tm:queue'],v=>r((v||{})['tm:queue']||[])));
      const e=q.filter(x=>x&&x.name==='onboarding_done').pop();
      if(e) return JSON.stringify({err:null,props:e.props||{}});
      // 空队列有好几种原因，逐个说出来 —— 「没有」本身不是诊断
      const diag={tm:typeof MTTelemetry,spec:!!(window.MT_TELEMETRY&&window.MT_TELEMETRY.spec),
        on:(typeof MTTelemetry!=='undefined'&&MTTelemetry.enabled)?await MTTelemetry.enabled():null,
        names:q.map(x=>x&&x.name),obHidden:!!(document.getElementById('onboard')||{}).hidden};
      return JSON.stringify({err:'点了跳过，队列里却没有 onboarding_done · 诊断 '+JSON.stringify(diag)});
    })()`);
    if(skipped.china){
      if(skipped.n) fail(`中国版产物里竟然攒出了 ${skipped.n} 条遥测 —— Gate D 说好一条都不发`);
      else pass('中国版：点完跳过队列仍为空（没有 MT_TELEMETRY，一条都不发）');
    }
    else if(skipped.err) fail(skipped.err);
    else{
      const p=skipped.props||{};
      if(p.result!=='skipped')
        fail(`跳过发出的 result 是「${p.result}」而不是 skipped —— 走完与放弃又分不开了`);
      else if(!STEPS_OK.includes(p.step))
        fail(`跳过发出的 step 是「${p.step}」，不在屏序里 —— 它与 OB 数组同源，对不上就是记错了`);
      // dwell（§3.9 提案 A）：这一条**必须在队列里真的看得到**。静态门禁只能证明代码里
      // 带了这个键 —— 而 shape() 会把白名单外的属性连整条事件一起丢掉，所以少生成一次
      // providers.gen.js，dwell 要么整条不见、要么静默消失，两种在代码里都看不出来。
      // 门禁跑完这几屏通常在 10 s 以内，所以这里不钉具体的桶，只钉「是那四个之一」。
      else if(!DWELL_OK.includes(p.dwell))
        fail(`跳过发出的 dwell 是「${p.dwell}」，不在 ${DWELL_OK.join(' / ')} 里 —— `
          + '要么没打「引导出现」那一刻的点，要么它没进注册表（重新生成 providers.gen.js）');
      else pass(`跳过发出 onboarding_done{result:skipped, step:${p.step}, dwell:${p.dwell}}`);
    }
    if(seen[0].w===seen[seen.length-1].w) fail('进度条没动'); else pass(`进度条 ${seen[0].w} → ${seen[seen.length-1].w}`);
    if(errs.length){ok=false;console.log('  控制台错误:');errs.slice(0,4).forEach(e=>console.log('    '+e));}
    else pass('控制台无报错');
  } finally { chrome.cleanup(); srv.close(); }
  console.log(ok?`\n✓ ${DIST} 引导页通过`:`\n✗ ${DIST} 未通过`);
  process.exit(ok?0:1);
})().catch(e=>{console.error(e);process.exit(2);});
