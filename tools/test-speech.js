'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

function load({native=false,available=true}={}) {
 const timers=new Map(),events={},calls=[];let tick=0;
 let now=0;
 const context={setTimeout(fn,delay){const id=++tick;timers.set(id,{fn,delay});return id;},clearTimeout(id){timers.delete(id);},
  Date:{now:()=>now},
  document:{hidden:false,addEventListener(name,fn){events[name]=fn;},removeEventListener(){}},
  SpeechSynthesisUtterance:class {constructor(text){this.text=text;}}};
 context.window=context;
 if(native)context.WordMasterAndroid={speak(text,rate,pitch,id){calls.push({text,id});return available;},stopSpeak(){}};
 else if(available)context.speechSynthesis={getVoices:()=>[],cancel(){},speak(utter){calls.push(utter);}};
 vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/js/sound.js'),'utf8'),context);
 return {sound:context.WM.sound,context,calls,timers,events,
  poll(ms=160){now+=ms;const pair=[...timers].find(([,t])=>t.delay===160);if(pair){timers.delete(pair[0]);pair[1].fn();}}};
}

test('web speech reports completion once, after the utterance actually ends',()=>{
 const {sound,calls}=load();const result=[];
 assert.equal(sound.speak('vocabulary',{onComplete:status=>result.push(status)}),true);
 assert.equal(calls.length,1);assert.deepEqual(result,[]);
 calls[0].onend();calls[0].onend();calls[0].onerror({error:'network'});
 assert.deepEqual(result,['done']);
});

test('native speech completion is scoped to its utterance, including late callbacks',()=>{
 const {sound,calls,context}=load({native:true});const a=[],b=[];
 sound.speak('first',{onComplete:s=>a.push(s)});sound.speak('second',{onComplete:s=>b.push(s)});
 assert.deepEqual(a,['canceled']);
 context.WMAndroidSpeechComplete(calls[0].id,'done');assert.deepEqual(b,[]);
 context.WMAndroidSpeechComplete(calls[1].id,'done');context.WMAndroidSpeechComplete(calls[1].id,'error');
 assert.deepEqual(b,['done']);
});

test('missing voices and engine failures produce a terminal result instead of hanging',()=>{
 for(const options of [{available:false},{native:true,available:false}]){
  const {sound,timers}=load(options),result=[];
  assert.equal(sound.speak('test',{onComplete:s=>result.push(s)}),false);
  assert.deepEqual(result,['unavailable']);assert.equal(timers.size,0);
 }
 const {sound,calls}=load(),result=[];
 sound.speak('test',{onComplete:s=>result.push(s)});calls[0].onerror({error:'synthesis-failed'});
 assert.deepEqual(result,['error']);
});

test('manual cancellation and backgrounding never masquerade as completed speech',()=>{
 const {sound,calls,context,events,timers}=load();const result=[];
 sound.speak('first',{onComplete:s=>result.push(s)});sound.stopSpeak();calls[0].onend();
 sound.speak('second',{onComplete:s=>result.push(s)});context.document.hidden=true;events.visibilitychange();calls[1].onend();
 assert.deepEqual(result,['canceled','canceled']);assert.equal(timers.size,0);
});

test('an unresponsive TTS engine has one bounded fallback and ignores a late end event',()=>{
 const {sound,calls,timers,context}=load(),result=[];
 context.speechSynthesis.cancel=()=>calls.at(-1)?.onerror({error:'canceled'});
 sound.speak('test',{onComplete:s=>result.push(s)});
 const timer=[...timers.values()].find(t=>t.delay===5000);assert.ok(timer);timer.fn();calls[0].onend();
 assert.deepEqual(result,['timeout']);
});

test('native retained state completes speech when the WebView completion callback is lost',()=>{
 const env=load({native:true}),result=[];let state='queued';
 env.context.WordMasterAndroid.getSpeechState=()=>state;
 env.sound.speak('first',{onComplete:s=>result.push(s)});
 env.poll();assert.deepEqual(result,[]);
 state='speaking';env.poll();assert.deepEqual(result,[]);
 state='done';env.poll();assert.deepEqual(result,['done']);
 env.context.WMAndroidSpeechComplete(env.calls[0].id,'done');
 assert.deepEqual(result,['done']);assert.equal(env.timers.size,0);
});

test('web playback settling completes without an end event and does not stop an active word',()=>{
 const env=load(),result=[],engine=env.context.speechSynthesis;
 engine.speaking=false;engine.pending=true;
 env.sound.speak('first',{onComplete:s=>result.push(s)});
 env.poll();assert.deepEqual(result,[]);
 engine.pending=false;engine.speaking=true;env.poll(2000);assert.deepEqual(result,[]);
 engine.speaking=false;env.poll();env.poll();assert.deepEqual(result,[]);
 env.poll();assert.deepEqual(result,['done']);
 env.calls[0].onend();assert.deepEqual(result,['done']);assert.equal(env.timers.size,0);
});

test('an engine interruption differs from intentional cancellation, so study can recover',()=>{
 for(const native of [false,true]) {
  const env=load({native}),result=[];
  env.sound.speak('first',{onComplete:s=>result.push(s)});
  if(native) env.context.WMAndroidSpeechComplete(env.calls[0].id,'canceled');
  else env.calls[0].onerror({error:'interrupted'});
  assert.deepEqual(result,['interrupted']);
  env.sound.speak('second',{onComplete:s=>result.push(s)});env.sound.stopSpeak();
  assert.deepEqual(result,['interrupted','canceled']);
 }
});

test('a browser that never starts playback falls back and ignores late completion',()=>{
 const env=load(),result=[];
 env.context.speechSynthesis.speaking=false;env.context.speechSynthesis.pending=false;
 env.sound.speak('first',{onComplete:s=>result.push(s)});env.poll(1800);
 assert.deepEqual(result,['unavailable']);env.calls[0].onend();assert.equal(env.timers.size,0);
});
