'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const context={console};context.window=context;vm.createContext(context);
for(const file of ['data/words.js','js/util.js','js/bank.js','js/quiz.js']){
 const text=fs.readFileSync(path.join(__dirname,'../src',file),'utf8');
 assert.ok(!text.includes('\uFFFD'),file+' damaged encoding');
 vm.runInContext(text,context,{filename:file});
}
const {bank,quiz,util}=context.WM;
let checked=0;
for(const level of bank.levels()){
 const pool=bank.list(level.id);
 for(const entry of pool){
  for(const direction of ['en2zh','zh2en']){
   const q=quiz.makeQuestion(entry,{direction,pool,random:util.rng(util.seedFrom(entry.id+direction))});
   assert.equal(q.options.length,4,entry.id+' insufficient choices');
   assert.equal(new Set(q.options.map(option=>util.norm(option.text))).size,4,entry.id+' repeated choice');
   assert.equal(q.options[q.answerIndex].entryId,entry.id);
   for(const option of q.options.filter(option=>!option.ok))assert.equal(quiz.meaningsOverlap(entry,bank.get(option.entryId)),false,entry.id+' ambiguous distractor');
   checked++;
  }
 }
 console.log('Passed both quiz directions for',level.id,pool.length,'entries');
}
console.log('SELF-CHECK PASSED:',checked,'questions using the actual quiz engine.');
