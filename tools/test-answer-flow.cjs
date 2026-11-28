'use strict';
// Requires Playwright and an installed Chrome. No test-only hooks in application code.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

(async () => {
  const browser = await chromium.launch({channel:'chrome',headless:true});
  try {
    for (const native of [true, false]) {
      const context = await browser.newContext({viewport:{width:native?390:1280,height:844},hasTouch:native,reducedMotion:'reduce'});
      const page = await context.newPage(), errors=[];
      page.on('pageerror', error => errors.push(error.message));
      await page.addInitScript(native => {
        window.speechCalls=[];window.failSpeech=false;window.mockHidden=false;
        Object.defineProperty(document,'hidden',{get:()=>window.mockHidden});
        window.SpeechSynthesisUtterance=class{constructor(text){this.text=text;}};
        const stop=()=>{for(const call of speechCalls) if(call.phase==='speaking')call.phase='canceled';};
        if(native)window.WordMasterAndroid={getInfo:()=>'{"platform":"Android","version":"2.0.2"}',setTheme(){},request(){},stopSpeak:stop,
          speak(text,rate,pitch,id){speechCalls.push({text,id,phase:'speaking'});return !failSpeech;},
          getSpeechState(id){return speechCalls.find(call=>call.id===id)?.phase||'unknown';}};
        else Object.defineProperty(window,'speechSynthesis',{value:{getVoices:()=>[],cancel:stop,
          get speaking(){return speechCalls.some(call=>call.phase==='speaking');},pending:false,
          speak(utter){if(failSpeech)throw Error('no voice');utter.phase='speaking';speechCalls.push(utter);}}});
        window.endSpeech=(index,notify=true,status='done')=>{
          const call=speechCalls[index];call.phase=status;
          if(!notify)return;
          if(native)WMAndroidSpeechComplete(call.id,status);
          else if(status==='done')call.onend();else call.onerror({error:status==='canceled'?'interrupted':'synthesis-failed'});
        };
      }, native);
      await page.goto(pathToFileURL(path.resolve(__dirname,'../src/index.html')).href);
      await page.waitForSelector('.hero');
      assert.equal(await page.evaluate(()=>WM.store.get().settings.autoNext),true);
      const tap = locator => native ? locator.tap() : locator.click();
      const start=async(options={})=>{
        await page.evaluate(options=>{
          WM.study.destroy();WM.views.applySettings({trainingMode:'choice',direction:'en2zh',autoNext:true,autoPronounce:false,sound:false,showDetail:true,dailyCount:200,sessionSize:5,...options});
          WM.app.go('home');speechCalls=[];failSpeech=false;
        },options);
        await tap(page.locator('.hero .primary'));
        await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      };
      const correct=async()=>{
        const q=await page.evaluate(()=>({mode:WM.study.session.current.trainingMode,en:WM.study.session.current.entry.en,index:WM.study.session.current.answerIndex}));
        if(q.mode==='spelling'){
          await page.locator('#spelling-answer').fill(q.en);
          await page.locator('#spelling-answer').press('Enter');
        } else await tap(page.locator('.opt').nth(q.index));
        return q;
      };
      const spoken=()=>page.waitForFunction(()=>speechCalls.some(call=>call.phase==='speaking'));
      const finish=async(notify=true,status='done')=>page.evaluate(({notify,status})=>endSpeech(speechCalls.length-1,notify,status),{notify,status});
      const next=()=>page.waitForFunction(()=>WM.study.session?.index===1,{},{timeout:4000});

      // Normal completion, lost completion callback, both directions and spelling.
      for(const trainingMode of ['choice','spelling'])for(const direction of ['en2zh','zh2en']) {
        if(trainingMode==='spelling'&&direction==='en2zh')continue;
        for(const notify of [true,false]) {
          await start({trainingMode,direction});
          const before=await page.locator('.q-prompt').evaluate(el=>el.getBoundingClientRect().top+document.getElementById('view').scrollTop);
          const q=await correct();await spoken();
          assert.equal(await page.locator('.study-top .bar i').evaluate(el=>el.style.width),'20%');
          assert.equal(await page.evaluate(()=>speechCalls[0].text),q.en);
          const after=await page.locator('.q-prompt').evaluate(el=>el.getBoundingClientRect().top+document.getElementById('view').scrollTop);
          assert.equal(after,before,'answer feedback must not move the prompt');
          await page.waitForTimeout(350);
          assert.equal(await page.evaluate(()=>WM.study.session.index),0,'do not interrupt a speaking word');
          await finish(notify);await next();
          if(trainingMode==='spelling') assert.equal(await page.evaluate(()=>document.activeElement.id),'spelling-answer');
          await page.evaluate(()=>endSpeech(0));await page.waitForTimeout(250);
          assert.equal(await page.evaluate(()=>WM.study.session.index),1,'late/duplicate completion cannot skip');
          assert.equal(await page.evaluate(()=>speechCalls.length),1,'read answered word once');
        }
      }
      // Reproduce the reported freeze after an incidental touch or scroll.
      await start();await correct();await spoken();
      await tap(page.locator('.q-word'));
      await page.evaluate(()=>{document.getElementById('view').scrollTop+=20;});
      await finish(false);await next();

      await start();const q=await correct();await spoken();
      // Use a physical second tap. Locator.click would wait for aria-disabled
      // to clear and inadvertently click a different question after the deadline.
      const rect=await page.locator('.opt').nth(q.index).boundingBox();
      if(native)await page.touchscreen.tap(rect.x+rect.width/2,rect.y+rect.height/2);
      else await page.mouse.click(rect.x+rect.width/2,rect.y+rect.height/2);
      assert.equal(await page.evaluate(()=>WM.study.session.correct),1,'double tap records one answer');
      await finish();await next();

      // Explicit pause, details, bookmark, replay and resume have visible state.
      await start();await correct();await spoken();
      await tap(page.getByRole('button',{name:'暂停',exact:true}));
      await finish();await page.waitForTimeout(350);
      assert.equal(await page.evaluate(()=>WM.study.session.index),0);
      assert.match(await page.locator('.flow-status').innerText(),/已暂停/);
      await tap(page.getByRole('button',{name:'查看词条',exact:true}));
      await tap(page.locator('.answer-details button[aria-pressed]'));
      assert.equal(await page.locator('.answer-details button[aria-pressed]').getAttribute('aria-pressed'),'true');
      await tap(page.getByRole('button',{name:'恢复自动',exact:true}));await spoken();await finish();await next();

      await start();await correct();await spoken();
      await tap(page.locator('.q-sub .speak-btn'));await page.waitForFunction(()=>speechCalls.length===2);
      await page.evaluate(()=>endSpeech(0));await page.waitForTimeout(250);
      assert.equal(await page.evaluate(()=>WM.study.session.index),0,'old speech cannot finish replay');
      await finish();await next();

      // Navigation/dialog/background must pause visibly, and manual next remains usable.
      await start();await correct();await spoken();
      await tap(page.getByRole('button',{name:'退出',exact:true}));await finish();
      await page.waitForTimeout(350);assert.equal(await page.evaluate(()=>WM.study.session.index),0);
      await tap(page.getByRole('button',{name:'继续学习',exact:true}));
      assert.match(await page.locator('.flow-status').innerText(),/已暂停/);
      await tap(page.getByRole('button',{name:'下一题',exact:true}));await next();

      await start();await correct();await spoken();
      await page.evaluate(()=>{WM.app.navigate('settings');});await finish();
      await page.waitForTimeout(300);assert.equal(await page.evaluate(()=>WM.study.session.index),0);
      await tap(page.getByRole('button',{name:'继续学习',exact:true}));
      assert.match(await page.locator('.flow-status').innerText(),/已暂停/);

      await start();await correct();await spoken();
      await page.evaluate(()=>{mockHidden=true;document.dispatchEvent(new Event('visibilitychange'));});await finish();
      await page.evaluate(()=>{mockHidden=false;document.dispatchEvent(new Event('visibilitychange'));});
      assert.equal(await page.evaluate(()=>WM.study.session.index),0);
      assert.match(await page.locator('.flow-status').innerText(),/已暂停/);
      await tap(page.getByRole('button',{name:'恢复自动',exact:true}));await spoken();await finish();await next();

      for(const status of ['error','canceled']) {
        await start();await correct();await spoken();await finish(true,status);await next();
      }
      await start();await page.evaluate(()=>failSpeech=true);await correct();await next();

      await start({autoNext:false});await correct();await page.waitForTimeout(300);
      assert.equal(await page.evaluate(()=>WM.study.session.index),0);
      await tap(page.getByRole('button',{name:'自动切题：关',exact:true}));await spoken();await finish();await next();

      await start({autoPronounce:true});await spoken();await correct();
      await page.waitForFunction(()=>speechCalls.length===2);
      await page.evaluate(()=>endSpeech(0));await page.waitForTimeout(200);
      assert.equal(await page.evaluate(()=>WM.study.session.index),0,'prompt reading cannot advance the answered question');
      await finish();await next();

      // Composition and wrong answers: keep the typed answer, reveal detail, append one retry.
      await start({trainingMode:'spelling'});
      await page.locator('#spelling-answer').fill('mistake');
      await page.locator('#spelling-answer').dispatchEvent('compositionstart');
      await tap(page.getByRole('button',{name:'检查拼写',exact:true}));
      assert.equal(await page.evaluate(()=>WM.study.session.answered),false);
      await page.locator('#spelling-answer').dispatchEvent('compositionend');
      await tap(page.getByRole('button',{name:'检查拼写',exact:true}));
      await page.waitForTimeout(300);
      assert.equal(await page.evaluate(()=>WM.study.session.index),0);
      assert.equal(await page.locator('#spelling-answer').inputValue(),'mistake');
      assert.ok(await page.locator('.feedback.no.detail').isVisible());
      assert.equal(await page.evaluate(()=>WM.study.session.questions.length),6);
      await tap(page.getByRole('button',{name:'继续',exact:true}));
      while(await page.evaluate(()=>!!WM.study.session)) {
        await correct();await spoken();await finish();
        await page.waitForTimeout(240);
      }
      assert.ok(await page.locator('.summary').isVisible());
      assert.equal(await page.evaluate(()=>document.documentElement.dataset.studying),undefined);
      assert.deepEqual(errors,[]);
      console.log(`${native?'Android touch bridge':'Desktop Web Speech'}: completion + missing callback, duplicate input, pause/resume, replay, background, errors, default pronunciation, IME and full retry session passed`);
      await context.close();
    }
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
