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
    // chrome.storage 在普通页面上不存在 —— 打桩，正是要验 storageGet 的超时兜底之外的路径
    await cdp.send('Page.addScriptToEvaluateOnNewDocument',{source:`
      window.chrome={runtime:{getURL:s=>s,id:'x',openOptionsPage(){}},
        i18n:{getUILanguage:()=>'zh-CN',getMessage:()=>''},
        storage:{local:{get:(k,cb)=>cb({}),set:(o,cb)=>cb&&cb(),remove:(k,cb)=>cb&&cb()}}};`},sessionId);
    await cdp.send('Page.navigate',{url},sessionId);
    await new Promise(r=>setTimeout(r,2500));
    const ev=async e=>JSON.parse((await cdp.send('Runtime.evaluate',{expression:e,returnByValue:true},sessionId)).result.value);

    const seen=[];
    for(let i=0;i<8;i++){
      const s=await ev(`JSON.stringify({
        title:(document.getElementById('ob-title')||{}).textContent||'',
        text:(document.getElementById('ob-text')||{}).textContent||'',
        w:(document.getElementById('ob-fill')||{style:{}}).style.width,
        engine:!document.getElementById('ob-engine').hidden,
        capture:!document.getElementById('ob-capture').hidden,
        cta:!document.getElementById('ob-cta').hidden,
        done:!document.getElementById('ob-done').hidden})`);
      if(s.done) break;
      seen.push(s);
      await ev(`(()=>{document.getElementById('ob-next').click();return'1'})()`);
      await new Promise(r=>setTimeout(r,220));
    }
    console.log(`  屏数: ${seen.length}`);
    seen.forEach((s,i)=>console.log(`    ${i+1}. ${s.w.padStart(4)} ${s.title.slice(0,26).padEnd(28)}${s.engine?'[引擎]':''}${s.capture?'[采集]':''}${s.cta?'[按钮]':''}`));
    const expect = DIST==='dist-china'?4:5;
    if(seen.length!==expect) fail(`屏数 ${seen.length}，期望 ${expect}`); else pass(`屏数 ${expect} —— 与 flavor 相符`);
    if(seen.some(s=>!s.title.trim()||!s.text.trim())) fail('有屏的标题或正文是空的'); else pass('每屏都有标题与正文');
    if(!seen.some(s=>s.engine)) fail('没有引擎那一屏'); else pass('引擎屏在');
    if(!seen.some(s=>s.capture)) fail('没有采集那一屏'); else pass('采集屏在');
    if(seen[0].w===seen[seen.length-1].w) fail('进度条没动'); else pass(`进度条 ${seen[0].w} → ${seen[seen.length-1].w}`);
    if(errs.length){ok=false;console.log('  控制台错误:');errs.slice(0,4).forEach(e=>console.log('    '+e));}
    else pass('控制台无报错');
  } finally { chrome.cleanup(); srv.close(); }
  console.log(ok?`\n✓ ${DIST} 引导页通过`:`\n✗ ${DIST} 未通过`);
  process.exit(ok?0:1);
})().catch(e=>{console.error(e);process.exit(2);});
